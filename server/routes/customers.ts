import { all, get, run, transaction } from "../db.ts"

import {
  badRequest,
  notFound,
  readJsonBody,
  type RequestContext,
} from "../http.ts"

import { requireAuth, requirePermission, writeAudit } from "../middleware.ts"

import { newId } from "../crypto.ts"

import { tenantIsPakistan, tenantToday } from "../tenant-locale.ts"

import {
  CUSTOMER_EDIT_EVENT_ACTIONS,
  CUSTOMER_EDIT_EVENT_LABELS,
  CUSTOMER_ENTRY_FIELDS,
  CUSTOMER_GENDER_LABELS,
  CUSTOMER_REQUIRED_KEYS,
  CUSTOMER_TYPE_LABELS,
  type CustomerEditChange,
  type CustomerEditEvent,
  type CustomerEditEventAction,
  type CustomerEditEventSource,
  type CustomerEntryFieldKey,
  type CustomerGender,
  type CustomerType,
  closedListError,
  customerFieldLabel,
  customerMissingFieldLabels,
  dateOfBirthWarning,
  formatCnic,
  isCnic,
  isCustomerGender,
  isCustomerType,
  isPkPhone,
  isWhatsappNumber,
  maskCnic,
  normalizeCnic,
  normalizePkPhone,
  PK_PHONE_HINT,
} from "../../shared/customer-entry.ts"

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/**
 * The shape every workspace is held to: something that starts with a `+`, a digit or a
 * bracket, and ends in a digit, with dialling punctuation in between.
 *
 * Deliberately permissive. The Pakistani rules in `shared/customer-entry.ts` are the
 * strict ones, and they apply only where the tenant's own country says they should — a
 * Dubai office holding `+971` numbers is not wrong, and refusing it would be the tool
 * inventing a law the desk does not work under.
 */

const PHONE_PATTERN = /^[+\d(][\d\s().-]*\d$/

/** The wording a PK tenant gets when the number is not theirs. */

const PK_PHONE_ERROR = `This workspace keeps Pakistani records, so a customer's phone has to be a Pakistani number. ${PK_PHONE_HINT}`

/** How the required-field refusal is phrased, in the officer's words rather than the key's. */

const REQUIRED_LABELS: Record<string, string> = {
  fullName: "Name",

  phone: "Phone",
}

type CustomerRow = {
  id: string

  tenant_id: string

  source_lead_id: string | null

  full_name: string

  phone: string

  email: string | null

  address_line1: string | null

  address_line2: string | null

  city: string | null

  state_region: string | null

  postal_code: string | null

  country: string | null

  id_document_type: string | null

  id_document_number: string | null

  id_issuing_authority: string | null

  id_issue_date: string | null

  id_expiry_date: string | null

  nominee_name: string | null

  nominee_relationship: string | null

  nominee_phone: string | null

  nominee_email: string | null

  next_of_kin_name: string | null

  next_of_kin_relationship: string | null

  next_of_kin_phone: string | null

  next_of_kin_email: string | null

  father_husband_name: string | null

  cnic: string | null

  date_of_birth: string | null

  gender: string | null

  whatsapp: string | null

  occupation: string | null

  customer_type: string | null

  notes: string | null

  permanent_address_line1: string | null

  permanent_address_line2: string | null

  permanent_city: string | null

  permanent_state_region: string | null

  permanent_postal_code: string | null

  permanent_country: string | null

  created_by_user_id: string | null

  created_by_name: string | null

  created_at: string

  updated_at: string

  lead_source?: string | null

  project_interest?: string | null
}

/**
 * What one save writes, keyed exactly as the shared form field list keys it.
 *
 * A field that existed here but not in `CUSTOMER_ENTRY_FIELDS` would be writable through
 * the API and invisible on the screen, which is how a record ends up holding something
 * nobody can read or correct. The key union makes that a compile error instead.
 */
type CustomerValues = Record<CustomerEntryFieldKey, string | null>

interface CustomerFieldRule {
  key: CustomerEntryFieldKey

  max: number

  required: boolean
}

interface CustomerBuildResult {
  values: CustomerValues

  errors: Record<string, string>
}

/**
 * Length and required-ness are read off the shared list, not repeated here, so the
 * browser's `maxLength` and the route's refusal are the same number by construction.
 *
 * `CUSTOMER_REQUIRED_KEYS` is the only refusal a save can hit for absence. Everything
 * else the booking file wants is marked on the form and named in the response's missing
 * list — a buyer met at a site has to be savable with a name and a phone number.
 */

const FIELD_RULES: CustomerFieldRule[] = CUSTOMER_ENTRY_FIELDS.map((field) => ({
  key: field.key,

  max: field.max,

  required: (CUSTOMER_REQUIRED_KEYS as string[]).includes(field.key),
}))

/**
 * camelCase form key to snake_case column, written out rather than derived.
 *
 * A name-mangling shortcut would let a renamed field quietly write to a different
 * column. Mapping every key by hand means a key that no longer has a column fails the
 * type check.
 */

const DB_FIELD: Record<CustomerEntryFieldKey, keyof CustomerRow> = {
  fullName: "full_name",

  fatherHusbandName: "father_husband_name",

  cnic: "cnic",

  dateOfBirth: "date_of_birth",

  gender: "gender",

  phone: "phone",

  whatsapp: "whatsapp",

  email: "email",

  addressLine1: "address_line1",

  addressLine2: "address_line2",

  city: "city",

  stateRegion: "state_region",

  postalCode: "postal_code",

  country: "country",

  permanentAddressLine1: "permanent_address_line1",

  permanentAddressLine2: "permanent_address_line2",

  permanentCity: "permanent_city",

  permanentStateRegion: "permanent_state_region",

  permanentPostalCode: "permanent_postal_code",

  permanentCountry: "permanent_country",

  customerType: "customer_type",

  occupation: "occupation",

  idDocumentType: "id_document_type",

  idDocumentNumber: "id_document_number",

  idIssuingAuthority: "id_issuing_authority",

  idIssueDate: "id_issue_date",

  idExpiryDate: "id_expiry_date",

  nomineeName: "nominee_name",

  nomineeRelationship: "nominee_relationship",

  nomineePhone: "nominee_phone",

  nomineeEmail: "nominee_email",

  nextOfKinName: "next_of_kin_name",

  nextOfKinRelationship: "next_of_kin_relationship",

  nextOfKinPhone: "next_of_kin_phone",

  nextOfKinEmail: "next_of_kin_email",

  notes: "notes",
}

/** Every field the form can write, in the order the INSERT and UPDATE bind them. */

const CUSTOMER_FIELDS = Object.keys(DB_FIELD) as CustomerEntryFieldKey[]

/** Date-shaped fields, checked as calendar days rather than as text of the right length. */

const DATE_FIELDS: CustomerEntryFieldKey[] = [
  "dateOfBirth",

  "idIssueDate",

  "idExpiryDate",
]

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false

  const date = new Date(`${value}T00:00:00.000Z`)

  return (
    !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
  )
}

/**
 * Whether the Pakistani identity and number rules apply to this save.
 *
 * Decided by the workspace's own country, passed in from the handler rather than read
 * inside the validator, so the one function the form and the import both call stays
 * free of the database.
 */

interface EntryOptions {
  pakistan: boolean
}

function buildValues(
  body: Record<string, unknown>,

  options: EntryOptions,

  existing?: CustomerRow,
): CustomerBuildResult {
  const errors: Record<string, string> = {}

  const values = {} as CustomerValues

  for (const rule of FIELD_RULES) {
    const current = existing ? existing[DB_FIELD[rule.key]] : null

    const raw =
      body[rule.key] === undefined && existing ? current : body[rule.key]

    if (rule.required && (typeof raw !== "string" || raw.trim() === "")) {
      errors[rule.key] = `${
        REQUIRED_LABELS[rule.key] ?? customerFieldLabel(rule.key)
      } is required.`

      values[rule.key] = ""

      continue
    }

    if (raw === undefined || raw === null || raw === "") {
      values[rule.key] = null

      continue
    }

    if (typeof raw !== "string") {
      errors[rule.key] = "Enter text."

      values[rule.key] = null

      continue
    }

    const value = raw.trim()

    if (value.length > rule.max)
      errors[rule.key] = `Use ${rule.max} characters or fewer.`

    values[rule.key] = value || null
  }

  // --- Identity -------------------------------------------------------------

  if (values.cnic) {
    const digits = normalizeCnic(values.cnic)

    if (!isCnic(digits)) {
      errors.cnic =
        "A CNIC is the 13 digits from the card, written 42101-1234567-1. Leave it blank if the card has not been seen."
    } else {
      // Stored as bare digits so a duplicate check matches however it was typed.

      values.cnic = digits
    }
  }

  // Both closed lists are refused rather than defaulted: a value nobody can name is a
  // record that will not group, filter, or report, and a silent fallback would hide the
  // mistype from the officer who can fix it.

  if (values.customerType && !isCustomerType(values.customerType))
    errors.customerType = closedListError(Object.values(CUSTOMER_TYPE_LABELS))

  if (values.gender && !isCustomerGender(values.gender))
    errors.gender = closedListError(Object.values(CUSTOMER_GENDER_LABELS))

  // --- Numbers --------------------------------------------------------------

  const phoneKeys: CustomerEntryFieldKey[] = [
    "phone",

    "whatsapp",

    "nomineePhone",

    "nextOfKinPhone",
  ]

  for (const key of phoneKeys) {
    const value = values[key]

    if (!value) continue

    if (!PHONE_PATTERN.test(value)) {
      errors[key] = "Enter a valid phone number."

      continue
    }

    // A Pakistani workspace is held to Pakistani numbers on its own two contact fields.
    // A nominee's or next of kin's number may legitimately sit abroad, so it is left
    // exactly as typed rather than rewritten into a country nobody wrote.

    if (!options.pakistan || (key !== "phone" && key !== "whatsapp")) continue

    if (!isPkPhone(value)) {
      errors[key] =
        key === "phone"
          ? PK_PHONE_ERROR
          : `WhatsApp reminders only reach a mobile number. ${PK_PHONE_HINT}`

      continue
    }

    if (key === "whatsapp" && !isWhatsappNumber(value)) {
      errors.whatsapp =
        "WhatsApp needs a mobile number — a landline cannot receive it."

      continue
    }

    values[key] = normalizePkPhone(value)
  }

  for (const key of ["email", "nomineeEmail", "nextOfKinEmail"] as const) {
    const value = values[key]

    if (value && !EMAIL_PATTERN.test(value))
      errors[key] = "Enter a valid email address."
  }

  for (const key of DATE_FIELDS) {
    const value = values[key]

    if (value && !validDate(value)) errors[key] = "Enter a valid date."
  }

  if (
    values.idIssueDate &&
    values.idExpiryDate &&
    values.idExpiryDate < values.idIssueDate
  ) {
    errors.idExpiryDate = "Expiry date cannot be before issue date."
  }

  if (Object.keys(errors).length > 0)
    throw badRequest("Check the highlighted fields", errors)

  for (const key of ["email", "nomineeEmail", "nextOfKinEmail"] as const) {
    const value = values[key]

    if (value) values[key] = value.toLowerCase()
  }

  return { values, errors }
}

/**
 * What the save took but the officer should still look at.
 *
 * A warning never blocks: the record stands exactly as typed, because the person holding
 * the card knows things the field cannot check. A date of birth that makes the buyer a
 * minor, or that has not happened yet, is legal to store and wrong to say nothing about.
 */

function entryWarnings(values: CustomerValues, today: string): string[] {
  const warnings: string[] = []

  const dobWarning = dateOfBirthWarning(values.dateOfBirth, today)

  if (dobWarning) warnings.push(dobWarning)

  return warnings
}

/**
 * The row as the shared rules read it.
 *
 * `customerMissingFieldLabels` and the import both take the camelCase record rather than a
 * database row, so the answer a list gives, the answer the form gives and the answer the
 * Missing-information report gives all come from one shape.
 */

function customerValuesFromRow(row: CustomerRow): CustomerValues {
  const values = {} as CustomerValues

  // `?? null` because two of the joined columns are optional on the row type; a lead that
  // did not survive a delete must not turn an absent value into `undefined` in the record.

  for (const key of CUSTOMER_FIELDS) values[key] = row[DB_FIELD[key]] ?? null

  return values
}

/**
 * A customer as the API answers.
 *
 * `cnic` is present only for a reader who holds `customers.edit`, while `cnicMasked` is
 * present for anyone who can see the row at all: a desk needs to recognise a person in a
 * list, and a list of identity numbers is not what it needs. The decision is made here
 * rather than trusted from the browser because the grants live in this process's database.
 *
 * Phone and CNIC are returned as stored — the CNIC in its grouped reading form — and the
 * client formats them with the same shared functions, so no field arrives in two shapes.
 */

function toCustomer(row: CustomerRow, canViewCnic: boolean) {
  const values = customerValuesFromRow(row)

  return {
    id: row.id,

    name: row.full_name,

    fatherHusbandName: row.father_husband_name,

    cnic: canViewCnic ? formatCnic(row.cnic) : null,

    cnicMasked: maskCnic(row.cnic),

    dateOfBirth: row.date_of_birth,

    gender: row.gender,

    phone: row.phone,

    whatsapp: row.whatsapp,

    email: row.email,

    addressLine1: row.address_line1,

    addressLine2: row.address_line2,

    city: row.city,

    stateRegion: row.state_region,

    postalCode: row.postal_code,

    country: row.country,

    permanentAddressLine1: row.permanent_address_line1,

    permanentAddressLine2: row.permanent_address_line2,

    permanentCity: row.permanent_city,

    permanentStateRegion: row.permanent_state_region,

    permanentPostalCode: row.permanent_postal_code,

    permanentCountry: row.permanent_country,

    customerType: row.customer_type,

    occupation: row.occupation,

    notes: row.notes,

    idDocumentType: row.id_document_type,

    idDocumentNumber: row.id_document_number,

    idIssuingAuthority: row.id_issuing_authority,

    idIssueDate: row.id_issue_date,

    idExpiryDate: row.id_expiry_date,

    nomineeName: row.nominee_name,

    nomineeRelationship: row.nominee_relationship,

    nomineePhone: row.nominee_phone,

    nomineeEmail: row.nominee_email,

    nextOfKinName: row.next_of_kin_name,

    nextOfKinRelationship: row.next_of_kin_relationship,

    nextOfKinPhone: row.next_of_kin_phone,

    nextOfKinEmail: row.next_of_kin_email,

    source: row.lead_source ?? null,

    projectInterest: row.project_interest ?? null,

    sourceLeadId: row.source_lead_id,

    /** Who first put this person in the workspace. Null for a record that predates the column. */

    createdByName: row.created_by_name,

    /** Labels, not keys: this string is shown to the officer as what to go and collect. */

    missingBookingFields: customerMissingFieldLabels(values),

    createdAt: row.created_at,

    updatedAt: row.updated_at,
  }
}

// --- Duplicates -------------------------------------------------------------

type DuplicateRow = {
  id: string

  full_name: string

  phone: string

  cnic: string | null
}

interface DuplicateCustomer {
  id: string

  name: string

  cnicMasked: string | null

  phone: string

  reason: string
}

/**
 * Other records already carrying this identity.
 *
 * A warning, never a refusal: the office knows things the database cannot see — a husband
 * and wife booking together share a number, and a name spelled a second way is usually
 * the same buyer rather than a mistake. Two files for one customer is a real cost all the
 * same, so the save answer names who else matches and on what, and the officer decides.
 *
 * Matching is on the stored value. A Pakistani workspace normalizes numbers on the way in,
 * so its duplicates surface however the digits were typed; elsewhere a number written two
 * ways reads as two people, which is why the CNIC, not the phone, is the reliable key.
 */

function findDuplicateCustomers(
  tenantId: string,

  values: {
    cnic: string | null
    phone: string | null
  },

  excludeId: string | null,
): DuplicateCustomer[] {
  const cnic = values.cnic ?? ""

  const phone = values.phone ?? ""

  if (!cnic && !phone) return []

  const rows = all<DuplicateRow>(
    `SELECT id, full_name, phone, cnic
       FROM customers
      WHERE tenant_id = ? AND id <> ?
        AND ((cnic IS NOT NULL AND cnic <> '' AND cnic = ?)
          OR (phone IS NOT NULL AND phone <> '' AND phone = ?))
      ORDER BY created_at DESC
      LIMIT 10`,

    tenantId,

    excludeId ?? "",

    cnic,

    phone,
  )

  return rows.map((row) => {
    const reasons: string[] = []

    if (cnic && row.cnic === cnic) reasons.push("the same CNIC")

    if (phone && row.phone === phone) reasons.push("the same phone number")

    return {
      id: row.id,

      name: row.full_name,

      cnicMasked: maskCnic(row.cnic),

      phone: row.phone,

      reason: reasons.join(" and "),
    }
  })
}

// --- Edit history -----------------------------------------------------------

type CustomerEditEventRow = {
  id: string

  customer_id: string

  user_id: string

  user_name: string

  action: string

  changes: string

  source: string

  recorded_at: string
}

/**
 * A stored value as the history prints it.
 *
 * The CNIC goes back masked in both directions, so an edit trail cannot become a wider
 * way of reading an identity number than the record itself offers: a reader who could not
 * see the whole number still sees when it changed, in the same form the list shows. Closed
 * lists print their labels, because "overseas_pakistani" is not a word at a desk.
 */

function historyValue(
  key: CustomerEntryFieldKey,

  value: string | null,
): string | null {
  if (value === null || value === "") return null

  if (key === "cnic") return maskCnic(value)

  if (key === "customerType" && isCustomerType(value))
    return CUSTOMER_TYPE_LABELS[(value as CustomerType)]

  if (key === "gender" && isCustomerGender(value))
    return CUSTOMER_GENDER_LABELS[(value as CustomerGender)]

  return value
}

function changedCustomerFields(
  existing: CustomerRow,

  values: CustomerValues,
): CustomerEditChange[] {
  const changes: CustomerEditChange[] = []

  for (const key of CUSTOMER_FIELDS) {
    const before = existing[DB_FIELD[key]] ?? null

    const after = values[key] ?? null

    if (before === after) continue

    changes.push({
      field: key,

      label: customerFieldLabel(key),

      from: historyValue(key, before),

      to: historyValue(key, after),
    })
  }

  return changes
}

interface EditEventInput {
  tenantId: string

  customerId: string

  userId: string

  userName: string

  action: CustomerEditEventAction

  changes: CustomerEditChange[]

  source: CustomerEditEventSource

  recordedAt: string
}

/**
 * One row per save, carrying one entry per field that moved.
 *
 * Not one row per field: a save that changed four things is one act by one person at one
 * moment, and splitting it would bury the trail in near-identical rows while letting a
 * reader think four separate edits happened.
 */

function recordEditEvent(input: EditEventInput): void {
  run(
    `INSERT INTO customer_edit_events (
        id, tenant_id, customer_id, user_id, user_name, action, changes, source,
        recorded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,

    newId("cev"),

    input.tenantId,

    input.customerId,

    input.userId,

    input.userName,

    input.action,

    JSON.stringify(input.changes),

    input.source,

    input.recordedAt,
  )
}

/**
 * The stored action, as this product's own list knows it.
 *
 * An unrecognised value reads as an edit rather than blanking the row: the who and the
 * when are still true, and a history that disappears is worse than one that says less.
 */

function editEventAction(value: string): CustomerEditEventAction {
  return (CUSTOMER_EDIT_EVENT_ACTIONS as readonly string[]).includes(value)
    ? value as CustomerEditEventAction
    : "updated"
}

function toEditEvent(row: CustomerEditEventRow): CustomerEditEvent {
  let changes: CustomerEditChange[] = []

  try {
    const parsed: unknown = JSON.parse(row.changes)

    if (Array.isArray(parsed)) changes = (parsed as CustomerEditChange[])
  } catch {
    // A corrupt payload must not blank the trail. The who and when are still true.
  }

  const action = editEventAction(row.action)

  return {
    id: row.id,

    action,

    actionLabel: CUSTOMER_EDIT_EVENT_LABELS[action],

    source: row.source,

    userId: row.user_id,

    userName: row.user_name,

    recordedAt: row.recorded_at,

    changes,
  }
}

const CUSTOMER_SELECT = `
  SELECT c.*,
         l.source AS lead_source,
         l.project_interest AS project_interest
    FROM customers c
    LEFT JOIN leads l ON l.id = c.source_lead_id AND l.tenant_id = c.tenant_id
`

function readCustomer(tenantId: string, customerId: string): CustomerRow {
  const row = get<CustomerRow>(
    `${CUSTOMER_SELECT} WHERE c.tenant_id = ? AND c.id = ?`,

    tenantId,

    customerId,
  )

  if (!row) throw notFound("That customer does not exist")

  return row
}

export async function listCustomers(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "customers", "view")

  const canEdit = guarded.can("customers", "edit")

  const rows = all<CustomerRow>(
    `${CUSTOMER_SELECT} WHERE c.tenant_id = ? ORDER BY c.created_at DESC, c.full_name COLLATE NOCASE`,

    guarded.tenantId,
  )

  return {
    customers: rows.map((row) => toCustomer(row, canEdit)),

    canCreate: guarded.can("customers", "create"),

    canEdit,
  }
}

export async function getCustomer(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "customers", "view")

  const customerId = ctx.params.id

  if (!customerId) throw notFound("That customer does not exist")

  const canEdit = guarded.can("customers", "edit")

  return {
    customer: toCustomer(
      readCustomer(guarded.tenantId, customerId),

      canEdit,
    ),

    canEdit,
  }
}

/**
 * POST /api/customers — a person typed in from the paper form.
 *
 * The save always happens. A second record with the same CNIC is reported beside the
 * result rather than thrown back as a failure, because the officer can tell in two seconds
 * what the database cannot guess in two hundred: whether these are the same buyer. The
 * edit event is written in the same transaction as the row, so a customer never exists
 * without the record of who put it here.
 */

export async function createCustomer(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "customers", "create")

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const { values } = buildValues(body, {
    pakistan: tenantIsPakistan(guarded.tenantId),
  })

  const customerId = newId("cus")

  const stamp = new Date().toISOString()

  const columns = [
    ...CUSTOMER_FIELDS.map((key) => DB_FIELD[key]),

    "created_by_user_id",

    "created_by_name",
  ]

  const placeholders = columns.map(() => "?").join(", ")

  transaction(() => {
    run(
      `INSERT INTO customers (id, tenant_id, ${columns.join(", ")}, created_at, updated_at)
       VALUES (?, ?, ${placeholders}, ?, ?)`,

      customerId,

      guarded.tenantId,

      ...CUSTOMER_FIELDS.map((key) => values[key]),

      guarded.userId,

      guarded.session.user.fullName,

      stamp,

      stamp,
    )

    recordEditEvent({
      tenantId: guarded.tenantId,

      customerId,

      userId: guarded.userId,

      userName: guarded.session.user.fullName,

      action: "created",

      changes: [],

      source: "form",

      recordedAt: stamp,
    })
  })

  writeAudit(
    guarded,
    "customer.created",
    "customer",

    customerId,

    { name: values.fullName },

    ctx.ip,
  )

  const row = readCustomer(guarded.tenantId, customerId)

  return {
    customer: toCustomer(row, guarded.can("customers", "edit")),

    duplicates: findDuplicateCustomers(
      guarded.tenantId,

      { cnic: values.cnic, phone: values.phone },

      customerId,
    ),

    warnings: entryWarnings(values, tenantToday(guarded.tenantId)),
  }
}

/**
 * PATCH /api/customers/:id — a correction, logged field by field.
 *
 * A PATCH carries only the fields the form sent, so an untouched field keeps its stored
 * value. What changed is written as one event with one entry per field, with the CNIC
 * masked in the payload: the trail is for the next officer, not a second way to read an
 * identity number.
 */

export async function updateCustomer(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "customers", "edit")

  const customerId = ctx.params.id

  if (!customerId) throw notFound("That customer does not exist")

  const existing = readCustomer(guarded.tenantId, customerId)

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const { values } = buildValues(
    body,

    { pakistan: tenantIsPakistan(guarded.tenantId) },

    existing,
  )

  const changes = changedCustomerFields(existing, values)

  const assignments = CUSTOMER_FIELDS.map((key) => `${DB_FIELD[key]} = ?`).join(
    ", ",
  )

  const stamp = new Date().toISOString()

  transaction(() => {
    run(
      `UPDATE customers SET ${assignments}, updated_at = ? WHERE tenant_id = ? AND id = ?`,

      ...CUSTOMER_FIELDS.map((key) => values[key]),

      stamp,

      guarded.tenantId,

      customerId,
    )

    // An untouched save leaves no trail: a history of "nothing changed at 14:32" is noise
    // that hides the edits somebody actually made.

    if (changes.length > 0)
      recordEditEvent({
        tenantId: guarded.tenantId,

        customerId,

        userId: guarded.userId,

        userName: guarded.session.user.fullName,

        action: "updated",

        changes,

        source: "form",

        recordedAt: stamp,
      })
  })

  writeAudit(
    guarded,
    "customer.updated",

    "customer",

    customerId,

    { name: values.fullName, fields: changes.map((change) => change.field) },

    ctx.ip,
  )

  const row = readCustomer(guarded.tenantId, customerId)

  return {
    // The guard above already required `customers.edit`, so the whole CNIC is this
    // caller's to read; the masking decision stays in one function either way.
    customer: toCustomer(row, guarded.can("customers", "edit")),

    changedCount: changes.length,

    duplicates: findDuplicateCustomers(
      guarded.tenantId,

      { cnic: values.cnic, phone: values.phone },

      customerId,
    ),

    warnings: entryWarnings(values, tenantToday(guarded.tenantId)),
  }
}

/**
 * GET /api/customers/:id/edit-history — who typed what, newest first.
 *
 * Reading the trail needs `customers.view`, not `customers.edit`: the question a desk asks
 * is usually "when did this address change", and it should not have to be the person who
 * can change it to ask. CNIC values arrive already masked, so the route cannot leak one to
 * a reader who could not have read it.
 */

export async function listCustomerEditHistory(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "customers", "view")

  const customerId = ctx.params.id

  if (!customerId) throw notFound("That customer does not exist")

  // Reads the row before the trail, so a cross-tenant id answers 404 rather than an empty
  // history that quietly suggests the customer does not exist here.

  readCustomer(guarded.tenantId, customerId)

  const rows = all<CustomerEditEventRow>(
    `SELECT id, customer_id, user_id, user_name, action, changes, source, recorded_at
       FROM customer_edit_events
      WHERE tenant_id = ? AND customer_id = ?
      ORDER BY recorded_at DESC, id DESC`,

    guarded.tenantId,

    customerId,
  )

  return { events: rows.map(toEditEvent) }
}
