/**
 * API-key authentication for the read-only open surface.
 *
 * A key is a tenant's credential to a machine caller, so it is handled like a
 * session token: only the SHA-256 digest is stored, the plaintext appears once
 * at creation and afterwards only the display prefix is kept. `requireApiKey`
 * is the door a `/api/open/*` route passes through — it resolves the tenant
 * *from the key*, never from the request body, so a caller cannot read another
 * workspace by naming its id.
 *
 * Every presented key is logged to `api_key_requests`, accepted or refused, so
 * a leaked key's blast radius is readable after the fact. A request whose token
 * matches no known key has no tenant to file under, so it cannot write a
 * request row (the tenant id is a foreign key) — that gap is deliberate rather
 * than a fabricated tenant on the audit line.
 */

import { get, run } from "./db.ts"

import { forbidden, unauthorized, type RequestContext } from "./http.ts"

import { generateToken, hashToken } from "./crypto.ts"

import { API_KEY_PREFIX_LENGTH } from "../shared/integrations.ts"

const now = () => new Date().toISOString()

export interface AuthenticatedKey {
  tenantId: string

  apiKeyId: string

  label: string
}

interface ApiKeyRow {
  id: string

  tenant_id: string

  label: string

  expires_at: string | null

  revoked_at: string | null
}

/** A minted key: the plaintext for the one response, plus what the row stored. */

export interface MintedApiKey {
  token: string

  tokenHash: string

  prefix: string
}

/**
 * Mint a new key. `iv_` marks it as an DeedOrbit credential at a glance; the
 * prefix is the leading characters of the whole token, for recognition only.
 */

export function mintApiKey(): MintedApiKey {
  const token = `iv_${generateToken(24)}`

  return {
    token,

    tokenHash: hashToken(token),

    prefix: token.slice(0, API_KEY_PREFIX_LENGTH),
  }
}

function recordRequest(
  tenantId: string,

  apiKeyId: string | null,

  ctx: RequestContext,

  status: number,
): void {
  run(
    `INSERT INTO api_key_requests (
        id, tenant_id, api_key_id, method, path, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,

    `akr_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`,

    tenantId,

    apiKeyId,

    ctx.method,

    ctx.pathname,

    status,

    now(),
  )
}

function bearerToken(ctx: RequestContext): string | null {
  const header = ctx.req.headers.authorization

  if (typeof header !== "string") return null

  const match = /^Bearer\s+(.+)$/i.exec(header.trim())

  return match ? match[1]!.trim() : null
}

/**
 * Authorise an open request by its bearer key and return the key's tenant.
 * A missing or unknown token is 401; a known-but-dead key (revoked or expired)
 * is 403 — the caller has a real credential that no longer works, which is a
 * different problem to fix than presenting nothing.
 */

export function requireApiKey(ctx: RequestContext): AuthenticatedKey {
  const token = bearerToken(ctx)

  if (!token) throw unauthorized("Provide an API key as a Bearer token.")

  const row = get<ApiKeyRow>(
    "SELECT id, tenant_id, label, expires_at, revoked_at FROM api_keys WHERE token_hash = ?",

    hashToken(token),
  )

  if (!row) {
    throw unauthorized("That API key is not recognised.")
  }

  const expired =
    row.expires_at !== null && new Date(row.expires_at).getTime() <= Date.now()

  const revoked = row.revoked_at !== null

  if (expired || revoked) {
    recordRequest(row.tenant_id, row.id, ctx, 403)

    throw forbidden(
      revoked ? "That API key has been revoked." : "That API key has expired.",

      revoked ? "api_key_revoked" : "api_key_expired",
    )
  }

  run("UPDATE api_keys SET last_used_at = ? WHERE id = ?", now(), row.id)

  recordRequest(row.tenant_id, row.id, ctx, 200)

  return { tenantId: row.tenant_id, apiKeyId: row.id, label: row.label }
}
