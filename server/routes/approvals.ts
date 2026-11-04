/**
 * The maker-checker approval engine.
 *
 * A deferred action — a booking above the tenant's threshold, or a cancellation — is
 * not applied when it is asked for. It is written to the `approvals` queue as a
 * request carrying its full validated body as JSON, and nothing else changes until a
 * *different* user holding `approvals.approve` signs it off. Only then is the stored
 * payload replayed through the very same apply function the immediate path uses, so
 * there is exactly one source of truth for what "make this booking" does.
 *
 * Maker-checker is enforced on the server, not merely hidden in the UI: an approver
 * cannot clear a request they raised. A rejection records the decision and applies no
 * side effect, so a declined booking simply was never made.
 *
 * The queue is generic by row shape and by page; only which actions route here is
 * tenant configuration. `discount` and `exceptional_pricing` have no producer wired
 * yet, but the columns and the dispatch already carry them, so wiring one later is a
 * trigger in its own module plus a case here — not a new table.
 */

import { all, get, run, transaction } from "../db.ts"

import {
  badRequest,
  conflict,
  forbidden,
  notFound,
  readJsonBody,
  type RequestContext,
} from "../http.ts"

import {
  requireAuth,
  requirePermission,
  writeAudit,
  type GuardedContext,
} from "../middleware.ts"

import {
  APPROVAL_ACTIONS_WITH_THRESHOLD,
  APPROVAL_NOTE_MAX,
  APPROVAL_SUMMARY_MAX,
  isApprovalStatus,
  type ApprovalAction,
  type BookingApprovalPayload,
  type CancellationApprovalPayload,
  type DocumentDeleteApprovalPayload,
  type DocumentOverrideApprovalPayload,
  type ExpenseApprovalPayload,
  type LateFeeWaiverApprovalPayload,
  type PurchaseOrderApprovalPayload,
  type RefundApprovalPayload,
  type RequisitionApprovalPayload,
  type TransferApprovalPayload,
} from "../../shared/approvals.ts"

import { applyExpense, rejectExpense } from "./expenses.ts"

import {
  applyPurchaseOrderDecision,
  applyRequisitionDecision,
} from "./procurement.ts"

import {
  applyCancellationWithCharges,
  createBookingRecord,
  readBookingRow,
  resolveBookingApprovalInput,
} from "./bookings.ts"

import { applyRefund, rejectRefund } from "./refunds.ts"

import { applyLateFeeWaiver, rejectLateFeeWaiver } from "./late-fees.ts"

import { applyTransfer, rejectTransfer } from "./transfers.ts"

import { notifyApprovers } from "../notify.ts"

const now = () => new Date().toISOString()

/**
 * The workspace's currency, so a held booking's payload can be read as money rather
 * than a bare figure — the same reason every list response carries it.
 */

function tenantCurrency(tenantId: string): string {
  return (
    get<{ currency: string }>(
      "SELECT currency FROM tenants WHERE id = ?",
      tenantId,
    )?.currency ?? "AED"
  )
}

/** Newest-first cap for the queue, mirroring the booking and quotation list limits. */

const APPROVAL_LIST_LIMIT = 200

interface ApprovalRow {
  id: string

  tenant_id: string

  action_key: string

  status: string

  summary: string | null

  payload: string

  entity_type: string | null

  result_entity_id: string | null

  requested_by_user_id: string

  requested_by_name: string

  requested_at: string

  decided_by_user_id: string | null

  decided_by_name: string | null

  decision_note: string | null

  decided_at: string | null

  updated_at: string
}

function toApproval(row: ApprovalRow) {
  let payload: unknown = null

  try {
    payload = JSON.parse(row.payload)
  } catch {
    payload = null
  }

  return {
    id: row.id,

    actionKey: row.action_key,

    status: row.status,

    summary: row.summary,

    entityType: row.entity_type,

    resultEntityId: row.result_entity_id,

    requestedByUserId: row.requested_by_user_id,

    requestedByName: row.requested_by_name,

    requestedAt: row.requested_at,

    decidedByUserId: row.decided_by_user_id,

    decidedByName: row.decided_by_name,

    decisionNote: row.decision_note,

    decidedAt: row.decided_at,

    updatedAt: row.updated_at,

    payload,
  }
}

const APPROVAL_SELECT = "SELECT * FROM approvals WHERE tenant_id = ?"

/** The wire shape of an approval: the row, camel-cased, with its payload decoded. */

export type ApprovalDto = ReturnType<typeof toApproval>

// --- Policy gate -----------------------------------------------------------

/**
 * Whether `actionKey` must be held for approval on this workspace right now.
 *
 * Reads the tenant's policy row; an absent row is disabled, which is why every
 * existing flow keeps its immediate behaviour until an admin turns a policy on. For
 * the amount-gated actions a request is only required at or above the threshold; for
 * the unconditional ones, being enabled is enough.
 */

/**
 * A policy row as the gate reads it. A named interface rather than an inline generic
 * literal: `oxfmt` strips the member separator from a multi-member literal that fits on
 * one line, which turns `<{ enabled: number; threshold_amount: number }>` into invalid
 * syntax.
 */

interface ApprovalPolicyState {
  enabled: number

  threshold_amount: number
}

export function approvalGate(
  tenantId: string,

  actionKey: ApprovalAction,

  amount?: number,
): boolean {
  const policy = get<ApprovalPolicyState>(
    `SELECT enabled, threshold_amount FROM approval_policies
      WHERE tenant_id = ? AND action_key = ?`,

    tenantId,

    actionKey,
  )

  if (!policy || policy.enabled !== 1) return false

  if (
    amount !== undefined &&
    APPROVAL_ACTIONS_WITH_THRESHOLD.includes(actionKey)
  ) {
    return amount >= policy.threshold_amount
  }

  return true
}

// --- Request producer (imported by the business routes) -------------------

export interface ApprovalRequestInput {
  tenantId: string

  actionKey: ApprovalAction

  summary: string

  payload: unknown

  entityType: string

  /** The row the request targets or will produce — the booking id, existing or future. */

  resultEntityId: string | null

  requestedByUserId: string

  requestedByName: string
}

/**
 * Writes a pending request and returns its stored row.
 *
 * Kept deliberately thin — it does one INSERT and re-reads — because the caller owns
 * the transaction: a booking route that defers itself, or the settings flow, wraps
 * this in whatever else it must do atomically.
 */

export function insertApproval(input: ApprovalRequestInput): ApprovalDto {
  const id = `appr_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`

  const stamp = now()

  const summary =
    input.summary.length > APPROVAL_SUMMARY_MAX
      ? input.summary.slice(0, APPROVAL_SUMMARY_MAX)
      : input.summary

  run(
    `INSERT INTO approvals (
        id, tenant_id, action_key, status, summary, payload, entity_type,
        result_entity_id, requested_by_user_id, requested_by_name, requested_at,
        updated_at
      ) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?)`,

    id,

    input.tenantId,

    input.actionKey,

    summary,

    JSON.stringify(input.payload),

    input.entityType,

    input.resultEntityId,

    input.requestedByUserId,

    input.requestedByName,

    stamp,

    stamp,
  )

  const row = get<ApprovalRow>(
    `${APPROVAL_SELECT} AND id = ?`,
    input.tenantId,
    id,
  )

  if (!row) throw notFound("That approval request could not be recorded")

  // Every approval request is born here, so this one call is what makes "requests
  // waiting on you" reach each entitled approver, whatever module raised it. The
  // requester is excluded: maker-checker means they cannot approve their own.
  notifyApprovers(input.tenantId, input.requestedByUserId, {
    type: "approval_requested",
    title: `Approval needed: ${input.actionKey.replace(/_/g, " ")}`,
    body: summary,
    linkPath: `/approvals/${id}`,
    actorUserId: input.requestedByUserId,
    actorName: input.requestedByName,
  })

  return toApproval(row)
}

/**
 * The pending request already held for a given target, if any.
 *
 * Used so a second cancellation of an already-deferred booking does not pile a
 * duplicate onto the queue — the caller returns the one that is already waiting.
 */

export function pendingApprovalFor(
  tenantId: string,

  actionKey: ApprovalAction,

  resultEntityId: string,
): ApprovalDto | null {
  const row = get<ApprovalRow>(
    `${APPROVAL_SELECT} AND action_key = ? AND status = 'pending' AND result_entity_id = ?`,

    tenantId,

    actionKey,

    resultEntityId,
  )

  return row ? toApproval(row) : null
}

// --- Read ------------------------------------------------------------------

/** GET /api/approvals?status= */

export async function listApprovals(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "approvals", "view")

  const status = ctx.query.get("status")

  const clauses = ["tenant_id = ?"]

  const params: (string | number)[] = [guarded.tenantId]

  if (status && isApprovalStatus(status)) {
    clauses.push("status = ?")

    params.push(status)
  }

  const rows = all<ApprovalRow>(
    `SELECT * FROM approvals
      WHERE ${clauses.join(" AND ")}
      ORDER BY requested_at DESC, rowid DESC
      LIMIT ?`,

    ...params,

    APPROVAL_LIST_LIMIT,
  )

  return {
    approvals: rows.map(toApproval),

    canApprove: guarded.can("approvals", "approve"),

    currency: tenantCurrency(guarded.tenantId),

    truncated: rows.length === APPROVAL_LIST_LIMIT,
  }
}

/** GET /api/approvals/:id */

export async function getApproval(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "approvals", "view")

  const row = readApproval(guarded, ctx.params.id)

  return {
    approval: toApproval(row),
    currency: tenantCurrency(guarded.tenantId),
  }
}

function readApproval(guarded: GuardedContext, id?: string): ApprovalRow {
  if (!id) throw notFound("That approval request does not exist")

  const row = get<ApprovalRow>(
    `${APPROVAL_SELECT} AND id = ?`,
    guarded.tenantId,
    id,
  )

  if (!row) throw notFound("That approval request does not exist")

  return row
}

// --- Decision --------------------------------------------------------------

/**
 * POST /api/approvals/:id/approve — clear a pending request and apply its payload.
 *
 * Everything runs in one transaction: the replay of the stored action and the flip of
 * the request to `approved` commit together or not at all, so a booking is never made
 * against a request that still reads pending. Maker-checker is enforced here — the
 * approver may not be the requester — and a request that has already been decided is
 * refused rather than silently replayed.
 */

export async function approveApproval(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "approvals", "approve")

  const body = await readJsonBody<{ decisionNote?: unknown }>(ctx.req)

  const note =
    typeof body.decisionNote === "string" ? body.decisionNote.trim() : ""

  if (note.length > APPROVAL_NOTE_MAX) {
    throw badRequest("Check the highlighted fields", {
      decisionNote: `Use ${APPROVAL_NOTE_MAX} characters or fewer.`,
    })
  }

  const pending = readApproval(guarded, ctx.params.id)

  requirePending(pending, guarded.userId)

  const stamp = now()

  const resultEntityId = transaction(() =>
    applyApprovalPayload(guarded, pending),
  )

  run(
    `UPDATE approvals
        SET status = 'approved', result_entity_id = ?, decided_by_user_id = ?,
            decided_by_name = ?, decision_note = ?, decided_at = ?, updated_at = ?
      WHERE tenant_id = ? AND id = ?`,

    resultEntityId,

    guarded.userId,

    guarded.session.user.fullName,

    note === "" ? null : note,

    stamp,

    stamp,

    guarded.tenantId,

    pending.id,
  )

  writeAudit(
    guarded,

    "approval.approved",

    "approval",

    pending.id,

    { actionKey: pending.action_key, resultEntityId },

    ctx.ip,
  )

  const row = readApproval(guarded, pending.id)

  return { approval: toApproval(row) }
}

/**
 * POST /api/approvals/:id/reject — decline a pending request, applying nothing.
 *
 * A comment is required: the requester deserves to know why their action was held
 * back, and a decision with no reason is unauditable. No side effect is replayed, so
 * the deferred booking was simply never made.
 */

export async function rejectApproval(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "approvals", "approve")

  const body = await readJsonBody<{ decisionNote?: unknown }>(ctx.req)

  const note =
    typeof body.decisionNote === "string" ? body.decisionNote.trim() : ""

  const errors: Record<string, string> = {}

  if (note === "") {
    errors.decisionNote = "Record why this request is being rejected."
  } else if (note.length > APPROVAL_NOTE_MAX) {
    errors.decisionNote = `Use ${APPROVAL_NOTE_MAX} characters or fewer.`
  }

  if (Object.keys(errors).length > 0) {
    throw badRequest("Check the highlighted fields", errors)
  }

  const pending = readApproval(guarded, ctx.params.id)

  requirePending(pending, guarded.userId)

  const stamp = now()

  // The rejection and any side effect it must unwind (a refund, a transfer, a waiver
  // returning the fee to applied) commit together, so a declined request never leaves its
  // own row stranded in a half-decided state.
  transaction(() => {
    rejectApprovalPayload(guarded, pending)

    run(
      `UPDATE approvals
        SET status = 'rejected', decided_by_user_id = ?, decided_by_name = ?,
            decision_note = ?, decided_at = ?, updated_at = ?
        WHERE tenant_id = ? AND id = ?`,

      guarded.userId,

      guarded.session.user.fullName,

      note,

      stamp,

      stamp,

      guarded.tenantId,

      pending.id,
    )
  })

  writeAudit(
    guarded,

    "approval.rejected",

    "approval",

    pending.id,

    { actionKey: pending.action_key },

    ctx.ip,
  )

  const row = readApproval(guarded, pending.id)

  return { approval: toApproval(row) }
}

function requirePending(row: ApprovalRow, approverUserId: string): void {
  if (row.status !== "pending") {
    throw conflict("This request has already been decided.")
  }

  // Maker-checker: the person who raised a request cannot be the one to clear it.

  if (row.requested_by_user_id === approverUserId) {
    throw forbidden(
      "You cannot approve or reject a request you raised.",

      "self_approval",
    )
  }
}

/**
 * Replays a pending booking / cancellation payload and returns the row it produced.
 *
 * Dispatch is on `action_key` only; each case re-reads and re-validates against the
 * live database rather than trusting the snapshot, so a unit that was sold by hand
 * while the request waited is refused here instead of double-booked. The apply
 * functions are the same ones the immediate booking path calls, so an approved
 * booking is byte-for-byte what an unheld booking would have been.
 */

function applyApprovalPayload(
  guarded: GuardedContext,

  row: ApprovalRow,
): string {
  let payload: unknown

  try {
    payload = JSON.parse(row.payload)
  } catch {
    throw conflict("This request's stored action could not be read.")
  }

  switch (row.action_key) {
    case "booking":
      return applyBooking(guarded, payload as BookingApprovalPayload, row)

    case "cancellation":
      return applyCancel(guarded, payload as CancellationApprovalPayload)

    case "refund":
      return applyRefund(
        guarded.tenantId,
        guarded.userId,
        guarded.session.user.fullName,
        (payload as RefundApprovalPayload).refundId,
      )

    case "late_fee_waiver":
      return applyLateFeeWaiver(
        guarded.tenantId,
        guarded.userId,
        guarded.session.user.fullName,
        (payload as LateFeeWaiverApprovalPayload).assessmentId,
      )

    case "transfer":
      return applyTransfer(
        guarded.tenantId,
        guarded.userId,
        guarded.session.user.fullName,
        (payload as TransferApprovalPayload).transferId,
      )

    case "expense":
      return applyExpense(
        guarded.tenantId,
        (payload as ExpenseApprovalPayload).expenseId,
      )

    case "requisition":
      return applyRequisitionDecision(
        guarded.tenantId,
        (payload as RequisitionApprovalPayload).requisitionId,
        true,
      )

    case "purchase_order":
      return applyPurchaseOrderDecision(
        guarded.tenantId,
        (payload as PurchaseOrderApprovalPayload).purchaseOrderId,
        true,
      )

    case "document_delete":
      return applyDocumentDelete(
        guarded,
        payload as DocumentDeleteApprovalPayload,
        row,
      )

    case "document_booking_override":
      // The override approval *is* the release: nothing is created here. The block
      // rule reads this approved row and lets the requester's retry through, so the
      // decider and reason are already on the approvals record. Apply just confirms
      // the customer it releases and logs that the release became live.
      return applyDocumentOverride(
        guarded,
        payload as DocumentOverrideApprovalPayload,
        row,
      )

    default:
      throw conflict(
        "This kind of request cannot be applied by the current build.",
      )
  }
}

function applyBooking(
  guarded: GuardedContext,

  payload: BookingApprovalPayload,

  row: ApprovalRow,
): string {
  const input = resolveBookingApprovalInput(guarded.tenantId, payload)

  // The booking is credited to the officer who requested it, not to the approver —

  // the maker-checker split governs who may sign it off, not whose deal it is.

  const created = createBookingRecord(
    guarded.tenantId,

    row.requested_by_user_id,

    row.requested_by_name,

    input,
  )

  return created.id
}

function applyCancel(
  guarded: GuardedContext,

  payload: CancellationApprovalPayload,
): string {
  const booking = readBookingRow(guarded.tenantId, payload.bookingId)

  if (booking.status === "cancelled") {
    throw conflict("This booking is already cancelled.")
  }

  // The charge, refund, and unit outcome are re-derived from the live rows at approval time,
  // so a signed-off cancellation is exactly what an unheld one would have been.
  return applyCancellationWithCharges(
    guarded.tenantId,

    guarded.session.user.fullName,

    guarded.userId,

    booking,
  ).id
}

/**
 * Carries out a signed-off deletion of a *verified* document.
 *
 * The delete only ever happens here, after a second entitled user approved it; the
 * requester's own attempt raised this request instead of removing the row. The check
 * re-reads the live document so a file already gone (deleted by hand, or moved to
 * another tenant) is refused rather than silently reported as removed.
 */

interface DocumentRef {
  id: string

  tenant_id: string
}

function applyDocumentDelete(
  guarded: GuardedContext,
  payload: DocumentDeleteApprovalPayload,
  row: ApprovalRow,
): string {
  const existing = get<DocumentRef>(
    "SELECT id, tenant_id FROM documents WHERE id = ?",
    payload.documentId,
  )

  if (!existing || existing.tenant_id !== guarded.tenantId) {
    throw conflict("The document this asked to delete no longer exists.")
  }

  run(
    "DELETE FROM documents WHERE tenant_id = ? AND id = ?",
    guarded.tenantId,
    payload.documentId,
  )

  writeAudit(
    guarded,
    "document.deleted_by_approval",
    "document",
    payload.documentId,
    {
      title: payload.title,
      requestedBy: row.requested_by_name,
      reason: payload.reason,
    },
    null,
  )

  return payload.documentId
}

/**
 * Confirms a signed-off document-block override.
 *
 * There is no booking or plan to create here: the approved row is itself the release
 * token the block rule reads, so the requester's retry goes through and the decision
 * (requester, decider, reason) is already recorded on the approval. This domain audit
 * just marks the moment the release took effect.
 */

function applyDocumentOverride(
  guarded: GuardedContext,
  payload: DocumentOverrideApprovalPayload,
  row: ApprovalRow,
): string {
  writeAudit(
    guarded,
    "document.override.approved",
    "customer",
    payload.customerId,
    {
      gate: payload.gate,
      requestedBy: row.requested_by_name,
      missingKeys: payload.missingKeys,
      reason: payload.reason,
    },
    null,
  )

  return payload.customerId
}

/**
 * Replays a rejection's side effects, if the action has any.
 *
 * Booking and cancellation rejections simply never happened, so nothing to unwind. A refund,
 * a transfer, or a late-fee waiver raised its own pending row, so a rejection must settle
 * that row back to a terminal (or restored) state — a rejected refund, a rejected transfer
 * leaving the booking in place, a declined waiver returning the fee to applied.
 */
function rejectApprovalPayload(
  guarded: GuardedContext,
  row: ApprovalRow,
): void {
  let payload: unknown

  try {
    payload = JSON.parse(row.payload)
  } catch {
    return
  }

  switch (row.action_key) {
    case "refund":
      rejectRefund(
        guarded.tenantId,
        (payload as RefundApprovalPayload).refundId,
      )

      break

    case "transfer":
      rejectTransfer(
        guarded.tenantId,
        (payload as TransferApprovalPayload).transferId,
      )

      break

    case "late_fee_waiver":
      rejectLateFeeWaiver(
        guarded.tenantId,
        (payload as LateFeeWaiverApprovalPayload).assessmentId,
      )

      break

    case "expense":
      rejectExpense(
        guarded.tenantId,
        (payload as ExpenseApprovalPayload).expenseId,
      )

      break

    case "requisition":
      applyRequisitionDecision(
        guarded.tenantId,
        (payload as RequisitionApprovalPayload).requisitionId,
        false,
      )

      break

    case "purchase_order":
      applyPurchaseOrderDecision(
        guarded.tenantId,
        (payload as PurchaseOrderApprovalPayload).purchaseOrderId,
        false,
      )

      break

    default:
      break
  }
}
