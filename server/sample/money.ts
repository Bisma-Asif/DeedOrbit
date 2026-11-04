/**
 * The money trail for the demo dataset: bookings, the payment plan behind each
 * one, the installments that plan generates, the receipts that pay them, and the
 * exceptions a real recovery book always has — late fees, two waivers, two
 * cancellations, a refund and one transfer.
 *
 * Two rules keep every module telling the same story:
 *
 *  * The schedule comes from `buildPaymentSchedule`, the shared builder the
 *    application itself uses when a plan is confirmed, so the sum of the line
 *    totals is exactly the net amount plus the charges. No rounding drift, so the
 *    receivables on the dashboard and the schedule on the booking screen add up to
 *    the same figure.
 *
 *  * The status stored on an installment says only what the money trail says —
 *    `scheduled`, `partially_paid` or `paid`. Due, upcoming and overdue are read
 *    from the due date against today, exactly as the routes compute them, so the
 *    demo never stores a state that goes stale at midnight.
 *
 * Bookings and units stay in step: the trail appends the `available → booked`
 * move for every booking and the `booked → sold` move for a settled sale, and the
 * two cancelled bookings leave their unit available with the return move recorded.
 */

import { all, run } from "../db.ts"

import {
  dayMinus,
  daysFromToday,
  seqId,
  stamp,
  write,
  type BookingSeed,
  type Demo,
  type UnitSeed,
} from "./common.ts"

import {
  addDaysUTC,
  addMonthsUTC,
  buildPaymentSchedule,
  type PaymentPlanConfig,
} from "../../shared/payment-plan-schedule.ts"

/** The rule the demo workspace charges on a line that has gone past due. */

const LATE_FEE_BPS = 150

const LATE_FEE_GRACE_DAYS = 7

/** The rule the demo workspace applies when a booking is called off. */

const CANCELLATION_BPS = 500

const CANCELLATION_CAP = 50_000

/** How much of the matured book is deliberately left unpaid. */

const OVERDUE_SHARE_TARGET = 0.15

/** One generated installment, in the shape the writers and the checkers share. */

interface Line {
  id: string

  number: number

  kind: string

  dueDate: string

  amount: number

  charges: number

  total: number

  paid: number

  overdue: boolean

  officerUserId: string | null
}

/** A booking plus the plan and schedule that finance it. */

interface Schedule {
  booking: BookingSeed

  planId: string

  config: PaymentPlanConfig

  lines: Line[]

  unit: UnitSeed

  dealerId: string | null

  dealerName: string | null

  quoteId: string | null

  monthsBack: number
}

/** One receipt: a payment header and the lines it was allocated against. */

interface Allocation {
  installmentId: string

  amount: number
}

interface Payment {
  id: string

  bookingId: string

  customerId: string

  amount: number

  method: string

  receipt: string

  receivedAt: string

  recordedByUserId: string

  recordedByName: string

  note: string | null

  allocations: Allocation[]
}

/** A money event waiting to be grouped into a receipt. */

interface MoneyEvent {
  installmentId: string

  amount: number

  at: string

  split: boolean
}

interface LedgerInput {
  customerId: string

  bookingId: string | null

  kind: string

  amount: number

  reference: string | null

  sourceType: string

  sourceId: string

  occurredAt: string

  note: string | null

  recordedByUserId: string

  recordedByName: string
}

/** A late fee once it has been assessed, kept for the waiver and the report. */

interface Fee {
  id: string

  installmentId: string

  customerId: string

  customerName: string

  bookingId: string

  installmentNumber: number

  amount: number

  assessedAt: string
}

/** A booked unit's trail step. */

interface TrailStep {
  from: string | null

  to: string

  source: "manual" | "system"

  actorUserId: string | null

  actorName: string | null

  note: string | null

  at: string
}

/** A quotation the demo can cite as the price a booking was struck at. */

interface QuoteRef {
  id: string

  total: number
}

/** Writes the whole money domain and publishes the bookings it created. */

export function seedMoney(demo: Demo): void {
  seedMoneyConfig(demo)

  const schedules = buildSchedules(demo)

  markPaidAmounts(demo, schedules)

  const payments = writeSales(demo, schedules)

  writeLateFees(demo, schedules)

  cancelTwo(demo, schedules, payments)

  refundOne(demo, schedules, payments)

  transferOne(demo, schedules, payments)
}

/**
 * The late-fee and cancellation rules the money story relies on.
 *
 * Both tables are keyed by tenant and are configuration a user owns in Settings,
 * so they are inserted only when absent and are deliberately *not* registered as
 * demo rows: removing the demo dataset must not quietly switch a workspace's
 * charging rules off. Whether a pre-existing rule was kept is reported instead.
 */

function seedMoneyConfig(demo: Demo): void {
  const updatedAt = stamp(demo.today, 300, 9)

  run(
    `INSERT INTO late_fee_rules (
       tenant_id, enabled, mode, amount, percent_bps, grace_days, max_assessments,
       updated_at
     ) VALUES (?, 1, 'percent', 0, ?, ?, 3, ?)
     ON CONFLICT (tenant_id) DO NOTHING`,

    demo.tenantId,

    LATE_FEE_BPS,

    LATE_FEE_GRACE_DAYS,

    updatedAt,
  )

  run(
    `INSERT INTO cancellation_rules (
       tenant_id, enabled, mode, amount, percent_bps, cap_amount, unit_outcome,
       updated_at
     ) VALUES (?, 1, 'percent', 0, ?, ?, 'available', ?)
     ON CONFLICT (tenant_id) DO NOTHING`,

    demo.tenantId,

    CANCELLATION_BPS,

    CANCELLATION_CAP,

    updatedAt,
  )
}

/**
 * One booking per committed unit, in the order the inventory pool published them.
 *
 * The two units the pool left `available` are the cancellations: they carry a
 * booking that was made and then called off, so they end the run exactly where
 * the sheet says they are — back on the market.
 */

function buildSchedules(demo: Demo): Schedule[] {
  const quotes = quoteByUnit(demo)

  const pool = demo.customers.slice(0, Math.max(0, demo.customers.length - 1))

  const out: Schedule[] = []

  demo.available.forEach((unit, index) => {
    if (pool.length === 0) return

    const cancelled = unit.status === "available"

    const legacy = unit.status === "sold"

    const quote = quotes.get(unit.id) ?? null

    const amount = quote ? Number(quote.total) : unit.price

    const customer = pool[(index * 7 + 3) % pool.length]!

    const agent = demo.agents[index % Math.max(1, demo.agents.length)]

    const viaDealer = !cancelled && index % 5 === 1

    const dealer = viaDealer
      ? demo.dealers[index % Math.max(1, demo.dealers.length)]
      : null

    const monthsBack = legacy
      ? demo.rand.int(5, 11)
      : cancelled
        ? demo.rand.int(2, 8)
        : demo.rand.int(1, 11)

    const bookingDate = saleDate(demo, unit, monthsBack, legacy)

    const booking: BookingSeed = {
      id: seqId(demo, "bok"),

      reference: `AT-BKG-${String(index + 1).padStart(4, "0")}`,

      customerId: customer.id,

      customerName: customer.fullName,

      unitId: unit.id,

      unitCode: unit.code,

      projectId: unit.projectId,

      amount,

      date: bookingDate,

      agentUserId: agent?.userId ?? demo.actorUserId,

      agentName: agent?.fullName ?? demo.actorName,

      status: cancelled ? "cancelled" : "confirmed",

      legacy,
    }

    demo.bookings.push(booking)

    out.push({
      booking,

      planId: seqId(demo, "plan"),

      config: planConfig(demo, bookingDate, amount, legacy, cancelled),

      lines: [],

      unit,

      dealerId: dealer?.id ?? null,

      dealerName: dealer?.name ?? null,

      quoteId: quote?.id ?? null,

      monthsBack,
    })
  })

  for (const schedule of out) {
    let number = 0

    for (const line of buildPaymentSchedule(schedule.config)) {
      number += 1

      schedule.lines.push({
        id: seqId(demo, "inst"),

        number,

        kind: line.kind,

        dueDate: line.dueDate,

        amount: line.amount,

        charges: line.charges,

        total: line.total,

        paid: 0,

        overdue: false,

        officerUserId: null,
      })
    }
  }

  return out
}

/** A `unit_quotations` row, read for the newest quotation per unit. */

interface QuoteRow {
  id: string

  unit_id: string

  total: number
}

/** The latest quotation raised against a unit, so a booking can cite it. */

function quoteByUnit(demo: Demo): Map<string, QuoteRef> {
  const out = new Map<string, QuoteRef>()

  for (const row of all<QuoteRow>(
    `SELECT id, unit_id, total FROM unit_quotations WHERE tenant_id = ?
      ORDER BY quote_number`,

    demo.tenantId,
  )) {
    out.set(row.unit_id, { id: row.id, total: Number(row.total) })
  }

  return out
}

/**
 * The day the booking was struck.
 *
 * Anchored to the same day of the month as today and then nudged, so a monthly
 * schedule keeps a line falling due on the twenty-fifth: that is what puts real
 * rows into the *Due* bucket instead of leaving the board on tomorrow.
 */

function saleDate(
  demo: Demo,

  unit: UnitSeed,

  monthsBack: number,

  legacy: boolean,
): string {
  let day = addMonthsUTC(demo.today, -monthsBack)

  if (!legacy) day = addDaysUTC(day, demo.rand.pick([-9, -6, -3, 0, 0, 4, 8]))

  const published = unit.created.slice(0, 10)

  if (day < published) day = published

  return day > demo.today ? demo.today : day
}

/** The plan configuration: a settled lump sum, or a running instalment schedule. */

function planConfig(
  demo: Demo,

  startDate: string,

  amount: number,

  legacy: boolean,

  cancelled: boolean,
): PaymentPlanConfig {
  if (legacy) {
    return {
      netAmount: amount,

      downPaymentPercent: 0,

      charges: 0,

      frequency: "monthly",

      customIntervalDays: null,

      installmentCount: 1,

      balloonAmount: 0,

      startDate,
    }
  }

  const quarterly = !cancelled && demo.rand.chance(0.3)

  const downPaymentPercent = cancelled ? 25 : demo.rand.pick([20, 25, 30])

  const installmentCount = quarterly
    ? demo.rand.pick([4, 6, 6, 8])
    : demo.rand.pick([6, 12, 12, 18])

  const balloonAmount =
    !quarterly && !cancelled && demo.rand.chance(0.15)
      ? Math.round((amount * 15) / 100)
      : 0

  const charges =
    !cancelled && demo.rand.chance(0.2) ? demo.rand.money(50_000, 200_000) : 0

  return {
    netAmount: amount,

    downPaymentPercent,

    charges,

    frequency: quarterly ? "quarterly" : "monthly",

    customIntervalDays: null,

    installmentCount,

    balloonAmount,

    startDate,
  }
}

/**
 * Decides how much of every line the demo actually collected.
 *
 * A settled sale is fully paid. A running schedule pays everything that fell due
 * before today except a deliberate slice left unpaid, spread so all four aging
 * buckets carry rows; the day's own line is left untouched so it reads *Due*. A
 * cancelled booking keeps its down payment and two installments, which is what
 * the cancellation rules then have to refund.
 */

function markPaidAmounts(demo: Demo, schedules: Schedule[]): void {
  const open = schedules.filter((s) => s.booking.status === "confirmed")

  const confirmedLines = open.reduce((n, s) => n + s.lines.length, 0)

  const matured: Array<MaturedLine> = []

  for (const s of open) {
    for (const line of s.lines) {
      // A down payment is taken before a booking is confirmed, so it is never the

      // line that goes late; the aging book is made of installment lines.

      if (line.dueDate < demo.today && line.kind !== "down_payment") {
        matured.push({ schedule: s, line })
      }
    }
  }

  const stride = bestStride(
    matured,

    Math.round(confirmedLines * OVERDUE_SHARE_TARGET),
  )

  const chosen = pickOverdue(matured, stride, true)

  fillBuckets(demo, matured, chosen)

  const late = new Set(chosen.map((row) => row.line.id))

  for (const s of open) {
    for (const line of s.lines) {
      if (line.dueDate >= demo.today) continue

      if (late.has(line.id)) {
        line.overdue = true

        line.paid = demo.rand.chance(0.3)
          ? Math.round((line.total * demo.rand.int(30, 70)) / 100)
          : 0
      } else {
        line.paid = line.total
      }
    }
  }

  assignOfficers(demo, open, late)

  for (const s of schedules) {
    if (s.booking.status !== "cancelled") continue

    s.lines.forEach((line, position) => {
      line.paid = position < 3 ? line.total : 0
    })
  }

  // Four buyers are ahead of their schedule rather than behind it: an allocation

  // against a line that has not fallen due yet is a legal advance payment.

  const advance = open.filter((s) => !s.booking.legacy).slice(0, 4)

  for (const s of advance) {
    const next = s.lines.find(
      (line) => line.dueDate > demo.today && line.paid === 0,
    )

    if (!next) continue

    next.paid = Math.round((next.total * demo.rand.int(40, 60)) / 100)
  }
}

/** A line that has already fallen due on a running schedule. */

interface MaturedLine {
  schedule: Schedule

  line: Line
}

/**
 * The stride that leaves the open book closest to the share the brief asks for.
 *
 * Taking one line in every `stride` keeps the gaps spread across customers rather
 * than piling them onto one schedule, which is how a real collection book looks.
 */

function bestStride(matured: MaturedLine[], target: number): number {
  let best = 2

  let bestDiff = Number.POSITIVE_INFINITY

  for (let stride = 2; stride <= 9; stride += 1) {
    const diff = Math.abs(pickOverdue(matured, stride, true).length - target)

    if (diff < bestDiff) {
      bestDiff = diff

      best = stride
    }
  }

  return best
}

/** Every `stride`-th matured line, capped at two per booking. */

function pickOverdue(
  matured: MaturedLine[],

  stride: number,

  applyCap: boolean,
): MaturedLine[] {
  const out: MaturedLine[] = []

  const perBooking = new Map<string, number>()

  for (let index = matured.length - 1; index >= 0; index -= stride) {
    const row = matured[index]!

    if (applyCap) {
      const seen = perBooking.get(row.schedule.booking.id) ?? 0

      if (seen >= 2) continue

      perBooking.set(row.schedule.booking.id, seen + 1)
    }

    out.push(row)
  }

  return out
}

/** Makes sure each aging bucket has somebody actually sitting in it. */

function fillBuckets(
  demo: Demo,

  matured: MaturedLine[],

  chosen: MaturedLine[],
): void {
  const picked = new Set(chosen.map((row) => row.line.id))

  for (const [low, high] of [
    [1, 30],

    [31, 60],

    [61, 90],

    [91, 100_000],
  ] as Array<[number, number]>) {
    const inBucket = chosen.filter((row) =>
      withinBucket(demo.today, row.line.dueDate, low, high),
    )

    let wanted = 2 - inBucket.length

    if (wanted <= 0) continue

    for (const row of matured) {
      if (wanted <= 0) break

      if (picked.has(row.line.id)) continue

      if (!withinBucket(demo.today, row.line.dueDate, low, high)) continue

      picked.add(row.line.id)

      chosen.push(row)

      wanted -= 1
    }
  }
}

function withinBucket(
  today: string,

  dueDate: string,

  low: number,

  high: number,
): boolean {
  const days = -daysFromToday(today, dueDate)

  return days >= low && days <= high
}

/** Puts a named recovery officer behind every line that has gone late. */

function assignOfficers(
  demo: Demo,

  open: Schedule[],

  late: Set<string>,
): void {
  const officers = demo.officers

  if (officers.length === 0) return

  let turn = 0

  for (const s of open) {
    for (const line of s.lines) {
      if (!late.has(line.id)) continue

      line.officerUserId = officers[turn % officers.length]?.userId ?? null

      turn += 1
    }
  }
}

/**
 * Writes the bookings, their plans, their schedules and every receipt.
 *
 * The rows go in dependency order — booking, plan, installments, then the money —
 * and each installment is inserted with its final paid amount and status, so no
 * half-written state is ever visible to a reader.
 */

function writeSales(demo: Demo, schedules: Schedule[]): Payment[] {
  const manager = demo.managers[0]

  const accounts = demo.roleUsers.get("accounts_officer")?.[0] ?? null

  const payments: Payment[] = []

  for (const s of schedules) {
    writeBooking(demo, s, manager?.fullName ?? demo.actorName)

    for (const event of receiptEvents(demo, s)) {
      payments.push(writePayment(demo, s, event, accounts))
    }
  }

  return payments
}

/** One booking, its plan, its installment lines and its unit trail. */

function writeBooking(demo: Demo, s: Schedule, handoverName: string): void {
  const b = s.booking

  const created = stamp(demo.today, dayGap(demo, b.date), 11)

  const cancelled = b.status === "cancelled"

  const cancelledAt = cancelled
    ? stamp(demo.today, Math.max(0, dayGap(demo, b.date) - 45), 15)
    : null

  write(demo, "bookings", b.id, () =>
    run(
      `INSERT INTO bookings (
         id, tenant_id, project_id, unit_id, customer_id, quote_id,
         agent_user_id, agent_name, dealer_id, dealer_name, reference, unit_code,
         customer_name, booking_amount, booking_date, status, terms, notes,
         created_by_user_id, created_by_name, cancelled_by_name, cancelled_at,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,

      b.id,

      demo.tenantId,

      b.projectId,

      b.unitId,

      b.customerId,

      s.quoteId,

      b.agentUserId,

      b.agentName,

      s.dealerId,

      s.dealerName,

      b.reference,

      b.unitCode,

      b.customerName,

      b.amount,

      b.date,

      b.status,

      "Booked on the plan confirmed at the site office; possession on full and final payment.",

      cancelled
        ? "Booking called off on the customer's written request."
        : s.booking.legacy
          ? "Lump-sum sale settled in full at the time of booking."
          : null,

      b.agentUserId,

      b.agentName,

      cancelled ? handoverName : null,

      cancelledAt,

      created,

      cancelled ? (cancelledAt ?? created) : created,
    ),
  )

  const c = s.config

  write(demo, "payment_plans", s.planId, () =>
    run(
      `INSERT INTO payment_plans (
         id, tenant_id, booking_id, currency, net_amount, down_payment_percent,
         charges, frequency, custom_interval_days, installment_count,
         balloon_amount, start_date, status, notes, created_by_user_id,
         created_by_name, created_at, confirmed_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, 'confirmed', ?, ?, ?, ?, ?)`,

      s.planId,

      demo.tenantId,

      b.id,

      demo.currency,

      c.netAmount,

      c.downPaymentPercent,

      c.charges,

      c.frequency,

      c.installmentCount,

      c.balloonAmount,

      c.startDate,

      s.booking.legacy
        ? "Full and final settlement against one line."
        : `${
            c.frequency === "quarterly" ? "Quarterly" : "Monthly"
          } plan over ${c.installmentCount} installments.`,

      b.agentUserId,

      b.agentName,

      created,

      created,
    ),
  )

  for (const line of s.lines) {
    write(demo, "payment_installments", line.id, () =>
      run(
        `INSERT INTO payment_installments (
           id, tenant_id, plan_id, booking_id, number, kind, due_date, amount,
           charges, total, paid_amount, status, collection_officer_user_id
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,

        line.id,

        demo.tenantId,

        s.planId,

        b.id,

        line.number,

        line.kind,

        line.dueDate,

        line.amount,

        line.charges,

        line.total,

        line.paid,

        installmentStatus(line),

        line.officerUserId,
      ),
    )
  }

  writeUnitTrail(demo, s, created, cancelledAt, handoverName)
}

/** The stored status: only what the money trail says about the line. */

function installmentStatus(line: Line): string {
  if (line.paid <= 0) return "scheduled"

  return line.paid >= line.total ? "paid" : "partially_paid"
}

/** Whole days from today back to a `YYYY-MM-DD` day. */

function dayGap(demo: Demo, day: string): number {
  return Math.max(0, -daysFromToday(demo.today, day))
}

/** The unit's trail for this booking: booked, then sold, or handed back. */

function writeUnitTrail(
  demo: Demo,

  s: Schedule,

  created: string,

  cancelledAt: string | null,

  handoverName: string,
): void {
  const agent = demo.userNames.get(s.booking.agentUserId) ?? s.booking.agentName

  const steps: TrailStep[] = [
    {
      from: "available",

      to: "booked",

      source: "system",

      actorUserId: null,

      actorName: null,

      note: `Booked via ${s.booking.reference}`,

      at: created,
    },
  ]

  if (s.booking.legacy) {
    steps.push({
      from: "booked",

      to: "sold",

      source: "manual",

      actorUserId: demo.managers[0]?.userId ?? demo.actorUserId,

      actorName: handoverName,

      note: "Full and final payment received; unit handed over.",

      at: stamp(demo.today, Math.max(0, dayGap(demo, s.booking.date) - 30), 12),
    })
  }

  if (cancelledAt) {
    steps.push({
      from: "booked",

      to: "available",

      source: "system",

      actorUserId: null,

      actorName: null,

      note: `Booking ${s.booking.reference} cancelled`,

      at: cancelledAt,
    })
  }

  for (const step of steps) {
    const id = seqId(demo, "hist")

    write(demo, "inventory_unit_status_history", id, () =>
      run(
        `INSERT INTO inventory_unit_status_history (
           id, tenant_id, project_id, unit_id, from_status, to_status,
           changed_by_user_id, changed_by_name, source, note, changed_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,

        id,

        demo.tenantId,

        s.booking.projectId,

        s.booking.unitId,

        step.from,

        step.to,

        step.actorUserId,

        step.actorName ?? agent,

        step.source,

        step.note,

        step.at,
      ),
    )
  }
}

/** The payments this schedule produced, one entry per receipt. */

function receiptEvents(demo: Demo, s: Schedule): MoneyEvent[][] {
  const events: MoneyEvent[] = []

  for (const line of s.lines) {
    if (line.paid <= 0) continue

    const future = line.dueDate > demo.today

    const partial = line.paid < line.total

    const lag = future
      ? 0
      : partial
        ? demo.rand.int(14, 40)
        : demo.rand.int(0, 6)

    let at = future
      ? dayMinus(demo.today, demo.rand.int(1, 14))
      : addDaysUTC(line.dueDate, lag)

    if (at > demo.today) at = demo.today

    events.push({
      installmentId: line.id,

      amount: line.paid,

      at,

      split: partial || future,
    })
  }

  const groups: MoneyEvent[][] = []

  let cursor = 0

  while (cursor < events.length) {
    const head = events[cursor]!

    const size =
      head.split || s.booking.legacy
        ? 1
        : Math.min(demo.rand.int(2, 3), events.length - cursor)

    groups.push(events.slice(cursor, cursor + size))

    cursor += size
  }

  return groups
}

/** One receipt: header, allocations, per-line trail, ledger debit. */

function writePayment(
  demo: Demo,

  s: Schedule,

  group: MoneyEvent[],

  accountsUserId: string | null,
): Payment {
  const id = seqId(demo, "pay")

  const amount = group.reduce((sum, event) => sum + event.amount, 0)

  const receivedAt = group.reduce(
    (latest, event) => (event.at > latest ? event.at : latest),

    group[0]!.at,
  )

  const at = stamp(demo.today, dayGap(demo, receivedAt), 13)

  const method = pickMethod(demo)

  const recorder =
    method === "cash"
      ? { id: s.booking.agentUserId, name: s.booking.agentName }
      : {
          id: accountsUserId ?? demo.actorUserId,

          name:
            (accountsUserId ? demo.userNames.get(accountsUserId) : null) ??
            demo.actorName,
        }

  const receipt = `AT-RCP-${String(++demo.receiptSeq).padStart(4, "0")}`

  const note = demo.rand.chance(0.15)
    ? "Collected at the site office against the signed schedule."
    : null

  write(demo, "payments", id, () =>
    run(
      `INSERT INTO payments (
         id, tenant_id, customer_id, booking_id, currency, method, amount,
         receipt_number, note, recorded_by_user_id, recorded_by_name, received_at,
         created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,

      id,

      demo.tenantId,

      s.booking.customerId,

      s.booking.id,

      demo.currency,

      method,

      amount,

      receipt,

      note,

      recorder.id,

      recorder.name,

      receivedAt,

      at,
    ),
  )

  const allocations: Allocation[] = []

  for (const event of group) {
    const allocationId = seqId(demo, "alloc")

    write(demo, "payment_allocations", allocationId, () =>
      run(
        `INSERT INTO payment_allocations (
           id, tenant_id, payment_id, installment_id, amount, created_at
         ) VALUES (?, ?, ?, ?, ?, ?)`,

        allocationId,

        demo.tenantId,

        id,

        event.installmentId,

        event.amount,

        at,
      ),
    )

    const trailId = seqId(demo, "ipay")

    write(demo, "installment_payments", trailId, () =>
      run(
        `INSERT INTO installment_payments (
           id, tenant_id, installment_id, amount, paid_at, recorded_by_user_id,
           recorded_by_name, payment_id
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,

        trailId,

        demo.tenantId,

        event.installmentId,

        event.amount,

        event.at,

        recorder.id,

        recorder.name,

        id,
      ),
    )

    allocations.push({
      installmentId: event.installmentId,
      amount: event.amount,
    })
  }

  ledger(demo, {
    customerId: s.booking.customerId,

    bookingId: s.booking.id,

    kind: "payment",

    amount: -amount,

    reference: receipt,

    sourceType: "payment",

    sourceId: id,

    occurredAt: receivedAt,

    note: null,

    recordedByUserId: recorder.id,

    recordedByName: recorder.name,
  })

  return {
    id,

    bookingId: s.booking.id,

    customerId: s.booking.customerId,

    amount,

    method,

    receipt,

    receivedAt,

    recordedByUserId: recorder.id,

    recordedByName: recorder.name,

    note,

    allocations,
  }
}

/** Cash, bank transfer or online. The schema has no cheque method, so none is faked. */

function pickMethod(demo: Demo): string {
  const roll = demo.rand.int(1, 10)

  if (roll <= 3) return "cash"

  return roll <= 8 ? "bank" : "online"
}

/** Append one signed row to a customer's ledger. */

function ledger(demo: Demo, entry: LedgerInput): void {
  const id = seqId(demo, "led")

  const at =
    entry.occurredAt.length === 10
      ? stamp(demo.today, dayGap(demo, entry.occurredAt), 12)
      : entry.occurredAt

  write(demo, "customer_ledger_entries", id, () =>
    run(
      `INSERT INTO customer_ledger_entries (
         id, tenant_id, customer_id, booking_id, kind, amount, currency, reference,
         source_type, source_id, occurred_at, note, recorded_by_user_id,
         recorded_by_name, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,

      id,

      demo.tenantId,

      entry.customerId,

      entry.bookingId,

      entry.kind,

      entry.amount,

      demo.currency,

      entry.reference,

      entry.sourceType,

      entry.sourceId,

      entry.occurredAt,

      entry.note,

      entry.recordedByUserId,

      entry.recordedByName,

      at,
    ),
  )

  demo.ledgerRows += 1
}

/**
 * Charges the late lines and waives two of them.
 *
 * The fee follows the rule the workspace was just given — a basis-point slice of
 * what is still outstanding, only after the grace period, and only once per line
 * here. The two waivers carry a reason and an approved sign-off, and the waiver
 * is written as a ledger credit rather than a deletion, so the charge the
 * workspace forgave stays visible.
 */

function writeLateFees(demo: Demo, schedules: Schedule[]): Fee[] {
  const officer = demo.officers[0]

  const fees: Fee[] = []

  for (const s of schedules) {
    if (s.booking.status !== "confirmed") continue

    for (const line of s.lines) {
      if (!line.overdue) continue

      const days = -daysFromToday(demo.today, line.dueDate)

      if (days <= LATE_FEE_GRACE_DAYS) continue

      const remaining = line.total - line.paid

      const amount = Math.round((remaining * LATE_FEE_BPS) / 10_000)

      if (amount <= 0 || !demo.rand.chance(0.6)) continue

      fees.push({
        id: seqId(demo, "fee"),

        installmentId: line.id,

        customerId: s.booking.customerId,

        customerName: s.booking.customerName,

        bookingId: s.booking.id,

        installmentNumber: line.number,

        amount,

        assessedAt: stamp(demo.today, days - LATE_FEE_GRACE_DAYS - 1, 2),
      })
    }
  }

  const waived = fees
    .filter((fee) => daysSinceAssessment(demo, fee) >= 61)
    .slice(0, 2)

  const waiverIds = new Set(waived.map((fee) => fee.id))

  const approver = demo.managers[0]

  for (const fee of fees) {
    const isWaived = waiverIds.has(fee.id)

    let approvalId: string | null = null

    if (isWaived) {
      approvalId = writeApproval(
        demo,

        "late_fee_waiver",

        "approved",

        `Waive ${demo.currency} ${fee.amount} in late charges for ${fee.customerName}`,

        {
          assessmentId: fee.id,

          customerId: fee.customerId,

          customerName: fee.customerName,

          bookingId: fee.bookingId,

          installmentNumber: fee.installmentNumber,

          amount: fee.amount,

          reason:
            WAIVER_REASONS[waived.indexOf(fee) % WAIVER_REASONS.length] ??
            "Bank delay",
        },

        "late_fee_assessment",

        fee.id,

        officer?.userId ?? demo.actorUserId,

        fee.assessedAt,

        {
          userId: approver?.userId ?? demo.actorUserId,

          name: approver?.fullName ?? demo.actorName,

          note: "Forgiven on record; the delay was a bank transfer hold.",

          at: stamp(demo.today, 3, 10),
        },
      )
    }

    const reason = isWaived
      ? (WAIVER_REASONS[waived.indexOf(fee) % WAIVER_REASONS.length] ??
        "Payment held up by the bank")
      : null

    write(demo, "late_fee_assessments", fee.id, () =>
      run(
        `INSERT INTO late_fee_assessments (
           id, tenant_id, installment_id, customer_id, booking_id, amount, status,
           approval_id, reason, assessed_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,

        fee.id,

        demo.tenantId,

        fee.installmentId,

        fee.customerId,

        fee.bookingId,

        fee.amount,

        isWaived ? "waived" : "applied",

        approvalId,

        reason,

        fee.assessedAt,
      ),
    )

    ledger(demo, {
      customerId: fee.customerId,

      bookingId: fee.bookingId,

      kind: "late_fee",

      amount: fee.amount,

      reference: `#${fee.installmentNumber}`,

      sourceType: "late_fee_assessment",

      sourceId: fee.id,

      occurredAt: fee.assessedAt,

      note: "Late fee on an overdue installment",

      recordedByUserId: "system",

      recordedByName: "Late-fee sweep",
    })

    if (!isWaived) continue

    ledger(demo, {
      customerId: fee.customerId,

      bookingId: fee.bookingId,

      kind: "waiver",

      amount: -fee.amount,

      reference: `#${fee.installmentNumber}`,

      sourceType: "late_fee_assessment",

      sourceId: fee.id,

      occurredAt: stamp(demo.today, 3, 10),

      note: reason,

      recordedByUserId: approver?.userId ?? demo.actorUserId,

      recordedByName: approver?.fullName ?? demo.actorName,
    })
  }

  return fees
}

function daysSinceAssessment(demo: Demo, fee: Fee): number {
  return -daysFromToday(demo.today, fee.assessedAt.slice(0, 10))
}

const WAIVER_REASONS = [
  "Bank transfer cleared a week late; the delay was not the customer's",

  "Site office collected the amount in cash but the receipt was entered late",
]

/**
 * Calls two bookings off and moves the money the rules say they are owed.
 *
 * The charge is the capped slice of everything the customer had actually paid,
 * the refund is the remainder, and the unit goes back on the market — which is
 * why the two units carrying these bookings were chosen from the available pool
 * in the first place. The booking row itself already carries the cancellation,
 * so this only writes the two ledger moves the rules produce.
 */

function cancelTwo(
  demo: Demo,

  schedules: Schedule[],

  payments: Payment[],
): void {
  const manager = demo.managers[0]

  const cancelled = schedules.filter((s) => s.booking.status === "cancelled")

  for (const s of cancelled) {
    const paid = payments

      .filter((payment) => payment.bookingId === s.booking.id)

      .reduce((sum, payment) => sum + payment.amount, 0)

    const chargeAmount = Math.min(
      CANCELLATION_CAP,

      Math.round((paid * CANCELLATION_BPS) / 10_000),

      paid,
    )

    const refundAmount = Math.max(0, paid - chargeAmount)

    if (chargeAmount > 0) {
      ledger(demo, {
        customerId: s.booking.customerId,

        bookingId: s.booking.id,

        kind: "cancellation_charge",

        amount: chargeAmount,

        reference: s.booking.reference,

        sourceType: "booking",

        sourceId: s.booking.id,

        occurredAt: s.booking.date,

        note: "Cancellation charge",

        recordedByUserId: manager?.userId ?? demo.actorUserId,

        recordedByName: manager?.fullName ?? demo.actorName,
      })
    }

    if (refundAmount > 0) {
      ledger(demo, {
        customerId: s.booking.customerId,

        bookingId: s.booking.id,

        kind: "cancellation_refund",

        amount: -refundAmount,

        reference: s.booking.reference,

        sourceType: "booking",

        sourceId: s.booking.id,

        occurredAt: s.booking.date,

        note: "Cancellation refund",

        recordedByUserId: manager?.userId ?? demo.actorUserId,

        recordedByName: manager?.fullName ?? demo.actorName,
      })
    }
  }
}

/**
 * One refunded over-collection, complete with the sign-off that released it.
 *
 * The refund unwinds the part of a cancelled booking's money that the workspace
 * had retained as a charge and later agreed to give back, so it never invents a
 * payment that was not taken and never reduces an installment that was settled.
 */

function refundOne(
  demo: Demo,

  schedules: Schedule[],

  payments: Payment[],
): void {
  const cancelled = schedules.find((s) => s.booking.status === "cancelled")

  if (!cancelled) return

  const source = payments

    .filter((payment) => payment.bookingId === cancelled.booking.id)

    .sort((a, b) => (a.amount < b.amount ? -1 : 1))

    .pop()

  if (!source) return

  const amount = Math.min(CANCELLATION_CAP, source.amount)

  if (amount <= 0) return

  const id = seqId(demo, "ref")

  const requestedAt = stamp(demo.today, 12, 10)

  const settledAt = stamp(demo.today, 6, 12)

  const requester = demo.agents[0]

  const approver = demo.roleUsers.get("tenant_admin")?.[0] ?? demo.actorUserId

  const creditNumber = "AT-CRN-1001"

  const approvalId = writeApproval(
    demo,

    "refund",

    "approved",

    `Refund ${demo.currency} ${amount} to ${cancelled.booking.customerName}`,

    {
      refundId: id,

      customerId: cancelled.booking.customerId,

      customerName: cancelled.booking.customerName,

      reference: cancelled.booking.reference,

      amount,

      reason:
        "Retained cancellation charge returned after a name-mismatch dispute",
    },

    "refund",

    id,

    requester?.userId ?? demo.actorUserId,

    requestedAt,

    {
      userId: approver,

      name: demo.userNames.get(approver) ?? demo.actorName,

      note: "Verified against the receipt and the cancellation sheet.",

      at: settledAt,
    },
  )

  write(demo, "refunds", id, () =>
    run(
      `INSERT INTO refunds (
         id, tenant_id, customer_id, booking_id, installment_id, payment_id,
         amount, reason, status, credit_number, approval_id,
         requested_by_user_id, requested_by_name, requested_at, paid_at,
         recorded_by_user_id, recorded_by_name, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'paid', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,

      id,

      demo.tenantId,

      cancelled.booking.customerId,

      cancelled.booking.id,

      source.allocations[0]?.installmentId ?? null,

      source.id,

      amount,

      "Retained cancellation charge returned after a name-mismatch dispute",

      creditNumber,

      approvalId,

      requester?.userId ?? demo.actorUserId,

      requester?.fullName ?? demo.actorName,

      requestedAt,

      settledAt,

      approver,

      demo.userNames.get(approver) ?? demo.actorName,

      settledAt,
    ),
  )

  ledger(demo, {
    customerId: cancelled.booking.customerId,

    bookingId: cancelled.booking.id,

    kind: "refund",

    amount,

    reference: creditNumber,

    sourceType: "refund",

    sourceId: id,

    occurredAt: settledAt.slice(0, 10),

    note: "Refund paid against a credit note",

    recordedByUserId: approver,

    recordedByName: demo.userNames.get(approver) ?? demo.actorName,
  })
}

/**
 * Moves one running booking to a new buyer.
 *
 * Everything the app does on approval is mirrored: the outstanding balance is
 * snapshotted, the booking and its receipts change hands, and the ledger carries
 * the out and in entries plus the fee as an adjustment. The receiving customer is
 * the one the funnel deliberately left without a booking, so nobody is invented
 * mid-story.
 */

function transferOne(
  demo: Demo,

  schedules: Schedule[],

  payments: Payment[],
): void {
  const target = demo.customers[demo.customers.length - 1]

  if (!target) return

  const source = schedules.find((s) => {
    if (s.booking.status !== "confirmed" || s.booking.legacy) return false

    return outstanding(s) > 0 && s.booking.customerId !== target.id
  })

  if (!source) return

  const fromCustomerId = source.booking.customerId

  const moved = outstanding(source)

  const fee = 25_000

  const id = seqId(demo, "trf")

  const requestedAt = stamp(demo.today, 9, 11)

  const settledAt = stamp(demo.today, 4, 15)

  const requester = demo.agents[1] ?? demo.agents[0]

  const approver = demo.managers[0]

  const documents = {
    planId: source.planId,

    installmentCount: source.lines.length,

    paymentCount: payments.filter((p) => p.bookingId === source.booking.id)
      .length,

    receiptNumbers: payments

      .filter((p) => p.bookingId === source.booking.id)

      .map((p) => p.receipt),

    quotationCount: source.quoteId ? 1 : 0,
  }

  const approvalId = writeApproval(
    demo,

    "transfer",

    "approved",

    `Transfer ${source.booking.unitCode} from ${source.booking.customerName} to ${target.fullName}`,

    {
      transferId: id,

      bookingId: source.booking.id,

      reference: source.booking.reference,

      unitCode: source.booking.unitCode,

      fromCustomerId,

      fromCustomerName: source.booking.customerName,

      toCustomerId: target.id,

      toCustomerName: target.fullName,

      fee,

      outstandingMoved: moved,

      reason: "Original buyer assigned the booking to a family member",
    },

    "transfer",

    id,

    requester?.userId ?? demo.actorUserId,

    requestedAt,

    {
      userId: approver?.userId ?? demo.actorUserId,

      name: approver?.fullName ?? demo.actorName,

      note: "Nomination and transfer fee confirmed with both parties.",

      at: settledAt,
    },
  )

  write(demo, "transfers", id, () =>
    run(
      `INSERT INTO transfers (
         id, tenant_id, booking_id, from_customer_id, to_customer_id, fee,
         outstanding_moved, reason, status, approval_id, documents,
         requested_by_user_id, requested_by_name, requested_at, completed_at,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?, ?, ?, ?, ?, ?)`,

      id,

      demo.tenantId,

      source.booking.id,

      fromCustomerId,

      target.id,

      fee,

      moved,

      "Original buyer assigned the booking to a family member",

      approvalId,

      JSON.stringify(documents),

      requester?.userId ?? demo.actorUserId,

      requester?.fullName ?? demo.actorName,

      requestedAt,

      settledAt,

      settledAt,
    ),
  )

  run(
    `UPDATE bookings SET customer_id = ?, customer_name = ?, updated_at = ?
      WHERE tenant_id = ? AND id = ?`,

    target.id,

    target.fullName,

    settledAt,

    demo.tenantId,

    source.booking.id,
  )

  run(
    `UPDATE payments SET customer_id = ? WHERE tenant_id = ? AND booking_id = ?`,

    target.id,

    demo.tenantId,

    source.booking.id,
  )

  source.booking.customerId = target.id

  source.booking.customerName = target.fullName

  const actor = {
    id: approver?.userId ?? demo.actorUserId,

    name: approver?.fullName ?? demo.actorName,
  }

  ledger(demo, {
    customerId: fromCustomerId,

    bookingId: source.booking.id,

    kind: "transfer_out",

    amount: -moved,

    reference: source.booking.reference,

    sourceType: "transfer",

    sourceId: id,

    occurredAt: settledAt.slice(0, 10),

    note: "Booking transferred out",

    recordedByUserId: actor.id,

    recordedByName: actor.name,
  })

  ledger(demo, {
    customerId: target.id,

    bookingId: source.booking.id,

    kind: "transfer_in",

    amount: moved,

    reference: source.booking.reference,

    sourceType: "transfer",

    sourceId: id,

    occurredAt: settledAt.slice(0, 10),

    note: "Booking transferred in",

    recordedByUserId: actor.id,

    recordedByName: actor.name,
  })

  ledger(demo, {
    customerId: target.id,

    bookingId: source.booking.id,

    kind: "adjustment",

    amount: fee,

    reference: source.booking.reference,

    sourceType: "transfer",

    sourceId: id,

    occurredAt: settledAt.slice(0, 10),

    note: "Transfer fee",

    recordedByUserId: actor.id,

    recordedByName: actor.name,
  })
}

/** What a schedule still owes, exactly as the receivables queries read it. */

function outstanding(s: Schedule): number {
  return s.lines.reduce((sum, line) => sum + (line.total - line.paid), 0)
}

/**
 * One approval request, written the way `insertApproval` writes it.
 *
 * The payload is a plain object so the detail page can decode it by shape; a
 * request with a decision carries who signed it and when, and a pending one
 * carries nothing the queue has not earned yet.
 */

export function writeApproval(
  demo: Demo,

  actionKey: string,

  status: ApprovalOutcome,

  summary: string,

  payload: Record<string, unknown>,

  entityType: string,

  resultEntityId: string | null,

  requestedByUserId: string,

  requestedAt: string,

  decision?: ApprovalDecision,
): string {
  const id = seqId(demo, "appr")

  const requestedByName =
    demo.userNames.get(requestedByUserId) ?? demo.actorName

  const decidedAt = decision?.at ?? null

  write(demo, "approvals", id, () =>
    run(
      `INSERT INTO approvals (
         id, tenant_id, action_key, status, summary, payload, entity_type,
         result_entity_id, requested_by_user_id, requested_by_name, requested_at,
         decided_by_user_id, decided_by_name, decision_note, decided_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,

      id,

      demo.tenantId,

      actionKey,

      status,

      summary.slice(0, 300),

      JSON.stringify(payload),

      entityType,

      resultEntityId,

      requestedByUserId,

      requestedByName,

      requestedAt,

      decision?.userId ?? null,

      decision?.name ?? null,

      decision?.note ?? null,

      decidedAt,

      decidedAt ?? requestedAt,
    ),
  )

  return id
}

/** The three states a request can be left in. */

export type ApprovalOutcome = "pending" | "approved" | "rejected"

/** Who signed a decision, and what they said about it. */

export interface ApprovalDecision {
  userId: string

  name: string

  note: string

  at: string
}
