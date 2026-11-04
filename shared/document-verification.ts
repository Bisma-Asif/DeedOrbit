/**
 * Customer Document Verification vocabulary.
 *
 * This is the shared data half of the module: the closed state set a document
 * moves through, the admin-configurable document-type catalogue (the platform
 * defaults a workspace overrides per tenant), the expiry-alert ladder, and the
 * per-customer verification score. It is imported by both the API server and the
 * React client, so it holds *no* Node-Only code — the crypto fingerprints and
 * the encrypted storage live on the server, not here.
 *
 * The honesty rules this module is built to make easy:
 *   - "verified" is a human certification. Its tone is deliberately NOT green (see
 *     `shared/documents.ts`), and a green/registry claim only ever comes from a
 *     provider response recorded elsewhere.
 *   - "expired" is computed from a stored date, never guessed.
 *   - a required document with no file is "missing", named by its catalogue key, so
 *     the checklist answers "which paper is absent" rather than showing a count.
 */

// --- Customer types ---------------------------------------------------------

export const CUSTOMER_TYPES = [
  "individual",

  "company",

  "overseas_pakistani",
] as const

export type CustomerType = typeof CUSTOMER_TYPES[number]

export const CUSTOMER_TYPE_LABELS: Record<CustomerType, string> = {
  individual: "Individual",

  company: "Company",

  overseas_pakistani: "Overseas Pakistani",
}

export function isCustomerType(value: unknown): value is CustomerType {
  return (
    typeof value === "string" &&
    (CUSTOMER_TYPES as readonly string[]).includes(value)
  )
}

/** Reads any stored customer-type value defensively; unknown behaves as individual. */

export function resolveCustomerType(
  value: string | null | undefined,
): CustomerType {
  return isCustomerType(value) ? value : "individual"
}

// --- The six checklist states ----------------------------------------------

/**
 * The lifecycle a required document shows on a customer's checklist.
 *
 * `missing` is the absence of any file. `uploaded` is a file a person has not
 * opened yet (the legacy `unverified`), and `under_review` is a file in the
 * verification queue. `verified` names a human, `rejected` carries a reason, and
 * `expired` is derived from a stored expiry date, never inferred.
 */

export const DOCUMENT_CHECKLIST_STATES = [
  "missing",

  "uploaded",

  "under_review",

  "verified",

  "rejected",

  "expired",
] as const

export type DocumentChecklistState = typeof DOCUMENT_CHECKLIST_STATES[number]

export const DOCUMENT_CHECKLIST_STATE_LABELS: Record<DocumentChecklistState, string> =
  {
    missing: "Missing",

    uploaded: "Uploaded",

    under_review: "Under review",

    verified: "Verified",

    rejected: "Rejected",

    expired: "Expired",
  }

/**
 * Badge tones, held to the platform's colour law. Verified is `outline`, not
 * green — a human certification of a photocopy is not the same claim a finished
 * payment makes, and green here would overstate it. Rejected and expired are the
 * only muted reds; anything waiting on a person is amber.
 */

export const DOCUMENT_CHECKLIST_STATE_TONES: Record<DocumentChecklistState, "outline" | "pending" | "success" | "danger"> =
  {
    missing: "outline",

    uploaded: "pending",

    under_review: "pending",

    verified: "outline",

    rejected: "danger",

    expired: "danger",
  }

// --- Stored verification status (the `documents.verification_status` value) ---

export const DOCUMENT_VERIFICATION_STATUSES = [
  "unverified",

  "under_review",

  "verified",

  "rejected",
] as const

export type DocumentVerificationStatus = typeof DOCUMENT_VERIFICATION_STATUSES[number]

export function isDocumentVerificationStatus(
  value: unknown,
): value is DocumentVerificationStatus {
  return (
    typeof value === "string" &&
    (DOCUMENT_VERIFICATION_STATUSES as readonly string[]).includes(value)
  )
}

/** The OCR field-confirmation state on a document row. */

export const DOCUMENT_OCR_STATUSES = [
  "none",

  "suggested",

  "confirmed",

  "failed",
] as const

export type DocumentOcrStatus = typeof DOCUMENT_OCR_STATUSES[number]

/** Where the file came from and how the verification was reached. */

export const DOCUMENT_SOURCES = ["staff", "portal"] as const

export type DocumentSource = typeof DOCUMENT_SOURCES[number]

export const DOCUMENT_VERIFIED_VIA = ["manual", "provider"] as const

export type DocumentVerifiedVia = typeof DOCUMENT_VERIFIED_VIA[number]

// --- State computation ------------------------------------------------------

/** The minimal shape a stored document must present for state computation. */

export interface DocumentStateInput {
  verificationStatus: string | null | undefined

  expiresAt: string | null | undefined

  reuploadRequested: boolean | number | null | undefined
}

/**
 * Collapses the stored columns into one checklist state.
 *
 * Order matters: a rejection is shown as a rejection even on an expired file
 * (the actionable fact is "send it back"), and expiry only overrides a
 * not-yet-terminal state. A past expiry date on any otherwise-live file reads as
 * `expired`. `todayIso` is a `YYYY-MM-DD` in the tenant's day.
 */

export function computeDocumentChecklistState(
  input: DocumentStateInput | null | undefined,

  todayIso: string,
): DocumentChecklistState {
  if (!input) return "missing"

  const status = input.verificationStatus ?? "unverified"

  if (status === "rejected") return "rejected"

  const expired =
    input.expiresAt !== null &&
    input.expiresAt !== undefined &&
    input.expiresAt.slice(0, 10) < todayIso.slice(0, 10)

  if (status === "verified") return expired ? "expired" : "verified"

  // A live file that is out of date is expired regardless of review stage.

  if (expired) return "expired"

  if (status === "under_review") return "under_review"

  return "uploaded"
}

/**
 * Whether a state counts as satisfying a required slot for the booking gate and
 * the score. Only a current, verified file does — an expired certificate is not
 * proof of anything, and an unverified upload has not been certified.
 */

export function stateSatisfiesRequirement(
  state: DocumentChecklistState,
): boolean {
  return state === "verified"
}

// --- The default document-type catalogue ------------------------------------

/** One entry in the document-type catalogue. */

export interface DocumentTypeCatalogItem {
  key: string

  label: string

  baseDocType: "agreement" | "booking_form" | "id_copy" | "receipt" | "invoice" | "other"

  sensitive: boolean

  ocr: boolean

  trackExpiry: boolean

  requiredFor: CustomerType[]

  hint: string

  sortOrder: number
}

/**
 * The platform's default set of customer papers.
 *
 * A tenant may override any field per key (see `document_type_catalog` /
 * `document_type_requirements`); an empty override table means exactly this
 * list. `baseDocType` is the coarse bucket that drives the existing per-type
 * access map — every identity document maps to `id_copy` so it inherits the
 * strict `customers.edit` read gate, and every contract maps to `agreement`.
 */

export const DEFAULT_DOCUMENT_TYPE_CATALOG: DocumentTypeCatalogItem[] = [
  {
    key: "cnic_front",

    label: "CNIC / NICOP / Passport (front)",

    baseDocType: "id_copy",

    sensitive: true,

    ocr: true,

    trackExpiry: true,

    requiredFor: ["individual", "overseas_pakistani"],

    hint: "The face with name, number, and validity dates.",

    sortOrder: 10,
  },

  {
    key: "cnic_back",

    label: "CNIC / NICOP (back)",

    baseDocType: "id_copy",

    sensitive: true,

    ocr: true,

    trackExpiry: true,

    requiredFor: ["individual", "overseas_pakistani"],

    hint: "The side carrying address and father / husband name.",

    sortOrder: 20,
  },

  {
    key: "passport",

    label: "Passport",

    baseDocType: "id_copy",

    sensitive: true,

    ocr: true,

    trackExpiry: true,

    requiredFor: ["overseas_pakistani"],

    hint: "The bio-data page with the photograph and expiry date.",

    sortOrder: 30,
  },

  {
    key: "photograph",

    label: "Photograph",

    baseDocType: "id_copy",

    sensitive: false,

    ocr: false,

    trackExpiry: false,

    requiredFor: ["individual", "company", "overseas_pakistani"],

    hint: "Passport-size photograph for the booking form.",

    sortOrder: 40,
  },

  {
    key: "proof_of_income",

    label: "Proof of income",

    baseDocType: "other",

    sensitive: false,

    ocr: false,

    trackExpiry: false,

    requiredFor: ["individual", "company"],

    hint: "Salary slip, bank statement, or filed accounts.",

    sortOrder: 50,
  },

  {
    key: "utility_bill",

    label: "Utility bill",

    baseDocType: "other",

    sensitive: false,

    ocr: false,

    trackExpiry: false,

    requiredFor: [],

    hint: "Address proof when it differs from the CNIC.",

    sortOrder: 60,
  },

  {
    key: "nominee_cnic",

    label: "Nominee CNIC",

    baseDocType: "id_copy",

    sensitive: true,

    ocr: false,

    trackExpiry: false,

    requiredFor: [],

    hint: "Only when a nominee is named on the form.",

    sortOrder: 70,
  },

  {
    key: "booking_form",

    label: "Booking form",

    baseDocType: "booking_form",

    sensitive: false,

    ocr: false,

    trackExpiry: false,

    requiredFor: ["individual", "company", "overseas_pakistani"],

    hint: "The signed application.",

    sortOrder: 80,
  },

  {
    key: "affidavit",

    label: "Affidavit",

    baseDocType: "agreement",

    sensitive: false,

    ocr: false,

    trackExpiry: false,

    requiredFor: [],

    hint: "Sworn declaration where the deal requires one.",

    sortOrder: 90,
  },

  {
    key: "power_of_attorney",

    label: "Power of attorney",

    baseDocType: "agreement",

    sensitive: false,

    ocr: false,

    trackExpiry: true,

    requiredFor: [],

    hint: "Authority to act for the buyer, if attested.",

    sortOrder: 100,
  },

  {
    key: "allotment_letter",

    label: "Allotment letter",

    baseDocType: "agreement",

    sensitive: false,

    ocr: false,

    trackExpiry: false,

    requiredFor: [],

    hint: "The scheme's allotment confirmation.",

    sortOrder: 110,
  },

  {
    key: "sale_agreement",

    label: "Sale agreement",

    baseDocType: "agreement",

    sensitive: false,

    ocr: false,

    trackExpiry: false,

    requiredFor: ["individual", "company", "overseas_pakistani"],

    hint: "Filed when the agreement is executed.",

    sortOrder: 120,
  },

  {
    key: "registry_transfer_papers",

    label: "Registry / transfer papers",

    baseDocType: "agreement",

    sensitive: false,

    ocr: false,

    trackExpiry: false,

    requiredFor: [],

    hint: "Title and transfer documents at handover.",

    sortOrder: 130,
  },

  {
    key: "bank_cheque_copy",

    label: "Bank cheque copy",

    baseDocType: "other",

    sensitive: false,

    ocr: false,

    trackExpiry: false,

    requiredFor: [],

    hint: "A cleared or post-dated cheque image for the plan.",

    sortOrder: 140,
  },
]

export const DEFAULT_CATALOG_BY_KEY: Record<string, DocumentTypeCatalogItem> =
  DEFAULT_DOCUMENT_TYPE_CATALOG.reduce(
    (acc, item) => {
      acc[item.key] = item

      return acc
    },

    {} as Record<string, DocumentTypeCatalogItem>,
  )

/** Whether this catalogue item is required for a given customer type. */

export function itemRequiredFor(
  item: DocumentTypeCatalogItem,

  customerType: CustomerType,
): boolean {
  return item.requiredFor.includes(customerType)
}

// --- Expiry alert ladder ----------------------------------------------------

/** Descending numeric thresholds parsed from a stored "60,30,7" list. */

export function parseExpiryAlertDays(raw: string | null | undefined): number[] {
  if (!raw) return [60, 30, 7]

  const values = raw

    .split(",")

    .map((part) => Number(part.trim()))

    .filter((n) => Number.isFinite(n) && n > 0)

  return values.sort((a, b) => b - a)
}

/**
 * The alert rung that should fire for a document expiring in `daysUntilExpiry`.
 *
 * Returns the largest threshold at or beyond the remaining days — so 45 days
 * out answers 60 (the first nudge has come due), and 5 days answers 7. A
 * negative figure (already past) is not an alert, it is `expired`, handled by the
 * state above; this returns null for it.
 */

export function expiryAlertLevel(
  daysUntilExpiry: number,

  alertDays: number[],
): number | null {
  if (daysUntilExpiry < 0) return null

  for (const threshold of alertDays) {
    if (daysUntilExpiry <= threshold) return threshold
  }

  return null
}

/** Whole days from `todayIso` to `expiryIso`, negative once past. */

export function daysUntilExpiry(
  expiryIso: string,

  todayIso: string,
): number {
  const expiry = Date.parse(`${expiryIso.slice(0, 10)}T00:00:00Z`)

  const today = Date.parse(`${todayIso.slice(0, 10)}T00:00:00Z`)

  if (Number.isNaN(expiry) || Number.isNaN(today)) return 0

  return Math.round((expiry - today) / 86_400_000)
}

// --- Verification score -----------------------------------------------------

/** One required-or-optional checklist slot as fed to the score computation. */
export interface ScoredChecklistEntry {
  required: boolean

  state: DocumentChecklistState
}

/** The per-customer percentage of required documents verified. */

export interface VerificationScore {
  requiredTotal: number

  requiredVerified: number

  missing: number

  expiringSoon: number

  percent: number
}

/**
 * Builds the score from the required slots and their computed states.
 *
 * `percent` is over the required set only — optional papers that happen to be
 * missing must not depress it, or the number stops meaning "is this file
 * complete for what we asked of this customer". No required documents scores a
 * truthful 100 (nothing outstanding), not a dash: an empty-but-valid requirement
 * set is a real state.
 */

export function computeVerificationScore(
  entries: ScoredChecklistEntry[],
): VerificationScore {
  const required = entries.filter((entry) => entry.required)

  const requiredTotal = required.length

  const requiredVerified = required.filter(
    (entry) => entry.state === "verified",
  ).length

  const missing = required.filter((entry) => entry.state === "missing").length

  const expiringSoon = required.filter(
    (entry) => entry.state === "expired",
  ).length

  const percent =
    requiredTotal === 0
      ? 100
      : Math.round((requiredVerified / requiredTotal) * 100)

  return {
    requiredTotal,

    requiredVerified,

    missing,

    expiringSoon,

    percent,
  }
}

// --- Limits (mirror shared/documents.ts, restated for the checklist UI) ------

/** The upload envelope the client enforces before the request leaves the browser. */

export const DOCUMENT_VERIFICATION_ALLOWED_MIMES = [
  "image/png",

  "image/jpeg",

  "application/pdf",
] as const

/** Reasons a verifier may reject a document; free text, but the client offers these. */

export const DOCUMENT_REJECT_HINTS = [
  "Blurry or unreadable",

  "Wrong document type",

  "Name or number does not match the profile",

  "Expired",

  "Incomplete page or cropped edge",
] as const
