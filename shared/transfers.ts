/**
 * Booking-transfer vocabulary, shared by the server and the client.
 *
 * A transfer moves a confirmed booking — and with it its payment plan, schedule,
 * receipts and quotations — from one customer to another. It is always approval-gated:
 * requesting one writes a `pending` row and an approval, and only a sign-off repoints
 * the booking and posts the paired ledger movements (an out on the old account, an in on
 * the new) plus any transfer fee. A rejected request leaves the booking exactly where it
 * was.
 */

import { UNIT_PRICE_MAX } from "./inventory.ts"

/** The lifecycle of a transfer request. */

export const TRANSFER_STATUSES = ["pending", "approved", "rejected"] as const

export type TransferStatus = typeof TRANSFER_STATUSES[number]

export const TRANSFER_STATUS_LABELS: Record<TransferStatus, string> = {
  pending: "Pending approval",

  approved: "Completed",

  rejected: "Rejected",
}

export const TRANSFER_STATUS_TONES: Record<TransferStatus, "pending" | "success" | "danger"> =
  {
    pending: "pending",

    approved: "success",

    rejected: "danger",
  }

export function isTransferStatus(value: unknown): value is TransferStatus {
  return (
    typeof value === "string" &&
    (TRANSFER_STATUSES as readonly string[]).includes(value)
  )
}

export const TRANSFER_FEE_MAX = UNIT_PRICE_MAX

export const TRANSFER_REASON_MAX = 500

/** The references a transfer snapshots, so the approver sees what moves before it does. */

export interface TransferDocuments {
  planId: string | null

  installmentCount: number

  paymentCount: number

  receiptNumbers: string[]

  quotationCount: number
}
