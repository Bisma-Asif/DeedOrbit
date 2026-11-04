/**
 * Money logic tests.
 *
 * Two layers, as requested:
 *
 *   1. Pure unit tests of the shared schedule builder (`buildPaymentSchedule`)
 *      prove the arithmetic in isolation — installment generation, the whole-
 *      integer remainder split, down-payment and charge rounding, month-end and
 *      leap-year date clamping, and the zero-amount edge — with no server or
 *      database in the way.
 *
 *   2. HTTP integration tests drive the real finance routes to prove the same
 *      numbers survive a round trip: partial and advance allocation, the
 *      over-payment and zero-amount guards, the late-fee basis-point rounding
 *      and grace-period boundary, the cancellation charge-and-refund ladder, the
 *      refund bounded by the un-refunded payment remainder, and the customer
 *      ledger's running balance.
 *
 * Nothing here changes app behaviour; it only asserts the contract the code
 * already documents. Where the code contradicts its own documentation, a test
 * below says so and the fix follows.
 */

import { test, before, after } from "node:test"

import assert from "node:assert/strict"

import {
  addDaysUTC,
  addMonthsUTC,
  buildPaymentSchedule,
  scheduleEndDate,
} from "../shared/payment-plan-schedule.ts"

import {
  bootstrap,
  call,
  get,
  makePlannedBooking,
  readLedger,
  run,
  signIn,
} from "./test-harness.ts"

import type { CallResult, CookieJar, Json } from "./test-harness.ts"

let close: () => void

before(async () => {
  close = (await bootstrap()).close
})

after(() => {
  close?.()
})

/**
 * A `YYYY-MM-DD` UTC string for N days before today. Used to place an
 * installment due date a controlled number of days in the past, so a
 * grace-period boundary can be exercised within the 0..365 day cap.
 */

function daysAgo(n: number): string {
  const stamp = new Date()

  stamp.setUTCDate(stamp.getUTCDate() - n)

  return stamp.toISOString().slice(0, 10)
}

// ---------------------------------------------------------------------------

// 1. Installment generation — the shared schedule builder

// ---------------------------------------------------------------------------

test("installment amounts split the financed balance exactly, remainder to the front", () => {
  const lines = buildPaymentSchedule({
    netAmount: 1_000_000,

    downPaymentPercent: 0,

    charges: 0,

    frequency: "monthly",

    customIntervalDays: null,

    installmentCount: 3,

    balloonAmount: 0,

    startDate: "2026-01-31",
  })

  const amounts = lines.map((line) => line.amount)

  // 1_000_000 / 3 = 333_333 remainder 1, so the first line carries the extra unit.

  assert.deepEqual(amounts, [333_334, 333_333, 333_333])

  assert.equal(
    amounts.reduce((sum, each) => sum + each, 0),

    1_000_000,
  )
})

test("the schedule always sums to net plus charges — no rounding drift", () => {
  const configs = [
    { net: 900_000, down: 10, charges: 0, count: 3, balloon: 0 },

    { net: 1_000_001, down: 7, charges: 13, count: 6, balloon: 5_000 },

    { net: 123_456, down: 33, charges: 999, count: 5, balloon: 1 },

    { net: 1, down: 0, charges: 0, count: 1, balloon: 0 },

    { net: 100_000, down: 100, charges: 2_500, count: 4, balloon: 0 },
  ]

  for (const config of configs) {
    const lines = buildPaymentSchedule({
      netAmount: config.net,

      downPaymentPercent: config.down,

      charges: config.charges,

      frequency: "monthly",

      customIntervalDays: null,

      installmentCount: config.count,

      balloonAmount: config.balloon,

      startDate: "2026-03-15",
    })

    const total = lines.reduce((sum, line) => sum + line.total, 0)

    assert.equal(
      total,

      config.net + config.charges,

      `net ${config.net} + charges ${config.charges}`,
    )
  }
})

test("charges amortize across installment lines, remainder to the front", () => {
  const lines = buildPaymentSchedule({
    netAmount: 300_000,

    downPaymentPercent: 0,

    charges: 100,

    frequency: "monthly",

    customIntervalDays: null,

    installmentCount: 3,

    balloonAmount: 0,

    startDate: "2026-01-05",
  })

  // 100 / 3 = 33 remainder 1 → the first installment carries 34, the rest 33.

  assert.deepEqual(
    lines.map((line) => line.charges),

    [34, 33, 33],
  )

  assert.equal(
    lines.reduce((sum, line) => sum + line.charges, 0),

    100,
  )
})

test("the down payment is a rounded percent and becomes the first line", () => {
  const lines = buildPaymentSchedule({
    netAmount: 900_000,

    downPaymentPercent: 10,

    charges: 0,

    frequency: "monthly",

    customIntervalDays: null,

    installmentCount: 3,

    balloonAmount: 0,

    startDate: "2026-02-10",
  })

  assert.equal(lines[0].kind, "down_payment")

  assert.equal(lines[0].amount, 90_000)

  assert.equal(lines[0].dueDate, "2026-02-10")

  // The financed balance (net - down) splits over the three installments.

  assert.deepEqual(
    lines

      .filter((line) => line.kind === "installment")

      .map((line) => line.amount),

    [270_000, 270_000, 270_000],
  )
})

test("a zero down payment and a zero balloon produce no line", () => {
  const lines = buildPaymentSchedule({
    netAmount: 100_000,

    downPaymentPercent: 0,

    charges: 0,

    frequency: "monthly",

    customIntervalDays: null,

    installmentCount: 2,

    balloonAmount: 0,

    startDate: "2026-01-01",
  })

  assert.equal(
    lines.some((line) => line.kind === "down_payment"),

    false,
  )

  assert.equal(
    lines.some((line) => line.kind === "balloon"),
    false,
  )

  // Only the two installments remain, numbered compactly from one.

  assert.deepEqual(
    lines.map((line) => line.number),

    [1, 2],
  )
})

test("a balloon closes the schedule with its own figure", () => {
  const lines = buildPaymentSchedule({
    netAmount: 100_000,

    downPaymentPercent: 0,

    charges: 0,

    frequency: "monthly",

    customIntervalDays: null,

    installmentCount: 2,

    balloonAmount: 40_000,

    startDate: "2026-01-01",
  })

  const balloon = lines.find((line) => line.kind === "balloon")

  assert.ok(balloon)

  assert.equal(balloon.amount, 40_000)

  // Financed = 100_000 - 0 - 40_000 = 60_000 across two installments.

  assert.deepEqual(
    lines

      .filter((line) => line.kind === "installment")

      .map((line) => line.amount),

    [30_000, 30_000],
  )

  assert.equal(
    lines.reduce((sum, line) => sum + line.total, 0),

    100_000,
  )
})

// ---------------------------------------------------------------------------

// Date stepping — month-end clamping, leap years, custom intervals

// ---------------------------------------------------------------------------

test("monthly steps clamp to the last day of a shorter month", () => {
  // 31 January stepping monthly must land in February, not roll into March.

  assert.equal(addMonthsUTC("2024-01-31", 1), "2024-02-29") // leap year

  assert.equal(addMonthsUTC("2023-01-31", 1), "2023-02-28") // common year

  assert.equal(addMonthsUTC("2024-01-31", 3), "2024-04-30") // April has 30
})

test("a leap-day anniversary is preserved into a month that has the day", () => {
  const lines = buildPaymentSchedule({
    netAmount: 300_000,

    downPaymentPercent: 0,

    charges: 0,

    frequency: "monthly",

    customIntervalDays: null,

    installmentCount: 3,

    balloonAmount: 0,

    startDate: "2024-02-29",
  })

  assert.deepEqual(
    lines.map((line) => line.dueDate),

    ["2024-03-29", "2024-04-29", "2024-05-29"],
  )
})

test("quarterly steps advance three months at a time", () => {
  const lines = buildPaymentSchedule({
    netAmount: 300_000,

    downPaymentPercent: 0,

    charges: 0,

    frequency: "quarterly",

    customIntervalDays: null,

    installmentCount: 3,

    balloonAmount: 0,

    startDate: "2026-01-15",
  })

  assert.deepEqual(
    lines.map((line) => line.dueDate),

    ["2026-04-15", "2026-07-15", "2026-10-15"],
  )
})

test("custom frequency steps by a fixed day count", () => {
  const lines = buildPaymentSchedule({
    netAmount: 200_000,

    downPaymentPercent: 0,

    charges: 0,

    frequency: "custom",

    customIntervalDays: 7,

    installmentCount: 2,

    balloonAmount: 0,

    startDate: "2024-02-29",
  })

  assert.deepEqual(
    lines.map((line) => line.dueDate),

    ["2024-03-07", "2024-03-14"],
  )
})

test("day stepping crosses month and year boundaries in UTC", () => {
  assert.equal(addDaysUTC("2023-12-31", 1), "2024-01-01")

  assert.equal(addDaysUTC("2024-02-28", 1), "2024-02-29")

  assert.equal(addDaysUTC("2026-01-31", 1), "2026-02-01")
})

test("scheduleEndDate reports the latest due date", () => {
  const lines = buildPaymentSchedule({
    netAmount: 100_000,

    downPaymentPercent: 25,

    charges: 0,

    frequency: "monthly",

    customIntervalDays: null,

    installmentCount: 2,

    balloonAmount: 0,

    startDate: "2026-01-01",
  })

  // Down payment sits on 2026-01-01; installments land 02-01 and 03-01.

  assert.equal(scheduleEndDate(lines), "2026-03-01")
})

test("a one-cent net still produces exactly one whole-unit line", () => {
  const lines = buildPaymentSchedule({
    netAmount: 1,

    downPaymentPercent: 0,

    charges: 0,

    frequency: "monthly",

    customIntervalDays: null,

    installmentCount: 1,

    balloonAmount: 0,

    startDate: "2026-06-01",
  })

  assert.equal(lines.length, 1)

  assert.equal(lines[0].total, 1)
})

// ---------------------------------------------------------------------------

// 2. Allocation — partial, advance, and the guards

// ---------------------------------------------------------------------------

async function pay(
  cookies: CookieJar,

  body: Record<string, unknown>,
): Promise<CallResult> {
  return await call(cookies, "POST", "/api/payments", body)
}

test("a partial payment marks the line partially paid and drops the balance", async () => {
  const { cookies: owner } = await signIn("owner@deedorbit.com")

  const planned = await makePlannedBooking(owner, {
    name: "Partial Allocation Plot",

    code: "M-9001",

    phone: "+9715090010001",

    plan: {
      netAmount: 100_000,

      downPaymentPercent: 0,

      charges: 0,

      frequency: "monthly",

      installmentCount: 1,

      balloonAmount: 0,

      startDate: "2030-01-15",
    },
  })

  const line = planned.installments[0]

  const result = await pay(owner, {
    customerId: planned.customerId,

    method: "bank",

    amount: 40_000,

    allocations: [{ installmentId: line.id, amount: 40_000 }],

    receivedAt: "2026-01-10",
  })

  assert.equal(result.status, 200, JSON.stringify(result.body))

  assert.equal(result.body.payment.amount, 40_000)

  const open = await call(
    owner,

    "GET",

    `/api/customers/${planned.customerId}/open-installments`,
  )

  assert.equal(open.status, 200, JSON.stringify(open.body))

  const seen = (open.body.installments as Json[]).find(
    (each) => each.id === line.id,
  )

  assert.ok(seen, "the paid line still shows as open while a balance remains")

  assert.equal(seen.remaining, 60_000)
})

test("allocating to a line that is not yet due is a legal advance and closes it", async () => {
  const { cookies: owner } = await signIn("owner@deedorbit.com")

  // A start date far in the future means every installment is not yet due.

  const planned = await makePlannedBooking(owner, {
    name: "Advance Payment Plot",

    code: "M-9002",

    phone: "+9715090010002",

    plan: {
      netAmount: 50_000,

      downPaymentPercent: 0,

      charges: 0,

      frequency: "monthly",

      installmentCount: 2,

      balloonAmount: 0,

      startDate: "2031-01-15",
    },
  })

  const first = planned.installments[0]

  const result = await pay(owner, {
    customerId: planned.customerId,

    method: "cash",

    amount: first.total,

    allocations: [{ installmentId: first.id, amount: first.total }],
  })

  assert.equal(result.status, 200, JSON.stringify(result.body))

  const open = await call(
    owner,

    "GET",

    `/api/customers/${planned.customerId}/open-installments`,
  )

  // A fully paid line leaves the open list.

  const stillOpen = (open.body.installments as Json[]).some(
    (each) => each.id === first.id,
  )

  assert.equal(stillOpen, false)
})

test("one payment split across several installments allocates each line", async () => {
  const { cookies: owner } = await signIn("owner@deedorbit.com")

  const planned = await makePlannedBooking(owner, {
    name: "Split Allocation Plot",

    code: "M-9003",

    phone: "+9715090010003",

    plan: {
      netAmount: 90_000,

      downPaymentPercent: 0,

      charges: 0,

      frequency: "monthly",

      installmentCount: 3,

      balloonAmount: 0,

      startDate: "2032-01-15",
    },
  })

  const [a, b] = planned.installments

  const result = await pay(owner, {
    customerId: planned.customerId,

    method: "online",

    amount: 30_000,

    allocations: [
      { installmentId: a.id, amount: 20_000 },

      { installmentId: b.id, amount: 10_000 },
    ],
  })

  assert.equal(result.status, 200, JSON.stringify(result.body))

  const open = await call(
    owner,

    "GET",

    `/api/customers/${planned.customerId}/open-installments`,
  )

  const remainingOf = (id: string): number | undefined =>
    (open.body.installments as Json[]).find((each) => each.id === id)?.remaining

  assert.equal(remainingOf(a.id), 10_000)

  assert.equal(remainingOf(b.id), 20_000)
})

test("allocating beyond a line's remaining balance is refused", async () => {
  const { cookies: owner } = await signIn("owner@deedorbit.com")

  const planned = await makePlannedBooking(owner, {
    name: "Overpay Guard Plot",

    code: "M-9004",

    phone: "+9715090010004",

    plan: {
      netAmount: 50_000,

      downPaymentPercent: 0,

      charges: 0,

      frequency: "monthly",

      installmentCount: 1,

      balloonAmount: 0,

      startDate: "2033-01-15",
    },
  })

  const line = planned.installments[0]

  const over = await pay(owner, {
    customerId: planned.customerId,

    method: "cash",

    amount: line.total + 1,

    allocations: [{ installmentId: line.id, amount: line.total + 1 }],
  })

  assert.equal(over.status, 400)
})

test("an allocation total that does not match the payment amount is refused", async () => {
  const { cookies: owner } = await signIn("owner@deedorbit.com")

  const planned = await makePlannedBooking(owner, {
    name: "Mismatch Guard Plot",

    code: "M-9005",

    phone: "+9715090010005",

    plan: {
      netAmount: 50_000,

      downPaymentPercent: 0,

      charges: 0,

      frequency: "monthly",

      installmentCount: 2,

      balloonAmount: 0,

      startDate: "2034-01-15",
    },
  })

  const result = await pay(owner, {
    customerId: planned.customerId,

    method: "cash",

    amount: 20_000,

    allocations: [
      { installmentId: planned.installments[0].id, amount: 15_000 },
    ],
  })

  assert.equal(result.status, 400)
})

test("a zero or negative allocation, and a zero payment, are refused", async () => {
  const { cookies: owner } = await signIn("owner@deedorbit.com")

  const planned = await makePlannedBooking(owner, {
    name: "Zero Guard Plot",

    code: "M-9006",

    phone: "+9715090010006",

    plan: {
      netAmount: 50_000,

      downPaymentPercent: 0,

      charges: 0,

      frequency: "monthly",

      installmentCount: 1,

      balloonAmount: 0,

      startDate: "2035-01-15",
    },
  })

  const line = planned.installments[0]

  const zeroAllocation = await pay(owner, {
    customerId: planned.customerId,

    method: "cash",

    amount: 0,

    allocations: [{ installmentId: line.id, amount: 0 }],
  })

  assert.equal(zeroAllocation.status, 400)

  const negativeAllocation = await pay(owner, {
    customerId: planned.customerId,

    method: "cash",

    amount: -100,

    allocations: [{ installmentId: line.id, amount: -100 }],
  })

  assert.equal(negativeAllocation.status, 400)
})

// ---------------------------------------------------------------------------

// Late fees — basis-point rounding, grace-period boundary, zero fee

// ---------------------------------------------------------------------------

async function setLateFees(
  cookies: CookieJar,

  rule: Record<string, unknown>,
): Promise<void> {
  const result = await call(cookies, "PATCH", "/api/settings/late-fees", rule)

  assert.equal(result.status, 200, JSON.stringify(result.body))
}

async function triggerSweep(cookies: CookieJar): Promise<void> {
  // The overdue read runs the assessment sweep before it returns the table.

  await call(cookies, "GET", "/api/collections/overdue")
}

test("a percentage late fee rounds the basis-point slice of the outstanding balance", async () => {
  const { cookies: owner } = await signIn("owner@deedorbit.com")

  // One line, dated in the past so it is overdue on any real today.

  const planned = await makePlannedBooking(owner, {
    name: "Late Fee Percent Plot",

    code: "M-9007",

    phone: "+9715090010007",

    plan: {
      netAmount: 100_000,

      downPaymentPercent: 0,

      charges: 0,

      frequency: "monthly",

      installmentCount: 1,

      balloonAmount: 0,

      startDate: "2020-01-15",
    },
  })

  await setLateFees(owner, {
    enabled: true,

    mode: "percent",

    amount: 0,

    percentBps: 150, // 1.5%

    graceDays: 0,

    maxAssessments: 1,
  })

  await triggerSweep(owner)

  const entries = await readLedger(owner, planned.customerId)

  const fee = entries.filter((entry) => entry.kind === "late_fee")

  assert.equal(
    fee.length,
    1,
    "exactly one fee lands on the single overdue line",
  )

  // round(100_000 * 150 / 10_000) = 1_500

  assert.equal(fee[0].amount, 1_500)

  await setLateFees(owner, {
    enabled: false,

    mode: "fixed",

    amount: 0,

    percentBps: 0,

    graceDays: 0,

    maxAssessments: 0,
  })
})

test("the grace period holds a fee back until enough days have passed", async () => {
  const { cookies: owner } = await signIn("owner@deedorbit.com")

  const planned = await makePlannedBooking(owner, {
    name: "Late Fee Grace Plot",

    code: "M-9008",

    phone: "+9715090010008",

    plan: {
      netAmount: 80_000,

      downPaymentPercent: 0,

      charges: 0,

      frequency: "custom",

      customIntervalDays: 1,

      installmentCount: 1,

      balloonAmount: 0,

      // With a one-day custom step the single installment falls due the day

      // after the start, so it sits ~ten days in the past.

      startDate: daysAgo(11),
    },
  })

  // A grace period of fifteen days is longer than the ~ten days the line is

  // overdue, so the sweep must skip it entirely.

  await setLateFees(owner, {
    enabled: true,

    mode: "fixed",

    amount: 500,

    percentBps: 0,

    graceDays: 15,

    maxAssessments: 1,
  })

  await triggerSweep(owner)

  const withinGrace = await readLedger(owner, planned.customerId)

  assert.equal(
    withinGrace.some((entry) => entry.kind === "late_fee"),

    false,

    "no fee while past-due is under the grace period",
  )

  // With a five-day grace (shorter than the ~ten days past due), the same

  // overdue line is charged the flat amount.

  await setLateFees(owner, {
    enabled: true,

    mode: "fixed",

    amount: 500,

    percentBps: 0,

    graceDays: 5,

    maxAssessments: 1,
  })

  await triggerSweep(owner)

  const pastGrace = await readLedger(owner, planned.customerId)

  const fee = pastGrace.find((entry) => entry.kind === "late_fee")

  assert.ok(fee, "the flat fee is assessed once the grace clears")

  assert.equal(fee.amount, 500)

  await setLateFees(owner, {
    enabled: false,

    mode: "fixed",

    amount: 0,

    percentBps: 0,

    graceDays: 0,

    maxAssessments: 0,
  })
})

test("a percentage so small it rounds to zero assesses no fee", async () => {
  const { cookies: owner } = await signIn("owner@deedorbit.com")

  const planned = await makePlannedBooking(owner, {
    name: "Late Fee Rounding Zero Plot",

    code: "M-9009",

    phone: "+9715090010009",

    plan: {
      netAmount: 1,

      downPaymentPercent: 0,

      charges: 0,

      frequency: "monthly",

      installmentCount: 1,

      balloonAmount: 0,

      startDate: "2020-01-15",
    },
  })

  // round(1 * 1 / 10_000) = 0, and a zero fee is never written.

  await setLateFees(owner, {
    enabled: true,

    mode: "percent",

    amount: 0,

    percentBps: 1,

    graceDays: 0,

    maxAssessments: 0,
  })

  await triggerSweep(owner)

  const entries = await readLedger(owner, planned.customerId)

  assert.equal(
    entries.some((entry) => entry.kind === "late_fee"),

    false,
  )

  await setLateFees(owner, {
    enabled: false,

    mode: "fixed",

    amount: 0,

    percentBps: 0,

    graceDays: 0,

    maxAssessments: 0,
  })
})

test("a zero max-assessments rule re-charges a line without limit, as documented", async () => {
  const { cookies: owner } = await signIn("owner@deedorbit.com")

  const planned = await makePlannedBooking(owner, {
    name: "Late Fee Unlimited Plot",

    code: "M-9014",

    phone: "+9715090010014",

    plan: {
      netAmount: 60_000,

      downPaymentPercent: 0,

      charges: 0,

      frequency: "monthly",

      installmentCount: 1,

      balloonAmount: 0,

      startDate: "2020-01-15",
    },
  })

  const countAssessments = () =>
    get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM late_fee_assessments WHERE customer_id = ?`,

      planned.customerId,
    )?.n ?? 0

  // The rules surface documents 0 as "unlimited per installment". A fixed 400 fee with no
  // grace charges the single overdue line, and a zero cap must never stop it being charged
  // again on a later day.

  await setLateFees(owner, {
    enabled: true,

    mode: "fixed",

    amount: 400,

    percentBps: 0,

    graceDays: 0,

    maxAssessments: 0,
  })

  await triggerSweep(owner)

  assert.equal(
    countAssessments(),
    1,
    "the first sweep charges the overdue line",
  )

  // Backdate that assessment off the tenant's today so the same-day idempotency guard no
  // longer masks the cap: a later sweep is now free to re-charge the line if it is unlimited.

  run(
    `UPDATE late_fee_assessments SET assessed_at = ? WHERE customer_id = ?`,

    "2020-06-01T00:00:00.000Z",

    planned.customerId,
  )

  await triggerSweep(owner)

  assert.equal(
    countAssessments(),

    2,

    "an unlimited (0) rule re-charges the same line on a later day",
  )

  await setLateFees(owner, {
    enabled: false,

    mode: "fixed",

    amount: 0,

    percentBps: 0,

    graceDays: 0,

    maxAssessments: 0,
  })
})

// ---------------------------------------------------------------------------

// Cancellation — charge and refund ladder under tenant rules

// ---------------------------------------------------------------------------

async function setCancellationRules(
  cookies: CookieJar,

  rule: Record<string, unknown>,
): Promise<void> {
  const result = await call(
    cookies,

    "PATCH",

    "/api/settings/cancellation-rules",

    rule,
  )

  assert.equal(result.status, 200, JSON.stringify(result.body))
}

async function preview(cookies: CookieJar, bookingId: string): Promise<Json> {
  const result = await call(
    cookies,

    "GET",

    `/api/bookings/${bookingId}/cancellation-preview`,
  )

  assert.equal(result.status, 200, JSON.stringify(result.body))

  return result.body
}

test("an untouched workspace cancels with no charge and no refund", async () => {
  const { cookies: owner } = await signIn("owner@deedorbit.com")

  const planned = await makePlannedBooking(owner, {
    name: "Cancellation Baseline Plot",

    code: "M-9010",

    phone: "+9715090010010",

    plan: {
      netAmount: 100_000,

      downPaymentPercent: 0,

      charges: 0,

      frequency: "monthly",

      installmentCount: 2,

      balloonAmount: 0,

      startDate: "2036-01-15",
    },
  })

  // No rule row: the preview reports hasRules false and no money moves.

  const before = await preview(owner, planned.bookingId)

  assert.equal(before.hasRules, false)

  assert.equal(before.chargeAmount, 0)

  assert.equal(before.refundAmount, 0)

  // Configure a rule, then pay, then measure the ladder.

  await setCancellationRules(owner, {
    enabled: true,

    mode: "percent",

    amount: 0,

    percentBps: 2_000, // 20%

    capAmount: 0,

    unitOutcome: "available",
  })

  await pay(owner, {
    customerId: planned.customerId,

    method: "bank",

    amount: 40_000,

    allocations: [
      { installmentId: planned.installments[0].id, amount: 40_000 },
    ],
  })

  const after = await preview(owner, planned.bookingId)

  assert.equal(after.paidAmount, 40_000)

  assert.equal(after.chargeAmount, 8_000) // round(40_000 * 2000 / 10_000)

  assert.equal(after.refundAmount, 32_000)
})

test("the cancellation charge honours its cap and is clamped to what was paid", async () => {
  const { cookies: owner } = await signIn("owner@deedorbit.com")

  const planned = await makePlannedBooking(owner, {
    name: "Cancellation Cap Plot",

    code: "M-9011",

    phone: "+9715090010011",

    plan: {
      netAmount: 100_000,

      downPaymentPercent: 0,

      charges: 0,

      frequency: "monthly",

      installmentCount: 2,

      balloonAmount: 0,

      startDate: "2037-01-15",
    },
  })

  await setCancellationRules(owner, {
    enabled: true,

    mode: "percent",

    amount: 0,

    percentBps: 5_000, // 50%

    capAmount: 10_000,

    unitOutcome: "available",
  })

  await pay(owner, {
    customerId: planned.customerId,

    method: "bank",

    amount: 40_000,

    allocations: [
      { installmentId: planned.installments[0].id, amount: 40_000 },
    ],
  })

  // 50% of 40_000 is 20_000, but the cap holds it at 10_000.

  const capped = await preview(owner, planned.bookingId)

  assert.equal(capped.chargeAmount, 10_000)

  assert.equal(capped.refundAmount, 30_000)

  // A flat charge larger than what was paid is clamped down to the paid amount,

  // leaving nothing to refund.

  await setCancellationRules(owner, {
    enabled: true,

    mode: "fixed",

    amount: 999_999,

    percentBps: 0,

    capAmount: 0,

    unitOutcome: "blocked",
  })

  const clamped = await preview(owner, planned.bookingId)

  assert.equal(clamped.chargeAmount, 40_000)

  assert.equal(clamped.refundAmount, 0)
})

// ---------------------------------------------------------------------------

// Refunds — bounded by the un-refunded remainder of the referenced payment

// ---------------------------------------------------------------------------

test("a refund cannot exceed what the referenced payment still has un-refunded", async () => {
  const { cookies: owner } = await signIn("owner@deedorbit.com")

  const planned = await makePlannedBooking(owner, {
    name: "Refund Bound Plot",

    code: "M-9012",

    phone: "+9715090010012",

    plan: {
      netAmount: 100_000,

      downPaymentPercent: 0,

      charges: 0,

      frequency: "monthly",

      installmentCount: 2,

      balloonAmount: 0,

      startDate: "2038-01-15",
    },
  })

  const payment = await pay(owner, {
    customerId: planned.customerId,

    method: "bank",

    amount: 50_000,

    allocations: [
      { installmentId: planned.installments[0].id, amount: 50_000 },
    ],
  })

  assert.equal(payment.status, 200, JSON.stringify(payment.body))

  const paymentId = payment.body.payment.id as string

  const tooMuch = await call(owner, "POST", "/api/refunds", {
    customerId: planned.customerId,

    paymentId,

    amount: 60_000,

    reason: "Over the receipt.",
  })

  assert.equal(tooMuch.status, 400)

  // The first, in-bounds request is accepted and held for approval.

  const held = await call(owner, "POST", "/api/refunds", {
    customerId: planned.customerId,

    paymentId,

    amount: 50_000,

    reason: "Full reversal.",
  })

  assert.equal(held.status, 200, JSON.stringify(held.body))

  assert.equal(held.body.pending, true)

  assert.equal(held.body.refund.status, "pending")

  // A second request now exceeds what remains un-refunded on the payment.

  const second = await call(owner, "POST", "/api/refunds", {
    customerId: planned.customerId,

    paymentId,

    amount: 1,

    reason: "Nothing left to refund.",
  })

  assert.equal(second.status, 400)
})

// ---------------------------------------------------------------------------

// Customer ledger — the running balance is a signed fold of every event

// ---------------------------------------------------------------------------

test("the ledger running balance folds every signed event in time order", async () => {
  const { cookies: owner } = await signIn("owner@deedorbit.com")

  // One past-due line: a payment reduces what is owed, a late fee adds to it.

  const planned = await makePlannedBooking(owner, {
    name: "Ledger Balance Plot",

    code: "M-9013",

    phone: "+9715090010013",

    plan: {
      netAmount: 100_000,

      downPaymentPercent: 0,

      charges: 0,

      frequency: "monthly",

      installmentCount: 1,

      balloonAmount: 0,

      startDate: "2020-01-15",
    },
  })

  await pay(owner, {
    customerId: planned.customerId,

    method: "bank",

    amount: 40_000,

    allocations: [
      { installmentId: planned.installments[0].id, amount: 40_000 },
    ],

    // Dated in the past so the payment reads before the sweep's fee.

    receivedAt: "2020-06-01",
  })

  await setLateFees(owner, {
    enabled: true,

    mode: "percent",

    amount: 0,

    percentBps: 150, // 1.5% of the 60_000 outstanding = 900

    graceDays: 0,

    maxAssessments: 1,
  })

  await triggerSweep(owner)

  const ledger = await call(
    owner,

    "GET",

    `/api/customers/${planned.customerId}/ledger`,
  )

  assert.equal(ledger.status, 200, JSON.stringify(ledger.body))

  const entries = ledger.body.entries as Json[]

  // The stored running balance must equal a manual signed fold, entry by entry.

  let running = 0

  for (const entry of entries) {
    running += (entry.amount as number)

    assert.equal(entry.balanceAfter, running, `balance after ${entry.kind}`)
  }

  assert.equal(ledger.body.balance, running)

  // Payment -40_000 then late fee +900 leaves the customer owing -39_100.

  assert.equal(entries[0].kind, "payment")

  assert.equal(entries[0].balanceAfter, -40_000)

  assert.equal(entries[entries.length - 1].balanceAfter, -39_100)

  await setLateFees(owner, {
    enabled: false,

    mode: "fixed",

    amount: 0,

    percentBps: 0,

    graceDays: 0,

    maxAssessments: 0,
  })
})
