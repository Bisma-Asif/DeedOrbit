/**
 * The vocabulary of a recorded payment, shared by the server and the client.
 *
 * A payment is money received against a customer, captured once and then allocated
 * across one or more installments (a `payment_allocations` row per line). How it was
 * paid — cash, bank, or online — is a channel fact only; the platform holds no payment
 * gateway, it records what the office actually received. Each payment mints a receipt
 * document number from the tenant's `receipt` sequence.
 *
 * Money is a whole number of the tenant's major currency unit, ceiling the platform's
 * price cap.
 */

import { UNIT_PRICE_MAX } from "./inventory.ts"

/** The channels a payment can arrive through. */

export const PAYMENT_METHODS = ["cash", "bank", "online"] as const

export type PaymentMethod = typeof PAYMENT_METHODS[number]

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "Cash",

  bank: "Bank transfer",

  online: "Online",
}

export const PAYMENT_METHOD_TONES: Record<PaymentMethod, "success" | "info" | "outline"> =
  {
    cash: "success",

    bank: "info",

    online: "outline",
  }

export function isPaymentMethod(value: unknown): value is PaymentMethod {
  return (
    typeof value === "string" &&
    (PAYMENT_METHODS as readonly string[]).includes(value)
  )
}

/** Bounds the record-payment form and the server both enforce. */

export const PAYMENT_AMOUNT_MAX = UNIT_PRICE_MAX

export const PAYMENT_NOTE_MAX = 500

/** One allocation inside a payment: a line of the schedule and how much landed on it. */

export interface PaymentAllocationInput {
  installmentId: string

  amount: number
}
