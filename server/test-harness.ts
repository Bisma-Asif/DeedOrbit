/**
 * Shared harness for the added test suites.
 *
 * Boots a throwaway SQLite database on an ephemeral port and exposes the same
 * black-box HTTP surface the browser client uses, plus the fixture builders the
 * money, isolation, permissions, and end-to-end suites need. It mirrors the
 * bootstrap in `api.test.ts` so the assertions exercise real routes, real
 * permission guards, and real tenant scoping — never a re-declared mock.
 *
 * Each `*.test.ts` file that imports this module runs in its own process (the
 * Node test runner isolates files), so a fresh temp database per import keeps
 * concurrent suites from seeing each other's rows.
 */

import assert from "node:assert/strict"

import { mkdtempSync, rmSync } from "node:fs"

import { tmpdir } from "node:os"

import { join } from "node:path"

import type { Server } from "node:http"

import type { AddressInfo } from "node:net"

// oxlint-disable-next-line no-explicit-any

type Json = Record<string, any>

interface CallResult<T = Json> {
  status: number

  body: T
}

type CookieJar = {
  header: () => string

  absorb: (response: Response) => void
}

interface SessionProbe {
  authenticated: boolean
}

const workdir = mkdtempSync(join(tmpdir(), "deedorbit-suite-"))

process.env.DEEDORBIT_DB = join(workdir, "test.db")

process.env.DEEDORBIT_EXPOSE_RESET_TOKEN = "1"

const { getDb, closeDb, all, get, run, transaction } = await import("./db.ts")

const { hashPassword } = await import("./crypto.ts")

const {
  seed,

  DEMO_PASSWORD,

  seedUnitStatuses,

  seedCategoryVocabulary,

  seedOperationalModules,

  seedPlatformBilling,
} = await import("./seed.ts")

const { can, invalidateGrantCache } = await import("./rbac.ts")

const { createApp } = await import("./index.ts")

let base = ""

let server: Server | null = null

/** Minimal cookie jar: one jar per simulated browser. */

function jar(): CookieJar {
  const cookies = new Map<string, string>()

  return {
    header() {
      return [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ")
    },

    absorb(response) {
      const raw = response.headers.getSetCookie?.() ?? []

      for (const cookie of raw) {
        const [pair] = cookie.split(";")

        const index = pair.indexOf("=")

        const name = pair.slice(0, index).trim()

        const value = pair.slice(index + 1).trim()

        if (value === "") cookies.delete(name)
        else cookies.set(name, value)
      }
    },
  }
}

async function call<T = Json>(
  cookies: CookieJar | null,

  method: string,

  path: string,

  body?: unknown,
): Promise<CallResult<T>> {
  const response = await fetch(`${base}${path}`, {
    method,

    headers: {
      "Content-Type": "application/json",

      ...(cookies ? { Cookie: cookies.header() } : {}),
    },

    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

  cookies?.absorb(response)

  const text = await response.text()

  return {
    status: response.status,

    body: text ? JSON.parse(text) as T : {} as T,
  }
}

async function signIn(email: string, password: string = DEMO_PASSWORD) {
  const cookies = jar()

  const result = await call(cookies, "POST", "/api/auth/login", {
    email,

    password,
  })

  assert.equal(
    result.status,

    200,

    `login failed for ${email}: ${JSON.stringify(result.body)}`,
  )

  assert.equal((result.body as unknown as SessionProbe).authenticated, true)

  return { cookies, session: result.body }
}

/**
 * Start the environment: fresh DB, seed, and a listening server. Call inside a
 * top-level `before()`; the returned `close` belongs in `after()`.
 */

export async function bootstrap() {
  getDb()

  seed()

  seedPlatformBilling()

  seedOperationalModules()

  server = createApp()

  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve))

  base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`

  return {
    close() {
      server?.close()

      closeDb()

      rmSync(workdir, { recursive: true, force: true })
    },
  }
}

/** The deeding of the demo workspace, used as the baseline tenant in tests. */

export const TENANT_A = "tn_deedorbit_holdings"

/**
 * Create a second, fully active workspace with a single owner user, then seed
 * its built-in unit-status vocabulary the way the signup route does. Returns the
 * tenant id and a signed-in cookie jar for its owner. Used by the isolation suite.
 */

export async function createSecondTenant(tag: string) {
  const nowIso = new Date().toISOString()

  const tenantId = `tn_iso_${tag}`

  run(
    `INSERT INTO tenants (
        id, name, legal_name, slug, status, plan, logo_initials,
        primary_color, timezone, currency, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'active', 'enterprise', 'IB', NULL, 'Asia/Dubai', 'AED', ?, ?)`,

    tenantId,

    `Isolation ${tag}`,

    `Isolation ${tag} Ltd`,

    `isolation-${tag}`,

    nowIso,

    nowIso,
  )

  const userId = `usr_iso_${tag}`

  run(
    `INSERT INTO users (
        id, tenant_id, email, full_name, phone, job_title, status,
        password_hash, password_changed_at, email_verified_at,
        twofa_enabled, failed_login_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, NULL, 'Owner', 'active', ?, ?, ?, 0, 0, ?, ?)`,

    userId,

    tenantId,

    `iso.owner.${tag}@deedorbit.test`,

    `Isolation Owner ${tag}`,

    hashPassword(DEMO_PASSWORD),

    nowIso,

    nowIso,

    nowIso,

    nowIso,
  )

  run(
    `INSERT INTO tenant_memberships (tenant_id, user_id, role_id, is_default, created_at)
     VALUES (?, ?, 'tenant_owner', 1, ?)`,

    tenantId,

    userId,

    nowIso,
  )

  // A brand-new workspace needs the built-in unit-status vocabulary before it can

  // list a unit: the signup route seeds exactly this set for every new tenant (see

  // routes/auth.ts), and unit creation validates its status against it. Run the

  // shared idempotent seeder so this tenant is provisioned the way the app does.

  seedUnitStatuses()

  // The same for the nine category lists: a workspace that cannot name a property type
  // cannot classify the unit it is about to create, and the importer reads the same rows.

  seedCategoryVocabulary()

  return await signIn(`iso.owner.${tag}@deedorbit.test`)
}

/**
 * Create a member of the demo workspace (tenant A) holding a specific role, then
 * sign in. The permissions suite drives the real guard with one user per role so
 * every route can be probed as that role. The account is inert until a probe uses
 * it, and grants resolve from the seeded platform defaults with no overrides.
 */

export async function signInAsRole(roleId: string, tag: string) {
  const nowIso = new Date().toISOString()

  const userId = `usr_perm_${tag}`

  const email = `perm.${tag}@deedorbit.test`

  run(
    `INSERT INTO users (
        id, tenant_id, email, full_name, phone, job_title, status,
        password_hash, password_changed_at, email_verified_at,
        twofa_enabled, failed_login_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, NULL, 'Permission Tester', 'active', ?, ?, ?, 0, 0, ?, ?)`,

    userId,

    TENANT_A,

    email,

    `Permission Tester ${tag}`,

    hashPassword(DEMO_PASSWORD),

    nowIso,

    nowIso,

    nowIso,

    nowIso,
  )

  run(
    `INSERT INTO tenant_memberships (tenant_id, user_id, role_id, is_default, created_at)
     VALUES (?, ?, ?, 1, ?)`,

    TENANT_A,

    userId,

    roleId,

    nowIso,
  )

  return await signIn(email)
}

// --- Fixture builders ------------------------------------------------------

//

// These mirror the request shapes the real client sends (and the ones

// `api.test.ts` uses), so a fixture is always schema-valid. Every builder takes

// the acting cookies, so the same helper can populate tenant A or tenant B.

async function projectFor(cookies: CookieJar, name: string): Promise<string> {
  const created = await call(cookies, "POST", "/api/projects", {
    name,

    developer: "Emaar Properties",

    location: "Dubai Marina, Dubai, UAE",
  })

  assert.equal(created.status, 200, JSON.stringify(created.body))

  return created.body.project.id as string
}

function validUnitBody(
  nodeId: string,
  unitCode: string,
): Record<string, unknown> {
  return {
    unitCode,

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
  }
}

async function createCustomer(
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

async function setApprovalPolicy(
  cookies: CookieJar,

  actionKey: string,

  enabled: boolean,

  thresholdAmount: number,
): Promise<void> {
  const result = await call(
    cookies,
    "PATCH",
    "/api/settings/approval-policies",
    {
      policies: [{ actionKey, enabled, thresholdAmount }],
    },
  )

  assert.equal(result.status, 200, JSON.stringify(result.body))
}

/**
 * A project, one available unit on it, and a fresh customer — the frame a
 * booking needs but without creating the booking itself. Used when a test must
 * drive the booking route under its own conditions (approval gates, status
 * changes) rather than through the pre-confirmed convenience fixture.
 */

interface BookingFrameOpts {
  name: string

  code: string

  phone: string
}

interface BookingFrame {
  projectId: string

  unitId: string

  customerId: string
}

export async function makeBookingFrame(
  cookies: CookieJar,

  opts: BookingFrameOpts,
): Promise<BookingFrame> {
  const projectId = await projectFor(cookies, opts.name)

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

  const unit = await call(
    cookies,

    "POST",

    `/api/projects/${projectId}/units`,

    validUnitBody(nodeId, opts.code),
  )

  assert.equal(unit.status, 200, JSON.stringify(unit.body))

  const customerId = await createCustomer(
    cookies,

    `Customer ${opts.code}`,

    opts.phone,
  )

  return { projectId, unitId: unit.body.unit.id as string, customerId }
}

interface ConfirmedBooking {
  projectId: string

  unitId: string

  customerId: string

  bookingId: string
}

/**
 * A confirmed booking on a fresh available unit with a fresh customer. Approval
 * for bookings is switched off for the acting tenant so the booking lands
 * `confirmed` directly (the plan requires a confirmed booking).
 */

interface ConfirmedBookingOpts extends BookingFrameOpts {
  bookingAmount?: number
}

export async function makeConfirmedBooking(
  cookies: CookieJar,

  opts: ConfirmedBookingOpts,
): Promise<ConfirmedBooking> {
  const projectId = await projectFor(cookies, opts.name)

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

  const unit = await call(
    cookies,

    "POST",

    `/api/projects/${projectId}/units`,

    validUnitBody(nodeId, opts.code),
  )

  assert.equal(unit.status, 200, JSON.stringify(unit.body))

  await setApprovalPolicy(cookies, "booking", false, 0)

  const customerId = await createCustomer(
    cookies,

    `Customer ${opts.code}`,

    opts.phone,
  )

  const made = await call(cookies, "POST", "/api/bookings", {
    projectId,

    unitId: unit.body.unit.id,

    customerId,

    bookingAmount: opts.bookingAmount ?? 500000,

    bookingDate: "2020-01-15",

    terms: `${opts.name} terms.`,
  })

  assert.equal(made.status, 200, JSON.stringify(made.body))

  return {
    projectId,

    unitId: unit.body.unit.id as string,

    customerId,

    bookingId: made.body.booking.id as string,
  }
}

interface InstallmentLine {
  id: string

  number: number

  kind: string

  dueDate: string

  amount: number

  charges: number

  total: number

  paidAmount: number

  status: string
}

/** Confirm a payment plan on a booking and return the generated dated lines. */

export async function confirmPlan(
  cookies: CookieJar,

  bookingId: string,

  plan: Record<string, unknown>,
): Promise<InstallmentLine[]> {
  const result = await call(
    cookies,

    "POST",

    `/api/bookings/${bookingId}/payment-plan/confirm`,

    plan,
  )

  assert.equal(result.status, 200, JSON.stringify(result.body))

  assert.ok(Array.isArray(result.body.installments), "installments is an array")

  return result.body.installments as InstallmentLine[]
}

/**
 * The complete money fixture: a confirmed booking carrying a plan. Returns the
 * ids and the dated installment lines. Late fees are switched off for the
 * tenant unless the caller turns them on afterwards.
 */

export async function makePlannedBooking(
  cookies: CookieJar,

  opts: {
    name: string

    code: string

    phone: string

    plan: Record<string, unknown>
  },
): Promise<ConfirmedBooking & { installments: InstallmentLine[] }> {
  await call(cookies, "PATCH", "/api/settings/late-fees", {
    enabled: false,

    mode: "fixed",

    amount: 0,

    percentBps: 0,

    graceDays: 0,

    maxAssessments: 0,
  })

  const booking = await makeConfirmedBooking(cookies, opts)

  const installments = await confirmPlan(cookies, booking.bookingId, opts.plan)

  return { ...booking, installments }
}

/** Read the customer ledger through the API, returning the entries with balances. */

export async function readLedger(
  cookies: CookieJar,

  customerId: string,
): Promise<Json[]> {
  const result = await call(
    cookies,
    "GET",
    `/api/customers/${customerId}/ledger`,
  )

  assert.equal(result.status, 200, JSON.stringify(result.body))

  assert.ok(Array.isArray(result.body.entries), "ledger.entries is an array")

  return result.body.entries as Json[]
}

/** The current status of a unit, or `__missing__` when it is not in the list. */

export async function unitStatus(
  cookies: CookieJar,

  projectId: string,

  unitId: string,
): Promise<string> {
  const units = await call(cookies, "GET", `/api/projects/${projectId}/units`)

  const entry = (units.body.units as Json[] | undefined)?.find(
    (each) => each.id === unitId,
  )

  return entry ? entry.status as string : "__missing__"
}

export {
  call,
  jar,
  signIn,
  run,
  get,
  all,
  transaction,
  can,
  invalidateGrantCache,
}

export { setApprovalPolicy }

export type { CookieJar, CallResult, InstallmentLine, Json }
