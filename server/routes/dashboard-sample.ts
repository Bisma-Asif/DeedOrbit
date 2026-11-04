/**
 * "Load sample data" / "Remove sample data" for the brand-new workspace.
 *
 * The dashboard must never open on a wall of zeros, so an owner can ask for a
 * labelled demo dataset — a project with units, two converted leads, bookings
 * with real schedules, a receipt, an overdue installment and a pending
 * approval — and see the whole command center working. Two rules hold:
 *
 *  * Every row is registered in `dashboard_sample_rows` as it is written.
 *    Removal deletes by that registry in FK-safe order, so demo rows are
 *    removed completely and a real row can never be caught by the sweep, even
 *    if an owner later edits a label and drops the "[Sample]" prefix.
 *
 *  * Every business label carries the "[Sample]" prefix, so a demo figure is
 *    never mistaken for the workspace's own numbers.
 *
 * The gate is `settings.edit` — tenant owner and tenant admin hold it; no
 * sales, recovery, or dealer role can seed or wipe rows behind their back.
 */

import { randomBytes } from "node:crypto"

import { all, get, run, transaction, type SqlValue } from "../db.ts"

import {
  badRequest,
  conflict,
  readJsonBody,
  type RequestContext,
} from "../http.ts"

import { requirePermission, requireAuth, writeAudit } from "../middleware.ts"

import { invalidateDashboardCache } from "./dashboard-overview.ts"

import { DEMO_TENANT_SLUG, loadDemoDataset } from "../sample/dataset.ts"

import { DEMO_PASSWORD } from "../sample/people.ts"

import { removeSampleRows, sampleRowCounts } from "../sample/remove.ts"

const nowISO = () => new Date().toISOString()

/** ISO `YYYY-MM-DD` for the tenant-local day `days` before today. */

function dayMinus(today: string, days: number): string {
  const base = Date.parse(`${today}T00:00:00Z`)

  return new Date(base - days * 86_400_000).toISOString().slice(0, 10)
}

function stamp(today: string, days: number): string {
  return `${dayMinus(today, days)}T09:30:00.000Z`
}

const SAMPLE_SHORT = "SMP"

interface SampleRow {
  table: string

  id: string
}

/**
 * Row shapes read from SQLite. Named interfaces only: oxfmt strips the
 * separators from single-line multi-member object *type* literals.
 */
interface AgentRow {
  id: string

  full_name: string
}

interface UnitRef {
  id: string

  price: number
}

interface TenantDefaults {
  slug: string

  currency: string

  timezone: string
}

function sampleId(prefix: string): string {
  return `${prefix}_${randomBytes(6).toString("hex")}`
}

/** Writes the row *and* registers it, so removal can find it later. */

function remember(
  rows: SampleRow[],

  table: string,

  id: string,

  write: () => void,
): void {
  write()

  rows.push({ table, id })
}

/**
 * The demo dataset. Money figures sit at Pakistan scale (a PKR crore is 1e7)
 * so the lakh/crore formatters get exercised the way real entries will.
 */

function buildSample(
  tenantId: string,

  today: string,

  currency: string,

  actorUserId: string,

  actorName: string,
): SampleRow[] {
  const rows: SampleRow[] = []

  const projectId = sampleId("smp_proj")

  const nodeId = sampleId("smp_node")

  const agent = get<AgentRow>(
    `SELECT u.id, u.full_name FROM users u
       JOIN tenant_memberships m ON m.tenant_id = u.tenant_id AND m.user_id = u.id
      WHERE u.tenant_id = ? AND u.status = 'active'
      ORDER BY CASE m.role_id WHEN 'sales_agent' THEN 0 ELSE 1 END, u.created_at
      LIMIT 1`,

    tenantId,
  )

  const agentId = agent?.id ?? actorUserId

  const agentName = agent?.full_name ?? actorName

  remember(rows, "projects", projectId, () =>
    run(
      `INSERT INTO projects (
         id, tenant_id, name, code, developer, location, status,
         launch_date, handover_date, planned_units, description,
         created_at, updated_at
       ) VALUES (?, ?, '[Sample] Emerald Heights', ?, '[Sample] Innovista Estate',
         'DHA Phase 6, Lahore', 'on_sale', ?, ?, 12,
         'Demo project loaded from the dashboard. Remove it with "Remove sample data".',
         ?, ?)`,

      projectId,

      tenantId,

      `${SAMPLE_SHORT}-EMH`,

      dayMinus(today, -45),

      dayMinus(today, -270),

      stamp(today, 60),

      stamp(today, 2),
    ),
  )

  remember(rows, "project_structure_nodes", nodeId, () =>
    run(
      `INSERT INTO project_structure_nodes (
         id, tenant_id, project_id, parent_id, kind, name, sort_order,
         created_at, updated_at
       ) VALUES (?, ?, ?, NULL, 'block', 'Block A', 0, ?, ?)`,

      nodeId,

      tenantId,

      projectId,

      stamp(today, 60),

      stamp(today, 60),
    ),
  )

  // 12 units: 5 available, 2 reserved, 2 booked, 2 sold, 1 on hold.

  const unitSpecs: Array<[string, string, number]> = [
    ["A-101", "sold", 25_000_000],

    ["A-102", "sold", 30_500_000],

    ["A-201", "booked", 18_750_000],

    ["A-202", "booked", 22_000_000],

    ["A-301", "reserved", 27_500_000],

    ["A-302", "reserved", 27_500_000],

    ["B-101", "available", 15_000_000],

    ["B-102", "available", 16_500_000],

    ["B-201", "available", 20_000_000],

    ["B-202", "available", 24_000_000],

    ["C-101", "available", 42_500_000],

    ["C-102", "hold", 35_000_000],
  ]

  const unitIds = new Map<string, UnitRef>()

  unitSpecs.forEach(([code, status, price], index) => {
    const id = sampleId("smp_unit")

    unitIds.set(code, { id, price })

    remember(rows, "inventory_units", id, () =>
      run(
        `INSERT INTO inventory_units (
           id, tenant_id, project_id, structure_node_id, unit_code, unit_type,
           location, size_sqft, base_price, pricing_config, status,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, 'apartment', NULL, ?, ?, '{}', ?, ?, ?)`,

        id,

        tenantId,

        projectId,

        nodeId,

        code,

        1200 + index * 75,

        price,

        status,

        stamp(today, 60),

        stamp(today, 60),
      ),
    )

    // The status trail backs the dashboard's unit-count sparklines, so even

    // the demo dataset moves units through it honestly.

    const createdHistory = sampleId("smp_hist")

    remember(rows, "inventory_unit_status_history", createdHistory, () =>
      run(
        `INSERT INTO inventory_unit_status_history (
           id, tenant_id, project_id, unit_id, from_status, to_status,
           changed_by_user_id, changed_by_name, source, note, changed_at
         ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, 'system', NULL, ?)`,

        createdHistory,

        tenantId,

        projectId,

        id,

        status,

        actorUserId,

        actorName,

        stamp(today, 60),
      ),
    )
  })

  // The two sold units pass through "available" first, so the sold/available

  // sparklines on the dashboard have real transitions to follow.

  for (const code of ["A-101", "A-102"]) {
    const unit = unitIds.get(code)!

    const soldHistory = sampleId("smp_hist")

    const soldDay = code === "A-101" ? 35 : 3

    remember(rows, "inventory_unit_status_history", soldHistory, () =>
      run(
        `INSERT INTO inventory_unit_status_history (
           id, tenant_id, project_id, unit_id, from_status, to_status,
           changed_by_user_id, changed_by_name, source, note, changed_at
         ) VALUES (?, ?, ?, ?, 'available', 'sold', ?, ?, 'system', NULL, ?)`,

        soldHistory,

        tenantId,

        projectId,

        unit.id,

        actorUserId,

        actorName,

        stamp(today, soldDay),
      ),
    )
  }

  // Leads: two convert to the sample customers, two stay open.

  const leadSpecs: Array<[string, string, string]> = [
    ["[Sample] Bilal Ahmed", "qualified", "portal"],

    ["[Sample] Sana Tariq", "new", "referral"],

    ["[Sample] Usman Malik", "won", "campaign"],

    ["[Sample] Ayesha Khan", "contacted", "walk-in"],
  ]

  const leadIds: string[] = []

  for (const [name, status, source] of leadSpecs) {
    const id = sampleId("smp_lead")

    leadIds.push(id)

    remember(rows, "leads", id, () =>
      run(
        `INSERT INTO leads (
           id, tenant_id, full_name, phone, email, source, campaign,
           project_interest, assigned_agent_id, status, created_by,
           created_at, updated_at
         ) VALUES (?, ?, ?, '0300-0000000', NULL, ?, NULL, '[Sample] Emerald Heights',
           ?, ?, ?, ?, ?)`,

        id,

        tenantId,

        name,

        source,

        agentId,

        status,

        actorUserId,

        stamp(today, 12),

        stamp(today, 2),
      ),
    )
  }

  // Two customers, each traced back to its sample lead.

  const customerSpecs: Array<[string, string, number]> = [
    ["[Sample] Bilal Ahmed", leadIds[0]!, 35],

    ["[Sample] Usman Malik", leadIds[2]!, 3],
  ]

  const customerIds: string[] = []

  for (const [name, leadId, daysAgo] of customerSpecs) {
    const id = sampleId("smp_cust")

    customerIds.push(id)

    remember(rows, "customers", id, () =>
      run(
        `INSERT INTO customers (
           id, tenant_id, source_lead_id, full_name, phone, email,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, '0300-0000000', NULL, ?, ?)`,

        id,

        tenantId,

        leadId,

        name,

        stamp(today, daysAgo),

        stamp(today, daysAgo),
      ),
    )
  }

  // Two confirmed bookings, each on one of the sold units, with a schedule.

  const bookingSpecs: Array<{
    unitCode: string

    customerId: string

    customerName: string

    amount: number

    daysAgo: number

    ref: string
  }> = [
    {
      unitCode: "A-101",

      customerId: customerIds[0]!,

      customerName: "[Sample] Bilal Ahmed",

      amount: unitIds.get("A-101")!.price,

      daysAgo: 35,

      ref: "SMP-BK-0001",
    },

    {
      unitCode: "A-102",

      customerId: customerIds[1]!,

      customerName: "[Sample] Usman Malik",

      amount: unitIds.get("A-102")!.price,

      daysAgo: 3,

      ref: "SMP-BK-0002",
    },
  ]

  const firstBookingIds: string[] = []

  bookingSpecs.forEach((spec, specIndex) => {
    const bookingId = sampleId("smp_booking")

    firstBookingIds.push(bookingId)

    const planId = sampleId("smp_plan")

    const unit = unitIds.get(spec.unitCode)!

    remember(rows, "bookings", bookingId, () =>
      run(
        `INSERT INTO bookings (
           id, tenant_id, project_id, unit_id, customer_id, agent_user_id,
           agent_name, reference, unit_code, customer_name, booking_amount,
           booking_date, status, terms, notes, created_by_user_id,
           created_by_name, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?,
           'Sample record for dashboard exploration.', ?, ?, ?, ?)`,

        bookingId,

        tenantId,

        projectId,

        unit.id,

        spec.customerId,

        agentId,

        agentName,

        spec.ref,

        spec.unitCode,

        spec.customerName,

        spec.amount,

        dayMinus(today, spec.daysAgo),

        "Standard installment terms (sample).",

        actorUserId,

        actorName,

        stamp(today, spec.daysAgo),

        stamp(today, spec.daysAgo),
      ),
    )

    const down = Math.round(spec.amount * 0.2)

    const step = Math.round((spec.amount - down) / 3)

    remember(rows, "payment_plans", planId, () =>
      run(
        `INSERT INTO payment_plans (
           id, tenant_id, booking_id, currency, net_amount,
           down_payment_percent, charges, frequency, installment_count,
           balloon_amount, start_date, status, created_by_user_id,
           created_by_name, created_at, confirmed_at
         ) VALUES (?, ?, ?, ?, ?, 20, 0, 'monthly', 3, 0, ?, 'confirmed', ?, ?, ?, ?)`,

        planId,

        tenantId,

        bookingId,

        currency,

        spec.amount,

        dayMinus(today, spec.daysAgo),

        actorUserId,

        actorName,

        stamp(today, spec.daysAgo),

        stamp(today, spec.daysAgo),
      ),
    )

    // Line 1 is the down payment, then three monthly installments. The

    // offsets are signed days from today: negative is already past due. The

    // older booking therefore shows one installment four days overdue and

    // unpaid, so the recovery tiles have a red row without any fabricated date.

    const offsets = [
      -(spec.daysAgo - 1),

      -(spec.daysAgo - 1) + 30,

      -(spec.daysAgo - 1) + 60,

      -(spec.daysAgo - 1) + 90,
    ]

    const lines: Array<{
      kind: string

      number: number

      total: number
    }> = [
      { kind: "down_payment", number: 1, total: down },

      { kind: "installment", number: 2, total: step },

      { kind: "installment", number: 3, total: step },

      {
        kind: "installment",

        number: 4,

        total: spec.amount - down - step * 2,
      },
    ]

    lines.forEach((line, lineIndex) => {
      const id = sampleId("smp_inst")

      // First booking: down payment fully received, next line overdue unpaid.

      // Second booking: down payment fully received, nothing due yet.

      const paid = lineIndex === 0 ? line.total : 0

      const dueDate = dayMinus(today, -offsets[lineIndex]!)

      remember(rows, "payment_installments", id, () =>
        run(
          `INSERT INTO payment_installments (
             id, tenant_id, plan_id, booking_id, number, kind, due_date,
             amount, charges, total, paid_amount, status
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,

          id,

          tenantId,

          planId,

          bookingId,

          line.number,

          line.kind,

          dueDate,

          line.total,

          line.total,

          paid,

          paid > 0 ? "paid" : "scheduled",
        ),
      )

      if (paid > 0) {
        const paymentId = sampleId("smp_pay")

        // The down payment was banked on its due day, always in the past.

        const receivedAgo = offsets[lineIndex]!

        remember(rows, "payments", paymentId, () =>
          run(
            `INSERT INTO payments (
               id, tenant_id, customer_id, booking_id, currency, method,
               amount, receipt_number, note, recorded_by_user_id,
               recorded_by_name, received_at, created_at
             ) VALUES (?, ?, ?, ?, ?, 'bank', ?, ?, 'Sample receipt.', ?, ?, ?, ?)`,

            paymentId,

            tenantId,

            spec.customerId,

            bookingId,

            currency,

            paid,

            `SMP-RC-${String(specIndex + 1)}0${String(lineIndex)}`,

            actorUserId,

            actorName,

            stamp(today, -receivedAgo),

            stamp(today, -receivedAgo),
          ),
        )

        const allocId = sampleId("smp_alloc")

        remember(rows, "payment_allocations", allocId, () =>
          run(
            `INSERT INTO payment_allocations (
               id, tenant_id, payment_id, installment_id, amount, created_at
             ) VALUES (?, ?, ?, ?, ?, ?)`,

            allocId,

            tenantId,

            paymentId,

            id,

            paid,

            stamp(today, -receivedAgo),
          ),
        )

        const trailId = sampleId("smp_ipay")

        remember(rows, "installment_payments", trailId, () =>
          run(
            `INSERT INTO installment_payments (
               id, tenant_id, installment_id, amount, paid_at,
               recorded_by_user_id, recorded_by_name, payment_id
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,

            trailId,

            tenantId,

            id,

            paid,

            stamp(today, -receivedAgo),

            actorUserId,

            actorName,

            paymentId,
          ),
        )
      }
    })
  })

  // A pending booking approval on an available unit, so the queue has a row.

  const heldUnit = unitIds.get("B-201")!

  const approvalId = sampleId("smp_appr")

  const approvalPayload = JSON.stringify({
    projectId,

    unitId: heldUnit.id,

    customerId: customerIds[0]!,

    agentUserId: null,

    dealerId: null,

    quoteId: null,

    bookingAmount: heldUnit.price,

    bookingDate: today,

    terms: "Standard installment terms (sample).",

    notes: "Sample request created by the dashboard demo loader.",

    unitCode: "B-201",

    customerName: "[Sample] Bilal Ahmed",
  } as const)

  remember(rows, "approvals", approvalId, () =>
    run(
      `INSERT INTO approvals (
         id, tenant_id, action_key, status, summary, payload, entity_type,
         result_entity_id, requested_by_user_id, requested_by_name,
         requested_at, decided_by_user_id, decided_by_name, decision_note,
         decided_at, updated_at
       ) VALUES (?, ?, 'booking', 'pending', ?, ?, 'booking', NULL, ?, ?,
         ?, NULL, NULL, NULL, NULL, ?)`,

      approvalId,

      tenantId,

      `[Sample] Booking for [Sample] Bilal Ahmed — B-201, ${currency} ${heldUnit.price.toLocaleString("en-US")}`,

      approvalPayload,

      actorUserId,

      actorName,

      stamp(today, 1),

      stamp(today, 1),
    ),
  )

  // A filed document against the first sample booking, so the activity feed

  // shows the fourth event kind. `entity_id` is NOT NULL by schema, so the

  // row is written straight against the booking rather than patched after.

  const documentId = sampleId("smp_doc")

  const tinyPdf = Buffer.from(
    "[Sample] Allotment letter placeholder generated by the dashboard demo loader.",

    "utf8",
  ).toString("base64")

  remember(rows, "documents", documentId, () =>
    run(
      `INSERT INTO documents (
         id, tenant_id, entity_type, entity_id, doc_type, title, filename,
         mime, size_bytes, data, expires_at, uploaded_by_user_id,
         uploaded_by_name, created_at, updated_at
       ) VALUES (?, ?, 'booking', ?, 'other',
         '[Sample] Allotment letter', 'sample-allotment.txt', 'text/plain', ?,
         ?, NULL, ?, ?, ?, ?)`,

      documentId,

      tenantId,

      firstBookingIds[0]!,

      tinyPdf.length,

      tinyPdf,

      actorUserId,

      actorName,

      stamp(today, 1),

      stamp(today, 1),
    ),
  )

  return rows
}

/** POST /api/dashboard/sample-data/load — owner/admin only. */

export async function loadSampleData(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "settings", "edit")

  const tenantId = guarded.tenantId

  const existing = get<{ n: number }>(
    "SELECT COUNT(*) AS n FROM dashboard_sample_rows WHERE tenant_id = ?",

    tenantId,
  )

  if ((existing?.n ?? 0) > 0) {
    throw conflict("Sample data is already loaded. Remove it first.", {
      sample: "Remove sample data, then load a fresh set.",
    })
  }

  const tenant = get<TenantDefaults>(
    "SELECT slug, currency, timezone FROM tenants WHERE id = ?",

    tenantId,
  )

  // The demo workspace carries a full dataset — staff with logins, three
  // schemes, a year of pipeline, schedules, receipts, overdue lines, spend and
  // paperwork — because a command center is only readable at real volume. Every
  // other workspace gets the small labelled sample instead, and neither write
  // touches a row the tenant created itself.
  if (tenant?.slug === DEMO_TENANT_SLUG) {
    const report = loadDemoDataset(tenantId)

    invalidateDashboardCache(tenantId)

    writeAudit(
      ctx,

      "dashboard.sample_data.load",

      "dashboard",

      null,

      { rows: report.rows, dataset: "demo-workspace" },

      ctx.ip,
    )

    return { ok: true as const, rows: report.rows }
  }

  const currency = tenant?.currency ?? "AED"

  const timezone = tenant?.timezone ?? "UTC"

  const today = (() => {
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
  })()

  const rows = transaction(() => {
    const created = buildSample(
      tenantId,

      today,

      currency,

      guarded.userId,

      guarded.session.user.fullName ?? guarded.session.user.email,
    )

    for (const row of created) {
      run(
        `INSERT INTO dashboard_sample_rows (tenant_id, table_name, row_id, created_at)
         VALUES (?, ?, ?, ?)`,

        tenantId,

        row.table,

        row.id,

        nowISO(),
      )
    }

    return created
  })

  invalidateDashboardCache(tenantId)

  writeAudit(
    ctx,

    "dashboard.sample_data.load",

    "dashboard",

    null,

    { rows: rows.length },

    ctx.ip,
  )

  return { ok: true as const, rows: rows.length }
}

/**
 * Removal walks the registry from `server/sample/remove.ts` rather than a list
 * kept here: the demo dataset now spans every module, and four of its rows key
 * on a compound of columns instead of `id`. One engine serves both the small
 * labelled sample above and the full workspace dataset, so a sweep cannot miss a
 * family of rows and leave the tenant with half a demo.
 */

/** POST /api/dashboard/sample-data/remove — owner/admin only. */

export async function removeSampleData(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "settings", "edit")

  const tenantId = guarded.tenantId

  await readJsonBody(ctx.req)

  const removed = removeSampleRows(tenantId)

  if (removed === 0) {
    throw badRequest("There is no sample data to remove.")
  }

  invalidateDashboardCache(tenantId)

  writeAudit(
    ctx,

    "dashboard.sample_data.remove",

    "dashboard",

    null,

    { rows: removed },

    ctx.ip,
  )

  return { ok: true as const, rows: removed }
}

/** A demo account, as the Settings panel lists them. */
interface LoginRow {
  email: SqlValue

  full_name: SqlValue

  role_id: SqlValue
}

/** What the panel sends back for one seeded person. */
export interface SampleLogin {
  email: string

  name: string

  role: string
}

/**
 * GET /api/dashboard/sample-data — is a demo dataset loaded, and what can be
 * done about it.
 *
 * The seeded logins and their shared password are only ever named to somebody
 * who holds `settings.edit`: they are the same people who can load or wipe the
 * dataset, so the panel tells them what it just made possible and nobody else.
 */
export async function sampleDataStatus(ctx: RequestContext) {
  const guarded = requireAuth(ctx)

  const canManage = guarded.can("settings", "edit")

  const tables = sampleRowCounts(guarded.tenantId)

  const rows = tables.reduce((total, table) => total + table.rows, 0)

  const logins: SampleLogin[] =
    canManage && rows > 0
      ? all<LoginRow>(
          `SELECT u.email, u.full_name, m.role_id FROM users u
             JOIN tenant_memberships m ON m.tenant_id = u.tenant_id AND m.user_id = u.id
            WHERE u.tenant_id = ?
              AND EXISTS (
                SELECT 1 FROM dashboard_sample_rows r
                 WHERE r.tenant_id = u.tenant_id
                   AND r.table_name = 'users'
                   AND r.row_id = u.id
              )
            ORDER BY CASE m.role_id
              WHEN 'tenant_owner' THEN 0 WHEN 'tenant_admin' THEN 1 ELSE 2 END, u.full_name`,
          guarded.tenantId,
        ).map((row) => ({
          email: String(row.email),

          name: String(row.full_name),

          role: String(row.role_id),
        }))
      : []

  return {
    active: rows > 0,

    rows,

    tables,

    canManage,

    demoWorkspace:
      get<{ slug: SqlValue }>(
        "SELECT slug FROM tenants WHERE id = ?",
        guarded.tenantId,
      )?.slug === DEMO_TENANT_SLUG,

    password: canManage && rows > 0 ? DEMO_PASSWORD : null,

    logins,
  }
}
