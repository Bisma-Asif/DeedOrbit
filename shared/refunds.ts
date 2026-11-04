/**
 * Refund vocabulary, shared by the server and the client.
 *
 * A refund returns money already received back to the customer. It is always
 * approval-gated: requesting one writes a `pending` row and an approval, and only a
 * sign-off moves it to `paid`, mints a credit-note number (from the same `receipt`
 * sequence), and posts the ledger debit. A refund is bounded by what the referenced
 * payment still has un-refunded, so the money out can never exceed the money in.
 */

/** The lifecycle of a refund. */

export const REFUND_STATUSES = [
  "pending",

  "approved",

  "paid",

  "rejected",
] as const

export type RefundStatus = typeof REFUND_STATUSES[number]

export const REFUND_STATUS_LABELS: Record<RefundStatus, string> = {
  pending: "Pending approval",

  approved: "Approved",

  paid: "Paid",

  rejected: "Rejected",
}

export const REFUND_STATUS_TONES: Record<RefundStatus, "pending" | "info" | "success" | "danger"> =
  {
    pending: "pending",

    approved: "info",

    paid: "success",

    rejected: "danger",
  }

export function isRefundStatus(value: unknown): value is RefundStatus {
  return (
    typeof value === "string" &&
    (REFUND_STATUSES as readonly string[]).includes(value)
  )
}

export const REFUND_AMOUNT_MAX = 1_000_000_000_000

export const REFUND_REASON_MIN = 1

export const REFUND_REASON_MAX = 500
