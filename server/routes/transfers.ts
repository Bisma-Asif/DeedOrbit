/**
 * Booking transfers: move a confirmed booking between customers, always through approval.
 *
 * Requesting a transfer snapshots what will travel with the booking, writes a `pending`
 * row, and raises a mandatory approval. Only a sign-off repoints the booking to the new
 * customer — installments and receipts follow it through the booking link — and posts the
 * paired ledger movements: the outstanding balance leaving the old account and arriving on
 * the new, plus any transfer fee charged to the newcomer. A rejected request leaves the
 * booking exactly where it was, and the before/after history stays visible on both ledgers.
 */

import { all, get, run, transaction } from "../db.ts"

import {
  badRequest,
  conflict,
  notFound,
  readJsonBody,
  type RequestContext,
} from "../http.ts"

import { requireAuth, requirePermission, writeAudit } from "../middleware.ts"

import {
  TRANSFER_FEE_MAX,
  TRANSFER_REASON_MAX,
  type TransferDocuments,
} from "../../shared/transfers.ts"

import type { TransferApprovalPayload } from "../../shared/approvals.ts"

import { appendLedgerEntry } from "../ledger.ts"

import { insertApproval, pendingApprovalFor } from "./approvals.ts"

const now = () => new Date().toISOString()

function tenantCurrency(tenantId: string): string {
  return (
    get<{ currency: string }>(
      "SELECT currency FROM tenants WHERE id = ?",

      tenantId,
    )?.currency ?? "AED"
  )
}

interface TransferRow {
  id: string

  tenant_id: string

  booking_id: string

  from_customer_id: string

  to_customer_id: string

  fee: number

  outstanding_moved: number

  reason: string | null

  status: string

  approval_id: string | null

  documents: string | null

  requested_by_user_id: string

  requested_by_name: string

  requested_at: string

  completed_at: string | null

  updated_at: string
}

function toTransfer(row: TransferRow) {
  let documents: TransferDocuments | null = null

  try {
    documents = row.documents
      ? JSON.parse(row.documents) as TransferDocuments
      : null
  } catch {
    documents = null
  }

  return {
    id: row.id,

    bookingId: row.booking_id,

    fromCustomerId: row.from_customer_id,

    toCustomerId: row.to_customer_id,

    fee: row.fee,

    outstandingMoved: row.outstanding_moved,

    reason: row.reason,

    status: row.status,

    approvalId: row.approval_id,

    documents,

    requestedByUserId: row.requested_by_user_id,

    requestedByName: row.requested_by_name,

    requestedAt: row.requested_at,

    completedAt: row.completed_at,

    updatedAt: row.updated_at,
  }
}

function bookingRow(tenantId: string, id: string) {
  return get<{
    id: string

    customer_id: string

    customer_name: string

    reference: string

    unit_code: string

    status: string
  }>(
    `SELECT id, customer_id, customer_name, reference, unit_code, status
      FROM bookings WHERE tenant_id = ? AND id = ?`,

    tenantId,

    id,
  )
}

function outstandingOnBooking(tenantId: string, bookingId: string): number {
  return (
    get<{ n: number }>(
      `SELECT COALESCE(SUM(total - paid_amount), 0) AS n
        FROM payment_installments WHERE tenant_id = ? AND booking_id = ?`,

      tenantId,

      bookingId,
    )?.n ?? 0
  )
}

interface SnapshotBookingInput {
  id: string

  unit_id?: string

  quote_id?: string | null
}

interface CustomerNameRow {
  id: string

  full_name: string
}

interface TransferTransactionResult {
  transferId: string

  approvalId: string
}

function snapshotDocuments(
  tenantId: string,

  booking: SnapshotBookingInput,
): TransferDocuments {
  const plan = get<{ id: string }>(
    `SELECT id FROM payment_plans WHERE tenant_id = ? AND booking_id = ?`,

    tenantId,

    booking.id,
  )

  const installmentCount =
    get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM payment_installments WHERE tenant_id = ? AND booking_id = ?`,

      tenantId,

      booking.id,
    )?.n ?? 0

  const receipts = all<{ receipt_number: string | null }>(
    `SELECT receipt_number FROM payments WHERE tenant_id = ? AND booking_id = ?`,

    tenantId,

    booking.id,
  )

  return {
    planId: plan?.id ?? null,

    installmentCount,

    paymentCount: receipts.length,

    receiptNumbers: receipts

      .map((r) => r.receipt_number)

      .filter((n): n is string => n !== null),

    quotationCount: 0,
  }
}

/**
 * POST /api/transfers — hold a booking transfer for approval.
 *
 * The booking must be confirmed and the target must be a different, existing customer. The
 * outstanding balance and the documents that will travel are snapshotted now so the
 * approver sees exactly what moves.
 */

export async function requestTransfer(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "bookings", "edit")

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const errors: Record<string, string> = {}

  const bookingId =
    typeof body.bookingId === "string" ? body.bookingId.trim() : ""

  if (!bookingId) errors.bookingId = "Choose the booking to transfer."

  const toCustomerId =
    typeof body.toCustomerId === "string" ? body.toCustomerId.trim() : ""

  if (!toCustomerId) errors.toCustomerId = "Choose the receiving customer."

  const fee =
    typeof body.fee === "number" &&
    Number.isSafeInteger(body.fee) &&
    body.fee >= 0 &&
    body.fee <= TRANSFER_FEE_MAX
      ? body.fee
      : body.fee === undefined || body.fee === null
        ? 0
        : null

  if (fee === null)
    errors.fee = `Enter a whole number from 0 to ${TRANSFER_FEE_MAX}.`

  const reason = typeof body.reason === "string" ? body.reason.trim() : ""

  if (reason.length > TRANSFER_REASON_MAX)
    errors.reason = `Use ${TRANSFER_REASON_MAX} characters or fewer.`

  if (Object.keys(errors).length > 0) {
    throw badRequest("Check the highlighted fields", errors)
  }

  const booking = bookingRow(guarded.tenantId, bookingId)

  if (!booking) throw notFound("That booking does not exist")

  if (booking.status !== "confirmed") {
    throw conflict("Only a confirmed booking can be transferred.")
  }

  if (toCustomerId === booking.customer_id) {
    throw badRequest("Check the highlighted fields", {
      toCustomerId: "Choose a different customer to transfer to.",
    })
  }

  const target = get<CustomerNameRow>(
    `SELECT id, full_name FROM customers WHERE tenant_id = ? AND id = ?`,

    guarded.tenantId,

    toCustomerId,
  )

  if (!target) throw notFound("That customer does not exist")

  const outstanding = outstandingOnBooking(guarded.tenantId, booking.id)

  const documents = snapshotDocuments(guarded.tenantId, booking)

  const result = transaction((): TransferTransactionResult => {
    const held = pendingApprovalFor(guarded.tenantId, "transfer", booking.id)

    const transferId = `trf_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`

    const stamp = now()

    run(
      `INSERT INTO transfers (
          id, tenant_id, booking_id, from_customer_id, to_customer_id, fee,
          outstanding_moved, reason, status, documents, requested_by_user_id,
          requested_by_name, requested_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`,

      transferId,

      guarded.tenantId,

      booking.id,

      booking.customer_id,

      toCustomerId,

      fee ?? 0,

      outstanding,

      reason === "" ? null : reason,

      JSON.stringify(documents),

      guarded.userId,

      guarded.session.user.fullName,

      stamp,

      stamp,
    )

    if (held) {
      run(
        `UPDATE transfers SET approval_id = ? WHERE tenant_id = ? AND id = ?`,

        held.id,

        guarded.tenantId,

        transferId,
      )

      return { transferId, approvalId: held.id }
    }

    const payload: TransferApprovalPayload = {
      transferId,

      bookingId: booking.id,

      reference: booking.reference,

      unitCode: booking.unit_code,

      fromCustomerId: booking.customer_id,

      fromCustomerName: booking.customer_name,

      toCustomerId,

      toCustomerName: target.full_name,

      fee: fee ?? 0,

      outstandingMoved: outstanding,

      reason,
    }

    const approval = insertApproval({
      tenantId: guarded.tenantId,

      actionKey: "transfer",

      summary: `Transfer ${booking.reference} to ${target.full_name}`,

      payload,

      entityType: "transfer",

      resultEntityId: transferId,

      requestedByUserId: guarded.userId,

      requestedByName: guarded.session.user.fullName,
    })

    run(
      `UPDATE transfers SET approval_id = ? WHERE tenant_id = ? AND id = ?`,

      approval.id,

      guarded.tenantId,

      transferId,
    )

    return { transferId, approvalId: approval.id }
  })

  writeAudit(
    guarded,

    "transfer.requested",

    "transfer",

    result.transferId,

    { bookingId: booking.id, toCustomerId, approvalId: result.approvalId },

    ctx.ip,
  )

  const transfer = get<TransferRow>(
    `SELECT * FROM transfers WHERE tenant_id = ? AND id = ?`,

    guarded.tenantId,

    result.transferId,
  )

  return { transfer: transfer ? toTransfer(transfer) : null, pending: true }
}

/**
 * Applies an approved transfer. Runs inside the caller's transaction; the approvals replay
 * is the only caller. Repoints the booking to the new customer, carries the receipts across
 * with it, posts the paired ledger movements plus the fee, and stamps the transfer done.
 * Idempotent — a completed transfer is returned untouched.
 */

export function applyTransfer(
  tenantId: string,

  actorUserId: string,

  actorName: string,

  transferId: string,
): string {
  const transfer = get<TransferRow>(
    `SELECT * FROM transfers WHERE tenant_id = ? AND id = ?`,

    tenantId,

    transferId,
  )

  if (!transfer) throw notFound("That transfer does not exist")

  if (transfer.status === "approved") return transfer.id

  const booking = bookingRow(tenantId, transfer.booking_id)

  if (!booking) throw notFound("That booking does not exist")

  if (booking.status !== "confirmed") {
    throw notFound("Only a confirmed booking can be transferred.")
  }

  const target = get<{ full_name: string }>(
    `SELECT full_name FROM customers WHERE tenant_id = ? AND id = ?`,

    tenantId,

    transfer.to_customer_id,
  )

  if (!target) throw notFound("The receiving customer no longer exists.")

  const stamp = now()

  const currency = tenantCurrency(tenantId)

  run(
    `UPDATE bookings
        SET customer_id = ?, customer_name = ?, updated_at = ?
      WHERE tenant_id = ? AND id = ?`,

    transfer.to_customer_id,

    target.full_name,

    stamp,

    tenantId,

    transfer.booking_id,
  )

  // The receipts the old customer paid travel with the booking they were raised against.

  run(
    `UPDATE payments SET customer_id = ?
      WHERE tenant_id = ? AND booking_id = ?`,

    transfer.to_customer_id,

    tenantId,

    transfer.booking_id,
  )

  const moved = transfer.outstanding_moved

  if (moved > 0) {
    appendLedgerEntry({
      tenantId,

      customerId: transfer.from_customer_id,

      kind: "transfer_out",

      amount: -moved,

      currency,

      occurredAt: stamp,

      recordedByUserId: actorUserId,

      recordedByName: actorName,

      bookingId: transfer.booking_id,

      reference: booking.reference,

      sourceType: "transfer",

      sourceId: transfer.id,

      note: "Booking transferred out",
    })

    appendLedgerEntry({
      tenantId,

      customerId: transfer.to_customer_id,

      kind: "transfer_in",

      amount: moved,

      currency,

      occurredAt: stamp,

      recordedByUserId: actorUserId,

      recordedByName: actorName,

      bookingId: transfer.booking_id,

      reference: booking.reference,

      sourceType: "transfer",

      sourceId: transfer.id,

      note: "Booking transferred in",
    })
  }

  if (transfer.fee > 0) {
    appendLedgerEntry({
      tenantId,

      customerId: transfer.to_customer_id,

      kind: "adjustment",

      amount: transfer.fee,

      currency,

      occurredAt: stamp,

      recordedByUserId: actorUserId,

      recordedByName: actorName,

      bookingId: transfer.booking_id,

      reference: booking.reference,

      sourceType: "transfer",

      sourceId: transfer.id,

      note: "Transfer fee",
    })
  }

  run(
    `UPDATE transfers
        SET status = 'approved', completed_at = ?, updated_at = ?
      WHERE tenant_id = ? AND id = ?`,

    stamp,

    stamp,

    tenantId,

    transfer.id,
  )

  return transfer.id
}

/** Records a rejected transfer; the booking stays on its current customer. */

export function rejectTransfer(tenantId: string, transferId: string): string {
  const transfer = get<TransferRow>(
    `SELECT * FROM transfers WHERE tenant_id = ? AND id = ?`,

    tenantId,

    transferId,
  )

  if (!transfer) throw notFound("That transfer does not exist")

  run(
    `UPDATE transfers SET status = 'rejected', updated_at = ?
      WHERE tenant_id = ? AND id = ? AND status = 'pending'`,

    now(),

    tenantId,

    transfer.id,
  )

  return transfer.id
}

/** GET /api/customers/:id/transfers — every transfer touching this customer, either way. */

export async function listTransfersForCustomer(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "bookings", "view")

  const customerId = ctx.params.id

  const customer = get<{ id: string }>(
    `SELECT id FROM customers WHERE tenant_id = ? AND id = ?`,

    guarded.tenantId,

    customerId,
  )

  if (!customer) throw notFound("That customer does not exist")

  const rows = all<TransferRow>(
    `SELECT * FROM transfers
      WHERE tenant_id = ? AND (from_customer_id = ? OR to_customer_id = ?)
      ORDER BY requested_at DESC, rowid DESC`,

    guarded.tenantId,

    customerId,

    customerId,
  )

  return {
    transfers: rows.map(toTransfer),

    currency: tenantCurrency(guarded.tenantId),

    canRequest: guarded.can("bookings", "edit"),
  }
}
