/**
 * Document vocabulary: what a stored file is, and who may see each kind.
 *
 * A document is a file that belongs to something — a project, a unit, a
 * customer, or a booking — tagged with the reason it exists. The tag is not
 * decoration: it is the access control. An ID copy and a signed sale agreement
 * sit on the same two tables, but the desk that may read one is not the desk
 * that may read the other, so each type carries the permission that unlocks it
 * rather than leaving that judgement scattered across the route handlers.
 *
 * Documents carry their bytes (base64, as an attachment does) and may carry an
 * expiry. An expiry is advisory, never a lock: an expired ID copy still reads
 * for somebody entitled to read it, but says plainly that the copy on file is no
 * longer current. Hiding it would leave a compliance officer unable to see that
 * the file needs renewing.
 */

export const DOCUMENT_ENTITY_TYPES = [
  "project",

  "unit",

  "customer",

  "booking",
] as const

export type DocumentEntityType = typeof DOCUMENT_ENTITY_TYPES[number]

export const DOCUMENT_ENTITY_TYPE_LABELS: Record<DocumentEntityType, string> = {
  project: "Project",

  unit: "Unit",

  customer: "Customer",

  booking: "Booking",
}

export function isDocumentEntityType(
  value: unknown,
): value is DocumentEntityType {
  return (
    typeof value === "string" &&
    (DOCUMENT_ENTITY_TYPES as readonly string[]).includes(value)
  )
}

export const DOCUMENT_TYPES = [
  "agreement",

  "booking_form",

  "id_copy",

  "receipt",

  "invoice",

  "other",
] as const

export type DocumentType = typeof DOCUMENT_TYPES[number]

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  agreement: "Agreement",

  booking_form: "Booking form",

  id_copy: "ID copy",

  receipt: "Receipt",

  invoice: "Invoice",

  other: "Other",
}

export const DOCUMENT_TYPE_HINTS: Record<DocumentType, string> = {
  agreement: "Signed sale agreements and addenda",

  booking_form: "The completed booking application",

  id_copy: "Passport, Emirates ID, or trade licence copies",

  receipt: "Payment receipts issued to the buyer",

  invoice: "Invoices, mainly supplier invoices on a project",

  other: "Anything that does not fit a listed type",
}

export const DOCUMENT_TYPE_TONES: Record<DocumentType, "info" | "outline" | "pending" | "success" | "danger"> =
  {
    agreement: "info",

    booking_form: "outline",

    id_copy: "pending",

    receipt: "success",

    invoice: "info",

    other: "outline",
  }

export function isDocumentType(value: unknown): value is DocumentType {
  return (
    typeof value === "string" &&
    (DOCUMENT_TYPES as readonly string[]).includes(value)
  )
}

/**
 * The fixed per-type access map.
 *
 * `viewPermission` is the grant a reader must hold *in addition* to
 * `documents.view` before this document's contents will be released — that
 * baseline stops a role with no document module at all from tripping over the
 * per-type gates, and the per-type gate stops an accounts officer from reading a
 * customer's passport the way they read a receipt. `customerVisible` decides
 * whether the customer portal surfaces the type at all; an ID copy stays
 * internal, a receipt does not.
 */

export interface DocumentTypePolicy {
  viewPermission: string

  manageModules: string[]

  customerVisible: boolean
}

export const DOCUMENT_TYPE_ACCESS: Record<DocumentType, DocumentTypePolicy> = {
  agreement: {
    viewPermission: "bookings.view",

    manageModules: ["bookings"],

    customerVisible: true,
  },

  booking_form: {
    viewPermission: "bookings.view",

    manageModules: ["bookings"],

    customerVisible: true,
  },

  id_copy: {
    viewPermission: "customers.edit",

    manageModules: ["customers"],

    customerVisible: false,
  },

  receipt: {
    viewPermission: "payments.view",

    manageModules: ["payments"],

    customerVisible: true,
  },

  invoice: {
    viewPermission: "vendors.view",

    manageModules: ["vendors", "expenses"],

    customerVisible: false,
  },

  other: {
    viewPermission: "documents.view",

    manageModules: ["documents"],

    customerVisible: false,
  },
}

/** Cap on stored bytes per document, mirroring the attachment style. */

export const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024

/** Cap on documents attached to any single entity. */

export const DOCUMENT_MAX_PER_ENTITY = 20

export const DOCUMENT_ALLOWED_MIMES = [
  "image/png",

  "image/jpeg",

  "application/pdf",
] as const

export type DocumentMime = typeof DOCUMENT_ALLOWED_MIMES[number]

export function isAllowedDocumentMime(value: unknown): value is DocumentMime {
  return (
    typeof value === "string" &&
    (DOCUMENT_ALLOWED_MIMES as readonly string[]).includes(value)
  )
}

export const DOCUMENT_FILENAME_MAX = 180

export const DOCUMENT_TITLE_MAX = 160

/** Body cap for a base64 upload plus its JSON envelope. */

export const DOCUMENT_MAX_REQUEST_BYTES =
  Math.ceil(DOCUMENT_MAX_BYTES * 1.4) + 64 * 1024

/** A stored document, still without its bytes. */

export interface Document {
  id: string

  entityType: DocumentEntityType

  entityId: string

  docType: DocumentType

  title: string

  filename: string

  mime: string

  sizeBytes: number

  expiresAt: string | null

  uploadedByUserId: string

  uploadedByName: string

  createdAt: string

  updatedAt: string
}

/**
 * A document as the entity section lists it.
 *
 * The three flags are computed server-side because the answer depends on the
 * caller's grants, not on the row: `canView` decides whether the stream endpoint
 * will serve this file, and `canManage` decides whether delete is offered. A
 * client that re-derived them would drift from the route the first time a
 * per-type gate moved.
 */

export interface DocumentSummary extends Document {
  docTypeLabel: string

  canView: boolean

  canManage: boolean

  isExpired: boolean

  customerVisible: boolean
}

/** A document as the customer portal lists it — no uploader, no management. */

export interface PortalDocument {
  id: string

  docType: DocumentType

  title: string

  filename: string

  mime: string

  sizeBytes: number

  expiresAt: string | null

  isExpired: boolean

  createdAt: string

  /** The booking this document hangs off, so the portal can group by property. */

  bookingReference: string | null
}

// --- Manual verification ----------------------------------------------------

/**
 * The three states a file can be in, and the words for them.
 *
 * 'unverified' is the state of a document nobody has opened and certified yet — including
 * every document uploaded before this feature existed, which is why it is the column's
 * default rather than something a job has to fill in. It is deliberately not called
 * 'pending': nothing is going to happen on its own here. And 'verified' always names the
 * person and the day, never a registry, because the platform has no way to reach one.
 */

export const DOCUMENT_VERIFICATION_STATUSES = [
  "unverified",

  "verified",

  "rejected",
] as const

export type DocumentVerificationStatus = typeof DOCUMENT_VERIFICATION_STATUSES[number]

export const DOCUMENT_VERIFICATION_LABELS: Record<DocumentVerificationStatus, string> =
  {
    unverified: "Not verified yet",

    verified: "Manually verified",

    rejected: "Rejected",
  }

/**
 * The tone per state, and the one colour rule this feature lives by.
 *
 * 'Manually verified' is not green. Green on this platform means *done*, which is exactly
 * the claim a human certification is not entitled to make about a photocopy — so the
 * badge is neutral `outline` and the weight goes on the sentence beside it: who, when.
 * A rejection is the only red, and an unverified file is amber like anything else waiting
 * for a person.
 */

export const DOCUMENT_VERIFICATION_TONES: Record<DocumentVerificationStatus, "outline" | "pending" | "danger"> =
  {
    unverified: "pending",

    verified: "outline",

    rejected: "danger",
  }

export const DOCUMENT_VERIFICATION_HINTS: Record<DocumentVerificationStatus, string> =
  {
    unverified: "Uploaded, but no one has opened it and certified it.",

    verified: "A person opened this file and confirmed what it is.",

    rejected: "A person opened this file and sent it back with a reason.",
  }

export function isDocumentVerificationStatus(
  value: unknown,
): value is DocumentVerificationStatus {
  return (
    typeof value === "string" &&
    (DOCUMENT_VERIFICATION_STATUSES as readonly string[]).includes(value)
  )
}

/** Standing sentence under every verification stamp. It never claims more than it knows. */

export const VERIFICATION_DISCLAIMER =
  "Uploaded and verified by hand. Not checked against any government record."

export const DOCUMENT_REJECT_REASON_MAX = 400

export const DOCUMENT_NOTE_MAX = 500

const MONTH_ABBREVIATIONS = [
  "Jan",

  "Feb",

  "Mar",

  "Apr",

  "May",

  "Jun",

  "Jul",

  "Aug",

  "Sep",

  "Oct",

  "Nov",

  "Dec",
]

/**
 * "31 Oct 2026" from an ISO timestamp or a `YYYY-MM-DD` date. A bare ISO date is what a
 * certificate looks like to an officer; the day-month-year form is what the paper file
 * says, and this is the only place the choice is made.
 */

export function formatDocumentDay(
  value: string | null | undefined,
): string | null {
  if (!value) return null

  const day = value.slice(0, 10)

  const [year, month, date] = day.split("-").map(Number)

  if (!year || !month || !date || month < 1 || month > 12) return day

  return `${String(date).padStart(2, "0")} ${MONTH_ABBREVIATIONS[month - 1]} ${year}`
}

/**
 * The stamp itself, spelled out.
 *
 * Names the verifier and the day because those are the two facts a later reader can act
 * on: who to ask, and how old the look was. Null for an unverified file — there is nothing
 * to report, and "—" beside it is the honest cell.
 */

export function verificationStatement(
  status: DocumentVerificationStatus,

  verifiedByName: string | null | undefined,

  verifiedAt: string | null | undefined,
): string | null {
  if (status === "unverified" || !verifiedByName) return null

  const day = formatDocumentDay(verifiedAt)

  return day
    ? `Manually verified by ${verifiedByName} on ${day}`
    : `Manually verified by ${verifiedByName}`
}

/** A file opened through a short-lived grant, and how long the link stays alive. */

export const FILE_ACCESS_TTL_SECONDS = 120

/**
 * How often one grant may be redeemed.
 *
 * A download is handed over once — the file is then the reader's, and a second redemption
 * of the same URL would only mean the link outlived its purpose. A view is opened again
 * while somebody reads it, so a small number of uses is allowed before the link dies.
 */

export const FILE_ACCESS_MAX_USES: Record<"view" | "download", number> = {
  view: 3,

  download: 1,
}

export const FILE_ACCESS_PURPOSES = ["view", "download"] as const

export type FileAccessPurpose = typeof FILE_ACCESS_PURPOSES[number]

export function isFileAccessPurpose(
  value: unknown,
): value is FileAccessPurpose {
  return (
    typeof value === "string" &&
    (FILE_ACCESS_PURPOSES as readonly string[]).includes(value)
  )
}
