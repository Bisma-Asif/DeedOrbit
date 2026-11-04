/**
 * The customer ledger vocabulary, shared by the server and the client.
 *
 * The ledger is an append-only journal of monetary events on a customer's account. A
 * row is never edited or deleted — a correction is a fresh, opposite entry — so the
 * history a customer was shown stays the history they were shown. Balance is not stored
 * per row; it is the running sum of the signed `amount` at read time, ordered by when
 * each event happened.
 *
 * Money is a whole number of the tenant's major currency unit, exactly as everywhere
 * else in the platform, and the sign carries the direction: a positive amount adds to
 * what the customer owes (a late fee, a cancellation charge, a refund paid back out that
 * unwinds a prior payment), a negative amount reduces it (a payment received, a waiver).
 */

import { UNIT_PRICE_MAX } from "./inventory.ts"

/** The kind of event a ledger row records. */

export const LEDGER_KINDS = [
  "payment",

  "late_fee",

  "waiver",

  "refund",

  "cancellation_charge",

  "cancellation_refund",

  "transfer_out",

  "transfer_in",

  "adjustment",
] as const

export type LedgerKind = typeof LEDGER_KINDS[number]

export const LEDGER_KIND_LABELS: Record<LedgerKind, string> = {
  payment: "Payment",

  late_fee: "Late fee",

  waiver: "Late-fee waiver",

  refund: "Refund",

  cancellation_charge: "Cancellation charge",

  cancellation_refund: "Cancellation refund",

  transfer_out: "Transferred out",

  transfer_in: "Transferred in",

  adjustment: "Adjustment",
}

/**
 * How each kind reads on a badge. Money in is emerald (success), money the customer now
 * owes is muted red (danger), and neutral movements (transfers, adjustments) are the
 * quiet info tone. Only tones the design system reserves for those meanings.
 */

export const LEDGER_KIND_TONES: Record<LedgerKind, "success" | "danger" | "info" | "outline"> =
  {
    payment: "success",

    late_fee: "danger",

    waiver: "success",

    refund: "danger",

    cancellation_charge: "danger",

    cancellation_refund: "info",

    transfer_out: "info",

    transfer_in: "info",

    adjustment: "outline",
  }

export function isLedgerKind(value: unknown): value is LedgerKind {
  return (
    typeof value === "string" &&
    (LEDGER_KINDS as readonly string[]).includes(value)
  )
}

/** Bound on a free-text note on a ledger row. */

export const LEDGER_NOTE_MAX = 500

/** Bound on a document reference (receipt / credit-note number) stored on a row. */

export const LEDGER_REFERENCE_MAX = 40

/** A ledger row as it reaches the client, with the running balance folded in. */

export interface LedgerEntry {
  id: string

  kind: LedgerKind

  /** Signed delta to the balance: positive adds what is owed, negative reduces it. */

  amount: number

  currency: string

  reference: string | null

  bookingId: string | null

  bookingReference: string | null

  sourceType: string | null

  sourceId: string | null

  occurredAt: string

  note: string | null

  recordedByName: string

  /** The running balance after this entry, computed at read time. */

  balanceAfter: number
}

export const LEDGER_AMOUNT_MAX = UNIT_PRICE_MAX
