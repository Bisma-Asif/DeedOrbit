/**
 * Post-login dashboard ("command center") vocabulary, shared by the server and
 * the client.
 *
 * One aggregated endpoint answers the whole page: `GET /api/dashboard/overview`
 * returns per-widget envelopes so a slow or broken widget degrades to its own
 * retry card instead of taking the page down. Every figure is derived live from
 * the tenant's own rows — scoped by `tenant_id`, and for a sales agent or a
 * dealer additionally scoped to *their* records — and a metric with no data
 * stays `null` so the tile renders a dash rather than a fabricated zero.
 *
 * The response also carries the role's visibility map: the server decides which
 * widgets a role may see (grants intersected with the product's role presets)
 * and the client hides those sections entirely instead of showing empty boxes.
 */

// --- Filters ---------------------------------------------------------------

export const DASHBOARD_RANGES = [
  "today",

  "week",

  "month",

  "quarter",

  "year",

  "custom",
] as const

export type DashboardRange = typeof DASHBOARD_RANGES[number]

export function isDashboardRange(value: unknown): value is DashboardRange {
  return (
    typeof value === "string" &&
    (DASHBOARD_RANGES as readonly string[]).includes(value)
  )
}

/** How the trend series is bucketed; chosen server-side from the range width. */

export type DashboardGranularity = "day" | "week" | "month"

// --- Widgets ---------------------------------------------------------------

/** Every widget key the overview endpoint can answer for. */

export const DASHBOARD_WIDGETS = [
  "kpis",

  "trend",

  "inventory",

  "projects",

  "installments",

  "approvals",

  "recentBookings",

  "agents",

  "activity",

  "personal",
] as const

export type DashboardWidgetKey = typeof DASHBOARD_WIDGETS[number]

/** The KPI tile keys inside the `kpis` widget; drives which cards render. */

export const DASHBOARD_KPI_KEYS = [
  "sales",

  "collections",

  "receivables",

  "overdue",

  "unitsSold",

  "inventory",

  "customers",

  "leads",

  "expenses",
] as const

export type DashboardKpiKey = typeof DASHBOARD_KPI_KEYS[number]

/** One widget's answer: data, or a failure the card can retry on its own. */
export interface WidgetEnvelopeOk<T> {
  ok: true

  data: T
}

export interface WidgetEnvelopeFail {
  ok: false

  error: string
}

export type WidgetEnvelope<T> = WidgetEnvelopeOk<T> | WidgetEnvelopeFail

// --- Widget payloads -------------------------------------------------------

/** A value, the same figure for the previous window, and a per-bucket tail. */

export interface DashboardKpi {
  value: number | null

  previous: number | null

  /** Percent change vs the previous window; null when it cannot be computed. */

  deltaPct: number | null

  /** Sparkline points, oldest first. Empty when there is no history. */

  sparkline: number[]
}

export interface DashboardUnitsKpi {
  sold: number | null

  total: number | null

  soldPct: number | null

  /** Sold *events* in the window; stock is cumulative, so the badge is not. */

  soldThisPeriod: number | null

  soldPrevious: number | null

  sparkline: number[]
}

export interface DashboardCustomersKpi {
  total: number | null

  newThisPeriod: number | null

  /** Customers added in the previous window, for the trend badge. */

  newPrevious: number | null

  sparkline: number[]
}

export interface DashboardLeadsKpi {
  active: number | null

  newThisPeriod: number | null

  /** Leads created in the previous window, for the trend badge. */

  newPrevious: number | null

  /** Won / (won + lost) over the period, in percent; null when undefined. */

  conversionPct: number | null

  sparkline: number[]
}

export interface DashboardKpis {
  sales: DashboardKpi

  collections: DashboardKpi

  receivables: DashboardKpi

  overdue: DashboardKpi

  unitsSold: DashboardUnitsKpi

  inventory: DashboardKpi

  customers: DashboardCustomersKpi

  leads: DashboardLeadsKpi

  expenses: DashboardKpi
}

/** One trend bucket: money figures, null where the series is not permitted. */

export interface DashboardTrendPoint {
  key: string

  label: string

  sales: number | null

  collections: number | null

  target: number | null
}

export interface DashboardInventorySlice {
  label: string

  count: number
}

export interface DashboardProjectCard {
  id: string

  name: string

  location: string

  status: string

  statusLabel: string

  soldUnits: number

  totalUnits: number

  soldPct: number | null

  availableUnits: number

  collectionsInPeriod: number | null

  /** Plain label for the next committed date, e.g. "Launch" or "Handover". */

  nextDateLabel: string | null

  nextDate: string | null
}

export interface DashboardInstallmentRow {
  installmentId: string

  bookingId: string

  customerId: string

  customerName: string

  projectName: string

  unitCode: string

  dueDate: string

  /** Outstanding balance on the line. Whole money. */

  outstanding: number

  daysOverdue: number

  overdue: boolean

  /** Due within the next 7 days and not overdue. */

  dueSoon: boolean
}

export interface DashboardApprovalRow {
  id: string

  actionKey: string

  actionLabel: string

  summary: string | null

  requestedByName: string

  requestedAt: string
}

export interface DashboardBookingRow {
  id: string

  reference: string

  customerName: string

  projectName: string

  unitCode: string

  amount: number

  agentName: string | null

  status: string

  bookingDate: string
}

export interface DashboardAgentRow {
  userId: string

  name: string

  bookings: number

  value: number

  /** Bookings target for the period's months; null when none was set. */

  target: number | null

  achievedPct: number | null
}

export type DashboardActivityKind = "lead" | "booking" | "payment" | "document"

export interface DashboardActivityRow {
  id: string

  kind: DashboardActivityKind

  text: string

  actorName: string

  at: string
}

/** The agent / dealer self-scoped panel figures. */

export interface DashboardPersonal {
  heading: string

  salesValue: number | null

  bookingsCount: number | null

  openLeads: number | null

  /** Agent: collections target month attainment. Dealer: earned commission. */

  commissionOrTarget: {
    label: string

    value: number | null

    target: number | null

    achievedPct: number | null
  } | null

  scopeNote: string
}

// --- Checklist and meta ----------------------------------------------------

export interface DashboardChecklistStep {
  key: string

  label: string

  description: string

  done: boolean

  /** In-app hash route the step links to. */

  path: string

  actionLabel: string
}

export interface DashboardChecklist {
  steps: DashboardChecklistStep[]

  completedCount: number

  totalCount: number
}

export interface DashboardProjectOption {
  id: string

  name: string
}

/** The approvals payload: the queue plus whether this user may decide it. */
export interface DashboardApprovalsWidget {
  rows: DashboardApprovalRow[]

  canAct: boolean
}

export interface DashboardOverviewMeta {
  currency: string

  generatedAt: string

  range: DashboardRange

  /** Resolved ISO dates of the selected window. */

  from: string

  to: string

  /** Resolved previous window, for the trend badges. */

  previousFrom: string

  previousTo: string

  granularity: DashboardGranularity

  today: string

  /** "tenant", or "self" for an agent/dealer whose rows only they see. */

  scope: "tenant" | "self"

  selectedProjectId: string | null

  projectOptions: DashboardProjectOption[]

  /** False when the workspace has no real rows yet — the get-started state. */

  hasAnyData: boolean

  sampleActive: boolean

  canManageSample: boolean
}

export interface DashboardOverview {
  meta: DashboardOverviewMeta

  /** Widgets this role may see; anything else is not computed or sent. */

  visible: DashboardWidgetKey[]

  kpiKeys: DashboardKpiKey[]

  sections: string[]

  widgets: {
    kpis?: WidgetEnvelope<DashboardKpis>

    trend?: WidgetEnvelope<DashboardTrendPoint[]>

    inventory?: WidgetEnvelope<DashboardInventorySlice[]>

    projects?: WidgetEnvelope<DashboardProjectCard[]>

    installments?: WidgetEnvelope<DashboardInstallmentRow[]>

    approvals?: WidgetEnvelope<DashboardApprovalsWidget>

    recentBookings?: WidgetEnvelope<DashboardBookingRow[]>

    agents?: WidgetEnvelope<DashboardAgentRow[]>

    activity?: WidgetEnvelope<DashboardActivityRow[]>

    personal?: WidgetEnvelope<DashboardPersonal>

    checklist?: WidgetEnvelope<DashboardChecklist>

    documentVerification?: WidgetEnvelope<DashboardDocumentVerification | null>
  }
}

/**
 * The document-verification widget: a tenant-wide read on the verification desk.
 *
 * `pendingReview` / `rejected` count the customer files sitting in those states;
 * `expiringSoon` counts tracked files inside the tenant's widest alert window that
 * are not already past their date. `averageScore` is the mean verification score
 * across customers who actually hold documents, and is null when there is nothing
 * to average — the dash, not a fabricated zero.
 */

export interface DashboardDocumentVerification {
  pendingReview: number

  rejected: number

  expiringSoon: number

  averageScore: number | null
}
