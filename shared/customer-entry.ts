/**
 * Manual-first customer entry: the rules behind every "Add / Edit Customer" form.
 *
 * The officer types each value from the paper form in front of them, so the shape rules
 * have to be written once and read by both sides — a browser that accepts a phone number
 * the API refuses is a form the office cannot finish, and the reverse is a record that
 * says something the desk never confirmed. So the field list, the closed option lists,
 * the CNIC and Pakistani number rules, and the document checklist all live here.
 *
 * Two deliberate choices run through the file. Absence is never invented: a field nobody
 * filled stays null and is reported as missing, not defaulted to something plausible.
 * And presence is only ever *checked* for format — an unreadable CNIC is refused with a
 * hint naming the accepted shapes, while an absent one is a line on the Missing
 * information report, because a customer met at a site visit legitimately has no CNIC
 * number typed yet and refusing the save would throw the rest of the form away.
 */

// --- Closed lists -----------------------------------------------------------

export const CUSTOMER_TYPES = [
  "individual",

  "company",

  "overseas_pakistani",
] as const

export type CustomerType = typeof CUSTOMER_TYPES[number]

export const CUSTOMER_TYPE_LABELS: Record<CustomerType, string> = {
  individual: "Individual",

  company: "Company / firm",

  overseas_pakistani: "Overseas Pakistani",
}

/** Why the distinction matters on the file, said once rather than in three places. */

export const CUSTOMER_TYPE_HINTS: Record<CustomerType, string> = {
  individual: "A person buying in their own name.",

  company:
    "A company, partnership or sole proprietor. The trade licence or NTN stands in for a CNIC.",

  overseas_pakistani:
    "A Pakistani national abroad. Passport and remitment details are expected beside the CNIC.",
}

export function isCustomerType(value: unknown): value is CustomerType {
  return (
    typeof value === "string" &&
    (CUSTOMER_TYPES as readonly string[]).includes(value)
  )
}

export const CUSTOMER_GENDERS = [
  "male",

  "female",

  "other",

  "not_stated",
] as const

export type CustomerGender = typeof CUSTOMER_GENDERS[number]

export const CUSTOMER_GENDER_LABELS: Record<CustomerGender, string> = {
  male: "Male",

  female: "Female",

  other: "Other",

  not_stated: "Not stated",
}

export function isCustomerGender(value: unknown): value is CustomerGender {
  return (
    typeof value === "string" &&
    (CUSTOMER_GENDERS as readonly string[]).includes(value)
  )
}

// --- CNIC -------------------------------------------------------------------

export const CNIC_DIGITS = 13

/** The display form NADRA writes: 42101-1234567-1. */

const CNIC_PATTERN = /^\d{5}-\d{7}-\d$/

/**
 * Strips the separators an officer actually types — spaces and dashes — and nothing
 * else. Letters are left in so the value fails `isCnic` and the field says why, rather
 * than quietly deleting a mistyped "O" for a zero and storing a number that is not the
 * one on the card.
 */

export function normalizeCnic(raw: string): string {
  return raw.replace(/[\s-]/g, "").trim()
}

export function isCnic(value: string): boolean {
  return /^\d{13}$/.test(value)
}

/**
 * Prints the number the way a Pakistani form does, from the 13 stored digits.
 *
 * Only a well-formed CNIC is re-grouped. Anything else is masked as a whole, because
 * half-formatting a value that is not a CNIC would present garbage as if it had been
 * checked.
 */

export function formatCnic(value: string | null | undefined): string | null {
  if (!value) return null

  const digits = normalizeCnic(value)

  if (!isCnic(digits)) return value

  return `${digits.slice(0, 5)}-${digits.slice(5, 12)}-${digits.slice(12)}`
}

/**
 * Everything but the block code and the check digit, for a list or a report line.
 *
 * The first five digits are a district-and-sub-district code and the last is a check
 * computed from the rest; those two together identify nobody, while the seven in the
 * middle are the person. So the ends are what stays readable in a table.
 */

export function maskCnic(value: string | null | undefined): string | null {
  if (!value) return null

  const digits = normalizeCnic(value)

  if (!isCnic(digits)) return "•••••-•••••••-•"

  return `${digits.slice(0, 5)}-XXXXXXX-${digits.slice(12)}`
}

/** Whether a string already looks like the dashed display form. */

export function looksLikeCnic(value: string): boolean {
  const digits = normalizeCnic(value)

  return isCnic(digits) || CNIC_PATTERN.test(value.trim())
}

// --- Pakistani numbers ------------------------------------------------------

export const PK_COUNTRY_CODE = "+92"

/**
 * Pakistani numbers, in the two shapes a Pakistani office writes down.
 *
 * A mobile is 10 or 11 digits in national form and starts with 3; a landline is an area
 * code without its trunk 0, then the subscriber digits. Both are accepted with or without
 * `+92`, with spaces, dashes or brackets, because an officer copies from whatever card or
 * paper is in front of them.
 */

/** National form: 10 or 11 digits, and every Pakistani mobile starts with 3. */

const PK_MOBILE = /^3\d{9,10}$/

/**
 * National form: a 2-digit area code (never 1, never 3) then 7-8 subscriber digits, which
 * is how a Pakistani landline is written down - 042-1234567 in Lahore, 071-2594971 in
 * Peshawar.
 *
 * A three-digit exchange code is refused rather than guessed at, because
 * `formatPkPhone` would print it with the split in the wrong place — a number that looks
 * reformatted but is regrouped wrongly is worse than one the officer typed themselves.
 */

const PK_LANDLINE = /^[2456789]\d{7,8}$/

/**
 * The accepted shapes, in the words the officer typed them in.
 *
 * Refusing a number is only useful if the field says what would have been accepted, so
 * this string is shown in the input's hint and in the error, from one place.
 */

export const PK_PHONE_HINT =
  "A Pakistani number: 0300 1234567, +92 300 1234567, or a landline such as 042-1234567."

/**
 * The national significant number, with the country code and the trunk 0 taken off.
 *
 * Empty when nothing numeric was typed. Nothing here decides whether the result is a
 * Pakistani number - that is `isPkPhone` - because the caller still has to display what
 * it was given when it is not.
 */

export function pkNationalDigits(raw: string): string {
  const value = raw.trim()

  if (!value) return ""

  const digits = value.replace(/\D/g, "")

  if (!digits) return ""

  if (digits.startsWith("00")) {
    // `00` is the international prefix, and `0092…` is the same number twice over.

    const rest = digits.slice(2)

    return rest.startsWith("92") && rest.length >= 11 ? rest.slice(2) : rest
  }

  // `92` in front of a full number: only read as the country code when a complete

  // national number follows it, so a local number that happens to start 92 survives.

  if (digits.startsWith("92") && digits.length >= 11) return digits.slice(2)

  return digits.startsWith("0") ? digits.slice(1) : digits
}

/**
 * Normalizes to `+92` plus the national digits, or returns the input trimmed.
 *
 * A value that is not Pakistani comes back exactly as typed. Rewriting a foreign number
 * into `+92…` would invent a country the officer never wrote, and a canonical form is
 * only worth storing for numbers that actually have one.
 */

export function normalizePkPhone(raw: string): string {
  const value = raw.trim()

  const national = pkNationalDigits(value)

  if (!isPkNational(national)) return value

  return `${PK_COUNTRY_CODE}${national}`
}

function isPkNational(national: string): boolean {
  return PK_MOBILE.test(national) || PK_LANDLINE.test(national)
}

/** True for a number that resolves to Pakistan, mobile or landline. */

export function isPkPhone(value: string): boolean {
  return isPkNational(pkNationalDigits(value))
}

/** True for a mobile number, which is what WhatsApp can actually receive. */

export function isWhatsappNumber(value: string): boolean {
  return PK_MOBILE.test(pkNationalDigits(value))
}

/** Any number that could be a phone somewhere: digits only, 7 to 15 of them, E.164's rule. */

export function isPlausiblePhone(value: string): boolean {
  const digits = value.trim().replace(/\D/g, "")

  return /^\d{7,15}$/.test(digits)
}

/**
 * The display form for a stored Pakistani number.
 *
 * `+923001234567` is what a duplicate check wants; `+92 300 1234567` is what a person
 * wants. This only reformats numbers already canonicalized on write, so a foreign number
 * stored as typed prints as typed.
 */

export function formatPkPhone(value: string | null | undefined): string | null {
  if (!value) return null

  const national = pkNationalDigits(value)

  if (!isPkNational(national)) return value

  if (PK_MOBILE.test(national)) {
    return `${PK_COUNTRY_CODE} ${national.slice(0, 3)} ${national.slice(3)}`
  }

  // A landline is printed with the country code and the digits as stored, without

  // inventing where the area code ends.

  return `${PK_COUNTRY_CODE} ${national}`
}

// --- Field list -------------------------------------------------------------

export type CustomerFieldSection = "personal" | "contact" | "current_address" | "permanent_address" | "type" | "identity_document" | "nominee" | "next_of_kin" | "notes"

export const CUSTOMER_FIELD_SECTION_LABELS: Record<CustomerFieldSection, string> =
  {
    personal: "Personal details",

    contact: "Contact",

    current_address: "Current address",

    permanent_address: "Permanent address",

    type: "Customer type and occupation",

    identity_document: "Other identity document",

    nominee: "Nominee",

    next_of_kin: "Next of kin",

    notes: "Notes",
  }

export type CustomerFieldType = "text" | "email" | "tel" | "date" | "select" | "textarea"

export interface CustomerEntryField {
  /** The camelCase key both sides send and read. */

  key: string

  label: string

  section: CustomerFieldSection

  type: CustomerFieldType

  max: number

  /** Needed before the record is worth anything. Enforced in the API, marked in the form. */

  required?: boolean

  /**
   * Expected before the booking file is complete. Not enforced on a write — an officer
   * who has met a buyer at a site and taken their phone number must be able to save what
   * they know — but shown on the form and listed by the Missing information report.
   */

  bookingFile?: boolean

  hint?: string

  /** For `select`, the key of the closed list in this module. */

  options?: "customer_type" | "gender"
}

export const CUSTOMER_NOTES_MAX = 2000

/**
 * Every field on the customer form, in the order the paper form asks for them.
 *
 * The API reads `max`, `required` and the closed lists off this list, and the form renders
 * from it, so a field cannot appear on one and not the other. Names are the storage
 * names; the snake_case column each maps to lives with the route that writes it.
 */

/**
 * `as const` is what makes the key union real: every side of the product then reads the
 * same literal set, so a form field that no route writes, or a route column no form
 * renders, stops being a bug that survives to runtime.
 */

export const CUSTOMER_ENTRY_FIELDS = [
  {
    key: "fullName",

    label: "Full name",

    section: "personal",

    type: "text",

    max: 120,

    required: true,

    bookingFile: true,

    hint: "As it is written on the CNIC.",
  },

  {
    key: "fatherHusbandName",

    label: "Father / husband name",

    section: "personal",

    type: "text",

    max: 120,

    bookingFile: true,

    hint: "Pakistani forms carry this beside the buyer's own name.",
  },

  {
    key: "cnic",

    label: "CNIC",

    section: "personal",

    type: "text",

    max: 20,

    bookingFile: true,

    hint: "13 digits, typed as 42101-1234567-1.",
  },

  {
    key: "dateOfBirth",

    label: "Date of birth",

    section: "personal",

    type: "date",

    max: 10,

    bookingFile: true,

    hint: "Buyers must be 18 or over; the form warns, it does not block.",
  },

  {
    key: "gender",

    label: "Gender",

    section: "personal",

    type: "select",

    max: 20,

    options: "gender",
  },

  {
    key: "phone",

    label: "Phone",

    section: "contact",

    type: "tel",

    max: 40,

    required: true,

    bookingFile: true,

    hint: PK_PHONE_HINT,
  },

  {
    key: "whatsapp",

    label: "WhatsApp number",

    section: "contact",

    type: "tel",

    max: 40,

    hint: "Where the payment reminders actually go. A mobile number.",
  },

  {
    key: "email",

    label: "Email",

    section: "contact",

    type: "email",

    max: 254,
  },

  {
    key: "addressLine1",

    label: "Address line 1",

    section: "current_address",

    type: "text",

    max: 160,

    bookingFile: true,
  },

  {
    key: "addressLine2",
    label: "Address line 2",
    section: "current_address",
    type: "text",
    max: 160,
  },

  {
    key: "city",
    label: "City",
    section: "current_address",
    type: "text",
    max: 80,
    bookingFile: true,
  },

  {
    key: "stateRegion",
    label: "State / region",
    section: "current_address",
    type: "text",
    max: 80,
  },

  {
    key: "postalCode",
    label: "Postal code",
    section: "current_address",
    type: "text",
    max: 24,
  },

  {
    key: "country",
    label: "Country",
    section: "current_address",
    type: "text",
    max: 80,
  },

  {
    key: "permanentAddressLine1",

    label: "Address line 1",

    section: "permanent_address",

    type: "text",

    max: 160,

    hint: "The address on the sale agreement. Copy the current address if they match.",
  },

  {
    key: "permanentAddressLine2",

    label: "Address line 2",

    section: "permanent_address",

    type: "text",

    max: 160,
  },

  {
    key: "permanentCity",
    label: "City",
    section: "permanent_address",
    type: "text",
    max: 80,
  },

  {
    key: "permanentStateRegion",

    label: "State / region",

    section: "permanent_address",

    type: "text",

    max: 80,
  },

  {
    key: "permanentPostalCode",
    label: "Postal code",
    section: "permanent_address",
    type: "text",
    max: 24,
  },

  {
    key: "permanentCountry",
    label: "Country",
    section: "permanent_address",
    type: "text",
    max: 80,
  },

  {
    key: "customerType",

    label: "Customer type",

    section: "type",

    type: "select",

    max: 32,

    options: "customer_type",

    hint: "Decides which documents the file is expected to hold.",

    required: true,

    bookingFile: true,
  },

  {
    key: "occupation",

    label: "Occupation",

    section: "type",

    type: "text",

    max: 120,
  },

  {
    key: "idDocumentType",

    label: "Document type",

    section: "identity_document",

    type: "text",

    max: 60,

    hint: "Passport, trade licence, NTN certificate — anything besides the CNIC.",
  },

  {
    key: "idDocumentNumber",

    label: "Document number",

    section: "identity_document",

    type: "text",

    max: 100,
  },

  {
    key: "idIssuingAuthority",

    label: "Issuing authority",

    section: "identity_document",

    type: "text",

    max: 120,
  },

  {
    key: "idIssueDate",
    label: "Issue date",
    section: "identity_document",
    type: "date",
    max: 10,
  },

  {
    key: "idExpiryDate",
    label: "Expiry date",
    section: "identity_document",
    type: "date",
    max: 10,
  },

  {
    key: "nomineeName",
    label: "Nominee name",
    section: "nominee",
    type: "text",
    max: 120,
  },

  {
    key: "nomineeRelationship",
    label: "Relationship",
    section: "nominee",
    type: "text",
    max: 60,
  },

  {
    key: "nomineePhone",
    label: "Phone",
    section: "nominee",
    type: "tel",
    max: 40,
  },

  {
    key: "nomineeEmail",
    label: "Email",
    section: "nominee",
    type: "email",
    max: 254,
  },

  {
    key: "nextOfKinName",
    label: "Name",
    section: "next_of_kin",
    type: "text",
    max: 120,
  },

  {
    key: "nextOfKinRelationship",
    label: "Relationship",
    section: "next_of_kin",
    type: "text",
    max: 60,
  },

  {
    key: "nextOfKinPhone",
    label: "Phone",
    section: "next_of_kin",
    type: "tel",
    max: 40,
  },

  {
    key: "nextOfKinEmail",
    label: "Email",
    section: "next_of_kin",
    type: "email",
    max: 254,
  },

  {
    key: "notes",

    label: "Notes",

    section: "notes",

    type: "textarea",

    max: CUSTOMER_NOTES_MAX,

    hint: "Anything the next officer reading this file needs to know.",
  },
] as const satisfies readonly CustomerEntryField[]

/** Every field key on the form, as a literal union rather than a loose `string`. */

export type CustomerEntryFieldKey = typeof CUSTOMER_ENTRY_FIELDS[number]["key"]

/**
 * A field read through the declared interface, with its key still the literal union.
 *
 * Exported because the form has to ask "is this one required?" while it renders, and the
 * `as const` list above cannot answer that: an element which omits an optional member
 * does not have it at all, so reading `field.required` off the const tuple is a compile
 * error. This view keeps the member optional but *present* as a question, and pins the
 * key, so `values[field.key]` stays typechecked on both sides of the wire.
 */

export type CustomerEntryFieldView = CustomerEntryField & {
  key: CustomerEntryFieldKey
}

/**
 * The same list, but with the optional members present as a question rather than absent.
 *
 * `as const` is what gives the routes and forms a real key union, but it also means an
 * element that omits an optional member does not have that member at all — so asking
 * "is this field required?" of the const type is a compile error rather than a `false`.
 * Loops that ask about the optional members iterate over this view instead.
 */

export const CUSTOMER_ENTRY_VIEW: readonly CustomerEntryFieldView[] =
  CUSTOMER_ENTRY_FIELDS

export const CUSTOMER_FIELD_KEYS: CustomerEntryFieldKey[] =
  CUSTOMER_ENTRY_FIELDS.map((field) => field.key)

/**
 * The two fields the API refuses a save without.
 *
 * Deliberately narrower than `required` on the field list: a walk-in buyer whose card is
 * still in their pocket has to be savable with a name and a phone number, and the
 * customer type is defaulted by the form rather than demanded by the route. Anything
 * besides these three is *marked* on the form and *reported* when absent.
 */

export const CUSTOMER_REQUIRED_KEYS: CustomerEntryFieldKey[] = [
  "fullName",

  "phone",
]

/** What a closed-list value has to be replaced with when it is not on the list. */

export function closedListError(options: readonly string[]): string {
  return `Choose one of: ${options.join(", ")}.`
}

/** The input shape the form and the API exchange: every field as text or empty. */

export type CustomerEntryInput = Record<CustomerEntryFieldKey, string>

export function emptyCustomerInput(): CustomerEntryInput {
  const values = {} as CustomerEntryInput

  for (const field of CUSTOMER_ENTRY_FIELDS) values[field.key] = ""

  // A new record is an individual until the officer says otherwise; leaving the type

  // blank would make the checklist ask for nothing.

  values.customerType = "individual"

  return values
}

export function customerFieldsInSection(
  section: CustomerFieldSection,
): CustomerEntryFieldView[] {
  return CUSTOMER_ENTRY_VIEW.filter((field) => field.section === section)
}

export function customerFieldByKey(key: string): CustomerEntryFieldView | null {
  return CUSTOMER_ENTRY_VIEW.find((field) => field.key === key) ?? null
}

/** The label a change-history row prints, or the key when a field was renamed away. */

export function customerFieldLabel(key: string): string {
  return customerFieldByKey(key)?.label ?? key
}

export function customerFieldRules(): Record<CustomerEntryFieldKey, number> {
  const maxima = {} as Record<CustomerEntryFieldKey, number>

  for (const field of CUSTOMER_ENTRY_FIELDS) maxima[field.key] = field.max

  return maxima
}

// --- What each customer type asks for ---------------------------------------

/**
 * Which fields a given customer type makes relevant.
 *
 * The paper form a firm fills in is not the form an individual fills in, and the screen
 * should not pretend otherwise: asking a company for a father's name or a date of birth is
 * noise that trains the officer to click past the whole panel. One function answers it for
 * the form (what to render), for the warning strip (what is still owed) and for the Missing
 * information report, so the three cannot disagree about what "incomplete" means.
 *
 * Nothing here is enforced on a save. A field this type never answers is *waived*, not
 * forbidden — a sole proprietor does hold a CNIC, and the officer's judgement outranks the
 * checklist.
 */

export interface CustomerTypeFields {
  /** Fields the form renders for this type, in declared order. */

  visible: CustomerEntryFieldKey[]

  /**
   * Fields this type is expected to carry on top of the ones the field list marks, so a
   * firm is asked for its licence where a person is asked for a CNIC.
   */

  expected: CustomerEntryFieldKey[]

  /** Fields this type cannot answer, so leaving them blank is not a gap. */

  waived: CustomerEntryFieldKey[]

  /** Worth typing, never reported as missing: the number a reminder can actually reach. */

  advised: CustomerEntryFieldKey[]
}

/** A firm has no father, no birthday and no gender — its licence stands in for all three. */

const COMPANY_WAIVED: CustomerEntryFieldKey[] = [
  "cnic",

  "fatherHusbandName",

  "dateOfBirth",

  "gender",
]

const COMPANY_EXPECTED: CustomerEntryFieldKey[] = [
  "idDocumentType",

  "idDocumentNumber",
]

/** An overseas Pakistani files a passport beside the CNIC, and its expiry is what expires. */

const OVERSEAS_EXPECTED: CustomerEntryFieldKey[] = [
  "idDocumentType",

  "idDocumentNumber",

  "idExpiryDate",
]

const OVERSEAS_ADVISSED: CustomerEntryFieldKey[] = ["whatsapp"]

const NOTHING_WAIVED: CustomerEntryFieldKey[] = []

export function customerDetailFieldsFor(
  customerType: string | null | undefined,
): CustomerTypeFields {
  const type = isCustomerType(customerType) ? customerType : "individual"

  const waived = type === "company" ? COMPANY_WAIVED : NOTHING_WAIVED

  const expected =
    type === "company"
      ? COMPANY_EXPECTED
      : type === "overseas_pakistani"
        ? OVERSEAS_EXPECTED
        : [] as CustomerEntryFieldKey[]

  const advised =
    type === "overseas_pakistani"
      ? OVERSEAS_ADVISSED
      : [] as CustomerEntryFieldKey[]

  const skipped = new Set<string>(waived)

  return {
    visible: CUSTOMER_FIELD_KEYS.filter((key) => !skipped.has(key)),

    expected,

    waived,

    advised,
  }
}

/** Whether this one field is expected on this type's booking file. */

export function customerFieldExpectedFor(
  key: CustomerEntryFieldKey,

  customerType: string | null | undefined,
): "required" | "expected" | "advised" | null {
  if ((CUSTOMER_REQUIRED_KEYS as string[]).includes(key)) return "required"

  const rules = customerDetailFieldsFor(customerType)

  if ((rules.expected as string[]).includes(key)) return "expected"

  if ((rules.advised as string[]).includes(key)) return "advised"

  return null
}

// --- Permanent address mirroring --------------------------------------------

/**
 * A current-address field and the permanent field it copies into.
 *
 * The paper form has one address block and a tick that says "permanent the same", and the
 * office means it: the sale agreement is written with that address. Mirroring the typed
 * values rather than storing one address twice is what lets the two diverge later — when
 * a buyer moves and only the postal address on the agreement changes — without the screen
 * having to remember which was typed first.
 */

export interface PermanentAddressPair {
  current: CustomerEntryFieldKey

  permanent: CustomerEntryFieldKey
}

export const PERMANENT_ADDRESS_PAIRS: PermanentAddressPair[] = [
  { current: "addressLine1", permanent: "permanentAddressLine1" },

  { current: "addressLine2", permanent: "permanentAddressLine2" },

  { current: "city", permanent: "permanentCity" },

  { current: "stateRegion", permanent: "permanentStateRegion" },

  { current: "postalCode", permanent: "permanentPostalCode" },

  { current: "country", permanent: "permanentCountry" },
]

/** The form values with the permanent block written from the current one. */

export function copyCurrentAddressToPermanent(
  values: CustomerEntryInput,
): CustomerEntryInput {
  const next: CustomerEntryInput = { ...values }

  for (const pair of PERMANENT_ADDRESS_PAIRS) {
    next[pair.permanent] = values[pair.current]
  }

  return next
}

/**
 * Whether the two blocks say the same thing, and so the tick should read as on.
 *
 * An empty current address does not make the tick true: two blank halves are not an
 * officer's statement that the addresses match, and showing it ticked would let a save
 * record "permanent same as current" when neither was typed.
 */

export function currentAddressMatchesPermanent(
  values: CustomerEntryInput,
): boolean {
  const anyCurrent = PERMANENT_ADDRESS_PAIRS.some(
    (pair) => values[pair.current].trim() !== "",
  )

  if (!anyCurrent) return false

  return PERMANENT_ADDRESS_PAIRS.every(
    (pair) => values[pair.current] === values[pair.permanent],
  )
}

/**
 * What the record still needs before it can open a booking file.
 *
 * One function, read by the form (as a warning strip beside the Save button), by the
 * detail page, and by the Missing information report, so the three can never disagree
 * about what "incomplete" means. A company is asked for a trade licence in place of a
 * CNIC, so the same absent CNIC is missing on an individual and satisfied on a firm.
 */

export function customerMissingFields(
  values: Partial<Record<CustomerEntryFieldKey, string | null>>,
): CustomerEntryFieldKey[] {
  const rules = customerDetailFieldsFor(values.customerType)

  const waived = new Set<string>(rules.waived)

  const expected = new Set<string>(rules.expected)

  const missing: CustomerEntryFieldKey[] = []

  for (const field of CUSTOMER_ENTRY_VIEW) {
    // A firm is asked for its licence, not for a personal CNIC it does not have.

    if (waived.has(field.key)) continue

    if (!field.bookingFile && !field.required && !expected.has(field.key)) {
      continue
    }

    const value = values[field.key]

    if (typeof value === "string" && value.trim() !== "") continue

    missing.push(field.key)
  }

  return missing
}

export function customerMissingFieldLabels(
  values: Partial<Record<CustomerEntryFieldKey, string | null>>,
): string[] {
  const keys = new Set<string>(customerMissingFields(values))

  return CUSTOMER_ENTRY_FIELDS.filter((field) => keys.has(field.key)).map(
    (field) => field.label,
  )
}

// --- Document checklist -----------------------------------------------------

export interface CustomerDocumentChecklistItem {
  /** The stable key stored on the document row. Never renamed: existing files cite it. */

  key: string

  label: string

  /** The `documents.doc_type` the file is filed under. */

  docType: string

  /** Which customer types are expected to hold this item. */

  requiredFor: CustomerType[]

  hint: string
}

/**
 * The papers the office expects in a customer's file.
 *
 * A checklist rather than a count of uploads, because the useful question is "which
 * document is missing", and the answer has to be reachable from the file list: each item
 * is matched on `checklist_key`, so a second CNIC scan does not fill the photograph slot.
 * `requiredFor` is what makes the list a per-type list rather than a wall of boxes.
 */

export const CUSTOMER_DOCUMENT_CHECKLIST: CustomerDocumentChecklistItem[] = [
  {
    key: "cnic_front",

    label: "CNIC front",

    docType: "id_copy",

    requiredFor: ["individual", "overseas_pakistani"],

    hint: "The face with the name, number and validity dates.",
  },

  {
    key: "cnic_back",

    label: "CNIC back",

    docType: "id_copy",

    requiredFor: ["individual", "overseas_pakistani"],

    hint: "The side carrying the address and the husband / father name.",
  },

  {
    key: "photograph",

    label: "Passport-size photograph",

    docType: "id_copy",

    requiredFor: ["individual", "company", "overseas_pakistani"],

    hint: "For the booking form. A firm files the authorised signatory's photograph.",
  },

  {
    key: "nominee_cnic",

    label: "Nominee CNIC",

    docType: "id_copy",

    requiredFor: ["individual", "overseas_pakistani"],

    hint: "Only when a nominee is named on the form.",
  },

  {
    key: "booking_form",

    label: "Signed booking form",

    docType: "booking_form",

    requiredFor: ["individual", "company", "overseas_pakistani"],

    hint: "The application, signed on every page.",
  },

  {
    key: "sale_agreement",

    label: "Sale agreement",

    docType: "agreement",

    requiredFor: ["individual", "company", "overseas_pakistani"],

    hint: "Filed when the agreement is executed, not at booking.",
  },

  {
    key: "payment_proof",

    label: "Payment proofs",

    docType: "receipt",

    requiredFor: ["individual", "company", "overseas_pakistani"],

    hint: "Slips, cheque images and transfer confirmations for money recorded by hand.",
  },

  {
    key: "trade_licence",

    label: "Trade licence / NTN certificate",

    docType: "id_copy",

    requiredFor: ["company"],

    hint: "The document a firm identifies itself with.",
  },

  {
    key: "passport",

    label: "Passport",

    docType: "id_copy",

    requiredFor: ["overseas_pakistani"],

    hint: "The page with the photograph and the expiry date.",
  },

  {
    key: "remitment",

    label: "Remittance / foreign-source proof",

    docType: "other",

    requiredFor: ["overseas_pakistani"],

    hint: "How the money entered Pakistan, for the deposit.",
  },

  {
    key: "other_support",

    label: "Other supporting paper",

    docType: "other",

    requiredFor: [],

    hint: "Anything else the file needs. Never required.",
  },
]

export const CUSTOMER_CHECKLIST_KEYS = CUSTOMER_DOCUMENT_CHECKLIST.map(
  (item) => item.key,
)

export function isCustomerChecklistKey(value: unknown): boolean {
  return typeof value === "string" && CUSTOMER_CHECKLIST_KEYS.includes(value)
}

export function customerChecklistItem(key: string) {
  return CUSTOMER_DOCUMENT_CHECKLIST.find((item) => item.key === key) ?? null
}

/** The items a given customer type is expected to hold, in filing order. */

export function customerChecklistFor(
  customerType: string | null | undefined,
): CustomerDocumentChecklistItem[] {
  const type = isCustomerType(customerType) ? customerType : "individual"

  return CUSTOMER_DOCUMENT_CHECKLIST.filter(
    (item) => item.requiredFor.length === 0 || item.requiredFor.includes(type),
  )
}

/**
 * The slots that are genuinely mandatory for a type.
 *
 * `other_support` carries an empty `requiredFor` so it stays listed as an available slot
 * without ever being missed, and the nominee's CNIC depends on a nominee existing at all,
 * which the caller passes in rather than the checklist guessing.
 */

export function customerRequiredChecklistKeys(
  customerType: string | null | undefined,

  hasNominee = false,
): string[] {
  const type = isCustomerType(customerType) ? customerType : "individual"

  return CUSTOMER_DOCUMENT_CHECKLIST.filter((item) => {
    if (item.key === "other_support") return false

    if (item.key === "nominee_cnic") return hasNominee

    if (item.key === "sale_agreement" || item.key === "payment_proof")
      return false

    return item.requiredFor.includes(type)
  }).map((item) => item.key)
}

// --- Edit history -----------------------------------------------------------

/**
 * What happened to a record, from the desk's point of view.
 *
 * `created` and `imported` are both first entries — one typed from a paper form, one from
 * a sheet of old customers — and keeping them apart is what lets a report say how much of
 * a workspace's history was observed and how much was carried over.
 */

export const CUSTOMER_EDIT_EVENT_ACTIONS = [
  "created",

  "updated",

  "imported",
] as const

export type CustomerEditEventAction = typeof CUSTOMER_EDIT_EVENT_ACTIONS[number]

export const CUSTOMER_EDIT_EVENT_LABELS: Record<CustomerEditEventAction, string> =
  {
    created: "Entered by hand",

    updated: "Edited",

    imported: "Imported from a sheet",
  }

/** Where the change came from, so a spreadsheet row never reads like a person at a desk. */

export const CUSTOMER_EDIT_EVENT_SOURCES = ["form", "import", "api"] as const

export type CustomerEditEventSource = typeof CUSTOMER_EDIT_EVENT_SOURCES[number]

export interface CustomerEditChange {
  field: string

  label: string

  /**
   * The value before, in the form a reader may see — a CNIC arrives masked, a closed
   * list arrives as its label. Null means the field was empty.
   */

  from: string | null

  to: string | null
}

export interface CustomerEditEvent {
  id: string

  action: CustomerEditEventAction

  actionLabel: string

  source: string

  userId: string

  userName: string

  recordedAt: string

  changes: CustomerEditChange[]
}

// --- Dates ------------------------------------------------------------------

/** A real calendar day in `YYYY-MM-DD`, checked against itself rather than a regex. */

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false

  const date = new Date(`${value}T00:00:00.000Z`)

  return (
    !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
  )
}

/** Whole years between a birth date and a given day. Negative for a future date. */

export function ageOn(dateOfBirth: string, onDay: string): number | null {
  if (!isIsoDate(dateOfBirth) || !isIsoDate(onDay)) return null

  const birth = Date.parse(`${dateOfBirth}T00:00:00.000Z`)

  const today = Date.parse(`${onDay}T00:00:00.000Z`)

  if (Number.isNaN(birth) || Number.isNaN(today)) return null

  const years =
    Number(onDay.slice(0, 4)) -
    Number(dateOfBirth.slice(0, 4)) -
    (onDay.slice(5) < dateOfBirth.slice(5) ? 1 : 0)

  return today < birth ? -1 : years
}

export const ADULT_AGE = 18

/**
 * The age note, as a warning rather than a refusal.
 *
 * A booking for a minor is a real thing an office handles through a guardian, and the
 * officer typing the date has told us what they saw on the card. Refusing the save would
 * lose the rest of the form; staying silent would hide the fact. So the form says it and
 * the record stands, with the notes field as where the explanation belongs.
 */

export function dateOfBirthWarning(
  dateOfBirth: string | null | undefined,

  today: string,
): string | null {
  if (!dateOfBirth) return null

  const age = ageOn(dateOfBirth, today)

  if (age === null) return null

  if (age < 0) return "This date of birth is in the future."

  if (age < ADULT_AGE) {
    return `This buyer would be ${age} today. A minor can be booked only through a guardian — say so in Notes.`
  }

  if (age > 120)
    return "This date of birth looks mistyped: it makes the buyer over 120."

  return null
}
