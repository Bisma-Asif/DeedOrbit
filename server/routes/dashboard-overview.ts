/**
 * The post-login command center — one aggregated, cached, role-aware read.
 *
 * `GET /api/dashboard/overview` answers the whole dashboard in a single call.
 * Each widget is computed inside its own try/catch and returned as a
 * `WidgetEnvelope`, so one broken query degrades to a retry card on that tile
 * instead of taking the page down. `GET /api/dashboard/widget?key=…` re-answers
 * a single widget through the same pipeline (and the same cache) for the
 * client's per-card retry button.
 *
 * Rules the whole module exists to hold:
 *
 *  * Every figure is derived from this tenant's rows — each query carries the
 *    `tenant_id` predicate — and for a sales agent or dealer the money queries
 *    are additionally scoped to *their* bookings/leads. Another tenant's data
 *    cannot appear here even by accident.
 *
 *  * The server decides visibility: a role preset intersected with the DB
 *    grants. Widgets a role may not see are not computed and not sent, so the
 *    client can simply render what arrives.
 *
 *  * A metric with no data is `null`, never a fabricated zero; sparklines with
 *    no history come back as an empty array and the card renders no tail.
 *
 *  * Answers are memoised for 60 seconds per tenant+role+user+window, and the
 *    sample-data loader calls `invalidateDashboardCache` so a demo load or
 *    removal shows immediately.
 */

import { all, get } from "../db.ts"

import { badRequest, type RequestContext } from "../http.ts"

import {
  requireAuth,
  requirePermission,
  type GuardedContext,
} from "../middleware.ts"

import type { Action, PermissionModule } from "../../shared/access.ts"

import { APPROVAL_ACTION_LABELS } from "../../shared/approvals.ts"

import {
  isDashboardRange,
  DASHBOARD_KPI_KEYS,
  DASHBOARD_WIDGETS,
  type DashboardAgentRow,
  type DashboardActivityRow,
  type DashboardApprovalRow,
  type DashboardBookingRow,
  type DashboardChecklist,
  type DashboardDocumentVerification,
  type DashboardCustomersKpi,
  type DashboardGranularity,
  type DashboardInstallmentRow,
  type DashboardInventorySlice,
  type DashboardKpi,
  type DashboardKpiKey,
  type DashboardKpis,
  type DashboardLeadsKpi,
  type DashboardOverview,
  type DashboardPersonal,
  type DashboardProjectCard,
  type DashboardProjectOption,
  type DashboardRange,
  type DashboardTrendPoint,
  type DashboardUnitsKpi,
  type DashboardWidgetKey,
  type WidgetEnvelope,
} from "../../shared/dashboard.ts"

import {
  buildDocumentChecklist,
  getVerificationSettings,
} from "../document-verification-core.ts"

const nowISO = () => new Date().toISOString()

// --- Cache -----------------------------------------------------------------

const CACHE_TTL_MS = 60_000

interface CacheEntry {
  expires: number

  value: DashboardOverview
}

const overviewCache = new Map<string, CacheEntry>()

/** Called by the sample-data loader after any demo write or sweep. */

export function invalidateDashboardCache(tenantId: string): void {
  for (const key of overviewCache.keys()) {
    if (key.startsWith(`${tenantId}|`)) {
      overviewCache.delete(key)
    }
  }
}

// --- Small helpers -----------------------------------------------------------

function num(value: unknown): number {
  if (typeof value === "bigint") return Number(value)

  const n = Number(value ?? 0)

  return Number.isFinite(n) ? n : 0
}

function text(value: unknown): string {
  return String(value ?? "")
}

function tenantToday(tenantId: string): string {
  const timezone =
    get<{ timezone: string }>(
      "SELECT timezone FROM tenants WHERE id = ?",

      tenantId,
    )?.timezone ?? "UTC"

  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,

      year: "numeric",

      month: "2-digit",

      day: "2-digit",
    }).format(new Date())
  } catch {
    return nowISO().slice(0, 10)
  }
}

/** `YYYY-MM-DD` shifted by `days` (negative = into the future). */

function shiftDate(date: string, days: number): string {
  const base = Date.parse(`${date}T00:00:00Z`)

  return new Date(base - days * 86_400_000).toISOString().slice(0, 10)
}

function dayCount(from: string, to: string): number {
  return (
    Math.round(
      (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
        86_400_000,
    ) + 1
  )
}

/** Monday-based, like the Pakistani business week. */

function mondayOf(date: string): string {
  const epochDay = Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000)

  const dow = (epochDay + 3) % 7 // 0 = Monday

  return shiftDate(date, dow)
}

const MONTH_SHORT = [
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

function monthLabel(key: string, multiYear: boolean): string {
  const month = Number(key.slice(5, 7))

  const short = MONTH_SHORT[month - 1] ?? "—"

  return multiYear ? `${short} ${key.slice(2, 4)}` : short
}

// --- Window and buckets ------------------------------------------------------

interface Bucket {
  key: string

  label: string

  start: string

  end: string
}

interface WindowSpec {
  range: DashboardRange

  from: string

  to: string

  previousFrom: string

  previousTo: string

  granularity: DashboardGranularity

  buckets: Bucket[]
}

function resolveWindow(
  query: URLSearchParams,

  today: string,
): WindowSpec {
  const rangeRaw = query.get("range") ?? "month"

  if (!isDashboardRange(rangeRaw)) {
    throw badRequest(`Unknown dashboard range "${String(rangeRaw)}".`)
  }

  const range: DashboardRange = rangeRaw

  let from = today

  if (range === "week") {
    from = mondayOf(today)
  } else if (range === "month") {
    from = `${today.slice(0, 7)}-01`
  } else if (range === "quarter") {
    const month = Number(today.slice(5, 7))

    const quarterStart = Math.floor((month - 1) / 3) * 3 + 1

    from = `${today.slice(0, 4)}-${String(quarterStart).padStart(2, "0")}-01`
  } else if (range === "year") {
    from = `${today.slice(0, 4)}-01-01`
  } else if (range === "custom") {
    const fromRaw = query.get("from") ?? ""

    const toRaw = query.get("to") ?? ""

    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(fromRaw) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(toRaw) ||
      fromRaw > toRaw ||
      toRaw > today
    ) {
      throw badRequest("Custom range needs valid from/to dates up to today.")
    }

    from = fromRaw

    today = toRaw // "to" is the selected end for a custom window
  }

  const to = today

  const length = dayCount(from, to)

  const previousTo = shiftDate(from, 1)

  const previousFrom = shiftDate(previousTo, length - 1)

  const granularity: DashboardGranularity =
    length <= 14 ? "day" : length <= 120 ? "week" : "month"

  return {
    range,

    from,

    to,

    previousFrom,

    previousTo,

    granularity,

    buckets: buildBuckets(granularity, from, to),
  }
}

function buildBuckets(
  granularity: DashboardGranularity,

  from: string,

  to: string,
): Bucket[] {
  const buckets: Bucket[] = []

  if (granularity === "day") {
    let day = from

    while (day <= to) {
      buckets.push({
        key: day,

        label: `${Number(day.slice(8, 10))} ${MONTH_SHORT[Number(day.slice(5, 7)) - 1]}`,

        start: day,

        end: day,
      })

      day = shiftDate(day, -1)
    }

    return buckets
  }

  if (granularity === "week") {
    let day = from

    while (day <= to) {
      const monday = day < mondayOf(day) ? day : mondayOf(day)

      const saturday = shiftDate(monday, -6)

      const end = saturday > to ? to : saturday

      buckets.push({
        key: monday,

        label: `${Number(monday.slice(8, 10))} ${MONTH_SHORT[Number(monday.slice(5, 7)) - 1]}`,

        start: monday,

        end,
      })

      day = shiftDate(end, -1)
    }

    return buckets
  }

  let year = Number(from.slice(0, 4))

  let month = Number(from.slice(5, 7))

  const endYear = Number(to.slice(0, 4))

  const endMonth = Number(to.slice(5, 7))

  const multiYear = year !== endYear

  for (;;) {
    const key = `${year}-${String(month).padStart(2, "0")}`

    const monthStart = `${key}-01`

    const nextMonth =
      month === 12
        ? `${year + 1}-01-01`
        : `${year}-${String(month + 1).padStart(2, "0")}-01`

    const monthEnd = shiftDate(nextMonth, 1)

    buckets.push({
      key,

      label: monthLabel(key, multiYear),

      start: monthStart < from ? from : monthStart,

      end: monthEnd > to ? to : monthEnd,
    })

    if (year === endYear && month === endMonth) break

    month += 1

    if (month === 13) {
      month = 1

      year += 1
    }
  }

  return buckets
}

/** Maps a `YYYY-MM-DD` day onto its bucket index for this granularity. */

function dayToBucketIndex(
  window: WindowSpec,

  day: string,
): number | undefined {
  const index = new Map<string, number>()

  window.buckets.forEach((bucket, i) => index.set(bucket.key, i))

  if (window.granularity === "day") return index.get(day)

  if (window.granularity === "week") {
    let monday = mondayOf(day)

    if (monday < window.from) monday = window.from

    return index.get(monday)
  }

  return index.get(day.slice(0, 7))
}

// --- Visibility --------------------------------------------------------------

const ALL_WIDGETS: DashboardWidgetKey[] = [
  "kpis",

  "trend",

  "inventory",

  "projects",

  "installments",

  "approvals",

  "recentBookings",

  "agents",

  "activity",
]

const ALL_KPI_KEYS: DashboardKpiKey[] = [...DASHBOARD_KPI_KEYS]

/**
 * The owner/admin board is the eight tiles the layout specifies — four per row,
 * two rows. Spend lives on the Accounts desk and the ledger pages, so it is not
 * folded in here even though an owner may read it.
 */

const OWNER_KPI_KEYS: DashboardKpiKey[] = ALL_KPI_KEYS.filter(
  (key) => key !== "expenses",
)

/** The module:action a widget's data needs, checked against the DB grants. */

const WIDGET_PERMS: [string, PermissionModule, Action][] = [
  ["trend", "bookings", "view"],

  ["inventory", "inventory", "view"],

  ["projects", "projects", "view"],

  ["installments", "payments", "view"],

  ["approvals", "approvals", "view"],

  ["recentBookings", "bookings", "view"],

  ["agents", "sales_agents", "view"],

  ["activity", "bookings", "view"],
]

const KPI_PERMS: [DashboardKpiKey, PermissionModule, Action][] = [
  ["sales", "bookings", "view"],

  ["collections", "payments", "view"],

  ["receivables", "payments", "view"],

  ["overdue", "payments", "view"],

  ["unitsSold", "inventory", "view"],

  ["inventory", "inventory", "view"],

  ["customers", "customers", "view"],

  ["leads", "leads", "view"],

  ["expenses", "expenses", "view"],
]

interface Visibility {
  widgets: DashboardWidgetKey[]

  kpiKeys: DashboardKpiKey[]

  personal: boolean

  sections: string[]
}

/**
 * Role presets from the product spec, each then intersected with the tenant's
 * live grants so a per-tenant override wins over the preset.
 */

function visibilityFor(guarded: GuardedContext): Visibility {
  const { roleId, can } = guarded

  let widgets: DashboardWidgetKey[]

  let kpiKeys: DashboardKpiKey[]

  let personal = false

  if (
    roleId === "tenant_owner" ||
    roleId === "tenant_admin" ||
    roleId === "platform_super_admin"
  ) {
    widgets = ALL_WIDGETS

    kpiKeys = OWNER_KPI_KEYS
  } else if (roleId === "sales_manager") {
    widgets = [
      "kpis",

      "trend",

      "inventory",

      "projects",

      "installments",

      "approvals",

      "recentBookings",

      "agents",

      "activity",
    ]

    // Sales figures without the accounting detail.

    kpiKeys = [
      "sales",
      "collections",
      "unitsSold",
      "inventory",
      "customers",
      "leads",
    ]
  } else if (roleId === "sales_agent") {
    widgets = ["recentBookings"]

    kpiKeys = []

    personal = true
  } else if (roleId === "dealer_partner") {
    widgets = ["recentBookings"]

    kpiKeys = []

    personal = true
  } else if (roleId === "recovery_officer") {
    widgets = ["kpis", "trend", "installments", "approvals", "activity"]

    kpiKeys = ["collections", "receivables", "overdue"]
  } else if (roleId === "accounts_officer") {
    widgets = ["kpis", "trend", "installments", "approvals", "activity"]

    kpiKeys = ["collections", "receivables", "overdue", "expenses"]
  } else {
    // Project / procurement managers and anything unforeseen: operations only.

    widgets = ["kpis", "inventory", "projects", "activity"]

    kpiKeys = ["unitsSold", "inventory"]
  }

  const widgetPerms = new Map<string, [PermissionModule, Action]>()

  for (const [key, module, action] of WIDGET_PERMS) {
    widgetPerms.set(key, [module, action])
  }

  const allowedWidgets = widgets.filter((key) => {
    if (key === "kpis") return true

    const need = widgetPerms.get(key)

    return need ? can(need[0], need[1]) : true
  })

  const allowedKpis = kpiKeys.filter((key) => {
    const entry = KPI_PERMS.find(([k]) => k === key)

    return entry ? can(entry[1], entry[2]) : true
  })

  const sections: string[] = []

  if (allowedKpis.length > 0 || personal) sections.push("kpiRow")

  if (
    allowedWidgets.includes("trend") ||
    allowedWidgets.includes("inventory")
  ) {
    sections.push("charts")
  }

  if (allowedWidgets.includes("projects")) sections.push("projects")

  if (
    allowedWidgets.includes("installments") ||
    allowedWidgets.includes("approvals")
  ) {
    sections.push("installmentsApprovals")
  }

  if (roleId === "recovery_officer") sections.push("aging")

  if (
    allowedWidgets.includes("recentBookings") ||
    allowedWidgets.includes("agents") ||
    allowedWidgets.includes("activity")
  ) {
    sections.push("bottom")
  }

  sections.push("quickActions")

  return {
    widgets: personal ? ["personal", ...allowedWidgets] : allowedWidgets,

    kpiKeys: allowedKpis,

    personal,

    sections,
  }
}

// --- Build context -----------------------------------------------------------

/** Self-scope for an agent or dealer; tenant-wide builders ignore it. */

interface PersonalScope {
  kind: "tenant" | "agent" | "dealer"

  userId: string

  dealerId: string
}

interface BuildContext {
  guarded: GuardedContext

  currency: string

  today: string

  window: WindowSpec

  projectId: string | null

  scope: PersonalScope

  /** False for a workspace with no business rows yet — the get-started state. */

  hasAnyData: boolean
}

/**
 * Whether the workspace holds any business row at all. A tenant that has none
 * must not be shown a board of zeros or a flat chart: every figure stays null
 * and every series is left out so the page can render its empty states.
 */

function tenantHasAnyData(tenantId: string): boolean {
  return (
    num(
      get<{ n: SqlNumber }>(
        `SELECT (
            (SELECT COUNT(*) FROM projects WHERE tenant_id = ?) +
            (SELECT COUNT(*) FROM inventory_units WHERE tenant_id = ?) +
            (SELECT COUNT(*) FROM leads WHERE tenant_id = ?) +
            (SELECT COUNT(*) FROM bookings WHERE tenant_id = ?) +
            (SELECT COUNT(*) FROM customers WHERE tenant_id = ?)
          ) AS n`,

        tenantId,

        tenantId,

        tenantId,

        tenantId,

        tenantId,
      )?.n,
    ) > 0
  )
}

function bookingsScopeSql(scope: PersonalScope): string {
  if (scope.kind === "agent") return " AND b.agent_user_id = ?"

  if (scope.kind === "dealer") return " AND b.dealer_id = ?"

  return ""
}

function bookingsScopeParams(scope: PersonalScope): (string | number)[] {
  if (scope.kind === "agent") return [scope.userId]

  if (scope.kind === "dealer") return [scope.dealerId]

  return []
}

function projectSql(bc: BuildContext, column: string): string {
  return bc.projectId ? ` AND ${column} = ?` : ""
}

function projectParams(bc: BuildContext): (string | number)[] {
  return bc.projectId ? [bc.projectId] : []
}

/** Money roll-ups grouped by day, then folded into the window's buckets. */

function foldByDay(
  bc: BuildContext,

  rows: DayNumber[],
): DayFold {
  const series = bc.window.buckets.map(() => 0)

  let total = 0

  for (const row of rows) {
    const value = num(row.v)

    total += value

    if (!row.d) continue

    const index = dayToBucketIndex(bc.window, row.d)

    if (index !== undefined) {
      series[index] = (series[index] ?? 0) + value
    }
  }

  return { series, total }
}

// --- Money loaders -----------------------------------------------------------

function bookingSumByDay(bc: BuildContext, from: string, to: string) {
  return all<DaySqlValue>(
    `SELECT b.booking_date AS d, SUM(b.booking_amount) AS v
       FROM bookings b
      WHERE b.tenant_id = ? AND b.status = 'confirmed'
        AND b.booking_date >= ? AND b.booking_date <= ?${bookingsScopeSql(
          bc.scope,
        )}${projectSql(bc, "b.project_id")}
      GROUP BY b.booking_date`,

    bc.guarded.tenantId,

    from,

    to,

    ...bookingsScopeParams(bc.scope),

    ...projectParams(bc),
  ).map((r) => ({ d: text(r.d), v: num(r.v) }))
}

type SqlNumber = string | number | bigint | null

/**
 * Row shapes read from SQLite. Each is a named interface on purpose: oxfmt
 * strips the separators from single-line multi-member object *type* literals,
 * which silently changes what the annotation means.
 */
interface DaySqlValue {
  d: string

  v: SqlNumber
}

interface MonthSqlValue {
  m: string

  v: SqlNumber
}

interface DayTransitions {
  d: string

  gain: SqlNumber

  loss: SqlNumber
}

interface ProjectSqlValue {
  p: string

  v: SqlNumber
}

interface StatusCount {
  status: string

  n: SqlNumber
}

interface CountValue {
  n: SqlNumber

  v: SqlNumber
}

interface ValueCount {
  v: SqlNumber

  c: SqlNumber
}

interface DayAmount {
  day: string

  amount: number
}

interface DayNumber {
  d: string | null

  v: number
}

interface DayFold {
  series: number[]

  total: number
}

interface TenantNames {
  legal_name: string | null

  name: string
}

interface NameRow {
  id: string

  name: string
}

/** Allocated receipt money grouped by the payment's received day. */

function collectionSumByDay(bc: BuildContext, from: string, to: string) {
  return all<DaySqlValue>(
    `SELECT substr(p.received_at, 1, 10) AS d, SUM(a.amount) AS v
       FROM payment_allocations a
       JOIN payments p ON p.id = a.payment_id AND p.tenant_id = a.tenant_id
       JOIN payment_installments i ON i.id = a.installment_id AND i.tenant_id = a.tenant_id
       JOIN bookings b ON b.id = i.booking_id AND b.tenant_id = i.tenant_id
      WHERE a.tenant_id = ? AND b.status = 'confirmed'
        AND substr(p.received_at, 1, 10) >= ? AND substr(p.received_at, 1, 10) <= ?${bookingsScopeSql(
          bc.scope,
        )}${projectSql(bc, "b.project_id")}
      GROUP BY d`,

    bc.guarded.tenantId,

    from,

    to,

    ...bookingsScopeParams(bc.scope),

    ...projectParams(bc),
  ).map((r) => ({ d: text(r.d), v: num(r.v) }))
}

interface InstallmentLine {
  id: string

  due: string

  total: number

  paid: number
}

/** Open schedule lines for receivables/overdue math, all due dates. */

function loadLines(
  bc: BuildContext,
): {
  lines: InstallmentLine[]

  paymentsByLine: Map<string, DayAmount[]>
} {
  const lines = all<{
    id: string

    due_date: string

    total: SqlNumber

    paid_amount: SqlNumber
  }>(
    `SELECT i.id, i.due_date, i.total, i.paid_amount
       FROM payment_installments i
       JOIN bookings b ON b.id = i.booking_id AND b.tenant_id = i.tenant_id
      WHERE i.tenant_id = ? AND b.status = 'confirmed'${bookingsScopeSql(
        bc.scope,
      )}${projectSql(bc, "b.project_id")}`,

    bc.guarded.tenantId,

    ...bookingsScopeParams(bc.scope),

    ...projectParams(bc),
  ).map((r) => ({
    id: text(r.id),

    due: text(r.due_date),

    total: num(r.total),

    paid: num(r.paid_amount),
  }))

  const paymentRows = all<{
    installment_id: string

    d: string

    v: SqlNumber
  }>(
    `SELECT ip.installment_id, substr(ip.paid_at, 1, 10) AS d, SUM(ip.amount) AS v
       FROM installment_payments ip
       JOIN payment_installments i ON i.id = ip.installment_id AND i.tenant_id = ip.tenant_id
       JOIN bookings b ON b.id = i.booking_id AND b.tenant_id = i.tenant_id
      WHERE ip.tenant_id = ? AND b.status = 'confirmed'${bookingsScopeSql(
        bc.scope,
      )}${projectSql(bc, "b.project_id")}
      GROUP BY ip.installment_id, d`,

    bc.guarded.tenantId,

    ...bookingsScopeParams(bc.scope),

    ...projectParams(bc),
  )

  const paymentsByLine = new Map<string, DayAmount[]>()

  for (const row of paymentRows) {
    const id = text(row.installment_id)

    const list = paymentsByLine.get(id) ?? []

    list.push({ day: text(row.d), amount: num(row.v) })

    paymentsByLine.set(id, list)
  }

  return { lines, paymentsByLine }
}

function paidAsOf(
  paymentsByLine: Map<string, DayAmount[]>,

  lineId: string,

  day: string,
): number {
  let sum = 0

  for (const p of paymentsByLine.get(lineId) ?? []) {
    if (p.day <= day) sum += p.amount
  }

  return sum
}

/** Receivables at day `t`: every line's balance against money seen by `t`. */

function receivablesAt(
  lines: InstallmentLine[],

  paymentsByLine: Map<string, DayAmount[]>,

  t: string,
): number {
  let sum = 0

  for (const line of lines) {
    sum += Math.max(0, line.total - paidAsOf(paymentsByLine, line.id, t))
  }

  return sum
}

/** Overdue at day `t`: lines already past due at `t` (strict, matches KPI). */

function overdueAt(
  lines: InstallmentLine[],

  paymentsByLine: Map<string, DayAmount[]>,

  t: string,
): number {
  let sum = 0

  for (const line of lines) {
    if (line.due >= t) continue

    sum += Math.max(0, line.total - paidAsOf(paymentsByLine, line.id, t))
  }

  return sum
}

// --- KPI widget --------------------------------------------------------------

/**
 * A line that never leaves zero is not a trend. Sending nothing lets the tile
 * fall back to its dash-and-action empty state instead of drawing a flat rule.
 */

function spark(series: number[]): number[] {
  return series.some((v) => v !== 0) ? series : []
}

function kpi(
  value: number | null,

  previous: number | null,

  sparkline: number[],
): DashboardKpi {
  let deltaPct: number | null = null

  if (value !== null && previous !== null && previous > 0) {
    deltaPct = Math.round(((value - previous) / previous) * 1000) / 10
  }

  return { value, previous, deltaPct, sparkline: spark(sparkline) }
}

function buildKpis(bc: BuildContext, keys: DashboardKpiKey[]): DashboardKpis {
  const { window } = bc

  const empty = kpi(null, null, [])

  const sales: DashboardKpi = { ...empty }

  const collections: DashboardKpi = { ...empty }

  const receivables: DashboardKpi = { ...empty }

  const overdue: DashboardKpi = { ...empty }

  const expenses: DashboardKpi = { ...empty }

  const inventoryKpi: DashboardKpi = { ...empty }

  const unitsSold: DashboardUnitsKpi = {
    sold: null,

    total: null,

    soldPct: null,

    soldThisPeriod: null,

    soldPrevious: null,

    sparkline: [],
  }

  const customers: DashboardCustomersKpi = {
    total: null,

    newThisPeriod: null,

    newPrevious: null,

    sparkline: [],
  }

  const leads: DashboardLeadsKpi = {
    active: null,

    newThisPeriod: null,

    newPrevious: null,

    conversionPct: null,

    sparkline: [],
  }

  // With no business rows yet the whole board stays null so the page can show
  // its get-started state rather than a grid of zeroes.

  const wants = (key: DashboardKpiKey) => bc.hasAnyData && keys.includes(key)

  if (wants("sales")) {
    const current = foldByDay(bc, bookingSumByDay(bc, window.from, window.to))

    const previousRows = bookingSumByDay(
      bc,

      window.previousFrom,

      window.previousTo,
    )

    const previous = previousRows.reduce((sum, r) => sum + r.v, 0)

    Object.assign(sales, kpi(current.total, previous, current.series))
  }

  if (wants("collections")) {
    const current = foldByDay(
      bc,

      collectionSumByDay(bc, window.from, window.to),
    )

    const previous = collectionSumByDay(
      bc,

      window.previousFrom,

      window.previousTo,
    ).reduce((sum, r) => sum + r.v, 0)

    Object.assign(collections, kpi(current.total, previous, current.series))
  }

  if (wants("receivables") || wants("overdue")) {
    const { lines, paymentsByLine } = loadLines(bc)

    if (wants("receivables")) {
      let outstanding = 0

      for (const line of lines) {
        if (line.total > line.paid) outstanding += line.total - line.paid
      }

      const series = window.buckets.map((b) =>
        receivablesAt(lines, paymentsByLine, b.end),
      )

      const previous = receivablesAt(lines, paymentsByLine, window.previousTo)

      Object.assign(receivables, kpi(outstanding, previous, series))
    }

    if (wants("overdue")) {
      let due = 0

      for (const line of lines) {
        if (line.due < bc.today && line.total > line.paid) {
          due += line.total - line.paid
        }
      }

      // Overdue at the day *after* each bucket end: a line due exactly on the

      // bucket end is "due today", not overdue yet.

      const series = window.buckets.map((b) =>
        overdueAt(lines, paymentsByLine, shiftDate(b.end, -1)),
      )

      const previous = overdueAt(
        lines,

        paymentsByLine,

        shiftDate(window.previousTo, -1),
      )

      Object.assign(overdue, kpi(due, previous, series))
    }
  }

  if (wants("expenses")) {
    const rows = all<DaySqlValue>(
      `SELECT substr(e.occurred_at, 1, 10) AS d, SUM(e.amount) AS v
         FROM expenses e
        WHERE e.tenant_id = ? AND e.status IN ('approved', 'paid')
          AND substr(e.occurred_at, 1, 10) >= ? AND substr(e.occurred_at, 1, 10) <= ?${projectSql(
            bc,

            "e.project_id",
          )}
        GROUP BY d`,

      bc.guarded.tenantId,

      window.from,

      window.to,

      ...projectParams(bc),
    ).map((r) => ({ d: text(r.d), v: num(r.v) }))

    const current = foldByDay(bc, rows)

    const previous = num(
      get<{ v: SqlNumber }>(
        `SELECT COALESCE(SUM(e.amount), 0) AS v FROM expenses e
          WHERE e.tenant_id = ? AND e.status IN ('approved', 'paid')
            AND substr(e.occurred_at, 1, 10) >= ? AND substr(e.occurred_at, 1, 10) <= ?${projectSql(
              bc,

              "e.project_id",
            )}`,

        bc.guarded.tenantId,

        window.previousFrom,

        window.previousTo,

        ...projectParams(bc),
      )?.v,
    )

    Object.assign(expenses, kpi(current.total, previous, current.series))
  }

  if (wants("unitsSold")) {
    const sold = num(
      get<{ n: SqlNumber }>(
        `SELECT COUNT(*) AS n FROM inventory_units WHERE tenant_id = ? AND status = 'sold'${projectSql(
          bc,

          "project_id",
        )}`,

        bc.guarded.tenantId,

        ...projectParams(bc),
      )?.n,
    )

    const total = num(
      get<{ n: SqlNumber }>(
        `SELECT COUNT(*) AS n FROM inventory_units
          WHERE tenant_id = ? AND status <> 'draft'${projectSql(
            bc,

            "project_id",
          )}`,

        bc.guarded.tenantId,

        ...projectParams(bc),
      )?.n,
    )

    // Real transition history: cumulative sold events per bucket.

    const history = all<DayTransitions>(
      `SELECT substr(h.changed_at, 1, 10) AS d,
              SUM(CASE WHEN h.to_status = 'sold' THEN 1 ELSE 0 END) AS gain,
              SUM(CASE WHEN h.from_status = 'sold' THEN 1 ELSE 0 END) AS loss
         FROM inventory_unit_status_history h
        WHERE h.tenant_id = ?${projectSql(bc, "h.project_id")}
        GROUP BY d`,

      bc.guarded.tenantId,

      ...projectParams(bc),
    )

    const net = history.map((r) => ({
      d: text(r.d),

      v: num(r.gain) - num(r.loss),
    }))

    let running = 0

    const series: number[] = []

    for (const bucket of window.buckets) {
      for (const row of net) {
        if (row.d > bucket.start && row.d <= bucket.end) running += row.v
      }

      series.push(Math.max(0, running))
    }

    // First bucket must include everything sold before the window opened.

    let before = 0

    for (const row of net) {
      if (row.d <= window.buckets[0]!.start) before += row.v
    }

    const carried = Math.max(0, before)

    // Sold is a cumulative stock figure, so the tile's trend badge compares

    // sold *events* inside the window against the previous one, not the stock.

    let soldThisPeriod = 0

    let soldPrevious = 0

    for (const row of net) {
      if (row.d >= window.from && row.d <= window.to) soldThisPeriod += row.v
      else if (row.d >= window.previousFrom && row.d <= window.previousTo) {
        soldPrevious += row.v
      }
    }

    unitsSold.sold = sold

    unitsSold.total = total

    unitsSold.soldPct =
      total > 0 ? Math.round((sold / total) * 1000) / 10 : null

    unitsSold.soldThisPeriod = soldThisPeriod

    unitsSold.soldPrevious = soldPrevious

    unitsSold.sparkline = spark(series.map((v) => v + carried))
  }

  if (wants("inventory")) {
    const available = num(
      get<{ n: SqlNumber }>(
        `SELECT COUNT(*) AS n FROM inventory_units
          WHERE tenant_id = ? AND status = 'available'${projectSql(
            bc,

            "project_id",
          )}`,

        bc.guarded.tenantId,

        ...projectParams(bc),
      )?.n,
    )

    const deltas = all<DayTransitions>(
      `SELECT substr(h.changed_at, 1, 10) AS d,
              SUM(CASE WHEN h.to_status = 'available' THEN 1 ELSE 0 END) AS gain,
              SUM(CASE WHEN h.from_status = 'available' THEN 1 ELSE 0 END) AS loss
         FROM inventory_unit_status_history h
        WHERE h.tenant_id = ?${projectSql(bc, "h.project_id")}
        GROUP BY d`,

      bc.guarded.tenantId,

      ...projectParams(bc),
    ).map((r) => ({ d: text(r.d), v: num(r.gain) - num(r.loss) }))

    // Balance backwards from the live count: stock at bucket end =

    // today's count minus everything that happened after that day.

    const series: number[] = []

    for (const bucket of window.buckets) {
      let after = 0

      for (const row of deltas) {
        if (row.d > bucket.end) after += row.v
      }

      series.push(Math.max(0, available - after))
    }

    let afterPrev = 0

    for (const row of deltas) {
      if (row.d > window.previousTo) afterPrev += row.v
    }

    Object.assign(
      inventoryKpi,

      kpi(available, Math.max(0, available - afterPrev), series),
    )
  }

  if (wants("customers")) {
    // The customers tile is a tenant-wide figure; agent/dealer roles get their

    // own numbers through the personal panel instead.

    const total = num(
      get<{ n: SqlNumber }>(
        "SELECT COUNT(*) AS n FROM customers WHERE tenant_id = ?",

        bc.guarded.tenantId,
      )?.n,
    )

    const rows = all<DaySqlValue>(
      `SELECT substr(c.created_at, 1, 10) AS d, COUNT(*) AS v
         FROM customers c
        WHERE c.tenant_id = ? AND substr(c.created_at, 1, 10) >= ? AND substr(c.created_at, 1, 10) <= ?
        GROUP BY d`,

      bc.guarded.tenantId,

      window.from,

      window.to,
    ).map((r) => ({ d: text(r.d), v: num(r.v) }))

    const folded = foldByDay(bc, rows)

    customers.total = total

    customers.newThisPeriod = folded.total

    customers.sparkline = spark(folded.series)

    customers.newPrevious = num(
      get<{ n: SqlNumber }>(
        `SELECT COUNT(*) AS n FROM customers
          WHERE tenant_id = ? AND substr(created_at, 1, 10) >= ? AND substr(created_at, 1, 10) <= ?`,

        bc.guarded.tenantId,

        window.previousFrom,

        window.previousTo,
      )?.n,
    )
  }

  if (wants("leads")) {
    const agentCol =
      bc.scope.kind === "agent"
        ? " AND assigned_agent_id = ?"
        : bc.scope.kind === "dealer"
          ? " AND assigned_dealer_id = ?"
          : ""

    const scopeParam: (string | number)[] =
      bc.scope.kind === "tenant"
        ? []
        : [bc.scope.kind === "agent" ? bc.scope.userId : bc.scope.dealerId]

    const activeWhere =
      "status IN ('new', 'contacted', 'qualified', 'site_visit', 'negotiation')"

    const active = num(
      get<{ n: SqlNumber }>(
        `SELECT COUNT(*) AS n FROM leads WHERE tenant_id = ? AND ${activeWhere}${agentCol}`,

        bc.guarded.tenantId,

        ...scopeParam,
      )?.n,
    )

    const newRows = all<DaySqlValue>(
      `SELECT substr(l.created_at, 1, 10) AS d, COUNT(*) AS v
         FROM leads l
        WHERE l.tenant_id = ? AND substr(l.created_at, 1, 10) >= ? AND substr(l.created_at, 1, 10) <= ?${agentCol.replace(
          "assigned_",

          "l.assigned_",
        )}
        GROUP BY d`,

      bc.guarded.tenantId,

      window.from,

      window.to,

      ...(bc.scope.kind === "tenant"
        ? []
        : [bc.scope.kind === "agent" ? bc.scope.userId : bc.scope.dealerId]),
    ).map((r) => ({ d: text(r.d), v: num(r.v) }))

    const folded = foldByDay(bc, newRows)

    const won = countLeads(bc, agentCol, scopeParam, "status = 'won'", window)

    const lost = countLeads(bc, agentCol, scopeParam, "status = 'lost'", window)

    const newPrevious = num(
      get<{ n: SqlNumber }>(
        `SELECT COUNT(*) AS n FROM leads
          WHERE tenant_id = ? AND substr(created_at, 1, 10) >= ? AND substr(created_at, 1, 10) <= ?${agentCol}`,

        bc.guarded.tenantId,

        window.previousFrom,

        window.previousTo,

        ...scopeParam,
      )?.n,
    )

    leads.active = active

    leads.newThisPeriod = folded.total

    leads.newPrevious = newPrevious

    leads.conversionPct =
      won + lost > 0 ? Math.round((won / (won + lost)) * 1000) / 10 : null

    leads.sparkline = spark(folded.series)
  }

  return {
    sales,

    collections,

    receivables,

    overdue,

    unitsSold,

    inventory: inventoryKpi,

    customers,

    leads,

    expenses,
  }
}

function countLeads(
  bc: BuildContext,

  agentCol: string,

  scopeParam: (string | number)[],

  statusCond: string,

  window: WindowSpec,
): number {
  return num(
    get<{ n: SqlNumber }>(
      `SELECT COUNT(*) AS n FROM leads
        WHERE tenant_id = ? AND ${statusCond}
          AND substr(updated_at, 1, 10) >= ? AND substr(updated_at, 1, 10) <= ?${agentCol}`,

      bc.guarded.tenantId,

      window.from,

      window.to,

      ...scopeParam,
    )?.n,
  )
}

// --- Trend widget ------------------------------------------------------------

function buildTrend(bc: BuildContext): DashboardTrendPoint[] {
  const { window } = bc

  const salesByIndex = new Array<number>(window.buckets.length).fill(0)

  const collectionsByIndex = new Array<number>(window.buckets.length).fill(0)

  if (!bc.hasAnyData) return []

  const mayShowSales = bc.guarded.can("bookings", "view")

  const mayShowCollections = bc.guarded.can("payments", "view")

  if (mayShowSales) {
    for (const row of bookingSumByDay(bc, window.from, window.to)) {
      const i = dayToBucketIndex(window, row.d)

      if (i !== undefined) salesByIndex[i] = (salesByIndex[i] ?? 0) + row.v
    }
  }

  if (mayShowCollections) {
    for (const row of collectionSumByDay(bc, window.from, window.to)) {
      const i = dayToBucketIndex(window, row.d)

      if (i !== undefined) {
        collectionsByIndex[i] = (collectionsByIndex[i] ?? 0) + row.v
      }
    }
  }

  // Sales targets are set per agent per month; the dashboard sums them into a

  // monthly org figure and pro-rates it across day/week buckets.

  const targetRows = all<MonthSqlValue>(
    `SELECT period_month AS m, SUM(COALESCE(collections_target, 0)) AS v
       FROM sales_agent_targets
      WHERE tenant_id = ? AND period_month >= ? AND period_month <= ?
      GROUP BY period_month`,

    bc.guarded.tenantId,

    window.from.slice(0, 7),

    window.to.slice(0, 7),
  )

  const targetByMonth = new Map<string, number>()

  for (const row of targetRows) {
    targetByMonth.set(text(row.m), num(row.v))
  }

  const hasTargets = targetByMonth.size > 0

  const points = window.buckets.map((bucket, i) => {
    let target: number | null = null

    if (hasTargets && mayShowCollections) {
      target = 0

      let day = bucket.start

      while (day <= bucket.end) {
        const monthTarget = targetByMonth.get(day.slice(0, 7))

        if (monthTarget) {
          const year = Number(day.slice(0, 4))

          const month = Number(day.slice(5, 7))

          const nextMonth =
            month === 12
              ? `${year + 1}-01-01`
              : `${year}-${String(month + 1).padStart(2, "0")}-01`

          const monthDays = dayCount(
            `${year}-${String(month).padStart(2, "0")}-01`,
            shiftDate(nextMonth, 1),
          )

          target += monthTarget / monthDays
        }

        day = shiftDate(day, -1)
      }

      target = Math.round(target)
    }

    return {
      key: bucket.key,

      label: bucket.label,

      sales: mayShowSales ? salesByIndex[i]! : null,

      collections: mayShowCollections ? collectionsByIndex[i]! : null,

      target,
    }
  })

  // A window with no money movement would plot two flat lines at zero. Leave it
  // out and the chart shows its empty state with a way to act on it.

  return points.some(
    (p) =>
      (p.sales ?? 0) > 0 || (p.collections ?? 0) > 0 || (p.target ?? 0) > 0,
  )
    ? points
    : []
}

// --- Inventory donut -----------------------------------------------------------

const STATUS_TO_SLICE: [string, string][] = [
  ["available", "Available"],

  ["reserved", "Reserved"],

  ["booked", "Booked"],

  ["sold", "Sold"],

  ["hold", "Blocked"],
]

function buildInventory(bc: BuildContext): DashboardInventorySlice[] {
  const rows = all<StatusCount>(
    `SELECT status, COUNT(*) AS n FROM inventory_units
      WHERE tenant_id = ?${projectSql(bc, "project_id")}
      GROUP BY status`,

    bc.guarded.tenantId,

    ...projectParams(bc),
  )

  const byStatus = new Map<string, number>()

  for (const row of rows) {
    byStatus.set(text(row.status), num(row.n))
  }

  const slices: DashboardInventorySlice[] = STATUS_TO_SLICE.map(
    ([key, label]) => ({ label, count: byStatus.get(key) ?? 0 }),
  )

  let other = 0

  for (const [status, count] of byStatus) {
    if (
      !STATUS_TO_SLICE.some(([key]) => key === status) &&
      status !== "draft"
    ) {
      other += count
    }
  }

  if (other > 0) slices.push({ label: "Other", count: other })

  // With nothing in the shelf there is no ring to draw; the card renders its
  // empty state and points at the inventory page instead of a five-zero donut.

  return slices.some((slice) => slice.count > 0) ? slices : []
}

// --- Project cards -------------------------------------------------------------

const PROJECT_STATUS_LABELS: [string, string][] = [
  ["planning", "Planning"],

  ["pre_launch", "Planning"],

  ["on_sale", "Active"],

  ["on_hold", "On Hold"],

  ["handed_over", "Completed"],
]

function projectStatusLabel(status: string): string {
  const entry = PROJECT_STATUS_LABELS.find(([key]) => key === status)

  return entry ? entry[1] : status
}

function buildProjects(bc: BuildContext): DashboardProjectCard[] {
  const rows = all<{
    id: string

    name: string

    location: string

    status: string

    launch_date: string | null

    handover_date: string | null
  }>(
    `SELECT id, name, location, status, launch_date, handover_date
       FROM projects
      WHERE tenant_id = ? AND status <> 'handed_over'${
        bc.projectId ? " AND id = ?" : ""
      }
      ORDER BY CASE status
        WHEN 'on_sale' THEN 0 WHEN 'pre_launch' THEN 1
        WHEN 'planning' THEN 2 ELSE 3 END, updated_at DESC
      LIMIT 8`,

    bc.guarded.tenantId,

    ...(bc.projectId ? [bc.projectId] : []),
  )

  const mayShowMoney = bc.guarded.can("payments", "view")

  const collectionByProject = new Map<string, number>()

  if (mayShowMoney) {
    const rows2 = all<ProjectSqlValue>(
      `SELECT b.project_id AS p, SUM(a.amount) AS v
         FROM payment_allocations a
         JOIN payments p ON p.id = a.payment_id AND p.tenant_id = a.tenant_id
         JOIN payment_installments i ON i.id = a.installment_id AND i.tenant_id = a.tenant_id
         JOIN bookings b ON b.id = i.booking_id AND b.tenant_id = i.tenant_id
        WHERE a.tenant_id = ? AND b.status = 'confirmed'
          AND substr(p.received_at, 1, 10) >= ? AND substr(p.received_at, 1, 10) <= ?
        GROUP BY b.project_id`,

      bc.guarded.tenantId,

      bc.window.from,

      bc.window.to,
    )

    for (const row of rows2) {
      collectionByProject.set(text(row.p), num(row.v))
    }
  }

  return rows.map((row) => {
    const id = text(row.id)

    const counts = get<{
      total: SqlNumber
      sold: SqlNumber
      available: SqlNumber
    }>(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status = 'sold' THEN 1 ELSE 0 END) AS sold,
              SUM(CASE WHEN status = 'available' THEN 1 ELSE 0 END) AS available
         FROM inventory_units WHERE tenant_id = ? AND project_id = ? AND status <> 'draft'`,

      bc.guarded.tenantId,

      id,
    )

    const total = num(counts?.total)

    const sold = num(counts?.sold)

    const launch = row.launch_date ? text(row.launch_date) : ""

    const handover = row.handover_date ? text(row.handover_date) : ""

    let nextDateLabel: string | null = null

    let nextDate: string | null = null

    if (launch && launch >= bc.today) {
      nextDateLabel = "Launch"

      nextDate = launch
    } else if (handover && handover >= bc.today) {
      nextDateLabel = "Handover"

      nextDate = handover
    }

    return {
      id,

      name: text(row.name),

      location: text(row.location),

      status: text(row.status),

      statusLabel: projectStatusLabel(text(row.status)),

      soldUnits: sold,

      totalUnits: total,

      soldPct: total > 0 ? Math.round((sold / total) * 1000) / 10 : null,

      availableUnits: num(counts?.available),

      collectionsInPeriod: mayShowMoney
        ? (collectionByProject.get(id) ?? 0)
        : null,

      nextDateLabel,

      nextDate,
    }
  })
}

// --- Installments -----------------------------------------------------------

function buildInstallments(bc: BuildContext): DashboardInstallmentRow[] {
  const soon = shiftDate(bc.today, -7)

  const rows = all<{
    installment_id: string

    booking_id: string

    customer_id: string

    customer_name: string

    project_name: string

    unit_code: string

    due_date: string

    outstanding: SqlNumber
  }>(
    `SELECT i.id AS installment_id, b.id AS booking_id, b.customer_id,
            b.customer_name, p.name AS project_name, b.unit_code, i.due_date,
            (i.total - i.paid_amount) AS outstanding
       FROM payment_installments i
       JOIN bookings b ON b.id = i.booking_id AND b.tenant_id = i.tenant_id
       JOIN projects p ON p.id = b.project_id AND p.tenant_id = b.tenant_id
      WHERE i.tenant_id = ? AND b.status = 'confirmed' AND i.total > i.paid_amount
        AND i.due_date <= ?${projectSql(bc, "b.project_id")}
      ORDER BY i.due_date ASC
      LIMIT 40`,

    bc.guarded.tenantId,

    soon,

    ...projectParams(bc),
  )

  return rows.map((row) => {
    const due = text(row.due_date)

    const daysOverdue = due < bc.today ? dayCount(due, bc.today) - 1 : 0

    return {
      installmentId: text(row.installment_id),

      bookingId: text(row.booking_id),

      customerId: text(row.customer_id),

      customerName: text(row.customer_name),

      projectName: text(row.project_name),

      unitCode: text(row.unit_code),

      dueDate: due,

      outstanding: num(row.outstanding),

      daysOverdue,

      overdue: daysOverdue > 0,

      dueSoon: daysOverdue === 0 && due <= soon,
    }
  })
}

// --- Approvals -----------------------------------------------------------

function buildApprovals(
  bc: BuildContext,
): {
  rows: DashboardApprovalRow[]

  canAct: boolean
} {
  const rows = all<{
    id: string

    action_key: string

    summary: string | null

    requested_by_name: string

    requested_at: string
  }>(
    `SELECT id, action_key, summary, requested_by_name, requested_at
       FROM approvals
      WHERE tenant_id = ? AND status = 'pending'
      ORDER BY requested_at DESC
      LIMIT 8`,

    bc.guarded.tenantId,
  )

  const labels = APPROVAL_ACTION_LABELS as Record<string, string>

  return {
    rows: rows.map((row) => ({
      id: text(row.id),

      actionKey: text(row.action_key),

      actionLabel: labels[text(row.action_key)] ?? text(row.action_key),

      summary: row.summary === null ? null : text(row.summary),

      requestedByName: text(row.requested_by_name),

      requestedAt: text(row.requested_at),
    })),

    canAct: bc.guarded.can("approvals", "approve"),
  }
}

// --- Recent bookings -----------------------------------------------------

function buildRecentBookings(bc: BuildContext): DashboardBookingRow[] {
  const rows = all<{
    id: string

    reference: string

    customer_name: string

    project_name: string

    unit_code: string

    booking_amount: SqlNumber

    agent_name: string | null

    status: string

    booking_date: string
  }>(
    `SELECT b.id, b.reference, b.customer_name, p.name AS project_name,
            b.unit_code, b.booking_amount, b.agent_name, b.status, b.booking_date
       FROM bookings b
       JOIN projects p ON p.id = b.project_id AND p.tenant_id = b.tenant_id
      WHERE b.tenant_id = ? AND b.booking_date >= ? AND b.booking_date <= ?${bookingsScopeSql(
        bc.scope,
      )}${projectSql(bc, "b.project_id")}
      ORDER BY b.booking_date DESC, b.created_at DESC
      LIMIT 8`,

    bc.guarded.tenantId,

    bc.window.from,

    bc.window.to,

    ...bookingsScopeParams(bc.scope),

    ...projectParams(bc),
  )

  return rows.map((row) => ({
    id: text(row.id),

    reference: text(row.reference),

    customerName: text(row.customer_name),

    projectName: text(row.project_name),

    unitCode: text(row.unit_code),

    amount: num(row.booking_amount),

    agentName: row.agent_name === null ? null : text(row.agent_name),

    status: text(row.status),

    bookingDate: text(row.booking_date),
  }))
}

// --- Agent leaderboard -----------------------------------------------------

function buildAgents(bc: BuildContext): DashboardAgentRow[] {
  const rows = all<{
    agent_user_id: string | null

    agent_name: string | null

    n: SqlNumber

    v: SqlNumber
  }>(
    `SELECT b.agent_user_id, MAX(b.agent_name) AS agent_name,
            COUNT(*) AS n, SUM(b.booking_amount) AS v
       FROM bookings b
      WHERE b.tenant_id = ? AND b.status = 'confirmed'
        AND b.booking_date >= ? AND b.booking_date <= ?${projectSql(
          bc,

          "b.project_id",
        )}
      GROUP BY b.agent_user_id
      ORDER BY v DESC
      LIMIT 5`,

    bc.guarded.tenantId,

    bc.window.from,

    bc.window.to,

    ...projectParams(bc),
  )

  const months: string[] = []

  let cursor = bc.window.from.slice(0, 7)

  const endMonth = bc.window.to.slice(0, 7)

  while (cursor <= endMonth) {
    months.push(cursor)

    const year = Number(cursor.slice(0, 4))

    const month = Number(cursor.slice(5, 7))

    cursor =
      month === 12
        ? `${year + 1}-01`
        : `${year}-${String(month + 1).padStart(2, "0")}`
  }

  return rows.map((row) => {
    const userId = text(row.agent_user_id)

    let target: number | null = null

    if (userId && months.length > 0) {
      const placeholders = months.map(() => "?").join(", ")

      const targetRow = get<{ v: SqlNumber }>(
        `SELECT SUM(COALESCE(collections_target, 0)) AS v
           FROM sales_agent_targets
          WHERE tenant_id = ? AND user_id = ? AND period_month IN (${placeholders})`,

        bc.guarded.tenantId,

        userId,

        ...months,
      )

      const sum = num(targetRow?.v)

      target = sum > 0 ? sum : null
    }

    const value = num(row.v)

    return {
      userId,

      name: text(row.agent_name) || "Unassigned",

      bookings: num(row.n),

      value,

      target,

      achievedPct:
        target !== null && target > 0
          ? Math.min(999, Math.round((value / target) * 1000) / 10)
          : null,
    }
  })
}

// --- Activity feed ---------------------------------------------------------

function buildActivity(bc: BuildContext): DashboardActivityRow[] {
  const items: DashboardActivityRow[] = []

  const grouped = (n: number) => n.toLocaleString("en-US")

  if (bc.guarded.can("leads", "view")) {
    for (const row of all<{
      id: string
      full_name: string
      created_at: string
      actor: string | null
    }>(
      `SELECT l.id, l.full_name, l.created_at, u.full_name AS actor
         FROM leads l LEFT JOIN users u ON u.id = l.created_by AND u.tenant_id = l.tenant_id
        WHERE l.tenant_id = ? AND substr(l.created_at, 1, 10) >= ? AND substr(l.created_at, 1, 10) <= ?${
          bc.scope.kind === "agent" ? " AND l.assigned_agent_id = ?" : ""
        }
        ORDER BY l.created_at DESC LIMIT 6`,

      bc.guarded.tenantId,

      bc.window.from,

      bc.window.to,

      ...(bc.scope.kind === "agent" ? [bc.scope.userId] : []),
    )) {
      items.push({
        id: text(row.id),

        kind: "lead",

        text: `New lead — ${text(row.full_name)}`,

        actorName: text(row.actor) || "—",

        at: text(row.created_at),
      })
    }
  }

  if (bc.guarded.can("bookings", "view")) {
    for (const row of all<{
      id: string
      reference: string
      customer_name: string
      created_at: string
      created_by_name: string
    }>(
      `SELECT id, reference, customer_name, created_at, created_by_name
         FROM bookings
        WHERE tenant_id = ? AND substr(created_at, 1, 10) >= ? AND substr(created_at, 1, 10) <= ?${bookingsScopeSql(
          bc.scope,
        )}${projectSql(bc, "project_id")}
        ORDER BY created_at DESC LIMIT 6`,

      bc.guarded.tenantId,

      bc.window.from,

      bc.window.to,

      ...bookingsScopeParams(bc.scope),

      ...projectParams(bc),
    )) {
      items.push({
        id: text(row.id),

        kind: "booking",

        text: `Booking ${text(row.reference)} confirmed — ${text(
          row.customer_name,
        )}`,

        actorName: text(row.created_by_name),

        at: text(row.created_at),
      })
    }
  }

  if (bc.guarded.can("payments", "view")) {
    for (const row of all<{
      id: string
      amount: SqlNumber
      customer_name: string
      received_at: string
      recorded_by_name: string
    }>(
      `SELECT p.id, p.amount, b.customer_name, p.received_at, p.recorded_by_name
         FROM payments p
         LEFT JOIN bookings b ON b.id = p.booking_id AND b.tenant_id = p.tenant_id
        WHERE p.tenant_id = ? AND substr(p.received_at, 1, 10) >= ? AND substr(p.received_at, 1, 10) <= ?${projectSql(
          bc,

          "b.project_id",
        )}
        ORDER BY p.received_at DESC LIMIT 6`,

      bc.guarded.tenantId,

      bc.window.from,

      bc.window.to,

      ...projectParams(bc),
    )) {
      items.push({
        id: text(row.id),

        kind: "payment",

        text: `${bc.currency} ${grouped(num(row.amount))} received — ${
          text(row.customer_name) || "Customer"
        }`,

        actorName: text(row.recorded_by_name),

        at: text(row.received_at),
      })
    }
  }

  if (bc.guarded.can("documents", "view")) {
    for (const row of all<{
      id: string
      title: string
      created_at: string
      uploaded_by_name: string
    }>(
      `SELECT id, title, created_at, uploaded_by_name
         FROM documents
        WHERE tenant_id = ? AND substr(created_at, 1, 10) >= ? AND substr(created_at, 1, 10) <= ?
        ORDER BY created_at DESC LIMIT 6`,

      bc.guarded.tenantId,

      bc.window.from,

      bc.window.to,
    )) {
      items.push({
        id: text(row.id),

        kind: "document",

        text: `Document uploaded — ${text(row.title)}`,

        actorName: text(row.uploaded_by_name),

        at: text(row.created_at),
      })
    }
  }

  items.sort((a, b) => (a.at < b.at ? 1 : -1))

  return items.slice(0, 8)
}

// --- Personal panel (agent / dealer) ------------------------------------------

function buildPersonal(bc: BuildContext): DashboardPersonal {
  const { window } = bc

  const isDealer = bc.scope.kind === "dealer"

  const bookings = get<CountValue>(
    `SELECT COUNT(*) AS n, COALESCE(SUM(booking_amount), 0) AS v
       FROM bookings b
      WHERE b.tenant_id = ? AND b.status = 'confirmed'
        AND b.booking_date >= ? AND b.booking_date <= ?${bookingsScopeSql(
          bc.scope,
        )}${projectSql(bc, "b.project_id")}`,

    bc.guarded.tenantId,

    window.from,

    window.to,

    ...bookingsScopeParams(bc.scope),

    ...projectParams(bc),
  )

  const salesValue = num(bookings?.v)

  const bookingsCount = num(bookings?.n)

  const activeWhere =
    "status IN ('new', 'contacted', 'qualified', 'site_visit', 'negotiation')"

  const openLeads = num(
    get<{ n: SqlNumber }>(
      `SELECT COUNT(*) AS n FROM leads
        WHERE tenant_id = ? AND ${activeWhere} AND ${
          isDealer ? "assigned_dealer_id" : "assigned_agent_id"
        } = ?`,

      bc.guarded.tenantId,

      isDealer ? bc.scope.dealerId : bc.scope.userId,
    )?.n,
  )

  let commissionOrTarget: DashboardPersonal["commissionOrTarget"] = null

  if (isDealer) {
    const commission = get<ValueCount>(
      `SELECT COALESCE(SUM(commission_amount), 0) AS v, COUNT(*) AS c
         FROM dealer_bookings
        WHERE tenant_id = ? AND dealer_id = ? AND status = 'confirmed'
          AND booking_date >= ? AND booking_date <= ?`,

      bc.guarded.tenantId,

      bc.scope.dealerId,

      window.from,

      window.to,
    )

    commissionOrTarget = {
      label: "Commission earned",

      value: num(commission?.v),

      target: null,

      achievedPct: null,
    }
  } else {
    const collected = collectionSumByDay(bc, window.from, window.to).reduce(
      (sum, r) => sum + r.v,

      0,
    )

    const months = window.buckets.map((b) =>
      b.key.length === 7 ? b.key : b.start.slice(0, 7),
    )

    const uniqueMonths = [...new Set(months)]

    const targetRow = uniqueMonths.length
      ? get<{ v: SqlNumber }>(
          `SELECT SUM(COALESCE(collections_target, 0)) AS v
             FROM sales_agent_targets
            WHERE tenant_id = ? AND user_id = ?
              AND period_month IN (${uniqueMonths.map(() => "?").join(", ")})`,

          bc.guarded.tenantId,

          bc.scope.userId,

          ...uniqueMonths,
        )
      : undefined

    const target = num(targetRow?.v)

    commissionOrTarget = {
      label: "Collections vs target",

      value: collected,

      target: target > 0 ? target : null,

      achievedPct:
        target > 0 ? Math.round((collected / target) * 1000) / 10 : null,
    }
  }

  return {
    heading: isDealer ? "Your channel performance" : "Your performance",

    salesValue,

    bookingsCount,

    openLeads,

    commissionOrTarget,

    scopeNote: isDealer
      ? "Showing only your own bookings and commission."
      : "Showing only your own leads, bookings and targets.",
  }
}

// --- Document verification -------------------------------------------------

/** Tallies of the tenant's customer files by review state. */
interface VerificationTally {
  review: SqlNumber

  rejected: SqlNumber
}

/**
 * The tenant-wide read for the verification desk.
 *
 * Gated on `documents.view`: a role that cannot see documents gets null (the dash),
 * not a zeroed-out panel that implies an empty queue it has no business reading.
 * The three counts are plain state tallies over the tenant's customer files; the
 * average score folds the per-customer checklist rollup so the figure agrees with
 * what the checklist screen itself shows, and is null when no customer holds papers.
 */

function buildDocumentVerification(
  bc: BuildContext,
): DashboardDocumentVerification | null {
  const tenantId = bc.guarded.tenantId

  if (!bc.guarded.can("documents", "view")) return null

  const states = get<VerificationTally>(
    `SELECT
        SUM(CASE WHEN verification_status = 'under_review' THEN 1 ELSE 0 END) AS review,
        SUM(CASE WHEN verification_status = 'rejected' THEN 1 ELSE 0 END) AS rejected
      FROM documents
      WHERE tenant_id = ? AND entity_type = 'customer'`,

    tenantId,
  )

  const settings = getVerificationSettings(tenantId)

  const windowDays =
    settings.expiryAlertDays.length > 0 ? settings.expiryAlertDays[0]! : 60

  const soon = shiftDate(bc.today, windowDays)

  const expiringSoon = num(
    get<{ n: SqlNumber }>(
      `SELECT COUNT(*) AS n FROM documents
        WHERE tenant_id = ?
          AND entity_type = 'customer'
          AND expires_at IS NOT NULL
          AND substr(expires_at, 1, 10) >= ?
          AND substr(expires_at, 1, 10) <= ?`,

      tenantId,

      bc.today,

      soon,
    )?.n,
  )

  const holders = all<{ entity_id: string }>(
    `SELECT DISTINCT entity_id FROM documents
      WHERE tenant_id = ? AND entity_type = 'customer'
      ORDER BY entity_id
      LIMIT 500`,

    tenantId,
  )

  let total = 0

  let counted = 0

  for (const holder of holders) {
    const checklist = buildDocumentChecklist(
      tenantId,
      holder.entity_id,
      bc.today,
    )

    if (!checklist) continue

    total += checklist.score.percent

    counted += 1
  }

  return {
    pendingReview: num(states?.review),

    rejected: num(states?.rejected),

    expiringSoon,

    averageScore: counted > 0 ? Math.round(total / counted) : null,
  }
}

// --- Checklist -------------------------------------------------------------

function buildChecklist(bc: BuildContext): DashboardChecklist {
  const tenantId = bc.guarded.tenantId

  const legal = get<TenantNames>(
    "SELECT legal_name, name FROM tenants WHERE id = ?",

    tenantId,
  )

  const projectCount = num(
    get<{ n: SqlNumber }>(
      "SELECT COUNT(*) AS n FROM projects WHERE tenant_id = ?",

      tenantId,
    )?.n,
  )

  const unitCount = num(
    get<{ n: SqlNumber }>(
      "SELECT COUNT(*) AS n FROM inventory_units WHERE tenant_id = ?",

      tenantId,
    )?.n,
  )

  const memberCount = num(
    get<{ n: SqlNumber }>(
      "SELECT COUNT(*) AS n FROM tenant_memberships WHERE tenant_id = ?",

      tenantId,
    )?.n,
  )

  const leadCount = num(
    get<{ n: SqlNumber }>(
      "SELECT COUNT(*) AS n FROM leads WHERE tenant_id = ?",

      tenantId,
    )?.n,
  )

  const steps = [
    {
      key: "profile",

      label: "Set up your company profile",

      description: "Legal name, timezone and currency settings.",

      done: Boolean(legal?.legal_name && legal.legal_name.trim() !== ""),

      path: "/settings?tab=organisation",

      actionLabel: "Open settings",
    },

    {
      key: "project",

      label: "Create your first project",

      description: "Add the development you are selling.",

      done: projectCount > 0,

      path: "/projects",

      actionLabel: "Add a project",
    },

    {
      key: "units",

      label: "Add units to inventory",

      description: "Plots, apartments or shops with prices.",

      done: unitCount > 0,

      path: "/inventory",

      actionLabel: "Add units",
    },

    {
      key: "team",

      label: "Invite your team",

      description: "Sales agents, recovery and accounts users.",

      done: memberCount > 1,

      path: "/settings?tab=access",

      actionLabel: "Invite people",
    },

    {
      key: "lead",

      label: "Add your first lead",

      description: "Capture an interested buyer and start selling.",

      done: leadCount > 0,

      path: "/leads",

      actionLabel: "Add a lead",
    },
  ]

  const completedCount = steps.filter((step) => step.done).length

  return { steps, completedCount, totalCount: steps.length }
}

// --- Overview assembly -------------------------------------------------------

interface Filters {
  range: DashboardRange

  from: string | null

  to: string | null

  projectId: string | null
}

function readFilters(ctx: RequestContext): Filters {
  const rawProject = ctx.query.get("projectId")

  return {
    range: (ctx.query.get("range") ?? "month") as DashboardRange,

    from: ctx.query.get("from"),

    to: ctx.query.get("to"),

    projectId: rawProject && rawProject !== "" ? rawProject : null,
  }
}

function computeOverview(ctx: RequestContext): DashboardOverview {
  const guarded = requirePermission(requireAuth(ctx), "dashboard", "view")

  const filters = readFilters(ctx)

  const tenant = get<{
    name: string

    legal_name: string | null

    currency: string
  }>(
    "SELECT name, legal_name, currency FROM tenants WHERE id = ?",

    guarded.tenantId,
  )

  const currency = tenant?.currency ?? "AED"

  const today = tenantToday(guarded.tenantId)

  const window = resolveWindow(ctx.query, today)

  let projectId = filters.projectId

  if (projectId) {
    const known = get<{ id: string }>(
      "SELECT id FROM projects WHERE tenant_id = ? AND id = ?",

      guarded.tenantId,

      projectId,
    )

    if (!known)
      throw badRequest("That project does not exist in your workspace.")
  }

  // Self-scope for agent / dealer roles; a dealer without a linked row sees

  // an empty personal scope rather than the tenant's figures.

  let scope: PersonalScope = {
    kind: "tenant",

    userId: guarded.userId,

    dealerId: "",
  }

  if (guarded.roleId === "sales_agent") {
    scope = { kind: "agent", userId: guarded.userId, dealerId: "" }
  } else if (guarded.roleId === "dealer_partner") {
    const dealer = get<{ id: string }>(
      "SELECT id FROM dealers WHERE tenant_id = ? AND portal_user_id = ?",

      guarded.tenantId,

      guarded.userId,
    )

    scope = {
      kind: "dealer",
      userId: guarded.userId,
      dealerId: dealer?.id ?? "",
    }
  }

  const bc: BuildContext = {
    guarded,

    currency,

    today,

    window,

    projectId,

    scope,

    hasAnyData: tenantHasAnyData(guarded.tenantId),
  }

  const visibility = visibilityFor(guarded)

  const widgetEnvelope = <T>(fn: () => T): WidgetEnvelope<T> => {
    try {
      return { ok: true as const, data: fn() }
    } catch (error) {
      return {
        ok: false as const,

        error: error instanceof Error ? error.message : "Widget failed",
      }
    }
  }

  const widgets: DashboardOverview["widgets"] = {}

  const wanted = (key: DashboardWidgetKey) => visibility.widgets.includes(key)

  if (wanted("kpis")) {
    widgets.kpis = widgetEnvelope(() => buildKpis(bc, visibility.kpiKeys))
  }

  if (wanted("trend")) {
    widgets.trend = widgetEnvelope(() => buildTrend(bc))
  }

  if (wanted("inventory")) {
    widgets.inventory = widgetEnvelope(() => buildInventory(bc))
  }

  if (wanted("projects")) {
    widgets.projects = widgetEnvelope(() => buildProjects(bc))
  }

  if (wanted("installments")) {
    widgets.installments = widgetEnvelope(() => buildInstallments(bc))
  }

  if (wanted("approvals")) {
    widgets.approvals = widgetEnvelope(() => buildApprovals(bc))
  }

  if (wanted("recentBookings")) {
    widgets.recentBookings = widgetEnvelope(() => buildRecentBookings(bc))
  }

  if (wanted("agents")) {
    widgets.agents = widgetEnvelope(() => buildAgents(bc))
  }

  if (wanted("activity")) {
    widgets.activity = widgetEnvelope(() => buildActivity(bc))
  }

  if (visibility.personal) {
    widgets.personal = widgetEnvelope(() => buildPersonal(bc))
  }

  widgets.checklist = widgetEnvelope(() => buildChecklist(bc))

  widgets.documentVerification = widgetEnvelope(() =>
    buildDocumentVerification(bc),
  )

  const projectOptions: DashboardProjectOption[] = wanted("projects")
    ? all<NameRow>(
        `SELECT id, name FROM projects WHERE tenant_id = ? ORDER BY name LIMIT 100`,

        guarded.tenantId,
      ).map((row) => ({ id: text(row.id), name: text(row.name) }))
    : []

  const sampleActive =
    num(
      get<{ n: SqlNumber }>(
        "SELECT COUNT(*) AS n FROM dashboard_sample_rows WHERE tenant_id = ?",

        guarded.tenantId,
      )?.n,
    ) > 0

  const hasAnyData = bc.hasAnyData

  const overview: DashboardOverview = {
    meta: {
      currency,

      generatedAt: nowISO(),

      range: window.range,

      from: window.from,

      to: window.to,

      previousFrom: window.previousFrom,

      previousTo: window.previousTo,

      granularity: window.granularity,

      today,

      scope: scope.kind === "tenant" ? "tenant" : "self",

      selectedProjectId: projectId,

      projectOptions,

      hasAnyData,

      sampleActive,

      canManageSample: guarded.can("settings", "edit"),
    },

    visible: visibility.widgets,

    kpiKeys: visibility.kpiKeys,

    sections: visibility.sections,

    widgets,
  }

  return overview
}

/** GET /api/dashboard/overview */

export async function dashboardOverview(
  ctx: RequestContext,
): Promise<DashboardOverview> {
  const guarded = requirePermission(requireAuth(ctx), "dashboard", "view")

  const filters = readFilters(ctx)

  const key = [
    guarded.tenantId,

    guarded.roleId,

    guarded.userId,

    filters.range,

    filters.from ?? "",

    filters.to ?? "",

    filters.projectId ?? "",
  ].join("|")

  const hit = overviewCache.get(key)

  if (hit && hit.expires > Date.now()) return hit.value

  const value = computeOverview(ctx)

  if (overviewCache.size > 500) {
    const cutoff = Date.now() - CACHE_TTL_MS

    for (const [k, entry] of overviewCache) {
      if (entry.expires <= cutoff) overviewCache.delete(k)
    }
  }

  overviewCache.set(key, { expires: Date.now() + CACHE_TTL_MS, value })

  return value
}

const WIDGET_KEYS = [
  ...DASHBOARD_WIDGETS,
  "checklist",
  "documentVerification",
] as const

/** GET /api/dashboard/widget?key=… — the same cached pipeline, one answer. */

export async function dashboardWidget(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "dashboard", "view")

  const key = ctx.query.get("key") ?? ""

  if (!(WIDGET_KEYS as readonly string[]).includes(key)) {
    throw badRequest(`Unknown dashboard widget "${key}".`)
  }

  if (!guarded.can("dashboard", "view")) {
    throw badRequest("That widget is not available for your role.")
  }

  const overview = await dashboardOverview(ctx)

  const bag =
    overview.widgets as Record<string, WidgetEnvelope<unknown> | undefined>

  const envelope = bag[key]

  if (!envelope) {
    return {
      key,

      meta: overview.meta,

      visible: overview.visible,

      kpiKeys: overview.kpiKeys,

      envelope: {
        ok: false as const,

        error: "This widget is not available for your role.",
      },
    }
  }

  // A failed widget was cached as an envelope; on retry, drop the cache entry

  // so the rebuild actually re-runs the query.

  if (envelope.ok === false) {
    invalidateDashboardCache(guarded.tenantId)
  }

  return {
    key,

    meta: overview.meta,

    visible: overview.visible,

    kpiKeys: overview.kpiKeys,

    envelope,
  }
}
