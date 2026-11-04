/**
 * Reports, dashboard, and global-search vocabulary shared by the server and the
 * client.
 *
 * A report is a read-only projection over tables that already exist — bookings,
 * inventory, installments, expenses, transfers, dealers — never a second store of
 * money. The catalogue below is the single source of truth for which report types
 * exist, which filters each one honours, and the shape of a result, so the picker,
 * the filter bar, and the export layer cannot drift from the query that produced
 * the rows.
 *
 * The filter model is deliberately small: a date range, one project, one branch.
 * A branch is an *office a person sits in* (see `migrations/004_projects.sql`), not
 * a property of a project or a unit, so it is only offered for reports whose rows
 * carry a user attribution — an agent, an officer, a dealer's portal user. Where no
 * such attribution exists the branch filter is withheld rather than invented.
 */

/** The eleven report types. The order here is the order the picker shows. */

export const REPORT_IDS = [
  "sales",

  "inventory_status",

  "bookings",

  "collections",

  "overdue_aging",

  "agent_performance",

  "dealer_commissions",

  "project_profitability",

  "expenses",

  "cancellations",

  "transfers",
] as const

export type ReportId = typeof REPORT_IDS[number]

/** The three filters a report can honour. */

export const REPORT_FILTERS = ["date", "project", "branch"] as const

export type ReportFilter = typeof REPORT_FILTERS[number]

export const REPORT_LABELS: Record<ReportId, string> = {
  sales: "Sales",

  inventory_status: "Inventory Status",

  bookings: "Bookings",

  collections: "Collections",

  overdue_aging: "Overdue / Aging",

  agent_performance: "Agent Performance",

  dealer_commissions: "Dealer Commissions",

  project_profitability: "Project Profitability",

  expenses: "Expenses",

  cancellations: "Cancellations",

  transfers: "Transfers",
}

export const REPORT_DESCRIPTIONS: Record<ReportId, string> = {
  sales: "Confirmed booking value by project, agent, and dealer over a period.",

  inventory_status: "Every unit grouped by its current status and value.",

  bookings: "All bookings taken in a period, confirmed and cancelled alike.",

  collections: "Cash allocated against installment schedules over a period.",

  overdue_aging:
    "Open installment lines past due, grouped by delinquency band.",

  agent_performance: "Bookings closed and value delivered per sales agent.",

  dealer_commissions: "Commission earned, paid, and payable per dealer.",

  project_profitability:
    "Booked revenue set against recorded expense per project.",

  expenses: "Costs raised across projects, offices, and campaigns.",

  cancellations:
    "Bookings called off in a period, with their reason and refund.",

  transfers: "Booking transfers between customers and their settlement state.",
}

/** lucide icon names the client maps to components in the picker. */

export const REPORT_ICONS: Record<ReportId, string> = {
  sales: "TrendingUp",

  inventory_status: "Package",

  bookings: "CalendarCheck",

  collections: "HandCoins",

  overdue_aging: "AlarmClock",

  agent_performance: "UserCheck",

  dealer_commissions: "BadgeDollarSign",

  project_profitability: "PieChart",

  expenses: "Receipt",

  cancellations: "Ban",

  transfers: "ArrowLeftRight",
}

/**
 * Which filters each report exposes. `branch` appears only where the report's rows
 * carry a user attribution the server can resolve through `user_branches`.
 */

export const REPORT_SUPPORTED_FILTERS: Record<ReportId, ReportFilter[]> = {
  sales: ["date", "project", "branch"],

  inventory_status: ["project"],

  bookings: ["date", "project", "branch"],

  collections: ["date", "project", "branch"],

  overdue_aging: ["date", "project", "branch"],

  agent_performance: ["date", "project", "branch"],

  dealer_commissions: ["date", "project", "branch"],

  project_profitability: ["date", "project"],

  expenses: ["date", "project"],

  cancellations: ["date", "project"],

  transfers: ["date", "project"],
}

export function isReportId(value: unknown): value is ReportId {
  return (
    typeof value === "string" &&
    (REPORT_IDS as readonly string[]).includes(value)
  )
}

// --- Report result shape ---------------------------------------------------

/** How a cell should be rendered and exported. */

export type ReportCellType = "text" | "number" | "money" | "date" | "badge"

export interface ReportColumn {
  key: string

  label: string

  type: ReportCellType

  /** Right-align a numeric or money column in both the table and the export. */

  align?: "left" | "right"
}

/** One row: every column key maps to a primitive or null (a dash on screen). */

export type ReportCell = string | number | boolean | null

export type ReportRow = Record<string, ReportCell>

/** A `label: value` line printed above the table and echoed into the export meta. */

export interface ReportMetaLine {
  label: string

  value: string
}

/** Column-keyed sums for the totals strip. Money columns only. */

export type ReportTotals = Record<string, number>

/** The full response for `GET /api/reports/:id`. */

export interface ReportResult {
  reportId: ReportId

  title: string

  currency: string

  generatedAt: string

  columns: ReportColumn[]

  rows: ReportRow[]

  totals: ReportTotals

  meta: ReportMetaLine[]

  supportedFilters: ReportFilter[]
}

/** A picker entry for `GET /api/reports`. */

export interface ReportSummary {
  id: ReportId

  label: string

  description: string

  icon: string

  supportedFilters: ReportFilter[]
}

/** The active filter set the client sends and the server echoes back in `meta`. */

export interface ReportFilters {
  from: string | null

  to: string | null

  projectId: string | null

  branchId: string | null
}

// --- Dashboard -------------------------------------------------------------

/** One labeled point in a chart series. */

export interface ChartDatum {
  label: string

  value: number
}

/** A ranked sales-agent line on the dashboard. */

export interface TopAgent {
  name: string

  bookings: number

  value: number
}

/** The executive figures behind the KPI cards. Absent data stays `null`. */

export interface DashboardKpis {
  totalInventory: number

  sold: number

  available: number

  collectionsThisMonth: number | null

  collectionsPriorMonth: number | null

  totalReceivables: number

  overdueAmount: number

  revenue: number

  expense: number

  topAgents: TopAgent[]
}

/** The chart series rendered under the KPI cards. */

export interface DashboardCharts {
  collectionsTrend: ChartDatum[]

  salesByProject: ChartDatum[]

  soldVsAvailable: ChartDatum[]
}

/** The full `GET /api/dashboard/summary` response. */

export interface DashboardSummary {
  currency: string

  period: DashboardPeriod

  kpis: DashboardKpis

  charts: DashboardCharts
}

export const DASHBOARD_PERIODS = ["30d", "90d", "12m"] as const

export type DashboardPeriod = typeof DASHBOARD_PERIODS[number]

export function isDashboardPeriod(value: unknown): value is DashboardPeriod {
  return (
    typeof value === "string" &&
    (DASHBOARD_PERIODS as readonly string[]).includes(value)
  )
}

// --- Global search ---------------------------------------------------------

/** One search hit. `path` is the in-app hash route it links to. */

export interface SearchHit {
  id: string

  label: string

  sublabel: string

  path: string
}

/** Grouped results. A group the caller cannot view is returned empty. */

export interface SearchResults {
  query: string

  projects: SearchHit[]

  units: SearchHit[]

  customers: SearchHit[]

  bookings: SearchHit[]
}
