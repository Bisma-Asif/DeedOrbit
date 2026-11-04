/**
 * Cancellation-rule vocabulary, shared by the server and the client.
 *
 * The rules say what it costs to cancel a confirmed booking: a flat charge or a
 * percentage (basis points) of the amount paid to date, optionally capped, and which
 * status the unit returns to. The resulting refund is whatever the customer overpaid
 * beyond that charge — `paid - charge`, floored at zero. There is no separate charge
 * ledger unless the rules are configured; an untouched workspace cancels with no charge
 * and no refund, exactly as before.
 */

import { UNIT_PRICE_MAX } from "./inventory.ts"

/** How the cancellation charge is sized. */

export const CANCELLATION_MODES = ["fixed", "percent"] as const

export type CancellationMode = typeof CANCELLATION_MODES[number]

export const CANCELLATION_MODE_LABELS: Record<CancellationMode, string> = {
  fixed: "Flat charge",

  percent: "Percentage of amount paid",
}

export function isCancellationMode(value: unknown): value is CancellationMode {
  return (
    typeof value === "string" &&
    (CANCELLATION_MODES as readonly string[]).includes(value)
  )
}

/** What happens to the freed unit. */

export const UNIT_OUTCOMES = ["available", "blocked"] as const

export type UnitOutcome = typeof UNIT_OUTCOMES[number]

export const UNIT_OUTCOME_LABELS: Record<UnitOutcome, string> = {
  available: "Return to Available",

  blocked: "Mark Blocked",
}

export function isUnitOutcome(value: unknown): value is UnitOutcome {
  return (
    typeof value === "string" &&
    (UNIT_OUTCOMES as readonly string[]).includes(value)
  )
}

export const CANCELLATION_AMOUNT_MAX = UNIT_PRICE_MAX

export const CANCELLATION_PERCENT_BPS_MAX = 10000

export const CANCELLATION_REASON_MAX = 500
