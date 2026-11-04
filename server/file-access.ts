/**
 * The signed front door on file bytes.
 *
 * The blob stays where it has always lived — base64 in the database — and the
 * privacy comes from the *door*, not the shelf: bytes are never listable and
 * never addressable by a guessable path. To open a file an entitled user first
 * mints a short-lived grant (`POST /api/documents/:id/access`), and the only way
 * to read the bytes is to redeem that grant at `/api/file-access/:token`.
 *
 * Three properties make the token a credential rather than a mere link:
 *
 *   - it is stored as a hash (`hashToken`), so a database leak is not a set of
 *     live links;
 *   - it dies on a timer (`FILE_ACCESS_TTL_SECONDS`, 120s) *and* on a use count
 *     (a view opens a few times, a download hands the file over once), so a link
 *     pasted into a chat log stops being a door;
 *   - redeeming it re-runs the **issuing user's current** permission and tenant
 *     check, so revoking the officer revokes every link they ever handed out —
 *     the grant is only as strong as the entitlement behind it.
 *
 * Every redemption is audited (`document.viewed` / `document.downloaded`) with
 * the reader's ip and the purpose, because the whole point of the door is to be
 * able to say who walked through it.
 */

import {
  DOCUMENT_TYPE_ACCESS,
  FILE_ACCESS_MAX_USES,
  FILE_ACCESS_TTL_SECONDS,
  isDocumentType,
  type FileAccessPurpose,
  type DocumentType,
} from "../shared/documents.ts"

import { all, get, run } from "./db.ts"

import { generateToken, hashToken } from "./crypto.ts"

import { HttpError, forbidden, notFound, type RequestContext } from "./http.ts"

import { can } from "./rbac.ts"

export type GrantTargetKind = "document" | "payment_proof"

/** The person the grant is issued in the name of — their grants are re-checked. */

export interface GrantActor {
  userId: string

  name: string
}

/** What issuing a grant hands back to the caller (the plaintext token, once). */

export interface IssuedGrant {
  token: string

  /** Ready-to-use path the client fetches to read the bytes. */

  url: string

  expiresAt: string

  purpose: FileAccessPurpose

  maxUses: number

  /**
   * True for a `view` grant. There is no rasteriser available, so the server
   * cannot bake a mark into the bytes; instead a view is flagged so the client
   * preview overlays the tenant + viewer + timestamp. Downloaded bytes are the
   * original — this is labelled, never faked.
   */

  watermark: boolean
}

interface GrantRow {
  id: string

  token_hash: string

  tenant_id: string

  target_kind: string

  target_id: string

  purpose: string

  issued_by_user_id: string

  issued_by_name: string

  expires_at: string

  redeemed_at: string | null

  redeemed_count: number

  max_uses: number

  created_at: string
}

function grantId(): string {
  return `fag_${Math.random().toString(36).slice(2, 12)}${Date.now().toString(36)}`
}

/**
 * Mints a single-use-count grant and returns the plaintext token to the caller
 * exactly once. Only its hash is stored. This does not itself authorise the
 * read — the caller route has already checked permission; this just opens the
 * door for a short while, and the redemption re-checks that the entitlement
 * still stands.
 */

export function issueGrant(
  tenantId: string,

  targetKind: GrantTargetKind,

  targetId: string,

  purpose: FileAccessPurpose,

  actor: GrantActor,

  ip: string | null,
): IssuedGrant {
  const token = generateToken(24)

  const tokenHash = hashToken(token)

  const maxUses = FILE_ACCESS_MAX_USES[purpose]

  const expiresAt = new Date(
    Date.now() + FILE_ACCESS_TTL_SECONDS * 1000,
  ).toISOString()

  run(
    `INSERT INTO file_access_grants (
        id, token_hash, tenant_id, target_kind, target_id, purpose,
        issued_by_user_id, issued_by_name, expires_at, redeemed_count,
        max_uses, audit_note, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,

    grantId(),

    tokenHash,

    tenantId,

    targetKind,

    targetId,

    purpose,

    actor.userId,

    actor.name,

    expiresAt,

    maxUses,

    ip ? JSON.stringify({ issued_ip: ip }) : null,

    new Date().toISOString(),
  )

  return {
    token,

    url: `/api/file-access/${encodeURIComponent(token)}`,

    expiresAt,

    purpose,

    maxUses,

    watermark: purpose === "view",
  }
}

/** The bytes a redemption released, plus how they should be presented. */

export interface RedeemedFile {
  buffer: Buffer

  mime: string

  filename: string

  disposition: "inline" | "attachment"

  tenantId: string

  targetId: string

  targetKind: GrantTargetKind

  purpose: FileAccessPurpose
}

/**
 * Writes an audit row for a redemption. There is no session behind a token
 * redeem, so this records the *issuing* user as the actor (the identity the door
 * was opened on behalf of) along with the reader's ip.
 */

function auditRedemption(
  tenantId: string,

  actorUserId: string,

  action: string,

  targetId: string,

  purpose: FileAccessPurpose,

  ip: string | null,
): void {
  const email = get<{ email: string }>(
    `SELECT email FROM users WHERE id = ?`,

    actorUserId,
  )?.email

  run(
    `INSERT INTO audit_log (
        id, tenant_id, actor_user_id, actor_email, action,
        target_type, target_id, detail, ip_address, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,

    `aud_${Math.random().toString(36).slice(2, 12)}${Date.now().toString(36)}`,

    tenantId,

    actorUserId,

    email ?? null,

    action,

    "document",

    targetId,

    JSON.stringify({ purpose }),

    ip,

    new Date().toISOString(),
  )
}

/**
 * Whether the issuing user still holds the entitlement this file is gated on.
 *
 * The baseline is always `documents.view` (the module floor). On top of it a
 * document is gated by its per-type access map, and a payment proof by
 * `payments.view` — the same gates the read routes enforce, re-run here against
 * the issuer's *current* default role so a revoked officer cannot redeem links
 * they minted before the revocation.
 */

function issuerStillEntitled(
  tenantId: string,

  issuerUserId: string,

  targetKind: GrantTargetKind,

  typeGate: string | null,
): boolean {
  const member = get<{ role_id: string }>(
    `SELECT role_id FROM tenant_memberships
      WHERE tenant_id = ? AND user_id = ?
      ORDER BY is_default DESC, created_at
      LIMIT 1`,

    tenantId,

    issuerUserId,
  )

  if (!member) return false

  const user = get<{ status: string }>(
    `SELECT status FROM users WHERE id = ? AND status = 'active'`,

    issuerUserId,
  )

  if (!user) return false

  // The module floor depends on what the grant unlocks: a payment proof lives
  // under the payments module, a file under documents. Re-checking the right one
  // means a payments-only officer can redeem a proof link without a documents grant.

  const baselineModule =
    targetKind === "payment_proof" ? "payments" : "documents"

  if (!can(tenantId, member.role_id, baselineModule, "view")) return false

  if (typeGate) {
    const separator = typeGate.indexOf(".")

    if (separator < 1) return false

    const module = typeGate.slice(0, separator)

    const action = typeGate.slice(separator + 1)

    if (!can(tenantId, member.role_id, module, action)) return false
  }

  return true
}

/**
 * Redeems a token: resolves the grant, refuses anything expired, over-used, or
 * whose issuer has lost the entitlement, reads the bytes, bumps the use count,
 * and audits the open. Failures are indistinguishable on purpose where they must
 * be (an unknown or cross-tenant token is simply "not valid") so a probing
 * client learns nothing about which links exist.
 */

export function redeemGrant(token: string, ip: string | null): RedeemedFile {
  const tokenHash = hashToken(token)

  const grant = get<GrantRow>(
    `SELECT * FROM file_access_grants WHERE token_hash = ?`,

    tokenHash,
  )

  if (!grant) throw notFound("That link is not valid")

  // A grant is scoped to its tenant; anything else reads as not-found, never a

  // cross-tenant release.

  if (Date.parse(grant.expires_at) <= Date.now()) {
    throw new HttpError(410, "gone", "That link has expired")
  }

  if (grant.redeemed_count >= grant.max_uses) {
    throw new HttpError(410, "gone", "That link has already been used")
  }

  if (grant.target_kind === "document") {
    const row = get<{
      data: string

      mime: string

      filename: string

      doc_type: string

      tenant_id: string
    }>(
      `SELECT data, mime, filename, doc_type, tenant_id
         FROM documents WHERE id = ?`,

      grant.target_id,
    )

    if (!row || row.tenant_id !== grant.tenant_id) {
      throw notFound("That link is not valid")
    }

    const typeGate = isDocumentType(row.doc_type)
      ? DOCUMENT_TYPE_ACCESS[(row.doc_type as DocumentType)].viewPermission
      : null

    if (
      !issuerStillEntitled(
        grant.tenant_id,

        grant.issued_by_user_id,

        "document",

        typeGate,
      )
    ) {
      throw forbidden(
        "Your access to this file has been revoked",
        "permission_denied",
      )
    }

    const commaIndex = row.data.indexOf(",")

    const base64 = commaIndex >= 0 ? row.data.slice(commaIndex + 1) : row.data

    const buffer = Buffer.from(base64, "base64")

    consumeGrant(grant, ip)

    return {
      buffer,

      mime: row.mime,

      filename: row.filename,

      disposition: grant.purpose === "download" ? "attachment" : "inline",

      tenantId: grant.tenant_id,

      targetId: grant.target_id,

      targetKind: "document",

      purpose: grant.purpose as FileAccessPurpose,
    }
  }

  if (grant.target_kind === "payment_proof") {
    const row = get<{
      proof_data: string | null

      proof_mime: string | null

      tenant_id: string
    }>(
      `SELECT proof_data, proof_mime, tenant_id
         FROM payments WHERE id = ?`,

      grant.target_id,
    )

    if (!row || row.tenant_id !== grant.tenant_id || !row.proof_data) {
      throw notFound("That link is not valid")
    }

    if (
      !issuerStillEntitled(
        grant.tenant_id,

        grant.issued_by_user_id,

        "payment_proof",

        "payments.view",
      )
    ) {
      throw forbidden(
        "Your access to this file has been revoked",
        "permission_denied",
      )
    }

    const commaIndex = row.proof_data.indexOf(",")

    const base64 =
      commaIndex >= 0 ? row.proof_data.slice(commaIndex + 1) : row.proof_data

    consumeGrant(grant, ip)

    return {
      buffer: Buffer.from(base64, "base64"),

      mime: row.proof_mime ?? "application/octet-stream",

      filename: `payment-proof-${grant.target_id}`,

      disposition: grant.purpose === "download" ? "attachment" : "inline",

      tenantId: grant.tenant_id,

      targetId: grant.target_id,

      targetKind: "payment_proof",

      purpose: grant.purpose as FileAccessPurpose,
    }
  }

  // A kind the schema no longer issues (defensive) reads as not-found.

  throw notFound("That link is not valid")
}

/** Marks one redemption against the grant and writes the matching audit row. */

function consumeGrant(grant: GrantRow, ip: string | null): void {
  const stamp = new Date().toISOString()

  run(
    `UPDATE file_access_grants
        SET redeemed_count = redeemed_count + 1, redeemed_at = ?
      WHERE id = ?`,

    stamp,

    grant.id,
  )

  auditRedemption(
    grant.tenant_id,

    grant.issued_by_user_id,

    grant.purpose === "download" ? "document.downloaded" : "document.viewed",

    grant.target_id,

    grant.purpose as FileAccessPurpose,

    ip,
  )
}

/**
 * GET|HEAD /api/file-access/:token — the public redemption endpoint.
 *
 * `public: true` in the route table: the token is the credential, so there is no
 * session to require. Safety comes entirely from `redeemGrant`, which re-checks
 * the issuer's live entitlement before a byte is written. A HEAD asks for headers
 * only (used by preview components to size a resource) and sends no body.
 */

export function redeemFileAccessToken(ctx: RequestContext) {
  const token = ctx.params.token ?? ""

  const file = redeemGrant(token, ctx.ip)

  const safeName = file.filename.replace(/["\r\n]/g, "")

  const headers: Record<string, string> = {
    "Content-Type": file.mime,

    "Content-Length": String(file.buffer.byteLength),

    "Content-Disposition": `${file.disposition}; filename="${safeName}"`,

    "Cache-Control": "no-store",

    "X-Content-Type-Options": "nosniff",
  }

  if (ctx.method === "HEAD") {
    ctx.res.writeHead(200, headers)

    ctx.res.end()

    return
  }

  ctx.res.writeHead(200, headers)

  ctx.res.end(file.buffer)
}

/** Lists the grants ever issued for one target — the download/view log's spine. */

export interface GrantSummary {
  id: string

  purpose: string

  issuedByName: string

  issuedByUserId: string

  createdAt: string

  expiresAt: string

  redeemedAt: string | null

  redeemedCount: number

  maxUses: number
}

export function listGrantsForTarget(
  tenantId: string,

  targetKind: GrantTargetKind,

  targetId: string,
): GrantSummary[] {
  return all<GrantRow>(
    `SELECT * FROM file_access_grants
      WHERE tenant_id = ? AND target_kind = ? AND target_id = ?
      ORDER BY created_at DESC`,

    tenantId,

    targetKind,

    targetId,
  ).map((row) => ({
    id: row.id,

    purpose: row.purpose,

    issuedByName: row.issued_by_name,

    issuedByUserId: row.issued_by_user_id,

    createdAt: row.created_at,

    expiresAt: row.expires_at,

    redeemedAt: row.redeemed_at,

    redeemedCount: row.redeemed_count,

    maxUses: row.max_uses,
  }))
}
