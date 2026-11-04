/**
 * Customer Document Verification: the staff-facing verification surface.
 *
 * Every handler opens the same way — `requirePermission(requireAuth(ctx), ...)`
 * then a tenant-scoped query — because this module turns on two of the platform's
 * load-bearing promises: nothing leaves the building unless the caller's *own*
 * grants unlock it, and nothing crosses a tenant boundary. Files are never read
 * through this route's responses; a privileged open mints a short-lived grant
 * (`server/file-access.ts`) and the bytes move only when that grant is redeemed.
 *
 * The honesty rules are enforced here, not merely displayed:
 *   - the uploader cannot verify their own upload (maker-checker, rejected in the
 *     route because SQLite cannot express "not the person who wrote that column");
 *   - a rejection must carry a reason;
 *   - a CNIC is masked in every list and revealed only to a `documents.verify` or
 *     `customers.edit` holder, and every reveal writes an audit row;
 *   - with no OCR provider nothing is auto-filled, and with no identity provider
 *     nothing is ever stamped government-verified.
 */

import { createHash } from "node:crypto"

import {
  DOCUMENT_ALLOWED_MIMES,
  DOCUMENT_MAX_BYTES,
  DOCUMENT_MAX_REQUEST_BYTES,
  DOCUMENT_TITLE_MAX,
  DOCUMENT_TYPE_ACCESS,
  DOCUMENT_FILENAME_MAX,
  DOCUMENT_REJECT_REASON_MAX,
  isDocumentType,
  isFileAccessPurpose,
  type DocumentType,
  type FileAccessPurpose,
} from "../../shared/documents.ts"

import {
  DEFAULT_CATALOG_BY_KEY,
  resolveCustomerType,
  isCustomerType,
  type CustomerType,
} from "../../shared/document-verification.ts"

import {
  formatCnic,
  maskCnic,
  normalizeCnic,
  isCnic,
} from "../../shared/customer-entry.ts"

import { all, get, run } from "../db.ts"

import {
  badRequest,
  conflict,
  forbidden,
  notFound,
  readJsonBody,
  type RequestContext,
} from "../http.ts"

import {
  requireAuth,
  requirePermission,
  writeAudit,
  type GuardedContext,
} from "../middleware.ts"

import { decryptSecret, encryptSecret, fingerprint } from "../secrets.ts"

import { issueGrant, type GrantActor } from "../file-access.ts"

import { resolveOcrProvider } from "../extraction/index.ts"

import {
  resolveIdentityProvider,
  type IdentityProviderConfig,
} from "../identity/index.ts"

import {
  buildDocumentChecklist,
  getVerificationSettings as readVerificationSettings,
  loadResolvedCatalogue,
  type ResolvedDocumentType,
} from "../document-verification-core.ts"

import { sendMissingDocumentReminders } from "../jobs/document-reminders.ts"

const now = () => new Date().toISOString()

const today = () => new Date().toISOString().slice(0, 10)

// --- Shared guards and loaders ----------------------------------------------

interface ParsedPermission {
  module: string

  action: string
}

function parsePermission(value: string): ParsedPermission | null {
  const separator = value.indexOf(".")

  if (separator < 1) return null

  return {
    module: value.slice(0, separator),
    action: value.slice(separator + 1),
  }
}

/** True when the caller holds the grant this document type is gated on. */

function holdsTypePermission(
  ctx: GuardedContext,

  viewPermission: string,
): boolean {
  const parsed = parsePermission(viewPermission)

  if (!parsed) return false

  return ctx.can(parsed.module as never, parsed.action as never)
}

interface DocumentRow {
  id: string

  tenant_id: string

  entity_type: string

  entity_id: string

  doc_type: string

  title: string

  filename: string

  mime: string

  size_bytes: number

  data: string

  expires_at: string | null

  checklist_key: string | null

  verification_status: string

  verified_by_user_id: string | null

  verified_by_name: string | null

  verified_at: string | null

  reject_reason: string | null

  reupload_requested: number

  reupload_reason: string | null

  source: string

  extracted_cnic_enc: string | null

  extracted_name_enc: string | null

  extracted_guardian_enc: string | null

  extracted_dob: string | null

  extracted_expiry: string | null

  cnic_hash: string | null

  file_sha256: string | null

  ocr_status: string

  verified_via: string | null

  provider_name: string | null

  provider_ref: string | null

  provider_response_enc: string | null

  provider_verified_at: string | null

  uploaded_by_user_id: string

  uploaded_by_name: string

  created_at: string

  updated_at: string
}

function loadDocument(
  ctx: GuardedContext,
  id: string | undefined,
): DocumentRow {
  if (!id) throw notFound("That document does not exist")

  const row = get<DocumentRow>(
    `SELECT * FROM documents WHERE tenant_id = ? AND id = ?`,

    ctx.tenantId,

    id,
  )

  if (!row) throw notFound("That document does not exist")

  return row
}

/** The type gate on the row itself, checked against the caller's grants. */

function requireRowTypeAccess(ctx: GuardedContext, row: DocumentRow): void {
  if (!isDocumentType(row.doc_type)) {
    throw notFound("That document does not exist")
  }

  const gate =
    DOCUMENT_TYPE_ACCESS[(row.doc_type as DocumentType)].viewPermission

  if (!holdsTypePermission(ctx, gate)) {
    throw forbidden(
      "Your role does not handle this kind of document.",

      "permission_denied",
    )
  }
}

interface CustomerRow {
  id: string

  full_name: string

  cnic: string | null

  customer_type: string | null

  date_of_birth: string | null

  father_husband_name: string | null
}

function loadCustomer(ctx: GuardedContext, id: string): CustomerRow {
  const row = get<CustomerRow>(
    `SELECT id, full_name, cnic, customer_type, date_of_birth, father_husband_name
       FROM customers WHERE tenant_id = ? AND id = ?`,

    ctx.tenantId,

    id,
  )

  if (!row) throw notFound("That customer does not exist")

  return row
}

function newDocId(): string {
  return `doc_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`
}

/** A minimal id+owner projection for a duplicate-collision lookup. */

interface DuplicateRow {
  id: string

  entity_id: string
}

// --- Upload payload parsing -------------------------------------------------

interface ParsedDataUrlOk {
  ok: true

  mime: string

  dataUrl: string

  base64: string

  bytes: number
}

interface ParsedDataUrlError {
  ok: false

  error: string
}

function parseDataUrl(value: unknown): ParsedDataUrlOk | ParsedDataUrlError {
  if (typeof value !== "string") {
    return { ok: false, error: "The file data is required." }
  }

  const matched = /^data:([a-z0-9/\-.+]+);base64,(.+)$/i.exec(value)

  if (!matched) {
    return { ok: false, error: "The file must be a base64 data URL." }
  }

  const mime = matched[1]!.toLowerCase()

  if (!(DOCUMENT_ALLOWED_MIMES as readonly string[]).includes(mime)) {
    return {
      ok: false,

      error: `Allowed types: ${DOCUMENT_ALLOWED_MIMES.join(", ")}.`,
    }
  }

  const base64 = matched[2]!

  let bytes: number

  try {
    bytes = Buffer.from(base64, "base64").length
  } catch {
    return { ok: false, error: "The file data is not valid base64." }
  }

  if (bytes === 0) return { ok: false, error: "That file appears to be empty." }

  if (bytes > DOCUMENT_MAX_BYTES) {
    return {
      ok: false,

      error: `That file is too large. The limit is ${Math.floor(DOCUMENT_MAX_BYTES / (1024 * 1024))} MB.`,
    }
  }

  return { ok: true, mime, dataUrl: value, base64, bytes }
}

/** A plain content hash of the bytes — the duplicate-document fingerprint. */

function fileFingerprint(base64: string): string {
  return createHash("sha256")
    .update(Buffer.from(base64, "base64"))
    .digest("hex")
}

function cleanText(value: unknown, max: number, label: string): string {
  const text = typeof value === "string" ? value.trim() : ""

  if (text === "") {
    throw badRequest(`Give the document a ${label}.`, { [label]: "Required." })
  }

  if (text.length > max) {
    throw badRequest(`That ${label} is too long.`, {
      [label]: `Use ${max} characters or fewer.`,
    })
  }

  return text
}

function parseDateOrNull(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === "") return null

  const text = String(value).trim()

  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(text))) {
    throw badRequest("A date must be a real date.", {
      [field]: "Use the format YYYY-MM-DD.",
    })
  }

  return text
}

/**
 * The encrypted identity fields a review stores, drawn from the verifier's
 * confirmation (or, absent a confirmation, the OCR suggestions). A blank field
 * stays null, never an empty string, so "not read" is different from "read as
 * nothing".
 */

interface IdentityFields {
  cnic: string | null

  name: string | null

  guardian: string | null

  dob: string | null

  expiry: string | null

  cnicHash: string | null
}

function resolveIdentityFields(body: Record<string, unknown>): IdentityFields {
  const cnicRaw = typeof body.cnic === "string" ? normalizeCnic(body.cnic) : ""

  const cnic = cnicRaw !== "" && isCnic(cnicRaw) ? cnicRaw : null

  const name =
    typeof body.name === "string" && body.name.trim() !== ""
      ? body.name.trim()
      : null

  const guardian =
    typeof body.guardianName === "string" && body.guardianName.trim() !== ""
      ? body.guardianName.trim()
      : null

  const dob = parseDateOrNull(body.dob, "dob")

  const expiry = parseDateOrNull(body.expiry, "expiry")

  return {
    cnic,

    name,

    guardian,

    dob,

    expiry,

    cnicHash: cnic ? fingerprint(cnic) : null,
  }
}

// --- Checklist --------------------------------------------------------------

/** GET /api/customers/:id/document-checklist */

export function getCustomerChecklist(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "documents", "view")

  const customer = loadCustomer(guarded, ctx.params.id!)

  const checklist = buildDocumentChecklist(
    guarded.tenantId,

    customer.id,

    today(),
  )

  if (!checklist) throw notFound("That customer does not exist")

  return {
    ...checklist,

    customerTypeLabel: checklist.customerType,

    cnicMasked: maskCnic(customer.cnic),

    canVerify: guarded.can("documents", "verify"),

    canUpload: guarded.can("documents", "create"),
  }
}

// --- Upload (staff) ---------------------------------------------------------

/**
 * POST /api/customers/:id/documents
 *
 * Files a document against a customer and drops it in the verification queue as
 * `under_review`. Runs the (manual-by-default) OCR adapter: with no real engine it
 * returns nothing, so no field is pre-filled and `ocr_status` stays `none`. Detects
 * a duplicate file (same bytes) and a duplicate CNIC (same keyed fingerprint)
 * across the tenant without ever storing a recoverable value for either.
 */

export async function uploadCustomerDocument(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "documents", "create")

  const customer = loadCustomer(guarded, ctx.params.id!)

  const body = await readJsonBody<Record<string, unknown>>(
    ctx.req,

    DOCUMENT_MAX_REQUEST_BYTES,
  )

  const checklistKey =
    typeof body.checklistKey === "string" ? body.checklistKey.trim() : ""

  if (checklistKey === "") {
    throw badRequest("Choose which document this is.", {
      checklistKey: "Required.",
    })
  }

  const resolved = resolveCatalogType(guarded.tenantId, checklistKey)

  const docType = resolved?.baseDocType ?? "other"

  // Filing an identity copy demands the same grant that reading one does, so the

  // per-type gate is checked against the destination bucket, exactly as the

  // general upload path enforces it.

  const gate = DOCUMENT_TYPE_ACCESS[docType].viewPermission

  if (!holdsTypePermission(guarded, gate)) {
    throw forbidden(
      "Your role does not handle this kind of document.",

      "permission_denied",
    )
  }

  const title = cleanText(body.title, DOCUMENT_TITLE_MAX, "title")

  const filename = cleanText(body.filename, DOCUMENT_FILENAME_MAX, "filename")

  const parsed = parseDataUrl(body.dataUrl)

  if (!parsed.ok) throw badRequest(parsed.error, { dataUrl: parsed.error })

  const expiresAt = parseDateOrNull(body.expiresAt, "expiresAt")

  const sha256 = fileFingerprint(parsed.base64)

  // Duplicate *detection*, never prevention: the flags ride back to the reviewer,

  // who decides if two uploads of the same card are a real problem.

  const duplicateFile = get<DuplicateRow>(
    `SELECT id, entity_id FROM documents
      WHERE tenant_id = ? AND file_sha256 = ? AND id <> ?
      LIMIT 1`,

    guarded.tenantId,

    sha256,

    "",
  )

  const provider = resolveOcrProvider()

  let ocrStatus = "none"

  let fields = resolveIdentityFields(body)

  if (resolved?.ocr) {
    const result = await provider

      .extract(Buffer.from(parsed.base64, "base64"), parsed.mime)

      .catch(() => null)

    if (result) {
      // Only a genuine provider read may pre-fill; a manual reviewer's typed values

      // (body fields) still win, so a real engine suggests and a human confirms.

      const ocrIdentity: IdentityFields = {
        cnic: result.fields.cnic ?? null,

        name: result.fields.fullName ?? fields.name,

        guardian: result.fields.guardianName ?? fields.guardian,

        dob: result.fields.dob ?? fields.dob,

        expiry: result.fields.expiry ?? fields.expiry,

        cnicHash: result.fields.cnic
          ? fingerprint(result.fields.cnic)
          : fields.cnicHash,
      }

      fields = {
        cnic: fields.cnic ?? ocrIdentity.cnic,

        name: fields.name ?? ocrIdentity.name,

        guardian: fields.guardian ?? ocrIdentity.guardian,

        dob: fields.dob ?? ocrIdentity.dob,

        expiry: fields.expiry ?? ocrIdentity.expiry,

        cnicHash: fields.cnicHash ?? ocrIdentity.cnicHash,
      }

      ocrStatus = "suggested"
    }
  }

  const duplicateCnic = fields.cnicHash
    ? get<DuplicateRow>(
        `SELECT id, entity_id FROM documents
          WHERE tenant_id = ? AND cnic_hash = ?
          LIMIT 1`,

        guarded.tenantId,

        fields.cnicHash,
      )
    : undefined

  const id = newDocId()

  const stamp = now()

  const settings = readVerificationSettings(guarded.tenantId)

  const retentionUntil =
    settings.retentionDays !== null
      ? new Date(Date.now() + settings.retentionDays * 86_400_000).toISOString()
      : null

  run(
    `INSERT INTO documents (
        id, tenant_id, entity_type, entity_id, doc_type, title, filename, mime,
        size_bytes, data, expires_at, checklist_key, verification_status,
        uploaded_by_user_id, uploaded_by_name, created_at, updated_at,
        extracted_cnic_enc, extracted_name_enc, extracted_guardian_enc,
        extracted_dob, extracted_expiry, cnic_hash, file_sha256, ocr_status,
        reupload_requested, source, retention_until
      ) VALUES (?, ?, 'customer', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'under_review',
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'staff', ?)`,

    id,

    guarded.tenantId,

    customer.id,

    docType,

    title,

    filename,

    parsed.mime,

    parsed.bytes,

    parsed.dataUrl,

    expiresAt,

    checklistKey,

    guarded.userId,

    guarded.session.user.fullName,

    stamp,

    stamp,

    encryptSecret(fields.cnic),

    encryptSecret(fields.name),

    encryptSecret(fields.guardian),

    fields.dob,

    fields.expiry,

    fields.cnicHash,

    sha256,

    ocrStatus,

    retentionUntil,
  )

  writeAudit(
    guarded,

    "documents.verification_uploaded",

    "document",

    id,

    {
      checklistKey,

      docType,

      bytes: parsed.bytes,

      ocrStatus,

      duplicateFile: duplicateFile?.id ?? null,

      duplicateCnic: duplicateCnic?.id ?? null,
    },

    ctx.ip,
  )

  const created = loadDocument(guarded, id)

  return {
    document: toQueueSummary(created),

    flags: {
      duplicateFile: duplicateFile
        ? { documentId: duplicateFile.id, customerId: duplicateFile.entity_id }
        : null,

      duplicateCnic: duplicateCnic
        ? { documentId: duplicateCnic.id, customerId: duplicateCnic.entity_id }
        : null,
    },

    ocrStatus,
  }
}

function resolveCatalogType(
  tenantId: string,

  key: string,
): ResolvedDocumentType | null {
  const catalogue = loadResolvedCatalogue(tenantId)

  const found = catalogue.find((item) => item.key === key)

  if (found) return found

  const def = DEFAULT_CATALOG_BY_KEY[key]

  if (!def) return null

  return {
    key: def.key,

    label: def.label,

    baseDocType: def.baseDocType,

    sensitive: def.sensitive,

    ocr: def.ocr,

    trackExpiry: def.trackExpiry,

    sortOrder: def.sortOrder,

    enabled: true,

    required: {
      individual: def.requiredFor.includes("individual"),

      company: def.requiredFor.includes("company"),

      overseas_pakistani: def.requiredFor.includes("overseas_pakistani"),
    },
  }
}

// --- Verification queue -----------------------------------------------------

interface QueueRow {
  id: string

  entity_id: string

  title: string

  filename: string

  mime: string

  size_bytes: number

  checklist_key: string | null

  doc_type: string

  source: string

  ocr_status: string

  expires_at: string | null

  uploaded_by_user_id: string

  uploaded_by_name: string

  created_at: string

  customer_name: string | null
}

function toQueueSummary(row: DocumentRow | QueueRow) {
  return {
    id: row.id,

    customerId: row.entity_id,

    title: row.title,

    filename: row.filename,

    mime: row.mime,

    sizeBytes: row.size_bytes,

    checklistKey: row.checklist_key,

    docType: row.doc_type,

    source: row.source,

    ocrStatus: row.ocr_status,

    expiresAt: row.expires_at,

    uploadedByUserId: row.uploaded_by_user_id,

    uploadedByName: row.uploaded_by_name,

    createdAt: row.created_at,

    customerName: "customer_name" in row ? (row.customer_name ?? null) : null,
  }
}

/** GET /api/documents/verification-queue — pending items, gated on `documents.verify`. */

export function listVerificationQueue(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "documents", "verify")

  const status = ctx.query.get("status") ?? "under_review"

  if (status !== "under_review" && status !== "unverified") {
    throw badRequest("Queue status must be under_review or unverified.", {
      status: "Unknown queue status.",
    })
  }

  const checklistKey = ctx.query.get("checklistKey")

  const customerId = ctx.query.get("customerId")

  const limit = clampLimit(ctx.query.get("limit"), 50, 200)

  const offset = clampOffset(ctx.query.get("offset"))

  const clauses = [
    "d.tenant_id = ?",
    "d.entity_type = 'customer'",
    "d.verification_status = ?",
  ]

  const params: (string | number)[] = [guarded.tenantId, status]

  if (checklistKey) {
    clauses.push("d.checklist_key = ?")

    params.push(checklistKey)
  }

  if (customerId) {
    clauses.push("d.entity_id = ?")

    params.push(customerId)
  }

  const rows = all<QueueRow>(
    `SELECT d.*, c.full_name AS customer_name
       FROM documents d
       LEFT JOIN customers c ON c.id = d.entity_id AND c.tenant_id = d.tenant_id
      WHERE ${clauses.join(" AND ")}
      ORDER BY d.created_at ASC
      LIMIT ? OFFSET ?`,

    ...params,

    limit,

    offset,
  )

  return {
    items: rows.map(toQueueSummary),

    limit,

    offset,

    canVerify: true,
  }
}

function clampLimit(raw: string | null, fallback: number, max: number): number {
  const n = raw === null ? fallback : Number(raw)

  if (!Number.isFinite(n) || n <= 0) return fallback

  return Math.min(Math.floor(n), max)
}

function clampOffset(raw: string | null): number {
  const n = raw === null ? 0 : Number(raw)

  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

// --- Review -----------------------------------------------------------------

/**
 * GET /api/documents/:id/review
 *
 * The self-contained payload for the side-by-side screen: a preview grant, the
 * (encrypted-then-decrypted) extracted fields, the customer's own profile values
 * for comparison, and the mismatch / duplicate flags. The CNIC returned here is
 * masked unless the caller also holds the reveal right, which is exactly the
 * right the dedicated reveal endpoint re-checks and audits.
 */

export function getDocumentReview(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "documents", "verify")

  const row = loadDocument(guarded, ctx.params.id!)

  requireRowTypeAccess(guarded, row)

  const customer = get<{
    id: string

    full_name: string

    cnic: string | null

    customer_type: string | null

    father_husband_name: string | null
  }>(
    `SELECT id, full_name, cnic, customer_type, father_husband_name
       FROM customers WHERE tenant_id = ? AND id = ?`,

    guarded.tenantId,

    row.entity_id,
  )

  const extractedName = decryptSecret(row.extracted_name_enc)

  const extractedCnic = decryptSecret(row.extracted_cnic_enc)

  const extractedGuardian = decryptSecret(row.extracted_guardian_enc)

  const canReveal =
    guarded.can("documents", "verify") || guarded.can("customers", "edit")

  const profileCnic = customer?.cnic ?? null

  const nameMismatch =
    extractedName !== null &&
    customer !== undefined &&
    normaliseForCompare(extractedName) !==
      normaliseForCompare(customer.full_name)

  const cnicMismatch =
    extractedCnic !== null &&
    profileCnic !== null &&
    normalizeCnic(extractedCnic) !== normalizeCnic(profileCnic)

  const duplicateFile = row.file_sha256
    ? get<DuplicateRow>(
        `SELECT id, entity_id FROM documents
          WHERE tenant_id = ? AND file_sha256 = ? AND id <> ?
          LIMIT 1`,

        guarded.tenantId,

        row.file_sha256,

        row.id,
      )
    : undefined

  const duplicateCnic = row.cnic_hash
    ? get<DuplicateRow>(
        `SELECT id, entity_id FROM documents
          WHERE tenant_id = ? AND cnic_hash = ? AND id <> ?
          LIMIT 1`,

        guarded.tenantId,

        row.cnic_hash,

        row.id,
      )
    : undefined

  const preview = issueGrant(
    guarded.tenantId,

    "document",

    row.id,

    "view",

    actorOf(guarded),

    ctx.ip,
  )

  const settings = readVerificationSettings(guarded.tenantId)

  return {
    document: toQueueSummary(row),

    verificationStatus: row.verification_status,

    rejectReason: row.reject_reason,

    reuploadRequested: row.reupload_requested === 1,

    reuploadReason: row.reupload_reason,

    verifiedVia: row.verified_via,

    verifiedByName: row.verified_by_name,

    verifiedAt: row.verified_at,

    providerRef: row.provider_ref,

    customer: customer
      ? {
          id: customer.id,

          fullName: customer.full_name,

          customerType: resolveCustomerType(customer.customer_type),

          cnicMasked: maskCnic(profileCnic),

          cnic: canReveal ? formatCnic(profileCnic) : null,

          fatherHusbandName: customer.father_husband_name,
        }
      : null,

    extracted: {
      name: extractedName,

      // The reviewer already holds `documents.verify` (the reveal gate's first

      // branch), but the plaintext CNIC is still withheld from *lists*; the review

      // screen is the one place a verifier needs it side-by-side, gated here.

      cnic: canReveal ? extractedCnic : maskCnic(extractedCnic),

      cnicMasked: maskCnic(extractedCnic),

      guardianName: extractedGuardian,

      dob: row.extracted_dob,

      expiry: row.extracted_expiry,
    },

    ocrStatus: row.ocr_status,

    mismatch: { name: nameMismatch, cnic: cnicMismatch },

    duplicateFile: duplicateFile
      ? { documentId: duplicateFile.id, customerId: duplicateFile.entity_id }
      : null,

    duplicateCnic: duplicateCnic
      ? { documentId: duplicateCnic.id, customerId: duplicateCnic.entity_id }
      : null,

    preview,

    identityMode: settings.identityMode,

    uploaderUserId: row.uploaded_by_user_id,

    canVerifyNow: row.uploaded_by_user_id !== guarded.userId,
  }
}

function normaliseForCompare(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim()
}

function actorOf(guarded: GuardedContext): GrantActor {
  return { userId: guarded.userId, name: guarded.session.user.fullName }
}

// --- Verify -----------------------------------------------------------------

/**
 * POST /api/documents/:id/verify
 *
 * Certifies a document after the reviewer confirms the fields. Maker-checker is
 * enforced here: the person who uploaded the file cannot be the person who stamps
 * it, so an un-reviewed upload cannot be self-certified by the desk that received
 * it. A verification records the human and the day (`verified_via = 'manual'`) —
 * never a government claim; that lives only on the provider path.
 */

export async function verifyDocument(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "documents", "verify")

  const row = loadDocument(guarded, ctx.params.id!)

  requireRowTypeAccess(guarded, row)

  if (row.uploaded_by_user_id === guarded.userId) {
    throw forbidden(
      "You uploaded this document, so you cannot verify it. Another entitled reviewer must certify it.",

      "self_verification",
    )
  }

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const fields = resolveIdentityFields(body)

  const expiresAt =
    parseDateOrNull(body.expiresAt, "expiresAt") ?? row.expires_at

  const stamp = now()

  run(
    `UPDATE documents
        SET verification_status = 'verified', verified_by_user_id = ?,
            verified_by_name = ?, verified_at = ?, verified_via = 'manual',
            reject_reason = NULL, reupload_requested = 0, reupload_reason = NULL,
            extracted_cnic_enc = ?, extracted_name_enc = ?,
            extracted_guardian_enc = ?, extracted_dob = ?, extracted_expiry = ?,
            cnic_hash = ?, expires_at = ?, updated_by_user_id = ?, updated_at = ?,
            ocr_status = CASE WHEN ocr_status = 'suggested' THEN 'confirmed'
                              ELSE ocr_status END
      WHERE tenant_id = ? AND id = ?`,

    guarded.userId,

    guarded.session.user.fullName,

    stamp,

    encryptSecret(fields.cnic) ?? row.extracted_cnic_enc,

    encryptSecret(fields.name) ?? row.extracted_name_enc,

    encryptSecret(fields.guardian) ?? row.extracted_guardian_enc,

    fields.dob ?? row.extracted_dob,

    fields.expiry ?? row.extracted_expiry,

    fields.cnicHash ?? row.cnic_hash,

    expiresAt,

    guarded.userId,

    stamp,

    guarded.tenantId,

    row.id,
  )

  writeAudit(
    guarded,

    "document.verified",

    "document",

    row.id,

    { via: "manual", checklistKey: row.checklist_key },

    ctx.ip,
  )

  const updated = loadDocument(guarded, row.id)

  return { document: toQueueSummary(updated), verificationStatus: "verified" }
}

// --- Reject -----------------------------------------------------------------

/** POST /api/documents/:id/reject — mandatory reason; optionally asks for a re-upload. */

export async function rejectDocument(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "documents", "verify")

  const row = loadDocument(guarded, ctx.params.id!)

  requireRowTypeAccess(guarded, row)

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const reason = typeof body.reason === "string" ? body.reason.trim() : ""

  if (reason === "") {
    throw badRequest("Record why this document is being rejected.", {
      reason: "A rejection needs a reason the customer can read.",
    })
  }

  if (reason.length > DOCUMENT_REJECT_REASON_MAX) {
    throw badRequest("That reason is too long.", {
      reason: `Use ${DOCUMENT_REJECT_REASON_MAX} characters or fewer.`,
    })
  }

  const requestReupload = body.requestReupload === true

  const stamp = now()

  run(
    `UPDATE documents
        SET verification_status = 'rejected', reject_reason = ?,
            reupload_requested = ?, reupload_reason = ?, updated_by_user_id = ?,
            updated_at = ?
      WHERE tenant_id = ? AND id = ?`,

    reason,

    requestReupload ? 1 : 0,

    requestReupload ? reason : row.reupload_reason,

    guarded.userId,

    stamp,

    guarded.tenantId,

    row.id,
  )

  writeAudit(
    guarded,

    "document.rejected",

    "document",

    row.id,

    { reason, requestReupload },

    ctx.ip,
  )

  return { verificationStatus: "rejected", reason }
}

/** POST /api/documents/:id/request-reupload — asks the customer to file a fresh copy. */

export async function requestReupload(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "documents", "edit")

  const row = loadDocument(guarded, ctx.params.id!)

  requireRowTypeAccess(guarded, row)

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const reason =
    typeof body.reason === "string" && body.reason.trim() !== ""
      ? body.reason.trim().slice(0, DOCUMENT_REJECT_REASON_MAX)
      : "A clearer or corrected copy is needed."

  const stamp = now()

  run(
    `UPDATE documents
        SET reupload_requested = 1, reupload_reason = ?, updated_by_user_id = ?,
            updated_at = ?
      WHERE tenant_id = ? AND id = ?`,

    reason,

    guarded.userId,

    stamp,

    guarded.tenantId,

    row.id,
  )

  writeAudit(
    guarded,

    "document.reupload_requested",

    "document",

    row.id,

    { reason },

    ctx.ip,
  )

  return { reuploadRequested: true, reason }
}

// --- Provider verification --------------------------------------------------

/**
 * POST /api/documents/:id/provider-verify
 *
 * The only route that may write a government-verified state, and only when the
 * tenant is in `provider` mode *and* a live provider actually returns a pass. With
 * manual mode or no configured provider this refuses and changes nothing — the
 * platform will not claim a registry check it did not perform.
 */

export async function providerVerifyDocument(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "documents", "verify")

  const row = loadDocument(guarded, ctx.params.id!)

  requireRowTypeAccess(guarded, row)

  const settings = readVerificationSettings(guarded.tenantId)

  if (settings.identityMode !== "provider") {
    throw conflict(
      "Identity verification is in manual mode. Turn on the provider in settings to run a live check.",
    )
  }

  const config = loadIdentityProviderConfig(guarded.tenantId)

  if (!config) {
    throw conflict(
      "No live identity provider is configured for this workspace.",
    )
  }

  const provider = resolveIdentityProvider(config)

  const cnic =
    decryptSecret(row.extracted_cnic_enc) ??
    profileCnicOf(guarded, row.entity_id)

  if (!cnic || !isCnic(normalizeCnic(cnic))) {
    throw badRequest("A valid CNIC is needed to run a provider check.", {
      cnic: "Record the customer's CNIC first.",
    })
  }

  const name = decryptSecret(row.extracted_name_enc)

  const result = await provider.verify({
    cnic: normalizeCnic(cnic),

    name,

    dob: row.extracted_dob,
  })

  if (!result) {
    throw conflict(
      "The identity provider did not answer. No verification has been recorded.",
    )
  }

  if (!result.ok) {
    run(
      `UPDATE documents
          SET provider_name = ?, provider_ref = NULL, provider_response_enc = ?,
              provider_verified_at = ?, verified_via = NULL
        WHERE tenant_id = ? AND id = ?`,

      provider.id,

      encryptSecret(result.raw),

      now(),

      guarded.tenantId,

      row.id,
    )

    writeAudit(
      guarded,

      "document.provider_rejected",

      "document",

      row.id,

      { provider: provider.id },

      ctx.ip,
    )

    throw conflict(
      "The provider returned a not-verified result. The document stays unverified.",
    )
  }

  const stamp = now()

  run(
    `UPDATE documents
        SET verification_status = 'verified', verified_by_user_id = ?,
            verified_by_name = ?, verified_at = ?, verified_via = 'provider',
            provider_name = ?, provider_ref = ?, provider_response_enc = ?,
            provider_verified_at = ?
      WHERE tenant_id = ? AND id = ?`,

    guarded.userId,

    guarded.session.user.fullName,

    stamp,

    stamp,

    provider.id,

    result.ref,

    encryptSecret(result.raw),

    stamp,

    guarded.tenantId,

    row.id,
  )

  writeAudit(
    guarded,

    "document.provider_verified",

    "document",

    row.id,

    { provider: provider.id, ref: result.ref },

    ctx.ip,
  )

  return {
    verificationStatus: "verified",
    verifiedVia: "provider",
    providerRef: result.ref,
  }
}

interface IdentityProviderConfigRow {
  provider: string

  endpoint: string | null

  credentials_enc: string | null
}

function loadIdentityProviderConfig(
  tenantId: string,
): IdentityProviderConfig | null {
  const row = get<IdentityProviderConfigRow>(
    `SELECT provider, endpoint, credentials_enc
       FROM identity_provider_configs
      WHERE tenant_id = ? AND enabled = 1 AND provider <> 'manual'
      ORDER BY updated_at DESC
      LIMIT 1`,

    tenantId,
  )

  if (!row) return null

  return {
    id: row.provider,

    endpoint: row.endpoint ?? "",

    credential: decryptSecret(row.credentials_enc),
  }
}

function profileCnicOf(ctx: GuardedContext, customerId: string): string | null {
  return (
    get<{ cnic: string | null }>(
      `SELECT cnic FROM customers WHERE tenant_id = ? AND id = ?`,

      ctx.tenantId,

      customerId,
    )?.cnic ?? null
  )
}

// --- Reveal -----------------------------------------------------------------

/**
 * GET /api/documents/:id/cnic
 *
 * Releases the plaintext CNIC and extracted identity fields only to a holder of
 * `documents.verify` or `customers.edit`, and writes an audit row on every reveal
 * so "who looked at this number" is always answerable.
 */

export function revealDocumentCnic(ctx: RequestContext) {
  const guarded = requireAuth(ctx)

  if (
    !guarded.can("documents", "verify") &&
    !guarded.can("customers", "edit")
  ) {
    writeAudit(
      guarded,
      "permission.denied.reveal",
      "document",
      ctx.params.id ?? null,
      {
        reason: "cnic_reveal",
      },
    )

    throw forbidden(
      "Your role cannot reveal an identity number.",

      "permission_denied",
    )
  }

  const row = loadDocument(guarded, ctx.params.id!)

  requireRowTypeAccess(guarded, row)

  const cnic = decryptSecret(row.extracted_cnic_enc)

  writeAudit(
    guarded,

    "document.cnic_revealed",

    "document",

    row.id,

    { checklistKey: row.checklist_key },

    ctx.ip,
  )

  return {
    documentId: row.id,

    cnic,

    cnicMasked: maskCnic(cnic),

    name: decryptSecret(row.extracted_name_enc),

    guardianName: decryptSecret(row.extracted_guardian_enc),

    dob: row.extracted_dob,

    expiry: row.extracted_expiry,
  }
}

// --- Signed access ----------------------------------------------------------

/** POST /api/documents/:id/access — mints a short-lived grant for view or download. */

export async function issueDocumentAccess(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "documents", "view")

  const row = loadDocument(guarded, ctx.params.id!)

  requireRowTypeAccess(guarded, row)

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const purpose = body.purpose

  if (!isFileAccessPurpose(purpose)) {
    throw badRequest("purpose must be view or download.", {
      purpose: "Unknown access purpose.",
    })
  }

  const grant = issueGrant(
    guarded.tenantId,

    "document",

    row.id,

    purpose as FileAccessPurpose,

    actorOf(guarded),

    ctx.ip,
  )

  writeAudit(
    guarded,

    "document.access_granted",

    "document",

    row.id,

    { purpose, expiresAt: grant.expiresAt },

    ctx.ip,
  )

  return { access: grant }
}

// --- Audit views ------------------------------------------------------------

interface AuditRow {
  id: string

  action: string

  actor_email: string | null

  actor_user_id: string | null

  detail: string | null

  ip_address: string | null

  created_at: string
}

function toAuditDto(row: AuditRow) {
  let purpose: string | null = null

  if (row.detail) {
    try {
      const parsed = JSON.parse(row.detail) as { purpose?: unknown }

      purpose = typeof parsed.purpose === "string" ? parsed.purpose : null
    } catch {
      purpose = null
    }
  }

  return {
    id: row.id,

    action: row.action,

    actorEmail: row.actor_email,

    actorUserId: row.actor_user_id,

    purpose,

    ip: row.ip_address,

    createdAt: row.created_at,
  }
}

/** GET /api/documents/:id/download-log — every view / download redemption. */

export function getDocumentDownloadLog(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "documents", "view")

  const row = loadDocument(guarded, ctx.params.id!)

  requireRowTypeAccess(guarded, row)

  const rows = all<AuditRow>(
    `SELECT id, action, actor_email, actor_user_id, detail, ip_address, created_at
       FROM audit_log
      WHERE tenant_id = ? AND target_type = 'document' AND target_id = ?
        AND action IN ('document.viewed', 'document.downloaded')
      ORDER BY created_at DESC
      LIMIT 200`,

    guarded.tenantId,

    row.id,
  )

  return { entries: rows.map(toAuditDto) }
}

/** GET /api/documents/:id/reveal-log — every CNIC reveal of this document. */

export function getDocumentRevealLog(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "documents", "view")

  const row = loadDocument(guarded, ctx.params.id!)

  requireRowTypeAccess(guarded, row)

  const rows = all<AuditRow>(
    `SELECT id, action, actor_email, actor_user_id, detail, ip_address, created_at
       FROM audit_log
      WHERE tenant_id = ? AND target_type = 'document' AND target_id = ?
        AND action = 'document.cnic_revealed'
      ORDER BY created_at DESC
      LIMIT 200`,

    guarded.tenantId,

    row.id,
  )

  return { entries: rows.map(toAuditDto) }
}

// --- Bulk reminders ---------------------------------------------------------

/** POST /api/documents/bulk-remind — nudges a filtered customer set about missing papers. */

export async function bulkRemind(ctx: RequestContext) {
  const guarded = requireAuth(ctx)

  if (!guarded.can("documents", "edit") && !guarded.can("reminders", "edit")) {
    throw forbidden(
      "Your role cannot send document reminders.",

      "permission_denied",
    )
  }

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const customerIds = Array.isArray(body.customerIds)
    ? body.customerIds.filter((id): id is string => typeof id === "string")
    : []

  if (customerIds.length === 0) {
    throw badRequest("Choose at least one customer to remind.", {
      customerIds: "Required.",
    })
  }

  if (customerIds.length > 500) {
    throw badRequest("Too many customers in one reminder.", {
      customerIds: "Send in batches of 500 or fewer.",
    })
  }

  const batch = Date.now().toString(36)

  const result = await sendMissingDocumentReminders(
    guarded.tenantId,

    customerIds,

    now(),

    batch,
  )

  writeAudit(
    guarded,

    "document.bulk_remind",

    "customer",

    null,

    { requested: customerIds.length, ...result },

    ctx.ip,
  )

  return result
}

// --- Settings ---------------------------------------------------------------

interface SettingsPatch {
  blockBooking?: unknown

  blockPlanActivation?: unknown

  allowOverride?: unknown

  watermarkPreviews?: unknown

  retentionDays?: unknown

  expiryAlertDays?: unknown

  identityMode?: unknown
}

/** GET /api/settings/document-verification */

export function getVerificationSettings(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "settings", "view")

  return { settings: readVerificationSettings(guarded.tenantId) }
}

/** PATCH /api/settings/document-verification */

export async function patchVerificationSettings(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "settings", "edit")

  const body = await readJsonBody<SettingsPatch>(ctx.req)

  const current = readVerificationSettings(guarded.tenantId)

  const next = {
    blockBooking: pickBool(body.blockBooking, current.blockBooking),

    blockPlanActivation: pickBool(
      body.blockPlanActivation,

      current.blockPlanActivation,
    ),

    allowOverride: pickBool(body.allowOverride, current.allowOverride),

    watermarkPreviews: pickBool(
      body.watermarkPreviews,

      current.watermarkPreviews,
    ),

    retentionDays: pickRetention(body.retentionDays, current.retentionDays),

    expiryAlertDays: pickAlerts(body.expiryAlertDays, current.expiryAlertDays),

    identityMode: pickIdentityMode(body.identityMode, current.identityMode),
  }

  const stamp = now()

  run(
    `INSERT INTO doc_verification_settings (
        tenant_id, block_booking, block_plan_activation, allow_override,
        watermark_previews, retention_days, expiry_alert_days, identity_mode,
        updated_at, updated_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(tenant_id) DO UPDATE SET
        block_booking = excluded.block_booking,
        block_plan_activation = excluded.block_plan_activation,
        allow_override = excluded.allow_override,
        watermark_previews = excluded.watermark_previews,
        retention_days = excluded.retention_days,
        expiry_alert_days = excluded.expiry_alert_days,
        identity_mode = excluded.identity_mode,
        updated_at = excluded.updated_at,
        updated_by = excluded.updated_by`,

    guarded.tenantId,

    next.blockBooking ? 1 : 0,

    next.blockPlanActivation ? 1 : 0,

    next.allowOverride ? 1 : 0,

    next.watermarkPreviews ? 1 : 0,

    next.retentionDays,

    next.expiryAlertDays.join(","),

    next.identityMode,

    stamp,

    guarded.session.user.fullName,
  )

  writeAudit(
    guarded,

    "settings.document_verification_updated",

    "tenant",

    guarded.tenantId,

    { identityMode: next.identityMode, blockBooking: next.blockBooking },

    ctx.ip,
  )

  return { settings: next }
}

function pickBool(value: unknown, fallback: boolean): boolean {
  return value === undefined ? fallback : value === true
}

function pickRetention(value: unknown, fallback: number | null): number | null {
  if (value === undefined) return fallback

  if (value === null || value === "") return null

  const n = Number(value)

  if (!Number.isInteger(n) || n < 1 || n > 3650) {
    throw badRequest("Retention days must be a whole number of days.", {
      retentionDays:
        "Use between 1 and 3650, or clear it to keep files forever.",
    })
  }

  return n
}

function pickAlerts(value: unknown, fallback: number[]): number[] {
  if (value === undefined) return fallback

  const text = String(value)

  const list = text

    .split(/[,\s]+/)

    .map((part) => Number(part))

    .filter((n) => Number.isInteger(n) && n > 0 && n <= 365)

  if (list.length === 0) {
    throw badRequest("Expiry alert days must be a comma list like 60,30,7.", {
      expiryAlertDays: "Give at least one positive day threshold.",
    })
  }

  return [...new Set(list)].sort((a, b) => b - a)
}

function pickIdentityMode(
  value: unknown,

  fallback: "manual" | "provider",
): "manual" | "provider" {
  if (value === undefined) return fallback

  if (value === "manual" || value === "provider") return value

  throw badRequest("identity_mode must be manual or provider.", {
    identityMode: "Unknown identity mode.",
  })
}

// --- Identity provider settings ---------------------------------------------

interface IdentityProviderView {
  configured: boolean

  provider: string

  endpoint: string

  credentialHint: string | null

  enabled: boolean

  lastCheckedAt: string | null
}

interface IdentityProviderRow {
  provider: string

  endpoint: string | null

  credential_hint: string | null

  enabled: number

  last_checked_at: string | null
}

function readIdentityProvider(tenantId: string): IdentityProviderView | null {
  const row = get<IdentityProviderRow>(
    `SELECT provider, endpoint, credential_hint, enabled, last_checked_at
       FROM identity_provider_configs
      WHERE tenant_id = ? AND provider <> 'manual'
      ORDER BY updated_at DESC
      LIMIT 1`,

    tenantId,
  )

  if (!row) return null

  return {
    configured: true,

    provider: row.provider,

    endpoint: row.endpoint ?? "",

    credentialHint: row.credential_hint,

    enabled: row.enabled === 1,

    lastCheckedAt: row.last_checked_at,
  }
}

/** GET /api/settings/identity-provider — never echoes the credential, only a hint. */

export function getIdentityProvider(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "settings", "view")

  return {
    provider: readIdentityProvider(guarded.tenantId),

    keySource: keySourceLabel(),
  }
}

/**
 * PATCH /api/settings/identity-provider
 *
 * Credentials are write-only: the plaintext never comes back, only a masked hint.
 * A blank credential keeps the stored ciphertext untouched so saving the endpoint
 * does not silently wipe a secret already on file.
 */

export async function patchIdentityProvider(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "settings", "edit")

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const provider =
    typeof body.provider === "string" ? body.provider.trim() : "generic"

  if (provider === "manual") {
    throw badRequest("Choose a real provider to configure.", {
      provider: "manual needs no configuration.",
    })
  }

  if (provider !== "generic" && provider !== "nadra_verisys") {
    throw badRequest("Unknown provider.", { provider: "Unsupported provider." })
  }

  const endpoint = typeof body.endpoint === "string" ? body.endpoint.trim() : ""

  if (endpoint !== "" && !/^https?:\/\//i.test(endpoint)) {
    throw badRequest("The endpoint must be an http(s) URL.", {
      endpoint: "Use a URL starting with http:// or https://.",
    })
  }

  const enabled = body.enabled === undefined ? true : body.enabled === true

  const credential =
    typeof body.credential === "string" && body.credential.trim() !== ""
      ? body.credential.trim()
      : null

  const existing = get<{ credentials_enc: string | null }>(
    `SELECT credentials_enc FROM identity_provider_configs
      WHERE tenant_id = ? AND provider = ?`,

    guarded.tenantId,

    provider,
  )

  const credentialsEnc =
    credential !== null
      ? encryptSecret(credential)
      : (existing?.credentials_enc ?? null)

  const hint =
    credential !== null
      ? maskTail(credential)
      : readIdentityHint(guarded.tenantId, provider)

  const stamp = now()

  run(
    `INSERT INTO identity_provider_configs (
        id, tenant_id, provider, endpoint, credentials_enc, credential_hint,
        enabled, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(tenant_id, provider) DO UPDATE SET
        endpoint = excluded.endpoint,
        credentials_enc = excluded.credentials_enc,
        credential_hint = excluded.credential_hint,
        enabled = excluded.enabled,
        updated_at = excluded.updated_at`,

    `ipc_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`,

    guarded.tenantId,

    provider,

    endpoint,

    credentialsEnc,

    hint,

    enabled ? 1 : 0,

    stamp,

    stamp,
  )

  writeAudit(
    guarded,

    "settings.identity_provider_updated",

    "tenant",

    guarded.tenantId,

    { provider, enabled, credentialChanged: credential !== null },

    ctx.ip,
  )

  return { provider: readIdentityProvider(guarded.tenantId) }
}

/** POST /api/settings/identity-provider/test — a real round-trip, honestly reported. */

export async function testIdentityProvider(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "settings", "edit")

  const config = loadIdentityProviderConfig(guarded.tenantId)

  if (!config) {
    return { ok: false, message: "No enabled provider is configured." }
  }

  const provider = resolveIdentityProvider(config)

  // A deliberately invalid probe: a manual provider (or a misconfigured one that

  // resolves to manual) answers null, which we report as "not reachable" rather

  // than pretending a check succeeded.

  const result = await provider

    .verify({ cnic: "0000000000000", name: null, dob: null })

    .catch(() => null)

  const stamp = now()

  run(
    `UPDATE identity_provider_configs SET last_checked_at = ?
      WHERE tenant_id = ? AND provider = ?`,

    stamp,

    guarded.tenantId,

    config.id,
  )

  writeAudit(
    guarded,

    "settings.identity_provider_tested",

    "tenant",

    guarded.tenantId,

    { provider: config.id, answered: result !== null },

    ctx.ip,
  )

  if (!result) {
    return { ok: false, message: "The provider did not answer a test check." }
  }

  return {
    ok: result.ok,

    message: result.ok
      ? "The provider answered the test check."
      : "The provider rejected the test check.",
  }
}

function readIdentityHint(tenantId: string, provider: string): string | null {
  return (
    get<{ credential_hint: string | null }>(
      `SELECT credential_hint FROM identity_provider_configs
        WHERE tenant_id = ? AND provider = ?`,

      tenantId,

      provider,
    )?.credential_hint ?? null
  )
}

function maskTail(secret: string): string {
  const tail = secret.slice(-4)

  return `****${tail}`
}

function keySourceLabel(): string {
  // The settings screen may learn *where* the data key comes from (env vs the

  // generated on-disk fallback) so an operator sees they are on the convenience

  // key, but never the key itself.

  return process.env.ENCRYPTION_KEY && process.env.ENCRYPTION_KEY.trim() !== ""
    ? "env"
    : "file"
}

// --- Catalogue admin --------------------------------------------------------

/** GET /api/document-types — the resolved catalogue for the admin editor. */

export function listDocumentTypes(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "settings", "view")

  const catalogue = loadResolvedCatalogue(guarded.tenantId)

  return {
    types: catalogue.map((item) => ({
      key: item.key,

      label: item.label,

      baseDocType: item.baseDocType,

      sensitive: item.sensitive,

      ocr: item.ocr,

      trackExpiry: item.trackExpiry,

      sortOrder: item.sortOrder,

      enabled: item.enabled,

      required: item.required,
    })),

    canEdit: guarded.can("settings", "edit"),
  }
}

/**
 * PATCH /api/document-types/:key — a tenant override of label, bucket, flags,
 * enabled, and required-ness per customer type. Stored as an override row; the
 * shared default still supplies anything left unset.
 */

export async function patchDocumentType(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "settings", "edit")

  const key = ctx.params.key

  if (!key || key.trim() === "") {
    throw badRequest("No document type given.", { key: "Required." })
  }

  const resolved = resolveCatalogType(guarded.tenantId, key)

  if (!resolved) {
    throw notFound("That document type is not in the catalogue")
  }

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const label =
    typeof body.label === "string" && body.label.trim() !== ""
      ? body.label.trim().slice(0, 120)
      : resolved.label

  const baseDocType = isDocumentType(body.baseDocType)
    ? body.baseDocType as DocumentType
    : resolved.baseDocType

  const sensitive = pickBool(body.sensitive, resolved.sensitive)

  const ocr = pickBool(body.ocr, resolved.ocr)

  const trackExpiry = pickBool(body.trackExpiry, resolved.trackExpiry)

  const enabled = pickBool(body.enabled, resolved.enabled)

  const sortOrder =
    body.sortOrder === undefined
      ? resolved.sortOrder
      : clampInt(body.sortOrder, 0, 9999, resolved.sortOrder)

  const stamp = now()

  run(
    `INSERT INTO document_type_catalog (
        id, tenant_id, key, label, base_doc_type, sensitive, ocr, track_expiry,
        sort_order, enabled
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(tenant_id, key) DO UPDATE SET
        label = excluded.label,
        base_doc_type = excluded.base_doc_type,
        sensitive = excluded.sensitive,
        ocr = excluded.ocr,
        track_expiry = excluded.track_expiry,
        sort_order = excluded.sort_order,
        enabled = excluded.enabled`,

    `dtc_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`,

    guarded.tenantId,

    key,

    label,

    baseDocType,

    sensitive ? 1 : 0,

    ocr ? 1 : 0,

    trackExpiry ? 1 : 0,

    sortOrder,

    enabled ? 1 : 0,
  )

  if (body.required && typeof body.required === "object") {
    const requiredMap = body.required as Record<string, unknown>

    for (const customerType of [
      "individual",
      "company",
      "overseas_pakistani",
    ] as CustomerType[]) {
      if (!isCustomerType(customerType)) continue

      const raw = requiredMap[customerType]

      if (raw === undefined) continue

      const required = raw === true

      run(
        `INSERT INTO document_type_requirements (
            id, tenant_id, type_key, customer_type, required, min_count,
            updated_at, updated_by
          ) VALUES (?, ?, ?, ?, ?, 1, ?, ?)
          ON CONFLICT(tenant_id, type_key, customer_type) DO UPDATE SET
            required = excluded.required,
            updated_at = excluded.updated_at,
            updated_by = excluded.updated_by`,

        `dtr_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`,

        guarded.tenantId,

        key,

        customerType,

        required ? 1 : 0,

        stamp,

        guarded.session.user.fullName,
      )
    }
  }

  writeAudit(
    guarded,

    "document_types.updated",

    "document_type",

    key,

    { enabled, baseDocType, sensitive },

    ctx.ip,
  )

  return {
    type: {
      key,
      label,
      baseDocType,
      sensitive,
      ocr,
      trackExpiry,
      sortOrder,
      enabled,
    },
  }
}

function clampInt(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  const n = Number(value)

  if (!Number.isFinite(n)) return fallback

  return Math.max(min, Math.min(max, Math.floor(n)))
}
