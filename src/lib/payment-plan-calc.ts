/**
 * The payment plan builder's live preview, driven by the *same* schedule the server
 * writes.
 *
 * This is the client half of `shared/payment-plan-schedule`: rather than mirror the
 * arithmetic (the `quotation-calc` approach), it calls the shared builder directly, so
 * a figure shown in the dialog can never be contradicted by the plan that gets stored.
 * What is added here is only the form layer the server has no reason to know about —
 * string inputs, per-field bounds shared with `@shared/payment-plans`, the one
 * cross-field rule the individual bounds cannot see (a down payment and balloon that
 * together over-cover the net), and the ISO date check.
 *
 * Money is a whole number of the tenant's major currency unit throughout, matching the
 * server's `readBoundedInt`, so a preview never promises a fractional figure the stored
 * plan would round away.
 */

import { formatCurrency } from "@/lib/format"

import {
  BALLOON_MAX,
  BALLOON_MIN,
  CUSTOM_INTERVAL_DAYS_MAX,
  CUSTOM_INTERVAL_DAYS_MIN,
  DOWN_PAYMENT_PERCENT_MAX,
  DOWN_PAYMENT_PERCENT_MIN,
  INSTALLMENT_MAX,
  INSTALLMENT_MIN,
  PLAN_CHARGES_MAX,
  PLAN_NET_MAX,
  PLAN_NOTES_MAX,
  type Frequency,
} from "@shared/payment-plans"

import {
  buildPaymentSchedule,
  scheduleEndDate,
  type PaymentPlanConfig,
  type PaymentScheduleLine,
} from "@shared/payment-plan-schedule"

export type { PaymentPlanConfig, PaymentScheduleLine }

export { buildPaymentSchedule, scheduleEndDate }

/** What the dialog collects. Numbers stay strings because inputs hand strings over. */

export interface PaymentPlanFormState {
  downPaymentPercent: string

  charges: string

  frequency: Frequency

  customIntervalDays: string

  installmentCount: string

  balloonAmount: string

  startDate: string

  notes: string
}

/** A sensible starting plan: a fifth down, a year of monthly installments. */

export function emptyPaymentPlanForm(startDate: string): PaymentPlanFormState {
  return {
    downPaymentPercent: "20",

    charges: "",

    frequency: "monthly",

    customIntervalDays: "",

    installmentCount: "12",

    balloonAmount: "",

    startDate,

    notes: "",
  }
}

/**
 * Parse one numeric field the way the server's `readBoundedInt` does.
 *
 * An empty field falls back — the server substitutes its own default for what is blank,
 * and a blank balloon or charge genuinely means zero — so the preview can show the plan
 * a partial form would produce instead of a wall of errors before the user has finished.
 * A field that is present but not a whole number within bounds is an error, and `null`
 * makes the preview decline to render a figure computed from a guess.
 */

function readWholeNumber(
  raw: string,

  key: string,

  errors: Record<string, string>,

  fallback: number,

  min: number,

  max: number,
): number | null {
  if (raw.trim() === "") return fallback

  const value = Number(raw)

  if (!Number.isSafeInteger(value) || value < min || value > max) {
    errors[key] = `Enter a whole number from ${min} to ${max}.`

    return null
  }

  return value
}

export interface PaymentPlanTotals {
  netAmount: number

  downPayment: number

  financed: number

  balloonAmount: number

  charges: number

  grandTotal: number
}

export interface PaymentPlanPreview {
  /** Per-field messages, in the shape `useSave` expects from the server. */

  errors: Record<string, string>

  /** Null while any field is missing or invalid — the plan the server would accept. */

  config: PaymentPlanConfig | null

  /** The dated lines the preview table shows; empty until `config` is valid. */

  lines: PaymentScheduleLine[]

  totals: PaymentPlanTotals | null

  endDate: string | null
}

/**
 * Validate the whole form and compute the preview in one pass.
 *
 * The net amount comes from the booking rather than the form, so it is a parameter. A
 * preview figure only ever exists for a configuration the server would confirm, which is
 * the difference between a preview and a guess.
 */

export function buildPaymentPlanPreview(
  form: PaymentPlanFormState,

  netAmount: number,
): PaymentPlanPreview {
  const errors: Record<string, string> = {}

  if (
    !Number.isSafeInteger(netAmount) ||
    netAmount < 0 ||
    netAmount > PLAN_NET_MAX
  ) {
    errors.netAmount = `The booking amount must be a whole number from 0 to ${PLAN_NET_MAX}.`
  }

  const downPaymentPercent = readWholeNumber(
    form.downPaymentPercent,

    "downPaymentPercent",

    errors,

    20,

    DOWN_PAYMENT_PERCENT_MIN,

    DOWN_PAYMENT_PERCENT_MAX,
  )

  const charges = readWholeNumber(
    form.charges,

    "charges",

    errors,

    0,

    0,

    PLAN_CHARGES_MAX,
  )

  const installmentCount = readWholeNumber(
    form.installmentCount,

    "installmentCount",

    errors,

    12,

    INSTALLMENT_MIN,

    INSTALLMENT_MAX,
  )

  const balloonAmount = readWholeNumber(
    form.balloonAmount,

    "balloonAmount",

    errors,

    0,

    BALLOON_MIN,

    BALLOON_MAX,
  )

  // A custom interval is required only for the custom frequency; the fixed

  // frequencies derive their step from the calendar and must not carry a stray value.

  let customIntervalDays: number | null = null

  if (form.frequency === "custom") {
    customIntervalDays = readWholeNumber(
      form.customIntervalDays,

      "customIntervalDays",

      errors,

      0,

      CUSTOM_INTERVAL_DAYS_MIN,

      CUSTOM_INTERVAL_DAYS_MAX,
    )
  }

  const startDate = form.startDate.trim()

  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    errors.startDate = "Enter the first due date as YYYY-MM-DD."
  }

  if (form.notes.length > PLAN_NOTES_MAX) {
    errors.notes = `Use ${PLAN_NOTES_MAX.toLocaleString("en-US")} characters or fewer.`
  }

  // The one cross-field rule the individual bounds cannot see: a down payment and a

  // balloon cannot together more than cover the net, or the financed figure the

  // installments split would go negative.

  if (
    errors.netAmount === undefined &&
    downPaymentPercent !== null &&
    balloonAmount !== null
  ) {
    const downPayment = Math.round((netAmount * downPaymentPercent) / 100)

    if (downPayment + balloonAmount > netAmount) {
      errors.balloonAmount =
        "The down payment and balloon together exceed the net amount."
    }
  }

  const invalid =
    Object.keys(errors).length > 0 ||
    downPaymentPercent === null ||
    charges === null ||
    installmentCount === null ||
    balloonAmount === null ||
    (form.frequency === "custom" && customIntervalDays === null)

  if (invalid) {
    return { errors, config: null, lines: [], totals: null, endDate: null }
  }

  const config: PaymentPlanConfig = {
    netAmount,

    downPaymentPercent,

    charges,

    frequency: form.frequency,

    customIntervalDays,

    installmentCount,

    balloonAmount,

    startDate,
  }

  const lines = buildPaymentSchedule(config)

  const downPayment = Math.round((netAmount * downPaymentPercent) / 100)

  const totals: PaymentPlanTotals = {
    netAmount,

    downPayment,

    financed: netAmount - downPayment - balloonAmount,

    balloonAmount,

    charges,

    grandTotal: netAmount + charges,
  }

  return { errors, config, lines, totals, endDate: scheduleEndDate(lines) }
}

/** A preview line's money, formatted for the table in the tenant's currency. */

export function formatPlanMoney(value: number, currency: string): string {
  return formatCurrency(value, currency, { maximumFractionDigits: 0 })
}
