/**
 * The vocabulary of a booking, shared by the server and the client.
 *
 * A booking is the moment a unit is formally committed to a customer: it links a
 * real customer to a real unit, records the amount and date taken, and — through
 * the workflow the schema anticipated — moves the unit to its built-in `booked`
 * status. Nothing here is a second copy of the inventory vocabulary: the status a
 * unit may be booked *from* is expressed against the same keys the inventory
 * module owns, so a booking cannot quietly widen what counts as bookable.
 *
 * The lifecycle is deliberately short. This build creates a confirmed booking and
 * cancels it; cancelling returns the unit to the market. It is not an approval
 * queue, and it is not a payment ledger — those are separate subjects with their
 * own modules.
 */

import { UNIT_PRICE_MAX } from "./inventory.ts"

/** The two states a booking can be in. */

export const BOOKING_STATUSES = ["confirmed", "cancelled"] as const

export type BookingStatus = typeof BOOKING_STATUSES[number]

export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  confirmed: "Confirmed",

  cancelled: "Cancelled",
}

/**
 * How a booking status reads on a badge.
 *
 * Only two tones are offered, and they are the two the design system reserves for
 * these meanings: green for a booking that stands, muted red for the terminal
 * cancelled state. Amber belongs to something pending, and a confirmed booking is
 * not pending anything, so it earns no colour here.
 */

export const BOOKING_STATUS_TONES: Record<BookingStatus, "success" | "danger"> =
  {
    confirmed: "success",

    cancelled: "danger",
  }

export function isBookingStatus(value: unknown): value is BookingStatus {
  return (
    typeof value === "string" &&
    (BOOKING_STATUSES as readonly string[]).includes(value)
  )
}

/**
 * The booking amount is a whole number of the tenant's major currency unit, exactly
 * like a unit base price and a quotation figure, and it shares that ceiling: a
 * booking can never be written for more than the largest price the schema stores.
 */

export const BOOKING_AMOUNT_MIN = 0

export const BOOKING_AMOUNT_MAX = UNIT_PRICE_MAX

/** The agreed terms recorded against the booking — required, and the heart of it. */

export const BOOKING_TERMS_MIN = 1

export const BOOKING_TERMS_MAX = 2000

/** Free notes, optional, kept shorter than the terms they sit beside. */

export const BOOKING_NOTES_MAX = 1000

/**
 * The statuses a unit may be booked *from*.
 *
 * A draft or a blocked unit cannot be sold; a booked, sold, cancelled or
 * transferred unit is already committed somewhere else, so booking it again would
 * contradict the trail. Reserved is included because a reservation is the soft
 * hold a formal booking is about to replace. Expressed against the inventory keys
 * rather than re-derived, so a move here is the only place bookability is decided.
 */

export const BOOKABLE_UNIT_STATUS_KEYS: readonly string[] = [
  "draft",

  "available",

  "reserved",
]

/** The built-in status a unit is driven to when a booking is created. */

export const BOOKED_UNIT_STATUS_KEY = "booked"

/** The built-in status a unit is returned to when its booking is cancelled. */

export const AVAILABLE_UNIT_STATUS_KEY = "available"
