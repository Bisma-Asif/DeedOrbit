/**
 * The dated payment schedule, in one place so the builder's live preview and the
 * server's generated rows are computed identically.
 *
 * This is the same discipline `quotation-calc` applies — money is whole units of the
 * tenant's major currency, the down payment is a rounded percent, and the balance is
 * split across the installments so the first `remainder` lines each carry one extra
 * unit — but here the arithmetic is *literally* shared rather than mirrored, so a
 * preview that showed one figure could never be contradicted by a stored plan that
 * held another. Dates step forward in months (monthly, quarterly) or days (custom),
 * clamped to the last day of a shorter month, and every figure is computed from UTC
 * parts of the `YYYY-MM-DD` string so no host clock or time zone can shift a due date.
 *
 * Charges are a single flat figure, amortized across the installment lines with the
 * same remainder distribution, so the sum of every line's total is exactly the net
 * amount plus the charges — no rounding drift, no invented tax.
 */

import type { Frequency, InstallmentKind } from "./payment-plans.ts"

/** The plan builder's inputs — the configuration a confirmed plan is generated from. */

export interface PaymentPlanConfig {
  netAmount: number

  downPaymentPercent: number

  charges: number

  frequency: Frequency

  /** Months between lines for monthly/quarterly; days between lines for custom. */

  customIntervalDays: number | null

  installmentCount: number

  balloonAmount: number

  startDate: string
}

/** One generated line: the down payment, an installment, or the closing balloon. */

export interface PaymentScheduleLine {
  number: number

  kind: InstallmentKind

  dueDate: string

  amount: number

  charges: number

  total: number
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0")
}

/** Last day of a 1-based month, in a proleptic Gregorian year. */

function daysInMonthUTC(year: number, monthOneBased: number): number {
  return new Date(Date.UTC(year, monthOneBased, 0)).getUTCDate()
}

/**
 * Add a whole number of months to a `YYYY-MM-DD` date, clamping the day to the last
 * valid day of the target month.
 *
 * Clamping is what keeps a plan honest: a schedule starting on 31 January and stepping
 * monthly must land on 28 or 29 February, not silently roll into March the way a raw
 * millisecond addition would.
 */

export function addMonthsUTC(date: string, months: number): string {
  const [year, month, day] = date.split("-").map(Number)

  const totalMonths = month - 1 + months

  const targetYear = year as number + Math.floor(totalMonths / 12)

  const targetMonth = (((totalMonths % 12) + 12) % 12) + 1

  const clampedDay = Math.min(
    day as number,

    daysInMonthUTC(targetYear, targetMonth),
  )

  return `${pad(targetYear, 4)}-${pad(targetMonth, 2)}-${pad(clampedDay, 2)}`
}

/** Add a whole number of days to a `YYYY-MM-DD` date, in UTC. */

export function addDaysUTC(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number)

  const stamp = new Date(
    Date.UTC(year as number, month as number - 1, day as number),
  )

  stamp.setUTCDate(stamp.getUTCDate() + days)

  return `${pad(stamp.getUTCFullYear(), 4)}-${pad(stamp.getUTCMonth() + 1, 2)}-${pad(
    stamp.getUTCDate(),

    2,
  )}`
}

/**
 * The due date `step` intervals after the start, honouring the frequency.
 *
 * Monthly is one month, quarterly three, custom a fixed day count — all measured from
 * the start date rather than chained from the previous line, so a February clamp never
 * cascades a day of drift down the whole schedule.
 */

function stepDate(config: PaymentPlanConfig, step: number): string {
  if (config.frequency === "monthly")
    return addMonthsUTC(config.startDate, step)

  if (config.frequency === "quarterly")
    return addMonthsUTC(config.startDate, step * 3)

  return addDaysUTC(config.startDate, step * (config.customIntervalDays ?? 0))
}

/**
 * Build the full dated schedule from a plan configuration.
 *
 * A zero down payment and a zero balloon produce no line, so the number sequence stays
 * compact and no line sits at total 0 forever. The installment lines always number
 * `installmentCount`, and their amounts plus the amortized charges sum — with the down
 * payment and balloon — to exactly the net amount plus the charges.
 */

export function buildPaymentSchedule(
  config: PaymentPlanConfig,
): PaymentScheduleLine[] {
  const lines: PaymentScheduleLine[] = []

  let number = 0

  const push = (
    kind: InstallmentKind,

    dueDate: string,

    amount: number,

    charges: number,
  ) => {
    number += 1

    lines.push({
      number,
      kind,
      dueDate,
      amount,
      charges,
      total: amount + charges,
    })
  }

  const downPayment = Math.round(
    (config.netAmount * config.downPaymentPercent) / 100,
  )

  if (downPayment > 0) {
    push("down_payment", config.startDate, downPayment, 0)
  }

  const financed = config.netAmount - downPayment - config.balloonAmount

  const base = Math.floor(financed / config.installmentCount)

  const remainder = financed % config.installmentCount

  // The same first-`remainder`-carry-a-unit rule as the amount split, applied to the

  // charges, so both the financed amount and the charges are distributed exactly and

  // independently.

  const chargeBase = Math.floor(config.charges / config.installmentCount)

  const chargeRemainder = config.charges % config.installmentCount

  for (let index = 0; index < config.installmentCount; index += 1) {
    const amount = base + (index < remainder ? 1 : 0)

    const charges = chargeBase + (index < chargeRemainder ? 1 : 0)

    push("installment", stepDate(config, index + 1), amount, charges)
  }

  if (config.balloonAmount > 0) {
    push(
      "balloon",

      stepDate(config, config.installmentCount),

      config.balloonAmount,

      0,
    )
  }

  return lines
}

/** The last line's due date — the day the schedule finishes — for display. */

export function scheduleEndDate(lines: PaymentScheduleLine[]): string | null {
  if (lines.length === 0) return null

  return lines.reduce(
    (latest, line) => (line.dueDate > latest ? line.dueDate : latest),

    lines[0]!.dueDate,
  )
}
