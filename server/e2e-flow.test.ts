/**
 * End-to-end flow test: the main money journey a user walks in the browser.
 *
 * There is no browser-automation toolchain in this project (the only runner is
 * `node --test`), so the journey is exercised at the exact seam the browser
 * uses: the same `/api/...` calls, in the same order, with the same request
 * shapes the React client sends, against a real server, real guards, and the
 * real SQLite store. Each step asserts the state the next step depends on, so a
 * break anywhere in the pipeline — lead capture, conversion, booking, plan
 * generation, payment allocation, receipt minting, ledger posting — fails here.
 *
 * The steps run in file order and share one workspace, mirroring a single
 * operator working a deal from first contact to a paid receipt.
 */

import { test, before, after } from "node:test"

import assert from "node:assert/strict"

import {
  bootstrap,
  call,
  confirmPlan,
  setApprovalPolicy,
  signIn,
  unitStatus,
} from "./test-harness.ts"

import type { CookieJar, InstallmentLine, Json } from "./test-harness.ts"

let close: () => void

let cookies: CookieJar

// State carried from step to step, exactly as the UI carries it across screens.

let leadId = ""

let customerId = ""

let projectId = ""

let unitId = ""

let bookingId = ""

let installments: InstallmentLine[] = []

let paymentId = ""

let receiptNumber = ""

const LEAD_NAME = "Priya Raman"

const LEAD_PHONE = "+971 55 700 1122"

before(async () => {
  close = (await bootstrap()).close

  cookies = (await signIn("owner@deedorbit.com")).cookies

  // Keep the happy path honest: this workspace collects no late fees and books

  // without an approval hold, so a confirmed booking is immediate.

  await call(cookies, "PATCH", "/api/settings/late-fees", {
    enabled: false,

    mode: "fixed",

    amount: 0,

    percentBps: 0,

    graceDays: 0,

    maxAssessments: 0,
  })

  await setApprovalPolicy(cookies, "booking", false, 0)
})

after(() => {
  close?.()
})

test("step 1 — a lead is captured and worked to Won", async () => {
  const created = await call(cookies, "POST", "/api/leads", {
    name: LEAD_NAME,

    phone: LEAD_PHONE,

    source: "Website",

    email: "priya.raman@example.com",
  })

  assert.equal(created.status, 200, JSON.stringify(created.body))

  leadId = (created.body.lead.id as string)

  assert.ok(leadId)

  const won = await call(cookies, "PATCH", `/api/leads/${leadId}`, {
    status: "won",
  })

  assert.equal(won.status, 200, JSON.stringify(won.body))

  assert.equal(won.body.lead.status, "won")
})

test("step 2 — the Won lead converts into a customer", async () => {
  const converted = await call(
    cookies,
    "POST",
    `/api/leads/${leadId}/convert`,
    {},
  )

  assert.equal(converted.status, 200, JSON.stringify(converted.body))

  customerId = (converted.body.customer.id as string)

  assert.ok(customerId)

  assert.equal(converted.body.customer.name, LEAD_NAME)

  const read = await call(cookies, "GET", `/api/customers/${customerId}`)

  assert.equal(read.status, 200, JSON.stringify(read.body))

  assert.equal(read.body.customer.name, LEAD_NAME)

  assert.equal(read.body.customer.phone, LEAD_PHONE)
})

test("step 3 — the customer books a unit on a new project", async () => {
  const project = await call(cookies, "POST", "/api/projects", {
    name: "Marina Heights E2E",

    developer: "Emaar Properties",

    location: "Dubai Marina, Dubai, UAE",
  })

  assert.equal(project.status, 200, JSON.stringify(project.body))

  projectId = (project.body.project.id as string)

  const tower = await call(
    cookies,
    "POST",
    `/api/projects/${projectId}/structure`,
    {
      name: "Tower A",

      kind: "block",
    },
  )

  assert.equal(tower.status, 200, JSON.stringify(tower.body))

  const nodeId = tower.body.node.id as string

  const unit = await call(cookies, "POST", `/api/projects/${projectId}/units`, {
    unitCode: "E2E-A1",

    unitType: "apartment",

    structureNodeId: nodeId,

    sizeSqft: 1450,

    basePrice: 2_450_000,

    pricing: {
      pricePerSqft: 1700,

      developmentCharge: 150000,

      cornerPremium: 200000,

      parkFacingPremium: 100000,

      floorPremium: 50000,

      discount: 75000,
    },

    status: "available",

    location: "North-facing, podium level",
  })

  assert.equal(unit.status, 200, JSON.stringify(unit.body))

  unitId = (unit.body.unit.id as string)

  const booked = await call(cookies, "POST", "/api/bookings", {
    projectId,

    unitId,

    customerId,

    bookingAmount: 900_000,

    bookingDate: "2020-01-15",

    terms: "Marina Heights booking — end to end journey.",
  })

  assert.equal(booked.status, 200, JSON.stringify(booked.body))

  bookingId = (booked.body.booking.id as string)

  assert.ok(bookingId)

  assert.equal(booked.body.booking.status, "confirmed")

  // Booking the unit took it off the market.

  assert.equal(await unitStatus(cookies, projectId, unitId), "booked")
})

test("step 4 — a payment plan is confirmed and generates dated installments", async () => {
  installments = await confirmPlan(cookies, bookingId, {
    netAmount: 900_000,

    downPaymentPercent: 10,

    charges: 0,

    frequency: "monthly",

    installmentCount: 3,

    balloonAmount: 0,

    startDate: "2031-01-15",
  })

  const down = installments.filter((line) => line.kind === "down_payment")

  const rest = installments.filter((line) => line.kind === "installment")

  assert.equal(down.length, 1, "one down-payment line")

  assert.equal(down[0].total, 90_000)

  assert.equal(rest.length, 3, "three installment lines")

  assert.deepEqual(
    rest.map((line) => line.total),

    [270_000, 270_000, 270_000],
  )

  // The whole schedule reconciles to the contract value exactly.

  assert.equal(
    installments.reduce((sum, line) => sum + line.total, 0),

    900_000,
  )

  const plan = await call(
    cookies,
    "GET",
    `/api/bookings/${bookingId}/payment-plan`,
  )

  assert.equal(plan.status, 200, JSON.stringify(plan.body))
})

test("step 5 — a payment covers the down note in full and part of the first installment", async () => {
  const down = installments.find((line) => line.kind === "down_payment")!

  const first = installments.find((line) => line.kind === "installment")!

  const result = await call(cookies, "POST", "/api/payments", {
    customerId,

    method: "bank",

    amount: 140_000,

    allocations: [
      { installmentId: down.id, amount: down.total },

      { installmentId: first.id, amount: 50_000 },
    ],

    receivedAt: "2026-01-10",

    note: "Down payment plus part of installment one.",
  })

  assert.equal(result.status, 200, JSON.stringify(result.body))

  paymentId = (result.body.payment.id as string)

  receiptNumber = (result.body.payment.receiptNumber as string)

  assert.ok(paymentId)

  assert.ok(receiptNumber, "a receipt number is minted on payment")

  assert.equal(result.body.payment.amount, 140_000)

  const open = await call(
    cookies,
    "GET",
    `/api/customers/${customerId}/open-installments`,
  )

  assert.equal(open.status, 200, JSON.stringify(open.body))

  const openLines = open.body.installments as Json[]

  // The fully paid down-payment line leaves the open set; the first installment

  // remains with only its unpaid balance.

  assert.equal(
    openLines.some((line) => line.id === down.id),

    false,

    "a settled down-payment is no longer open",
  )

  const seenFirst = openLines.find((line) => line.id === first.id)

  assert.ok(seenFirst, "the part-paid installment is still open")

  assert.equal(seenFirst.remaining, first.total - 50_000)
})

test("step 6 — the receipt reads back the payment, the customer and every allocated line", async () => {
  const receipt = await call(cookies, "GET", `/api/payments/${paymentId}`)

  assert.equal(receipt.status, 200, JSON.stringify(receipt.body))

  assert.equal(receipt.body.payment.receiptNumber, receiptNumber)

  assert.equal(receipt.body.payment.amount, 140_000)

  assert.equal(receipt.body.customer.name, LEAD_NAME)

  const allocated = (receipt.body.lines as Json[]).reduce(
    (sum, line) => (sum + line.allocated) as number,

    0,
  )

  assert.equal(allocated, 140_000, "receipt lines restate the whole payment")

  assert.ok(
    (receipt.body.lines as Json[]).some((line) => line.bookingReference),

    "the receipt ties back to a booking reference",
  )
})

test("step 7 — the customer ledger posts the payment and folds a running balance", async () => {
  const ledger = await call(
    cookies,
    "GET",
    `/api/customers/${customerId}/ledger`,
  )

  assert.equal(ledger.status, 200, JSON.stringify(ledger.body))

  const entries = ledger.body.entries as Json[]

  const paymentEntry = entries.find((entry) => entry.sourceId === paymentId)

  assert.ok(paymentEntry, "the payment appears on the ledger")

  assert.equal(
    paymentEntry.amount,
    -140_000,
    "a receipt is a debit against the customer",
  )

  // The running balance is the fold of every signed entry in time order.

  const folded = entries.reduce(
    (sum, entry) => (sum + entry.amount) as number,
    0,
  )

  assert.equal(ledger.body.balance, folded)

  assert.equal(entries[entries.length - 1].balanceAfter, folded)
})
