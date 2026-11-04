/**
 * Audit-log vocabulary shared by the server and the client.
 *
 * `audit_log` is the workspace's immutable event trail: every privileged action
 * already writes a row with a dotted `action` (like `project.booking.cancelled`),
 * an actor, a target, and a free-form JSON `detail`. Nothing here stores anything
 * new — this file only gives that trail a *readable* shape so the Audit Log page,
 * its filters, and its export can agree on which module an action belongs to and
 * how to present the values behind it.
 *
 * The module taxonomy is derived from the action string, not a new column, so a
 * row is categorised the same way whether it was written today or months ago. It
 * deliberately errs towards the money and paperwork trails the desk actually
 * reviews — bookings, price/inventory changes, waivers, payments, cancellations,
 * transfers, documents — and folds the rest into a small set of buckets rather
 * than inventing a module for every route prefix. Where an action matches none,
 * it lands in `other` rather than being dropped or mislabelled.
 */

/** The filterable module buckets, in the order the filter lists them. */

export const AUDIT_MODULE_IDS = [
  "booking",

  "cancellation",

  "payment",

  "transfer",

  "refund",

  "inventory",

  "document",

  "expense",

  "construction",

  "procurement",

  "vendor",

  "campaign",

  "approval",

  "signature",

  "ticket",

  "late_fee",

  "customer",

  "lead",

  "saved_view",

  "user",

  "settings",

  "assistant",

  "other",
] as const

export type AuditModuleId = typeof AUDIT_MODULE_IDS[number]

export const AUDIT_MODULE_LABELS: Record<AuditModuleId, string> = {
  booking: "Bookings",

  cancellation: "Cancellations",

  payment: "Payments & collections",

  transfer: "Transfers",

  refund: "Refunds",

  inventory: "Inventory & pricing",

  document: "Documents",

  expense: "Expenses",

  construction: "Construction",

  procurement: "Procurement",

  vendor: "Vendors",

  campaign: "Campaigns",

  approval: "Approvals",

  signature: "Documents & signatures",

  ticket: "Tickets & portal",

  late_fee: "Late fees & waivers",

  customer: "Customers",

  lead: "Leads",

  saved_view: "Saved views",

  user: "Users & access",

  settings: "Settings",

  assistant: "Assistant queries",

  other: "Other",
}

/**
 * Action-prefix → module rules, evaluated top to bottom, first match wins.
 *
 * Ordered most-specific first: `project.booking.cancel…` is a cancellation and
 * must be tested before the generic `project.booking…` booking rule, and the
 * `tenant.late_fee…` / `tenant.cancellation…` overrides before the `tenant`
 * settings catch-all. Prefixes are matched against the raw `action` string, so a
 * new route that follows the existing `<area>.<event>` convention is classified
 * correctly with no change here.
 */

export const AUDIT_MODULE_RULES: ReadonlyArray<readonly [AuditModuleId, string]> =
  [
    ["assistant", "assistant"],

    ["cancellation", "project.booking.cancel"],

    ["cancellation", "tenant.cancellation"],

    ["late_fee", "late_fee"],

    ["late_fee", "tenant.late_fee"],

    ["refund", "refund"],

    ["transfer", "transfer"],

    ["construction", "construction"],

    ["procurement", "procurement"],

    // The signing ceremony reports under `signature…` and must be tested
    // before the `documents` catch-all, whatever the envelope filed behind it.

    ["signature", "signature"],

    ["document", "documents"],

    ["expense", "expense"],

    ["vendor", "vendor"],

    ["campaign", "campaigns"],

    ["approval", "approval"],

    ["ticket", "tickets"],

    ["ticket", "portal"],

    ["saved_view", "saved_views"],

    ["user", "permission"],

    ["user", "session"],

    ["user", "twofa"],

    ["user", "auth"],

    ["user", "user"],

    ["customer", "customers"],

    ["lead", "lead"],

    ["inventory", "project.inventory"],

    ["inventory", "inventory"],

    ["inventory", "unit"],

    ["payment", "payment"],

    ["payment", "collection"],

    ["booking", "project.booking"],

    ["booking", "booking"],

    ["settings", "settings"],

    ["settings", "tenant"],
  ]

/** The bucket an `action` string falls into; `other` when nothing matches. */

export function categorizeAuditAction(action: string): AuditModuleId {
  for (const [module, prefix] of AUDIT_MODULE_RULES) {
    if (action.startsWith(prefix)) return module
  }

  return "other"
}

/** A row as the page receives it: the trail plus its derived module. */

export interface AuditEntryView {
  id: string

  action: string

  module: AuditModuleId

  moduleLabel: string

  actorEmail: string | null

  actorUserId: string | null

  targetType: string | null

  targetId: string | null

  /** The stored `detail` JSON, parsed to an object (null when absent/invalid). */

  detail: Record<string, unknown> | null

  ip: string | null

  createdAt: string
}

/** One dropdown option with a live count, for the module and user filters. */

export interface AuditFacet {
  value: string

  label: string

  count: number
}

/** The full `GET /api/audit-log` response. */

export interface AuditListResponse {
  entries: AuditEntryView[]

  moduleFacets: AuditFacet[]

  actorFacets: AuditFacet[]

  /** The cap the query ran under, so the page can say when it truncates. */

  limit: number

  truncated: boolean
}

/**
 * One readable change pulled from an entry's `detail`.
 *
 * Most actions record only the resulting values, so `value` is set and the
 * before/after pair is null. Where a detail happens to carry an explicit
 * `before`/`after` object, those are surfaced as `from`/`to` so the page can
 * render a genuine diff — without the write path being rewritten to force one.
 */

export interface AuditChange {
  label: string

  from: string | null

  to: string | null

  value: string | null
}

/** `snake_case_key` → `Snake case key`, for a readable field label. */

function humanizeKey(key: string): string {
  const spaced = key.replace(/_/g, " ").trim()

  if (!spaced) return key

  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/** A cell's raw value as display text; objects/arrays are shown as compact JSON. */

function scalarText(value: unknown): string | null {
  if (value === null || value === undefined) return null

  if (typeof value === "string") return value

  if (typeof value === "number" || typeof value === "boolean")
    return String(value)

  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Turn a parsed `detail` object into a list of readable changes.
 *
 * When the detail carries an explicit `before` and `after` object, the differing
 * fields become `from`/`to` rows (a real diff). Otherwise every key is listed
 * with its recorded value. Keys that hold nothing displayable are skipped so the
 * cell never shows an empty chip.
 */

export function describeAuditChanges(
  detail: Record<string, unknown> | null,
): AuditChange[] {
  if (!detail) return []

  const changes: AuditChange[] = []

  const before = detail.before

  const after = detail.after

  const hasDiff = isPlainObject(before) && isPlainObject(after)

  if (hasDiff) {
    const keys = Array.from(
      new Set([...Object.keys(before), ...Object.keys(after)]),
    )

    for (const key of keys) {
      changes.push({
        label: humanizeKey(key),

        from: scalarText(before[key]),

        to: scalarText(after[key]),

        value: null,
      })
    }

    for (const key of Object.keys(detail)) {
      if (key === "before" || key === "after") continue

      const value = scalarText(detail[key])

      if (value === null) continue

      changes.push({ label: humanizeKey(key), from: null, to: null, value })
    }

    return changes
  }

  for (const key of Object.keys(detail)) {
    const value = scalarText(detail[key])

    if (value === null) continue

    changes.push({ label: humanizeKey(key), from: null, to: null, value })
  }

  return changes
}
