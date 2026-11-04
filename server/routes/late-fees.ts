/**
 * Late-fee rules, the overdue sweep that applies them, and the waiver that reverses one.
 *
 * A single tenant-wide rule decides whether a fee is charged, how it is sized (a flat
 * figure or a basis-point slice of what is still outstanding), after how many grace days it
 * bites, and how many times one line may be charged. Fees are never stored on the
 * installment; the sweep writes separate assessment rows and posts a matching ledger debit,
 * and a waiver — which always needs a sign-off — writes the opposite.
 *
 * The sweep is idempotent: re-running it on the same day cannot double-charge an
 * installment, so calling it at the top of a read is safe.
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
  GRACE_DAYS_MAX,
  LATE_FEE_AMOUNT_MAX,
  MAX_ASSESSMENTS_MAX,
  PERCENT_BPS_MAX,
  WAIVER_REASON_MAX,
  isLateFeeMode,
  type LateFeeMode,
} from "../../shared/late-fees.ts"

import type { LateFeeWaiverApprovalPayload } from "../../shared/approvals.ts"

import { appendLedgerEntry } from "../ledger.ts"

import { insertApproval, pendingApprovalFor } from "./approvals.ts"

const now = () => new Date().toISOString()

interface CustomerNameRow {
  id: string

  full_name: string
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
    return new Date().toISOString().slice(0, 10)
  }
}

/** Whole days between two `YYYY-MM-DD` dates (to - from), or null if either is malformed. */

function daysBetween(from: string, to: string): number | null {
  const a = Date.parse(`${from}T00:00:00Z`)

  const b = Date.parse(`${to}T00:00:00Z`)

  if (Number.isNaN(a) || Number.isNaN(b)) return null

  return Math.round((b - a) / 86_400_000)
}

// --- Rules -----------------------------------------------------------------

interface LateFeeRuleRow {
  enabled: number

  mode: string

  amount: number

  percent_bps: number

  grace_days: number

  max_assessments: number
}

interface LateFeeRuleView {
  enabled: boolean

  mode: LateFeeMode

  amount: number

  percentBps: number

  graceDays: number

  maxAssessments: number
}

function toRuleView(row: LateFeeRuleRow | undefined): LateFeeRuleView {
  const modeValue = row?.mode

  return {
    enabled: row?.enabled === 1,

    mode: isLateFeeMode(modeValue) ? modeValue : "fixed",

    amount: row?.amount ?? 0,

    percentBps: row?.percent_bps ?? 0,

    graceDays: row?.grace_days ?? 0,

    maxAssessments: row?.max_assessments ?? 0,
  }
}

/** GET /api/settings/late-fees */

export async function getLateFeeRules(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "settings", "view")

  const row = get<LateFeeRuleRow>(
    `SELECT enabled, mode, amount, percent_bps, grace_days, max_assessments
      FROM late_fee_rules WHERE tenant_id = ?`,

    guarded.tenantId,
  )

  return { rules: toRuleView(row), configured: row !== undefined }
}

function readBoundedInt(
  value: unknown,
  min: number,
  max: number,
): number | null {
  if (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= min &&
    value <= max
  ) {
    return value
  }

  return null
}

/** PATCH /api/settings/late-fees */

export async function updateLateFeeRules(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "settings", "edit")

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const errors: Record<string, string> = {}

  const enabled = body.enabled === true

  const mode: LateFeeMode = isLateFeeMode(body.mode) ? body.mode : "fixed"

  const amount = readBoundedInt(body.amount, 0, LATE_FEE_AMOUNT_MAX)

  if (amount === null)
    errors.amount = `Enter a whole number from 0 to ${LATE_FEE_AMOUNT_MAX}.`

  const percentBps = readBoundedInt(body.percentBps, 0, PERCENT_BPS_MAX)

  if (percentBps === null)
    errors.percentBps = `Enter whole basis points from 0 to ${PERCENT_BPS_MAX}.`

  const graceDays = readBoundedInt(body.graceDays, 0, GRACE_DAYS_MAX)

  if (graceDays === null)
    errors.graceDays = `Enter whole days from 0 to ${GRACE_DAYS_MAX}.`

  const maxAssessments = readBoundedInt(
    body.maxAssessments,
    0,
    MAX_ASSESSMENTS_MAX,
  )

  if (maxAssessments === null)
    errors.maxAssessments = `Enter a whole number from 0 to ${MAX_ASSESSMENTS_MAX}.`

  if (Object.keys(errors).length > 0) {
    throw badRequest("Check the highlighted fields", errors)
  }

  run(
    `INSERT INTO late_fee_rules (
        tenant_id, enabled, mode, amount, percent_bps, grace_days, max_assessments, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (tenant_id) DO UPDATE SET
        enabled = excluded.enabled,
        mode = excluded.mode,
        amount = excluded.amount,
        percent_bps = excluded.percent_bps,
        grace_days = excluded.grace_days,
        max_assessments = excluded.max_assessments,
        updated_at = excluded.updated_at`,

    guarded.tenantId,

    enabled ? 1 : 0,

    mode,

    amount,

    percentBps,

    graceDays,

    maxAssessments,

    now(),
  )

  writeAudit(
    guarded,

    "tenant.late_fee_rules_updated",

    "tenant",

    guarded.tenantId,

    { enabled, mode, amount, percentBps, graceDays, maxAssessments },

    ctx.ip,
  )

  const row = get<LateFeeRuleRow>(
    `SELECT enabled, mode, amount, percent_bps, grace_days, max_assessments
      FROM late_fee_rules WHERE tenant_id = ?`,

    guarded.tenantId,
  )

  return { rules: toRuleView(row), configured: true }
}

// --- The overdue sweep -----------------------------------------------------

/** How many times this installment has already been charged. */

function assessmentCount(tenantId: string, installmentId: string): number {
  return (
    get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM late_fee_assessments
        WHERE tenant_id = ? AND installment_id = ?`,

      tenantId,

      installmentId,
    )?.n ?? 0
  )
}

/** The most recent assessment date for an installment, as a `YYYY-MM-DD`, or null. */

function lastAssessedDate(
  tenantId: string,
  installmentId: string,
): string | null {
  const row = get<{ assessed_at: string }>(
    `SELECT assessed_at FROM late_fee_assessments
      WHERE tenant_id = ? AND installment_id = ?
      ORDER BY assessed_at DESC, rowid DESC LIMIT 1`,

    tenantId,

    installmentId,
  )

  return row ? row.assessed_at.slice(0, 10) : null
}

/**
 * Charges every eligible overdue installment once. Runs inside the caller's transaction.
 *
 * Reads the rule; if it is absent or disabled, nothing happens. Otherwise, for each
 * installment still carrying a balance and past its due date by at least the grace period,
 * one assessment row and one ledger debit are written — unless the installment has already
 * reached its cap, or was last charged today (the idempotency guard). The fee is a flat
 * figure or a basis-point slice of the outstanding amount. Returns how many were charged.
 *
 * A `max_assessments` of 0 means unlimited, exactly as the rules surface documents it: the
 * cap only bites when a positive ceiling is configured, so a zero rule never stops a line
 * from being charged again on a later day.
 */

export function assessLateFeesWithinTransaction(tenantId: string): number {
  const rule = get<LateFeeRuleRow>(
    `SELECT enabled, mode, amount, percent_bps, grace_days, max_assessments
      FROM late_fee_rules WHERE tenant_id = ?`,

    tenantId,
  )

  if (!rule || rule.enabled !== 1) return 0

  const today = tenantToday(tenantId)

  const currency = tenantCurrency(tenantId)

  interface OverdueRow {
    installment_id: string

    booking_id: string

    customer_id: string

    number: number

    due_date: string

    remaining: number
  }

  const overdue = all<OverdueRow>(
    `SELECT i.id AS installment_id, i.booking_id, b.customer_id, i.number, i.due_date,
            (i.total - i.paid_amount) AS remaining
      FROM payment_installments i
      JOIN bookings b ON b.id = i.booking_id AND b.tenant_id = i.tenant_id
      WHERE i.tenant_id = ? AND b.status = 'confirmed'
        AND i.total - i.paid_amount > 0 AND i.due_date < ?`,

    tenantId,

    today,
  )

  const cap = rule.max_assessments > 0 ? rule.max_assessments : Infinity

  let assessed = 0

  for (const line of overdue) {
    const pastDue = daysBetween(line.due_date, today)

    if (pastDue === null || pastDue < rule.grace_days) continue

    if (assessmentCount(tenantId, line.installment_id) >= cap) continue

    // Same-day guard: a sweep re-run on the tenant's own day never re-charges a line.

    if (lastAssessedDate(tenantId, line.installment_id) === today) continue

    const fee =
      rule.mode === "percent"
        ? Math.round((line.remaining * rule.percent_bps) / 10000)
        : rule.amount

    if (fee <= 0) continue

    const assessmentId = `fee_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`

    const stamp = now()

    run(
      `INSERT INTO late_fee_assessments (
          id, tenant_id, installment_id, customer_id, booking_id, amount, status,
          reason, assessed_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'applied', NULL, ?)`,

      assessmentId,

      tenantId,

      line.installment_id,

      line.customer_id,

      line.booking_id,

      fee,

      stamp,
    )

    appendLedgerEntry({
      tenantId,

      customerId: line.customer_id,

      kind: "late_fee",

      amount: fee,

      currency,

      occurredAt: stamp,

      recordedByUserId: "system",

      recordedByName: "Late-fee sweep",

      bookingId: line.booking_id,

      reference: `#${line.number}`,

      sourceType: "late_fee_assessment",

      sourceId: assessmentId,

      note: "Late fee on an overdue installment",
    })

    assessed += 1
  }

  return assessed
}

/** Public entry point: run the sweep in its own transaction and return the count. */

export function assessLateFees(tenantId: string): number {
  return transaction(() => assessLateFeesWithinTransaction(tenantId))
}

// --- Waiver ----------------------------------------------------------------

interface AssessmentRow {
  id: string

  tenant_id: string

  installment_id: string

  customer_id: string

  booking_id: string | null

  amount: number

  status: string

  approval_id: string | null

  reason: string | null

  assessed_at: string
}

/**
 * POST /api/late-fee-assessments/:id/waive — hold a charged fee for a waiver sign-off.
 *
 * Requires a reason. The assessment moves to `pending_waiver` and a mandatory approval is
 * raised; nothing is reversed until a different user approves it. A waiver on a line that
 * is already waived or already pending is refused.
 */

export async function requestLateFeeWaiver(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "payments", "edit")

  const id = ctx.params.id

  const assessment = get<AssessmentRow>(
    `SELECT * FROM late_fee_assessments WHERE tenant_id = ? AND id = ?`,

    guarded.tenantId,

    id,
  )

  if (!assessment) throw notFound("That late-fee assessment does not exist")

  if (assessment.status !== "applied") {
    throw badRequest("Only an applied fee can be waived.")
  }

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const reason = typeof body.reason === "string" ? body.reason.trim() : ""

  if (reason === "") {
    throw badRequest("Check the highlighted fields", {
      reason: "Record why this fee is being waived.",
    })
  }

  if (reason.length > WAIVER_REASON_MAX) {
    throw badRequest("Check the highlighted fields", {
      reason: `Use ${WAIVER_REASON_MAX} characters or fewer.`,
    })
  }

  const customer = get<CustomerNameRow>(
    `SELECT id, full_name FROM customers WHERE tenant_id = ? AND id = ?`,

    guarded.tenantId,

    assessment.customer_id,
  )

  const installment = get<{ number: number }>(
    `SELECT number FROM payment_installments WHERE tenant_id = ? AND id = ?`,

    guarded.tenantId,

    assessment.installment_id,
  )

  const result = transaction((): string => {
    const held = pendingApprovalFor(
      guarded.tenantId,

      "late_fee_waiver",

      assessment.id,
    )

    if (held) return held.id

    run(
      `UPDATE late_fee_assessments SET status = 'pending_waiver', reason = ?
        WHERE tenant_id = ? AND id = ?`,

      reason,

      guarded.tenantId,

      assessment.id,
    )

    const payload: LateFeeWaiverApprovalPayload = {
      assessmentId: assessment.id,

      customerId: assessment.customer_id,

      customerName: customer?.full_name ?? "",

      bookingId: assessment.booking_id ?? "",

      installmentNumber: installment?.number ?? 0,

      amount: assessment.amount,

      reason,
    }

    const approval = insertApproval({
      tenantId: guarded.tenantId,

      actionKey: "late_fee_waiver",

      summary: `Waive late fee #${installment?.number ?? ""} (${customer?.full_name ?? ""})`,

      payload,

      entityType: "late_fee_assessment",

      resultEntityId: assessment.id,

      requestedByUserId: guarded.userId,

      requestedByName: guarded.session.user.fullName,
    })

    run(
      `UPDATE late_fee_assessments SET approval_id = ? WHERE tenant_id = ? AND id = ?`,

      approval.id,

      guarded.tenantId,

      assessment.id,
    )

    return approval.id
  })

  writeAudit(
    guarded,

    "late_fee.waiver_requested",

    "late_fee_assessment",

    assessment.id,

    { amount: assessment.amount, approvalId: result },

    ctx.ip,
  )

  return { assessmentId: assessment.id, approvalId: result, pending: true }
}

/**
 * Applies an approved waiver: reverses the fee with a matching ledger credit. Runs inside
 * the caller's transaction; the approvals engine's replay is the only caller.
 */

export function applyLateFeeWaiver(
  tenantId: string,

  actorUserId: string,

  actorName: string,

  assessmentId: string,
): string {
  const assessment = get<AssessmentRow>(
    `SELECT * FROM late_fee_assessments WHERE tenant_id = ? AND id = ?`,

    tenantId,

    assessmentId,
  )

  if (!assessment) throw notFound("That late-fee assessment does not exist")

  if (assessment.status === "waived") return assessment.id

  const stamp = now()

  run(
    `UPDATE late_fee_assessments SET status = 'waived', waived_at = ?
      WHERE tenant_id = ? AND id = ?`,

    stamp,

    tenantId,

    assessment.id,
  )

  appendLedgerEntry({
    tenantId,

    customerId: assessment.customer_id,

    kind: "waiver",

    amount: -assessment.amount,

    currency: tenantCurrency(tenantId),

    occurredAt: stamp,

    recordedByUserId: actorUserId,

    recordedByName: actorName,

    bookingId: assessment.booking_id,

    reference: null,

    sourceType: "late_fee_assessment",

    sourceId: assessment.id,

    note: assessment.reason
      ? `Waiver: ${assessment.reason}`
      : "Late-fee waiver",
  })

  return assessment.id
}

/**
 * Reverses a declined waiver: the fee returns to `applied` and stays charged. No ledger row
 * is written, because the original debit was never undone. Runs inside the caller's
 * transaction; the approvals replay on a rejection is the only caller.
 */

export function rejectLateFeeWaiver(
  tenantId: string,

  assessmentId: string,
): string {
  const assessment = get<AssessmentRow>(
    `SELECT * FROM late_fee_assessments WHERE tenant_id = ? AND id = ?`,

    tenantId,

    assessmentId,
  )

  if (!assessment) throw notFound("That late-fee assessment does not exist")

  if (assessment.status !== "pending_waiver") return assessment.id

  run(
    `UPDATE late_fee_assessments SET status = 'applied', approval_id = NULL
      WHERE tenant_id = ? AND id = ?`,

    tenantId,

    assessment.id,
  )

  return assessment.id
}
