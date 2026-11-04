/**
 * Document-verification core: the catalogue merge and the per-customer checklist.
 *
 * This is the single source of truth for "which papers does this customer need,
 * and where is each one". Both the verification routes and the reminder job read
 * it, so the booking gate, the checklist screen, the queue, and the bulk reminder
 * all agree on the answer rather than each re-deriving it and drifting.
 *
 * The catalogue resolves as: the platform defaults in `shared/document-verification.ts`,
 * with the tenant's override rows from `document_type_catalog` (label / bucket /
 * flags / enabled / order) and `document_type_requirements` (required-ness per
 * customer type) layered on top. An empty override table means "never changed",
 * which is exactly the defaults — no seeding step, no fabricated copy.
 *
 * A checklist slot maps onto `documents.checklist_key`. Several files can fill one
 * slot; the rollup below chooses the state that best reflects them so a re-upload
 * beside an older verified copy still reads as satisfied, and a lone rejection
 * still reads as the action it is.
 */

import {
  computeDocumentChecklistState,
  computeVerificationScore,
  DEFAULT_CATALOG_BY_KEY,
  DEFAULT_DOCUMENT_TYPE_CATALOG,
  daysUntilExpiry,
  expiryAlertLevel,
  isCustomerType,
  parseExpiryAlertDays,
  resolveCustomerType,
  stateSatisfiesRequirement,
  type CustomerType,
  type DocumentChecklistState,
  type DocumentTypeCatalogItem,
  type VerificationScore,
} from "../shared/document-verification.ts"

import type { DocumentType } from "../shared/documents.ts"

import { all, get } from "./db.ts"

/** One catalogue slot after the tenant's overrides are merged over the default. */

export interface ResolvedDocumentType {
  key: string

  label: string

  baseDocType: DocumentType

  sensitive: boolean

  ocr: boolean

  trackExpiry: boolean

  sortOrder: number

  enabled: boolean

  /** Required-ness per customer type, overrides resolved over the default. */

  required: Record<CustomerType, boolean>
}

/** A stored `doc_verification_settings` row, defaulted for an untouched tenant. */

export interface DocVerificationSettings {
  blockBooking: boolean

  blockPlanActivation: boolean

  allowOverride: boolean

  watermarkPreviews: boolean

  retentionDays: number | null

  expiryAlertDays: number[]

  identityMode: "manual" | "provider"
}

interface SettingsRow {
  block_booking: number

  block_plan_activation: number

  allow_override: number

  watermark_previews: number

  retention_days: number | null

  expiry_alert_days: string

  identity_mode: string
}

/** Reads the tenant's policy, or the honest off/manual defaults when there is no row. */

export function getVerificationSettings(
  tenantId: string,
): DocVerificationSettings {
  const row = get<SettingsRow>(
    `SELECT * FROM doc_verification_settings WHERE tenant_id = ?`,

    tenantId,
  )

  if (!row) {
    return {
      blockBooking: false,

      blockPlanActivation: false,

      allowOverride: true,

      watermarkPreviews: true,

      retentionDays: null,

      expiryAlertDays: [60, 30, 7],

      identityMode: "manual",
    }
  }

  return {
    blockBooking: row.block_booking === 1,

    blockPlanActivation: row.block_plan_activation === 1,

    allowOverride: row.allow_override === 1,

    watermarkPreviews: row.watermark_previews === 1,

    retentionDays: row.retention_days,

    expiryAlertDays: parseExpiryAlertDays(row.expiry_alert_days),

    identityMode: row.identity_mode === "provider" ? "provider" : "manual",
  }
}

/** A `document_type_catalog` override row. */

interface CatalogOverrideRow {
  key: string

  label: string

  base_doc_type: string

  sensitive: number

  ocr: number

  track_expiry: number

  sort_order: number

  enabled: number
}

/** A `document_type_requirements` override row. */

interface RequirementRow {
  type_key: string

  customer_type: string

  required: number
}

const BASE_DOC_TYPES: readonly DocumentType[] = [
  "agreement",

  "booking_form",

  "id_copy",

  "receipt",

  "invoice",

  "other",
]

function isBaseDocType(value: unknown): value is DocumentType {
  return (
    typeof value === "string" &&
    (BASE_DOC_TYPES as readonly string[]).includes(value as DocumentType)
  )
}

/**
 * The full resolved catalogue for a tenant, newest override folded in.
 *
 * Default keys come from shared; a tenant row edits the fields it stores and may
 * add a brand-new key. Every item is emitted so the admin screen can list them,
 * and `enabled` gates whether a slot participates in a checklist at all.
 */

export function loadResolvedCatalogue(
  tenantId: string,
): ResolvedDocumentType[] {
  const overrides = all<CatalogOverrideRow>(
    `SELECT * FROM document_type_catalog WHERE tenant_id = ?`,

    tenantId,
  )

  const requirementRows = all<RequirementRow>(
    `SELECT * FROM document_type_requirements WHERE tenant_id = ?`,

    tenantId,
  )

  const requirementMap = new Map<string, boolean>()

  for (const row of requirementRows) {
    if (!isCustomerType(row.customer_type)) continue

    requirementMap.set(
      `${row.type_key}::${row.customer_type}`,

      row.required === 1,
    )
  }

  const byKey = new Map<string, ResolvedDocumentType>()

  for (const item of DEFAULT_DOCUMENT_TYPE_CATALOG) {
    byKey.set(item.key, foldDefault(item, requirementMap))
  }

  for (const row of overrides) {
    const base = byKey.get(row.key)

    const defaultItem = DEFAULT_CATALOG_BY_KEY[row.key]

    const required: Record<CustomerType, boolean> = base
      ? base.required
      : defaultRequired(defaultItem, requirementMap, row.key)

    byKey.set(row.key, {
      key: row.key,

      label: row.label,

      baseDocType: isBaseDocType(row.base_doc_type)
        ? row.base_doc_type
        : (defaultItem?.baseDocType ?? "other"),

      sensitive: row.sensitive === 1,

      ocr: row.ocr === 1,

      trackExpiry: row.track_expiry === 1,

      sortOrder: row.sort_order,

      enabled: row.enabled === 1,

      required,
    })
  }

  return [...byKey.values()].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label),
  )
}

function defaultRequired(
  item: DocumentTypeCatalogItem | undefined,

  requirementMap: Map<string, boolean>,

  key: string,
): Record<CustomerType, boolean> {
  const types: CustomerType[] = ["individual", "company", "overseas_pakistani"]

  const out = {} as Record<CustomerType, boolean>

  for (const type of types) {
    const override = requirementMap.get(`${key}::${type}`)

    out[type] = override ?? item?.requiredFor.includes(type) ?? false
  }

  return out
}

function foldDefault(
  item: DocumentTypeCatalogItem,

  requirementMap: Map<string, boolean>,
): ResolvedDocumentType {
  return {
    key: item.key,

    label: item.label,

    baseDocType: item.baseDocType,

    sensitive: item.sensitive,

    ocr: item.ocr,

    trackExpiry: item.trackExpiry,

    sortOrder: item.sortOrder,

    enabled: true,

    required: defaultRequired(item, requirementMap, item.key),
  }
}

/** A customer's files projected onto their checklist, plus the score. */

export interface DocumentChecklistEntry {
  key: string

  label: string

  baseDocType: DocumentType

  sensitive: boolean

  trackExpiry: boolean

  required: boolean

  state: DocumentChecklistState

  documentId: string | null

  expiresAt: string | null

  reuploadRequested: boolean

  rejectReason: string | null

  verificationStatus: string | null

  verifiedByName: string | null
}

export interface DocumentChecklist {
  customerId: string

  customerName: string

  customerType: CustomerType

  today: string

  entries: DocumentChecklistEntry[]

  missingRequiredKeys: string[]

  score: VerificationScore
}

/** The subset of a stored document the rollup needs. */

interface ChecklistDocumentRow {
  id: string

  checklist_key: string | null

  verification_status: string

  expires_at: string | null

  reupload_requested: number

  reject_reason: string | null

  verified_by_name: string | null

  created_at: string
}

interface CustomerHeadRow {
  full_name: string

  customer_type: string | null
}

const STATE_RANK: Record<DocumentChecklistState, number> = {
  missing: 0,

  uploaded: 1,

  under_review: 2,

  expired: 3,

  rejected: 4,

  verified: 5,
}

/** Projects a stored row onto the shared state input (snake_case -> camelCase). */

function stateOfDoc(
  row: ChecklistDocumentRow,

  todayIso: string,
): DocumentChecklistState {
  return computeDocumentChecklistState(
    {
      verificationStatus: row.verification_status,

      expiresAt: row.expires_at,

      reuploadRequested: row.reupload_requested,
    },

    todayIso,
  )
}

/** Picks the state that best represents several files in one slot. */

function rollupStates(
  states: DocumentChecklistState[],
): DocumentChecklistState {
  if (states.length === 0) return "missing"

  // Verified first (a slot with any live verified copy is satisfied), then the

  // actionable failures (rejected, expired), then the in-flight stages.

  for (const candidate of [
    "verified",

    "rejected",

    "expired",

    "under_review",

    "uploaded",
  ] as DocumentChecklistState[]) {
    if (states.includes(candidate)) return candidate
  }

  return "missing"
}

/**
 * Builds the checklist for one customer.
 *
 * Returns null when the customer does not exist in this tenant, so callers get a
 * truthful "no such record" rather than an empty checklist that looks like a clean
 * file for a person who is not there.
 */

export function buildDocumentChecklist(
  tenantId: string,

  customerId: string,

  todayIso: string,
): DocumentChecklist | null {
  const customer = get<CustomerHeadRow>(
    `SELECT full_name, customer_type FROM customers
      WHERE tenant_id = ? AND id = ?`,

    tenantId,

    customerId,
  )

  if (!customer) return null

  const customerType = resolveCustomerType(customer.customer_type)

  const catalogue = loadResolvedCatalogue(tenantId)

  const docs = all<ChecklistDocumentRow>(
    `SELECT id, checklist_key, verification_status, expires_at,
            reupload_requested, reject_reason, verified_by_name, created_at
       FROM documents
      WHERE tenant_id = ? AND entity_type = 'customer' AND entity_id = ?`,

    tenantId,

    customerId,
  )

  const today = todayIso.slice(0, 10)

  const byKey = new Map<string, ChecklistDocumentRow[]>()

  for (const doc of docs) {
    if (!doc.checklist_key) continue

    const list = byKey.get(doc.checklist_key) ?? []

    list.push(doc)

    byKey.set(doc.checklist_key, list)
  }

  const entries: DocumentChecklistEntry[] = []

  for (const type of catalogue) {
    if (!type.enabled) continue

    const list = (byKey.get(type.key) ?? [])
      .slice()
      .sort(
        (a, b) =>
          STATE_RANK[stateOfDoc(a, today)] - STATE_RANK[stateOfDoc(b, today)] ||
          a.created_at.localeCompare(b.created_at),
      )

    const states = list.map((doc) => stateOfDoc(doc, today))

    const state = rollupStates(states)

    // The representative row shown beside the state: the highest-ranked, most

    // recent file, so the UI can open or reveal the one that earned the badge.

    const representative = list.length > 0 ? list[list.length - 1]! : null

    entries.push({
      key: type.key,

      label: type.label,

      baseDocType: type.baseDocType,

      sensitive: type.sensitive,

      trackExpiry: type.trackExpiry,

      required: type.required[customerType],

      state,

      documentId: representative?.id ?? null,

      expiresAt: representative?.expires_at ?? null,

      reuploadRequested: representative?.reupload_requested === 1,

      rejectReason: representative?.reject_reason ?? null,

      verificationStatus: representative?.verification_status ?? null,

      verifiedByName: representative?.verified_by_name ?? null,
    })
  }

  const missingRequiredKeys = entries

    .filter(
      (entry) => entry.required && !stateSatisfiesRequirement(entry.state),
    )

    .map((entry) => entry.key)

  const score = computeVerificationScore(
    entries.map((entry) => ({
      required: entry.required,

      state: entry.state,
    })),
  )

  return {
    customerId,

    customerName: customer.full_name,

    customerType,

    today,

    entries,

    missingRequiredKeys,

    score,
  }
}

/**
 * Whether every required document for this customer is currently verified.
 *
 * This is the booking / plan-activation gate's question. A customer with no
 * required documents (a catalogue with nothing marked required) passes — there is
 * nothing outstanding to block on — which is the honest reading, not a false lock.
 */

export function allRequiredDocumentsVerified(
  tenantId: string,

  customerId: string,

  todayIso: string,
): boolean {
  const checklist = buildDocumentChecklist(tenantId, customerId, todayIso)

  if (!checklist) return false

  return checklist.entries

    .filter((entry) => entry.required)

    .every((entry) => stateSatisfiesRequirement(entry.state))
}

/** The gate's full answer, so a blocked booking can name what is missing. */

export interface DocumentsGateState {
  ok: boolean

  applies: boolean

  missingKeys: string[]

  missingLabels: string[]

  allowOverride: boolean
}

/**
 * Reads the block rule against the checklist for one gate.
 *
 * `applies` is false when the setting is off for this gate, so the caller leaves
 * the existing behaviour untouched. When it applies and something is outstanding,
 * `missingKeys` / `missingLabels` name the papers and `allowOverride` says whether
 * the logged approval route is available.
 */

export function documentsGateState(
  tenantId: string,

  customerId: string,

  gate: "booking" | "plan_activation",

  todayIso: string,
): DocumentsGateState {
  const settings = getVerificationSettings(tenantId)

  const applies =
    gate === "booking" ? settings.blockBooking : settings.blockPlanActivation

  const checklist = buildDocumentChecklist(tenantId, customerId, todayIso)

  const missing = checklist
    ? checklist.entries.filter(
        (entry) => entry.required && !stateSatisfiesRequirement(entry.state),
      )
    : []

  return {
    ok: !applies || missing.length === 0,

    applies,

    missingKeys: missing.map((entry) => entry.key),

    missingLabels: missing.map((entry) => entry.label),

    allowOverride: settings.allowOverride,
  }
}

/**
 * Whether a second person has already signed off a document override for this
 * customer. The override approval is the release token: once it is `approved`,
 * the block stops holding the customer's bookings and plan activations, so the
 * officer's retry proceeds and the decision is already on the approvals record
 * (requester, decider, reason). A rejected override never releases anything.
 */

export function approvedDocOverrideExists(
  tenantId: string,

  customerId: string,
): boolean {
  return Boolean(
    get<{ id: string }>(
      `SELECT id FROM approvals
        WHERE tenant_id = ?
          AND action_key = 'document_booking_override'
          AND status = 'approved'
          AND entity_type = 'customer'
          AND result_entity_id = ?
        LIMIT 1`,

      tenantId,

      customerId,
    ),
  )
}

/**
 * The expiry rung that should be queued for a tracked document today.
 *
 * Returns the threshold already come due (60, 30, or 7) for a live document whose
 * expiry is inside the window, or null when it is neither within range nor past.
 * A past date is not an alert — it is the `expired` state, flipped by the scan.
 */

export function documentExpiryAlert(
  expiresAt: string,

  todayIso: string,

  alertDays: number[],
): number | null {
  const days = daysUntilExpiry(expiresAt, todayIso)

  return expiryAlertLevel(days, alertDays)
}
