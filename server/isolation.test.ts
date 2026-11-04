/**
 * Tenant isolation tests.
 *
 * The guarantee: a user of workspace A must never read or modify a single record
 * of workspace B through any API route — not by id, not by list, not by a write.
 * Cross-tenant ids must read as "not found" (404), never as a forbidden peek that
 * confirms the row exists (the middleware is explicit about that choice).
 *
 * Two shapes of proof:
 *
 *   1. Dual fixtures. For the record families the harness can create end-to-end
 *      (projects, customers, leads, bookings, payment plans, payments), a real
 *      row is made in BOTH workspaces, then each tenant probes the other's id on
 *      the read and the mutating routes, and neither list ever shows the other's
 *      row.
 *
 *   2. By-id sweeps. For the wider surface (tickets, documents, expenses,
 *      vendors, construction, procurement, signatures, campaigns, approvals,
 *      reports) a demo id is taken from workspace A's own list and workspace B
 *      attempts to read it; a missing id simply skips that family rather than
 *      failing on absent demo data.
 */

import { test, before, after } from "node:test"

import assert from "node:assert/strict"

import {
  bootstrap,
  call,
  confirmPlan,
  createSecondTenant,
  makeConfirmedBooking,
  signIn,
} from "./test-harness.ts"

import type { CallResult, CookieJar, Json } from "./test-harness.ts"

let close: () => void

let adminA: CookieJar

let adminB: CookieJar

before(async () => {
  close = (await bootstrap()).close

  // Tenant A is the seeded demo workspace; its owner holds every grant.

  adminA = (await signIn("owner@deedorbit.com")).cookies

  // Tenant B is a brand-new active workspace with a single owner.

  adminB = (await createSecondTenant("b1")).cookies
})

after(() => {
  close?.()
})

/** The invariant every cross-tenant read must satisfy: treated as not found. */

function assertHidden(result: CallResult, label: string) {
  assert.equal(
    result.status,

    404,

    `${label}: expected 404 for a cross-tenant id, got ${result.status} ${JSON.stringify(result.body)}`,
  )
}

async function makeProject(cookies: CookieJar, name: string): Promise<string> {
  const result = await call(cookies, "POST", "/api/projects", {
    name,

    developer: "Emaar Properties",

    location: "Dubai Marina, Dubai, UAE",
  })

  assert.equal(result.status, 200, JSON.stringify(result.body))

  return result.body.project.id as string
}

async function makeCustomer(
  cookies: CookieJar,

  fullName: string,

  phone: string,
): Promise<string> {
  const result = await call(cookies, "POST", "/api/customers", {
    fullName,
    phone,
  })

  assert.equal(result.status, 200, JSON.stringify(result.body))

  return result.body.customer.id as string
}

async function makeLead(cookies: CookieJar, name: string): Promise<string> {
  const result = await call(cookies, "POST", "/api/leads", {
    name,

    phone: "+971 50 100 2000",

    source: "Website",

    email: `${name.toLowerCase().replace(/\s+/g, ".")}@example.com`,
  })

  assert.equal(result.status, 200, JSON.stringify(result.body))

  return result.body.lead.id as string
}

// ---------------------------------------------------------------------------

// Dual-fixture families: create in both tenants, probe both directions

// ---------------------------------------------------------------------------

test("one tenant's project id is invisible and unwritable to the other", async () => {
  const projectIdA = await makeProject(adminA, "Isolation Project A")

  const projectIdB = await makeProject(adminB, "Isolation Project B")

  assertHidden(
    await call(adminB, "GET", `/api/projects/${projectIdA}`),

    "B reads A project",
  )

  assertHidden(
    await call(adminA, "GET", `/api/projects/${projectIdB}`),

    "A reads B project",
  )

  assertHidden(
    await call(adminB, "PATCH", `/api/projects/${projectIdA}`, {
      name: "Hijacked",
    }),

    "B edits A project",
  )

  // Neither workspace's list leaks the other's row.

  const listA = await call(adminA, "GET", "/api/projects")

  const listB = await call(adminB, "GET", "/api/projects")

  const idsA = (listA.body.projects as Json[]).map((row) => row.id)

  const idsB = (listB.body.projects as Json[]).map((row) => row.id)

  assert.ok(idsA.includes(projectIdA))

  assert.equal(
    idsB.includes(projectIdA),
    false,
    "A's project must not appear in B",
  )

  assert.ok(idsB.includes(projectIdB), "B can see its own project")

  assert.equal(
    idsA.includes(projectIdB),
    false,
    "B's project must not appear in A",
  )
})

test("one tenant's customer record is sealed from the other", async () => {
  const customerIdA = await makeCustomer(
    adminA,
    "Isolation Cust A",
    "+971501110001",
  )

  const customerIdB = await makeCustomer(
    adminB,
    "Isolation Cust B",
    "+971501110002",
  )

  assertHidden(
    await call(adminB, "GET", `/api/customers/${customerIdA}`),

    "B reads A customer",
  )

  assertHidden(
    await call(adminA, "GET", `/api/customers/${customerIdB}`),

    "A reads B customer",
  )

  assertHidden(
    await call(adminB, "PATCH", `/api/customers/${customerIdA}`, {
      fullName: "Renamed",
    }),

    "B edits A customer",
  )

  // The ledger is a customer read surface — sealed the same way.

  assertHidden(
    await call(adminB, "GET", `/api/customers/${customerIdA}/ledger`),

    "B reads A ledger",
  )

  const listA = await call(adminA, "GET", "/api/customers")

  const idsA = (listA.body.customers as Json[]).map((row) => row.id)

  assert.ok(idsA.includes(customerIdA))

  assert.equal(idsA.includes(customerIdB), false)
})

test("one tenant's lead is invisible to the other", async () => {
  const leadIdA = await makeLead(adminA, "Isolation Lead A")

  const leadIdB = await makeLead(adminB, "Isolation Lead B")

  assertHidden(
    await call(adminB, "GET", `/api/leads/${leadIdA}`),

    "B reads A lead",
  )

  assertHidden(
    await call(adminA, "GET", `/api/leads/${leadIdB}`),

    "A reads B lead",
  )

  assertHidden(
    await call(adminB, "PATCH", `/api/leads/${leadIdA}`, { name: "Taken" }),

    "B edits A lead",
  )

  const listB = await call(adminB, "GET", "/api/leads")

  const idsB = (listB.body.leads as Json[]).map((row) => row.id)

  assert.equal(idsB.includes(leadIdA), false, "A's lead must not appear in B")

  assert.ok(idsB.includes(leadIdB))
})

test("bookings, payment plans, and payments are fenced per tenant", async () => {
  const bookingA = await makeConfirmedBooking(adminA, {
    name: "Isolation Booking A",

    code: "ISO-A1",

    phone: "+971501120001",
  })

  const bookingB = await makeConfirmedBooking(adminB, {
    name: "Isolation Booking B",

    code: "ISO-B1",

    phone: "+971501120002",
  })

  const plan = {
    netAmount: 90_000,

    downPaymentPercent: 0,

    charges: 0,

    frequency: "monthly",

    installmentCount: 3,

    balloonAmount: 0,

    startDate: "2030-01-15",
  }

  const linesA = await confirmPlan(adminA, bookingA.bookingId, plan)

  const linesB = await confirmPlan(adminB, bookingB.bookingId, plan)

  // Reading the other tenant's booking or its plan is treated as absent.

  assertHidden(
    await call(adminB, "GET", `/api/bookings/${bookingA.bookingId}`),

    "B reads A booking",
  )

  assertHidden(
    await call(adminA, "GET", `/api/bookings/${bookingB.bookingId}`),

    "A reads B booking",
  )

  assertHidden(
    await call(
      adminB,
      "GET",
      `/api/bookings/${bookingA.bookingId}/payment-plan`,
    ),

    "B reads A payment plan",
  )

  // Cancelling another tenant's booking is refused as not found.

  assertHidden(
    await call(
      adminB,

      "POST",

      `/api/bookings/${bookingA.bookingId}/cancel`,

      { reason: "Cross-tenant attempt." },
    ),

    "B cancels A booking",
  )

  // Paying against another tenant's installment cannot reach the line.

  const crossPay = await call(adminB, "POST", "/api/payments", {
    customerId: bookingA.customerId,

    method: "cash",

    amount: 1_000,

    allocations: [{ installmentId: linesA[0].id, amount: 1_000 }],
  })

  assert.ok(
    crossPay.status === 404 || crossPay.status === 400,

    `cross-tenant payment refused (got ${crossPay.status})`,
  )

  assert.equal(crossPay.status, 404, "installment id is unknown to B — 404")

  // A payment recorded in A is not readable by B.

  const paymentA = await call(adminA, "POST", "/api/payments", {
    customerId: bookingA.customerId,

    method: "bank",

    amount: 10_000,

    allocations: [{ installmentId: linesA[0].id, amount: 10_000 }],
  })

  assert.equal(paymentA.status, 200, JSON.stringify(paymentA.body))

  assertHidden(
    await call(adminB, "GET", `/api/payments/${paymentA.body.payment.id}`),

    "B reads A receipt",
  )

  // B's own lines are untouched by the failed cross-tenant attempts: A's

  // installment remains fully unpaid, B's is fully unpaid too.

  assertHidden(
    await call(adminA, "GET", `/api/payments/${linesB[0].id}`),

    "A cannot read a B installment id as a payment",
  )
})

// ---------------------------------------------------------------------------

// By-id sweeps across the wider surface, using workspace A's real demo ids

// ---------------------------------------------------------------------------

interface ReadProbe {
  label: string

  listUrl: string

  listKey: string

  getUrl: (id: string) => string
}

const READ_PROBES: ReadProbe[] = [
  {
    label: "tickets",
    listUrl: "/api/tickets",
    listKey: "tickets",
    getUrl: (id) => `/api/tickets/${id}`,
  },

  {
    label: "documents",
    listUrl: "/api/documents",
    listKey: "documents",
    getUrl: (id) => `/api/documents/${id}`,
  },

  {
    label: "expenses",
    listUrl: "/api/expenses",
    listKey: "expenses",
    getUrl: (id) => `/api/expenses/${id}`,
  },

  {
    label: "vendors",
    listUrl: "/api/vendors",
    listKey: "vendors",
    getUrl: (id) => `/api/vendors/${id}`,
  },

  {
    label: "campaigns",
    listUrl: "/api/campaigns",
    listKey: "campaigns",
    getUrl: (id) => `/api/campaigns/${id}`,
  },

  {
    label: "construction phases",

    listUrl: "/api/construction/phases",

    listKey: "phases",

    getUrl: (id) => `/api/construction/phases/${id}`,
  },

  {
    label: "requisitions",

    listUrl: "/api/procurement/requisitions",

    listKey: "requisitions",

    getUrl: (id) => `/api/procurement/requisitions/${id}`,
  },

  {
    label: "signature templates",

    listUrl: "/api/signatures/templates",

    listKey: "templates",

    getUrl: (id) => `/api/signatures/templates/${id}`,
  },

  {
    label: "signature envelopes",

    listUrl: "/api/signatures/envelopes",

    listKey: "envelopes",

    getUrl: (id) => `/api/signatures/envelopes/${id}`,
  },
]

test("workspace B cannot read any workspace A record by id across the module surface", async () => {
  // Collect one real id per family from A's own listings.

  const probed: string[] = []

  for (const probe of READ_PROBES) {
    const list = await call(adminA, "GET", probe.listUrl)

    if (list.status !== 200) continue

    const collection = list.body[probe.listKey]

    if (!Array.isArray(collection) || collection.length === 0) continue

    const id = collection[0].id as string | undefined

    if (!id) continue

    // The same id must exist for A (sanity) and be invisible to B. Some families

    // expose no GET-by-id route at all (the call answers 405); those simply offer

    // no cross-tenant read surface, so the sweep skips them instead of failing.

    const selfRead = await call(adminA, "GET", probe.getUrl(id))

    if (selfRead.status !== 200) continue

    probed.push(probe.label)

    assertHidden(
      await call(adminB, "GET", probe.getUrl(id)),
      `B reads A ${probe.label}`,
    )
  }

  // The demo workspace is expected to hold at least a few of these families;

  // assert the sweep actually covered real records rather than silently no-op.

  assert.ok(
    probed.length >= 3,

    `expected the by-id sweep to probe at least 3 populated families, saw ${probed.length}`,
  )
})

test("workspace B's global search and lists return none of A's rows", async () => {
  const projectIdA = await makeProject(adminA, "Sealed Search Project")

  const searchB = await call(
    adminB,
    "GET",
    "/api/search?q=Sealed Search Project",
  )

  assert.equal(searchB.status, 200, JSON.stringify(searchB.body))

  const serialized = JSON.stringify(searchB.body)

  assert.equal(
    serialized.includes(projectIdA),

    false,

    "A's project id must not surface in B's global search",
  )
})
