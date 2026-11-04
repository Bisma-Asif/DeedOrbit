/**
 * The collections dashboard: read recovery off the schedule, never store it.
 *
 * Every figure here is derived at read from the installments still carrying a balance on
 * confirmed bookings — what falls due in the next windows, what is overdue and how deep
 * into delinquency, what each officer has achieved against their target this period, and
 * the workload spread across the recovery team. Before the read, the late-fee sweep runs so
 * a fee owed on a newly-overdue line is charged and appears the same moment it is looked
 * at. Nothing is cached or written into the schedule; the honest reading is always live.
 */

import { all, get, run, transaction } from "../db.ts"

import {
  badRequest,
  notFound,
  readJsonBody,
  type RequestContext,
} from "../http.ts"

import { requireAuth, requirePermission, writeAudit } from "../middleware.ts"

import {
  AGING_BUCKETS,
  bucketForDaysOverdue,
  type AgingBucket,
  type AgingBandSummary,
  type CollectionsKpis,
  type OfficerWorkload,
  type OverdueRow,
} from "../../shared/collections.ts"

import { CANCELLATION_AMOUNT_MAX } from "../../shared/cancellation.ts"

import { assessLateFeesWithinTransaction } from "./late-fees.ts"

const now = () => new Date().toISOString()

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
    return new Date().toISOString().slice(0, 10)
  }
}

function addDaysISO(date: string, days: number): string {
  const base = Date.parse(`${date}T00:00:00Z`)

  return new Date(base + days * 86_400_000).toISOString().slice(0, 10)
}

function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      86_400_000,
  )
}

/** One installment still carrying a balance on a confirmed booking, with its labels. */

interface OpenLine {
  installment_id: string

  booking_id: string

  number: number

  due_date: string

  remaining: number

  booking_reference: string

  unit_code: string

  project_id: string

  project_name: string

  customer_id: string

  customer_name: string

  collection_officer_user_id: string | null
}

/** All open lines on confirmed bookings for the tenant, newest due date first. */

function readOpenLines(tenantId: string): OpenLine[] {
  return all<OpenLine>(
    `SELECT i.id AS installment_id, i.booking_id, i.number, i.due_date,
            (i.total - i.paid_amount) AS remaining,
            b.reference AS booking_reference, b.unit_code, b.project_id,
            b.customer_id, c.full_name AS customer_name,
            i.collection_officer_user_id, p.name AS project_name
      FROM payment_installments i
      JOIN bookings b ON b.id = i.booking_id AND b.tenant_id = i.tenant_id
      JOIN customers c ON c.id = b.customer_id AND c.tenant_id = b.tenant_id
      JOIN projects p ON p.id = b.project_id AND p.tenant_id = b.tenant_id
      WHERE i.tenant_id = ? AND b.status = 'confirmed' AND i.total - i.paid_amount > 0
      ORDER BY i.due_date ASC, i.number ASC`,

    tenantId,
  )
}

/** Un-waived late fees accrued per installment, with the latest assessment behind them. */

interface FeeEntry {
  fee: number

  assessmentId: string
}

interface FeeSumRow {
  installment_id: string

  fee: number
}

interface LatestAssessmentRow {
  installment_id: string

  id: string

  max_row: number
}

function feeMap(tenantId: string): Map<string, FeeEntry> {
  const rows = all<FeeSumRow>(
    `SELECT installment_id,
            COALESCE(SUM(amount), 0) AS fee
      FROM late_fee_assessments
      WHERE tenant_id = ? AND status != 'waived'
      GROUP BY installment_id`,

    tenantId,
  )

  // Pair each installment's total with its most recent un-waived assessment, the one a

  // waiver request is filed against.

  const latest = all<LatestAssessmentRow>(
    `SELECT a.installment_id, a.id, a.rowid AS max_row
      FROM late_fee_assessments a
      JOIN (
        SELECT installment_id, MAX(rowid) AS max_row
          FROM late_fee_assessments
          WHERE tenant_id = ? AND status != 'waived'
          GROUP BY installment_id
      ) m ON m.installment_id = a.installment_id AND m.max_row = a.rowid
      WHERE a.tenant_id = ?`,

    tenantId,

    tenantId,
  )

  const ids = new Map(latest.map((row) => [row.installment_id, row.id]))

  const result = new Map<string, FeeEntry>()

  for (const row of rows) {
    const assessmentId = ids.get(row.installment_id)

    if (assessmentId)
      result.set(row.installment_id, { fee: row.fee, assessmentId })
  }

  return result
}

/** Allocations collected in a `YYYY-MM` period, total and per assigned officer. */

interface CollectedRow {
  officer: string

  achieved: number
}

interface CollectedResult {
  total: number

  byOfficer: Map<string, number>
}

function collectedInPeriod(
  tenantId: string,

  period: string,
): CollectedResult {
  const rows = all<CollectedRow>(
    `SELECT COALESCE(i.collection_officer_user_id, '') AS officer,
            SUM(a.amount) AS achieved
      FROM payment_allocations a
      JOIN payments p ON p.id = a.payment_id AND p.tenant_id = a.tenant_id
      JOIN payment_installments i ON i.id = a.installment_id AND i.tenant_id = a.tenant_id
      WHERE a.tenant_id = ? AND substr(p.received_at, 1, 7) = ?
      GROUP BY officer`,

    tenantId,

    period,
  )

  let total = 0

  const byOfficer = new Map<string, number>()

  for (const row of rows) {
    total += row.achieved

    if (row.officer !== "") byOfficer.set(row.officer, row.achieved)
  }

  return { total, byOfficer }
}

/** Collection targets set for a period, keyed by officer. */

interface TargetSumRow {
  officer_user_id: string

  target_amount: number
}

function targetsInPeriod(
  tenantId: string,

  period: string,
): Map<string, number> {
  const rows = all<TargetSumRow>(
    `SELECT officer_user_id, target_amount FROM collection_targets
      WHERE tenant_id = ? AND period = ?`,

    tenantId,

    period,
  )

  return new Map(rows.map((row) => [row.officer_user_id, row.target_amount]))
}

interface OfficerNameRow {
  id: string

  full_name: string
}

function officerNames(tenantId: string, ids: string[]): Map<string, string> {
  if (ids.length === 0) return new Map()

  const placeholders = ids.map(() => "?").join(", ")

  const rows = all<OfficerNameRow>(
    `SELECT id, full_name FROM users
      WHERE tenant_id = ? AND id IN (${placeholders})`,

    tenantId,

    ...ids,
  )

  return new Map(rows.map((row) => [row.id, row.full_name]))
}

/**
 * GET /api/collections/summary — the KPI cards, the aging strip, and officer workload.
 *
 * Runs the late-fee sweep first, then reads the open schedule live: the two forward
 * windows, the four delinquency bands, what has been collected this period against the
 * target set, and each officer's spread of open and overdue lines.
 */

export async function collectionsSummary(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "payments", "view")

  const tenantId = guarded.tenantId

  transaction(() => assessLateFeesWithinTransaction(tenantId))

  const today = tenantToday(tenantId)

  const period = today.slice(0, 7)

  const lines = readOpenLines(tenantId)

  const in7 = addDaysISO(today, 7)

  const in30 = addDaysISO(today, 30)

  const kpis: CollectionsKpis = {
    dueNext7Count: 0,

    dueNext7Amount: 0,

    dueNext30Count: 0,

    dueNext30Amount: 0,

    overdueCount: 0,

    overdueAmount: 0,

    collectedPeriodAmount: 0,

    targetPeriodAmount: 0,
  }

  const bands = new Map<AgingBucket, AgingBandSummary>(
    AGING_BUCKETS.map((bucket) => [bucket, { bucket, count: 0, amount: 0 }]),
  )

  for (const line of lines) {
    if (line.due_date < today) {
      kpis.overdueCount += 1

      kpis.overdueAmount += line.remaining

      const bucket = bucketForDaysOverdue(daysBetween(line.due_date, today))

      if (bucket) {
        const band = bands.get(bucket)

        if (band) {
          band.count += 1

          band.amount += line.remaining
        }
      }
    } else if (line.due_date <= in7) {
      kpis.dueNext7Count += 1

      kpis.dueNext7Amount += line.remaining
    } else if (line.due_date <= in30) {
      kpis.dueNext30Count += 1

      kpis.dueNext30Amount += line.remaining
    }
  }

  const collected = collectedInPeriod(tenantId, period)

  const targets = targetsInPeriod(tenantId, period)

  kpis.collectedPeriodAmount = collected.total

  kpis.targetPeriodAmount = [...targets.values()].reduce((sum, v) => sum + v, 0)

  // An officer row is raised for anyone with an open line assigned or a target set, so the

  // workload table shows both the people carrying debt and the people measured against it.

  const officerIds = new Set<string>()

  const openByOfficer = new Map<string, {
    count: number
    overdue: number
    overdueAmount: number
  }>()

  for (const line of lines) {
    const officer = line.collection_officer_user_id

    if (!officer) continue

    officerIds.add(officer)

    const bucket = openByOfficer.get(officer) ?? {
      count: 0,
      overdue: 0,
      overdueAmount: 0,
    }

    bucket.count += 1

    if (line.due_date < today) {
      bucket.overdue += 1

      bucket.overdueAmount += line.remaining
    }

    openByOfficer.set(officer, bucket)
  }

  for (const officer of targets.keys()) officerIds.add(officer)

  const names = officerNames(tenantId, [...officerIds])

  const officers: OfficerWorkload[] = [...officerIds]

    .map((officerUserId) => {
      const workload = openByOfficer.get(officerUserId)

      return {
        officerUserId,

        officerName: names.get(officerUserId) ?? officerUserId,

        openCount: workload?.count ?? 0,

        overdueCount: workload?.overdue ?? 0,

        overdueAmount: workload?.overdueAmount ?? 0,

        targetAmount: targets.get(officerUserId) ?? 0,

        achievedAmount: collected.byOfficer.get(officerUserId) ?? 0,
      }
    })

    .sort((a, b) => b.overdueAmount - a.overdueAmount)

  return {
    kpis,

    aging: AGING_BUCKETS.map((bucket) => bands.get(bucket)!),

    officers,

    period,

    currency: tenantCurrency(tenantId),

    canEdit: guarded.can("payments", "edit"),
  }
}

/**
 * GET /api/collections/overdue?bucket=&officer=&projectId= — the filterable delinquency
 * table, each row a live reading of one overdue line with the fee accrued against it.
 */

export async function collectionsOverdue(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "payments", "view")

  const tenantId = guarded.tenantId

  transaction(() => assessLateFeesWithinTransaction(tenantId))

  const today = tenantToday(tenantId)

  const bucket = ctx.query.get("bucket")

  const officer = ctx.query.get("officer")

  const projectId = ctx.query.get("projectId")

  const fees = feeMap(tenantId)

  const names = officerNames(
    tenantId,

    [...new Set(readOpenLineOfficers(readOpenLines(tenantId)))],
  )

  const rows: OverdueRow[] = []

  for (const line of readOpenLines(tenantId)) {
    if (line.due_date >= today) continue

    const days = daysBetween(line.due_date, today)

    const rowBucket = bucketForDaysOverdue(days)

    if (rowBucket === null) continue

    if (bucket && bucket !== rowBucket) continue

    if (officer && (line.collection_officer_user_id ?? "") !== officer) continue

    if (projectId && line.project_id !== projectId) continue

    rows.push({
      installmentId: line.installment_id,

      bookingId: line.booking_id,

      bookingReference: line.booking_reference,

      unitCode: line.unit_code,

      projectId: line.project_id,

      projectName: line.project_name,

      customerId: line.customer_id,

      customerName: line.customer_name,

      officerUserId: line.collection_officer_user_id,

      officerName: line.collection_officer_user_id
        ? (names.get(line.collection_officer_user_id) ?? null)
        : null,

      dueDate: line.due_date,

      daysOverdue: days,

      bucket: rowBucket,

      outstanding: line.remaining,

      feeAccrued: fees.get(line.installment_id)?.fee ?? 0,

      lateFeeAssessmentId: fees.get(line.installment_id)?.assessmentId ?? null,

      displayStatus: "overdue",
    })
  }

  rows.sort((a, b) => b.daysOverdue - a.daysOverdue)

  return {
    rows,

    currency: tenantCurrency(tenantId),

    canEdit: guarded.can("payments", "edit"),
  }
}

function readOpenLineOfficers(lines: OpenLine[]): string[] {
  const ids: string[] = []

  for (const line of lines) {
    if (line.collection_officer_user_id)
      ids.push(line.collection_officer_user_id)
  }

  return ids
}

/**
 * POST /api/payment-installments/:id/assign — set the recovery officer owning a line.
 *
 * A blank officer clears the assignment back to the general pool. The target must be a real
 * member of the workspace, so the dashboard never points at a phantom owner.
 */

export async function assignOfficer(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "payments", "edit")

  const installmentId = ctx.params.id

  const installment = get<{ id: string }>(
    `SELECT id FROM payment_installments WHERE tenant_id = ? AND id = ?`,

    guarded.tenantId,

    installmentId,
  )

  if (!installment) throw notFound("That installment does not exist")

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const officerUserId =
    typeof body.officerUserId === "string" ? body.officerUserId.trim() : ""

  if (officerUserId !== "") {
    const officer = get<{ id: string }>(
      `SELECT id FROM users WHERE tenant_id = ? AND id = ?`,

      guarded.tenantId,

      officerUserId,
    )

    if (!officer) {
      throw badRequest("Check the highlighted fields", {
        officerUserId: "That officer is not a member of this workspace.",
      })
    }
  }

  run(
    `UPDATE payment_installments SET collection_officer_user_id = ?
      WHERE tenant_id = ? AND id = ?`,

    officerUserId === "" ? null : officerUserId,

    guarded.tenantId,

    installmentId,
  )

  writeAudit(
    guarded,

    "collection.assigned",

    "payment_installment",

    installmentId,

    { officerUserId: officerUserId === "" ? null : officerUserId },

    ctx.ip,
  )

  return {
    installmentId,
    officerUserId: officerUserId === "" ? null : officerUserId,
  }
}

// --- Collection targets (settings) ----------------------------------------

interface TargetRow {
  officer_user_id: string

  period: string

  target_amount: string | number
}

/** GET /api/settings/collection-targets — every target this workspace has set. */

export async function getCollectionTargets(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "settings", "view")

  const rows = all<TargetRow>(
    `SELECT officer_user_id, period, target_amount FROM collection_targets
      WHERE tenant_id = ? ORDER BY period DESC, officer_user_id ASC`,

    guarded.tenantId,
  )

  const ids = [...new Set(rows.map((r) => r.officer_user_id))]

  const names = officerNames(guarded.tenantId, ids)

  return {
    targets: rows.map((row) => ({
      officerUserId: row.officer_user_id,

      officerName: names.get(row.officer_user_id) ?? row.officer_user_id,

      period: row.period,

      targetAmount: Number(row.target_amount),
    })),
  }
}

/**
 * PATCH /api/settings/collection-targets — replace the targets for the periods named.
 *
 * Each entry upserts one officer's monthly goal. Officer and period both have to be real,
 * and the amount a whole figure, so a typo cannot quietly set a phantom person's target.
 */

export async function updateCollectionTargets(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "settings", "edit")

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const raw = Array.isArray(body.targets) ? body.targets : []

  interface TargetInput {
    officerUserId: string

    period: string

    targetAmount: number
  }

  const parsed: TargetInput[] = []

  for (const entry of raw) {
    const record = (entry ?? {}) as Record<string, unknown>

    const officerUserId =
      typeof record.officerUserId === "string"
        ? record.officerUserId.trim()
        : ""

    const period = typeof record.period === "string" ? record.period.trim() : ""

    const targetAmount =
      typeof record.targetAmount === "number" &&
      Number.isSafeInteger(record.targetAmount) &&
      record.targetAmount >= 0 &&
      record.targetAmount <= CANCELLATION_AMOUNT_MAX
        ? record.targetAmount
        : null

    if (
      officerUserId === "" ||
      !/^\d{4}-\d{2}$/.test(period) ||
      targetAmount === null
    ) {
      throw badRequest("Check the highlighted fields", {
        targets:
          "Each target needs a real officer, a YYYY-MM period, and a whole amount.",
      })
    }

    const officer = get<{ id: string }>(
      `SELECT id FROM users WHERE tenant_id = ? AND id = ?`,

      guarded.tenantId,

      officerUserId,
    )

    if (!officer) {
      throw badRequest("Check the highlighted fields", {
        targets: "An officer on a target is not a member of this workspace.",
      })
    }

    parsed.push({ officerUserId, period, targetAmount })
  }

  transaction(() => {
    for (const target of parsed) {
      run(
        `INSERT INTO collection_targets (
            id, tenant_id, officer_user_id, period, target_amount, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT (tenant_id, officer_user_id, period) DO UPDATE SET
            target_amount = excluded.target_amount,
            updated_at = excluded.updated_at`,

        `tgt_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`,

        guarded.tenantId,

        target.officerUserId,

        target.period,

        target.targetAmount,

        now(),
      )
    }
  })

  writeAudit(
    guarded,

    "tenant.collection_targets_updated",

    "tenant",

    guarded.tenantId,

    { count: parsed.length },

    ctx.ip,
  )

  return getCollectionTargets(ctx)
}
