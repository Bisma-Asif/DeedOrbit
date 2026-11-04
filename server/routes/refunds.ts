/**
 * Refund requests: raise one against a recorded payment, and settle it on approval.
 *
 * A refund always needs a sign-off — there is no immediate path — so requesting one writes
 * a `pending` row and a mandatory approval, and nothing moves until a different user
 * approves. The approving replay marks the refund `paid`, mints a credit-note number from
 * the tenant's `receipt` sequence (the same kind receipts use), and posts the ledger
 * reversal. A refund is bounded by what the referenced payment still has un-refunded, so
 * money out can never exceed money in.
 */

import { all, get, run, transaction } from "../db.ts"

import {
  badRequest,
  notFound,
  readJsonBody,
  type RequestContext,
} from "../http.ts"

import { requireAuth, requirePermission, writeAudit } from "../middleware.ts"

import { REFUND_AMOUNT_MAX, REFUND_REASON_MAX } from "../../shared/refunds.ts"

import type { RefundApprovalPayload } from "../../shared/approvals.ts"

import { appendLedgerEntry } from "../ledger.ts"

import { insertApproval, pendingApprovalFor } from "./approvals.ts"

import { nextDocumentNumber } from "./organization.ts"

const now = () => new Date().toISOString()

function tenantCurrency(tenantId: string): string {
  return (
    get<{ currency: string }>(
      "SELECT currency FROM tenants WHERE id = ?",

      tenantId,
    )?.currency ?? "AED"
  )
}

interface RefundRow {
  id: string

  tenant_id: string

  customer_id: string

  booking_id: string | null

  installment_id: string | null

  payment_id: string | null

  amount: number

  reason: string

  status: string

  credit_number: string | null

  approval_id: string | null

  requested_by_user_id: string

  requested_by_name: string

  requested_at: string

  paid_at: string | null

  recorded_by_user_id: string | null

  recorded_by_name: string | null

  updated_at: string
}

interface CustomerLookupRow {
  id: string

  full_name: string
}

interface PaymentLookupRow {
  id: string

  customer_id: string

  amount: number

  receipt_number: string | null
}

interface RefundTransactionResult {
  refundId: string

  approvalId: string
}

function toRefund(row: RefundRow) {
  return {
    id: row.id,

    customerId: row.customer_id,

    bookingId: row.booking_id,

    installmentId: row.installment_id,

    paymentId: row.payment_id,

    amount: row.amount,

    reason: row.reason,

    status: row.status,

    creditNumber: row.credit_number,

    approvalId: row.approval_id,

    requestedByUserId: row.requested_by_user_id,

    requestedByName: row.requested_by_name,

    requestedAt: row.requested_at,

    paidAt: row.paid_at,

    recordedByUserId: row.recorded_by_user_id,

    recordedByName: row.recorded_by_name,

    updatedAt: row.updated_at,
  }
}

/** The amount of a payment already committed to live refunds (everything not rejected). */

function alreadyRefunded(tenantId: string, paymentId: string): number {
  return (
    get<{ n: number }>(
      `SELECT COALESCE(SUM(amount), 0) AS n FROM refunds
        WHERE tenant_id = ? AND payment_id = ? AND status != 'rejected'`,

      tenantId,

      paymentId,
    )?.n ?? 0
  )
}

/**
 * POST /api/refunds — hold a refund request for approval.
 *
 * The amount is a positive whole number that cannot exceed the referenced payment's still
 * un-refunded remainder, and a reason is required. Writes a `pending` refund and a
 * mandatory approval; a duplicate open request on the same payment is returned rather than
 * stacked.
 */

export async function requestRefund(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "payments", "create")

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const errors: Record<string, string> = {}

  const customerId =
    typeof body.customerId === "string" ? body.customerId.trim() : ""

  if (!customerId) errors.customerId = "Choose a customer."

  const paymentId =
    typeof body.paymentId === "string" ? body.paymentId.trim() : ""

  if (!paymentId) errors.paymentId = "Choose the payment to refund."

  const amount =
    typeof body.amount === "number" &&
    Number.isSafeInteger(body.amount) &&
    body.amount > 0 &&
    body.amount <= REFUND_AMOUNT_MAX
      ? body.amount
      : null

  if (amount === null)
    errors.amount = `Enter a whole number from 1 to ${REFUND_AMOUNT_MAX}.`

  const reason = typeof body.reason === "string" ? body.reason.trim() : ""

  if (reason === "") errors.reason = "Record why this money is being refunded."
  else if (reason.length > REFUND_REASON_MAX)
    errors.reason = `Use ${REFUND_REASON_MAX} characters or fewer.`

  const bookingId =
    typeof body.bookingId === "string" && body.bookingId.trim() !== ""
      ? body.bookingId.trim()
      : null

  const installmentId =
    typeof body.installmentId === "string" && body.installmentId.trim() !== ""
      ? body.installmentId.trim()
      : null

  if (Object.keys(errors).length > 0) {
    throw badRequest("Check the highlighted fields", errors)
  }

  const customer = get<CustomerLookupRow>(
    `SELECT id, full_name FROM customers WHERE tenant_id = ? AND id = ?`,

    guarded.tenantId,

    customerId,
  )

  if (!customer) throw notFound("That customer does not exist")

  const payment = get<PaymentLookupRow>(
    `SELECT id, customer_id, amount, receipt_number FROM payments
      WHERE tenant_id = ? AND id = ?`,

    guarded.tenantId,

    paymentId,
  )

  if (!payment || payment.customer_id !== customerId) {
    throw badRequest("Check the highlighted fields", {
      paymentId: "That payment does not belong to this customer.",
    })
  }

  const remainder =
    payment.amount - alreadyRefunded(guarded.tenantId, payment.id)

  if (amount as number > remainder) {
    throw badRequest("Check the highlighted fields", {
      amount: "This refund exceeds the un-refunded amount on the payment.",
    })
  }

  const result = transaction((): RefundTransactionResult => {
    const held = pendingApprovalFor(guarded.tenantId, "refund", payment.id)

    const refundId = `ref_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`

    const stamp = now()

    run(
      `INSERT INTO refunds (
          id, tenant_id, customer_id, booking_id, installment_id, payment_id, amount,
          reason, status, requested_by_user_id, requested_by_name, requested_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,

      refundId,

      guarded.tenantId,

      customerId,

      bookingId,

      installmentId,

      payment.id,

      amount,

      reason,

      guarded.userId,

      guarded.session.user.fullName,

      stamp,

      stamp,
    )

    const payload: RefundApprovalPayload = {
      refundId,

      customerId,

      customerName: customer.full_name,

      reference: payment.receipt_number ?? "",

      amount: amount as number,

      reason,
    }

    if (held) {
      run(
        `UPDATE refunds SET approval_id = ? WHERE tenant_id = ? AND id = ?`,

        held.id,

        guarded.tenantId,

        refundId,
      )

      return { refundId, approvalId: held.id }
    }

    const approval = insertApproval({
      tenantId: guarded.tenantId,

      actionKey: "refund",

      summary: `Refund ${payment.receipt_number ?? payment.id} (${customer.full_name})`,

      payload,

      entityType: "refund",

      resultEntityId: refundId,

      requestedByUserId: guarded.userId,

      requestedByName: guarded.session.user.fullName,
    })

    run(
      `UPDATE refunds SET approval_id = ? WHERE tenant_id = ? AND id = ?`,

      approval.id,

      guarded.tenantId,

      refundId,
    )

    return { refundId, approvalId: approval.id }
  })

  writeAudit(
    guarded,

    "refund.requested",

    "refund",

    result.refundId,

    {
      customerId,
      paymentId: payment.id,
      amount,
      approvalId: result.approvalId,
    },

    ctx.ip,
  )

  const refund = get<RefundRow>(
    `SELECT * FROM refunds WHERE tenant_id = ? AND id = ?`,

    guarded.tenantId,

    result.refundId,
  )

  return { refund: refund ? toRefund(refund) : null, pending: true }
}

/**
 * Settles an approved refund: marks it paid, mints the credit-note number, and posts the
 * ledger reversal. Runs inside the caller's transaction; the approvals replay is the only
 * caller. Idempotent — an already-paid refund is returned untouched.
 */

export function applyRefund(
  tenantId: string,

  actorUserId: string,

  actorName: string,

  refundId: string,
): string {
  const refund = get<RefundRow>(
    `SELECT * FROM refunds WHERE tenant_id = ? AND id = ?`,

    tenantId,

    refundId,
  )

  if (!refund) throw notFound("That refund does not exist")

  if (refund.status === "paid") return refund.id

  const stamp = now()

  const creditNumber = nextDocumentNumber(tenantId, "receipt")

  run(
    `UPDATE refunds
        SET status = 'paid', credit_number = ?, paid_at = ?,
            recorded_by_user_id = ?, recorded_by_name = ?, updated_at = ?
      WHERE tenant_id = ? AND id = ?`,

    creditNumber,

    stamp,

    actorUserId,

    actorName,

    stamp,

    tenantId,

    refund.id,
  )

  appendLedgerEntry({
    tenantId,

    customerId: refund.customer_id,

    kind: "refund",

    amount: refund.amount,

    currency: tenantCurrency(tenantId),

    occurredAt: stamp,

    recordedByUserId: actorUserId,

    recordedByName: actorName,

    bookingId: refund.booking_id,

    reference: creditNumber,

    sourceType: "refund",

    sourceId: refund.id,

    note: refund.reason,
  })

  return refund.id
}

/** Records a rejected refund's decision; no money moves and no ledger row is written. */

export function rejectRefund(tenantId: string, refundId: string): string {
  const refund = get<RefundRow>(
    `SELECT * FROM refunds WHERE tenant_id = ? AND id = ?`,

    tenantId,

    refundId,
  )

  if (!refund) throw notFound("That refund does not exist")

  run(
    `UPDATE refunds SET status = 'rejected', updated_at = ?
      WHERE tenant_id = ? AND id = ? AND status = 'pending'`,

    now(),

    tenantId,

    refund.id,
  )

  return refund.id
}

/** GET /api/customers/:id/refunds — the customer's refund history. */

export async function listRefunds(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "payments", "view")

  const customerId = ctx.params.id

  const customer = get<{ id: string }>(
    `SELECT id FROM customers WHERE tenant_id = ? AND id = ?`,

    guarded.tenantId,

    customerId,
  )

  if (!customer) throw notFound("That customer does not exist")

  const rows = all<RefundRow>(
    `SELECT * FROM refunds WHERE tenant_id = ? AND customer_id = ?
      ORDER BY requested_at DESC, rowid DESC`,

    guarded.tenantId,

    customerId,
  )

  return {
    refunds: rows.map(toRefund),

    currency: tenantCurrency(guarded.tenantId),

    canRequest: guarded.can("payments", "create"),
  }
}
