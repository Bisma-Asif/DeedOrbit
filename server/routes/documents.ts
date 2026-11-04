/**
 * Documents: files filed against a project, a unit, a customer, or a booking.
 *
 * There is no Documents page. A document is only meaningful beside the record it
 * belongs to, so the surface is an embedded section on the four detail screens
 * and the customer portal — and this route is written to serve exactly those
 * readers. Listing every document in a workspace would be a second, worse search
 * engine over files whose whole purpose is to sit with their parent.
 *
 * The access model has two layers, and both are enforced on every read:
 *
 *   1. `documents.view` — the caller works with documents at all;
 *   2. `DOCUMENT_TYPE_ACCESS[type].viewPermission` — the grant that unlocks that
 *      particular kind of file, so the desk that reads a payment receipt is not
 *      the desk that reads a passport copy.
 *
 * Layer two is checked against the parsed permission id rather than a module
 * string, because the map in `shared/documents.ts` is data: a route that
 * hard-coded six if-statements would drift from it the first time a type moved.
 *
 * The bytes are only ever released by `/api/documents/:id/file`, which re-runs
 * both checks. A summary list carries no data at all, so a leaked list leaks
 * titles — which is why titles are still only listed for types the caller can
 * actually open.
 */

import {
  DOCUMENT_ALLOWED_MIMES,
  DOCUMENT_ENTITY_TYPE_LABELS,
  DOCUMENT_FILENAME_MAX,
  DOCUMENT_MAX_BYTES,
  DOCUMENT_MAX_PER_ENTITY,
  DOCUMENT_MAX_REQUEST_BYTES,
  DOCUMENT_TITLE_MAX,
  DOCUMENT_TYPE_ACCESS,
  DOCUMENT_TYPE_LABELS,
  isDocumentEntityType,
  isDocumentType,
  type DocumentEntityType,
  type DocumentSummary,
  type DocumentType,
} from "../../shared/documents.ts"

import { all, get, run } from "../db.ts"

import {
  badRequest,
  forbidden,
  notFound,
  readJsonBody,
  type RequestContext,
} from "../http.ts"

import { requireAuth, requirePermission, writeAudit } from "../middleware.ts"

import { bookingOwnerUserIds, notifyRecipients } from "../notify.ts"

import type { GuardedContext } from "../middleware.ts"

const now = () => new Date().toISOString()

/** A `module.action` pair, as it appears in the per-type access map. */

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

/**
 * True when the caller holds the grant this document type is gated on.
 *
 * A permission id that does not parse is treated as *not* held: an unreadable
 * map entry must fail closed, not open the file.
 */

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

  uploaded_by_user_id: string

  uploaded_by_name: string

  created_at: string

  updated_at: string
}

/** The parent each entity type maps to, so existence can be checked in one place. */

const ENTITY_TABLES: Record<DocumentEntityType, string> = {
  project: "projects",

  unit: "inventory_units",

  customer: "customers",

  booking: "bookings",
}

function entityExists(
  tenantId: string,

  entityType: DocumentEntityType,

  entityId: string,
): boolean {
  return (
    get<{ id: string }>(
      `SELECT id FROM ${ENTITY_TABLES[entityType]} WHERE tenant_id = ? AND id = ?`,

      tenantId,

      entityId,
    ) !== undefined
  )
}

function toSummary(row: DocumentRow, ctx: GuardedContext): DocumentSummary {
  const docType = row.doc_type as DocumentType

  const policy = DOCUMENT_TYPE_ACCESS[docType]

  const gateHeld = holdsTypePermission(ctx, policy.viewPermission)

  const expiresAt = row.expires_at

  return {
    id: row.id,

    entityType: row.entity_type as DocumentEntityType,

    entityId: row.entity_id,

    docType,

    docTypeLabel: DOCUMENT_TYPE_LABELS[docType],

    title: row.title,

    filename: row.filename,

    mime: row.mime,

    sizeBytes: row.size_bytes,

    expiresAt,

    uploadedByUserId: row.uploaded_by_user_id,

    uploadedByName: row.uploaded_by_name,

    createdAt: row.created_at,

    updatedAt: row.updated_at,

    // The baseline `documents.view` is already enforced by the handler, so a

    // summary is only ever built for someone holding it; what remains is the

    // per-type gate and the edit grant that lets them change or remove the row.

    canView: gateHeld,

    canManage:
      gateHeld &&
      ctx.can("documents", "edit") &&
      ctx.can("documents", "delete"),

    isExpired: expiresAt !== null && expiresAt < now(),

    customerVisible: policy.customerVisible,
  }
}

/**
 * GET /api/documents?entityType=&entityId=
 *
 * Summaries for one entity, newest first, with no bytes in the payload. Rows of
 * a type the caller may not open are dropped rather than listed-then-locked:
 * showing "Sales Agreement — access restricted" would confirm the file exists,
 * which is itself the thing the type gate is for.
 */

export function listDocuments(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "documents", "view")

  const entityType = guarded.query.get("entityType") ?? ""

  const entityId = guarded.query.get("entityId") ?? ""

  if (!isDocumentEntityType(entityType)) {
    throw badRequest(
      "entityType must be one of project, unit, customer, booking",
      {
        entityType: "Unknown entity type.",
      },
    )
  }

  if (entityId === "") {
    throw badRequest("entityId is required", { entityId: "Required." })
  }

  // An entity from another workspace reads as missing, exactly as the rest of

  // the platform answers.

  if (!entityExists(guarded.tenantId, entityType, entityId)) {
    throw notFound(`That ${entityType} does not exist`)
  }

  const rows = all<DocumentRow>(
    `SELECT * FROM documents
      WHERE tenant_id = ? AND entity_type = ? AND entity_id = ?
      ORDER BY created_at DESC`,

    guarded.tenantId,

    entityType,

    entityId,
  )

  return {
    documents: rows

      .map((row) => toSummary(row, guarded))

      .filter((document) => document.canView),

    entityType,

    entityId,

    entityTypeLabel: DOCUMENT_ENTITY_TYPE_LABELS[entityType],

    canCreate: guarded.can("documents", "create"),

    canEdit: guarded.can("documents", "edit"),

    maxPerEntity: DOCUMENT_MAX_PER_ENTITY,
  }
}

/**
 * Parse a `data:mime;base64,...` payload against the closed mime list and the
 * 10 MB cap. Returns the pieces the row needs, or the message a caller puts in a
 * field-keyed 400.
 */

interface ParsedDocumentDataOk {
  ok: true

  mime: string

  dataUrl: string

  bytes: number
}

interface ParsedDocumentDataError {
  ok: false

  error: string
}

function parseDocumentData(
  value: unknown,
): ParsedDocumentDataOk | ParsedDocumentDataError {
  if (typeof value !== "string")
    return { ok: false, error: "The file data is required." }

  const matched = /^data:([a-z0-9/\-.+]+);base64,(.+)$/i.exec(value)

  if (!matched)
    return { ok: false, error: "The file must be a base64 data URL." }

  const mime = matched[1]!.toLowerCase()

  if (!(DOCUMENT_ALLOWED_MIMES as readonly string[]).includes(mime)) {
    return {
      ok: false,
      error: `Allowed types: ${DOCUMENT_ALLOWED_MIMES.join(", ")}.`,
    }
  }

  let bytes: number

  try {
    bytes = Buffer.from(matched[2]!, "base64").length
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

  return { ok: true, mime, dataUrl: value, bytes }
}

function cleanText(value: unknown, max: number, label: string): string {
  const text = typeof value === "string" ? value.trim() : ""

  if (text === "")
    throw badRequest(`Give the document a ${label}.`, { [label]: "Required." })

  if (text.length > max) {
    throw badRequest(`That ${label} is too long.`, {
      [label]: `Use ${max} characters or fewer.`,
    })
  }

  return text
}

/** An optional expiry, validated as a date and stored as `YYYY-MM-DD`. */

function parseExpiry(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null

  const text = String(value).trim()

  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(text) ||
    Number.isNaN(new Date(text).getTime())
  ) {
    throw badRequest("The expiry date must be a real date.", {
      expiresAt: "Use the format YYYY-MM-DD.",
    })
  }

  return text
}

/**
 * POST /api/documents — `{ entityType, entityId, docType, title, expiresAt,
 * filename, dataUrl }`.
 *
 * The per-type gate is applied here as well as on read, and against the *type
 * being filed*: filing an ID copy demands the same grant that reading one does,
 * so a role that could not open a passport copy cannot create one either.
 */

export async function createDocument(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "documents", "create")

  const body = await readJsonBody<Record<string, unknown>>(
    ctx.req,

    DOCUMENT_MAX_REQUEST_BYTES,
  )

  const entityType = body.entityType

  if (!isDocumentEntityType(entityType)) {
    throw badRequest(
      "entityType must be one of project, unit, customer, booking",
      {
        entityType: "Unknown entity type.",
      },
    )
  }

  const entityId = cleanText(body.entityId, 80, "entity id")

  if (!entityExists(guarded.tenantId, entityType, entityId)) {
    throw notFound(`That ${entityType} does not exist`)
  }

  const docType = body.docType

  if (!isDocumentType(docType)) {
    throw badRequest("docType must be one of the document types", {
      docType: "Unknown document type.",
    })
  }

  const policy = DOCUMENT_TYPE_ACCESS[docType]

  if (!holdsTypePermission(guarded, policy.viewPermission)) {
    throw forbidden(
      `Your role does not handle ${DOCUMENT_TYPE_LABELS[docType].toLowerCase()} files.`,

      "permission_denied",
    )
  }

  const title = cleanText(body.title, DOCUMENT_TITLE_MAX, "title")

  const filename = cleanText(body.filename, DOCUMENT_FILENAME_MAX, "filename")

  const expiresAt = parseExpiry(body.expiresAt)

  const count =
    get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM documents
        WHERE tenant_id = ? AND entity_type = ? AND entity_id = ?`,

      guarded.tenantId,

      entityType,

      entityId,
    )?.n ?? 0

  if (count >= DOCUMENT_MAX_PER_ENTITY) {
    throw badRequest(
      `That ${entityType} already carries the maximum of ${DOCUMENT_MAX_PER_ENTITY} documents.`,

      {
        file: `A maximum of ${DOCUMENT_MAX_PER_ENTITY} files is allowed per record.`,
      },
    )
  }

  const parsed = parseDocumentData(body.dataUrl)

  if (!parsed.ok) throw badRequest(parsed.error, { dataUrl: parsed.error })

  const id = `doc_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`

  const stamp = now()

  run(
    `INSERT INTO documents (
        id, tenant_id, entity_type, entity_id, doc_type, title, filename, mime,
        size_bytes, data, expires_at, uploaded_by_user_id, uploaded_by_name,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,

    id,

    guarded.tenantId,

    entityType,

    entityId,

    docType,

    title,

    filename,

    parsed.mime,

    parsed.bytes,

    parsed.dataUrl,

    expiresAt,

    guarded.userId,

    guarded.session.user.fullName,

    stamp,

    stamp,
  )

  writeAudit(
    guarded,

    "documents.created",

    "document",

    id,

    { entityType, entityId, docType, bytes: parsed.bytes },

    ctx.ip,
  )

  // Owner-scoped: a file filed against a booking reaches that booking's owning
  // agent. A file on a project, unit, or customer has no single person who "owns"
  // it, so nothing is invented — those uploads leave only the uploader's audit row.
  notifyRecipients(
    guarded.tenantId,
    entityType === "booking"
      ? bookingOwnerUserIds(guarded.tenantId, entityId)
      : [],
    {
      type: "document_uploaded",
      title: `Document uploaded: ${title}`,
      body: docType,
      linkPath: entityType === "booking" ? `/bookings/${entityId}` : null,
      actorUserId: guarded.userId,
      actorName: guarded.session.user.fullName,
    },
  )

  const created = get<DocumentRow>(
    `SELECT * FROM documents WHERE tenant_id = ? AND id = ?`,

    guarded.tenantId,

    id,
  )!

  return { ok: true, document: toSummary(created, guarded) }
}

/** Loads a document by id, refusing anything outside the caller's workspace. */

function loadDocument(ctx: GuardedContext, id: string): DocumentRow {
  const row = get<DocumentRow>(
    `SELECT * FROM documents WHERE tenant_id = ? AND id = ?`,

    ctx.tenantId,

    id,
  )

  if (!row) throw notFound("That document does not exist")

  return row
}

/**
 * GET /api/documents/:id/file
 *
 * Streams the stored bytes with the mime they were uploaded under, after
 * re-checking the per-type gate. `?download=1` flips the disposition so a
 * preview link and a save-as link can share one endpoint.
 */

export function downloadDocumentFile(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "documents", "view")

  const row = loadDocument(guarded, ctx.params.id!)

  if (!isDocumentType(row.doc_type))
    throw notFound("That document does not exist")

  const policy = DOCUMENT_TYPE_ACCESS[(row.doc_type as DocumentType)]

  if (!holdsTypePermission(guarded, policy.viewPermission)) {
    throw forbidden(
      `Your role does not handle ${DOCUMENT_TYPE_LABELS[(row.doc_type as DocumentType)].toLowerCase()} files.`,

      "permission_denied",
    )
  }

  // The stored value is a data URL; the prefix is dropped and the raw bytes go out.

  const commaIndex = row.data.indexOf(",")

  const base64 = commaIndex >= 0 ? row.data.slice(commaIndex + 1) : row.data

  const buffer = Buffer.from(base64, "base64")

  const disposition =
    ctx.query.get("download") === "1" ? "attachment" : "inline"

  const safeName = row.filename.replace(/["\r\n]/g, "")

  ctx.res.writeHead(200, {
    "Content-Type": row.mime,

    "Content-Length": buffer.byteLength,

    "Content-Disposition": `${disposition}; filename="${safeName}"`,

    "Cache-Control": "private, max-age=60",

    "X-Content-Type-Options": "nosniff",
  })

  ctx.res.end(buffer)
}

/**
 * PATCH /api/documents/:id — title, type, and expiry only.
 *
 * The bytes are immutable: replacing a file's contents under the same id would
 * rewrite history under a reader's feet. A wrong upload is deleted and re-filed,
 * which leaves the audit trail intact.
 */

export async function updateDocument(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "documents", "edit")

  const row = loadDocument(guarded, ctx.params.id!)

  if (!isDocumentType(row.doc_type))
    throw notFound("That document does not exist")

  if (
    !holdsTypePermission(
      guarded,
      DOCUMENT_TYPE_ACCESS[row.doc_type].viewPermission,
    )
  ) {
    throw forbidden(
      "You cannot change this kind of document.",
      "permission_denied",
    )
  }

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const changes: string[] = []

  let title = row.title

  if (body.title !== undefined) {
    title = cleanText(body.title, DOCUMENT_TITLE_MAX, "title")

    changes.push("title")
  }

  let docType = row.doc_type

  if (body.docType !== undefined) {
    if (!isDocumentType(body.docType)) {
      throw badRequest("docType must be one of the document types", {
        docType: "Unknown document type.",
      })
    }

    // Re-tagging a file moves it across the access map, so the destination type

    // has to be one the caller is entitled to hold.

    if (
      !holdsTypePermission(
        guarded,
        DOCUMENT_TYPE_ACCESS[body.docType].viewPermission,
      )
    ) {
      throw forbidden(
        `Your role does not handle ${DOCUMENT_TYPE_LABELS[body.docType].toLowerCase()} files.`,

        "permission_denied",
      )
    }

    docType = body.docType

    changes.push("docType")
  }

  let expiresAt = row.expires_at

  if (body.expiresAt !== undefined) {
    expiresAt = parseExpiry(body.expiresAt)

    changes.push("expiresAt")
  }

  if (changes.length === 0) {
    throw badRequest("Nothing to change.", {
      document: "Send a field to update.",
    })
  }

  run(
    `UPDATE documents
        SET title = ?, doc_type = ?, expires_at = ?, updated_at = ?
      WHERE tenant_id = ? AND id = ?`,

    title,

    docType,

    expiresAt,

    now(),

    guarded.tenantId,

    row.id,
  )

  writeAudit(
    guarded,

    "documents.updated",

    "document",

    row.id,

    { changes, docType },

    ctx.ip,
  )

  const updated = get<DocumentRow>(
    `SELECT * FROM documents WHERE tenant_id = ? AND id = ?`,

    guarded.tenantId,

    row.id,
  )!

  return { ok: true, document: toSummary(updated, guarded) }
}

/** DELETE /api/documents/:id */

export function deleteDocument(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "documents", "delete")

  const row = loadDocument(guarded, ctx.params.id!)

  if (!isDocumentType(row.doc_type))
    throw notFound("That document does not exist")

  if (
    !holdsTypePermission(
      guarded,
      DOCUMENT_TYPE_ACCESS[row.doc_type].viewPermission,
    )
  ) {
    throw forbidden(
      "You cannot remove this kind of document.",
      "permission_denied",
    )
  }

  run(
    `DELETE FROM documents WHERE tenant_id = ? AND id = ?`,
    guarded.tenantId,
    row.id,
  )

  writeAudit(
    guarded,

    "documents.deleted",

    "document",

    row.id,

    { docType: row.doc_type, title: row.title },

    ctx.ip,
  )
}
