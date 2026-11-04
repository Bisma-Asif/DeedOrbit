/**
 * Reports — eleven read-only projections over the operational tables.
 *
 * Nothing here stores anything. Each report is a query shaped into a generic
 * `{ columns, rows, totals, meta }` result the client renders in a `DataTable` and
 * exports verbatim. The money columns carry raw whole-unit integers so a CSV or
 * Excel opened downstream totals correctly; the currency and the active filters are
 * echoed in `meta` so an export standing on its own still says what period and scope
 * it covers.
 *
 * Every figure reuses the same tables and conventions the operational routes use:
 * "sold vs available" is a unit status count, "sales"/revenue is confirmed
 * `bookings.booking_amount`, collections are `payment_allocations` joined to
 * `payments.received_at`, aging reuses the delinquency bands from
 * `shared/collections.ts`, commissions come from `dealer_bookings` net of
 * `dealer_commission_payments`, and profitability sets booked revenue against
 * approved/paid `expenses`. Where the schema has no data for a claim, the cell is
 * left null and the table shows a dash rather than inventing a number.
 */

import { all, get, type SqlValue } from "../db.ts"

import { notFound, type RequestContext } from "../http.ts"

import { requireAuth, requirePermission } from "../middleware.ts"

import {
  bucketForDaysOverdue,
  type AgingBucket,
} from "../../shared/collections.ts"

import { BUILT_IN_UNIT_STATUS_LABELS } from "../../shared/inventory.ts"

import {
  REPORT_DESCRIPTIONS,
  REPORT_ICONS,
  REPORT_IDS,
  REPORT_LABELS,
  REPORT_SUPPORTED_FILTERS,
  isReportId,
  type ReportColumn,
  type ReportFilter,
  type ReportId,
  type ReportMetaLine,
  type ReportResult,
  type ReportRow,
  type ReportSummary,
  type ReportTotals,
} from "../../shared/reports.ts"

const nowISO = () => new Date().toISOString()

// --- Shared helpers --------------------------------------------------------

interface ResolvedFilters {
  from: string | null

  to: string | null

  projectId: string | null

  branchId: string | null
}

/** One WHERE fragment: a SQL condition and the params that bind into it, in order. */

interface Frag {
  sql: string

  params: SqlValue[]
}

/** The result of composing fragments: a full predicate and its ordered binds. */

interface WhereClause {
  sql: string

  params: SqlValue[]
}

interface BuiltReport {
  columns: ReportColumn[]

  rows: ReportRow[]

  /** Column keys that hold money and should be summed into `totals`. */

  money: string[]
}

function isIsoDay(value: string | null): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function readFilters(
  ctx: RequestContext,

  supported: ReportFilter[],
): ResolvedFilters {
  const date = (key: string): string | null => {
    if (!supported.includes("date")) return null

    const value = ctx.query.get(key)

    return isIsoDay(value) ? value : null
  }

  const id = (key: string): string | null => {
    const want =
      key === "projectId"
        ? supported.includes("project")
        : supported.includes("branch")

    if (!want) return null

    const value = ctx.query.get(key)

    return value && value.trim() ? value.trim() : null
  }

  return {
    from: date("from"),

    to: date("to"),

    projectId: id("projectId"),

    branchId: id("branchId"),
  }
}

/** `substr(col,1,10) >= ? [AND <= ?]` fragments for a date range. */

function dateFrags(col: string, f: ResolvedFilters): Frag[] {
  const frags: Frag[] = []

  if (f.from) frags.push({ sql: `substr(${col},1,10) >= ?`, params: [f.from] })

  if (f.to) frags.push({ sql: `substr(${col},1,10) <= ?`, params: [f.to] })

  return frags
}

function projectFrag(column: string, f: ResolvedFilters): Frag[] {
  return f.projectId ? [{ sql: `${column} = ?`, params: [f.projectId] }] : []
}

/** Restricts a user-attributed column to the members of one branch. */

function branchFrag(
  tenantId: string,

  userColumn: string,

  f: ResolvedFilters,
): Frag[] {
  if (!f.branchId) return []

  return [
    {
      sql: `${userColumn} IN (SELECT user_id FROM user_branches WHERE tenant_id = ? AND branch_id = ?)`,

      params: [tenantId, f.branchId],
    },
  ]
}

/** Joins fragments onto a base predicate and returns the ordered bind params. */

function where(
  base: Frag,

  extras: Frag[],
): WhereClause {
  const all0 = [base, ...extras]

  return {
    sql: `WHERE ${all0.map((frag) => frag.sql).join(" AND ")}`,

    params: all0.flatMap((frag) => frag.params),
  }
}

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

function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      86_400_000,
  )
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

function moneyColumn(key: string, label: string): ReportColumn {
  return { key, label, type: "money", align: "right" }
}

function numberColumn(key: string, label: string): ReportColumn {
  return { key, label, type: "number", align: "right" }
}

function sumBy(rows: ReportRow[], key: string): number {
  let total = 0

  for (const row of rows) {
    const value = row[key]

    if (typeof value === "number") total += value
  }

  return total
}

// --- Catalog ---------------------------------------------------------------

export async function listReports(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "reports", "view")

  const summaries: ReportSummary[] = REPORT_IDS.map((id: ReportId) => ({
    id,

    label: REPORT_LABELS[id],

    description: REPORT_DESCRIPTIONS[id],

    icon: REPORT_ICONS[id],

    supportedFilters: REPORT_SUPPORTED_FILTERS[id],
  }))

  // The branch picker's options ride on the catalog so a report viewer who lacks

  // `settings.view` can still scope an attributed report to one office. Offices are

  // read from the same table the branch filter resolves against.

  const branches = all<Record<string, SqlValue>>(
    `SELECT id, name FROM branches
      WHERE tenant_id = ?
      ORDER BY name COLLATE NOCASE`,

    guarded.tenantId,
  ).map((row) => ({ id: text(row.id), name: text(row.name) }))

  return { reports: summaries, branches }
}

// --- Individual report builders -------------------------------------------

function buildSales(tenantId: string, f: ResolvedFilters): BuiltReport {
  const columns: ReportColumn[] = [
    { key: "reference", label: "Reference", type: "text" },

    { key: "date", label: "Booking date", type: "date" },

    { key: "project", label: "Project", type: "text" },

    { key: "unit", label: "Unit", type: "text" },

    { key: "customer", label: "Customer", type: "text" },

    { key: "agent", label: "Agent", type: "text" },

    { key: "dealer", label: "Dealer", type: "text" },

    moneyColumn("amount", "Booking value"),
  ]

  const extras = [
    ...dateFrags("b.booking_date", f),

    ...projectFrag("b.project_id", f),

    ...branchFrag(tenantId, "b.agent_user_id", f),
  ]

  const w = where({ sql: "b.tenant_id = ?", params: [tenantId] }, extras)

  const rows = all<Record<string, SqlValue>>(
    `SELECT b.reference, b.booking_date AS date, p.name AS project,
            b.unit_code AS unit, b.customer_name AS customer,
            COALESCE(b.agent_name, '—') AS agent,
            COALESCE(b.dealer_name, '—') AS dealer,
            b.booking_amount AS amount
      FROM bookings b
      JOIN projects p ON p.id = b.project_id AND p.tenant_id = b.tenant_id
      ${w.sql} AND b.status = 'confirmed'
      ORDER BY b.booking_date DESC, b.reference DESC`,

    ...w.params,
  ).map((row) => ({
    reference: text(row.reference),

    date: text(row.date),

    project: text(row.project),

    unit: text(row.unit),

    customer: text(row.customer),

    agent: text(row.agent),

    dealer: text(row.dealer),

    amount: num(row.amount),
  }))

  return { columns, rows, money: ["amount"] }
}

function buildBookings(tenantId: string, f: ResolvedFilters): BuiltReport {
  const columns: ReportColumn[] = [
    { key: "reference", label: "Reference", type: "text" },

    { key: "date", label: "Booking date", type: "date" },

    { key: "project", label: "Project", type: "text" },

    { key: "unit", label: "Unit", type: "text" },

    { key: "customer", label: "Customer", type: "text" },

    { key: "agent", label: "Agent", type: "text" },

    moneyColumn("amount", "Booking value"),

    { key: "status", label: "Status", type: "badge" },
  ]

  const extras = [
    ...dateFrags("b.booking_date", f),

    ...projectFrag("b.project_id", f),

    ...branchFrag(tenantId, "b.agent_user_id", f),
  ]

  const w = where({ sql: "b.tenant_id = ?", params: [tenantId] }, extras)

  const rows = all<Record<string, SqlValue>>(
    `SELECT b.reference, b.booking_date AS date, p.name AS project,
            b.unit_code AS unit, b.customer_name AS customer,
            COALESCE(b.agent_name, '—') AS agent,
            b.booking_amount AS amount, b.status
      FROM bookings b
      JOIN projects p ON p.id = b.project_id AND p.tenant_id = b.tenant_id
      ${w.sql}
      ORDER BY b.booking_date DESC, b.reference DESC`,

    ...w.params,
  ).map((row) => ({
    reference: text(row.reference),

    date: text(row.date),

    project: text(row.project),

    unit: text(row.unit),

    customer: text(row.customer),

    agent: text(row.agent),

    amount: num(row.amount),

    status: text(row.status),
  }))

  return { columns, rows, money: ["amount"] }
}

function buildInventory(
  tenantId: string,

  f: ResolvedFilters,
): BuiltReport {
  const columns: ReportColumn[] = [
    { key: "unit", label: "Unit", type: "text" },

    { key: "project", label: "Project", type: "text" },

    { key: "type", label: "Type", type: "text" },

    { key: "location", label: "Location", type: "text" },

    numberColumn("size", "Size (sqft)"),

    moneyColumn("price", "Base price"),

    { key: "status", label: "Status", type: "badge" },
  ]

  const extras = [...projectFrag("u.project_id", f)]

  const w = where({ sql: "u.tenant_id = ?", params: [tenantId] }, extras)

  const raw = all<Record<string, SqlValue>>(
    `SELECT u.unit_code AS unit, p.name AS project, u.unit_type AS type,
            COALESCE(u.location, '—') AS location, u.size_sqft AS size,
            u.base_price AS price, u.status AS status_key,
            s.label AS status_label
      FROM inventory_units u
      JOIN projects p ON p.id = u.project_id AND p.tenant_id = u.tenant_id
      LEFT JOIN inventory_unit_statuses s
        ON s.tenant_id = u.tenant_id AND s.key = u.status
      ${w.sql}
      ORDER BY p.name, u.unit_code COLLATE NOCASE`,

    ...w.params,
  )

  const rows: ReportRow[] = raw.map((row) => {
    const key = text(row.status_key)

    return {
      unit: text(row.unit),

      project: text(row.project),

      type: text(row.type),

      location: text(row.location),

      size: num(row.size),

      price: num(row.price),

      status: text(row.status_label) || BUILT_IN_UNIT_STATUS_LABELS[key] || key,
    }
  })

  return { columns, rows, money: ["price"] }
}

function buildCollections(
  tenantId: string,

  f: ResolvedFilters,
): BuiltReport {
  const columns: ReportColumn[] = [
    { key: "received", label: "Received", type: "date" },

    { key: "booking", label: "Booking", type: "text" },

    { key: "customer", label: "Customer", type: "text" },

    { key: "project", label: "Project", type: "text" },

    { key: "officer", label: "Officer", type: "text" },

    moneyColumn("amount", "Collected"),
  ]

  const extras = [
    ...dateFrags("p.received_at", f),

    ...projectFrag("b.project_id", f),

    ...branchFrag(tenantId, "i.collection_officer_user_id", f),
  ]

  const w = where({ sql: "a.tenant_id = ?", params: [tenantId] }, extras)

  const rows: ReportRow[] = all<Record<string, SqlValue>>(
    `SELECT p.received_at AS received, b.reference AS booking,
            b.customer_name AS customer, pr.name AS project,
            COALESCE(o.full_name, 'Unassigned') AS officer,
            a.amount
      FROM payment_allocations a
      JOIN payments p ON p.id = a.payment_id AND p.tenant_id = a.tenant_id
      JOIN payment_installments i
        ON i.id = a.installment_id AND i.tenant_id = a.tenant_id
      JOIN bookings b ON b.id = i.booking_id AND b.tenant_id = a.tenant_id
      JOIN projects pr ON pr.id = b.project_id AND pr.tenant_id = a.tenant_id
      LEFT JOIN users o
        ON o.id = i.collection_officer_user_id AND o.tenant_id = a.tenant_id
      ${w.sql}
      ORDER BY p.received_at DESC`,

    ...w.params,
  ).map((row) => ({
    received: text(row.received),

    booking: text(row.booking),

    customer: text(row.customer),

    project: text(row.project),

    officer: text(row.officer),

    amount: num(row.amount),
  }))

  return { columns, rows, money: ["amount"] }
}

function buildOverdue(tenantId: string, f: ResolvedFilters): BuiltReport {
  const columns: ReportColumn[] = [
    { key: "booking", label: "Booking", type: "text" },

    { key: "customer", label: "Customer", type: "text" },

    { key: "project", label: "Project", type: "text" },

    { key: "officer", label: "Officer", type: "text" },

    { key: "due", label: "Due date", type: "date" },

    numberColumn("days", "Days overdue"),

    { key: "band", label: "Band", type: "badge" },

    moneyColumn("outstanding", "Outstanding"),
  ]

  const extras = [
    ...dateFrags("i.due_date", f),

    ...projectFrag("b.project_id", f),

    ...branchFrag(tenantId, "i.collection_officer_user_id", f),
  ]

  const today = tenantToday(tenantId)

  const w = where(
    {
      sql: "i.tenant_id = ? AND b.status = 'confirmed' AND (i.total - i.paid_amount) > 0 AND i.due_date < ?",

      params: [tenantId, today],
    },

    extras,
  )

  const raw = all<Record<string, SqlValue>>(
    `SELECT b.reference AS booking, b.customer_name AS customer,
            pr.name AS project,
            COALESCE(o.full_name, 'Unassigned') AS officer,
            i.due_date AS due, (i.total - i.paid_amount) AS outstanding
      FROM payment_installments i
      JOIN bookings b ON b.id = i.booking_id AND b.tenant_id = i.tenant_id
      JOIN projects pr ON pr.id = b.project_id AND pr.tenant_id = i.tenant_id
      LEFT JOIN users o
        ON o.id = i.collection_officer_user_id AND o.tenant_id = i.tenant_id
      ${w.sql}
      ORDER BY i.due_date ASC`,

    ...w.params,
  )

  const rows: ReportRow[] = raw.map((row) => {
    const due = text(row.due)

    const days = Math.max(0, daysBetween(due, today))

    const band: AgingBucket | null = bucketForDaysOverdue(days)

    return {
      booking: text(row.booking),

      customer: text(row.customer),

      project: text(row.project),

      officer: text(row.officer),

      due,

      days,

      band: band ?? "Current",

      outstanding: num(row.outstanding),
    }
  })

  return { columns, rows, money: ["outstanding"] }
}

function periodMonthOf(f: ResolvedFilters): string {
  if (f.from) return f.from.slice(0, 7)

  return nowISO().slice(0, 7)
}

function buildAgentPerformance(
  tenantId: string,

  f: ResolvedFilters,
): BuiltReport {
  const columns: ReportColumn[] = [
    { key: "agent", label: "Agent", type: "text" },

    { key: "team", label: "Team", type: "text" },

    numberColumn("closed", "Bookings closed"),

    moneyColumn("value", "Booking value"),

    numberColumn("bookingsTarget", "Bookings target"),

    moneyColumn("collectionsTarget", "Collections target"),
  ]

  // Closed bookings and value per agent, respecting the report filters. The agent

  // attribution lives on the booking, so the branch filter narrows the agent.

  const aggExtras = [
    ...dateFrags("b.booking_date", f),

    ...projectFrag("b.project_id", f),

    ...branchFrag(tenantId, "b.agent_user_id", f),
  ]

  const aggW = where(
    {
      sql: "b.tenant_id = ? AND b.status = 'confirmed' AND b.agent_user_id IS NOT NULL",

      params: [tenantId],
    },

    aggExtras,
  )

  const agg = all<Record<string, SqlValue>>(
    `SELECT b.agent_user_id AS id, COUNT(*) AS closed,
            COALESCE(SUM(b.booking_amount), 0) AS value
      FROM bookings b
      ${aggW.sql}
      GROUP BY b.agent_user_id`,

    ...aggW.params,
  )

  const closedById = new Map<string, number>()

  const valueById = new Map<string, number>()

  for (const row of agg) {
    closedById.set(text(row.id), num(row.closed))

    valueById.set(text(row.id), num(row.value))
  }

  // The roster of active sales agents with their team and the targets set for the

  // period, so an agent with no filtered bookings still appears against a target.

  const rosterExtras = [...branchFrag(tenantId, "u.id", f)]

  const rosterW = where(
    {
      sql: "u.tenant_id = ? AND u.status = 'active' AND m.role_id = 'sales_agent'",

      params: [tenantId],
    },

    rosterExtras,
  )

  const period = periodMonthOf(f)

  const roster = all<Record<string, SqlValue>>(
    `SELECT u.id, u.full_name AS agent, COALESCE(t.name, '—') AS team,
            target.bookings_target, target.collections_target
      FROM users u
      JOIN tenant_memberships m
        ON m.tenant_id = u.tenant_id AND m.user_id = u.id
      LEFT JOIN sales_team_members tm
        ON tm.tenant_id = u.tenant_id AND tm.user_id = u.id
      LEFT JOIN sales_teams t ON t.id = tm.team_id AND t.tenant_id = u.tenant_id
      LEFT JOIN sales_agent_targets target
        ON target.tenant_id = u.tenant_id
        AND target.user_id = u.id
        AND target.period_month = ?
      ${rosterW.sql}
      ORDER BY team, agent COLLATE NOCASE`,

    period,

    ...rosterW.params,
  )

  const rows: ReportRow[] = roster.map((row) => {
    const id = text(row.id)

    const bookingsTarget = row.bookings_target

    const collectionsTarget = row.collections_target

    return {
      agent: text(row.agent),

      team: text(row.team),

      closed: closedById.get(id) ?? 0,

      value: valueById.get(id) ?? 0,

      bookingsTarget:
        bookingsTarget === null || bookingsTarget === undefined
          ? null
          : num(bookingsTarget),

      collectionsTarget:
        collectionsTarget === null || collectionsTarget === undefined
          ? null
          : num(collectionsTarget),
    }
  })

  return { columns, rows, money: ["value", "collectionsTarget"] }
}

function buildDealerCommissions(
  tenantId: string,

  f: ResolvedFilters,
): BuiltReport {
  const columns: ReportColumn[] = [
    { key: "dealer", label: "Dealer", type: "text" },

    { key: "project", label: "Project", type: "text" },

    { key: "date", label: "Booking date", type: "date" },

    { key: "reference", label: "Reference", type: "text" },

    moneyColumn("bookingAmount", "Booking value"),

    moneyColumn("earned", "Commission earned"),

    moneyColumn("paid", "Commission paid"),

    moneyColumn("payable", "Commission payable"),
  ]

  const extras = [
    ...dateFrags("db.booking_date", f),

    ...projectFrag("db.project_id", f),

    ...branchFrag(tenantId, "d.portal_user_id", f),
  ]

  const w = where({ sql: "db.tenant_id = ?", params: [tenantId] }, extras)

  const raw = all<Record<string, SqlValue>>(
    `SELECT d.company_name AS dealer, pr.name AS project,
            db.booking_date AS date, db.booking_reference AS reference,
            db.booking_amount AS booking_amount,
            COALESCE(db.commission_amount, 0) AS earned,
            (SELECT COALESCE(SUM(cp.amount), 0)
              FROM dealer_commission_payments cp
              WHERE cp.tenant_id = db.tenant_id AND cp.booking_id = db.id) AS paid
      FROM dealer_bookings db
      JOIN dealers d ON d.id = db.dealer_id AND d.tenant_id = db.tenant_id
      JOIN projects pr ON pr.id = db.project_id AND pr.tenant_id = db.tenant_id
      ${w.sql}
      ORDER BY db.booking_date DESC`,

    ...w.params,
  )

  const rows: ReportRow[] = raw.map((row) => {
    const earned = num(row.earned)

    const paid = num(row.paid)

    return {
      dealer: text(row.dealer),

      project: text(row.project),

      date: text(row.date),

      reference: text(row.reference),

      bookingAmount: num(row.booking_amount),

      earned,

      paid,

      payable: earned - paid,
    }
  })

  return {
    columns,

    rows,

    money: ["bookingAmount", "earned", "paid", "payable"],
  }
}

function buildProfitability(
  tenantId: string,

  f: ResolvedFilters,
): BuiltReport {
  const columns: ReportColumn[] = [
    { key: "project", label: "Project", type: "text" },

    moneyColumn("revenue", "Booked revenue"),

    moneyColumn("collected", "Collected"),

    moneyColumn("expense", "Expenses"),

    moneyColumn("net", "Net (revenue − expenses)"),
  ]

  const revExtras = [
    ...dateFrags("b.booking_date", f),

    ...projectFrag("b.project_id", f),
  ]

  const revW = where(
    {
      sql: "b.tenant_id = ? AND b.status = 'confirmed'",

      params: [tenantId],
    },

    revExtras,
  )

  const revenue = new Map<string, number>()

  for (const row of all<Record<string, SqlValue>>(
    `SELECT b.project_id AS id, COALESCE(SUM(b.booking_amount), 0) AS total
      FROM bookings b
      ${revW.sql}
      GROUP BY b.project_id`,

    ...revW.params,
  )) {
    revenue.set(text(row.id), num(row.total))
  }

  const colExtras = [
    ...dateFrags("p.received_at", f),

    ...projectFrag("b.project_id", f),
  ]

  const colW = where({ sql: "a.tenant_id = ?", params: [tenantId] }, colExtras)

  const collected = new Map<string, number>()

  for (const row of all<Record<string, SqlValue>>(
    `SELECT b.project_id AS id, COALESCE(SUM(a.amount), 0) AS total
      FROM payment_allocations a
      JOIN payments p ON p.id = a.payment_id AND p.tenant_id = a.tenant_id
      JOIN payment_installments i
        ON i.id = a.installment_id AND i.tenant_id = a.tenant_id
      JOIN bookings b ON b.id = i.booking_id AND b.tenant_id = a.tenant_id
      ${colW.sql}
      GROUP BY b.project_id`,

    ...colW.params,
  )) {
    collected.set(text(row.id), num(row.total))
  }

  // The cost side counts spend that has actually been committed: an approved or

  // paid expense. Draft, pending, and rejected costs are not yet a real outflow.

  const expExtras = [
    ...dateFrags("e.occurred_at", f),

    ...projectFrag("e.project_id", f),
  ]

  const expW = where(
    {
      sql: "e.tenant_id = ? AND e.project_id IS NOT NULL AND e.status IN ('approved','paid')",

      params: [tenantId],
    },

    expExtras,
  )

  const expense = new Map<string, number>()

  for (const row of all<Record<string, SqlValue>>(
    `SELECT e.project_id AS id, COALESCE(SUM(e.amount), 0) AS total
      FROM expenses e
      ${expW.sql}
      GROUP BY e.project_id`,

    ...expW.params,
  )) {
    expense.set(text(row.id), num(row.total))
  }

  const projExtras = [...projectFrag("p.id", f)]

  const projW = where(
    { sql: "p.tenant_id = ?", params: [tenantId] },
    projExtras,
  )

  const projects = all<Record<string, SqlValue>>(
    `SELECT p.id, p.name FROM projects p ${projW.sql} ORDER BY p.name COLLATE NOCASE`,

    ...projW.params,
  )

  const rows: ReportRow[] = projects.map((row) => {
    const id = text(row.id)

    const rev = revenue.get(id) ?? 0

    const exp = expense.get(id) ?? 0

    return {
      project: text(row.name),

      revenue: rev,

      collected: collected.get(id) ?? 0,

      expense: exp,

      net: rev - exp,
    }
  })

  return {
    columns,

    rows,

    money: ["revenue", "collected", "expense", "net"],
  }
}

function buildExpenses(tenantId: string, f: ResolvedFilters): BuiltReport {
  const columns: ReportColumn[] = [
    { key: "date", label: "Occurred", type: "date" },

    { key: "category", label: "Category", type: "text" },

    { key: "project", label: "Project", type: "text" },

    { key: "vendor", label: "Vendor", type: "text" },

    { key: "description", label: "Description", type: "text" },

    { key: "status", label: "Status", type: "badge" },

    moneyColumn("amount", "Amount"),
  ]

  const extras = [
    ...dateFrags("e.occurred_at", f),

    ...projectFrag("e.project_id", f),
  ]

  const w = where({ sql: "e.tenant_id = ?", params: [tenantId] }, extras)

  const rows: ReportRow[] = all<Record<string, SqlValue>>(
    `SELECT e.occurred_at AS date, e.category,
            COALESCE(pr.name, '—') AS project,
            COALESCE(v.name, '—') AS vendor,
            e.description, e.status, e.amount
      FROM expenses e
      LEFT JOIN projects pr ON pr.id = e.project_id AND pr.tenant_id = e.tenant_id
      LEFT JOIN vendors v ON v.id = e.vendor_id AND v.tenant_id = e.tenant_id
      ${w.sql}
      ORDER BY e.occurred_at DESC`,

    ...w.params,
  ).map((row) => ({
    date: text(row.date),

    category: text(row.category),

    project: text(row.project),

    vendor: text(row.vendor),

    description: text(row.description),

    status: text(row.status),

    amount: num(row.amount),
  }))

  return { columns, rows, money: ["amount"] }
}

function buildCancellations(
  tenantId: string,

  f: ResolvedFilters,
): BuiltReport {
  const columns: ReportColumn[] = [
    { key: "reference", label: "Reference", type: "text" },

    { key: "cancelled", label: "Cancelled", type: "date" },

    { key: "project", label: "Project", type: "text" },

    { key: "unit", label: "Unit", type: "text" },

    { key: "customer", label: "Customer", type: "text" },

    { key: "by", label: "Cancelled by", type: "text" },

    moneyColumn("amount", "Booking value"),

    moneyColumn("refund", "Refund approved"),
  ]

  const extras = [
    ...dateFrags("b.cancelled_at", f),

    ...projectFrag("b.project_id", f),

    ...branchFrag(tenantId, "b.agent_user_id", f),
  ]

  const w = where(
    { sql: "b.tenant_id = ? AND b.status = 'cancelled'", params: [tenantId] },

    extras,
  )

  const rows: ReportRow[] = all<Record<string, SqlValue>>(
    `SELECT b.reference, COALESCE(b.cancelled_at, b.updated_at) AS cancelled,
            p.name AS project, b.unit_code AS unit, b.customer_name AS customer,
            COALESCE(b.cancelled_by_name, '—') AS by, b.booking_amount AS amount,
            (SELECT COALESCE(SUM(r.amount), 0) FROM refunds r
              WHERE r.tenant_id = b.tenant_id AND r.booking_id = b.id
                AND r.status = 'approved') AS refund
      FROM bookings b
      JOIN projects p ON p.id = b.project_id AND p.tenant_id = b.tenant_id
      ${w.sql}
      ORDER BY cancelled DESC, b.reference DESC`,

    ...w.params,
  ).map((row) => ({
    reference: text(row.reference),

    cancelled: text(row.cancelled),

    project: text(row.project),

    unit: text(row.unit),

    customer: text(row.customer),

    by: text(row.by),

    amount: num(row.amount),

    refund: num(row.refund),
  }))

  return { columns, rows, money: ["amount", "refund"] }
}

function buildTransfers(tenantId: string, f: ResolvedFilters): BuiltReport {
  const columns: ReportColumn[] = [
    { key: "booking", label: "Booking", type: "text" },

    { key: "project", label: "Project", type: "text" },

    { key: "from", label: "From customer", type: "text" },

    { key: "to", label: "To customer", type: "text" },

    moneyColumn("fee", "Transfer fee"),

    moneyColumn("outstanding", "Outstanding moved"),

    { key: "status", label: "Status", type: "badge" },

    { key: "requested", label: "Requested", type: "date" },

    { key: "completed", label: "Completed", type: "date" },
  ]

  const extras = [
    ...dateFrags("t.requested_at", f),

    ...projectFrag("b.project_id", f),
  ]

  const w = where({ sql: "t.tenant_id = ?", params: [tenantId] }, extras)

  const rows: ReportRow[] = all<Record<string, SqlValue>>(
    `SELECT b.reference AS booking, pr.name AS project,
            fc.full_name AS from_name, tc.full_name AS to_name,
            t.fee, t.outstanding_moved AS outstanding, t.status,
            t.requested_at AS requested, t.completed_at AS completed
      FROM transfers t
      JOIN bookings b ON b.id = t.booking_id AND b.tenant_id = t.tenant_id
      JOIN projects pr ON pr.id = b.project_id AND pr.tenant_id = t.tenant_id
      JOIN customers fc ON fc.id = t.from_customer_id AND fc.tenant_id = t.tenant_id
      JOIN customers tc ON tc.id = t.to_customer_id AND tc.tenant_id = t.tenant_id
      ${w.sql}
      ORDER BY t.requested_at DESC`,

    ...w.params,
  ).map((row) => ({
    booking: text(row.booking),

    project: text(row.project),

    from: text(row.from_name),

    to: text(row.to_name),

    fee: num(row.fee),

    outstanding: num(row.outstanding),

    status: text(row.status),

    requested: text(row.requested),

    completed: row.completed === null ? "" : text(row.completed),
  }))

  return { columns, rows, money: ["fee", "outstanding"] }
}

const BUILDERS: Record<ReportId, (
  tenantId: string,
  f: ResolvedFilters,
) => BuiltReport> = {
  sales: buildSales,

  inventory_status: buildInventory,

  bookings: buildBookings,

  collections: buildCollections,

  overdue_aging: buildOverdue,

  agent_performance: buildAgentPerformance,

  dealer_commissions: buildDealerCommissions,

  project_profitability: buildProfitability,

  expenses: buildExpenses,

  cancellations: buildCancellations,

  transfers: buildTransfers,
}

// --- Dispatcher ------------------------------------------------------------

function metaLines(
  tenantId: string,

  id: ReportId,

  f: ResolvedFilters,

  generatedAt: string,
): ReportMetaLine[] {
  const meta: ReportMetaLine[] = [{ label: "Report", value: REPORT_LABELS[id] }]

  meta.push({
    label: "Period",

    value:
      f.from || f.to ? `${f.from ?? "start"} → ${f.to ?? "today"}` : "All time",
  })

  let projectValue = "All projects"

  if (f.projectId) {
    const name = get<{ name: string }>(
      "SELECT name FROM projects WHERE tenant_id = ? AND id = ?",

      tenantId,

      f.projectId,
    )?.name

    projectValue = name ?? "—"
  }

  meta.push({ label: "Project", value: projectValue })

  if (f.branchId) {
    const branchName = get<{ name: string }>(
      "SELECT name FROM branches WHERE tenant_id = ? AND id = ?",

      tenantId,

      f.branchId,
    )?.name

    meta.push({ label: "Branch", value: branchName ?? "—" })
  }

  meta.push({ label: "Generated", value: generatedAt })

  return meta
}

export async function getReport(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "reports", "view")

  const idParam = ctx.params.id ?? ""

  if (!isReportId(idParam)) throw notFound("That report does not exist")

  const id: ReportId = idParam

  const supported = REPORT_SUPPORTED_FILTERS[id]

  const f = readFilters(ctx, supported)

  const built = BUILDERS[id](guarded.tenantId, f)

  const currency = tenantCurrency(guarded.tenantId)

  const generatedAt = nowISO()

  const totals: ReportTotals = {}

  for (const key of built.money) totals[key] = sumBy(built.rows, key)

  const result: ReportResult = {
    reportId: id,

    title: REPORT_LABELS[id],

    currency,

    generatedAt,

    columns: built.columns,

    rows: built.rows,

    totals,

    meta: metaLines(guarded.tenantId, id, f, generatedAt),

    supportedFilters: supported,
  }

  return result
}
