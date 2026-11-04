/**
 * Customer portal vocabulary.
 *
 * The portal is a *scoped* view of data the staff application already holds. A
 * logged-in customer is linked, by staff, to one or more `customers` profiles
 * through `customer_portal_links`, and every read the portal offers is filtered
 * to exactly those profiles. Nothing here is a new source of truth — it is the
 * same bookings, the same schedule, the same ledger — narrowed to what one buyer
 * may see about their own account.
 *
 * That narrowing is the point. The `customer` role used to hold tenant-wide
 * `bookings.view` and `payments.view`, which meant a buyer with a session could
 * read every other buyer's records through the staff API. The role now holds no
 * staff grants at all, and the portal routes decide access by the link table
 * rather than by a permission row, so a customer with no linked profile simply
 * sees nothing.
 *
 * `PORTAL_ROLE_IDS` is deliberately not a permission module: it is the single
 * identity rule the portal routes check, and it belongs in code where a reviewer
 * can see it, not in a seedable grants table an administrator could widen.
 */

export const PORTAL_ROLE_IDS = ["customer"] as const

export type PortalRoleId = typeof PORTAL_ROLE_IDS[number]

/** True when a session role may reach the portal at all. */

export function isPortalRole(roleId: unknown): boolean {
  return (
    typeof roleId === "string" &&
    (PORTAL_ROLE_IDS as readonly string[]).includes(roleId)
  )
}

/** The navigation the portal shell renders. A short list on purpose: a buyer
 * needs four places, not the eleven a back-office operator works in. */

export const PORTAL_NAV_KEYS = [
  "overview",

  "payments",

  "documents",

  "requests",
] as const

export type PortalNavKey = typeof PORTAL_NAV_KEYS[number]

export const PORTAL_NAV_LABELS: Record<PortalNavKey, string> = {
  overview: "Overview",

  payments: "Payments",

  documents: "Documents",

  requests: "My requests",
}

/** One customer profile linked to the signed-in login. */

export interface PortalProfile {
  id: string

  fullName: string

  email: string | null

  phone: string

  idDocumentType: string | null

  idDocumentNumber: string | null
}

/** A property the customer holds, read through their bookings. */

export interface PortalProperty {
  bookingId: string

  bookingReference: string

  /** `confirmed` or `cancelled`; a cancelled booking is listed but marked. */

  status: string

  projectName: string

  unitCode: string

  unitType: string | null

  /** Free-text location so a buyer recognises the property without a code. */

  unitLocation: string | null

  bookingAmount: number

  currency: string

  bookingDate: string

  totalDue: number

  totalPaid: number

  outstanding: number

  nextDueDate: string | null

  nextInstallmentAmount: number | null

  documentCount: number
}

/** The portal landing payload. */

export interface PortalOverview {
  profiles: PortalProfile[]

  properties: PortalProperty[]

  currency: string

  totalBookingValue: number

  totalPaid: number

  totalOutstanding: number

  openRequests: number

  /** Instalments falling due inside the reminder window, for the "due soon" tile. */

  dueSoonCount: number

  dueSoonAmount: number

  overdueCount: number

  overdueAmount: number
}

/**
 * One line of the payment schedule.
 *
 * `phase` is the time-relative reading the platform derives at read time and
 * never stores: an unpaid line is `upcoming`, `due_today`, or `overdue` against
 * today, and a funded line is simply `paid`.
 */

export type PortalPaymentPhase = "paid" | "upcoming" | "due_today" | "overdue"

export const PORTAL_PAYMENT_PHASE_LABELS: Record<PortalPaymentPhase, string> = {
  paid: "Paid",

  upcoming: "Upcoming",

  due_today: "Due today",

  overdue: "Overdue",
}

export interface PortalPaymentLine {
  installmentId: string

  bookingId: string

  bookingReference: string

  unitCode: string

  number: number

  kind: string

  dueDate: string

  amount: number

  charges: number

  total: number

  paidAmount: number

  /** `total - paidAmount`, floored at zero: an over-allocation is not a debt. */

  balance: number

  status: string

  phase: PortalPaymentPhase

  currency: string
}

/** A receipt the customer has been issued. */

export interface PortalReceipt {
  paymentId: string

  receiptNumber: string | null

  amount: number

  currency: string

  method: string

  receivedAt: string

  bookingReference: string | null

  /** True when a `documents` receipt file exists, so the row can offer a download. */

  hasDocument: boolean
}

export interface PortalPayments {
  schedule: PortalPaymentLine[]

  receipts: PortalReceipt[]

  currency: string

  totalDue: number

  totalPaid: number

  outstanding: number

  overdueCount: number
}

export interface PortalRequestsResponse {
  requests: PortalRequestSummary[]

  canRaise: boolean
}

export interface PortalRequestSummary {
  id: string

  subject: string

  status: string

  priority: string

  createdAt: string

  updatedAt: string

  slaDueBy: string

  isOverdue: boolean

  commentCount: number

  bookingReference: string | null

  /** The customer's own latest message, so the list reads like a thread. */

  lastMessage: string | null
}

export interface PortalRequestDetail {
  request: PortalRequestSummary

  description: string

  comments: PortalRequestComment[]

  attachments: PortalRequestAttachment[]

  /** Statuses the customer may set themselves; raising closes the ticket is theirs. */

  nextStatuses: string[]
}

export interface PortalRequestComment {
  id: string

  authorKind: string

  authorName: string

  body: string

  createdAt: string
}

export interface PortalRequestAttachment {
  id: string

  filename: string

  mime: string

  sizeBytes: number

  uploadedByName: string

  uploadedAt: string
}

/** Body for `POST /api/portal/requests`. */

export interface PortalRequestInput {
  subject: string

  description: string

  priority: string

  bookingId: string | null
}

/**
 * One staff-visible portal link on a customer profile: who may read this account
 * through the portal, and nothing more.
 */

export interface PortalAccessUser {
  userId: string

  email: string

  fullName: string

  status: string
}

export interface PortalAccessState {
  customerId: string

  /** Tenant users holding the `customer` role, whether linked or not. */

  candidates: PortalAccessUser[]

  /** The users currently linked to this profile. */

  linkedUserIds: string[]

  canManage: boolean
}

// --- Document verification checklist (the buyer's own view) -----------------

/**
 * The portal-facing reduction of a document's checklist state.
 *
 * The staff module tracks six states; a buyer needs the honest four-plus-two
 * that answer only their question, "what do I still owe the office". `pending`
 * folds *uploaded* and *under review* — either way a person has certified
 * nothing yet. `needs_reupload` is a rejection or an explicit re-upload request,
 * and always carries the reason so the buyer can fix the right thing. Nothing
 * here leaks a CNIC, an extracted field, or a raw file URL.
 */

export const PORTAL_DOCUMENT_STATUSES = [
  "verified",

  "pending",

  "needs_reupload",

  "missing",

  "expired",
] as const

export type PortalDocumentStatus = typeof PORTAL_DOCUMENT_STATUSES[number]

export const PORTAL_DOCUMENT_STATUS_LABELS: Record<PortalDocumentStatus, string> =
  {
    verified: "Verified",

    pending: "Under review",

    needs_reupload: "Needs re-upload",

    missing: "Not uploaded",

    expired: "Expired",
  }

/** One checklist slot as the buyer sees it. */

export interface PortalDocumentChecklistEntry {
  key: string

  label: string

  hint: string

  required: boolean

  status: PortalDocumentStatus

  expiresAt: string | null

  /** Present only for `needs_reupload` — the staff reason the buyer must act on. */

  rejectReason: string | null
}

/** The buyer's document checklist for one linked profile, plus the score. */

export interface PortalDocumentChecklist {
  customerId: string

  customerName: string

  customerType: string

  today: string

  entries: PortalDocumentChecklistEntry[]

  /** Percent of required papers verified — the same figure the desk shows. */

  percent: number

  canUpload: boolean
}

/** Body for `POST /api/portal/documents`. */

export interface PortalDocumentUploadInput {
  customerId: string

  checklistKey: string

  title: string

  filename: string

  dataUrl: string

  expiresAt: string | null
}
