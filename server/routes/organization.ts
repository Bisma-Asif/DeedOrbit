/**
 * Organization settings: the tenant's own profile, its branches/offices, and
 * the formats used to number invoices, receipts, and bookings.
 *
 * These routes live under `/api/settings/*` and deliberately take no tenant id.
 * That is the strongest form of tenant scoping available: the workspace comes
 * from the session, so there is no caller-supplied value that could be tampered
 * with. It also keeps this module clear of `/api/tenants/:id`, which serves the
 * tenant directory and answers to `users.view` rather than `settings.view`.
 *
 * Every statement still filters on `tenant_id` regardless, so the scoping does
 * not depend on the caller's cooperation.
 *
 * Validation rules come from shared/organization.ts so this file and the
 * settings screen cannot drift apart. The server is the authority; the client
 * calling the same helpers is a convenience, not a guarantee.
 */

import { all, get, run, transaction } from "../db.ts"
import {
  badRequest,
  conflict,
  notFound,
  readJsonBody,
  type RequestContext,
} from "../http.ts"
import { requireAuth, requirePermission, writeAudit } from "../middleware.ts"
import { validateTextFields, type TextRule } from "../validate.ts"
import {
  ADDRESS_MAX,
  ADDRESS_MIN,
  BRANCH_CODE_PATTERN,
  COUNTRY_PATTERN,
  DEFAULT_NUMBER_FORMATS,
  DEFAULT_WORKING_DAYS,
  EMAIL_PATTERN,
  LOGO_MAX_REQUEST_BYTES,
  NAME_MAX,
  NAME_MIN,
  NUMBER_KINDS,
  PHONE_PATTERN,
  POSTAL_PATTERN,
  REGISTRATION_PATTERN,
  TAX_ID_PATTERN,
  fiscalYearFor,
  formatDocumentNumber,
  isCurrencyCode,
  isMonthNumber,
  isNumberKind,
  isTimeZone,
  isValidPadding,
  isValidPrefix,
  isValidWeekday,
  normalizeWorkingDays,
  parseLogoDataUrl,
  type NumberKind,
} from "../../shared/organization.ts"

import { UNIT_PRICE_MAX } from "../../shared/inventory.ts"

import {
  APPROVAL_ACTION_LABELS,
  APPROVAL_ACTIONS,
  APPROVAL_ACTIONS_WITH_THRESHOLD,
  isApprovalAction,
  type ApprovalAction,
} from "../../shared/approvals.ts"

const now = () => new Date().toISOString()

// --- Rows -------------------------------------------------------------------

type SettingsRow = {
  id: string
  name: string
  legal_name: string | null
  slug: string
  status: string
  plan: string
  logo_initials: string | null
  currency: string
  timezone: string
  registration_number: string | null
  tax_id: string | null
  address_line1: string | null
  address_line2: string | null
  city: string | null
  state_region: string | null
  postal_code: string | null
  country_code: string | null
  phone: string | null
  collections_email: string | null
  fiscal_year_start_month: number
  working_days: string
  ocr_capture_enabled: number
  logo_mime: string | null
  logo_data: string | null
  logo_updated_at: string | null
  created_at: string
  updated_at: string
  user_count: number
  active_users: number
}

type BranchRow = {
  id: string
  name: string
  code: string
  is_headquarters: number
  address_line1: string | null
  address_line2: string | null
  city: string | null
  state_region: string | null
  postal_code: string | null
  country_code: string | null
  phone: string | null
  email: string | null
  status: string
  created_at: string
  updated_at: string
}

interface BranchClashRow {
  id: string
  name: string
  code: string
}

type SequenceRow = {
  kind: string
  prefix: string
  padding: number
  next_value: number
  reset_yearly: number
  last_fiscal_year: number | null
  updated_at: string
}

const SETTINGS_SELECT = `
  SELECT t.id, t.name, t.legal_name, t.slug, t.status, t.plan, t.logo_initials,
         t.currency, t.timezone, t.registration_number, t.tax_id,
         t.address_line1, t.address_line2, t.city, t.state_region, t.postal_code,
         t.country_code, t.phone, t.collections_email, t.fiscal_year_start_month,
         t.working_days, t.ocr_capture_enabled, t.logo_mime, t.logo_data, t.logo_updated_at,
         t.created_at, t.updated_at,
         (SELECT COUNT(*) FROM users u WHERE u.tenant_id = t.id AND u.status != 'deactivated') AS user_count,
         (SELECT COUNT(*) FROM users u WHERE u.tenant_id = t.id AND u.status = 'active') AS active_users
    FROM tenants t`

// --- Validation -------------------------------------------------------------

/**
 * Column-name aliases exist because oxfmt rewrites `readonly (keyof T)[]` to
 * `readonly keyof T[]`, which parses as something else entirely. A plain
 * identifier survives formatting intact.
 */
type ProfileColumn = keyof SettingsRow
type BranchColumn = keyof BranchValues

interface ProfileRules {
  text: readonly TextRule[]
  assignment: readonly ProfileColumn[]
}

const PROFILE: ProfileRules = {
  text: [
    {
      key: "name",
      max: NAME_MAX,
      min: NAME_MIN,
      required: true,
      requiredError: `Enter the trading name (min ${NAME_MIN} characters).`,
    },
    {
      key: "legalName",
      max: NAME_MAX,
      min: NAME_MIN,
      required: true,
      requiredError: "Enter the registered legal name.",
    },
    {
      key: "registrationNumber",
      max: 20,
      pattern: REGISTRATION_PATTERN,
      patternError: "Use 6–20 letters, digits, or hyphens, or leave blank.",
    },
    {
      key: "taxId",
      max: 20,
      pattern: TAX_ID_PATTERN,
      patternError: "Use 4–20 letters, digits, or hyphens, or leave blank.",
    },
    {
      key: "addressLine1",
      max: ADDRESS_MAX,
      min: ADDRESS_MIN,
      required: true,
      requiredError: "Enter the street address.",
    },
    { key: "addressLine2", max: ADDRESS_MAX },
    {
      key: "city",
      max: 80,
      min: 2,
      required: true,
      requiredError: "Enter the city.",
    },
    { key: "stateRegion", max: 80 },
    {
      key: "postalCode",
      max: 12,
      pattern: POSTAL_PATTERN,
      patternError:
        "Use 2–12 letters, digits, spaces, or hyphens, or leave blank.",
    },
    {
      key: "countryCode",
      max: 2,
      upper: true,
      pattern: COUNTRY_PATTERN,
      patternError: "Use a two-letter ISO country code, e.g. NG.",
    },
    {
      key: "phone",
      max: 40,
      pattern: PHONE_PATTERN,
      patternError: "Enter a valid phone number, or leave blank.",
    },
    {
      key: "collectionsEmail",
      max: 254,
      pattern: EMAIL_PATTERN,
      patternError: "Enter a valid collections email, or leave blank.",
    },
  ],
  assignment: [
    "name",
    "legal_name",
    "registration_number",
    "tax_id",
    "address_line1",
    "address_line2",
    "city",
    "state_region",
    "postal_code",
    "country_code",
    "phone",
    "collections_email",
  ],
}

const BRANCH_RULES: readonly TextRule[] = [
  {
    key: "name",
    max: NAME_MAX,
    min: NAME_MIN,
    required: true,
    requiredError: "Enter the office name.",
  },
  {
    key: "code",
    max: 8,
    min: 2,
    required: true,
    upper: true,
    pattern: BRANCH_CODE_PATTERN,
    patternError: 'Use 2–8 letters, digits, or hyphens, e.g. "HQ" or "LAG-01".',
  },
  { key: "addressLine1", max: ADDRESS_MAX },
  { key: "addressLine2", max: ADDRESS_MAX },
  { key: "city", max: 80, min: 2 },
  { key: "stateRegion", max: 80 },
  {
    key: "postalCode",
    max: 12,
    pattern: POSTAL_PATTERN,
    patternError:
      "Use 2–12 letters, digits, spaces, or hyphens, or leave blank.",
  },
  {
    key: "countryCode",
    max: 2,
    upper: true,
    pattern: COUNTRY_PATTERN,
    patternError: "Use a two-letter ISO country code, e.g. NG.",
  },
  {
    key: "phone",
    max: 40,
    pattern: PHONE_PATTERN,
    patternError: "Enter a valid phone number, or leave blank.",
  },
  {
    key: "email",
    max: 254,
    pattern: EMAIL_PATTERN,
    patternError: "Enter a valid email address, or leave blank.",
  },
]

type BranchValues = {
  name: string
  code: string
  addressLine1: string | null
  addressLine2: string | null
  city: string | null
  stateRegion: string | null
  postalCode: string | null
  countryCode: string | null
  phone: string | null
  email: string | null
  status: "active" | "inactive"
}

const BRANCH_COLUMNS: readonly BranchColumn[] = [
  "name",
  "code",
  "addressLine1",
  "addressLine2",
  "city",
  "stateRegion",
  "postalCode",
  "countryCode",
  "phone",
  "email",
  "status",
]

/** Maps each validated field to its SQL column in one place. */
const BRANCH_COLUMN_SQL: Record<BranchColumn, string> = {
  name: "name",
  code: "code",
  addressLine1: "address_line1",
  addressLine2: "address_line2",
  city: "city",
  stateRegion: "state_region",
  postalCode: "postal_code",
  countryCode: "country_code",
  phone: "phone",
  email: "email",
  status: "status",
}

// --- Shapers ----------------------------------------------------------------

function workingDaysOf(row: SettingsRow): number[] {
  try {
    const parsed: unknown = JSON.parse(row.working_days)
    if (Array.isArray(parsed)) {
      const days = parsed.map(Number).filter(isValidWeekday)
      const normalized = normalizeWorkingDays(days)
      if (normalized) return normalized
    }
  } catch {
    // Falls through to the default below.
  }
  // Corrupt JSON must not break the settings screen. Fall back to the documented
  // default and let an admin correct it, rather than 500ing.
  return DEFAULT_WORKING_DAYS
}

function toSettings(row: SettingsRow) {
  return {
    id: row.id,
    name: row.name,
    legalName: row.legal_name,
    slug: row.slug,
    status: row.status,
    plan: row.plan,
    logoInitials: row.logo_initials,
    currency: row.currency,
    timezone: row.timezone,
    registrationNumber: row.registration_number,
    taxId: row.tax_id,
    addressLine1: row.address_line1,
    addressLine2: row.address_line2,
    city: row.city,
    stateRegion: row.state_region,
    postalCode: row.postal_code,
    countryCode: row.country_code,
    phone: row.phone,
    collectionsEmail: row.collections_email,
    fiscalYearStartMonth: row.fiscal_year_start_month,
    workingDays: workingDaysOf(row),
    /**
     * Off unless an admin turned it on. Nothing in this product reads a document with a
     * camera, so the flag only decides whether the customer form offers a "scan" control
     * at all — and that control says so plainly rather than filling fields it cannot fill.
     */
    ocrCaptureEnabled: row.ocr_capture_enabled === 1,
    logo: row.logo_data
      ? {
          mime: row.logo_mime,
          dataUrl: row.logo_data,
          updatedAt: row.logo_updated_at,
        }
      : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    userCount: row.user_count,
    activeUsers: row.active_users,
  }
}

function toBranch(row: BranchRow) {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    isHeadquarters: row.is_headquarters === 1,
    addressLine1: row.address_line1,
    addressLine2: row.address_line2,
    city: row.city,
    stateRegion: row.state_region,
    postalCode: row.postal_code,
    countryCode: row.country_code,
    phone: row.phone,
    email: row.email,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export type NumberFormatView = {
  kind: NumberKind
  label: string
  prefix: string
  padding: number
  nextValue: number
  resetYearly: boolean
  updatedAt: string | null
  /** The number the next document will carry, with no counter movement. */
  preview: string
}

const NUMBER_LABELS: Record<NumberKind, string> = {
  invoice: "Invoices",
  receipt: "Receipts",
  booking: "Bookings",
  requisition: "Requisitions",
  purchase_order: "Purchase orders",
}

function toFormat(row: SequenceRow): NumberFormatView {
  const kind = row.kind as NumberKind
  return {
    kind,
    label: NUMBER_LABELS[kind],
    prefix: row.prefix,
    padding: row.padding,
    nextValue: row.next_value,
    resetYearly: row.reset_yearly === 1,
    updatedAt: row.updated_at,
    preview: formatDocumentNumber(row.prefix, row.padding, row.next_value),
  }
}

function fallbackFormat(kind: NumberKind): NumberFormatView {
  const { prefix, padding } = DEFAULT_NUMBER_FORMATS[kind]
  return {
    kind,
    label: NUMBER_LABELS[kind],
    prefix,
    padding,
    nextValue: 1,
    resetYearly: true,
    updatedAt: null,
    preview: formatDocumentNumber(prefix, padding, 1),
  }
}

function allFormats(tenantId: string): NumberFormatView[] {
  const rows = all<SequenceRow>(
    "SELECT * FROM number_sequences WHERE tenant_id = ?",
    tenantId,
  )
  return NUMBER_KINDS.map((kind) => {
    const row = rows.find((candidate) => candidate.kind === kind)
    return row ? toFormat(row) : fallbackFormat(kind)
  })
}

function readSettings(tenantId: string): SettingsRow {
  const row = get<SettingsRow>(`${SETTINGS_SELECT} WHERE t.id = ?`, tenantId)
  if (!row) throw notFound("That workspace does not exist")
  return row
}

function readBranch(tenantId: string, id: string): BranchRow {
  const row = get<BranchRow>(
    "SELECT * FROM branches WHERE tenant_id = ? AND id = ?",
    tenantId,
    id,
  )
  if (!row) throw notFound("That office does not exist")
  return row
}

// --- Profile ----------------------------------------------------------------

/** GET /api/settings/organization */
export async function getOrganization(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "settings", "view")
  return { settings: toSettings(readSettings(guarded.tenantId)) }
}

/**
 * PATCH /api/settings/organization — the organization profile.
 *
 * Only keys present in the body are written, so saving one section cannot
 * clobber a concurrent edit to another. A field sent as `null` or `""` is
 * cleared to NULL rather than ignored. The empty-update check happens before
 * any statement runs, so a no-op request never touches `updated_at`.
 */
export async function updateOrganization(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "settings", "edit")
  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  // A PATCH validates only the fields it was actually sent. Validating the whole
  // rule set would flag every absent required field as missing, which is what
  // turns a one-field save into a 400.
  //
  // The original index is carried through because PROFILE.assignment is aligned
  // with PROFILE.text by position: re-indexing the filtered list would write
  // `city` to the `registration_number` column.
  const present = PROFILE.text
    .map((rule, index) => ({ rule, index }))
    .filter(({ rule }) => rule.key in body)

  const { values, errors } = validateTextFields(
    body,
    present.map(({ rule }) => rule),
  )

  const assignments: string[] = []
  const params: (string | number | null)[] = []

  for (const { rule, index } of present) {
    const column = PROFILE.assignment[index]
    if (!column) continue
    assignments.push(`${column} = ?`)
    // A cleared field must stay NULL. `?? ""` would be wrong here: null is
    // nullish, so it would store an empty string instead of clearing the column.
    const value = values[rule.key]
    params.push(value === undefined ? null : value)
  }

  if ("currency" in body) {
    const currency = String(body.currency ?? "")
      .trim()
      .toUpperCase()
    if (!isCurrencyCode(currency)) {
      errors.currency = "Choose a supported base currency."
    } else {
      assignments.push("currency = ?")
      params.push(currency)
    }
  }

  if ("timezone" in body) {
    const timezone = String(body.timezone ?? "").trim()
    if (!isTimeZone(timezone)) {
      errors.timezone = "Choose a supported time zone."
    } else {
      assignments.push("timezone = ?")
      params.push(timezone)
    }
  }

  if ("fiscalYearStartMonth" in body) {
    const month = Number(body.fiscalYearStartMonth)
    if (!isMonthNumber(month)) {
      errors.fiscalYearStartMonth =
        "Choose the month the financial year starts."
    } else {
      assignments.push("fiscal_year_start_month = ?")
      params.push(month)
    }
  }

  if ("workingDays" in body) {
    const raw = body.workingDays
    if (!Array.isArray(raw)) {
      errors.workingDays = "Send the working days as a list of weekday numbers."
    } else {
      const days = normalizeWorkingDays(raw.map(Number))
      if (!days) {
        errors.workingDays = "Select at least one working day."
      } else {
        assignments.push("working_days = ?")
        params.push(JSON.stringify(days))
      }
    }
  }

  if ("ocrCaptureEnabled" in body) {
    const flag = body.ocrCaptureEnabled
    if (flag !== true && flag !== false) {
      errors.ocrCaptureEnabled = "Say whether documents may be scanned."
    } else {
      assignments.push("ocr_capture_enabled = ?")
      params.push(flag ? 1 : 0)
    }
  }

  if (Object.keys(errors).length > 0) {
    throw badRequest("Check the highlighted fields", errors)
  }
  if (assignments.length === 0) throw badRequest("Nothing to update")

  run(
    `UPDATE tenants SET ${[...assignments, "updated_at = ?"].join(", ")} WHERE id = ?`,
    ...params,
    now(),
    guarded.tenantId,
  )

  writeAudit(
    guarded,
    "tenant.settings_updated",
    "tenant",
    guarded.tenantId,
    { fields: assignments.map((a) => a.replace(" = ?", "")) },
    ctx.ip,
  )

  return { settings: toSettings(readSettings(guarded.tenantId)) }
}

/**
 * PUT /api/settings/organization/logo
 *
 * Reads with a route-specific body cap because a 128 KB image cannot fit the
 * global 64 KB JSON limit once base64-encoded. The cap is passed per call
 * rather than by raising the global default.
 */
export async function uploadOrganizationLogo(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "settings", "edit")
  const body = await readJsonBody<{ logoDataUrl?: unknown }>(
    ctx.req,
    LOGO_MAX_REQUEST_BYTES,
  )

  const parsed = parseLogoDataUrl(body.logoDataUrl)
  if (!parsed.ok) throw badRequest(parsed.error, { logo: parsed.error })

  run(
    `UPDATE tenants SET logo_mime = ?, logo_data = ?, logo_updated_at = ?, updated_at = ?
      WHERE id = ?`,
    parsed.mime,
    parsed.dataUrl,
    now(),
    now(),
    guarded.tenantId,
  )

  writeAudit(
    guarded,
    "tenant.logo_updated",
    "tenant",
    guarded.tenantId,
    { mime: parsed.mime, bytes: parsed.bytes },
    ctx.ip,
  )

  return { settings: toSettings(readSettings(guarded.tenantId)) }
}

/** DELETE /api/settings/organization/logo */
export async function removeOrganizationLogo(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "settings", "edit")

  run(
    `UPDATE tenants
        SET logo_mime = NULL, logo_data = NULL, logo_updated_at = NULL, updated_at = ?
      WHERE id = ?`,
    now(),
    guarded.tenantId,
  )

  writeAudit(
    guarded,
    "tenant.logo_removed",
    "tenant",
    guarded.tenantId,
    null,
    ctx.ip,
  )

  return { settings: toSettings(readSettings(guarded.tenantId)) }
}

// --- Branches ---------------------------------------------------------------

/** GET /api/settings/branches — the caller's offices, headquarters first. */
export async function listBranches(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "settings", "view")

  const rows = all<BranchRow>(
    `SELECT * FROM branches
      WHERE tenant_id = ?
      ORDER BY is_headquarters DESC, name COLLATE NOCASE`,
    guarded.tenantId,
  )

  return {
    branches: rows.map(toBranch),
    canEdit: guarded.can("settings", "edit"),
  }
}

/**
 * GET /api/settings/branches/:id
 *
 * The id is looked up with the tenant predicate in the same statement, so a
 * branch belonging to another workspace is simply not found.
 */
export async function getBranch(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "settings", "view")
  const id = ctx.params.id
  if (!id) throw notFound("That office does not exist")
  return { branch: toBranch(readBranch(guarded.tenantId, id)) }
}

function countActiveBranches(
  tenantId: string,
  exceptId: string | null,
): number {
  const row = get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM branches
      WHERE tenant_id = ? AND status = 'active' AND (? IS NULL OR id != ?)`,
    tenantId,
    exceptId,
    exceptId,
  )
  return row?.n ?? 0
}

/**
 * Headquarters is a single row, so promoting one demotes the rest in the same
 * statement. Doing it here rather than in the UI keeps the invariant true no
 * matter which client writes it.
 */
function setHeadquarters(tenantId: string, branchId: string): void {
  run(
    `UPDATE branches
        SET is_headquarters = CASE WHEN id = ? THEN 1 ELSE 0 END
      WHERE tenant_id = ?`,
    branchId,
    tenantId,
  )
}

/**
 * Builds a complete branch from a possibly-partial input.
 *
 * A PATCH is validated as a whole against the stored row rather than field by
 * field, so a caller cannot half-apply a change that would leave the row
 * invalid — and a rejected update writes nothing at all. Merging first is what
 * keeps `name` and `code` from looking "missing" on a one-field PATCH, and what
 * stops an inactive office from being silently reactivated by an edit that
 * never mentions its status.
 */
interface ValidatedBranch {
  values: BranchValues
  errors: Record<string, string>
}

function buildBranch(
  input: Record<string, unknown>,
  fallback: BranchRow | null,
): ValidatedBranch {
  const merged: Record<string, unknown> = {}

  if (fallback) {
    merged.name = fallback.name
    merged.code = fallback.code
    merged.addressLine1 = fallback.address_line1
    merged.addressLine2 = fallback.address_line2
    merged.city = fallback.city
    merged.stateRegion = fallback.state_region
    merged.postalCode = fallback.postal_code
    merged.countryCode = fallback.country_code
    merged.phone = fallback.phone
    merged.email = fallback.email
    merged.status = fallback.status
  }

  // `undefined` means "not sent" and is ignored; an explicit `null` or "" is a
  // deliberate clear and does override.
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) merged[key] = value
  }

  const { values: text, errors } = validateTextFields(merged, BRANCH_RULES)

  return {
    values: {
      name: text.name ?? "",
      code: text.code ?? "",
      addressLine1: text.addressLine1 ?? null,
      addressLine2: text.addressLine2 ?? null,
      city: text.city ?? null,
      stateRegion: text.stateRegion ?? null,
      postalCode: text.postalCode ?? null,
      countryCode: text.countryCode ?? null,
      phone: text.phone ?? null,
      email: text.email ?? null,
      status: merged.status === "inactive" ? "inactive" : "active",
    },
    errors,
  }
}

function branchColumns(): string {
  return BRANCH_COLUMNS.map((key) => BRANCH_COLUMN_SQL[key]).join(", ")
}

/** The same columns as a SET list. An INSERT wants bare names, an UPDATE wants assignments. */
function branchAssignments(): string {
  return BRANCH_COLUMNS.map((key) => `${BRANCH_COLUMN_SQL[key]} = ?`).join(", ")
}

function branchParams(values: BranchValues): (string | null)[] {
  return BRANCH_COLUMNS.map((key) => values[key])
}

/**
 * Rejects a duplicate office name or code with a field-level message.
 *
 * Two unique indexes back this, but SQLite's default BINARY collation treats
 * "hq" and "HQ" as distinct, so an index alone would let visually identical
 * codes through. This check is case-insensitive; the indexes remain the
 * backstop against a race.
 */
function assertNoBranchClash(
  tenantId: string,
  values: BranchValues,
  exceptId: string | null,
): void {
  const clash = get<BranchClashRow>(
    `SELECT id, name, code FROM branches
      WHERE tenant_id = ? AND id IS NOT ? AND (name = ? COLLATE NOCASE OR code = ? COLLATE NOCASE)
      LIMIT 1`,
    tenantId,
    exceptId,
    values.name,
    values.code,
  )
  if (!clash) return

  if (clash.code === values.code) {
    throw conflict("That office code is already in use", {
      code: "That code is already in use",
    })
  }
  throw conflict("An office with that name already exists", {
    name: "That name is already in use",
  })
}

/** POST /api/settings/branches */
export async function createBranch(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "settings", "edit")
  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const { values, errors } = buildBranch(body, null)
  if (Object.keys(errors).length > 0)
    throw badRequest("Check the highlighted fields", errors)

  assertNoBranchClash(guarded.tenantId, values, null)

  const id = `br_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`
  const stamp = now()

  // The first office a workspace has is its headquarters by definition —
  // otherwise letterhead and contracts would have nothing to point at.
  const wantsHeadquarters =
    body.isHeadquarters === true ||
    countActiveBranches(guarded.tenantId, null) === 0

  run(
    `INSERT INTO branches (id, tenant_id, ${branchColumns()}, is_headquarters, created_at, updated_at)
     VALUES (?, ?, ${BRANCH_COLUMNS.map(() => "?").join(", ")}, 0, ?, ?)`,
    id,
    guarded.tenantId,
    ...branchParams(values),
    stamp,
    stamp,
  )

  if (wantsHeadquarters) setHeadquarters(guarded.tenantId, id)

  writeAudit(
    guarded,
    "branch.created",
    "branch",
    id,
    { name: values.name, code: values.code, isHeadquarters: wantsHeadquarters },
    ctx.ip,
  )

  return { branch: toBranch(readBranch(guarded.tenantId, id)) }
}

/** PATCH /api/settings/branches/:id */
export async function updateBranch(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "settings", "edit")
  const id = ctx.params.id
  if (!id) throw notFound("That office does not exist")

  const existing = readBranch(guarded.tenantId, id)
  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  // Every conflict is raised before the UPDATE, so a rejected request leaves
  // the row exactly as it was.
  if (body.isHeadquarters === false && existing.is_headquarters === 1) {
    throw conflict("A workspace must have one headquarters office", {
      isHeadquarters: "Promote another office before demoting this one",
    })
  }

  const { values, errors } = buildBranch(body, existing)
  if (Object.keys(errors).length > 0)
    throw badRequest("Check the highlighted fields", errors)

  assertNoBranchClash(guarded.tenantId, values, id)

  if (body.status === "inactive" && existing.is_headquarters === 1) {
    if (countActiveBranches(guarded.tenantId, id) === 0) {
      throw conflict("The last active office cannot be deactivated", {
        status: "Add another office before deactivating this one",
      })
    }
    const successor = get<{ id: string }>(
      `SELECT id FROM branches
        WHERE tenant_id = ? AND id != ? AND status = 'active'
        ORDER BY name COLLATE NOCASE LIMIT 1`,
      guarded.tenantId,
      id,
    )
    if (successor) setHeadquarters(guarded.tenantId, successor.id)
  }

  run(
    `UPDATE branches SET ${branchAssignments()}, updated_at = ? WHERE tenant_id = ? AND id = ?`,
    ...branchParams(values),
    now(),
    guarded.tenantId,
    id,
  )

  if (body.isHeadquarters === true) setHeadquarters(guarded.tenantId, id)

  writeAudit(
    guarded,
    "branch.updated",
    "branch",
    id,
    { name: values.name },
    ctx.ip,
  )

  return { branch: toBranch(readBranch(guarded.tenantId, id)) }
}

/**
 * DELETE /api/settings/branches/:id
 *
 * A soft delete: the row is marked inactive rather than removed, because
 * documents already issued against an office must keep resolving their origin.
 */
export async function archiveBranch(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "settings", "edit")
  const id = ctx.params.id
  if (!id) throw notFound("That office does not exist")

  const existing = readBranch(guarded.tenantId, id)

  if (countActiveBranches(guarded.tenantId, id) === 0) {
    throw conflict("The last active office cannot be archived", {
      isHeadquarters: "Add another office before archiving this one",
    })
  }

  // Hand headquarters to another active office first, so the workspace is never
  // left without one even momentarily.
  if (existing.is_headquarters === 1) {
    const successor = get<{ id: string }>(
      `SELECT id FROM branches
        WHERE tenant_id = ? AND id != ? AND status = 'active'
        ORDER BY name COLLATE NOCASE LIMIT 1`,
      guarded.tenantId,
      id,
    )
    if (successor) setHeadquarters(guarded.tenantId, successor.id)
  }

  run(
    `UPDATE branches SET status = 'inactive', is_headquarters = 0, updated_at = ?
      WHERE tenant_id = ? AND id = ?`,
    now(),
    guarded.tenantId,
    id,
  )

  writeAudit(
    guarded,
    "branch.archived",
    "branch",
    id,
    { name: existing.name },
    ctx.ip,
  )

  return { ok: true, id }
}

// --- Document numbering -----------------------------------------------------

function numberingContext(tenantId: string) {
  const settings = readSettings(tenantId)
  return {
    formats: allFormats(tenantId),
    fiscalYear: fiscalYearFor(new Date(), settings.fiscal_year_start_month),
    fiscalYearStartsIn: settings.fiscal_year_start_month,
  }
}

/** GET /api/settings/numbering */
export async function listNumbering(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "settings", "view")
  return {
    ...numberingContext(guarded.tenantId),
    canEdit: guarded.can("settings", "edit"),
  }
}

/**
 * PUT /api/settings/numbering — replace the formats.
 *
 * `nextValue` is deliberately not writable. Hand-editing a live counter is how
 * duplicate document numbers happen, so the only ways to move it are issuing a
 * document or the explicit, audited `resetCounters` flag.
 */
export async function updateNumbering(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "settings", "edit")
  const body = await readJsonBody<{
    formats?: unknown
    resetCounters?: unknown
  }>(ctx.req)

  if (!Array.isArray(body.formats)) {
    throw badRequest("Send the formats to apply", {
      formats: "Send a list of formats",
    })
  }

  const errors: Record<string, string> = {}
  const parsed: {
    kind: NumberKind
    prefix: string
    padding: number
    resetYearly: boolean
  }[] = []
  const seen = new Set<NumberKind>()

  for (const raw of body.formats as unknown[]) {
    const entry = (raw ?? {}) as Record<string, unknown>
    const kind = String(entry.kind ?? "")

    if (!isNumberKind(kind)) {
      errors.formats = "Unknown document type."
      continue
    }
    if (seen.has(kind)) {
      errors[kind] = "Each document type can only be listed once."
      continue
    }

    const prefix = String(entry.prefix ?? "")
    const padding = Number(entry.padding)

    if (!isValidPrefix(prefix)) {
      errors[kind] =
        "Use up to 6 letters or digits, optionally with one trailing separator."
    } else if (!isValidPadding(padding)) {
      errors[kind] = "Use 1–10 digits."
    } else {
      seen.add(kind)
      parsed.push({
        kind,
        prefix,
        padding,
        resetYearly: entry.resetYearly !== false,
      })
    }
  }

  for (const kind of NUMBER_KINDS) {
    if (!seen.has(kind)) errors[kind] = "Every document type needs a format."
  }

  if (Object.keys(errors).length > 0)
    throw badRequest("Check the highlighted fields", errors)

  const resetCounters = body.resetCounters === true
  const stamp = now()

  // Upsert rather than UPDATE: a workspace whose sequences were never seeded
  // must still be able to save formats, or the setting is silently a no-op.
  for (const format of parsed) {
    run(
      `INSERT INTO number_sequences
         (tenant_id, kind, prefix, padding, next_value, reset_yearly, last_fiscal_year, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?)
       ON CONFLICT (tenant_id, kind) DO UPDATE SET
         prefix        = excluded.prefix,
         padding       = excluded.padding,
         reset_yearly  = excluded.reset_yearly,
         next_value    = CASE WHEN ? = 1 THEN 1 ELSE number_sequences.next_value END,
         updated_at    = excluded.updated_at`,
      guarded.tenantId,
      format.kind,
      format.prefix,
      format.padding,
      1,
      format.resetYearly ? 1 : 0,
      stamp,
      resetCounters ? 1 : 0,
    )
  }

  writeAudit(
    guarded,
    "tenant.numbering_updated",
    "tenant",
    guarded.tenantId,
    { kinds: parsed.map((f) => f.kind), resetCounters },
    ctx.ip,
  )

  return { ...numberingContext(guarded.tenantId), canEdit: true }
}

/**
 * POST /api/settings/numbering/:kind/next — issue the next document number.
 *
 * This is what makes the setting real rather than decorative. The read, the
 * reset decision, and the increment all happen inside one transaction, so two
 * concurrent requests cannot be handed the same number. The annual reset only
 * fires when the stored fiscal year is genuinely behind the current one, so
 * calling this endpoint twice cannot rewind the counter.
 */
interface IssuedNumber {
  number: string
  reset: boolean
}

/**
 * Read, fiscal-year reset, and increment for one document number, executed against the
 * open transaction. Split from the HTTP route so that intra-transaction callers — minting
 * a receipt when a payment is recorded, a credit note when a refund is paid — can reserve a
 * number as part of their own atomic write. It must run inside a `transaction()`: the read
 * and the increment cannot be allowed to interleave with a concurrent caller, or two
 * documents would be handed the same number. Throws when the workspace has no format
 * configured for the kind.
 */
export function issueNumberWithinTransaction(
  tenantId: string,
  kind: NumberKind,
): IssuedNumber {
  const current = get<SequenceRow>(
    "SELECT * FROM number_sequences WHERE tenant_id = ? AND kind = ?",
    tenantId,
    kind,
  )
  if (!current)
    throw notFound("No numbering format is configured for this document type")

  const fiscalYear = fiscalYearFor(
    new Date(),
    readSettings(tenantId).fiscal_year_start_month,
  )

  const reset =
    current.reset_yearly === 1 &&
    current.last_fiscal_year !== null &&
    current.last_fiscal_year < fiscalYear

  const value = reset ? 1 : current.next_value

  run(
    `UPDATE number_sequences SET next_value = ?, last_fiscal_year = ?, updated_at = ?
      WHERE tenant_id = ? AND kind = ?`,
    value + 1,
    fiscalYear,
    now(),
    tenantId,
    kind,
  )

  return {
    number: formatDocumentNumber(current.prefix, current.padding, value),
    reset,
  }
}

/** The formatted next document number for a kind, for callers already inside a
 *  transaction who only need the number itself. */
export function nextDocumentNumber(tenantId: string, kind: NumberKind): string {
  return issueNumberWithinTransaction(tenantId, kind).number
}

export async function issueNextNumber(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "settings", "edit")

  const kind = ctx.params.kind ?? ""
  if (!isNumberKind(kind)) throw notFound("Unknown document type")

  const issued = transaction<IssuedNumber>(() =>
    issueNumberWithinTransaction(guarded.tenantId, kind),
  )

  return { kind, ...issued }
}

// --- Approval policies ------------------------------------------------------
//
// Which actions this workspace routes through the maker-checker queue, and above what
// amount. Every policy defaults to disabled, so an untouched tenant keeps the immediate
// booking and cancellation behaviour; the queue only engages once an admin turns a
// policy on here. An amount threshold is meaningful only for the actions that carry one
// (booking, discount), so the others are stored with a zero threshold and read as
// unconditional-when-enabled.

interface ApprovalPolicyRow {
  action_key: string

  enabled: number

  threshold_amount: number
}

/** One validated policy from a PATCH body, ready to upsert. Named so oxfmt cannot
 *  strip the separator from an inline multi-member type literal. */
interface ApprovalPolicyInput {
  actionKey: ApprovalAction

  enabled: boolean

  thresholdAmount: number
}

function readApprovalPolicies(tenantId: string) {
  const rows = all<ApprovalPolicyRow>(
    `SELECT action_key, enabled, threshold_amount
      FROM approval_policies WHERE tenant_id = ?`,
    tenantId,
  )

  return APPROVAL_ACTIONS.map((action) => {
    const row = rows.find((candidate) => candidate.action_key === action)

    return {
      actionKey: action,

      label: APPROVAL_ACTION_LABELS[action],

      enabled: row?.enabled === 1,

      thresholdAmount: row?.threshold_amount ?? 0,

      hasThreshold: APPROVAL_ACTIONS_WITH_THRESHOLD.includes(action),
    }
  })
}

/** GET /api/settings/approval-policies */
export async function getApprovalPolicies(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "settings", "view")

  return {
    policies: readApprovalPolicies(guarded.tenantId),

    canEdit: guarded.can("settings", "edit"),
  }
}

/**
 * PATCH /api/settings/approval-policies — upsert one section of the policy set.
 *
 * Each submitted entry is validated by action, then written as an enabled flag plus a
 * threshold (the threshold only for the actions that carry one). Absent actions are
 * left untouched, so a per-row save never clobbers the others. There is no way to
 * submit an unknown action, and a threshold outside the platform's money range is a
 * field error rather than a stored lie.
 */
export async function updateApprovalPolicies(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "settings", "edit")

  const body = await readJsonBody<{ policies?: unknown }>(ctx.req)

  const raw = body.policies

  if (!Array.isArray(raw)) {
    throw badRequest("Send the policies as a list.", {
      policies: "Send the policies as a list.",
    })
  }

  const errors: Record<string, string> = {}

  const parsed: ApprovalPolicyInput[] = []

  for (const entry of raw) {
    const item = entry as Record<string, unknown>

    const actionKey = item.actionKey

    if (!isApprovalAction(actionKey)) {
      errors.actionKey = "That approval action is not recognised."

      continue
    }

    const enabled = item.enabled === true

    let thresholdAmount = 0

    if (APPROVAL_ACTIONS_WITH_THRESHOLD.includes(actionKey)) {
      const candidate = item.thresholdAmount

      if (
        typeof candidate !== "number" ||
        !Number.isSafeInteger(candidate) ||
        candidate < 0 ||
        candidate > UNIT_PRICE_MAX
      ) {
        errors[`${actionKey}.thresholdAmount`] =
          `Enter a whole number from 0 to ${UNIT_PRICE_MAX}.`

        continue
      }

      thresholdAmount = candidate
    }

    parsed.push({ actionKey, enabled, thresholdAmount })
  }

  if (Object.keys(errors).length > 0) {
    throw badRequest("Check the highlighted fields", errors)
  }

  if (parsed.length === 0) throw badRequest("Nothing to update")

  const stamp = now()

  transaction(() => {
    for (const policy of parsed) {
      run(
        `INSERT INTO approval_policies (
            tenant_id, action_key, enabled, threshold_amount, updated_at
          ) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT (tenant_id, action_key) DO UPDATE SET
            enabled = excluded.enabled,
            threshold_amount = excluded.threshold_amount,
            updated_at = excluded.updated_at`,
        guarded.tenantId,
        policy.actionKey,
        policy.enabled ? 1 : 0,
        policy.thresholdAmount,
        stamp,
      )
    }
  })

  writeAudit(
    guarded,
    "tenant.approval_policies_updated",
    "tenant",
    guarded.tenantId,
    { actions: parsed.map((policy) => policy.actionKey) },
    ctx.ip,
  )

  return {
    policies: readApprovalPolicies(guarded.tenantId),

    canEdit: true,
  }
}
