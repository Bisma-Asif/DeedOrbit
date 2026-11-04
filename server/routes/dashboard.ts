/**
 * The executive dashboard — the landing page's KPI cards and supporting charts.
 *
 * Every number is derived live from the same tables the reports read, so the
 * dashboard and the Reports section can never disagree: inventory counts come from
 * `inventory_units.status`, revenue from confirmed `bookings`, collections from
 * `payment_allocations` joined to `payments.received_at`, receivables and overdue
 * from open installment balances on confirmed bookings, and cost from approved/paid
 * `expenses`. "This month" collections are the current calendar month against the
 * one before; the trend chart is the trailing twelve months.
 *
 * A metric with no data returns null (the KPI tile shows a dash) rather than a
 * fabricated zero, per the product rule.
 */

import { all, get, type SqlValue } from "../db.ts"

import type { RequestContext } from "../http.ts"

import { requireAuth, requirePermission } from "../middleware.ts"

import {
  isDashboardPeriod,
  type ChartDatum,
  type DashboardCharts,
  type DashboardKpis,
  type DashboardPeriod,
  type DashboardSummary,
  type TopAgent,
} from "../../shared/reports.ts"

const nowISO = () => new Date().toISOString()

function tenantCurrency(tenantId: string): string {
  return (
    get<{ currency: string }>(
      "SELECT currency FROM tenants WHERE id = ?",

      tenantId,
    )?.currency ?? "AED"
  )
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

function addDaysISO(date: string, days: number): string {
  const base = Date.parse(`${date}T00:00:00Z`)

  return new Date(base + days * 86_400_000).toISOString().slice(0, 10)
}

function periodStart(period: DashboardPeriod, today: string): string {
  if (period === "30d") return addDaysISO(today, -29)

  if (period === "90d") return addDaysISO(today, -89)

  return addDaysISO(today, -364)
}

/** The trailing `count` calendar months, oldest first, as `YYYY-MM` keys. */

function trailingMonths(today: string, count: number): string[] {
  const months: string[] = []

  let year = Number(today.slice(0, 4))

  let month = Number(today.slice(5, 7))

  for (let i = 0; i < count; i += 1) {
    months.unshift(`${year}-${String(month).padStart(2, "0")}`)

    month -= 1

    if (month === 0) {
      month = 12

      year -= 1
    }
  }

  return months
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

function monthLabel(key: string): string {
  const month = Number(key.slice(5, 7))

  return MONTH_SHORT[month - 1] ?? key
}

function num(value: SqlValue): number {
  return typeof value === "number"
    ? value
    : typeof value === "bigint"
      ? Number(value)
      : Number(value ?? 0)
}

function text(value: SqlValue): string {
  return value === null || value === undefined ? "" : String(value)
}

export async function dashboardSummary(
  ctx: RequestContext,
): Promise<DashboardSummary> {
  const guarded = requirePermission(requireAuth(ctx), "dashboard", "view")

  const tenantId = guarded.tenantId

  const currency = tenantCurrency(tenantId)

  const requested = ctx.query.get("period")

  const period: DashboardPeriod = isDashboardPeriod(requested)
    ? requested
    : "12m"

  const today = tenantToday(tenantId)

  const start = periodStart(period, today)

  // --- Inventory status counts (point-in-time) ----------------------------

  const statusRows = all<Record<string, SqlValue>>(
    `SELECT status, COUNT(*) AS c FROM inventory_units
      WHERE tenant_id = ? GROUP BY status`,

    tenantId,
  )

  const countBy = new Map<string, number>()

  let totalInventory = 0

  for (const row of statusRows) {
    const value = num(row.c)

    countBy.set(text(row.status), value)

    totalInventory += value
  }

  const sold = countBy.get("sold") ?? 0

  const available = countBy.get("available") ?? 0

  // --- Receivables and overdue -------------------------------------------

  const receivables =
    get<{ n: SqlValue }>(
      `SELECT COALESCE(SUM(i.total - i.paid_amount), 0) AS n
        FROM payment_installments i
        JOIN bookings b ON b.id = i.booking_id AND b.tenant_id = i.tenant_id
        WHERE i.tenant_id = ? AND b.status = 'confirmed'
          AND i.total - i.paid_amount > 0`,

      tenantId,
    )?.n ?? 0

  const overdueRaw = get<{ n: SqlValue }>(
    `SELECT COALESCE(SUM(i.total - i.paid_amount), 0) AS n
      FROM payment_installments i
      JOIN bookings b ON b.id = i.booking_id AND b.tenant_id = i.tenant_id
      WHERE i.tenant_id = ? AND b.status = 'confirmed'
        AND i.total - i.paid_amount > 0 AND i.due_date < ?`,

    tenantId,

    today,
  )

  const overdueAmount = num(overdueRaw?.n ?? 0)

  // --- Revenue and expense over the period -------------------------------

  const revenue = num(
    get<{ n: SqlValue }>(
      `SELECT COALESCE(SUM(b.booking_amount), 0) AS n
        FROM bookings b
        WHERE b.tenant_id = ? AND b.status = 'confirmed'
          AND substr(b.booking_date,1,10) BETWEEN ? AND ?`,

      tenantId,

      start,

      today,
    )?.n ?? 0,
  )

  const expense = num(
    get<{ n: SqlValue }>(
      `SELECT COALESCE(SUM(e.amount), 0) AS n
        FROM expenses e
        WHERE e.tenant_id = ? AND e.status IN ('approved','paid')
          AND substr(e.occurred_at,1,10) BETWEEN ? AND ?`,

      tenantId,

      start,

      today,
    )?.n ?? 0,
  )

  // --- Collections by calendar month -------------------------------------

  const monthly = all<Record<string, SqlValue>>(
    `SELECT substr(p.received_at,1,7) AS month,
            COALESCE(SUM(a.amount), 0) AS total
      FROM payment_allocations a
      JOIN payments p ON p.id = a.payment_id AND p.tenant_id = a.tenant_id
      WHERE a.tenant_id = ?
      GROUP BY month`,

    tenantId,
  )

  const collectedByMonth = new Map<string, number>()

  for (const row of monthly) {
    collectedByMonth.set(text(row.month), num(row.total))
  }

  const thisMonth = today.slice(0, 7)

  const months = trailingMonths(today, 12)

  const priorMonth = months.length >= 2 ? months[months.length - 2] : ""

  const collectionsThisMonth = collectedByMonth.has(thisMonth)
    ? (collectedByMonth.get(thisMonth) ?? 0)
    : null

  const collectionsPriorMonth =
    priorMonth && collectedByMonth.has(priorMonth)
      ? (collectedByMonth.get(priorMonth) ?? 0)
      : null

  const collectionsTrend: ChartDatum[] = months.map((key) => ({
    label: monthLabel(key),

    value: collectedByMonth.get(key) ?? 0,
  }))

  // --- Sales by project over the period ----------------------------------

  const salesByProject: ChartDatum[] = all<Record<string, SqlValue>>(
    `SELECT pr.name AS label, COALESCE(SUM(b.booking_amount), 0) AS value
      FROM bookings b
      JOIN projects pr ON pr.id = b.project_id AND pr.tenant_id = b.tenant_id
      WHERE b.tenant_id = ? AND b.status = 'confirmed'
        AND substr(b.booking_date,1,10) BETWEEN ? AND ?
      GROUP BY b.project_id
      ORDER BY value DESC
      LIMIT 8`,

    tenantId,

    start,

    today,
  ).map((row) => ({ label: text(row.label), value: num(row.value) }))

  const soldVsAvailable: ChartDatum[] = [
    { label: "Sold", value: sold },

    { label: "Available", value: available },

    { label: "Booked", value: countBy.get("booked") ?? 0 },

    { label: "Reserved", value: countBy.get("reserved") ?? 0 },

    {
      label: "Other",

      value: Math.max(
        0,

        totalInventory -
          sold -
          available -
          (countBy.get("booked") ?? 0) -
          (countBy.get("reserved") ?? 0),
      ),
    },
  ]

  // --- Top-performing agents over the period -----------------------------

  const topAgents: TopAgent[] = all<Record<string, SqlValue>>(
    `SELECT COALESCE(b.agent_name, 'Unassigned') AS name,
            COUNT(*) AS bookings,
            COALESCE(SUM(b.booking_amount), 0) AS value
      FROM bookings b
      WHERE b.tenant_id = ? AND b.status = 'confirmed'
        AND b.agent_user_id IS NOT NULL
        AND substr(b.booking_date,1,10) BETWEEN ? AND ?
      GROUP BY b.agent_user_id
      ORDER BY value DESC
      LIMIT 5`,

    tenantId,

    start,

    today,
  ).map((row) => ({
    name: text(row.name),

    bookings: num(row.bookings),

    value: num(row.value),
  }))

  const kpis: DashboardKpis = {
    totalInventory,

    sold,

    available,

    collectionsThisMonth,

    collectionsPriorMonth,

    totalReceivables: num(receivables),

    overdueAmount,

    revenue,

    expense,

    topAgents,
  }

  const charts: DashboardCharts = {
    collectionsTrend,

    salesByProject,

    soldVsAvailable,
  }

  return { currency, period, kpis, charts }
}
