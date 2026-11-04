/**
 * The vocabulary of a booking's payment plan, shared by the server and the client.
 *
 * A plan is the schedule a confirmed booking is financed on: a down payment, a run
 * of installments at a chosen frequency, and an optional balloon at the end, with
 * flat charges amortized across the lines. Money is a whole number of the tenant's
 * major currency unit exactly as everywhere else in the platform, and the split reuses
 * the quotation's remainder distribution so the pieces always sum to the whole.
 *
 * There are two status vocabularies here on purpose, and they are not the same thing:
 * the *stored* status is what the payment trail has recorded (scheduled, partially
 * paid, paid), while the *display* status adds the passage of time (upcoming, due,
 * overdue) that only makes sense against today and so is derived at read time rather
 * than written to the row.
 */

import { UNIT_PRICE_MAX } from "./inventory.ts"

/** How often installments fall due. */

export const FREQUENCIES = ["monthly", "quarterly", "custom"] as const

export type Frequency = typeof FREQUENCIES[number]

export const FREQUENCY_LABELS: Record<Frequency, string> = {
  monthly: "Monthly",

  quarterly: "Quarterly",

  custom: "Custom interval",
}

export function isFrequency(value: unknown): value is Frequency {
  return (
    typeof value === "string" &&
    (FREQUENCIES as readonly string[]).includes(value)
  )
}

/** The role each generated line plays in the schedule. */

export const INSTALLMENT_KINDS = [
  "down_payment",

  "installment",

  "balloon",
] as const

export type InstallmentKind = typeof INSTALLMENT_KINDS[number]

export const INSTALLMENT_KIND_LABELS: Record<InstallmentKind, string> = {
  down_payment: "Down payment",

  installment: "Installment",

  balloon: "Balloon",
}

/**
 * The status written on the row: only what the money trail actually says.
 *
 * `scheduled` is the untouched state; the other two are driven purely by recorded
 * payments against the line's total. Time-based readings are not stored, because a
 * stored "overdue" would go stale the moment the day turns without anyone touching
 * the row.
 */

export const INSTALLMENT_STATUSES = [
  "scheduled",

  "partially_paid",

  "paid",
] as const

export type InstallmentStatus = typeof INSTALLMENT_STATUSES[number]

/**
 * The status a user is shown, once due-date-versus-today is folded in.
 *
 * This is derived at read time, never stored. An unpaid line reads overdue, due, or
 * upcoming by where its due date sits against the tenant's own day; a line with money
 * recorded against it reads by how much of its total has landed.
 */

export const INSTALLMENT_DISPLAY_STATUSES = [
  "upcoming",

  "due",

  "overdue",

  "paid",

  "partially_paid",
] as const

export type InstallmentDisplayStatus = typeof INSTALLMENT_DISPLAY_STATUSES[number]

export const INSTALLMENT_DISPLAY_STATUS_LABELS: Record<InstallmentDisplayStatus, string> =
  {
    upcoming: "Upcoming",

    due: "Due",

    overdue: "Overdue",

    paid: "Paid",

    partially_paid: "Partially Paid",
  }

/**
 * How each display status reads on a badge.
 *
 * Amber only for a line that has come due and stands unpaid — the one genuinely
 * waiting state. Muted red is reserved for overdue, the design system's single
 * alarm. Green is a line fully paid; blue distinguishes a partly-paid line from a
 * scheduled one without implying anything is late; an upcoming line stays quiet.
 */

export const INSTALLMENT_DISPLAY_STATUS_TONES: Record<InstallmentDisplayStatus, "outline" | "pending" | "danger" | "success" | "info"> =
  {
    upcoming: "outline",

    due: "pending",

    overdue: "danger",

    paid: "success",

    partially_paid: "info",
  }

/**
 * Bounds the builder and the server agree on; anything else is refused twice.
 *
 * The net amount, charges, and balloon share the platform's money ceiling, so a plan
 * can never be written for more than the largest price the schema stores. The
 * installment count runs wide enough for a long-dated payment schedule but stays a
 * whole number, and a custom interval is capped at a year so a mistyped step cannot
 * push a due date into the next century.
 */

export const PLAN_NET_MIN = 0

export const PLAN_NET_MAX = UNIT_PRICE_MAX

export const PLAN_CHARGES_MIN = 0

export const PLAN_CHARGES_MAX = UNIT_PRICE_MAX

export const DOWN_PAYMENT_PERCENT_MIN = 0

export const DOWN_PAYMENT_PERCENT_MAX = 100

export const INSTALLMENT_MIN = 1

export const INSTALLMENT_MAX = 360

export const BALLOON_MIN = 0

export const BALLOON_MAX = UNIT_PRICE_MAX

export const CUSTOM_INTERVAL_DAYS_MIN = 1

export const CUSTOM_INTERVAL_DAYS_MAX = 365

export const PLAN_NOTES_MAX = 1000
