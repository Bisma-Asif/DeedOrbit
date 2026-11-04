/**
 * The vocabulary of a maker-checker approval, shared by the server and the client.
 *
 * An approval is a deferred action: something a user asked to happen — a booking
 * above the tenant's threshold, a cancellation — that is stored as a request plus a
 * JSON payload and only takes effect once a different, entitled user approves it.
 * The queue itself is generic: the same row shape and the same page serve every
 * action, so a future discount or exceptional-pricing trigger slots in without a
 * new table or screen. What is not generic is which actions a tenant can switch on,
 * and that is the closed list below.
 *
 * Nothing here drives a booking's own status. The pending state lives in the
 * `approvals` row, not the `bookings` row — until an approval lands, the booking
 * simply has not been made.
 */

/**
 * The actions that may be routed through the approval queue.
 *
 * `booking` and `cancellation` are policy-gated — they only defer when the tenant has
 * switched that policy on, so an untouched workspace keeps its immediate behaviour.
 * `refund`, `late_fee_waiver` and `transfer` are *mandatory* approvals: the money flow
 * is never applied without a sign-off, regardless of any toggle, so they never appear
 * in the policy settings (see `POLICY_CONFIGURABLE_ACTIONS`). `discount` and
 * `exceptional_pricing` have no producer wired yet — the queue already carries them.
 */

export const APPROVAL_ACTIONS = [
  "booking",

  "cancellation",

  "discount",

  "exceptional_pricing",

  "refund",

  "late_fee_waiver",

  "transfer",

  "expense",

  "requisition",

  "purchase_order",

  "document_delete",

  "document_booking_override",
] as const

export type ApprovalAction = typeof APPROVAL_ACTIONS[number]

/**
 * The subset a tenant can switch on or off in Settings. Everything else in the queue is
 * either unconditional-when-triggered (refund/waiver/transfer) or not wired yet, so a
 * toggle would be dead UI. The policy table and the settings panel iterate this list.
 */

export const POLICY_CONFIGURABLE_ACTIONS: readonly ApprovalAction[] = [
  "booking",

  "cancellation",

  "discount",

  "exceptional_pricing",
]

export const APPROVAL_ACTION_LABELS: Record<ApprovalAction, string> = {
  booking: "Booking",

  cancellation: "Cancellation",

  discount: "Discount",

  exceptional_pricing: "Exceptional pricing",

  refund: "Refund",

  late_fee_waiver: "Late-fee waiver",

  transfer: "Transfer",

  expense: "Expense payment",

  requisition: "Purchase requisition",

  purchase_order: "Purchase order",

  document_delete: "Document deletion",

  document_booking_override: "Document booking override",
}

/**
 * The actions whose policy carries a monetary threshold.
 *
 * A booking or a discount is gated by amount — approval is only required above a
 * figure the admin sets. A cancellation is unconditional when enabled, and
 * exceptional pricing is a future flag-only switch, so neither reads a threshold.
 * The UI shows the amount input only for these.
 */

export const APPROVAL_ACTIONS_WITH_THRESHOLD: readonly ApprovalAction[] = [
  "booking",

  "discount",
]

export function isApprovalAction(value: unknown): value is ApprovalAction {
  return (
    typeof value === "string" &&
    (APPROVAL_ACTIONS as readonly string[]).includes(value)
  )
}

/** The three states an approval request can be in. */

export const APPROVAL_STATUSES = ["pending", "approved", "rejected"] as const

export type ApprovalStatus = typeof APPROVAL_STATUSES[number]

export const APPROVAL_STATUS_LABELS: Record<ApprovalStatus, string> = {
  pending: "Pending",

  approved: "Approved",

  rejected: "Rejected",
}

/**
 * How an approval status reads on a badge.
 *
 * Amber for the one state that is genuinely waiting — a pending request; green when
 * it has been signed off; muted red for the terminal rejection. Only the three tones
 * the design system reserves for those meanings, matching the booking tones.
 */

export const APPROVAL_STATUS_TONES: Record<ApprovalStatus, "pending" | "success" | "danger"> =
  {
    pending: "pending",

    approved: "success",

    rejected: "danger",
  }

export function isApprovalStatus(value: unknown): value is ApprovalStatus {
  return (
    typeof value === "string" &&
    (APPROVAL_STATUSES as readonly string[]).includes(value)
  )
}

/** The one-line description shown in the queue and stored with the request. */

export const APPROVAL_SUMMARY_MIN = 1

export const APPROVAL_SUMMARY_MAX = 300

/** The approver's comment. Required on a rejection, optional on an approval. */

export const APPROVAL_NOTE_MIN = 1

export const APPROVAL_NOTE_MAX = 1000

/**
 * The payload shapes carried in `approvals.payload` (as JSON), per action.
 *
 * Named interfaces rather than inline literals so oxfmt cannot collapse the member
 * separator, and so the server and the detail page agree field-for-field on what a
 * decoded payload of a given action contains.
 */

/** A booking held for approval: the whole validated create body, pre-insert. */

export interface BookingApprovalPayload {
  projectId: string

  unitId: string

  customerId: string

  agentUserId: string | null

  dealerId: string | null

  quoteId: string | null

  bookingAmount: number

  bookingDate: string

  terms: string

  notes: string | null

  /** Snapshot labels carried for display only; the apply path re-resolves them. */

  unitCode: string

  customerName: string
}

/**
 * A cancellation held for approval: the booking it targets plus the money the
 * cancellation rules computed. The apply path re-derives the outcome from the live rows,
 * so the amounts here are display snapshots the approver sees before signing.
 */

export interface CancellationApprovalPayload {
  bookingId: string

  /** Snapshot labels carried for display only. */

  reference: string

  customerName: string

  /** The reason the canceller captured; required by the flow's UI and shown to the approver. */

  reason: string

  /** Penalty the rules levy, and the refund that leaves the account. Whole money. */

  chargeAmount: number

  refundAmount: number
}

/** A refund held for approval. */

export interface RefundApprovalPayload {
  refundId: string

  customerId: string

  customerName: string

  /** Snapshot labels carried for display only. */

  reference: string

  amount: number

  reason: string
}

/** A late-fee waiver held for approval. */

export interface LateFeeWaiverApprovalPayload {
  assessmentId: string

  customerId: string

  customerName: string

  bookingId: string

  installmentNumber: number

  amount: number

  reason: string
}

/** A booking transfer held for approval: the booking, the two parties, and the fee. */

export interface TransferApprovalPayload {
  transferId: string

  bookingId: string

  reference: string

  unitCode: string

  fromCustomerId: string

  fromCustomerName: string

  toCustomerId: string

  toCustomerName: string

  fee: number

  outstandingMoved: number

  reason: string
}

/**
 * An expense payment held for approval. Approval is mandatory — an expense is only
 * marked paid once a different user signs off — so this action never appears in
 * the policy-configurable list.
 */

export interface ExpenseApprovalPayload {
  expenseId: string

  category: "project" | "office" | "marketing" | "construction"

  vendorName: string | null

  projectName: string | null

  amount: number

  currency: string

  description: string

  occurredAt: string
}

/**
 * A purchase requisition held for approval. Mandatory sign-off, like an
 * expense: submitting a requisition defers it; a different entitled user
 * approves or rejects. The apply path re-reads the live row, so this payload
 * is what the approver sees, not what gets trusted.
 */

export interface RequisitionApprovalPayload {
  requisitionId: string

  reference: string

  justification: string

  projectName: string | null

  estimatedAmount: number | null

  currency: string

  lineCount: number
}

/** A purchase order awaiting its signature before it may go to the supplier. */

export interface PurchaseOrderApprovalPayload {
  purchaseOrderId: string

  poNumber: string

  vendorName: string

  projectName: string | null

  totalAmount: number

  currency: string

  lineCount: number
}

/**
 * Deleting a *verified* document, which the platform will not do on a single
 * person's say-so. The apply path deletes the row only once a different entitled
 * user signs it off; a rejection leaves the file in place. The title and type are
 * snapshots so the approver can see what they are agreeing to remove.
 */

export interface DocumentDeleteApprovalPayload {
  documentId: string

  title: string

  docType: string

  checklistKey: string | null

  customerId: string | null

  /** Who verified it and when, so the approver knows what certification they are voiding. */

  verifiedByName: string | null

  verifiedAt: string | null

  /** The requester's stated reason, surfaced on the approval card. */

  reason: string | null
}

/**
 * A booking or plan activation held back by the document-verification block rule,
 * released only by a second person's approval. The payload carries the intended
 * booking (so the apply path can replay it) plus who asked to override and why.
 */

export interface DocumentOverrideApprovalPayload {
  /** "booking" or "plan_activation" — which gate the override releases. */

  gate: "booking" | "plan_activation"

  projectId: string

  unitId: string

  customerId: string

  customerType: string

  agentUserId: string | null

  bookingId: string | null

  planId: string | null

  /** The required documents that were still outstanding when the override was asked for. */

  missingKeys: string[]

  reason: string
}
