/**
 * The customer portal: a *scoped* read of data the staff app already holds.
 *
 * Every handler here begins the same way — resolve the session user's linked
 * `customers` profiles through `customer_portal_links`, and refuse (403) when the
 * login has none. From that point every query is filtered to `customer_id IN
 * (those profiles)` and nothing else. The portal is not a new source of truth: it
 * is the same bookings, the same schedule, the same ledger and files, narrowed to
 * one buyer's own account.
 *
 * This file exists to close a specific leak. The `customer` role once held
 * tenant-wide `bookings.view` and `payments.view`, so any buyer with a session
 * could read every other buyer's records through the staff API. That role now
 * holds no staff grants; the reads below are authorized by the link table, not by
 * a permission row, so a customer with no linked profile simply sees nothing.
 *
 * There are also two staff endpoints at the foot of the file, gated on
 * `customers.edit`, for the "Portal access" control on the customer detail page —
 * who may read this account. They are the only place a link is written.
 */

import {
  DOCUMENT_ALLOWED_MIMES,
  DOCUMENT_FILENAME_MAX,
  DOCUMENT_MAX_BYTES,
  DOCUMENT_MAX_REQUEST_BYTES,
  DOCUMENT_TITLE_MAX,
  DOCUMENT_TYPE_ACCESS,
  type DocumentType,
  type PortalDocument,
} from "../../shared/documents.ts"

import {
  DEFAULT_CATALOG_BY_KEY,
  type DocumentChecklistState,
} from "../../shared/document-verification.ts"

import {
  buildDocumentChecklist,
  loadResolvedCatalogue,
} from "../document-verification-core.ts"

import {
  PORTAL_NAV_KEYS,
  PORTAL_NAV_LABELS,
  type PortalAccessState,
  type PortalAccessUser,
  type PortalDocumentChecklist,
  type PortalDocumentChecklistEntry,
  type PortalDocumentStatus,
  type PortalOverview,
  type PortalPaymentLine,
  type PortalPaymentPhase,
  type PortalPayments,
  type PortalProfile,
  type PortalReceipt,
  type PortalRequestAttachment,
  type PortalRequestComment,
  type PortalRequestDetail,
  type PortalRequestSummary,
  type PortalRequestsResponse,
} from "../../shared/portal.ts"

import {
  TICKET_ATTACHMENT_FILENAME_MAX,
  TICKET_ATTACHMENT_MAX_BYTES,
  TICKET_ATTACHMENT_MAX_COUNT,
  TICKET_COMMENT_MAX,
  TICKET_DESCRIPTION_MAX,
  TICKET_PRIORITIES,
  TICKET_SUBJECT_MAX,
  isTicketPriority,
  slaDueBy,
  type TicketPriority,
} from "../../shared/tickets.ts"

import { createHash } from "node:crypto"

import { all, get, run } from "../db.ts"

import {
  badRequest,
  forbidden,
  notFound,
  readJsonBody,
  type RequestContext,
} from "../http.ts"

import { requireAuth, requirePermission, writeAudit } from "../middleware.ts"

import type { GuardedContext } from "../middleware.ts"

import {
  linkedCustomerIds,
  inPlaceholders,
  ticketIsOverdue,
  ticketReference,
} from "../tickets-shared.ts"

const now = () => new Date().toISOString()

const today = () => new Date().toISOString().slice(0, 10)

/** Days ahead the "due soon" tile looks forward. */

const DUE_SOON_WINDOW_DAYS = 30

/** The document types a customer is ever allowed to see, from the access map. */

const CUSTOMER_VISIBLE_TYPES: DocumentType[] = (Object.keys(
  DOCUMENT_TYPE_ACCESS,
) as DocumentType[])

  .filter((type) => DOCUMENT_TYPE_ACCESS[type].customerVisible)

/**
 * Resolves the caller to their linked customer profiles.
 *
 * The 403 on an empty link set is the whole of the portal's authorization model:
 * it is deliberately a 403 rather than a 200-with-nothing, because a buyer who
 * has not been linked yet needs to be told to contact the office, not shown an
 * empty dashboard that looks like "you own nothing".
 */

function resolvePortal(
  ctx: RequestContext,
): {
  guarded: GuardedContext

  customerIds: string[]
} {
  const guarded = requireAuth(ctx)

  const customerIds = linkedCustomerIds(guarded.tenantId, guarded.userId)

  if (customerIds.length === 0) {
    throw forbidden(
      "Your account is not yet linked to a purchase. Contact your sales office to enable portal access.",

      "portal_not_linked",
    )
  }

  return { guarded, customerIds }
}

function tenantCurrency(tenantId: string): string {
  return (
    get<{ currency: string }>(
      `SELECT currency FROM tenants WHERE id = ?`,
      tenantId,
    )?.currency ?? "AED"
  )
}

/** Time-relative reading of an unpaid line; a funded line is simply paid. */

function derivePhase(status: string, dueDate: string): PortalPaymentPhase {
  if (status === "paid") return "paid"

  const date = dueDate.slice(0, 10)

  const current = today()

  if (date < current) return "overdue"

  if (date === current) return "due_today"

  return "upcoming"
}

interface ProfileRow {
  id: string

  full_name: string

  email: string | null

  phone: string

  id_document_type: string | null

  id_document_number: string | null
}

function loadProfiles(
  customerIds: string[],
  tenantId: string,
): PortalProfile[] {
  return all<ProfileRow>(
    `SELECT id, full_name, email, phone, id_document_type, id_document_number
       FROM customers
      WHERE tenant_id = ? AND id IN (${inPlaceholders(customerIds)})
      ORDER BY full_name COLLATE NOCASE`,

    tenantId,

    ...customerIds,
  ).map((row) => ({
    id: row.id,

    fullName: row.full_name,

    email: row.email,

    phone: row.phone,

    idDocumentType: row.id_document_type,

    idDocumentNumber: row.id_document_number,
  }))
}

// --- overview ---------------------------------------------------------------

interface PropertyRow {
  booking_id: string

  booking_reference: string

  status: string

  unit_code: string

  unit_type: string | null

  unit_location: string | null

  project_name: string

  booking_amount: number

  booking_date: string

  total_due: number

  total_paid: number

  next_due_date: string | null

  next_installment_amount: number | null

  document_count: number
}

/**
 * GET /api/portal/overview
 *
 * The landing payload: the buyer's profiles, their properties through bookings,
 * and the aggregate money that frames them. Cancelled bookings are listed but
 * marked, because hiding a cancelled purchase from the person who cancelled it is
 * its own kind of confusing.
 */

export function portalOverview(ctx: RequestContext) {
  const { guarded, customerIds } = resolvePortal(ctx)

  const tenantId = guarded.tenantId

  const placeholders = inPlaceholders(customerIds)

  const currency = tenantCurrency(tenantId)

  const visibleTypes = CUSTOMER_VISIBLE_TYPES

  const typePlaceholders = inPlaceholders(visibleTypes)

  const properties = all<PropertyRow>(
    `SELECT b.id AS booking_id,
            b.reference AS booking_reference,
            b.status,
            b.unit_code,
            u.unit_type,
            u.location AS unit_location,
            p.name AS project_name,
            b.booking_amount,
            b.booking_date,
            (SELECT COALESCE(SUM(i.total), 0)
               FROM payment_installments i
              WHERE i.booking_id = b.id AND i.tenant_id = b.tenant_id) AS total_due,
            (SELECT COALESCE(SUM(i.paid_amount), 0)
               FROM payment_installments i
              WHERE i.booking_id = b.id AND i.tenant_id = b.tenant_id) AS total_paid,
            (SELECT i.due_date
               FROM payment_installments i
              WHERE i.booking_id = b.id AND i.tenant_id = b.tenant_id AND i.status <> 'paid'
              ORDER BY i.due_date ASC LIMIT 1) AS next_due_date,
            (SELECT i.total - i.paid_amount
               FROM payment_installments i
              WHERE i.booking_id = b.id AND i.tenant_id = b.tenant_id AND i.status <> 'paid'
              ORDER BY i.due_date ASC LIMIT 1) AS next_installment_amount,
            (SELECT COUNT(*)
               FROM documents d
              WHERE d.tenant_id = b.tenant_id
                AND d.entity_type = 'booking'
                AND d.entity_id = b.id
                AND d.doc_type IN (${typePlaceholders})) AS document_count
       FROM bookings b
       JOIN projects p ON p.id = b.project_id AND p.tenant_id = b.tenant_id
       LEFT JOIN inventory_units u ON u.id = b.unit_id AND u.tenant_id = b.tenant_id
      WHERE b.tenant_id = ? AND b.customer_id IN (${placeholders})
      ORDER BY b.created_at DESC`,

    ...visibleTypes,

    tenantId,

    ...customerIds,
  ).map((row) => ({
    bookingId: row.booking_id,

    bookingReference: row.booking_reference,

    status: row.status,

    projectName: row.project_name,

    unitCode: row.unit_code,

    unitType: row.unit_type,

    unitLocation: row.unit_location,

    bookingAmount: row.booking_amount,

    currency,

    bookingDate: row.booking_date,

    totalDue: row.total_due,

    totalPaid: row.total_paid,

    outstanding: Math.max(0, row.total_due - row.total_paid),

    nextDueDate: row.next_due_date,

    nextInstallmentAmount: row.next_installment_amount,

    documentCount: row.document_count,
  }))

  const windowEnd = new Date(
    Date.now() + DUE_SOON_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  )

    .toISOString()

    .slice(0, 10)

  const due = get<{
    due_soon_count: number

    due_soon_amount: number

    overdue_count: number

    overdue_amount: number
  }>(
    `SELECT
        SUM(CASE WHEN i.due_date >= ? AND i.due_date <= ? THEN 1 ELSE 0 END) AS due_soon_count,
        SUM(CASE WHEN i.due_date >= ? AND i.due_date <= ? THEN (i.total - i.paid_amount) ELSE 0 END) AS due_soon_amount,
        SUM(CASE WHEN i.due_date < ? THEN 1 ELSE 0 END) AS overdue_count,
        SUM(CASE WHEN i.due_date < ? THEN (i.total - i.paid_amount) ELSE 0 END) AS overdue_amount
      FROM payment_installments i
      JOIN bookings b ON b.id = i.booking_id AND b.tenant_id = i.tenant_id
     WHERE i.tenant_id = ? AND b.customer_id IN (${placeholders}) AND i.status <> 'paid'`,

    today(),

    windowEnd,

    today(),

    windowEnd,

    today(),

    today(),

    tenantId,

    ...customerIds,
  )

  const openRequests =
    get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM support_tickets
        WHERE tenant_id = ? AND status IN ('open','in_progress')
          AND customer_id IN (${placeholders})`,

      tenantId,

      ...customerIds,
    )?.n ?? 0

  const totalBookingValue = properties.reduce(
    (sum, property) => sum + property.totalDue,

    0,
  )

  const totalPaid = properties.reduce(
    (sum, property) => sum + property.totalPaid,
    0,
  )

  const overview: PortalOverview = {
    profiles: loadProfiles(customerIds, tenantId),

    properties,

    currency,

    totalBookingValue,

    totalPaid,

    totalOutstanding: Math.max(0, totalBookingValue - totalPaid),

    openRequests,

    dueSoonCount: due?.due_soon_count ?? 0,

    dueSoonAmount: due?.due_soon_amount ?? 0,

    overdueCount: due?.overdue_count ?? 0,

    overdueAmount: due?.overdue_amount ?? 0,
  }

  return { ...overview, nav: buildNav() }
}

function buildNav() {
  return PORTAL_NAV_KEYS.map((key) => ({ key, label: PORTAL_NAV_LABELS[key] }))
}

// --- payments ---------------------------------------------------------------

interface ScheduleRow {
  installment_id: string

  booking_id: string

  booking_reference: string

  unit_code: string

  number: number

  kind: string

  due_date: string

  amount: number

  charges: number

  total: number

  paid_amount: number

  status: string

  currency: string
}

/**
 * GET /api/portal/payments
 *
 * The whole schedule across the buyer's bookings, oldest line first, each tagged
 * with a derived phase — plus the receipt trail. The phase is computed at read,
 * never stored, so a line ages from `upcoming` to `overdue` on its own without a
 * job touching it.
 */

export function portalPayments(ctx: RequestContext) {
  const { guarded, customerIds } = resolvePortal(ctx)

  const tenantId = guarded.tenantId

  const placeholders = inPlaceholders(customerIds)

  const currency = tenantCurrency(tenantId)

  const schedule: PortalPaymentLine[] = all<ScheduleRow>(
    `SELECT i.id AS installment_id,
            b.id AS booking_id,
            b.reference AS booking_reference,
            b.unit_code,
            i.number,
            i.kind,
            i.due_date,
            i.amount,
            i.charges,
            i.total,
            i.paid_amount,
            i.status,
            pp.currency
       FROM payment_installments i
       JOIN bookings b ON b.id = i.booking_id AND b.tenant_id = i.tenant_id
       LEFT JOIN payment_plans pp ON pp.booking_id = b.id AND pp.tenant_id = b.tenant_id
      WHERE i.tenant_id = ? AND b.customer_id IN (${placeholders})
      ORDER BY i.due_date ASC, b.reference ASC, i.number ASC`,

    tenantId,

    ...customerIds,
  ).map((row) => {
    const balance = Math.max(0, row.total - row.paid_amount)

    return {
      installmentId: row.installment_id,

      bookingId: row.booking_id,

      bookingReference: row.booking_reference,

      unitCode: row.unit_code,

      number: row.number,

      kind: row.kind,

      dueDate: row.due_date,

      amount: row.amount,

      charges: row.charges,

      total: row.total,

      paidAmount: row.paid_amount,

      balance,

      status: row.status,

      phase: derivePhase(row.status, row.due_date),

      currency: row.currency ?? currency,
    }
  })

  interface ReceiptRow {
    payment_id: string

    receipt_number: string | null

    amount: number

    currency: string

    method: string

    received_at: string

    booking_reference: string | null

    has_document: number
  }

  const receipts: PortalReceipt[] = all<ReceiptRow>(
    `SELECT p.id AS payment_id,
            p.receipt_number,
            p.amount,
            p.currency,
            p.method,
            p.received_at,
            b.reference AS booking_reference,
            (SELECT COUNT(*) FROM documents d
              WHERE d.tenant_id = p.tenant_id AND d.doc_type = 'receipt'
                AND ((d.entity_type = 'booking' AND d.entity_id = p.booking_id)
                  OR (d.entity_type = 'customer' AND d.entity_id = p.customer_id))) AS has_document
       FROM payments p
       LEFT JOIN bookings b ON b.id = p.booking_id AND b.tenant_id = p.tenant_id
      WHERE p.tenant_id = ? AND p.customer_id IN (${placeholders})
      ORDER BY p.received_at DESC`,

    tenantId,

    ...customerIds,
  ).map((row) => ({
    paymentId: row.payment_id,

    receiptNumber: row.receipt_number,

    amount: row.amount,

    currency: row.currency,

    method: row.method,

    receivedAt: row.received_at,

    bookingReference: row.booking_reference,

    hasDocument: row.has_document > 0,
  }))

  const totalDue = schedule.reduce((sum, line) => sum + line.total, 0)

  const totalPaid = schedule.reduce((sum, line) => sum + line.paidAmount, 0)

  const payments: PortalPayments = {
    schedule,

    receipts,

    currency,

    totalDue,

    totalPaid,

    outstanding: Math.max(0, totalDue - totalPaid),

    overdueCount: schedule.filter((line) => line.phase === "overdue").length,
  }

  return payments
}

// --- documents --------------------------------------------------------------

interface DocumentRow {
  id: string

  doc_type: string

  title: string

  filename: string

  mime: string

  size_bytes: number

  expires_at: string | null

  created_at: string

  entity_type: string

  entity_id: string

  booking_reference: string | null
}

/**
 * GET /api/portal/documents
 *
 * Only customer-visible types (from `DOCUMENT_TYPE_ACCESS`), and only those filed
 * against the buyer's own entities — their customer profile or one of their
 * bookings. An ID copy or a vendor invoice never surfaces here, because the type
 * map marks them not customer-visible, and this handler trusts that map rather
 * than re-deciding it.
 */

export function portalDocuments(ctx: RequestContext) {
  const { guarded, customerIds } = resolvePortal(ctx)

  const tenantId = guarded.tenantId

  const placeholders = inPlaceholders(customerIds)

  const bookingIds = all<{ id: string }>(
    `SELECT id FROM bookings WHERE tenant_id = ? AND customer_id IN (${placeholders})`,

    tenantId,

    ...customerIds,
  ).map((row) => row.id)

  if (CUSTOMER_VISIBLE_TYPES.length === 0)
    return { documents: [] as PortalDocument[] }

  const typePlaceholders = inPlaceholders(CUSTOMER_VISIBLE_TYPES)

  const ownership =
    bookingIds.length > 0
      ? `(entity_type = 'customer' AND entity_id IN (${placeholders}))
         OR (entity_type = 'booking' AND entity_id IN (${inPlaceholders(bookingIds)}))`
      : `(entity_type = 'customer' AND entity_id IN (${placeholders}))`

  const rows = all<DocumentRow>(
    `SELECT id, doc_type, title, filename, mime, size_bytes, expires_at, created_at,
            entity_type, entity_id,
            CASE WHEN entity_type = 'booking' THEN
              (SELECT b.reference FROM bookings b
                WHERE b.tenant_id = documents.tenant_id AND b.id = documents.entity_id)
            END AS booking_reference
       FROM documents
      WHERE tenant_id = ?
        AND doc_type IN (${typePlaceholders})
        AND (${ownership})
      ORDER BY created_at DESC`,

    tenantId,

    ...CUSTOMER_VISIBLE_TYPES,

    ...customerIds,

    ...(bookingIds.length > 0 ? bookingIds : []),
  )

  const documents: PortalDocument[] = rows.map((row) => ({
    id: row.id,

    docType: row.doc_type as DocumentType,

    title: row.title,

    filename: row.filename,

    mime: row.mime,

    sizeBytes: row.size_bytes,

    expiresAt: row.expires_at,

    isExpired: row.expires_at !== null && row.expires_at < today(),

    createdAt: row.created_at,

    bookingReference: row.booking_reference,
  }))

  return { documents }
}

/**
 * GET /api/portal/documents/:id/file
 *
 * Streams a customer-visible document the buyer owns. This is the portal's own
 * file route rather than a pass-through to `/api/documents/:id/file`, because the
 * staff route gates on `documents.view` — a grant a buyer does not and should not
 * hold. Ownership here is re-checked against the same rules as the list, so an id
 * for a document belonging to someone else reads as absent.
 */

export function portalDocumentFile(ctx: RequestContext) {
  const { guarded, customerIds } = resolvePortal(ctx)

  const tenantId = guarded.tenantId

  const row = get<DocumentRow & { data: string }>(
    `SELECT id, doc_type, title, filename, mime, size_bytes, expires_at, created_at,
            entity_type, entity_id, NULL AS booking_reference, data
       FROM documents WHERE tenant_id = ? AND id = ?`,

    tenantId,

    ctx.params.id!,
  )

  if (!row) throw notFound("That document does not exist")

  if (
    !CUSTOMER_VISIBLE_TYPES.includes(row.doc_type as DocumentType) ||
    !ownsPortalEntity(tenantId, customerIds, row.entity_type, row.entity_id)
  ) {
    throw notFound("That document does not exist")
  }

  const commaIndex = row.data.indexOf(",")

  const buffer = Buffer.from(
    commaIndex >= 0 ? row.data.slice(commaIndex + 1) : row.data,

    "base64",
  )

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

/** True when the entity belongs to one of the caller's linked profiles. */

function ownsPortalEntity(
  tenantId: string,

  customerIds: string[],

  entityType: string,

  entityId: string,
): boolean {
  if (entityType === "customer") return customerIds.includes(entityId)

  if (entityType === "booking") {
    return (
      get<{ id: string }>(
        `SELECT id FROM bookings WHERE tenant_id = ? AND id = ? AND customer_id IN (${inPlaceholders(
          customerIds,
        )})`,

        tenantId,

        entityId,

        ...customerIds,
      ) !== undefined
    )
  }

  // project / unit documents are not the buyer's to read through the portal.

  return false
}

// --- document verification checklist (the buyer's own papers) ---------------

/**
 * Reduces a staff checklist state to the honest portal status a buyer sees.
 *
 * `uploaded` and `under_review` both fold into `pending`: until a person
 * certifies the file, the buyer's answer is the same — the office is reviewing
 * it. A rejection, or an explicit re-upload request against a still-live file,
 * is `needs_reupload`; past expiry is `expired`; nothing on file is `missing`.
 */

function toPortalDocumentStatus(
  state: DocumentChecklistState,

  reuploadRequested: boolean,
): PortalDocumentStatus {
  if (state === "verified") return "verified"

  if (state === "expired") return "expired"

  if (state === "rejected" || reuploadRequested) return "needs_reupload"

  if (state === "missing") return "missing"

  return "pending"
}

/** Picks the linked profile a checklist read or upload concerns. */

function pickLinkedCustomer(
  customerIds: string[],

  requested: unknown,
): string {
  const id = typeof requested === "string" ? requested : ""

  if (id !== "" && customerIds.includes(id)) return id

  return customerIds[0]!
}

/**
 * GET /api/portal/documents/checklist?customerId=…
 *
 * The buyer's own checklist: which papers the office requires, and where each
 * one stands. It reveals no CNIC, no extracted field and no file bytes — only
 * the status a person needs to act on, and the reason when a upload was turned
 * back. It reads the same `buildDocumentChecklist` the staff desk uses, so the
 * percentage the buyer sees is the percentage the desk sees.
 */

export function portalDocumentChecklist(ctx: RequestContext) {
  const { guarded, customerIds } = resolvePortal(ctx)

  const tenantId = guarded.tenantId

  const customerId = pickLinkedCustomer(
    customerIds,
    ctx.query.get("customerId"),
  )

  const checklist = buildDocumentChecklist(tenantId, customerId, today())

  if (!checklist) throw notFound("That customer does not exist")

  const entries: PortalDocumentChecklistEntry[] = checklist.entries.map(
    (entry) => {
      const status = toPortalDocumentStatus(
        entry.state,

        entry.reuploadRequested,
      )

      return {
        key: entry.key,

        label: entry.label,

        hint: DEFAULT_CATALOG_BY_KEY[entry.key]?.hint ?? "",

        required: entry.required,

        status,

        expiresAt: entry.expiresAt,

        rejectReason: status === "needs_reupload" ? entry.rejectReason : null,
      }
    },
  )

  const response: PortalDocumentChecklist = {
    customerId: checklist.customerId,

    customerName: checklist.customerName,

    customerType: checklist.customerType,

    today: checklist.today,

    entries,

    percent: checklist.score.percent,

    canUpload: true,
  }

  return response
}

/**
 * POST /api/portal/documents
 *
 * The buyer uploads one paper against a checklist slot. It is stored with the
 * same base64-in-`documents` shape staff use, marked `source = 'portal'` and
 * dropped into the desk as `under_review` — the portal cannot verify its own
 * upload (there is no verify route here at all), which is the maker-checker rule
 * seen from the other side. The mime and size limits and the duplicate-file
 * fingerprint match the staff upload, so a re-upload of the same bytes is
 * recorded identically however it arrived. Identity fields stay null: no OCR
 * engine, and a self-upload never types a CNIC that would be trusted downstream.
 */

export async function uploadPortalDocument(ctx: RequestContext) {
  const { guarded, customerIds } = resolvePortal(ctx)

  const tenantId = guarded.tenantId

  const body = await readJsonBody<Record<string, unknown>>(
    ctx.req,

    DOCUMENT_MAX_REQUEST_BYTES,
  )

  const customerId = pickLinkedCustomer(customerIds, body.customerId)

  const checklistKey =
    typeof body.checklistKey === "string" ? body.checklistKey.trim() : ""

  if (checklistKey === "") {
    throw badRequest("Choose which document this is.", {
      checklistKey: "Required.",
    })
  }

  const resolved = loadResolvedCatalogue(tenantId).find(
    (type) => type.key === checklistKey && type.enabled,
  )

  if (!resolved) {
    throw badRequest("That document is not on your checklist.", {
      checklistKey: "Unknown type.",
    })
  }

  const title = cleanPortalText(body.title, DOCUMENT_TITLE_MAX, "title")

  const filename = cleanPortalText(
    body.filename,

    DOCUMENT_FILENAME_MAX,

    "filename",
  )

  const dataUrl = typeof body.dataUrl === "string" ? body.dataUrl : ""

  const matched = /^data:([a-z0-9/\-.+]+);base64,(.+)$/i.exec(dataUrl)

  if (!matched) {
    throw badRequest("The file must be a base64 data URL.", {
      dataUrl: "Not a data URL.",
    })
  }

  const mime = matched[1]!.toLowerCase()

  if (!(DOCUMENT_ALLOWED_MIMES as readonly string[]).includes(mime)) {
    throw badRequest(
      `Allowed types: ${DOCUMENT_ALLOWED_MIMES.join(", ")}.`,

      { dataUrl: "Unsupported file type." },
    )
  }

  let bytes: number

  try {
    bytes = Buffer.from(matched[2]!, "base64").length
  } catch {
    throw badRequest("The file data is not valid base64.", {
      dataUrl: "Invalid file.",
    })
  }

  if (bytes === 0) {
    throw badRequest("That file appears to be empty.", { dataUrl: "Empty." })
  }

  if (bytes > DOCUMENT_MAX_BYTES) {
    throw badRequest(
      `That file is too large. The limit is ${Math.floor(DOCUMENT_MAX_BYTES / (1024 * 1024))} MB.`,

      { dataUrl: "Too large." },
    )
  }

  const expiresAt = parsePortalDate(body.expiresAt)

  const sha256 = createHash("sha256")
    .update(Buffer.from(matched[2]!, "base64"))
    .digest("hex")

  const id = `doc_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`

  const stamp = now()

  run(
    `INSERT INTO documents (
        id, tenant_id, entity_type, entity_id, doc_type, title, filename, mime,
        size_bytes, data, expires_at, checklist_key, verification_status,
        uploaded_by_user_id, uploaded_by_name, created_at, updated_at,
        file_sha256, ocr_status, reupload_requested, source
      ) VALUES (?, ?, 'customer', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'under_review',
        ?, ?, ?, ?, ?, 'none', 0, 'portal')`,

    id,

    tenantId,

    customerId,

    resolved.baseDocType,

    title,

    filename,

    mime,

    bytes,

    dataUrl,

    expiresAt,

    checklistKey,

    guarded.userId,

    guarded.session.user.fullName,

    stamp,

    stamp,

    sha256,
  )

  writeAudit(
    guarded,

    "portal.document_uploaded",

    "document",

    id,

    { customerId, checklistKey, bytes },

    ctx.ip,
  )

  const checklist = buildDocumentChecklist(tenantId, customerId, today())

  const entry = checklist?.entries.find((item) => item.key === checklistKey)

  return {
    ok: true,

    documentId: id,

    status: entry
      ? toPortalDocumentStatus(entry.state, entry.reuploadRequested)
      : "pending",
  }
}

function cleanPortalText(
  value: unknown,

  max: number,

  label: string,
): string {
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

function parsePortalDate(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null

  const text = String(value).trim()

  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(text))) {
    throw badRequest("An expiry must be a real date.", {
      expiresAt: "Use the format YYYY-MM-DD.",
    })
  }

  return text
}

// --- requests (support tickets, the customer's own) -------------------------

interface RequestRow {
  id: string

  subject: string

  status: string

  priority: string

  created_at: string

  updated_at: string

  sla_due_by: string

  booking_reference: string | null

  comment_count: number

  last_message: string | null
}

/**
 * GET /api/portal/requests
 *
 * The buyer's tickets, newest activity first, each carrying their own latest
 * message so the list reads like a thread rather than a bare status column.
 */

export function portalRequests(ctx: RequestContext) {
  const { guarded, customerIds } = resolvePortal(ctx)

  const tenantId = guarded.tenantId

  const rows = all<RequestRow>(
    `SELECT t.id, t.subject, t.status, t.priority, t.created_at, t.updated_at, t.sla_due_by,
            b.reference AS booking_reference,
            (SELECT COUNT(*) FROM ticket_comments m WHERE m.tenant_id = t.tenant_id AND m.ticket_id = t.id) AS comment_count,
            (SELECT m.body FROM ticket_comments m
              WHERE m.tenant_id = t.tenant_id AND m.ticket_id = t.id
              ORDER BY m.created_at DESC LIMIT 1) AS last_message
       FROM support_tickets t
       LEFT JOIN bookings b ON b.id = t.booking_id AND b.tenant_id = t.tenant_id
      WHERE t.tenant_id = ? AND t.customer_id IN (${inPlaceholders(customerIds)})
      ORDER BY t.updated_at DESC`,

    tenantId,

    ...customerIds,
  )

  const requests: PortalRequestSummary[] = rows.map((row) => ({
    id: row.id,

    subject: row.subject,

    status: row.status,

    priority: row.priority,

    createdAt: row.created_at,

    updatedAt: row.updated_at,

    slaDueBy: row.sla_due_by,

    isOverdue: ticketIsOverdue(row.status, row.sla_due_by),

    commentCount: row.comment_count,

    bookingReference: row.booking_reference,

    lastMessage: row.last_message,
  }))

  const response: PortalRequestsResponse = {
    requests,

    canRaise: true,
  }

  return { ...response, priorities: [...TICKET_PRIORITIES] }
}

/** Resolves a ticket id to the row, or reports it as absent if not the caller's. */

function loadOwnedTicket(
  tenantId: string,

  customerIds: string[],

  id: string,
): {
  id: string
  customer_id: string
  status: string
  subject: string
} {
  const row = get<{
    id: string

    customer_id: string

    status: string

    subject: string
  }>(
    `SELECT id, customer_id, status, subject FROM support_tickets
      WHERE tenant_id = ? AND id = ? AND customer_id IN (${inPlaceholders(customerIds)})`,

    tenantId,

    id,

    ...customerIds,
  )

  if (!row) throw notFound("That request does not exist")

  return row
}

/**
 * GET /api/portal/requests/:id — the thread the buyer is entitled to read.
 *
 * `nextStatuses` is the customer's own power over the ticket, which is exactly
 * one move: closing a request they consider settled. Everything else — triage,
 * resolution, reassignment — is staff work, and the portal does not pretend the
 * buyer can do it.
 */

export function portalRequestDetail(ctx: RequestContext) {
  const { guarded, customerIds } = resolvePortal(ctx)

  const tenantId = guarded.tenantId

  const ticket = loadOwnedTicket(tenantId, customerIds, ctx.params.id!)

  const comments: PortalRequestComment[] = all<{
    id: string

    author_kind: string

    author_name: string

    body: string

    created_at: string
  }>(
    `SELECT id, author_kind, author_name, body, created_at
       FROM ticket_comments
      WHERE tenant_id = ? AND ticket_id = ?
      ORDER BY created_at ASC`,

    tenantId,

    ticket.id,
  ).map((row) => ({
    id: row.id,

    authorKind: row.author_kind,

    authorName: row.author_name,

    body: row.body,

    createdAt: row.created_at,
  }))

  const attachments: PortalRequestAttachment[] = all<{
    id: string

    filename: string

    mime: string

    size_bytes: number

    uploaded_by_name: string

    uploaded_at: string
  }>(
    `SELECT id, filename, mime, size_bytes, uploaded_by_name, uploaded_at
       FROM ticket_attachments
      WHERE tenant_id = ? AND ticket_id = ?
      ORDER BY uploaded_at ASC`,

    tenantId,

    ticket.id,
  ).map((row) => ({
    id: row.id,

    filename: row.filename,

    mime: row.mime,

    sizeBytes: row.size_bytes,

    uploadedByName: row.uploaded_by_name,

    uploadedAt: row.uploaded_at,
  }))

  const summaryRow = get<RequestRow>(
    `SELECT t.id, t.subject, t.status, t.priority, t.created_at, t.updated_at, t.sla_due_by,
            b.reference AS booking_reference,
            (SELECT COUNT(*) FROM ticket_comments m WHERE m.tenant_id = t.tenant_id AND m.ticket_id = t.id) AS comment_count,
            NULL AS last_message
       FROM support_tickets t
       LEFT JOIN bookings b ON b.id = t.booking_id AND b.tenant_id = t.tenant_id
      WHERE t.tenant_id = ? AND t.id = ?`,

    tenantId,

    ticket.id,
  )!

  const detail: PortalRequestDetail = {
    request: {
      id: summaryRow.id,

      subject: summaryRow.subject,

      status: summaryRow.status,

      priority: summaryRow.priority,

      createdAt: summaryRow.created_at,

      updatedAt: summaryRow.updated_at,

      slaDueBy: summaryRow.sla_due_by,

      isOverdue: ticketIsOverdue(summaryRow.status, summaryRow.sla_due_by),

      commentCount: summaryRow.comment_count,

      bookingReference: summaryRow.booking_reference,

      lastMessage: summaryRow.last_message,
    },

    description:
      get<{ description: string }>(
        `SELECT description FROM support_tickets WHERE tenant_id = ? AND id = ?`,

        tenantId,

        ticket.id,
      )?.description ?? "",

    comments,

    attachments,

    nextStatuses:
      ticket.status === "open" || ticket.status === "in_progress"
        ? ["closed"]
        : [],
  }

  return { ...detail, reference: ticketReference(ticket.id) }
}

/**
 * POST /api/portal/requests — raise a service request.
 *
 * `sla_due_by` is fixed here from the priority and never recomputed, and the
 * ticket records `raised_by = 'customer'` so the staff queue can tell a self-serve
 * request from one an agent logged on the buyer's behalf. A booking may only be
 * attached if it belongs to one of the caller's linked profiles.
 */

export async function createPortalRequest(ctx: RequestContext) {
  const { guarded, customerIds } = resolvePortal(ctx)

  const tenantId = guarded.tenantId

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const subject = typeof body.subject === "string" ? body.subject.trim() : ""

  if (subject === "" || subject.length > TICKET_SUBJECT_MAX) {
    throw badRequest("Give your request a subject.", {
      subject:
        subject === ""
          ? "Required."
          : `Use ${TICKET_SUBJECT_MAX} characters or fewer.`,
    })
  }

  const description =
    typeof body.description === "string" ? body.description.trim() : ""

  if (description.length > TICKET_DESCRIPTION_MAX) {
    throw badRequest("That description is too long.", {
      description: `Use ${TICKET_DESCRIPTION_MAX} characters or fewer.`,
    })
  }

  const priority =
    body.priority === undefined ? "normal" : String(body.priority)

  if (!isTicketPriority(priority)) {
    throw badRequest("Unknown priority.", { priority: "Not a priority." })
  }

  // The ticket must attach to one specific linked profile. When a login maps to

  // several, the request names which purchase it concerns.

  const requestedCustomerId =
    typeof body.customerId === "string" ? body.customerId : ""

  const customerId =
    requestedCustomerId !== "" && customerIds.includes(requestedCustomerId)
      ? requestedCustomerId
      : customerIds[0]!

  const bookingId =
    typeof body.bookingId === "string" && body.bookingId !== ""
      ? body.bookingId
      : null

  if (bookingId !== null) {
    const booking = get<{
      id: string
      customer_id: string
    }>(
      `SELECT id, customer_id FROM bookings WHERE tenant_id = ? AND id = ?`,

      tenantId,

      bookingId,
    )

    if (!booking || !customerIds.includes(booking.customer_id)) {
      throw badRequest("That booking is not on your account.", {
        bookingId: "Choose one of your own bookings.",
      })
    }
  }

  const raisedAt = now()

  const id = `tkt_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`

  const customerName =
    get<{ full_name: string }>(
      `SELECT full_name FROM customers WHERE tenant_id = ? AND id = ?`,

      tenantId,

      customerId,
    )?.full_name ?? guarded.session.user.fullName

  run(
    `INSERT INTO support_tickets (
        id, tenant_id, customer_id, booking_id, subject, description, status,
        priority, assignee_user_id, sla_due_by, raised_by, created_by_user_id,
        created_by_name, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'open', ?, NULL, ?, 'customer', ?, ?, ?, ?)`,

    id,

    tenantId,

    customerId,

    bookingId,

    subject,

    description,

    priority as TicketPriority,

    slaDueBy(raisedAt, priority as TicketPriority),

    guarded.userId,

    customerName,

    raisedAt,

    raisedAt,
  )

  writeAudit(
    guarded,

    "portal.request_created",

    "support_ticket",

    id,

    { customerId, priority, reference: ticketReference(id) },

    ctx.ip,
  )

  return { ok: true, requestId: id, reference: ticketReference(id) }
}

/** POST /api/portal/requests/:id/comments — the buyer replies on their thread. */

export async function addPortalRequestComment(ctx: RequestContext) {
  const { guarded, customerIds } = resolvePortal(ctx)

  const tenantId = guarded.tenantId

  const ticket = loadOwnedTicket(tenantId, customerIds, ctx.params.id!)

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const text = typeof body.body === "string" ? body.body.trim() : ""

  if (text === "" || text.length > TICKET_COMMENT_MAX) {
    throw badRequest("Write a message.", {
      body:
        text === ""
          ? "Required."
          : `Use ${TICKET_COMMENT_MAX} characters or fewer.`,
    })
  }

  const id = `tcm_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`

  const stamp = now()

  run(
    `INSERT INTO ticket_comments (
        id, tenant_id, ticket_id, author_kind, author_user_id, author_name, body, created_at
      ) VALUES (?, ?, ?, 'customer', ?, ?, ?, ?)`,

    id,

    tenantId,

    ticket.id,

    guarded.userId,

    guarded.session.user.fullName,

    text,

    stamp,
  )

  run(
    `UPDATE support_tickets SET updated_at = ? WHERE tenant_id = ? AND id = ?`,

    stamp,

    tenantId,

    ticket.id,
  )

  return { ok: true, commentId: id }
}

/**
 * POST /api/portal/requests/:id/attachments
 *
 * The buyer's side of the same base64 attachment store staff use, with the same
 * limits. Ownership of the parent ticket is checked before anything is read or
 * written, so an id for someone else's request fails exactly as a non-existent
 * one does.
 */

export async function uploadPortalRequestAttachment(ctx: RequestContext) {
  const { guarded, customerIds } = resolvePortal(ctx)

  const tenantId = guarded.tenantId

  const ticket = loadOwnedTicket(tenantId, customerIds, ctx.params.id!)

  const count =
    get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM ticket_attachments WHERE tenant_id = ? AND ticket_id = ?`,

      tenantId,

      ticket.id,
    )?.n ?? 0

  if (count >= TICKET_ATTACHMENT_MAX_COUNT) {
    throw badRequest(
      `A request carries at most ${TICKET_ATTACHMENT_MAX_COUNT} attachments.`,

      { file: `The limit is ${TICKET_ATTACHMENT_MAX_COUNT} files.` },
    )
  }

  const body = await readJsonBody<Record<string, unknown>>(
    ctx.req,

    Math.ceil(TICKET_ATTACHMENT_MAX_BYTES * 1.4) + 64 * 1024,
  )

  const value = body.dataUrl

  if (typeof value !== "string") {
    throw badRequest("The file data is required.", { dataUrl: "Required." })
  }

  const matched = /^data:([a-z0-9/\-.+]+);base64,(.+)$/i.exec(value)

  if (!matched) {
    throw badRequest("The file must be a base64 data URL.", {
      dataUrl: "Not a data URL.",
    })
  }

  const mime = matched[1]!.toLowerCase()

  if (!["image/png", "image/jpeg", "application/pdf"].includes(mime)) {
    throw badRequest("Allowed types: image/png, image/jpeg, application/pdf.", {
      dataUrl: "Unsupported file type.",
    })
  }

  let bytes: number

  try {
    bytes = Buffer.from(matched[2]!, "base64").length
  } catch {
    throw badRequest("The file data is not valid base64.", {
      dataUrl: "Invalid file.",
    })
  }

  if (bytes === 0)
    throw badRequest("That file appears to be empty.", { dataUrl: "Empty." })

  if (bytes > TICKET_ATTACHMENT_MAX_BYTES) {
    throw badRequest("That file is too large. The limit is 10 MB.", {
      dataUrl: "Too large.",
    })
  }

  const filename =
    typeof body.filename === "string" && body.filename.trim() !== ""
      ? body.filename.trim().slice(0, TICKET_ATTACHMENT_FILENAME_MAX)
      : "attachment"

  const id = `tta_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`

  const stamp = now()

  run(
    `INSERT INTO ticket_attachments (
        id, tenant_id, ticket_id, filename, mime, size_bytes, data,
        uploaded_by_user_id, uploaded_by_name, uploaded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,

    id,

    tenantId,

    ticket.id,

    filename,

    mime,

    bytes,

    value,

    guarded.userId,

    guarded.session.user.fullName,

    stamp,
  )

  run(
    `UPDATE support_tickets SET updated_at = ? WHERE tenant_id = ? AND id = ?`,

    stamp,

    tenantId,

    ticket.id,
  )

  return { ok: true, attachmentId: id }
}

/** GET /api/portal/requests/:id/attachments/:attachmentId — the buyer's own file. */

export function downloadPortalRequestAttachment(ctx: RequestContext) {
  const { guarded, customerIds } = resolvePortal(ctx)

  const tenantId = guarded.tenantId

  const ticket = loadOwnedTicket(tenantId, customerIds, ctx.params.id!)

  const row = get<{
    filename: string
    mime: string
    data: string
  }>(
    `SELECT filename, mime, data FROM ticket_attachments
      WHERE tenant_id = ? AND ticket_id = ? AND id = ?`,

    tenantId,

    ticket.id,

    ctx.params.attachmentId!,
  )

  if (!row) throw notFound("That attachment does not exist")

  const commaIndex = row.data.indexOf(",")

  const buffer = Buffer.from(
    commaIndex >= 0 ? row.data.slice(commaIndex + 1) : row.data,

    "base64",
  )

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
 * PATCH /api/portal/requests/:id — the buyer closes their own request.
 *
 * Closing is the one status move a customer may make, and only from an open or
 * in-progress ticket. It is logged as staff work would be, because it changes the
 * same row the queue reads.
 */

export async function updatePortalRequest(ctx: RequestContext) {
  const { guarded, customerIds } = resolvePortal(ctx)

  const tenantId = guarded.tenantId

  const ticket = loadOwnedTicket(tenantId, customerIds, ctx.params.id!)

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  if (String(body.status ?? "") !== "closed") {
    throw badRequest("You can only close a request.", {
      status: "Closing is the only change available.",
    })
  }

  if (ticket.status === "resolved" || ticket.status === "closed") {
    throw badRequest("That request is already concluded.", {
      status: "Nothing to do.",
    })
  }

  run(
    `UPDATE support_tickets SET status = 'closed', updated_at = ?
      WHERE tenant_id = ? AND id = ?`,

    now(),

    tenantId,

    ticket.id,
  )

  writeAudit(
    guarded,

    "portal.request_closed",

    "support_ticket",

    ticket.id,

    {},

    ctx.ip,
  )

  return { ok: true, status: "closed" }
}

// --- staff: portal access management ----------------------------------------

/**
 * GET /api/customers/:id/portal-access — who may read this account.
 *
 * Gated on `customers.edit`, since deciding who sees a buyer's records is a
 * customer-administration act, not a portal one. Returns every tenant user holding
 * the `customer` role (so the office can pick from them) and which are currently
 * linked.
 */

export function getPortalAccess(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "customers", "edit")

  const tenantId = guarded.tenantId

  const customer = get<{ id: string }>(
    `SELECT id FROM customers WHERE tenant_id = ? AND id = ?`,

    tenantId,

    ctx.params.id!,
  )

  if (!customer) throw notFound("That customer does not exist")

  const candidates: PortalAccessUser[] = all<{
    id: string

    email: string

    full_name: string

    status: string
  }>(
    `SELECT u.id, u.email, u.full_name, u.status
       FROM users u
       JOIN tenant_memberships m ON m.user_id = u.id AND m.tenant_id = u.tenant_id
      WHERE u.tenant_id = ? AND m.role_id = 'customer'
      ORDER BY u.full_name COLLATE NOCASE`,

    tenantId,
  ).map((row) => ({
    userId: row.id,

    email: row.email,

    fullName: row.full_name,

    status: row.status,
  }))

  const linkedUserIds = all<{ user_id: string }>(
    `SELECT user_id FROM customer_portal_links WHERE tenant_id = ? AND customer_id = ?`,

    tenantId,

    customer.id,
  ).map((row) => row.user_id)

  const state: PortalAccessState = {
    customerId: customer.id,

    candidates,

    linkedUserIds,

    canManage: guarded.can("customers", "edit"),
  }

  return state
}

/**
 * PUT /api/customers/:id/portal-access — set the linked logins, whole-cloth.
 *
 * Takes the full desired set and reconciles it (insert the new links, delete the
 * removed ones) inside the request, so a client never has to send a
 * grant/revoke verb pair and a half-applied edit is impossible. Every user id is
 * validated to be an active `customer`-role member of this tenant before it is
 * written: a link to a stranger, a staff login, or another tenant's user is
 * refused outright.
 */

export async function putPortalAccess(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "customers", "edit")

  const tenantId = guarded.tenantId

  const customer = get<{ id: string }>(
    `SELECT id FROM customers WHERE tenant_id = ? AND id = ?`,

    tenantId,

    ctx.params.id!,
  )

  if (!customer) throw notFound("That customer does not exist")

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const requested = Array.isArray(body.userIds)
    ? [...new Set(body.userIds.map((value) => String(value)))]
    : []

  if (requested.length > 0) {
    const valid = new Set(
      all<{ id: string }>(
        `SELECT u.id FROM users u
           JOIN tenant_memberships m ON m.user_id = u.id AND m.tenant_id = u.tenant_id
          WHERE u.tenant_id = ? AND m.role_id = 'customer' AND u.status = 'active'
            AND u.id IN (${inPlaceholders(requested)})`,

        tenantId,

        ...requested,
      ).map((row) => row.id),
    )

    for (const userId of requested) {
      if (!valid.has(userId)) {
        throw badRequest("Every linked user must be an active buyer account.", {
          userIds: `"${userId}" is not a valid portal user.`,
        })
      }
    }
  }

  const stamp = now()

  const existing = all<{ user_id: string }>(
    `SELECT user_id FROM customer_portal_links WHERE tenant_id = ? AND customer_id = ?`,

    tenantId,

    customer.id,
  ).map((row) => row.user_id)

  const toRemove = existing.filter((userId) => !requested.includes(userId))

  const toAdd = requested.filter((userId) => !existing.includes(userId))

  for (const userId of toRemove) {
    run(
      `DELETE FROM customer_portal_links
        WHERE tenant_id = ? AND customer_id = ? AND user_id = ?`,

      tenantId,

      customer.id,

      userId,
    )
  }

  for (const userId of toAdd) {
    run(
      `INSERT INTO customer_portal_links (tenant_id, customer_id, user_id, created_at)
       VALUES (?, ?, ?, ?)`,

      tenantId,

      customer.id,

      userId,

      stamp,
    )
  }

  if (toAdd.length > 0 || toRemove.length > 0) {
    writeAudit(
      guarded,

      "portal.access_updated",

      "customer",

      customer.id,

      { added: toAdd, removed: toRemove },

      ctx.ip,
    )
  }

  return { ok: true, linkedUserIds: requested }
}
