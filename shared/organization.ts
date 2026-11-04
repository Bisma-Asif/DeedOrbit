/**
 * Organization settings: the vocabulary both sides must agree on.
 *
 * Validation lives here rather than in the route handler or the form because
 * three copies of a rule is three chances to disagree — the client would
 * accept something the server rejects, or the reverse. The server is still the
 * authority; the client calls the same functions purely to show errors before a
 * round-trip.
 *
 * Kept dependency-free so `server/*.ts` and `src/**` can both import it.
 */

// --- Currencies -------------------------------------------------------------

export const CURRENCIES = [
  { code: "AED", label: "UAE dirham", symbol: "AED" },
  { code: "EUR", label: "Euro", symbol: "€" },
  { code: "GBP", label: "Pound sterling", symbol: "£" },
  { code: "KES", label: "Kenyan shilling", symbol: "KSh" },
  { code: "NGN", label: "Nigerian naira", symbol: "₦" },
  { code: "PKR", label: "Pakistani rupee", symbol: "PKR" },
  { code: "USD", label: "US dollar", symbol: "$" },
] as const

export type CurrencyCode = typeof CURRENCIES[number]["code"]

export const CURRENCY_CODES: readonly string[] = CURRENCIES.map((c) => c.code)

export function isCurrencyCode(value: string): value is CurrencyCode {
  return CURRENCY_CODES.includes(value)
}

// --- Time zones -------------------------------------------------------------

/**
 * A curated list rather than the full IANA database: this product ships on a
 * locked-down intranet, and the values below are the zones the demo and pilot
 * workspaces operate in. Stored verbatim in `tenants.timezone`, which is what
 * `Intl.DateTimeFormat` expects.
 */
export const TIME_ZONES = [
  { value: "Africa/Lagos", label: "GMT+1 — Lagos, West Central Africa" },
  { value: "Africa/Nairobi", label: "GMT+3 — Nairobi, East Africa" },
  { value: "Asia/Dubai", label: "GMT+4 — Dubai, Gulf" },
  { value: "Asia/Karachi", label: "GMT+5 — Karachi, Pakistan" },
  { value: "Asia/Kolkata", label: "GMT+5:30 — Mumbai, India" },
  { value: "Asia/Singapore", label: "GMT+8 — Singapore" },
  { value: "Europe/London", label: "GMT+0 / GMT+1 — London" },
  { value: "Europe/Berlin", label: "GMT+1 / GMT+2 — Berlin, Paris" },
  { value: "America/New_York", label: "GMT-5 / GMT-4 — New York" },
  { value: "America/Chicago", label: "GMT-6 / GMT-5 — Chicago" },
  { value: "America/Los_Angeles", label: "GMT-8 / GMT-7 — Los Angeles" },
  { value: "UTC", label: "UTC — Coordinated Universal Time" },
] as const

export const TIME_ZONE_VALUES: readonly string[] = TIME_ZONES.map(
  (t) => t.value,
)

export function isTimeZone(value: string): boolean {
  return TIME_ZONE_VALUES.includes(value)
}

/** Rejects syntactically odd zones, including anything `Intl` would throw on. */
export function isValidTimeZoneName(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: value })
    return true
  } catch {
    return false
  }
}

// --- Fiscal year ------------------------------------------------------------

export const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const

export type MonthNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12

export function isMonthNumber(value: number): value is MonthNumber {
  return Number.isInteger(value) && value >= 1 && value <= 12
}

export function monthLabel(month: number): string {
  return MONTHS[month - 1] ?? "January"
}

// --- Working days -----------------------------------------------------------

/** ISO weekday: Monday = 1 … Sunday = 7, matching `Date#getUTCDay` + 1. */
export const WEEKDAYS = [
  { value: 1, short: "Mon", long: "Monday" },
  { value: 2, short: "Tue", long: "Tuesday" },
  { value: 3, short: "Wed", long: "Wednesday" },
  { value: 4, short: "Thu", long: "Thursday" },
  { value: 5, short: "Fri", long: "Friday" },
  { value: 6, short: "Sat", long: "Saturday" },
  { value: 7, short: "Sun", long: "Sunday" },
] as const

export const DEFAULT_WORKING_DAYS = [1, 2, 3, 4, 5]

export function isValidWeekday(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 7
}

/** Sorts, de-duplicates, and rejects an empty selection. */
export function normalizeWorkingDays(input: number[]): number[] | null {
  const unique = [...new Set(input)]
    .filter(isValidWeekday)
    .sort((a, b) => a - b)
  return unique.length > 0 ? unique : null
}

export function formatWorkingDays(days: number[]): string {
  if (days.length === 7) return "Every day"
  if (days.length === 5 && days.join(",") === "1,2,3,4,5")
    return "Monday to Friday"
  if (days.length === 0) return "None"
  const names = days.map(
    (d) => WEEKDAYS.find((w) => w.value === d)?.short ?? "?",
  )
  return names.join(", ")
}

// --- Document numbering -----------------------------------------------------

export const NUMBER_KINDS = [
  "invoice",
  "receipt",
  "booking",
  "requisition",
  "purchase_order",
] as const
export type NumberKind = typeof NUMBER_KINDS[number]

export const NUMBER_KIND_LABELS: Record<NumberKind, string> = {
  invoice: "Invoices",
  receipt: "Receipts",
  booking: "Bookings",
  requisition: "Requisitions",
  purchase_order: "Purchase orders",
}

export const NUMBER_KIND_SINGULAR: Record<NumberKind, string> = {
  invoice: "invoice",
  receipt: "receipt",
  booking: "booking",
  requisition: "requisition",
  purchase_order: "purchase order",
}

export const DEFAULT_NUMBER_FORMATS: Record<NumberKind, {
  prefix: string
  padding: number
}> = {
  invoice: { prefix: "INV-", padding: 4 },
  receipt: { prefix: "RCP-", padding: 4 },
  booking: { prefix: "BKG-", padding: 4 },
  requisition: { prefix: "PRQ-", padding: 4 },
  purchase_order: { prefix: "PO-", padding: 4 },
}

export function isNumberKind(value: string): value is NumberKind {
  return (NUMBER_KINDS as readonly string[]).includes(value)
}

/** Uppercase letters, digits, spaces, and a trailing separator. No path chars. */
export const PREFIX_PATTERN = /^[A-Z0-9]{0,6}[\-–/ ]?$/

export function isValidPrefix(value: string): boolean {
  return PREFIX_PATTERN.test(value)
}

export function isValidPadding(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 10
}

/**
 * Renders a document number. Shared so the settings screen can show a live
 * preview that is produced by the same code that stamps the document — a preview
 * that disagreed with reality would be worse than none.
 *
 * The document kind is not a parameter: it is carried by the prefix, which the
 * admin configures per kind. Passing it in as well would create two sources of
 * truth for the same thing.
 */
export function formatDocumentNumber(
  prefix: string,
  padding: number,
  value: number,
): string {
  const safePadding = isValidPadding(padding) ? padding : 4
  const safeValue = Number.isFinite(value) && value >= 0 ? Math.floor(value) : 1
  return `${prefix}${String(safeValue).padStart(safePadding, "0")}`
}

/**
 * The fiscal year a date belongs to, given a start month.
 *
 * January start: a December date is still the previous fiscal year. July start:
 * a June date is still the previous one. Comparing month numbers alone would be
 * the classic off-by-one in year-end reporting.
 */
export function fiscalYearFor(date: Date, startMonth: number): number {
  const start = isMonthNumber(startMonth) ? startMonth : 1
  const year = date.getUTCFullYear()
  // getUTCMonth is 0-based, so add one to compare against 1-based months.
  return date.getUTCMonth() + 1 < start ? year - 1 : year
}

// --- Validation -------------------------------------------------------------

export const NAME_MIN = 2
export const NAME_MAX = 120
export const ADDRESS_MIN = 4
export const ADDRESS_MAX = 160

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
/** 6–20 letters, digits, or hyphens. */
export const REGISTRATION_PATTERN = /^[A-Za-z0-9-]{6,20}$/
/** 4–20 letters, digits, or hyphens. */
export const TAX_ID_PATTERN = /^[A-Za-z0-9-]{4,20}$/
/** An optional leading +, then digits with the separators people actually type. */
export const PHONE_PATTERN = /^[+()\d][\d\s()+.-]{4,24}$/
/** 2–8 uppercase letters or digits with internal hyphens, e.g. "HQ" or "LAG-01". */
export const BRANCH_CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{1,7}$/
export const POSTAL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 -]{1,11}$/
export const COUNTRY_PATTERN = /^[A-Z]{2}$/

// --- Logo -------------------------------------------------------------------

/**
 * Raster only, and that is a decision rather than an omission.
 *
 * SVG is excluded because it is an active document format: a stored SVG served
 * inline can carry script, and `<img src>` sandboxing is a browser mitigation
 * rather than a guarantee. A workspace logo is a small raster mark in every
 * realistic case, so the smaller attack surface is the better trade. If vector
 * logos are genuinely required later, the fix is sanitisation on ingest, not
 * relaxing this list.
 */
export const LOGO_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
] as const

export type LogoMimeType = typeof LOGO_MIME_TYPES[number]

/** Decoded size ceiling. Checked on the decoded bytes, not the encoded string. */
export const LOGO_MAX_BYTES = 128 * 1024

/**
 * Request ceiling for the upload endpoint, which must also cover base64
 * expansion (~4/3) plus the surrounding JSON. The global 64 KB body cap in
 * server/http.ts is correct for every other route and is not raised.
 */
export const LOGO_MAX_REQUEST_BYTES = 220 * 1024

const LOGO_MIME_SET: readonly string[] = LOGO_MIME_TYPES

/**
 * Magic-byte prefixes. The declared media type is a claim by whoever uploaded
 * the file, so the bytes have to agree with it — otherwise the allowlist above
 * is trivially bypassed by relabelling a file.
 */
const LOGO_SIGNATURES: {
  mime: LogoMimeType
  test: (bytes: Uint8Array) => boolean
}[] = [
  {
    mime: "image/png",
    test: (b) =>
      b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  },
  {
    mime: "image/jpeg",
    test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    mime: "image/webp",
    test: (b) =>
      b[0] === 0x52 &&
      b[1] === 0x49 &&
      b[2] === 0x46 &&
      b[3] === 0x46 &&
      b[8] === 0x57 &&
      b[9] === 0x45 &&
      b[10] === 0x42 &&
      b[11] === 0x50,
  },
]

/**
 * Declared as interfaces rather than inline object type literals: oxfmt strips
 * the member separators out of a `{ a: X; b: Y }` literal, which is a syntax
 * error. An `interface` body is reformatted one member per line and survives.
 */
export interface LogoParseOk {
  ok: true
  mime: LogoMimeType
  dataUrl: string
  bytes: number
}

export interface LogoParseFailure {
  ok: false
  error: string
}

export type LogoParseResult = LogoParseOk | LogoParseFailure

const DATA_URL_PATTERN =
  /^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/i

/**
 * Validates an uploaded logo and returns a canonical data URL.
 *
 * Shared so the settings screen can reject an oversized or wrongly-typed file
 * before the round-trip, using exactly the rules the server will apply. The
 * client-side check is a convenience; the server remains the authority.
 *
 * Uses `atob` rather than `Buffer` so it runs unchanged in the browser.
 */
export function parseLogoDataUrl(value: unknown): LogoParseResult {
  if (typeof value !== "string" || value.length === 0) {
    return { ok: false, error: "Choose a logo file to upload." }
  }

  // Cheap pre-check so an enormous string is rejected before decoding.
  if (value.length > LOGO_MAX_REQUEST_BYTES) {
    return {
      ok: false,
      error: `Logo must be under ${Math.floor(LOGO_MAX_BYTES / 1024)} KB.`,
    }
  }

  const match = DATA_URL_PATTERN.exec(value.trim())
  if (!match) {
    return {
      ok: false,
      error: "Upload the logo as a PNG, JPEG, or WebP image.",
    }
  }

  const declared = (match[1] ?? "").toLowerCase()
  if (!LOGO_MIME_SET.includes(declared)) {
    return { ok: false, error: "Logo must be a PNG, JPEG, or WebP image." }
  }

  let decoded: Uint8Array
  try {
    const binary = atob(match[2] ?? "")
    decoded = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) {
      decoded[i] = binary.charCodeAt(i)
    }
  } catch {
    return { ok: false, error: "That logo file could not be read." }
  }

  if (decoded.length === 0) {
    return { ok: false, error: "That logo file is empty." }
  }
  if (decoded.length > LOGO_MAX_BYTES) {
    return {
      ok: false,
      error: `Logo must be under ${Math.floor(LOGO_MAX_BYTES / 1024)} KB.`,
    }
  }

  const signature = LOGO_SIGNATURES.find((candidate) => candidate.test(decoded))
  if (!signature) {
    return {
      ok: false,
      error: "That file is not a valid PNG, JPEG, or WebP image.",
    }
  }
  if (signature.mime !== declared) {
    return {
      ok: false,
      error: "That file does not match its stated image type.",
    }
  }

  return {
    ok: true,
    mime: signature.mime,
    // Rebuilt from the validated bytes so nothing client-supplied is persisted
    // beyond the payload itself.
    dataUrl: `data:${signature.mime};base64,${match[2]}`,
    bytes: decoded.length,
  }
}

export type OrganizationErrors = Partial<Record<"name" | "legalName" | "registrationNumber" | "taxId" | "addressLine1" | "city" | "postalCode" | "countryCode" | "phone" | "collectionsEmail" | "fiscalYearStartMonth" | "currency" | "timezone" | "workingDays" | "ocrCaptureEnabled" | "logo" | "prefixInvoice" | "prefixReceipt" | "prefixBooking" | "paddingInvoice" | "paddingReceipt" | "paddingBooking", string>>

export function validateOrganizationProfile(values: {
  name: string
  legalName: string
  registrationNumber: string
  taxId: string
  addressLine1: string
  city: string
  postalCode: string
  countryCode: string
  phone: string
  collectionsEmail: string
  fiscalYearStartMonth: number
  currency: string
  timezone: string
  workingDays: number[]
}): OrganizationErrors {
  const errors: OrganizationErrors = {}

  const name = values.name.trim()
  if (name.length < NAME_MIN)
    errors.name = "Enter the trading name (min 2 characters)."
  else if (name.length > NAME_MAX)
    errors.name = `Keep this under ${NAME_MAX} characters.`

  const legalName = values.legalName.trim()
  if (legalName.length < NAME_MIN) {
    errors.legalName = "Enter the registered legal name."
  } else if (legalName.length > NAME_MAX) {
    errors.legalName = `Keep this under ${NAME_MAX} characters.`
  }

  if (
    values.registrationNumber.trim() &&
    !REGISTRATION_PATTERN.test(values.registrationNumber.trim())
  ) {
    errors.registrationNumber =
      "Use 6–20 letters, digits, or hyphens, or leave blank."
  }

  if (values.taxId.trim() && !TAX_ID_PATTERN.test(values.taxId.trim())) {
    errors.taxId = "Use 4–20 letters, digits, or hyphens, or leave blank."
  }

  if (values.addressLine1.trim().length < ADDRESS_MIN) {
    errors.addressLine1 = "Enter the street address."
  } else if (values.addressLine1.trim().length > ADDRESS_MAX) {
    errors.addressLine1 = `Keep this under ${ADDRESS_MAX} characters.`
  }

  if (values.city.trim().length < 2) errors.city = "Enter the city."

  if (
    values.postalCode.trim() &&
    !POSTAL_PATTERN.test(values.postalCode.trim())
  ) {
    errors.postalCode =
      "Use 2–12 letters, digits, spaces, or hyphens, or leave blank."
  }

  if (
    values.countryCode.trim() &&
    !COUNTRY_PATTERN.test(values.countryCode.trim())
  ) {
    errors.countryCode = "Use a two-letter ISO country code, e.g. NG."
  }

  if (values.phone.trim() && !PHONE_PATTERN.test(values.phone.trim())) {
    errors.phone = "Enter a valid phone number, or leave blank."
  }

  if (
    values.collectionsEmail.trim() &&
    !EMAIL_PATTERN.test(values.collectionsEmail.trim())
  ) {
    errors.collectionsEmail = "Enter a valid collections email, or leave blank."
  }

  if (!isMonthNumber(values.fiscalYearStartMonth)) {
    errors.fiscalYearStartMonth = "Choose the month the financial year starts."
  }

  if (!isCurrencyCode(values.currency)) {
    errors.currency = "Choose a supported base currency."
  }

  if (!values.timezone || !isTimeZone(values.timezone)) {
    errors.timezone = "Choose a supported time zone."
  }

  if (normalizeWorkingDays(values.workingDays) === null) {
    errors.workingDays = "Select at least one working day."
  }

  return errors
}

export function validateNumberFormat(input: {
  prefix: string
  padding: number
}): string | undefined {
  if (!isValidPrefix(input.prefix)) {
    return "Use up to 6 letters or digits, optionally with one trailing separator."
  }
  if (!isValidPadding(input.padding)) {
    return "Use 1–10 digits."
  }
  return undefined
}
