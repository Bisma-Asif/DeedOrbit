/**
 * API behaviour tests.
 *
 * These are the tests that matter for this platform: they assert that the
 * three checks (session, permission, tenant) actually reject, not just that
 * the happy path returns 200. A permission system that has never been seen to
 * refuse anything is not a permission system.
 *
 * Runs against a throwaway database on an ephemeral port.
 */

import { test, before, after } from "node:test"

import assert from "node:assert/strict"

import { mkdtempSync, readFileSync, rmSync } from "node:fs"

import { tmpdir } from "node:os"

import { dirname, join } from "node:path"

import { fileURLToPath } from "node:url"

import type { Server } from "node:http"

import type { AddressInfo } from "node:net"

// Imported for their types only, so the organization contract test below stays

// tied to the exact shapes the browser client declares. `import type` is fully

// erased, so the test runner never has to resolve the client module.

import type {
  Branch as BranchView,
  NumberFormat,
  NumberingSettings,
  OrganizationSettings,
} from "../src/lib/organization-api.ts"

// The member contract is asserted from the hand-written client in `api.ts`, for

// the same drift reason as the organization one above.

import type {
  Project as ProjectView,
  ProjectDetail,
  ProjectList,
} from "../src/lib/projects-api.ts"

// The structure tree is asserted against the client's own types for the same

// drift reason: if the server renames a field, this file has to stop compiling.

import type {
  ProjectStructureNode,
  ProjectStructureResponse,
} from "../src/lib/project-structure-api.ts"

// The member contract is asserted from the hand-written client in `api.ts`, for

// the same drift reason as the organization one above.

import type { TenantUser, UsersResponse } from "../src/lib/api.ts"

// The platform directory and timeline are asserted from the hand-written

// client in `platform-api.ts`, for the same drift reason as the member

// contract above: if the server renames a view field, this file stops

// compiling.

import type {
  PlatformBillingEventView,
  PlatformTenantView,
} from "../src/lib/platform-api.ts"

// The depth cap is asserted against the shared constant rather than a literal, so

// raising the cap in the product does not silently leave the test expecting the

// old behaviour.

const { STRUCTURE_MAX_DEPTH } = await import("../shared/projects.ts")

// The numbering kinds are asserted against the shared catalogue rather than a
// literal, so adding a kind (requisition, purchase_order) to the product
// automatically widens what these tests expect instead of leaving them stale.

const { NUMBER_KINDS } = await import("../shared/organization.ts")

const workdir = mkdtempSync(join(tmpdir(), "deedorbit-test-"))

process.env.DEEDORBIT_DB = join(workdir, "test.db")

process.env.DEEDORBIT_EXPOSE_RESET_TOKEN = "1"

const { getDb, closeDb, all, get, run } = await import("./db.ts")

const { hashPassword } = await import("./crypto.ts")

const {
  seed,
  DEMO_PASSWORD,
  seedOrganizationDefaults,
  seedPermissionCatalogue,
  seedPlatformBilling,
  seedOperationalModules,
} = await import("./seed.ts")

// The permission guard memoises grants for a few seconds, so the view-only test

// below has to be able to drop that cache after writing an override.

const { invalidateGrantCache } = await import("./rbac.ts")

const {
  addOrganizationSettingsColumns,

  addUserAccessControlColumns,

  organizationSettingsColumns,

  userAccessControlColumns,
} = await import("./migrations.ts")

const { createApp } = await import("./index.ts")

let server: Server

let base = ""

type CookieJar = {
  header: () => string

  absorb: (response: Response) => void
}

/**
 * API responses are asserted structurally here rather than re-typed. These
 * tests deliberately treat the server as a black box: re-declaring every
 * response shape would just mirror the implementation and stop catching drift.
 * What each test checks — status codes, error codes, and the exact values that
 * matter — is still asserted explicitly, so a shape change fails the test.
 */

// oxlint-disable-next-line no-explicit-any

type Json = Record<string, any>

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

interface SessionProbe {
  authenticated: boolean

  twofaRequired: unknown
}

interface PendingSessionProbe {
  authenticated: boolean

  twofaRequired: boolean
}

interface CallResult<T = Json> {
  status: number

  body: T
}

/**
 * Named interface rather than an inline type literal: `oxfmt` strips member
 * separators from a multi-member literal written on one line, which silently
 * turns `{ name: string; is_headquarters: number }` into invalid syntax.
 */

interface SeededBranchRow {
  name: string

  is_headquarters: number
}

/**
 * Reads a JSON array field with a checked element type. Keeps iteration
 * callbacks out of `noImplicitAny` territory and fails loudly if a route
 * returns an object where a collection was expected.
 */

function rows<T = Json>(value: unknown, context = "response body"): T[] {
  assert.ok(Array.isArray(value), `expected an array in the ${context}`)

  return value as T[]
}

/**
 * The mirror of `rows`: reads a single JSON object. Used by the organization
 * contract test, which inspects the keys of one settings or branch object.
 */

function record(value: unknown, context = "response body"): Json {
  assert.ok(
    value !== null && typeof value === "object" && !Array.isArray(value),

    `expected an object in the ${context}`,
  )

  return value as Json
}

/**
 * `body` is non-null by contract: every route this suite exercises returns a
 * JSON envelope, and `{}` stands in for the rare empty one so assertions stay
 * free of null checks.
 */

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

before(async () => {
  getDb()

  seed()

  // The platform demo state (third workspace, subscription rows, billing
  // ledgers) is a boot-level seed in production too; tests must see the same.
  seedPlatformBilling()

  // Construction, procurement, signatures and integrations demo rows are the
  // same boot-level, fixed-key `INSERT OR IGNORE` seed production applies in
  // `start()`; the tests exercise those read paths, so they must see it too.
  seedOperationalModules()

  server = createApp()

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))

  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

after(() => {
  server?.close()

  closeDb()

  rmSync(workdir, { recursive: true, force: true })
})

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

  assert.equal(result.body.authenticated, true)

  return { cookies, session: result.body }
}

// ---------------------------------------------------------------------------

// Schema

// ---------------------------------------------------------------------------

test("every business table carries a tenant_id column", async () => {
  getDb()

  const tables = [
    "users",

    "tenant_memberships",

    "sessions",

    "password_reset_tokens",

    "user_invitations",

    "twofa_recovery_codes",

    "audit_log",

    "role_permission_overrides",

    "reminder_settings",

    "outbound_messages",
  ]

  for (const table of tables) {
    const columns = all<{ name: string }>(
      `SELECT name FROM pragma_table_info(?)`,

      table,
    )

    assert.ok(
      columns.some((column) => column.name === "tenant_id"),

      `${table} is missing tenant_id`,
    )
  }
})

test("permissions live in the database, not in code", () => {
  const count = get<{ count: number }>(
    "SELECT COUNT(*) AS count FROM permissions",
  )?.count

  assert.ok(
    (count ?? 0) >= 50,

    `expected a full module x action matrix, found ${count}`,
  )

  const defaults = get<{ count: number }>(
    "SELECT COUNT(*) AS count FROM role_permission_defaults",
  )?.count

  assert.ok((defaults ?? 0) > 0, "role_permission_defaults is empty")
})

test("all eleven roles are seeded", () => {
  const roles = all<{ role_id: string }>(
    "SELECT role_id FROM roles ORDER BY role_id",
  )

  const ids = roles.map((row) => row.role_id)

  assert.equal(ids.length, 11)

  for (const expected of [
    "platform_super_admin",

    "tenant_owner",

    "tenant_admin",

    "sales_manager",

    "sales_agent",

    "recovery_officer",

    "accounts_officer",

    "project_manager",

    "procurement_officer",

    "dealer_partner",

    "customer",
  ]) {
    assert.ok(ids.includes(expected), `missing role ${expected}`)
  }
})

test("every seeded role can reach the dashboard the app lands on after sign-in", () => {
  // The client routes to #/dashboard once a session exists, and App.tsx refuses

  // to render it without dashboard.view. A role without that grant therefore

  // signs in successfully and lands on the not-found screen. Catch it here

  // rather than letting it surface as a broken first impression.

  //

  // A row in role_permission_defaults *is* the grant; the table has no

  // allow/deny column. Overrides live separately and can only narrow this.

  const tenantRoles = all<{ role_id: string }>(
    "SELECT role_id FROM roles WHERE scope = 'tenant' ORDER BY role_id",
  ).map((row) => row.role_id)

  assert.ok(tenantRoles.length > 0, "expected tenant-scoped roles")

  for (const role of tenantRoles) {
    const granted = get<{ n: number }>(
      `SELECT COUNT(*) AS n
         FROM role_permission_defaults
        WHERE role_id = ? AND permission_id = 'dashboard.view'`,

      role,
    )

    assert.equal(granted?.n, 1, `${role} cannot reach the dashboard`)
  }
})

// ---------------------------------------------------------------------------

// Check 1: authentication

// ---------------------------------------------------------------------------

test("unauthenticated requests are rejected", async () => {
  const result = await call(jar(), "GET", "/api/users")

  assert.equal(result.status, 401)

  assert.equal(result.body.error.code, "unauthenticated")
})

test("a wrong password is refused without revealing which half was wrong", async () => {
  const badPassword = await call(jar(), "POST", "/api/auth/login", {
    email: "admin@deedorbit.com",

    password: "not-the-password-1",
  })

  const noSuchUser = await call(jar(), "POST", "/api/auth/login", {
    email: "nobody@deedorbit.com",

    password: "not-the-password-1",
  })

  assert.equal(badPassword.status, 401)

  assert.equal(noSuchUser.status, 401)

  assert.equal(badPassword.body.error.message, noSuchUser.body.error.message)
})

test("a valid session returns the user, tenant, role, and viewable modules", async () => {
  const { session } = await signIn("admin@deedorbit.com")

  assert.equal(session.user.email, "admin@deedorbit.com")

  assert.equal(session.role.id, "tenant_admin")

  assert.equal(session.tenant.slug, "deedorbit")

  assert.ok(session.modules.includes("users"))

  assert.ok(Array.isArray(session.memberships))
})

test("a signed-out session call still reports twofaRequired, so the client can discriminate", async () => {
  const result = await call<SessionProbe>(
    jar(),

    "GET",

    "/api/auth/session",
  )

  assert.equal(result.status, 200)

  assert.equal(result.body.authenticated, false)

  // The field must be present and boolean, not merely undefined. A client

  // switching on a discriminated union cannot tell "signed out" from

  // "awaiting a second factor" if the field is absent in one branch.

  assert.equal(typeof result.body.twofaRequired, "boolean")

  assert.equal(result.body.twofaRequired, false)
})

test("a pending two-factor session reads as pending, not as signed out", async () => {
  // Enrol on a throwaway workspace rather than a seeded account: turning on 2FA

  // for a demo user would leak into every later test that signs in as them.

  const email = "totp-shape@example.com"

  const password = "Totp-Shape-2026"

  const owner = jar()

  const created = await call(owner, "POST", "/api/auth/signup", {
    email,

    fullName: "Totp Shape",

    workspaceName: "Totp Shape Co",

    password,
  })

  assert.equal(created.status, 200)

  const enrolled = await call(owner, "POST", "/api/auth/twofa/enroll")

  assert.equal(enrolled.status, 200)

  const confirmed = await call(owner, "POST", "/api/auth/twofa/confirm", {
    code: enrolled.body.currentCode,
  })

  assert.equal(confirmed.status, 200)

  // A fresh login parks at the second step.

  const pendingCookies = jar()

  const login = await call<PendingSessionProbe>(
    pendingCookies,

    "POST",

    "/api/auth/login",

    { email, password },
  )

  assert.equal(login.body.authenticated, false)

  assert.equal(login.body.twofaRequired, true)

  // The session endpoint must agree with the login response, or the client

  // would drop a valid pending session on its next boot call.

  const booted = await call<PendingSessionProbe>(
    pendingCookies,

    "GET",

    "/api/auth/session",
  )

  assert.equal(booted.body.authenticated, false)

  assert.equal(booted.body.twofaRequired, true)
})

test("the session payload carries a complete boolean permission map", async () => {
  const { session } = await signIn("admin@deedorbit.com")

  const map = session.permissions as Record<string, boolean>

  assert.ok(Object.keys(map).length > 0, "permission map should not be empty")

  for (const [permissionId, allowed] of Object.entries(map)) {
    assert.equal(
      typeof allowed,

      "boolean",

      `${permissionId} must map to a boolean`,
    )
  }

  // A grant the admin holds must be true, and the map must not invent

  // permissions the role does not have.

  assert.equal(map["users.view"], true)

  assert.equal(map["users.edit"], true)

  // Every viewable module must be backed by a true `view` grant, otherwise the

  // sidebar would offer a link the API then refuses.

  for (const module of rows<string>(session.modules, "session.modules")) {
    assert.equal(
      map[`${module}.view`],

      true,

      `${module} is listed but not granted`,
    )
  }
})

test("a sales agent session grants a map with no user administration", async () => {
  const { session } = await signIn("sales.agent@deedorbit.com")

  const map = session.permissions as Record<string, boolean>

  assert.equal(map["users.view"], false)

  assert.equal(map["users.edit"], false)

  assert.equal(map["projects.view"], true)

  assert.ok(!session.modules.includes("users"))
})

test("the members and roles admin surface is closed to a member without users.view", async () => {
  const { cookies } = await signIn("sales.agent@deedorbit.com")

  const users = await call(cookies, "GET", "/api/users")

  assert.equal(users.status, 403)

  assert.equal(users.body.error.code, "permission_denied")

  // The roles matrix carries the same information as the member list — who holds

  // what — so it must not be more permissive than the tab the client hides.

  const roles = await call(cookies, "GET", "/api/roles")

  assert.equal(roles.status, 403)

  assert.equal(roles.body.error.code, "permission_denied")

  // Their own session must still work, so the 403s above are permission-based

  // rather than a blanket lockout or a broken session.

  const sessions = await call(cookies, "GET", "/api/auth/sessions")

  assert.equal(sessions.status, 200)

  assert.ok(rows(sessions.body.sessions, "sessions").length > 0)
})

test("a member with users.view can still read the roles matrix", async () => {
  const { cookies } = await signIn("admin@deedorbit.com")

  const roles = await call(cookies, "GET", "/api/roles")

  assert.equal(roles.status, 200)

  const list = rows<{ id: string }>(roles.body.roles, "roles")

  assert.ok(list.length >= 11, "expected the seeded role catalogue")
})

test("a sales agent cannot see the users module in their grants", async () => {
  const { session } = await signIn("sales.agent@deedorbit.com")

  assert.equal(session.role.id, "sales_agent")

  assert.ok(
    !session.modules.includes("users"),

    "sales agent should not have users.view",
  )
})

test("the session cookie is http-only", async () => {
  const response = await fetch(`${base}/api/auth/login`, {
    method: "POST",

    headers: { "Content-Type": "application/json" },

    body: JSON.stringify({
      email: "admin@deedorbit.com",

      password: DEMO_PASSWORD,
    }),
  })

  const setCookie = response.headers.getSetCookie()

  const session = setCookie.find((c) => c.startsWith("deedorbit_session="))

  assert.ok(session, "no session cookie issued")

  assert.match(session, /HttpOnly/i)

  assert.match(session, /SameSite=Lax/i)
})

// ---------------------------------------------------------------------------

// Check 2: permission

// ---------------------------------------------------------------------------

test("a role without the grant is refused with 403", async () => {
  const { cookies } = await signIn("sales.agent@deedorbit.com")

  const result = await call(cookies, "GET", "/api/users")

  assert.equal(result.status, 403)

  assert.equal(result.body.error.code, "permission_denied")

  assert.match(result.body.error.message, /users\.view/)
})

test("a refused attempt is written to the audit log", async () => {
  const { cookies } = await signIn("sales.agent@deedorbit.com")

  await call(cookies, "GET", "/api/users")

  const { cookies: adminCookies } = await signIn("admin@deedorbit.com")

  const audit = await call(adminCookies, "GET", "/api/audit")

  const denied = rows(audit.body.entries, "audit entries").some(
    (entry) =>
      entry.action === "permission.denied.view" &&
      entry.actorEmail === "sales.agent@deedorbit.com",
  )

  assert.ok(denied, "permission denial was not audited")
})

test("the role matrix reflects the seeded defaults", async () => {
  const { cookies } = await signIn("admin@deedorbit.com")

  const result = await call(cookies, "GET", "/api/roles")

  const roleById = new Map(
    rows(result.body.roles, "roles").map((role) => [role.id, role]),
  )

  const admin = roleById.get("tenant_admin")

  const agent = roleById.get("sales_agent")

  const customer = roleById.get("customer")

  // Each role must exist before its grants can be asserted.

  for (const id of ["tenant_admin", "sales_agent", "customer"]) {
    assert.ok(roleById.has(id), `role ${id} missing from the matrix`)
  }

  const has = (role: Json | undefined, id: string) =>
    rows(role?.permissions, "role permissions").some(
      (p) => p.permissionId === id && p.allowed,
    )

  assert.ok(has(admin, "users.create"), "tenant admin should be able to invite")

  assert.ok(
    !has(admin, "payments.delete"),

    "tenant admin should not delete payments",
  )

  assert.ok(has(agent, "leads.create"), "sales agent should create leads")

  assert.ok(
    !has(agent, "payments.approve"),

    "sales agent should not approve payments",
  )

  assert.ok(!has(customer, "leads.view"), "customer should not see leads")

  // The `customer` role used to hold tenant-wide `bookings.view` / `payments.view`,
  // which let any buyer read every other buyer's records through the staff API.
  // Those grants are gone by design: a buyer reaches their own money through the
  // scoped `/api/portal/*` surface (authorized by `customer_portal_links`), not a
  // permission row. So the role must NOT hold the leaking grant any more.

  assert.ok(
    !has(customer, "payments.view"),

    "customer must not hold tenant-wide payments.view (portal leak)",
  )

  assert.ok(
    !has(customer, "bookings.view"),

    "customer must not hold tenant-wide bookings.view (portal leak)",
  )

  assert.ok(
    has(customer, "dashboard.view"),

    "customer keeps dashboard.view so sign-in lands somewhere real",
  )
})

test("revoking a permission in the database changes the API response", async () => {
  const { cookies: adminCookies } = await signIn("admin@deedorbit.com")

  const before = await call(adminCookies, "GET", "/api/roles/sales_manager")

  assert.ok(
    rows(before.body.permissions, "role permissions").some(
      (p) => p.permissionId === "leads.delete" && p.allowed,
    ),
  )

  // Narrow the role: drop leads.delete and payments.approve.

  const drop = new Set(["leads.delete", "payments.approve"])

  const target = rows(before.body.permissions, "role permissions")

    .filter((p) => p.allowed && !drop.has(p.permissionId))

    .map((p) => p.permissionId)

  const update = await call(
    adminCookies,

    "PUT",

    "/api/roles/sales_manager/permissions",

    {
      permissions: target,
    },
  )

  assert.equal(update.status, 200, JSON.stringify(update.body))

  assert.equal(update.body.allowedCount, target.length)

  const after = await call(adminCookies, "GET", "/api/roles/sales_manager")

  const invite = rows(after.body.permissions, "role permissions").find(
    (p) => p.permissionId === "leads.delete",
  )

  assert.ok(invite, "leads.delete should still be listed, just denied")

  assert.equal(invite.allowed, false)

  assert.equal(invite.source, "override")

  assert.equal(invite.effect, "deny")

  // The override is scoped to one tenant: the platform default is untouched.

  const defaults = get<{ count: number }>(
    "SELECT COUNT(*) AS count FROM role_permission_defaults WHERE role_id = 'sales_manager' AND permission_id = 'leads.delete'",
  )?.count

  assert.equal(defaults, 1, "the platform default should not be mutated")

  // Restore for the remaining tests.

  await call(adminCookies, "PUT", "/api/roles/sales_manager/permissions", {
    permissions: [...target, ...drop],
  })
})

test("an admin can widen a role below their own", async () => {
  const { cookies } = await signIn("admin@deedorbit.com")

  const before = await call(cookies, "GET", "/api/roles/sales_agent")

  assert.ok(
    !rows(before.body.permissions, "role permissions").some(
      (p) => p.permissionId === "leads.delete" && p.allowed,
    ),
  )

  const target = [
    ...rows(before.body.permissions, "role permissions")

      .filter((p) => p.allowed)

      .map((p) => p.permissionId),

    "leads.delete",
  ]

  const result = await call(
    cookies,

    "PUT",

    "/api/roles/sales_agent/permissions",

    {
      permissions: target,
    },
  )

  assert.equal(result.status, 200, JSON.stringify(result.body))

  // The widened grant is immediately effective for that role.

  const after = await call(cookies, "GET", "/api/roles/sales_agent")

  assert.ok(
    rows(after.body.permissions, "role permissions").some(
      (p) => p.permissionId === "leads.delete" && p.allowed,
    ),
  )
})

test("an admin cannot edit their own role into more access", async () => {
  const { cookies } = await signIn("admin@deedorbit.com")

  const before = await call(cookies, "GET", "/api/roles/tenant_admin")

  const target = [
    ...rows(before.body.permissions, "role permissions")

      .filter((p) => p.allowed)

      .map((p) => p.permissionId),

    "payments.delete", // not held by tenant_admin
  ]

  const result = await call(
    cookies,

    "PUT",

    "/api/roles/tenant_admin/permissions",

    {
      permissions: target,
    },
  )

  assert.equal(result.status, 400)

  assert.match(result.body.error.fields.permissions, /payments\.delete/)
})

test("an admin cannot edit a role above their own", async () => {
  const { cookies } = await signIn("admin@deedorbit.com")

  const result = await call(
    cookies,

    "PUT",

    "/api/roles/tenant_owner/permissions",

    {
      permissions: ["dashboard.view"],
    },
  )

  assert.equal(result.status, 400)

  assert.match(result.body.error.fields.roleId, /above your own/)
})

test("platform roles are not editable from a tenant", async () => {
  const { cookies } = await signIn("admin@deedorbit.com")

  const result = await call(
    cookies,

    "PUT",

    "/api/roles/platform_super_admin/permissions",

    {
      permissions: ["dashboard.view"],
    },
  )

  assert.equal(result.status, 400)

  assert.match(result.body.error.fields.roleId, /centrally/)
})

// ---------------------------------------------------------------------------

// Check 3: tenant scoping

// ---------------------------------------------------------------------------

test("a user outside the tenant is invisible, not merely forbidden", async () => {
  const { cookies: ownerA } = await signIn("owner@deedorbit.com")

  // A second, unrelated workspace with its own owner.

  const signup = await call(jar(), "POST", "/api/auth/signup", {
    email: "rival@example.com",

    fullName: "Rival Operator",

    workspaceName: "Rival Developments",

    password: "Rival-Desk-2026",
  })

  assert.equal(signup.status, 200)

  const tenantB = signup.body.tenant.id

  // Owner A asking for tenant B's id gets nothing.

  const peek = await call(ownerA, "GET", `/api/tenants/${tenantB}`)

  assert.equal(peek.status, 400)

  // Owner A cannot see tenant B in the directory.

  const list = await call(ownerA, "GET", "/api/tenants")

  assert.equal(list.body.tenants.length, 1)

  assert.equal(list.body.tenants[0].slug, "deedorbit")

  // And a user id from tenant B is reported as nonexistent.

  const foreignUser = get<{ id: string }>(
    "SELECT id FROM users WHERE email = ?",

    "rival@example.com",
  )

  const crossRead = await call(
    ownerA,

    "GET",

    `/api/users/${foreignUser?.id}/sessions`,
  )

  assert.equal(crossRead.status, 404)

  assert.match(crossRead.body.error.message, /does not exist in this workspace/)
})

test("signup issues a session scoped to the new workspace", async () => {
  const signup = await call(jar(), "POST", "/api/auth/signup", {
    email: "newdesk@example.com",

    fullName: "New Desk",

    workspaceName: "New Desk Realty",

    password: "New-Desk-2026",
  })

  assert.equal(signup.status, 200)

  assert.equal(signup.body.role.id, "tenant_owner")

  assert.equal(signup.body.tenant.slug, "new-desk-realty")

  // A brand new workspace must not inherit another tenant's data.

  const users = await call(jar(), "POST", "/api/auth/login", {
    email: "newdesk@example.com",

    password: "New-Desk-2026",
  })

  assert.equal(users.status, 200)
})

test("a client cannot post another tenant id and have it accepted", async () => {
  const { cookies: ownerA } = await signIn("owner@deedorbit.com")

  const other = get<{ id: string }>(
    "SELECT id FROM tenants WHERE slug = 'new-desk-realty'",
  )

  const ownTenant = get<{ id: string }>(
    "SELECT id FROM tenants WHERE slug = 'deedorbit'",
  )

  const result = await call(ownerA, "POST", "/api/users/invite", {
    email: "sneaky@example.com",

    fullName: "Sneaky Person",

    roleId: "sales_agent",

    tenantId: other?.id,
  })

  // The route never reads a client-supplied tenant, so the invite lands in the

  // caller's own workspace and the foreign id is ignored.

  assert.equal(result.status, 200)

  const created = get<{ tenant_id: string }>(
    "SELECT tenant_id FROM users WHERE email = ?",

    "sneaky@example.com",
  )

  assert.equal(created?.tenant_id, ownTenant?.id)
})

// ---------------------------------------------------------------------------

// User administration

// ---------------------------------------------------------------------------

test("a tenant admin can invite, and the invite lands as a pending user", async () => {
  const { cookies } = await signIn("admin@deedorbit.com")

  const invited = await call(cookies, "POST", "/api/users/invite", {
    email: "newhire@deedorbit.com",

    fullName: "New Hire",

    roleId: "sales_agent",

    jobTitle: "Consultant",
  })

  assert.equal(invited.status, 200)

  assert.ok(
    invited.body.invitation.devInviteToken,

    "invite token should be exposed in dev",
  )

  const list = await call(cookies, "GET", "/api/users")

  const person = rows(list.body.users, "users").find(
    (u: Json) => u.email === "newhire@deedorbit.com",
  )

  assert.ok(person, "the invited user should appear in the list")

  assert.equal(person.status, "invited")

  assert.equal(person.roleId, "sales_agent")

  assert.ok(person.pendingInvite, "pending invite should be reported")
})

test("an invited user cannot sign in until the invitation is accepted", async () => {
  const result = await call(jar(), "POST", "/api/auth/login", {
    email: "newhire@deedorbit.com",

    password: DEMO_PASSWORD,
  })

  assert.equal(result.status, 403)

  assert.equal(result.body.error.code, "invitation_pending")
})

test("an admin can change a role and it takes effect immediately", async () => {
  const { cookies } = await signIn("admin@deedorbit.com")

  const list = await call(cookies, "GET", "/api/users")

  const person = rows(list.body.users, "users").find(
    (u: Json) => u.email === "newhire@deedorbit.com",
  )

  assert.ok(person, "the invited user should appear in the list")

  const updated = await call(cookies, "PATCH", `/api/users/${person.id}`, {
    roleId: "sales_manager",
  })

  assert.equal(updated.status, 200)

  assert.equal(updated.body.user.roleId, "sales_manager")
})

test("deactivating a user kills their live sessions immediately", async () => {
  const { cookies: agentCookies } = await signIn("sales.agent@deedorbit.com")

  const before = await call(agentCookies, "GET", "/api/auth/session")

  assert.equal(before.body.authenticated, true)

  const { cookies: adminCookies } = await signIn("admin@deedorbit.com")

  const list = await call(adminCookies, "GET", "/api/users")

  const agent = rows(list.body.users, "users").find(
    (u: Json) => u.email === "sales.agent@deedorbit.com",
  )

  assert.ok(agent, "the demo sales agent should be in the tenant")

  const suspended = await call(
    adminCookies,

    "POST",

    `/api/users/${agent.id}/status`,

    {
      status: "suspended",
    },
  )

  assert.equal(suspended.status, 200)

  assert.equal(suspended.body.user.status, "suspended")

  // The old cookie is now worthless, without waiting for expiry.

  const after = await call(agentCookies, "GET", "/api/auth/session")

  assert.equal(after.body.authenticated, false)

  // Put the account back so the rest of the suite can use it.

  await call(adminCookies, "POST", `/api/users/${agent.id}/status`, {
    status: "active",
  })
})

test("an admin cannot suspend themselves", async () => {
  const { cookies, session } = await signIn("admin@deedorbit.com")

  const result = await call(
    cookies,

    "POST",

    `/api/users/${session.user.id}/status`,

    {
      status: "suspended",
    },
  )

  assert.equal(result.status, 422)

  assert.match(result.body.error.message, /your own status/)
})

test("an admin cannot assign a role above their own", async () => {
  const { cookies } = await signIn("admin@deedorbit.com")

  const result = await call(cookies, "POST", "/api/users/invite", {
    email: "boss@deedorbit.com",

    fullName: "Too Senior",

    roleId: "tenant_owner",
  })

  assert.equal(result.status, 400)

  assert.match(result.body.error.fields.roleId, /above your own/)
})

test("platform-scope roles are not offered for assignment", async () => {
  const { cookies } = await signIn("admin@deedorbit.com")

  const roles = await call(cookies, "GET", "/api/roles")

  const all = rows(roles.body.roles, "roles")

  const platform = all.find((role: Json) => role.id === "platform_super_admin")

  assert.ok(platform, "the platform role should be listed")

  assert.equal(platform.assignable, false)

  assert.equal(platform.userCount, 1)

  // Every tenant-scoped role is assignable.

  for (const role of all.filter((r: Json) => r.scope === "tenant")) {
    assert.equal(role.assignable, true, `${role.id} should be assignable`)
  }
})

// ---------------------------------------------------------------------------

// Password reset

// ---------------------------------------------------------------------------

test("forgot-password answers identically for known and unknown addresses", async () => {
  const known = await call(jar(), "POST", "/api/auth/forgot-password", {
    email: "admin@deedorbit.com",
  })

  const unknown = await call(jar(), "POST", "/api/auth/forgot-password", {
    email: "nobody-at-all@example.com",
  })

  assert.equal(known.status, 200)

  assert.equal(unknown.status, 200)

  assert.equal(known.body.message, unknown.body.message)

  assert.ok(known.body.devResetToken)

  assert.equal(unknown.body.devResetToken, undefined)
})

test("a reset token can set a new password and invalidates sessions", async () => {
  const request = await call(jar(), "POST", "/api/auth/forgot-password", {
    email: "accounts@deedorbit.com",
  })

  const token = request.body.devResetToken

  const { cookies: oldSession } = await signIn("accounts@deedorbit.com")

  assert.equal(
    (await call(oldSession, "GET", "/api/auth/session")).body.authenticated,

    true,
  )

  const reset = await call(jar(), "POST", "/api/auth/reset-password", {
    token,

    password: "Recovered-Desk-2026",
  })

  assert.equal(reset.status, 200)

  // Existing session is dead.

  assert.equal(
    (await call(oldSession, "GET", "/api/auth/session")).body.authenticated,

    false,
  )

  // The token is single-use.

  const replay = await call(jar(), "POST", "/api/auth/reset-password", {
    token,

    password: "Another-Desk-2026",
  })

  assert.equal(replay.status, 400)

  // New password works, old one does not.

  assert.equal(
    (
      await call(jar(), "POST", "/api/auth/login", {
        email: "accounts@deedorbit.com",

        password: "Recovered-Desk-2026",
      })
    ).status,

    200,
  )

  assert.equal(
    (
      await call(jar(), "POST", "/api/auth/login", {
        email: "accounts@deedorbit.com",

        password: DEMO_PASSWORD,
      })
    ).status,

    401,
  )
})

// ---------------------------------------------------------------------------

// Two-factor authentication

// ---------------------------------------------------------------------------

test("two-factor can be enrolled, challenged on login, and accepted", async () => {
  const { cookies } = await signIn("recovery@deedorbit.com")

  const enrolled = await call(cookies, "POST", "/api/auth/twofa/enroll")

  assert.equal(enrolled.status, 200)

  assert.ok(enrolled.body.secret)

  assert.ok(enrolled.body.otpauthUrl.startsWith("otpauth://totp/"))

  const confirmed = await call(cookies, "POST", "/api/auth/twofa/confirm", {
    code: enrolled.body.currentCode,
  })

  assert.equal(confirmed.status, 200)

  assert.equal(confirmed.body.recoveryCodes.length, 8)

  // A fresh login is now held at the second step.

  const challenge = await call(jar(), "POST", "/api/auth/login", {
    email: "recovery@deedorbit.com",

    password: DEMO_PASSWORD,
  })

  assert.equal(challenge.status, 200)

  assert.equal(challenge.body.authenticated, false)

  assert.equal(challenge.body.twofaRequired, true)

  // Protected routes stay closed while the factor is outstanding.

  const pendingCookies = jar()

  const pending = await fetch(`${base}/api/auth/login`, {
    method: "POST",

    headers: { "Content-Type": "application/json" },

    body: JSON.stringify({
      email: "recovery@deedorbit.com",

      password: DEMO_PASSWORD,
    }),
  })

  pendingCookies.absorb(pending)

  const blocked = await call(pendingCookies, "GET", "/api/users")

  assert.equal(blocked.status, 401)

  assert.equal(blocked.body.error.code, "twofa_required")

  // A wrong code is refused.

  const rejected = await call(
    pendingCookies,

    "POST",

    "/api/auth/twofa/verify",

    { code: "000000" },
  )

  assert.equal(rejected.status, 401)

  assert.equal(rejected.body.error.code, "twofa_invalid")

  // The correct code completes the sign-in.

  // One sign-in, one row. The challenge and its completion are two halves of the

  // same attempt, so recording a `success` at the password step would double

  // every 2FA member's timeline and make "is this one person?" unreadable.

  const { cookies: adminCookies } = await signIn("admin@deedorbit.com")

  const member = await memberByEmail(adminCookies, "recovery@deedorbit.com")

  const readOutcomes = async () => {
    const timeline = await call(
      adminCookies,

      "GET",

      `/api/users/${member.id}/activity`,
    )

    assert.equal(timeline.status, 200)

    return rows<Json>(timeline.body.events, "events").map(
      (event) => event.outcome,
    )
  }

  const beforeVerify = await readOutcomes()

  const { totpCode } = await import("./crypto.ts")

  const accepted = await call(
    pendingCookies,

    "POST",

    "/api/auth/twofa/verify",

    {
      code: totpCode(enrolled.body.secret),
    },
  )

  assert.equal(accepted.status, 200)

  assert.equal(accepted.body.authenticated, true)

  const afterVerify = await readOutcomes()

  const countOf = (list: string[], outcome: string) =>
    list.filter((o) => o === outcome).length

  assert.equal(
    afterVerify.length,

    beforeVerify.length + 1,

    "the accepted code is the only new row",
  )

  assert.equal(
    countOf(afterVerify, "success"),

    countOf(beforeVerify, "success") + 1,

    "the success is written when the second factor is accepted, not before",
  )

  assert.equal(
    countOf(afterVerify, "failed"),

    countOf(beforeVerify, "failed"),

    "the accepted code adds no failure",
  )
})

// ---------------------------------------------------------------------------

// Misc

// ---------------------------------------------------------------------------

test("logging out revokes the session", async () => {
  const { cookies } = await signIn("projects@deedorbit.com")

  assert.equal((await call(cookies, "POST", "/api/auth/logout")).status, 200)

  assert.equal(
    (await call(cookies, "GET", "/api/auth/session")).body.authenticated,

    false,
  )
})

test("a suspended workspace cannot be signed into", async () => {
  const signup = await call(jar(), "POST", "/api/auth/signup", {
    email: "closed@example.com",

    fullName: "Closed Desk",

    workspaceName: "Closed Realty",

    password: "Closed-Desk-2026",
  })

  const tenantId = signup.body.tenant.id

  getDb()

    .prepare("UPDATE tenants SET status = 'suspended' WHERE id = ?")

    .run(tenantId)

  const login = await call(jar(), "POST", "/api/auth/login", {
    email: "closed@example.com",

    password: "Closed-Desk-2026",
  })

  assert.equal(login.status, 403)

  assert.equal(login.body.error.code, "tenant_suspended")
})

test("unknown endpoints and methods are refused", async () => {
  assert.equal((await call(jar(), "GET", "/api/nope")).status, 404)

  assert.equal((await call(jar(), "DELETE", "/api/health")).status, 405)
})

test("a malformed body is rejected rather than crashing", async () => {
  const response = await fetch(`${base}/api/auth/login`, {
    method: "POST",

    headers: { "Content-Type": "application/json" },

    body: "{ not json",
  })

  assert.equal(response.status, 400)
})

// ---------------------------------------------------------------------------

// Organization settings

// ---------------------------------------------------------------------------

test("organization settings are readable and seeded", async () => {
  const { cookies } = await signIn("admin@deedorbit.com")

  const result = await call(cookies, "GET", "/api/settings/organization")

  assert.equal(result.status, 200)

  const settings = result.body.settings

  assert.equal(settings.name, "DeedOrbit Holdings")

  assert.equal(settings.countryCode, "AE")

  assert.equal(settings.currency, "AED")

  assert.deepEqual(settings.workingDays, [1, 2, 3, 4, 5])

  assert.equal(settings.logo, null)
})

test("a role without settings.view cannot read organization settings", async () => {
  const { cookies } = await signIn("sales.agent@deedorbit.com")

  const result = await call(cookies, "GET", "/api/settings/organization")

  assert.equal(result.status, 403)

  assert.equal(result.body.error.code, "permission_denied")
})

/**
 * No seeded role is view-only, but an admin can strip `settings.edit` from a
 * role in Access control, so the read-only contract has to hold. The client
 * renders disabled fields off `canEdit`, which makes a wrong `true` a data-loss
 * bug rather than a cosmetic one.
 */

test("a view-only role reads with canEdit false and is refused every write", async () => {
  const tenantId = "tn_deedorbit_holdings"

  getDb()

  const db = getDb()

  db.prepare(
    `INSERT OR REPLACE INTO role_permission_overrides
       (tenant_id, role_id, permission_id, effect, updated_at)
     VALUES (?, 'sales_agent', 'settings.view', 'allow', ?)`,
  ).run(tenantId, new Date().toISOString())

  // The guard memoises grants for 5s, so a new override would otherwise be

  // invisible to the very request that is meant to observe it.

  invalidateGrantCache(tenantId)

  try {
    const { cookies } = await signIn("sales.agent@deedorbit.com")

    const read = await call(cookies, "GET", "/api/settings/organization")

    assert.equal(read.status, 200)

    // The profile response deliberately carries no `canEdit`: the client reads

    // edit rights from the session snapshot, and a second authority in the

    // payload would be a third thing to keep in step.

    assert.equal(read.body.settings.canEdit, undefined)

    const nameBefore = read.body.settings.name

    assert.equal(typeof nameBefore, "string")

    assert.ok(nameBefore.length > 0)

    const branches = await call(cookies, "GET", "/api/settings/branches")

    assert.equal(branches.status, 200)

    assert.equal(branches.body.canEdit, false)

    const numbering = await call(cookies, "GET", "/api/settings/numbering")

    assert.equal(numbering.status, 200)

    assert.equal(numbering.body.canEdit, false)

    // Every write surface must refuse, not just the profile. The bodies are

    // deliberately valid so that a 403 proves the permission check fired rather

    // than a body validator rejecting the request first.

    const writes = await Promise.all([
      call(cookies, "PATCH", "/api/settings/organization", {
        name: "Hijacked",
      }),

      call(cookies, "POST", "/api/settings/branches", {
        name: "Hijacked Branch",

        code: "HJK",

        city: "Dubai",
      }),

      call(cookies, "PUT", "/api/settings/numbering", {
        formats: [
          { kind: "invoice", prefix: "HJK/", padding: 5 },

          { kind: "receipt", prefix: "HJK-", padding: 5 },

          { kind: "booking", prefix: "HJK-", padding: 5 },
        ],
      }),

      call(cookies, "POST", "/api/settings/numbering/invoice/next"),
    ])

    for (const write of writes) {
      assert.equal(write.status, 403, "a view-only role must not write")

      assert.equal(write.body.error.code, "permission_denied")
    }

    // And the refused writes must not have landed.

    const after = (await call(cookies, "GET", "/api/settings/organization"))
      .body.settings

    assert.equal(after.name, nameBefore)

    const branchList = (await call(cookies, "GET", "/api/settings/branches"))
      .body.branches as BranchView[]

    assert.equal(
      branchList.some((b: BranchView) => b.name === "Hijacked Branch"),

      false,

      "the refused branch create must not exist",
    )
  } finally {
    db.prepare(
      `DELETE FROM role_permission_overrides
        WHERE tenant_id = ? AND role_id = 'sales_agent'
          AND permission_id = 'settings.view'`,
    ).run(tenantId)

    invalidateGrantCache(tenantId)
  }
})

test("a partial profile update leaves untouched fields alone", async () => {
  const { cookies } = await signIn("admin@deedorbit.com")

  const before = (await call(cookies, "GET", "/api/settings/organization")).body
    .settings

  const result = await call(cookies, "PATCH", "/api/settings/organization", {
    collectionsEmail: "ar@example.com",
  })

  assert.equal(result.status, 200)

  assert.equal(result.body.settings.collectionsEmail, "ar@example.com")

  assert.equal(result.body.settings.city, before.city)

  assert.equal(result.body.settings.currency, before.currency)

  await call(cookies, "PATCH", "/api/settings/organization", {
    collectionsEmail: "billing@deedorbit.demo",
  })
})

test("an empty update is refused without touching the row", async () => {
  const { cookies } = await signIn("admin@deedorbit.com")

  const before = (await call(cookies, "GET", "/api/settings/organization")).body
    .settings

  const result = await call(cookies, "PATCH", "/api/settings/organization", {})

  assert.equal(result.status, 400)

  const after = (await call(cookies, "GET", "/api/settings/organization")).body
    .settings

  assert.equal(after.updatedAt, before.updatedAt)
})

test("invalid profile fields are reported per field and nothing is written", async () => {
  const { cookies } = await signIn("admin@deedorbit.com")

  const before = (await call(cookies, "GET", "/api/settings/organization")).body
    .settings

  const result = await call(cookies, "PATCH", "/api/settings/organization", {
    name: "X",

    currency: "ZZZ",

    timezone: "Mars/Olympus",

    workingDays: [],

    countryCode: "USA",
  })

  assert.equal(result.status, 400)

  const fields = result.body.error.fields

  assert.ok(fields.name, "expected a name error")

  assert.equal(fields.currency, "Choose a supported base currency.")

  assert.equal(fields.timezone, "Choose a supported time zone.")

  assert.equal(fields.workingDays, "Select at least one working day.")

  assert.ok(fields.countryCode, "expected a country code error")

  const after = (await call(cookies, "GET", "/api/settings/organization")).body
    .settings

  assert.equal(after.name, before.name)

  assert.equal(after.updatedAt, before.updatedAt)
})

test("a cleared optional field is written as null rather than ignored", async () => {
  const { cookies } = await signIn("admin@deedorbit.com")

  await call(cookies, "PATCH", "/api/settings/organization", {
    taxId: "TRN12345",
  })

  const cleared = await call(cookies, "PATCH", "/api/settings/organization", {
    taxId: "",
  })

  assert.equal(cleared.status, 200)

  assert.equal(cleared.body.settings.taxId, null)
})

test("branches are listed with the seeded headquarters first", async () => {
  const { cookies } = await signIn("admin@deedorbit.com")

  const result = await call(cookies, "GET", "/api/settings/branches")

  assert.equal(result.status, 200)

  const branches = rows<Json>(result.body.branches)

  assert.ok(branches.length >= 2)

  assert.equal(branches[0]?.isHeadquarters, true)

  assert.equal(branches[0]?.code, "HQ")

  assert.equal(result.body.canEdit, true)
})

test("a branch can be created, promoted, and made to conflict", async () => {
  const { cookies } = await signIn("admin@deedorbit.com")

  const created = await call(cookies, "POST", "/api/settings/branches", {
    name: "Warehouse Annex",

    code: "WH-9",

    city: "Sharjah",
  })

  assert.equal(created.status, 200)

  const id = created.body.branch.id

  assert.equal(created.body.branch.isHeadquarters, false)

  assert.equal(created.body.branch.status, "active")

  // A duplicate code is rejected with a field-level message.

  const duplicate = await call(cookies, "POST", "/api/settings/branches", {
    name: "Another Annex",

    code: "WH-9",
  })

  assert.equal(duplicate.status, 422)

  assert.ok(duplicate.body.error.fields.code, "expected a code field error")

  // Case-insensitive: a name differing only in case must collide, even though

  // the unique index uses BINARY collation and would let it through. (Codes are

  // not a useful case here — a lowercase code is rejected as a format error

  // before it can reach the clash check.)

  const lower = await call(cookies, "POST", "/api/settings/branches", {
    name: "warehouse annex",

    code: "OTR-1",
  })

  assert.equal(lower.status, 422)

  assert.ok(lower.body.error.fields.name, "expected a name field error")

  // A malformed code is a format error, not a clash.

  const malformed = await call(cookies, "POST", "/api/settings/branches", {
    name: "Fourth Annex",

    code: "!!",
  })

  assert.equal(malformed.status, 400)

  assert.ok(malformed.body.error.fields.code)

  // Promoting the new office demotes the old headquarters.

  const promoted = await call(
    cookies,

    "PATCH",

    `/api/settings/branches/${id}`,

    {
      isHeadquarters: true,
    },
  )

  assert.equal(promoted.status, 200)

  assert.equal(promoted.body.branch.isHeadquarters, true)

  const after = rows<Json>(
    (await call(cookies, "GET", "/api/settings/branches")).body.branches,
  )

  assert.equal(after.filter((b) => b.isHeadquarters).length, 1)

  await call(cookies, "DELETE", `/api/settings/branches/${id}`)
})

test("headquarters cannot be demoted and the last office cannot be archived", async () => {
  const { cookies } = await signIn("admin@deedorbit.com")

  const branches = rows<Json>(
    (await call(cookies, "GET", "/api/settings/branches")).body.branches,
  )

  const hq = branches.find((b) => b.isHeadquarters)

  assert.ok(hq, "expected a headquarters branch")

  const demote = await call(
    cookies,

    "PATCH",

    `/api/settings/branches/${hq.id}`,

    {
      isHeadquarters: false,
    },
  )

  assert.equal(demote.status, 422)

  assert.ok(demote.body.error.fields.isHeadquarters)

  // Archiving must promote a successor rather than leaving the workspace

  // without a headquarters.

  const archived = await call(
    cookies,

    "DELETE",

    `/api/settings/branches/${hq.id}`,
  )

  assert.equal(archived.status, 200)

  const after = rows<Json>(
    (await call(cookies, "GET", "/api/settings/branches")).body.branches,
  )

  const remaining = after.filter((b) => b.status === "active")

  assert.equal(remaining.filter((b) => b.isHeadquarters).length, 1)

  assert.ok(!after.some((b) => b.id === hq.id && b.isHeadquarters))

  // Put the demo workspace back the way it was.

  await call(cookies, "PATCH", `/api/settings/branches/${hq.id}`, {
    status: "active",
  })

  await call(cookies, "PATCH", `/api/settings/branches/${hq.id}`, {
    isHeadquarters: true,
  })
})

test("a rejected branch update leaves the row untouched", async () => {
  const { cookies } = await signIn("admin@deedorbit.com")

  const branches = rows<Json>(
    (await call(cookies, "GET", "/api/settings/branches")).body.branches,
  )

  const target = branches.find(
    (b) => !b.isHeadquarters && b.status === "active",
  )

  assert.ok(target)

  const before = (await call(cookies, "GET", "/api/settings/branches")).body
    .branches

  const result = await call(
    cookies,

    "PATCH",

    `/api/settings/branches/${target.id}`,

    {
      name: "Renamed Annex",

      code: "!!bad!!",
    },
  )

  assert.equal(result.status, 400)

  const after = (await call(cookies, "GET", "/api/settings/branches")).body
    .branches

  assert.deepEqual(after, before)
})

test("numbering formats are readable and preview the next number", async () => {
  const { cookies } = await signIn("admin@deedorbit.com")

  const result = await call(cookies, "GET", "/api/settings/numbering")

  assert.equal(result.status, 200)

  const formats = rows<Json>(result.body.formats)

  assert.equal(formats.length, 5)

  assert.deepEqual(
    formats.map((f) => f.kind),

    ["invoice", "receipt", "booking", "requisition", "purchase_order"],
  )

  assert.equal(formats[0]?.preview, "INV-0001")

  assert.equal(typeof result.body.fiscalYear, "number")
})

test("numbering can be saved and rejects a bad prefix", async () => {
  const { cookies } = await signIn("admin@deedorbit.com")

  const saved = await call(cookies, "PUT", "/api/settings/numbering", {
    formats: [
      { kind: "invoice", prefix: "INV/", padding: 5 },

      { kind: "receipt", prefix: "RC", padding: 3 },

      { kind: "booking", prefix: "", padding: 1 },

      { kind: "requisition", prefix: "PRQ", padding: 4 },

      { kind: "purchase_order", prefix: "PO", padding: 4 },
    ],
  })

  assert.equal(saved.status, 200)

  const invoice = rows<Json>(saved.body.formats).find(
    (f) => f.kind === "invoice",
  )

  assert.equal(invoice?.prefix, "INV/")

  assert.equal(invoice?.preview, "INV/00001")

  const bad = await call(cookies, "PUT", "/api/settings/numbering", {
    formats: [
      { kind: "invoice", prefix: "bad/prefix/here", padding: 4 },

      { kind: "receipt", prefix: "RCP-", padding: 4 },

      { kind: "booking", prefix: "BKG-", padding: 4 },

      { kind: "requisition", prefix: "PRQ-", padding: 4 },

      { kind: "purchase_order", prefix: "PO-", padding: 4 },
    ],
  })

  assert.equal(bad.status, 400)

  assert.ok(bad.body.error.fields.invoice)

  // Restore the demo formats.

  await call(cookies, "PUT", "/api/settings/numbering", {
    formats: [
      { kind: "invoice", prefix: "INV-", padding: 4 },

      { kind: "receipt", prefix: "RCP-", padding: 4 },

      { kind: "booking", prefix: "BKG-", padding: 4 },

      { kind: "requisition", prefix: "PRQ-", padding: 4 },

      { kind: "purchase_order", prefix: "PO-", padding: 4 },
    ],

    resetCounters: true,
  })
})

test("numbering requires every document type exactly once", async () => {
  const { cookies } = await signIn("admin@deedorbit.com")

  const missing = await call(cookies, "PUT", "/api/settings/numbering", {
    formats: [{ kind: "invoice", prefix: "INV-", padding: 4 }],
  })

  assert.equal(missing.status, 400)

  assert.ok(missing.body.error.fields.receipt)

  const duplicated = await call(cookies, "PUT", "/api/settings/numbering", {
    formats: [
      { kind: "invoice", prefix: "A-", padding: 4 },

      { kind: "invoice", prefix: "B-", padding: 4 },

      { kind: "receipt", prefix: "RCP-", padding: 4 },

      { kind: "booking", prefix: "BKG-", padding: 4 },

      { kind: "requisition", prefix: "PRQ-", padding: 4 },

      { kind: "purchase_order", prefix: "PO-", padding: 4 },
    ],
  })

  assert.equal(duplicated.status, 400)

  assert.ok(duplicated.body.error.fields.invoice)
})

test("issued document numbers increment and never repeat", async () => {
  const { cookies } = await signIn("admin@deedorbit.com")

  await call(cookies, "PUT", "/api/settings/numbering", {
    formats: [
      { kind: "invoice", prefix: "INV-", padding: 4 },

      { kind: "receipt", prefix: "RCP-", padding: 4 },

      { kind: "booking", prefix: "BKG-", padding: 4 },

      { kind: "requisition", prefix: "PRQ-", padding: 4 },

      { kind: "purchase_order", prefix: "PO-", padding: 4 },
    ],

    resetCounters: true,
  })

  const first = await call(
    cookies,

    "POST",

    "/api/settings/numbering/invoice/next",
  )

  const second = await call(
    cookies,

    "POST",

    "/api/settings/numbering/invoice/next",
  )

  const third = await call(
    cookies,

    "POST",

    "/api/settings/numbering/invoice/next",
  )

  assert.equal(first.status, 200)

  assert.equal(first.body.number, "INV-0001")

  assert.equal(second.body.number, "INV-0002")

  assert.equal(third.body.number, "INV-0003")

  // Parallel issuance must not hand out the same number twice.

  const burst = await Promise.all(
    Array.from({ length: 12 }, () =>
      call(cookies, "POST", "/api/settings/numbering/receipt/next"),
    ),
  )

  const numbers = burst.map((r) => r.body.number)

  assert.equal(
    new Set(numbers).size,

    numbers.length,

    `duplicate numbers: ${numbers.join(",")}`,
  )

  const unknown = await call(
    cookies,

    "POST",

    "/api/settings/numbering/widget/next",
  )

  assert.equal(unknown.status, 404)
})

test("a yearly reset restarts at 1 exactly once", async () => {
  const { cookies } = await signIn("admin@deedorbit.com")

  const tenantId = (await call(cookies, "GET", "/api/auth/session")).body.tenant
    .id

  await call(cookies, "PUT", "/api/settings/numbering", {
    formats: [
      { kind: "invoice", prefix: "INV-", padding: 4 },

      { kind: "receipt", prefix: "RCP-", padding: 4 },

      { kind: "booking", prefix: "BKG-", padding: 4 },
    ],
  })

  await call(cookies, "POST", "/api/settings/numbering/invoice/next")

  await call(cookies, "POST", "/api/settings/numbering/invoice/next")

  // Pretend the counter was last used in a fiscal year that has since ended.

  getDb()

    .prepare(
      "UPDATE number_sequences SET last_fiscal_year = ? WHERE tenant_id = ? AND kind = 'invoice'",
    )

    .run(1999, tenantId)

  const rolled = await call(
    cookies,

    "POST",

    "/api/settings/numbering/invoice/next",
  )

  assert.equal(rolled.body.number, "INV-0001")

  assert.equal(rolled.body.reset, true)

  // Calling again in the same year must not rewind the counter.

  const second = await call(
    cookies,

    "POST",

    "/api/settings/numbering/invoice/next",
  )

  assert.equal(second.body.number, "INV-0002")

  assert.equal(second.body.reset, false)
})

test("the logo rejects a non-image and a lying content type", async () => {
  const { cookies } = await signIn("admin@deedorbit.com")

  const notAnImage = await call(
    cookies,

    "PUT",

    "/api/settings/organization/logo",

    {
      logoDataUrl: `data:image/png;base64,${Buffer.from("<?php echo 1;").toString("base64")}`,
    },
  )

  assert.equal(notAnImage.status, 400)

  assert.ok(notAnImage.body.error.fields.logo)

  // Real PNG bytes, but declared as JPEG: the magic bytes must win.

  const png = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  ])

  const mislabelled = await call(
    cookies,

    "PUT",

    "/api/settings/organization/logo",

    {
      logoDataUrl: `data:image/jpeg;base64,${png.toString("base64")}`,
    },
  )

  assert.equal(mislabelled.status, 400)
})

test("the logo round-trips and can be removed", async () => {
  const { cookies } = await signIn("admin@deedorbit.com")

  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),

    Buffer.alloc(64, 0x41),
  ])

  const uploaded = await call(
    cookies,

    "PUT",

    "/api/settings/organization/logo",

    {
      logoDataUrl: `data:image/png;base64,${png.toString("base64")}`,
    },
  )

  assert.equal(uploaded.status, 200)

  assert.equal(uploaded.body.settings.logo.mime, "image/png")

  assert.ok(
    uploaded.body.settings.logo.dataUrl.startsWith("data:image/png;base64,"),
  )

  const reread = await call(cookies, "GET", "/api/settings/organization")

  assert.equal(reread.body.settings.logo.mime, "image/png")

  const removed = await call(
    cookies,

    "DELETE",

    "/api/settings/organization/logo",
  )

  assert.equal(removed.status, 200)

  assert.equal(removed.body.settings.logo, null)
})

test("organization settings are scoped to the caller's own workspace", async () => {
  const { cookies } = await signIn("admin@deedorbit.com")

  const tenantId = (await call(cookies, "GET", "/api/auth/session")).body.tenant
    .id

  // A second, unrelated workspace must not see the first one's data.

  const signup = await call(jar(), "POST", "/api/auth/signup", {
    email: "org.tenant@example.com",

    fullName: "Org Tenant",

    workspaceName: "Org Tenant Ltd",

    password: "Org-Tenant-2026",
  })

  assert.equal(signup.status, 200)

  const otherTenantId = signup.body.tenant.id

  assert.notEqual(otherTenantId, tenantId)

  const { cookies: otherCookies } = await signIn(
    "org.tenant@example.com",

    "Org-Tenant-2026",
  )

  const mine = await call(cookies, "GET", "/api/settings/organization")

  const theirs = await call(otherCookies, "GET", "/api/settings/organization")

  assert.equal(mine.status, 200)

  assert.equal(theirs.status, 200)

  assert.equal(mine.body.settings.id, tenantId)

  assert.equal(mine.body.settings.id, "tn_deedorbit_holdings")

  assert.equal(theirs.body.settings.id, otherTenantId)

  assert.equal(theirs.body.settings.name, "Org Tenant Ltd")

  getDb().prepare("DELETE FROM branches WHERE tenant_id = ?").run(otherTenantId)
})

test("a branch id from another workspace is not found", async () => {
  const { cookies } = await signIn("admin@deedorbit.com")

  const branches = rows<Json>(
    (await call(cookies, "GET", "/api/settings/branches")).body.branches,
  )

  const target = branches[0]

  assert.ok(target)

  const signup = await call(jar(), "POST", "/api/auth/signup", {
    email: "org.branch@example.com",

    fullName: "Org Branch",

    workspaceName: "Org Branch Ltd",

    password: "Org-Branch-2026",
  })

  const otherTenantId = signup.body.tenant.id

  const { cookies: otherCookies } = await signIn(
    "org.branch@example.com",

    "Org-Branch-2026",
  )

  // 404 rather than 403: a 403 would confirm the branch exists elsewhere.

  const crossRead = await call(
    otherCookies,

    "GET",

    `/api/settings/branches/${target.id}`,
  )

  assert.equal(crossRead.status, 404)

  const crossPatch = await call(
    otherCookies,

    "PATCH",

    `/api/settings/branches/${target.id}`,

    {
      name: "Hijacked",
    },
  )

  assert.equal(crossPatch.status, 404)

  const crossDelete = await call(
    otherCookies,

    "DELETE",

    `/api/settings/branches/${target.id}`,
  )

  assert.equal(crossDelete.status, 404)

  const still = await call(cookies, "GET", "/api/settings/branches")

  assert.ok(
    !rows<Json>(still.body.branches).some((b) => b.name === "Hijacked"),

    "another workspace must not be able to rename a branch",
  )

  getDb().prepare("DELETE FROM branches WHERE tenant_id = ?").run(otherTenantId)
})

test("organization defaults are re-applied and stay idempotent", () => {
  // Covers the seeding itself: that it fills stripped columns, inserts the

  // offices and sequences, and does not duplicate them on a second call.

  //

  // This does NOT by itself cover the bug that prompted it, which was the boot

  // path in `index.ts` never calling this on an already-installed workspace.

  // A function-level test cannot catch a missing call site; that wiring is

  // verified against the long-lived dev database, which already had the demo

  // roles and so had skipped `seed()` entirely.

  getDb()

  const db = getDb()

  const tenantId = "tn_deedorbit_holdings"

  // Strip the defaults back to the state an older install would be in.

  db.prepare("DELETE FROM branches WHERE tenant_id = ?").run(tenantId)

  db.prepare("DELETE FROM number_sequences WHERE tenant_id = ?").run(tenantId)

  db.prepare(
    "UPDATE tenants SET country_code = NULL, registration_number = NULL, city = NULL WHERE id = ?",
  ).run(tenantId)

  seedOrganizationDefaults()

  const branches = all<SeededBranchRow>(
    "SELECT name, is_headquarters FROM branches WHERE tenant_id = ? ORDER BY name",

    tenantId,
  )

  assert.ok(
    branches.length > 0,

    "offices must be seeded on an existing install",
  )

  assert.equal(
    branches.filter((b) => b.is_headquarters === 1).length,

    1,

    "exactly one headquarters",
  )

  const sequences = all<{ kind: string }>(
    "SELECT kind FROM number_sequences WHERE tenant_id = ?",

    tenantId,
  )

  assert.equal(sequences.length, NUMBER_KINDS.length)

  const settings = get<{ country_code: string | null }>(
    "SELECT country_code FROM tenants WHERE id = ?",

    tenantId,
  )

  assert.equal(settings?.country_code, "AE")

  // Idempotent: a second call must not duplicate the offices.

  seedOrganizationDefaults()

  assert.equal(
    all<{ n: number }>(
      "SELECT COUNT(*) AS n FROM branches WHERE tenant_id = ?",

      tenantId,
    )[0]?.n,

    branches.length,
  )
})

test("the permission catalogue reaches an already-installed workspace", () => {
  // The second half of the same bug the office defaults test covers. `seed()` runs
  // once, so a permission added later - `inventory.change_status` here - was
  // written to new databases only, and an installed workspace kept a catalogue
  // without it. Resolution is allow-by-exception, so the grant could not exist
  // either, and the status changer answered 403 to every role it was meant for.
  //
  // As with the offices, a function-level test cannot prove the call site exists;
  // the wiring is in `index.ts` alongside `seedOrganizationDefaults`. What this
  // does prove is that calling it repairs the state an older install is in.

  getDb()

  const db = getDb()

  // Strip the rows back to what a workspace seeded before this action looks like.

  db.prepare(
    "DELETE FROM role_permission_defaults WHERE permission_id = ?",
  ).run("inventory.change_status")

  db.prepare("DELETE FROM permissions WHERE permission_id = ?").run(
    "inventory.change_status",
  )

  const stripped = get<{ count: number }>(
    "SELECT count(*) AS count FROM permissions WHERE permission_id = ?",

    "inventory.change_status",
  )

  assert.equal(stripped?.count, 0, "the fixture must start without the row")

  seedPermissionCatalogue()

  const restored = get<{ count: number }>(
    "SELECT count(*) AS count FROM permissions WHERE permission_id = ?",

    "inventory.change_status",
  )

  assert.equal(restored?.count, 1, "the catalogue must be repaired")

  const holders = all<{ role_id: string }>(
    "SELECT role_id FROM role_permission_defaults WHERE permission_id = ? ORDER BY role_id",

    "inventory.change_status",
  ).map((row) => row.role_id)

  assert.equal(holders.includes("tenant_admin"), true)

  assert.equal(holders.includes("project_manager"), true)

  // Idempotent: a second boot must not duplicate the grant.
  seedPermissionCatalogue()

  assert.equal(
    all<{ n: number }>(
      "SELECT count(*) AS n FROM role_permission_defaults WHERE permission_id = ?",

      "inventory.change_status",
    )[0]?.n,

    holders.length,
  )
})

test("the organization migration is re-runnable", async () => {
  getDb()

  const db = getDb()

  // Applying it twice must be a no-op rather than an "duplicate column" error.

  addOrganizationSettingsColumns(db)

  addOrganizationSettingsColumns(db)

  const present = new Set(
    all<{ name: string }>(`SELECT name FROM pragma_table_info('tenants')`).map(
      (r) => r.name,
    ),
  )

  for (const column of organizationSettingsColumns) {
    assert.ok(present.has(column.name), `missing column ${column.name}`)
  }
})

// ---------------------------------------------------------------------------

// User access controls: office scope, forced resets, activity

// ---------------------------------------------------------------------------

async function listMembers(cookies: CookieJar): Promise<Json[]> {
  const result = await call(cookies, "GET", "/api/users")

  assert.equal(result.status, 200)

  return rows(result.body.users, "users")
}

async function memberByEmail(cookies: CookieJar, email: string): Promise<Json> {
  const members = await listMembers(cookies)

  const found = members.find((u: Json) => u.email === email)

  assert.ok(found, `${email} should appear in the member list`)

  return found
}

test("the member list ships the office catalogue so the filter needs no second grant", async () => {
  const { cookies } = await signIn("admin@deedorbit.com")

  const list = await call(cookies, "GET", "/api/users")

  const branches = rows(list.body.branches, "branches")

  assert.equal(branches.length, 3, "the demo workspace seeds three offices")

  assert.equal(branches[0].name, "Head Office", "headquarters is offered first")

  assert.equal(branches[0].code, "HQ")

  for (const branch of branches) {
    assert.deepEqual(Object.keys(branch).sort(), [
      "code",

      "id",

      "memberCount",

      "name",

      "status",
    ])
  }
})

test("a member can be restricted to specific offices", async () => {
  const { cookies } = await signIn("admin@deedorbit.com")

  const list = await call(cookies, "GET", "/api/users")

  const hq = rows<Json>(list.body.branches, "branches")[0]

  assert.ok(hq)

  const agent = await memberByEmail(cookies, "sales.agent@deedorbit.com")

  assert.equal(agent.branchAccess, "all", "a member starts unrestricted")

  assert.deepEqual(
    agent.branchIds,

    [],

    "unrestricted is an empty list, not null",
  )

  const updated = await call(
    cookies,

    "PUT",

    `/api/users/${agent.id}/branches`,

    { branchIds: [hq.id] },
  )

  assert.equal(updated.status, 200)

  assert.equal(updated.body.user.branchAccess, "limited")

  assert.deepEqual(updated.body.user.branchIds, [hq.id])

  assert.deepEqual(updated.body.user.branchNames, ["Head Office"])

  // The persisted row agrees with the response, not just the response itself.

  const reread = await memberByEmail(cookies, "sales.agent@deedorbit.com")

  assert.equal(reread.branchAccess, "limited")
})

test("clearing an office restriction restores every office", async () => {
  const { cookies } = await signIn("admin@deedorbit.com")

  const agent = await memberByEmail(cookies, "sales.agent@deedorbit.com")

  assert.equal(agent.branchAccess, "limited", "the restriction is in place")

  // An empty list means "every office", not "no office". Locking somebody out of

  // every screen by saving an unfiltered form is the failure this guards.

  const restored = await call(
    cookies,

    "PUT",

    `/api/users/${agent.id}/branches`,

    { branchIds: [] },
  )

  assert.equal(restored.status, 200)

  assert.equal(restored.body.user.branchAccess, "all")

  assert.deepEqual(restored.body.user.branchNames, [])
})

test("duplicate and blank office ids are collapsed rather than stored twice", async () => {
  const { cookies } = await signIn("admin@deedorbit.com")

  const list = await call(cookies, "GET", "/api/users")

  const branches = rows<Json>(list.body.branches, "branches")

  const agent = await memberByEmail(cookies, "sales.agent@deedorbit.com")

  const updated = await call(
    cookies,

    "PUT",

    `/api/users/${agent.id}/branches`,

    { branchIds: [branches[0].id, branches[0].id, "  ", branches[1].id] },
  )

  assert.equal(updated.status, 200)

  const granted = updated.body.user as Json

  assert.deepEqual(
    new Set(granted.branchIds as string[]),

    new Set([branches[0].id, branches[1].id]),
  )

  assert.equal(
    granted.branchIds.length,

    2,

    "the duplicate collapses and the blank is dropped",
  )

  // The two lists are read from separate queries, so they are asserted against

  // each other rather than in isolation: the UI renders the names against the

  // ids, and a mismatched order would label an office with its neighbour.

  const namesInIdOrder = (granted.branchIds as string[]).map((id: string) => {
    const match = branches.find((b: Json) => b.id === id)

    assert.ok(match, `the granted office ${id} came back in the catalogue`)

    return match.name
  })

  assert.deepEqual(granted.branchNames, namesInIdOrder)

  const stored = all<{ count: number }>(
    `SELECT COUNT(*) AS count FROM user_branches
      WHERE tenant_id = ? AND user_id = ? AND branch_id = ?`,

    "tn_deedorbit_holdings",

    agent.id,

    branches[0].id,
  )

  assert.equal(
    stored[0]?.count,

    1,

    "the scope table must hold one row per office",
  )

  await call(cookies, "PUT", `/api/users/${agent.id}/branches`, {
    branchIds: [],
  })
})

test("an office from another workspace cannot be granted", async () => {
  const { cookies } = await signIn("admin@deedorbit.com")

  const agent = await memberByEmail(cookies, "sales.agent@deedorbit.com")

  const signup = await call(jar(), "POST", "/api/auth/signup", {
    email: "org.scope@example.com",

    fullName: "Org Scope",

    workspaceName: "Org Scope Ltd",

    password: "Org-Scope-2026",
  })

  assert.equal(signup.status, 200)

  const otherTenantId = signup.body.tenant.id

  const { cookies: otherCookies } = await signIn(
    "org.scope@example.com",

    "Org-Scope-2026",
  )

  const created = await call(otherCookies, "POST", "/api/settings/branches", {
    name: "Foreign Site",

    code: "FOR-01",
  })

  assert.equal(created.status, 200)

  const foreignId = created.body.branch.id

  const refused = await call(
    cookies,

    "PUT",

    `/api/users/${agent.id}/branches`,

    {
      branchIds: [foreignId],
    },
  )

  assert.equal(refused.status, 400, "a foreign office id must be refused")

  const unchanged = await memberByEmail(cookies, "sales.agent@deedorbit.com")

  assert.deepEqual(
    unchanged.branchIds,

    [],

    "a refused grant must not store a partial scope",
  )

  getDb().prepare("DELETE FROM branches WHERE tenant_id = ?").run(otherTenantId)
})

test("a malformed office grant is refused without changing the row", async () => {
  const { cookies } = await signIn("admin@deedorbit.com")

  const list = await call(cookies, "GET", "/api/users")

  const hq = rows<Json>(list.body.branches, "branches")[0]

  assert.ok(hq)

  const agent = await memberByEmail(cookies, "sales.agent@deedorbit.com")

  await call(cookies, "PUT", `/api/users/${agent.id}/branches`, {
    branchIds: [hq.id],
  })

  const refused = await call(
    cookies,

    "PUT",

    `/api/users/${agent.id}/branches`,

    {
      branchIds: "Head Office",
    },
  )

  assert.equal(refused.status, 400)

  const unchanged = await memberByEmail(cookies, "sales.agent@deedorbit.com")

  assert.deepEqual(unchanged.branchIds, [hq.id], "the row is untouched")

  await call(cookies, "PUT", `/api/users/${agent.id}/branches`, {
    branchIds: [],
  })
})

test("office scope, forced reset, and activity need the matching users grant", async () => {
  // A sales agent holds no users grant at all, so this proves the routes are

  // refused for want of permission rather than for want of a body.

  const { cookies } = await signIn("sales.agent@deedorbit.com")

  const member = get<{ id: string }>(
    "SELECT id FROM users WHERE email = ?",

    "admin@deedorbit.com",
  )

  assert.ok(member)

  const writes = await Promise.all([
    call(cookies, "PUT", `/api/users/${member.id}/branches`, { branchIds: [] }),

    call(cookies, "POST", `/api/users/${member.id}/force-password-reset`),

    call(cookies, "GET", `/api/users/${member.id}/activity`),

    call(cookies, "GET", "/api/users"),
  ])

  for (const write of writes) {
    assert.equal(write.status, 403, "a member without users.* must be refused")

    assert.equal(write.body.error.code, "permission_denied")
  }
})

test("forcing a reset signs the member out and blocks sign-in until one is set", async () => {
  const { cookies: adminCookies } = await signIn("admin@deedorbit.com")

  // The member proves the demo password works before it is retired.

  const { cookies: agentCookies } = await signIn("sales.agent@deedorbit.com")

  const live = await call(agentCookies, "GET", "/api/auth/session")

  assert.equal(live.body.authenticated, true)

  const agent = await memberByEmail(adminCookies, "sales.agent@deedorbit.com")

  assert.equal(agent.mustResetPassword, false)

  const forced = await call(
    adminCookies,

    "POST",

    `/api/users/${agent.id}/force-password-reset`,
  )

  assert.equal(forced.status, 200)

  assert.equal(forced.body.ok, true)

  assert.ok(forced.body.devResetToken, "the reset token is exposed in dev")

  assert.ok(
    forced.body.revokedSessions >= 1,

    "every live session is revoked, including the one this test opened",
  )

  // Access stops now, not when the session would have expired.

  const afterRevoke = await call(agentCookies, "GET", "/api/auth/session")

  assert.equal(
    afterRevoke.body.authenticated,

    false,

    "the session that was open must be refused",
  )

  const flagged = await memberByEmail(adminCookies, "sales.agent@deedorbit.com")

  assert.equal(flagged.mustResetPassword, true)

  assert.ok(flagged.passwordResetRequiredAt, "the flag records when it was set")

  // The retired password is refused, and the answer carries a way forward —

  // the password was correct, so this is the member and not a guesser.

  const relogin = await call(jar(), "POST", "/api/auth/login", {
    email: "sales.agent@deedorbit.com",

    password: DEMO_PASSWORD,
  })

  assert.equal(relogin.status, 200)

  assert.equal(relogin.body.authenticated, false)

  assert.equal(relogin.body.passwordResetRequired, true)

  assert.ok(relogin.body.resetToken, "a single-use token is issued")

  // No session cookie: the flag has to be satisfied before anything opens.

  const session = await call(jar(), "GET", "/api/auth/session")

  assert.equal(session.body.authenticated, false)

  const reset = await call(jar(), "POST", "/api/auth/reset-password", {
    token: relogin.body.resetToken,

    password: "Agent-New-Pass-2026",
  })

  assert.equal(reset.status, 200)

  const signedIn = await call(jar(), "POST", "/api/auth/login", {
    email: "sales.agent@deedorbit.com",

    password: "Agent-New-Pass-2026",
  })

  assert.equal(signedIn.status, 200)

  assert.equal(signedIn.body.authenticated, true)

  const cleared = await memberByEmail(adminCookies, "sales.agent@deedorbit.com")

  assert.equal(
    cleared.mustResetPassword,

    false,

    "the flag clears with the password, in the same step",
  )

  assert.equal(cleared.passwordResetRequiredAt, null)

  // Leave the fixture as found: every later sign-in uses the demo password.

  // Written straight to the column rather than through `reset-password`,

  // because the seeded demo password is deliberately below the policy that the

  // endpoint enforces ("deedorbit-erp-2026" has no uppercase letter).

  const now2 = new Date().toISOString()

  run(
    `UPDATE users
        SET password_hash = ?, must_reset_password = 0, password_reset_required_at = NULL,
            failed_login_count = 0, locked_until = NULL, updated_at = ?
      WHERE id = ?`,

    hashPassword(DEMO_PASSWORD),

    now2,

    agent.id,
  )

  run("DELETE FROM password_reset_tokens WHERE user_id = ?", agent.id)

  const restored2 = await call(jar(), "POST", "/api/auth/login", {
    email: "sales.agent@deedorbit.com",

    password: DEMO_PASSWORD,
  })

  assert.equal(
    restored2.body.authenticated,

    true,

    "the member can sign in with the demo password again",
  )
})

test("a reset cannot be forced on a member who has never signed in", async () => {
  const { cookies } = await signIn("admin@deedorbit.com")

  const invite = await call(cookies, "POST", "/api/users/invite", {
    email: "pending.reset@deedorbit.com",

    fullName: "Pending Reset",

    roleId: "sales_agent",
  })

  assert.equal(invite.status, 200)

  const invited = await memberByEmail(cookies, "pending.reset@deedorbit.com")

  assert.equal(invited.status, "invited")

  const refused = await call(
    cookies,

    "POST",

    `/api/users/${invited.id}/force-password-reset`,
  )

  assert.equal(refused.status, 422)

  assert.equal(
    invited.status,

    "invited",

    "an invited member has no password yet",
  )
})

test("the activity timeline reports sign-in attempts and the actions taken", async () => {
  const { cookies } = await signIn("admin@deedorbit.com")

  const agent = await memberByEmail(cookies, "sales.agent@deedorbit.com")

  const activity = await call(cookies, "GET", `/api/users/${agent.id}/activity`)

  assert.equal(activity.status, 200)

  assert.equal(activity.body.member.email, "sales.agent@deedorbit.com")

  assert.equal(activity.body.member.roleLabel, agent.roleLabel)

  assert.deepEqual(activity.body.member.branchNames, [])

  assert.ok(Array.isArray(activity.body.sessions))

  const outcomes = rows<Json>(activity.body.events, "events").map(
    (event) => event.outcome,
  )

  assert.ok(
    outcomes.includes("reset_required"),

    "a forced reset belongs on the timeline: " + JSON.stringify(outcomes),
  )

  assert.ok(outcomes.includes("success"), "sign-ins belong on the timeline")

  const actions = rows<Json>(activity.body.actions, "actions")

  assert.ok(
    actions.some((a: Json) => a.action === "user.password_reset_forced"),

    "the administrator's own action is on the timeline",
  )

  assert.ok(
    actions.every((a: Json) => a.createdAt),

    "every action carries a timestamp",
  )
})

test("failed sign-ins are recorded, counted on the row, and never leak across workspaces", async () => {
  const { cookies } = await signIn("admin@deedorbit.com")

  const agent = await memberByEmail(cookies, "sales.agent@deedorbit.com")

  const before = agent.recentFailedLogins

  const failed = await call(jar(), "POST", "/api/auth/login", {
    email: "sales.agent@deedorbit.com",

    password: "not-the-password",
  })

  assert.equal(failed.status, 401)

  // The generic message is unchanged: history must not turn the login form into

  // an oracle for whether the address exists.

  assert.match(String(failed.body.error.message), /incorrect/i)

  const after = await memberByEmail(cookies, "sales.agent@deedorbit.com")

  assert.equal(after.recentFailedLogins, before + 1)

  const activity = await call(cookies, "GET", `/api/users/${agent.id}/activity`)

  const outcomes = rows<Json>(activity.body.events, "events").map(
    (event) => event.outcome,
  )

  assert.ok(
    outcomes.includes("failed"),

    "the failed attempt is on the timeline",
  )

  // A member id from this workspace cannot be read by another workspace.

  const signup = await call(jar(), "POST", "/api/auth/signup", {
    email: "org.activity@example.com",

    fullName: "Org Activity",

    workspaceName: "Org Activity Ltd",

    password: "Org-Activity-2026",
  })

  assert.equal(signup.status, 200)

  const { cookies: otherCookies } = await signIn(
    "org.activity@example.com",

    "Org-Activity-2026",
  )

  const crossRead = await call(
    otherCookies,

    "GET",

    `/api/users/${agent.id}/activity`,
  )

  assert.equal(
    crossRead.status,

    404,

    "a foreign member id is indistinguishable",
  )
})

test("a refused sign-in is recorded once, under its own outcome", async () => {
  const { cookies } = await signIn("admin@deedorbit.com")

  const agent = await memberByEmail(cookies, "sales.agent@deedorbit.com")

  await call(cookies, "POST", `/api/users/${agent.id}/status`, {
    status: "suspended",
  })

  // One attempt is one row. Filing a suspended sign-in as both `suspended` and

  // `failed` would make the member's timeline claim two attempts where the

  // administrator made one, which is the whole thing the timeline is for.

  // Marked by rowid rather than by a time window, because the whole suite runs

  // inside a few seconds and a window would catch its neighbours.

  const marker =
    all<{ rowid: number }>(
      `SELECT rowid FROM login_events
        WHERE tenant_id = ? AND user_id = ?
        ORDER BY rowid DESC LIMIT 1`,

      "tn_deedorbit_holdings",

      agent.id,
    )[0]?.rowid ?? 0

  const refused = await call(jar(), "POST", "/api/auth/login", {
    email: "sales.agent@deedorbit.com",

    password: DEMO_PASSWORD,
  })

  assert.equal(refused.status, 401)

  const events = all<{ outcome: string }>(
    `SELECT outcome FROM login_events
      WHERE tenant_id = ? AND user_id = ? AND rowid > ?
      ORDER BY rowid`,

    "tn_deedorbit_holdings",

    agent.id,

    marker,
  )

  assert.deepEqual(
    events.map((row) => row.outcome),

    ["suspended"],
  )

  await call(cookies, "POST", `/api/users/${agent.id}/status`, {
    status: "active",
  })
})

test("sign-in history survives a repeat login and records the device", async () => {
  const { cookies: adminCookies } = await signIn("admin@deedorbit.com")

  const member = await memberByEmail(
    adminCookies,

    "sales.manager@deedorbit.com",
  )

  // A known address with no session yet, so this is its first recorded attempt.

  await call(jar(), "POST", "/api/auth/login", {
    email: "sales.manager@deedorbit.com",

    password: "wrong-on-purpose",
  })

  const { cookies } = await signIn("sales.manager@deedorbit.com")

  const activity = await call(
    adminCookies,

    "GET",

    `/api/users/${member.id}/activity`,
  )

  assert.equal(activity.status, 200)

  const events = rows<Json>(activity.body.events, "events")

  assert.ok(events.length >= 2, "both attempts are recorded, oldest last")

  assert.equal(
    events[0].outcome,

    "success",

    "the newest attempt is the sign-in",
  )

  assert.equal(events[0].success, true)

  assert.equal(events[1].outcome, "failed")

  // Ordering is part of the contract: an activity log that mixes up "before" and

  // "after" is worse than no log at all.

  assert.ok(
    Date.parse(events[0].createdAt) >= Date.parse(events[1].createdAt),

    "events must come back newest first",
  )

  assert.ok(cookies.header().includes("deedorbit_session"))
})

test("deactivating a member clears their office scope and reset flag", async () => {
  const { cookies } = await signIn("admin@deedorbit.com")

  const list = await call(cookies, "GET", "/api/users")

  const hq = rows<Json>(list.body.branches, "branches")[0]

  assert.ok(hq)

  const invite = await call(cookies, "POST", "/api/users/invite", {
    email: "scope.reinvite@deedorbit.com",

    fullName: "Scope Reinvite",

    roleId: "sales_agent",
  })

  assert.equal(invite.status, 200)

  const invited = await memberByEmail(cookies, "scope.reinvite@deedorbit.com")

  await call(cookies, "PUT", `/api/users/${invited.id}/branches`, {
    branchIds: [hq.id],
  })

  const scoped = all<{ count: number }>(
    "SELECT COUNT(*) AS count FROM user_branches WHERE tenant_id = ? AND user_id = ?",

    "tn_deedorbit_holdings",

    invited.id,
  )

  assert.equal(scoped[0]?.count, 1)

  const removed = await call(
    cookies,

    "POST",

    `/api/users/${invited.id}/status`,

    { status: "deactivated" },
  )

  assert.equal(removed.status, 200)

  // The shell can be re-invited, so stale scope must not survive the membership.

  const cleared = all<{ count: number }>(
    "SELECT COUNT(*) AS count FROM user_branches WHERE tenant_id = ? AND user_id = ?",

    "tn_deedorbit_holdings",

    invited.id,
  )

  assert.equal(
    cleared[0]?.count,

    0,

    "the office scope goes with the membership",
  )

  const flag = get<{ must_reset_password: number }>(
    "SELECT must_reset_password FROM users WHERE id = ?",

    invited.id,
  )

  assert.equal(flag?.must_reset_password, 0)
})

test("the user access control migration is re-runnable", async () => {
  getDb()

  const db = getDb()

  addUserAccessControlColumns(db)

  addUserAccessControlColumns(db)

  const present = new Set(
    all<{ name: string }>(`SELECT name FROM pragma_table_info('users')`).map(
      (row) => row.name,
    ),
  )

  for (const column of userAccessControlColumns) {
    assert.ok(present.has(column.name), `missing column ${column.name}`)
  }

  const tables = new Set(
    all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table'",
    ).map((row) => row.name),
  )

  assert.ok(tables.has("user_branches"))

  assert.ok(tables.has("login_events"))
})

// ---------------------------------------------------------------------------

// Organization client/server contract

// ---------------------------------------------------------------------------

/**
 * The client in `src/lib/organization-api.ts` is hand-written, so nothing in
 * the compiler stops the server and the client from drifting apart: a renamed
 * field would still typecheck and then read `undefined` in the browser.
 *
 * `keysOf` closes that gap from both ends at once. Listing the fields in an
 * object literal fails to compile if the interface gains or loses a member, so
 * the client side is covered statically. The runtime assertion then checks the
 * live response carries exactly those keys, which covers the server side.
 * Renaming a column in `toSettings` or a view field therefore fails a test
 * rather than a user.
 */

function keysOf<T>(expected: Record<keyof T, true>): string[] {
  return Object.keys(expected)
}

function assertExactKeys(
  label: string,

  actual: Json,

  expected: readonly string[],
): void {
  assert.deepEqual(
    Object.keys(actual).sort(),

    [...expected].sort(),

    `${label} response shape drifted from the client contract`,
  )
}

const SETTINGS_KEYS = keysOf<OrganizationSettings>({
  id: true,

  name: true,

  legalName: true,

  slug: true,

  status: true,

  plan: true,

  logoInitials: true,

  currency: true,

  timezone: true,

  registrationNumber: true,

  taxId: true,

  addressLine1: true,

  addressLine2: true,

  city: true,

  stateRegion: true,

  postalCode: true,

  countryCode: true,

  phone: true,

  collectionsEmail: true,

  fiscalYearStartMonth: true,

  workingDays: true,

  ocrCaptureEnabled: true,

  logo: true,

  createdAt: true,

  updatedAt: true,

  userCount: true,

  activeUsers: true,
})

const BRANCH_KEYS = keysOf<BranchView>({
  id: true,

  name: true,

  code: true,

  isHeadquarters: true,

  addressLine1: true,

  addressLine2: true,

  city: true,

  stateRegion: true,

  postalCode: true,

  countryCode: true,

  phone: true,

  email: true,

  status: true,

  createdAt: true,

  updatedAt: true,
})

const NUMBERING_KEYS = keysOf<NumberingSettings>({
  formats: true,

  fiscalYear: true,

  fiscalYearStartsIn: true,

  canEdit: true,
})

const NUMBER_FORMAT_KEYS = keysOf<NumberFormat>({
  kind: true,

  label: true,

  prefix: true,

  padding: true,

  nextValue: true,

  resetYearly: true,

  updatedAt: true,

  preview: true,
})

const USERS_RESPONSE_KEYS = keysOf<UsersResponse>({
  users: true,

  roleCounts: true,

  branches: true,
})

const MEMBER_KEYS = keysOf<TenantUser>({
  id: true,

  email: true,

  fullName: true,

  phone: true,

  jobTitle: true,

  status: true,

  twofaEnabled: true,

  lastLoginAt: true,

  createdAt: true,

  mustResetPassword: true,

  passwordResetRequiredAt: true,

  recentFailedLogins: true,

  roleId: true,

  roleLabel: true,

  roleRank: true,

  isDefault: true,

  activeSessions: true,

  branchIds: true,

  branchNames: true,

  branchAccess: true,

  pendingInvite: true,
})

/** The `{ ok, user }` envelope every member write returns. */

const OK_USER_KEYS = ["ok", "user"]

test("organization responses match the client contract exactly", async () => {
  const { cookies } = await signIn("admin@deedorbit.com")

  const settings = (await call(cookies, "GET", "/api/settings/organization"))
    .body

  assertExactKeys("GET /api/settings/organization", settings, ["settings"])

  assertExactKeys(
    "GET /api/settings/organization settings",

    record(settings.settings, "settings"),

    SETTINGS_KEYS,
  )

  const branchList = (await call(cookies, "GET", "/api/settings/branches")).body

  assertExactKeys("GET /api/settings/branches", branchList, [
    "branches",

    "canEdit",
  ])

  const branches = rows<Json>(branchList.branches)

  assert.ok(branches.length > 0, "seed should provide at least one office")

  assertExactKeys("branch", record(branches[0], "branch"), BRANCH_KEYS)

  const single = (
    await call(cookies, "GET", `/api/settings/branches/${branches[0].id}`)
  ).body

  assertExactKeys("GET /api/settings/branches/:id", single, ["branch"])

  const numbering = (await call(cookies, "GET", "/api/settings/numbering")).body

  assertExactKeys("GET /api/settings/numbering", numbering, NUMBERING_KEYS)

  const formats = rows<Json>(numbering.formats)

  assert.equal(formats.length, NUMBER_KINDS.length)

  assertExactKeys(
    "numbering format",

    record(formats[0], "numbering format"),

    NUMBER_FORMAT_KEYS,
  )
})

test("the numbering save returns the same shape as the read", async () => {
  const { cookies } = await signIn("admin@deedorbit.com")

  const before = (await call(cookies, "GET", "/api/settings/numbering")).body

  const formats = rows<Json>(before.formats).map((format) => ({
    kind: format.kind,

    prefix: format.prefix,

    padding: format.padding,

    resetYearly: format.resetYearly,
  }))

  const saved = await call(cookies, "PUT", "/api/settings/numbering", {
    formats,
  })

  assert.equal(saved.status, 200)

  // The UI re-reads `canEdit` after a save, so a save that dropped the flag

  // would silently downgrade the form to read-only.

  assertExactKeys("PUT /api/settings/numbering", saved.body, NUMBERING_KEYS)

  assert.equal(saved.body.canEdit, true)
})

test("member responses match the client contract exactly", async () => {
  const { cookies } = await signIn("admin@deedorbit.com")

  const list = await call(cookies, "GET", "/api/users")

  assertExactKeys("GET /api/users", list.body, USERS_RESPONSE_KEYS)

  const members = rows(list.body.users, "users")

  assert.ok(members.length > 0)

  assertExactKeys("TenantUser", record(members[0], "member"), MEMBER_KEYS)

  // The office fields are the ones a rename would silently break: an empty

  // scope must read as "all" rather than as a missing value.

  const scoped = members.find((u: Json) => u.branchAccess === "limited")

  if (scoped) {
    assert.ok(Array.isArray(scoped.branchIds))

    assert.equal(scoped.branchIds.length, scoped.branchNames.length)

    assert.notEqual(scoped.branchIds.length, 0)
  } else {
    assert.equal(members[0].branchAccess, "all")

    assert.deepEqual(members[0].branchIds, [])
  }
})

test("the member write routes return the same member shape as the read", async () => {
  const { cookies } = await signIn("admin@deedorbit.com")

  const list = await call(cookies, "GET", "/api/users")

  const branches = rows<Json>(list.body.branches, "branches")

  const hq = branches[0]

  assert.ok(hq)

  const agent = rows<Json>(list.body.users, "users").find(
    (u: Json) => u.email === "sales.agent@deedorbit.com",
  )

  assert.ok(agent)

  // Each of these returns `{ ok, user }`. If the mapper drifts, the members table

  // would re-render with `undefined` in a cell after a save rather than failing.

  const scoped = await call(cookies, "PUT", `/api/users/${agent.id}/branches`, {
    branchIds: [hq.id],
  })

  assert.equal(scoped.status, 200)

  assertExactKeys("user write", record(scoped.body, "user write"), OK_USER_KEYS)

  const restored = await call(
    cookies,

    "PUT",

    `/api/users/${agent.id}/branches`,

    { branchIds: [] },
  )

  assertExactKeys(
    "user write",

    record(restored.body, "user write"),

    OK_USER_KEYS,
  )
})

// ---------------------------------------------------------------------------

// Projects

// ---------------------------------------------------------------------------

const PROJECT_KEYS = keysOf<ProjectView>({
  id: true,

  name: true,

  code: true,

  developer: true,

  location: true,

  status: true,

  launchDate: true,

  description: true,

  projectType: true,

  ownershipType: true,

  paymentTerms: true,

  handoverDate: true,

  plannedUnits: true,

  createdAt: true,

  updatedAt: true,
})

const PROJECT_LIST_KEYS = keysOf<ProjectList>({
  projects: true,

  totals: true,

  canCreate: true,

  canEdit: true,
})

const PROJECT_DETAIL_KEYS = keysOf<ProjectDetail>({
  project: true,

  canEdit: true,
})

/** ISO date `days` from today, for the launch-window assertions. */

function isoDaysFromNow(days: number): string {
  const date = new Date(Date.now() + days * 86_400_000)

  return date.toISOString().slice(0, 10)
}

test("a project records the developer, location, status, and launch date", async () => {
  const { cookies } = await signIn("projects@deedorbit.com")

  const created = await call(cookies, "POST", "/api/projects", {
    // The operational demo seed owns "Marina Gate Residences", and a name is
    // unique per workspace, so this create-path test uses its own sample.
    name: "Coral Bay Residences",

    code: "MGR-01",

    developer: "Emaar Properties",

    location: "Dubai Marina, Dubai, UAE",

    status: "pre_launch",

    launchDate: isoDaysFromNow(30),

    projectType: "residential",

    ownershipType: "freehold",

    plannedUnits: 480,

    paymentTerms: "20% on booking, monthly over 24 months",

    handoverDate: isoDaysFromNow(900),

    description: "Two-tower residential development on the Marina waterfront.",
  })

  assert.equal(created.status, 200, JSON.stringify(created.body))

  assertExactKeys("POST /api/projects", record(created.body, "project write"), [
    "project",
  ])

  const project = record(created.body.project, "project")

  assertExactKeys("Project", project, PROJECT_KEYS)

  assert.equal(project.name, "Coral Bay Residences")

  assert.equal(project.code, "MGR-01")

  assert.equal(project.developer, "Emaar Properties")

  assert.equal(project.location, "Dubai Marina, Dubai, UAE")

  assert.equal(project.status, "pre_launch")

  assert.equal(project.launchDate, isoDaysFromNow(30))

  assert.equal(project.projectType, "residential")

  assert.equal(project.ownershipType, "freehold")

  assert.equal(project.plannedUnits, 480)

  assert.equal(project.handoverDate, isoDaysFromNow(900))

  // Re-read through the single-resource route, so the detail page is proven to

  // get the same record the create returned rather than a differently-shaped one.

  const read = await call(cookies, "GET", `/api/projects/${project.id}`)

  assert.equal(read.status, 200)

  assertExactKeys(
    "GET /api/projects/:id",

    record(read.body, "project detail"),

    PROJECT_DETAIL_KEYS,
  )

  assert.equal(read.body.canEdit, true)

  const reread = record(read.body.project, "project detail")

  assertExactKeys("Project", reread, PROJECT_KEYS)

  assert.equal(reread.id, project.id)

  assert.deepEqual(reread, project)
})

test("a project with nothing optional is stored without inventing values", async () => {
  const { cookies } = await signIn("projects@deedorbit.com")

  const created = await call(cookies, "POST", "/api/projects", {
    name: "Bare Minimum Plot",

    developer: "Northgate Holdings",

    location: "Lagos, Nigeria",
  })

  assert.equal(created.status, 200, JSON.stringify(created.body))

  const project = record(created.body.project, "project")

  // A project is created the moment a development is real enough to plan

  // against, which is usually before a date or a size is known. Each of these

  // must be an explicit null so the UI can show a dash rather than a zero.

  assert.equal(project.status, "planning")

  assert.equal(project.code, null)

  assert.equal(project.launchDate, null)

  assert.equal(project.handoverDate, null)

  assert.equal(project.projectType, null)

  assert.equal(project.ownershipType, null)

  assert.equal(project.paymentTerms, null)

  assert.equal(project.description, null)

  assert.equal(project.plannedUnits, null)
})

test("the four figures on the list are derived, not stored", async () => {
  const { cookies } = await signIn("projects@deedorbit.com")

  const tenantId = "tn_deedorbit_holdings"

  getDb().prepare("DELETE FROM projects WHERE tenant_id = ?").run(tenantId)

  // Nothing yet, so every figure that would be a count reads as empty. The

  // planned-units tile in particular must not claim the workspace has no units.

  const empty = await call(cookies, "GET", "/api/projects")

  assert.equal(empty.status, 200)

  assertExactKeys(
    "GET /api/projects",

    record(empty.body, "list"),

    PROJECT_LIST_KEYS,
  )

  assert.deepEqual(rows(empty.body.projects, "projects"), [])

  assert.equal(empty.body.totals.total, 0)

  assert.equal(empty.body.totals.onSale, 0)

  assert.equal(empty.body.totals.launchingSoon, 0)

  assert.equal(empty.body.totals.plannedUnits, null)

  await call(cookies, "POST", "/api/projects", {
    name: "On Sale Tower",

    developer: "Emaar Properties",

    location: "Dubai Marina, Dubai, UAE",

    status: "on_sale",

    plannedUnits: 120,
  })

  await call(cookies, "POST", "/api/projects", {
    name: "Launching Soon",

    developer: "Emaar Properties",

    location: "Dubai Hills, Dubai, UAE",

    status: "pre_launch",

    launchDate: isoDaysFromNow(10),

    plannedUnits: 80,
  })

  // Inside the 90-day window, so it counts.

  await call(cookies, "POST", "/api/projects", {
    name: "Also Launching",

    developer: "Sobha Realty",

    location: "Sobha Hartland, Dubai, UAE",

    status: "pre_launch",

    launchDate: isoDaysFromNow(89),
  })

  // Outside the window, so it must not: this is the case that would make the

  // tile overstate how much is imminent.

  await call(cookies, "POST", "/api/projects", {
    name: "Launching Next Year",

    developer: "Meridian Developments",

    location: "Dubai Internet City, Dubai, UAE",

    status: "pre_launch",

    launchDate: isoDaysFromNow(400),
  })

  // A date in the past is not "launching soon" either.

  await call(cookies, "POST", "/api/projects", {
    name: "Overdue Launch",

    developer: "Meridian Developments",

    location: "Jebel Ali, Dubai, UAE",

    status: "pre_launch",

    launchDate: isoDaysFromNow(-30),
  })

  const listed = await call(cookies, "GET", "/api/projects")

  assert.equal(listed.status, 200)

  assert.equal(listed.body.totals.total, 5)

  assert.equal(listed.body.totals.onSale, 1)

  assert.equal(listed.body.totals.launchingSoon, 2)

  // 120 + 80, with the three projects that state no figure contributing nothing.

  assert.equal(listed.body.totals.plannedUnits, 200)

  const projects = rows<Json>(listed.body.projects, "projects")

  assert.equal(projects.length, 5)

  for (const project of projects) {
    assertExactKeys("Project", record(project, "project"), PROJECT_KEYS)
  }

  // Sorted by name, case-insensitively, so the list order does not depend on

  // insertion order.

  const names = projects.map((project) => project.name)

  assert.deepEqual(
    names,

    [...names].sort((a, b) => a.localeCompare(b)),
  )
})

test("a project name and reference are unique per workspace", async () => {
  const { cookies } = await signIn("projects@deedorbit.com")

  const body = {
    name: "Unique Name Project",

    code: "UNQ-1",

    developer: "Emaar Properties",

    location: "Dubai Marina, Dubai, UAE",
  }

  const first = await call(cookies, "POST", "/api/projects", body)

  assert.equal(first.status, 200)

  const id = first.body.project.id

  // Case-insensitive: "unique name project" is the same name for a list's sake.

  const clash = await call(cookies, "POST", "/api/projects", {
    ...body,

    name: "unique name project",
  })

  assert.equal(clash.status, 422)

  assert.equal(clash.body.error.code, "conflict")

  assert.equal(clash.body.error.fields.name, "That name is already in use")

  const codeClash = await call(cookies, "POST", "/api/projects", {
    ...body,

    name: "Different Name Entirely",

    code: "unq-1",
  })

  assert.equal(codeClash.status, 422)

  assert.equal(
    codeClash.body.error.fields.code,

    "That reference is already in use",
  )

  // Renaming a project onto itself must be allowed, or the settings tab could

  // never save a one-character edit.

  const selfRename = await call(cookies, "PATCH", `/api/projects/${id}`, {
    name: "Unique Name Project",
  })

  assert.equal(selfRename.status, 200, JSON.stringify(selfRename.body))

  // A different workspace may use the same name and the same reference.

  const signup = await call(jar(), "POST", "/api/auth/signup", {
    email: "projects.other@example.com",

    fullName: "Other Owner",

    workspaceName: "Other Holdings",

    password: "Other-Owner-2026",
  })

  assert.equal(signup.status, 200)

  const otherTenantId = signup.body.tenant.id

  const { cookies: otherCookies } = await signIn(
    "projects.other@example.com",

    "Other-Owner-2026",
  )

  const theirs = await call(otherCookies, "POST", "/api/projects", body)

  assert.equal(theirs.status, 200, JSON.stringify(theirs.body))

  getDb().prepare("DELETE FROM projects WHERE tenant_id = ?").run(otherTenantId)
})

test("a rejected project write leaves the stored record untouched", async () => {
  const { cookies } = await signIn("projects@deedorbit.com")

  const created = await call(cookies, "POST", "/api/projects", {
    name: "Immutability Probe",

    developer: "Emaar Properties",

    location: "Dubai Marina, Dubai, UAE",

    status: "pre_launch",

    launchDate: isoDaysFromNow(20),

    plannedUnits: 100,
  })

  assert.equal(created.status, 200)

  const id = created.body.project.id

  const before = created.body.project

  // Each body is invalid in one specific way. None may write.

  const rejected = [
    await call(cookies, "PATCH", `/api/projects/${id}`, {
      name: "",
    }),

    await call(cookies, "PATCH", `/api/projects/${id}`, {
      developer: "   ",
    }),

    await call(cookies, "PATCH", `/api/projects/${id}`, {
      status: "delisted",
    }),

    await call(cookies, "PATCH", `/api/projects/${id}`, {
      projectType: "spaceship",
    }),

    await call(cookies, "PATCH", `/api/projects/${id}`, {
      ownershipType: "timeshare",
    }),

    await call(cookies, "PATCH", `/api/projects/${id}`, {
      launchDate: "2026-02-30",
    }),

    await call(cookies, "PATCH", `/api/projects/${id}`, {
      launchDate: "01/03/2026",
    }),

    await call(cookies, "PATCH", `/api/projects/${id}`, {
      plannedUnits: 12.5,
    }),

    await call(cookies, "PATCH", `/api/projects/${id}`, {
      plannedUnits: -4,
    }),

    await call(cookies, "PATCH", `/api/projects/${id}`, {
      plannedUnits: 1000000,
    }),

    await call(cookies, "PATCH", `/api/projects/${id}`, {
      code: "not a code",
    }),

    await call(cookies, "PATCH", `/api/projects/${id}`, {
      description: "x".repeat(2001),
    }),
  ]

  for (const result of rejected) {
    assert.equal(result.status, 400, JSON.stringify(result.body))

    assert.equal(result.body.error.code, "bad_request")
  }

  // The specific messages the UI shows under the offending control.

  const nameError = await call(cookies, "PATCH", `/api/projects/${id}`, {
    name: "",
  })

  assert.equal(nameError.body.error.fields.name, "Name the project.")

  const dateError = await call(cookies, "PATCH", `/api/projects/${id}`, {
    launchDate: "2026-02-30",
  })

  assert.equal(
    dateError.body.error.fields.launchDate,

    "Enter the launch date as YYYY-MM-DD.",
  )

  const after = await call(cookies, "GET", `/api/projects/${id}`)

  assert.equal(after.status, 200)

  assert.deepEqual(after.body.project, before)

  // A missing project is a 404, not an empty success.

  const gone = await call(
    cookies,

    "PATCH",

    "/api/projects/prj_does_not_exist",

    { name: "Nope" },
  )

  assert.equal(gone.status, 404)

  assert.equal(gone.body.error.code, "not_found")
})

test("clearing an optional project field is a deliberate act", async () => {
  const { cookies } = await signIn("projects@deedorbit.com")

  const created = await call(cookies, "POST", "/api/projects", {
    name: "Clearable Fields",

    code: "CLR-1",

    developer: "Emaar Properties",

    location: "Dubai Marina, Dubai, UAE",

    status: "pre_launch",

    launchDate: isoDaysFromNow(20),

    projectType: "residential",

    ownershipType: "freehold",

    plannedUnits: 60,

    description: "Something.",
  })

  assert.equal(created.status, 200)

  const id = created.body.project.id

  // Empty string is the form's "blank input", so it has to reach the API as a

  // clear rather than being ignored as "field not sent".

  const cleared = await call(cookies, "PATCH", `/api/projects/${id}`, {
    code: "",

    launchDate: "",

    projectType: "",

    ownershipType: "",

    plannedUnits: "",

    description: "",
  })

  assert.equal(cleared.status, 200, JSON.stringify(cleared.body))

  const project = cleared.body.project

  assert.equal(project.code, null)

  assert.equal(project.launchDate, null)

  assert.equal(project.projectType, null)

  assert.equal(project.ownershipType, null)

  assert.equal(project.plannedUnits, null)

  assert.equal(project.description, null)

  // Clearing must not disturb the fields that were not sent.

  assert.equal(project.name, "Clearable Fields")

  assert.equal(project.developer, "Emaar Properties")

  assert.equal(project.status, "pre_launch")

  // The required fields cannot be cleared at all.

  for (const key of ["name", "developer", "location"]) {
    const refused = await call(cookies, "PATCH", `/api/projects/${id}`, {
      [key]: "",
    })

    assert.equal(refused.status, 400, `${key} was allowed to be cleared`)

    assert.ok(refused.body.error.fields[key])
  }
})

test("project reads and writes need the matching grant", async () => {
  const tenantId = "tn_deedorbit_holdings"

  const { cookies: ownerCookies } = await signIn("superadmin@deedorbit.com")

  const seeded = await call(ownerCookies, "POST", "/api/projects", {
    name: "Permission Probe",

    developer: "Emaar Properties",

    location: "Dubai Marina, Dubai, UAE",
  })

  assert.equal(seeded.status, 200, JSON.stringify(seeded.body))

  const id = seeded.body.project.id

  // A role holding only `projects.view`: reads must work and every write must

  // be refused. The bodies are valid so a 403 proves the check fired rather

  // than a validator rejecting the request first.

  getDb()

    .prepare(
      `INSERT OR REPLACE INTO role_permission_overrides
         (tenant_id, role_id, permission_id, effect, updated_at)
       VALUES
         (?, 'sales_agent', 'projects.view', 'allow', ?),
         (?, 'sales_agent', 'projects.create', 'deny', ?),
         (?, 'sales_agent', 'projects.edit', 'deny', ?)`,
    )

    .run(
      tenantId,

      new Date().toISOString(),

      tenantId,

      new Date().toISOString(),

      tenantId,

      new Date().toISOString(),
    )

  invalidateGrantCache(tenantId)

  try {
    const { cookies } = await signIn("sales.agent@deedorbit.com")

    const list = await call(cookies, "GET", "/api/projects")

    assert.equal(list.status, 200)

    // The UI hides "New project" off this flag, so a wrong `true` would offer a

    // control that is guaranteed to fail.

    assert.equal(list.body.canCreate, false)

    assert.equal(list.body.canEdit, false)

    const read = await call(cookies, "GET", `/api/projects/${id}`)

    assert.equal(read.status, 200)

    assert.equal(read.body.canEdit, false)

    const writes = await Promise.all([
      call(cookies, "POST", "/api/projects", {
        name: "Should Not Exist",

        developer: "Someone",

        location: "Somewhere",
      }),

      call(cookies, "PATCH", `/api/projects/${id}`, { name: "Hijacked" }),
    ])

    for (const write of writes) {
      assert.equal(write.status, 403)

      assert.equal(write.body.error.code, "permission_denied")
    }

    // The refusals must not have written anything.

    const stillNamed = await call(ownerCookies, "GET", `/api/projects/${id}`)

    assert.equal(stillNamed.body.project.name, "Permission Probe")

    assert.equal(
      rows(
        (await call(ownerCookies, "GET", "/api/projects")).body.projects,

        "projects",
      ).filter((project) => project.name === "Should Not Exist").length,

      0,
    )
  } finally {
    getDb()

      .prepare(
        `DELETE FROM role_permission_overrides
           WHERE tenant_id = ? AND role_id = 'sales_agent'
             AND permission_id IN ('projects.view','projects.create','projects.edit')`,
      )

      .run(tenantId)

    invalidateGrantCache(tenantId)
  }

  // A signed-out caller gets nothing at all.

  const anonymous = await call(null, "GET", "/api/projects")

  assert.equal(anonymous.status, 401)
})

test("a project from another workspace is neither listed nor readable", async () => {
  const { cookies } = await signIn("projects@deedorbit.com")

  const signup = await call(jar(), "POST", "/api/auth/signup", {
    email: "projects.scope@example.com",

    fullName: "Scoped Owner",

    workspaceName: "Scoped Holdings",

    password: "Scoped-Owner-2026",
  })

  assert.equal(signup.status, 200)

  const otherTenantId = signup.body.tenant.id

  const { cookies: otherCookies } = await signIn(
    "projects.scope@example.com",

    "Scoped-Owner-2026",
  )

  const theirs = await call(otherCookies, "POST", "/api/projects", {
    name: "Private Development",

    developer: "Other Developer",

    location: "Abuja, Nigeria",
  })

  assert.equal(theirs.status, 200, JSON.stringify(theirs.body))

  const theirId = theirs.body.project.id

  // Not in the list.

  const mine = await call(cookies, "GET", "/api/projects")

  assert.equal(
    rows(mine.body.projects, "projects").some(
      (project) => project.id === theirId,
    ),

    false,
  )

  // Not readable by id — a project in another workspace is indistinguishable

  // from one that does not exist, so this cannot be used to probe for ids.

  const read = await call(cookies, "GET", `/api/projects/${theirId}`)

  assert.equal(read.status, 404)

  assert.equal(read.body.error.code, "not_found")

  // Not writable by id either.

  const write = await call(cookies, "PATCH", `/api/projects/${theirId}`, {
    name: "Mine Now",
  })

  assert.equal(write.status, 404)

  // Their record is untouched by the attempt.

  const stillTheirs = await call(
    otherCookies,

    "GET",

    `/api/projects/${theirId}`,
  )

  assert.equal(stillTheirs.body.project.name, "Private Development")

  getDb().prepare("DELETE FROM projects WHERE tenant_id = ?").run(otherTenantId)
})

test("the projects migration is re-runnable", async () => {
  getDb()

  const db = getDb()

  const indexes = () =>
    all<{ name: string }>(
      `SELECT name FROM sqlite_master
        WHERE type = 'index' AND tbl_name = 'projects'
        ORDER BY name`,
    ).map((row) => row.name)

  // The unique name and code indexes are the constraint doing the real work, so

  // their continued presence is what a second run has to prove.

  const before = indexes()

  db.exec(
    readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),

        "migrations",

        "004_projects.sql",
      ),

      "utf8",
    ),
  )

  assert.deepEqual(indexes(), before)

  const columns = new Set(
    all<{ name: string }>("SELECT name FROM pragma_table_info('projects')").map(
      (row) => row.name,
    ),
  )

  for (const column of [
    "tenant_id",

    "name",

    "code",

    "developer",

    "location",

    "status",

    "launch_date",

    "planned_units",
  ]) {
    assert.ok(columns.has(column), `projects is missing ${column}`)
  }

  // A tenant_id column is the whole basis of workspace scoping, so its absence

  // would silently turn every query in the module into a cross-tenant read.

  const businessTables = all<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'projects'`,
  )

  assert.equal(businessTables.length, 1)

  assert.ok(columns.has("tenant_id"))
})

test("a project on sale cannot be dated before the launch already recorded", async () => {
  const { cookies } = await signIn("projects@deedorbit.com")

  const created = await call(cookies, "POST", "/api/projects", {
    name: "Launch Guard",

    developer: "Emaar Properties",

    location: "Dubai Marina, Dubai, UAE",

    status: "pre_launch",

    launchDate: isoDaysFromNow(120),
  })

  assert.equal(created.status, 200)

  const id = created.body.project.id

  const original = created.body.project.launchDate

  // Moving the date backwards is fine while the project is still pre-launch:

  // plans change.

  const earlier = await call(cookies, "PATCH", `/api/projects/${id}`, {
    launchDate: isoDaysFromNow(60),
  })

  assert.equal(earlier.status, 200, JSON.stringify(earlier.body))

  // But the same move while on sale would make a trading project claim to have

  // launched before it did.

  const onSale = await call(cookies, "PATCH", `/api/projects/${id}`, {
    status: "on_sale",
  })

  assert.equal(onSale.status, 200)

  const backwards = await call(cookies, "PATCH", `/api/projects/${id}`, {
    launchDate: isoDaysFromNow(30),
  })

  assert.equal(backwards.status, 422)

  assert.equal(backwards.body.error.code, "conflict")

  const after = await call(cookies, "GET", `/api/projects/${id}`)

  assert.equal(after.body.project.launchDate, isoDaysFromNow(60))

  assert.equal(after.body.project.status, "on_sale")

  // Reverting the status releases the date, so the guard is not a dead end.

  const revert = await call(cookies, "PATCH", `/api/projects/${id}`, {
    status: "pre_launch",

    launchDate: original,
  })

  assert.equal(revert.status, 200, JSON.stringify(revert.body))

  assert.equal(revert.body.project.launchDate, original)
})

// ---------------------------------------------------------------------------

// Project structure: the tree inside one project

// ---------------------------------------------------------------------------

const NODE_KEYS = keysOf<ProjectStructureNode>({
  id: true,

  parentId: true,

  kind: true,

  name: true,

  sortOrder: true,

  childCount: true,

  createdAt: true,

  updatedAt: true,
})

const STRUCTURE_LIST_KEYS = keysOf<ProjectStructureResponse>({
  nodes: true,

  canEdit: true,
})

/** Creates a project and returns its id, for tests that only need somewhere to hang a tree. */

async function projectFor(cookies: CookieJar, name: string): Promise<string> {
  const created = await call(cookies, "POST", "/api/projects", {
    name,

    developer: "Emaar Properties",

    location: "Dubai Marina, Dubai, UAE",
  })

  assert.equal(created.status, 200, JSON.stringify(created.body))

  return created.body.project.id
}

async function addNode(
  cookies: CookieJar,

  projectId: string,

  body: Record<string, unknown>,
): Promise<CallResult> {
  return await call(
    cookies,

    "POST",

    `/api/projects/${projectId}/structure`,

    body,
  )
}

test("a structure node records its kind, parent, and position", async () => {
  const { cookies } = await signIn("projects@deedorbit.com")

  const projectId = await projectFor(cookies, "Structure Contract Plot")

  const towerA = await addNode(cookies, projectId, {
    name: "Tower A",

    kind: "block",
  })

  assert.equal(towerA.status, 200, JSON.stringify(towerA.body))

  assertExactKeys("POST structure", record(towerA.body, "create"), ["node"])

  assertExactKeys("StructureNode", record(towerA.body.node, "node"), NODE_KEYS)

  assert.equal(towerA.body.node.name, "Tower A")

  assert.equal(towerA.body.node.kind, "block")

  // Directly under the project, so there is no parent — the UI draws these as roots.

  assert.equal(towerA.body.node.parentId, null)

  assert.equal(towerA.body.node.sortOrder, 0)

  assert.equal(towerA.body.node.childCount, 0)

  // Appended, so the second root lands after the first rather than ahead of it.

  const towerB = await addNode(cookies, projectId, {
    name: "Tower B",

    kind: "block",
  })

  assert.equal(towerB.body.node.sortOrder, 1)

  // A child records its parent, and the parent learns it has a child. The client

  // builds the whole tree from this one response, so `childCount` has to arrive

  // with the node rather than needing a query per row.

  const sector = await addNode(cookies, projectId, {
    name: "North Sector",

    kind: "sector",

    parentId: towerA.body.node.id,
  })

  assert.equal(sector.body.node.parentId, towerA.body.node.id)

  assert.equal(sector.body.node.sortOrder, 0)

  const listed = await call(
    cookies,

    "GET",

    `/api/projects/${projectId}/structure`,
  )

  assert.equal(listed.status, 200)

  assertExactKeys(
    "GET structure",

    record(listed.body, "structure list"),

    STRUCTURE_LIST_KEYS,
  )

  assert.equal(listed.body.canEdit, true)

  const nodes = rows<ProjectStructureNode>(listed.body.nodes, "nodes")

  assert.equal(nodes.length, 3)

  const tower = nodes.find((node) => node.id === towerA.body.node.id)

  assert.equal(tower?.childCount, 1)

  assert.equal(
    nodes.find((node) => node.id === towerB.body.node.id)?.childCount,

    0,
  )
})

test("nesting stops at the depth cap and says so", async () => {
  const { cookies } = await signIn("projects@deedorbit.com")

  const projectId = await projectFor(cookies, "Deep Structure Plot")

  // Walk down to the cap: a node at level 1 is directly under the project.

  let parentId: string | null = null

  let depth = 1

  while (depth <= STRUCTURE_MAX_DEPTH) {
    const added = await addNode(cookies, projectId, {
      name: `Level ${depth}`,

      kind: "sector",

      ...(parentId ? { parentId } : {}),
    })

    assert.equal(added.status, 200, JSON.stringify(added.body))

    parentId = added.body.node.id

    depth += 1
  }

  // One past it is refused, and the message names the limit rather than saying

  // "invalid parent" — the user has done nothing wrong except build something

  // implausibly deep.

  const tooDeep = await addNode(cookies, projectId, {
    name: "One level too far",

    kind: "floor",

    parentId,
  })

  assert.equal(tooDeep.status, 400)

  assert.equal(
    tooDeep.body.error.fields.parentId,

    `Structure is limited to ${STRUCTURE_MAX_DEPTH} levels`,
  )

  // Nothing was written, so the tree is still exactly at the cap.

  const listed = await call(
    cookies,

    "GET",

    `/api/projects/${projectId}/structure`,
  )

  assert.equal(rows(listed.body.nodes, "nodes").length, STRUCTURE_MAX_DEPTH)
})

test("a duplicate sibling name is refused, case-insensitively", async () => {
  const { cookies } = await signIn("projects@deedorbit.com")

  const projectId = await projectFor(cookies, "Duplicate Name Plot")

  const towerA = await addNode(cookies, projectId, {
    name: "Tower A",

    kind: "block",
  })

  assert.equal(towerA.status, 200)

  // Same parent, different case. Two "Tower A" rows under one parent make the tree

  // ambiguous and leave the user guessing which one a unit belongs to.

  const clash = await addNode(cookies, projectId, {
    name: "tower a",

    kind: "block",
  })

  assert.equal(clash.status, 422)

  assert.equal(clash.body.error.code, "conflict")

  // The same name under a *different* parent is not a clash, which is the whole

  // reason the check is per-parent rather than per-project.

  const childOfA = await addNode(cookies, projectId, {
    name: "Tower A",

    kind: "sector",

    parentId: towerA.body.node.id,
  })

  assert.equal(childOfA.status, 200, JSON.stringify(childOfA.body))
})

test("renaming touches one node and leaves its kind alone when unsent", async () => {
  const { cookies } = await signIn("projects@deedorbit.com")

  const projectId = await projectFor(cookies, "Rename Plot")

  const floor = await addNode(cookies, projectId, {
    name: "Ground",

    kind: "floor",
  })

  const renamed = await call(
    cookies,

    "PATCH",

    `/api/projects/${projectId}/structure/${floor.body.node.id}`,

    { name: "Level 00" },
  )

  assert.equal(renamed.status, 200, JSON.stringify(renamed.body))

  assert.equal(renamed.body.node.name, "Level 00")

  // The kind was not part of the request, so it must not have been reset to the

  // form's default — a rename that quietly turned a floor into a block would be

  // data loss dressed as a convenience.

  assert.equal(renamed.body.node.kind, "floor")

  // Renaming a node to a name a sibling already holds is refused.

  const other = await addNode(cookies, projectId, {
    name: "Rooftop",

    kind: "floor",
  })

  assert.equal(other.status, 200)

  const clash = await call(
    cookies,

    "PATCH",

    `/api/projects/${projectId}/structure/${other.body.node.id}`,

    { name: "Level 00" },
  )

  assert.equal(clash.status, 422)

  const listed = await call(
    cookies,

    "GET",

    `/api/projects/${projectId}/structure`,
  )

  assert.deepEqual(
    rows<ProjectStructureNode>(listed.body.nodes, "nodes")

      .map((node) => node.name)

      .sort(),

    ["Level 00", "Rooftop"],
  )

  // An empty name is refused against the field the user can fix.

  const blank = await call(
    cookies,

    "PATCH",

    `/api/projects/${projectId}/structure/${other.body.node.id}`,

    { name: "   " },
  )

  assert.equal(blank.status, 400)

  assert.equal(blank.body.error.fields.name, "Name this node.")
})

test("only an empty node can be deleted", async () => {
  const { cookies } = await signIn("projects@deedorbit.com")

  const projectId = await projectFor(cookies, "Delete Plot")

  const tower = await addNode(cookies, projectId, {
    name: "Tower A",

    kind: "block",
  })

  await addNode(cookies, projectId, {
    name: "North Sector",

    kind: "sector",

    parentId: tower.body.node.id,
  })

  await addNode(cookies, projectId, {
    name: "South Sector",

    kind: "sector",

    parentId: tower.body.node.id,
  })

  const refused = await call(
    cookies,

    "DELETE",

    `/api/projects/${projectId}/structure/${tower.body.node.id}`,
  )

  assert.equal(refused.status, 422)

  assert.equal(refused.body.error.code, "conflict")

  // The count is in the message, because "cannot delete" alone tells the user

  // nothing about what to do next.

  assert.match(refused.body.error.message, /2 children/)

  const empty = await addNode(cookies, projectId, {
    name: "Tower B",

    kind: "block",
  })

  const removed = await call(
    cookies,

    "DELETE",

    `/api/projects/${projectId}/structure/${empty.body.node.id}`,
  )

  assert.equal(removed.status, 200, JSON.stringify(removed.body))

  assert.deepEqual(removed.body.deleted, { id: empty.body.node.id })

  const listed = await call(
    cookies,

    "GET",

    `/api/projects/${projectId}/structure`,
  )

  const names = rows<ProjectStructureNode>(listed.body.nodes, "nodes").map(
    (node) => node.name,
  )

  assert.equal(names.includes("Tower B"), false)

  assert.equal(names.includes("Tower A"), true)
})

test("reordering swaps with the sibling above and stops at the ends", async () => {
  const { cookies } = await signIn("projects@deedorbit.com")

  const projectId = await projectFor(cookies, "Reorder Plot")

  const created = []

  for (const name of ["First", "Second", "Third"]) {
    const added = await addNode(cookies, projectId, { name, kind: "block" })

    assert.equal(added.status, 200, JSON.stringify(added.body))

    created.push(added.body.node.id)
  }

  const [first, second, third] = created

  const order = async () =>
    rows<ProjectStructureNode>(
      (await call(cookies, "GET", `/api/projects/${projectId}/structure`)).body
        .nodes,

      "nodes",
    ).map((node) => node.name)

  assert.deepEqual(await order(), ["First", "Second", "Third"])

  // Moving up means "swap with the sibling above", not "go to position 0". The

  // server decides, from the row's real position, so a stale client cannot make

  // two nodes jump.

  await call(
    cookies,

    "PATCH",

    `/api/projects/${projectId}/structure/${third}/move`,

    { direction: "up" },
  )

  assert.deepEqual(await order(), ["First", "Third", "Second"])

  await call(
    cookies,

    "PATCH",

    `/api/projects/${projectId}/structure/${second}/move`,

    { direction: "down" },
  )

  assert.deepEqual(await order(), ["First", "Third", "Second"])

  // Moving the first node up is a no-op rather than an error, because the UI

  // disables that control and a request reaching here means a stale client.

  const atTop = await call(
    cookies,

    "PATCH",

    `/api/projects/${projectId}/structure/${first}/move`,

    { direction: "up" },
  )

  assert.equal(atTop.status, 200)

  assert.deepEqual(await order(), ["First", "Third", "Second"])

  const atBottom = await call(
    cookies,

    "PATCH",

    `/api/projects/${projectId}/structure/${second}/move`,

    { direction: "down" },
  )

  assert.equal(atBottom.status, 200)

  assert.deepEqual(await order(), ["First", "Third", "Second"])

  // Ordering is dense and 0-based afterwards, not left with gaps.

  const listed = await call(
    cookies,

    "GET",

    `/api/projects/${projectId}/structure`,
  )

  assert.deepEqual(
    rows<ProjectStructureNode>(listed.body.nodes, "nodes").map(
      (node) => node.sortOrder,
    ),

    [0, 1, 2],
  )

  // A direction that is neither up nor down is refused rather than ignored.

  const nonsense = await call(
    cookies,

    "PATCH",

    `/api/projects/${projectId}/structure/${second}/move`,

    { direction: "sideways" },
  )

  assert.equal(nonsense.status, 400)
})

test("reading structure needs projects.view and writing needs projects.edit", async () => {
  const { cookies: manager } = await signIn("projects@deedorbit.com")

  const projectId = await projectFor(manager, "Permission Plot")

  const tower = await addNode(manager, projectId, {
    name: "Tower A",

    kind: "block",
  })

  assert.equal(tower.status, 200)

  const { cookies: agent } = await signIn("sales.agent@deedorbit.com")

  // A view-only role reads the tree...

  const read = await call(agent, "GET", `/api/projects/${projectId}/structure`)

  assert.equal(read.status, 200)

  assert.equal(read.body.canEdit, false)

  assert.equal(rows(read.body.nodes, "nodes").length, 1)

  // ...and cannot change any of it.

  const create = await addNode(agent, projectId, {
    name: "Tower B",

    kind: "block",
  })

  assert.equal(create.status, 403)

  assert.equal(create.body.error.code, "permission_denied")

  const rename = await call(
    agent,

    "PATCH",

    `/api/projects/${projectId}/structure/${tower.body.node.id}`,

    { name: "Renamed" },
  )

  assert.equal(rename.status, 403)

  const move = await call(
    agent,

    "PATCH",

    `/api/projects/${projectId}/structure/${tower.body.node.id}/move`,

    { direction: "up" },
  )

  assert.equal(move.status, 403)

  const remove = await call(
    agent,

    "DELETE",

    `/api/projects/${projectId}/structure/${tower.body.node.id}`,
  )

  assert.equal(remove.status, 403)

  // A tenant admin holds projects.edit but not projects.create, and must still be

  // able to build the hierarchy — that is the role meant to configure a workspace.

  const { cookies: admin } = await signIn("admin@deedorbit.com")

  const asAdmin = await addNode(admin, projectId, {
    name: "Tower B",

    kind: "block",
  })

  assert.equal(asAdmin.status, 200, JSON.stringify(asAdmin.body))
})

test("another workspace's node is not found, not merely forbidden", async () => {
  const { cookies } = await signIn("projects@deedorbit.com")

  const projectId = await projectFor(cookies, "Isolation Plot")

  const ours = await addNode(cookies, projectId, {
    name: "Tower A",

    kind: "block",
  })

  assert.equal(ours.status, 200)

  // A second, unrelated workspace. Its owner holds every permission, so the only

  // thing standing between the two trees is tenant scoping.

  const signup = await call(jar(), "POST", "/api/auth/signup", {
    email: "structure.rival@example.com",

    fullName: "Structure Rival",

    workspaceName: "Rival Structures",

    password: "Rival-Desk-2026",
  })

  assert.equal(signup.status, 200)

  const { cookies: rival } = await signIn(
    "structure.rival@example.com",

    "Rival-Desk-2026",
  )

  const rivalProject = await projectFor(rival, "Rival Tower Plot")

  const rivalNode = await addNode(rival, rivalProject, {
    name: "Rival Tower",

    kind: "block",
  })

  assert.equal(rivalNode.status, 200)

  // The rival holds every permission in their own workspace, so nothing can

  // refuse these on rights alone — the only barrier is the tenant scope on the

  // project lookup, and it has to hide the project rather than expose its nodes.

  const rename = await call(
    rival,

    "PATCH",

    `/api/projects/${projectId}/structure/${ours.body.node.id}`,

    { name: "Stolen" },
  )

  assert.equal(rename.status, 404)

  const remove = await call(
    rival,

    "DELETE",

    `/api/projects/${projectId}/structure/${ours.body.node.id}`,
  )

  assert.equal(remove.status, 404)

  // And grafting our node into their tree is refused at the parent check, which

  // is why that lookup is tenant-scoped rather than a bare id read.

  const graft = await addNode(rival, rivalProject, {
    name: "Borrowed",

    kind: "block",

    parentId: ours.body.node.id,
  })

  assert.equal(graft.status, 404)

  assert.match(graft.body.error.message, /parent node does not exist/)

  // Both trees are untouched by any of it.

  const stillMine = await call(
    cookies,

    "GET",

    `/api/projects/${projectId}/structure`,
  )

  assert.deepEqual(
    rows<ProjectStructureNode>(stillMine.body.nodes, "nodes").map(
      (node) => node.name,
    ),

    ["Tower A"],
  )

  const stillTheirs = await call(
    rival,

    "GET",

    `/api/projects/${rivalProject}/structure`,
  )

  assert.deepEqual(
    rows<ProjectStructureNode>(stillTheirs.body.nodes, "nodes").map(
      (node) => node.name,
    ),

    ["Rival Tower"],
  )
})

test("deleting a project takes its structure with it", async () => {
  const { cookies } = await signIn("projects@deedorbit.com")

  const projectId = await projectFor(cookies, "Cascade Plot")

  const tower = await addNode(cookies, projectId, {
    name: "Tower A",

    kind: "block",
  })

  await addNode(cookies, projectId, {
    name: "North Sector",

    kind: "sector",

    parentId: tower.body.node.id,
  })

  // There is no DELETE /api/projects yet, so this is asserted against the

  // database: the cascade is a property of the schema, and a future delete route

  // must not be able to leave orphaned nodes behind.

  getDb()

    .prepare("DELETE FROM projects WHERE tenant_id = ? AND id = ?")

    .run("tn_deedorbit_holdings", projectId)

  const orphans = all<{ total: number }>(
    `SELECT count(*) AS total FROM project_structure_nodes WHERE project_id = ?`,

    projectId,
  )

  assert.equal(orphans[0]?.total, 0)
})

test("the project structure migration is re-runnable", async () => {
  getDb()

  const db = getDb()

  const indexes = () =>
    all<{ name: string }>(
      `SELECT name FROM sqlite_master
        WHERE type = 'index' AND tbl_name = 'project_structure_nodes'
        ORDER BY name`,
    ).map((row) => row.name)

  const before = indexes()

  db.exec(
    readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),

        "migrations",

        "005_project_structure.sql",
      ),

      "utf8",
    ),
  )

  // The sibling-name index is the constraint doing the real work, so its

  // continued presence is what a second run has to prove.

  assert.deepEqual(indexes(), before)

  assert.ok(before.includes("idx_project_structure_sibling_name"))

  const columns = new Set(
    all<{ name: string }>(
      "SELECT name FROM pragma_table_info('project_structure_nodes')",
    ).map((row) => row.name),
  )

  for (const column of [
    "tenant_id",

    "project_id",

    "parent_id",

    "kind",

    "name",

    "sort_order",

    "created_at",

    "updated_at",
  ]) {
    assert.ok(columns.has(column), `missing column ${column}`)
  }
})

// The unit contract is asserted against the client's own types for the same drift

// reason as the structure one: if the server renames a field, this file has to stop

// compiling.

import type {
  UnitDetailFieldSet,
  UnitFacts,
} from "../shared/inventory-categories.ts"

import type {
  ProjectStatusChangeEntry,
  ProjectStatusChangesResponse,
  StatusHistoryEntry,
  StatusHistoryResponse,
  UnitCategoryView,
  UnitImportFailure,
  UnitImportResponse,
  UnitListResponse,
  UnitMediaView,
  UnitStatusListResponse,
  UnitStatusView,
  UnitStructureResponse,
  UnitView,
} from "../src/lib/project-inventory-api.ts"

// The category vocabulary and the counts are asserted from their own client module, so a
// field the Settings tab or a summary card reads cannot be renamed on the server without
// this file failing to compile.

import type {
  InventoryCategoryGroup,
  InventoryCategorySubtypeGroup,
  InventoryCategorySummaryResponse,
  InventoryOptionView,
  InventoryOptionsResponse,
} from "../src/lib/inventory-categories-api.ts"

// The vocabulary and the bounds are asserted against the shared module rather than

// literals, so widening a limit or adding a unit type in the product does not leave

// the tests quietly expecting the old set.

const {
  BUILT_IN_UNIT_STATUSES,
  UNIT_ATTRIBUTE_MAX,
  UNIT_PRICE_MAX,
  UNIT_SIZE_MAX,
  UNIT_STATUS_LABEL_MAX,
  UNIT_STATUS_NOTE_MAX,
  UNIT_TYPES,
} = await import("../shared/inventory.ts")

// The nine list kinds and their shipped defaults come from the shared vocabulary, so a
// list added to the product has to be seeded, served and asserted before it is rendered.

const { INVENTORY_OPTION_KINDS, INVENTORY_OPTION_SEEDS } = await import(
  "../shared/inventory-categories.ts"
)

// The importer's own column list and the file it hands out as a template, so the two can
// be compared against each other rather than against a transcription of one.

const { UNIT_IMPORT_FIELDS, unitImportTemplateHeader, unitImportTemplateRows } =
  await import("../shared/inventory-categories.ts")

// The backfill the upgrade runs for units recorded before categories existed. Read from
// the module rather than re-typed here, because a mapping the migration and the test
// disagree about is exactly the drift this file exists to catch.

const { backfillUnitCategories } = await import("./inventory-seed.ts")

const UNIT_KEYS = keysOf<UnitView>({
  id: true,

  structureNodeId: true,

  unitCode: true,

  unitType: true,

  location: true,

  sizeSqft: true,

  basePrice: true,

  pricing: true,

  priceBreakdown: true,

  status: true,

  // Resolved server-side from the tenant's own vocabulary, so a custom status renders
  // in a client that has never heard of it.

  statusLabel: true,

  statusTone: true,

  structurePath: true,

  attributes: true,

  // Migration 0054: the property category block, resolved server-side against this
  // tenant's own dropdown lists. Its own keys are asserted in UNIT_CATEGORY_KEYS.

  category: true,

  createdAt: true,

  updatedAt: true,
})

const UNIT_LIST_KEYS = keysOf<UnitListResponse>({
  units: true,

  totals: true,

  // Category-wise counts for the summary cards, over this project's units.

  categories: true,

  currency: true,

  canEdit: true,

  // Sent apart from canEdit because moving a unit between statuses is a different
  // right from editing one.

  canChangeStatus: true,
})

const UNIT_STRUCTURE_KEYS = keysOf<UnitStructureResponse>({
  options: true,
})

// The category block is asserted as its own contract, because it is the part a quotation,
// a booking form and a filter chip all read: a rename here drifts three screens at once.

const UNIT_CATEGORY_KEYS = keysOf<UnitCategoryView>({
  propertyTypeKey: true,

  propertyTypeLabel: true,

  usageKey: true,

  usageLabel: true,

  subtypeKey: true,

  subtypeLabel: true,

  furnishingKey: true,

  furnishingLabel: true,

  saleModeKey: true,

  saleModeLabel: true,

  // Read by the booking form to decide whether a payment plan step exists at all.

  allowsInstallments: true,

  possessionKey: true,

  possessionLabel: true,

  ownershipKey: true,

  ownershipLabel: true,

  ownershipNotes: true,

  // Bare land, which is what hides bedrooms on the form.

  isLand: true,

  sizeValue: true,

  sizeUnitKey: true,

  sizeUnitLabel: true,

  sizeDisplay: true,

  bedrooms: true,

  bathrooms: true,

  kitchens: true,

  lounges: true,

  floorsCount: true,

  floorNumber: true,

  parking: true,

  facing: true,

  facingLabel: true,

  view: true,

  ageYears: true,

  subtypeOptions: true,

  visibleFields: true,

  detailSummary: true,

  address: true,

  areaCity: true,

  latitude: true,

  longitude: true,

  description: true,

  amenityKeys: true,

  amenities: true,

  media: true,

  mainPhoto: true,
})

const UNIT_VISIBLE_FIELD_KEYS = keysOf<UnitDetailFieldSet>({
  bedrooms: true,

  bathrooms: true,

  kitchens: true,

  lounges: true,

  floorsCount: true,

  floorNumber: true,

  parking: true,

  facing: true,

  view: true,

  ageYears: true,

  subtype: true,

  amenities: true,
})

const UNIT_MEDIA_KEYS = keysOf<UnitMediaView>({
  id: true,

  kind: true,

  href: true,

  label: true,

  isMain: true,

  sortOrder: true,
})

// One option row, the whole nine-list response, and the two count shapes are each
// asserted as their own contract: the Settings tab, the filter chips, the summary cards
// and the dashboard breakdown all read them, and none of them can afford a blank cell.

const INVENTORY_OPTION_KEYS = keysOf<InventoryOptionView>({
  id: true,

  kind: true,

  key: true,

  label: true,

  parentKey: true,

  legacyType: true,

  usageKey: true,

  valueNum: true,

  isLand: true,

  isBuiltin: true,

  isArchived: true,

  sortOrder: true,
})

const INVENTORY_OPTIONS_KEYS = keysOf<InventoryOptionsResponse>({
  options: true,

  archived: true,

  unitCounts: true,

  canManage: true,
})

const CATEGORY_GROUP_KEYS = keysOf<InventoryCategoryGroup>({
  key: true,

  label: true,

  usageKey: true,

  usageLabel: true,

  total: true,

  available: true,

  value: true,

  subtypes: true,
})

const CATEGORY_SUBTYPE_KEYS = keysOf<InventoryCategorySubtypeGroup>({
  key: true,

  label: true,

  count: true,
})

const CATEGORY_SUMMARY_KEYS = keysOf<InventoryCategorySummaryResponse>({
  groups: true,

  subtypes: true,

  total: true,
})

const UNIT_IMPORT_KEYS = keysOf<UnitImportResponse>({
  created: true,

  failed: true,

  failures: true,

  units: true,
})

const UNIT_IMPORT_FAILURE_KEYS = keysOf<UnitImportFailure>({
  row: true,

  unitCode: true,

  errors: true,
})

// The classification a quotation, a booking page and a PDF print. Its own contract
// because a document that reaches for a field the inventory payload renamed would print
// a blank line on a signed page rather than fail loudly.

const UNIT_FACTS_KEYS = keysOf<UnitFacts>({
  unitCode: true,

  propertyType: true,

  subtype: true,

  usage: true,

  furnishing: true,

  saleMode: true,

  allowsInstallments: true,

  possession: true,

  ownership: true,

  sizeDisplay: true,

  detailSummary: true,

  address: true,

  areaCity: true,
})

/** A project paired with the one node these tests attach their units to. */

interface InventoryPlot {
  projectId: string

  nodeId: string
}

/** A project with one tower, so a unit always has somewhere to attach. */

async function inventoryPlot(
  cookies: CookieJar,

  name: string,
): Promise<InventoryPlot> {
  const projectId = await projectFor(cookies, name)

  const tower = await addNode(cookies, projectId, {
    name: "Tower A",

    kind: "block",
  })

  assert.equal(tower.status, 200, JSON.stringify(tower.body))

  return { projectId, nodeId: tower.body.node.id }
}

function addUnit(
  cookies: CookieJar,

  projectId: string,

  body: Record<string, unknown>,
): Promise<CallResult> {
  return call(cookies, "POST", `/api/projects/${projectId}/units`, body)
}

/** A body that passes, so a test can change one field and see why it fails. */

function validUnitBody(nodeId: string): Record<string, unknown> {
  return {
    unitCode: "A-1201",

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

test("a unit records its type, its place in the structure, and its price", async () => {
  const { cookies } = await signIn("projects@deedorbit.com")

  const { projectId, nodeId } = await inventoryPlot(
    cookies,

    "Unit Contract Plot",
  )

  const created = await addUnit(cookies, projectId, validUnitBody(nodeId))

  assert.equal(created.status, 200, JSON.stringify(created.body))

  assertExactKeys("POST unit", record(created.body, "create"), ["unit"])

  assertExactKeys("UnitView", record(created.body.unit, "unit"), UNIT_KEYS)

  assert.equal(created.body.unit.unitCode, "A-1201")

  assert.equal(created.body.unit.unitType, "apartment")

  assert.equal(created.body.unit.structureNodeId, nodeId)

  assert.equal(created.body.unit.location, "North-facing, podium level")

  assert.equal(created.body.unit.sizeSqft, 1450)

  // Stored as a whole number of dirhams, not fils.

  assert.equal(created.body.unit.basePrice, 2_450_000)

  assert.deepEqual(created.body.unit.pricing, {
    pricePerSqft: 1700,
    developmentCharge: 150000,
    cornerPremium: 200000,
    parkFacingPremium: 100000,
    floorPremium: 50000,
    discount: 75000,
  })

  assert.equal(created.body.unit.priceBreakdown.basePrice, 2_450_000)

  assert.equal(created.body.unit.priceBreakdown.charges, 500000)

  assert.equal(created.body.unit.priceBreakdown.discount, 75000)

  assert.equal(created.body.unit.priceBreakdown.finalPrice, 2_875_000)

  assert.equal(created.body.unit.status, "available")

  // The path arrives resolved, so the table can place the unit without asking again.

  assert.deepEqual(created.body.unit.structurePath, ["Tower A"])

  // No attributes were sent, so the unit carries none rather than an empty object

  // standing in for data nobody entered.

  assert.deepEqual(created.body.unit.attributes, [])
})

test("every unit type is accepted, and nothing outside the five is", async () => {
  const { cookies } = await signIn("projects@deedorbit.com")

  const { projectId, nodeId } = await inventoryPlot(cookies, "Unit Types Plot")

  for (const unitType of UNIT_TYPES) {
    const created = await addUnit(cookies, projectId, {
      ...validUnitBody(nodeId),

      unitCode: `T-${unitType}`,

      unitType,
    })

    assert.equal(
      created.status,

      200,

      `${unitType}: ${JSON.stringify(created.body)}`,
    )

    assert.equal(created.body.unit.unitType, unitType)
  }

  const rejected = await addUnit(cookies, projectId, {
    ...validUnitBody(nodeId),

    unitCode: "T-warehouse",

    unitType: "warehouse",
  })

  assert.equal(rejected.status, 400)

  assert.equal(rejected.body.error.code, "bad_request")

  assert.ok(rejected.body.error.fields.unitType)

  // An absent type is not defaulted: guessing what a unit is would put a wrong word

  // in front of a buyer.

  const absent = await addUnit(cookies, projectId, {
    ...validUnitBody(nodeId),

    unitCode: "T-absent",

    unitType: undefined,
  })

  assert.equal(absent.status, 400)

  assert.ok(absent.body.error.fields.unitType)
})

test("a unit cannot be listed without somewhere to sit", async () => {
  const { cookies } = await signIn("projects@deedorbit.com")

  const { projectId, nodeId } = await inventoryPlot(cookies, "Unit Anchor Plot")

  const missing = await addUnit(cookies, projectId, {
    ...validUnitBody(nodeId),

    structureNodeId: undefined,
  })

  assert.equal(missing.status, 400)

  assert.ok(missing.body.error.fields.structureNodeId)

  // A node id that does not exist reads as not found rather than as a malformed

  // field: the client cannot tell those apart, and neither should it need to.

  const absent = await addUnit(cookies, projectId, {
    ...validUnitBody(nodeId),

    structureNodeId: "psn_does_not_exist",
  })

  assert.equal(absent.status, 404)

  // Nothing was written by either rejection.

  const listed = await call(cookies, "GET", `/api/projects/${projectId}/units`)

  assert.deepEqual(listed.body.units, [])
})

test("size and price are whole numbers, and an empty price is not zero", async () => {
  const { cookies } = await signIn("projects@deedorbit.com")

  const { projectId, nodeId } = await inventoryPlot(
    cookies,

    "Unit Numbers Plot",
  )

  const fractional = await addUnit(cookies, projectId, {
    ...validUnitBody(nodeId),

    sizeSqft: 1450.5,
  })

  assert.equal(fractional.status, 400)

  assert.match(fractional.body.error.fields.sizeSqft, /Whole numbers/)

  const fractionallyPriced = await addUnit(cookies, projectId, {
    ...validUnitBody(nodeId),

    basePrice: 2_450_000.75,
  })

  assert.equal(fractionallyPriced.status, 400)

  assert.match(fractionallyPriced.body.error.fields.basePrice, /Whole numbers/)

  // The boundary itself is accepted, so the limits are bounds and not exclusions.

  const atMax = await addUnit(cookies, projectId, {
    ...validUnitBody(nodeId),

    unitCode: "MAX-1",

    sizeSqft: UNIT_SIZE_MAX,

    basePrice: UNIT_PRICE_MAX,
  })

  assert.equal(atMax.status, 200, JSON.stringify(atMax.body))

  const overMax = await addUnit(cookies, projectId, {
    ...validUnitBody(nodeId),

    unitCode: "MAX-2",

    sizeSqft: UNIT_SIZE_MAX + 1,
  })

  assert.equal(overMax.status, 400)

  assert.ok(overMax.body.error.fields.sizeSqft)

  // A price of zero is a real figure, and one that has to be typed to be believed.

  const free = await addUnit(cookies, projectId, {
    ...validUnitBody(nodeId),

    unitCode: "FREE-1",

    basePrice: 0,
  })

  assert.equal(free.status, 200, JSON.stringify(free.body))

  assert.equal(free.body.unit.basePrice, 0)

  // An empty price box is an omission, and must not be recorded as a free unit.

  const blank = await addUnit(cookies, projectId, {
    ...validUnitBody(nodeId),

    unitCode: "BLANK-1",

    basePrice: "",
  })

  assert.equal(blank.status, 400)

  assert.ok(blank.status === 400 && blank.body.error.fields.basePrice)

  const zeroSize = await addUnit(cookies, projectId, {
    ...validUnitBody(nodeId),

    unitCode: "ZERO-1",

    sizeSqft: 0,
  })

  assert.equal(zeroSize.status, 400)

  assert.ok(zeroSize.body.error.fields.sizeSqft)
})

test("custom attributes are stored alphabetically, and refused when they clash", async () => {
  const { cookies } = await signIn("projects@deedorbit.com")

  const { projectId, nodeId } = await inventoryPlot(
    cookies,

    "Unit Attributes Plot",
  )

  const created = await addUnit(cookies, projectId, {
    ...validUnitBody(nodeId),

    attributes: [
      { key: "View", value: "Sea view" },

      { key: "Bedrooms", value: "3" },

      { key: "Corner unit", value: "Yes" },
    ],
  })

  assert.equal(created.status, 200, JSON.stringify(created.body))

  // Alphabetical, so two units listing the same attributes render identically.

  assert.deepEqual(created.body.unit.attributes, [
    { key: "Bedrooms", value: "3" },

    { key: "Corner unit", value: "Yes" },

    { key: "View", value: "Sea view" },
  ])

  // A second spelling of the same name is the same fact stated twice, and a unit

  // carrying both would leave the reader guessing which one is authoritative.

  const clash = await addUnit(cookies, projectId, {
    ...validUnitBody(nodeId),

    unitCode: "A-1202",

    attributes: [
      { key: "Bedrooms", value: "3" },

      { key: "bedrooms", value: "4" },
    ],
  })

  assert.equal(clash.status, 400)

  assert.match(clash.body.error.fields.attributes, /listed twice/)

  // A wholly blank repeater row is an accident, and is dropped rather than stored

  // as an attribute with an empty name.

  const blankRow = await addUnit(cookies, projectId, {
    ...validUnitBody(nodeId),

    unitCode: "A-1203",

    attributes: [
      { key: "Bedrooms", value: "2" },

      { key: "   ", value: "   " },
    ],
  })

  assert.equal(blankRow.status, 200, JSON.stringify(blankRow.body))

  assert.deepEqual(blankRow.body.unit.attributes, [
    { key: "Bedrooms", value: "2" },
  ])

  // A value with no name is also a half-filled row, but the name is the half that

  // matters, so this is refused instead of dropped.

  const nameless = await addUnit(cookies, projectId, {
    ...validUnitBody(nodeId),

    unitCode: "A-1204",

    attributes: [{ key: "  ", value: "3" }],
  })

  assert.equal(nameless.status, 400)

  const notAList = await addUnit(cookies, projectId, {
    ...validUnitBody(nodeId),

    unitCode: "A-1205",

    attributes: { bedrooms: 3 },
  })

  assert.equal(notAList.status, 400)

  const tooMany = await addUnit(cookies, projectId, {
    ...validUnitBody(nodeId),

    unitCode: "A-1206",

    attributes: Array.from({ length: UNIT_ATTRIBUTE_MAX + 1 }, (_, index) => ({
      key: `Attribute ${index}`,

      value: `${index}`,
    })),
  })

  assert.equal(tooMany.status, 400)

  assert.match(tooMany.body.error.fields.attributes, /at most/)
})

test("a unit code is unique per project, case-insensitively", async () => {
  const { cookies } = await signIn("projects@deedorbit.com")

  const { projectId, nodeId } = await inventoryPlot(cookies, "Unit Code Plot")

  const first = await addUnit(cookies, projectId, validUnitBody(nodeId))

  assert.equal(first.status, 200)

  const dupe = await addUnit(cookies, projectId, validUnitBody(nodeId))

  assert.equal(dupe.status, 422)

  assert.equal(dupe.body.error.code, "conflict")

  assert.ok(dupe.body.error.fields.unitCode)

  // "a-1201" is the same code; a user typing it in the wrong case has not created a

  // different unit.

  const differentlyCased = await addUnit(cookies, projectId, {
    ...validUnitBody(nodeId),

    unitCode: "a-1201",
  })

  assert.equal(differentlyCased.status, 422)

  // A different project may reuse it: the code is unique within a project, not

  // across the workspace, because two towers can both have an A-1201.

  const other = await projectFor(cookies, "Unit Code Other Plot")

  const otherTower = await addNode(cookies, other, {
    name: "Tower A",

    kind: "block",
  })

  const reused = await addUnit(
    cookies,

    other,

    validUnitBody(otherTower.body.node.id),
  )

  assert.equal(reused.status, 200, JSON.stringify(reused.body))

  // A second unit in the first project, so the rename below has a target.

  const second = await addUnit(cookies, projectId, {
    ...validUnitBody(nodeId),

    unitCode: "A-1202",
  })

  assert.equal(second.status, 200)

  // Keeping its own code while changing something else is not a clash with itself.

  const repriced = await call(
    cookies,

    "PATCH",

    `/api/projects/${projectId}/units/${first.body.unit.id}`,

    { basePrice: 2_500_000 },
  )

  assert.equal(repriced.status, 200, JSON.stringify(repriced.body))

  assert.equal(repriced.body.unit.basePrice, 2_500_000)

  assert.equal(repriced.body.unit.unitCode, "A-1201")

  // Taking a code another unit holds is refused, and names the field.

  const stolen = await call(
    cookies,

    "PATCH",

    `/api/projects/${projectId}/units/${second.body.unit.id}`,

    { unitCode: "A-1201" },
  )

  assert.equal(stolen.status, 422)

  assert.ok(stolen.body.error.fields.unitCode)

  // The rejected rename changed nothing.

  const unchanged = await call(
    cookies,

    "PATCH",

    `/api/projects/${projectId}/units/${second.body.unit.id}`,

    {},
  )

  assert.equal(unchanged.status, 200)

  assert.equal(unchanged.body.unit.unitCode, "A-1202")
})

test("a unit list states its totals and the currency they are in", async () => {
  const { cookies } = await signIn("projects@deedorbit.com")

  const { projectId, nodeId } = await inventoryPlot(cookies, "Unit Totals Plot")

  await addUnit(cookies, projectId, {
    ...validUnitBody(nodeId),

    unitCode: "TOT-1",

    status: "available",

    basePrice: 1_000_000,
  })

  await addUnit(cookies, projectId, {
    ...validUnitBody(nodeId),

    unitCode: "TOT-2",

    status: "reserved",

    basePrice: 2_000_000,
  })

  await addUnit(cookies, projectId, {
    ...validUnitBody(nodeId),

    unitCode: "TOT-3",

    status: "sold",

    basePrice: 4_000_000,
  })

  await addUnit(cookies, projectId, {
    ...validUnitBody(nodeId),

    unitCode: "TOT-4",

    status: "draft",

    basePrice: 500_000,
  })

  const listed = await call(cookies, "GET", `/api/projects/${projectId}/units`)

  assert.equal(listed.status, 200, JSON.stringify(listed.body))

  assertExactKeys("GET units", record(listed.body, "list"), UNIT_LIST_KEYS)

  assert.equal(listed.body.units.length, 4)

  // Sorted by code, so the table has a stable order without asking for one.

  assert.deepEqual(
    listed.body.units.map((unit: Json) => unit.unitCode),

    ["TOT-1", "TOT-2", "TOT-3", "TOT-4"],
  )

  const totals = listed.body.totals

  assert.equal(totals.total, 4)

  // Counts arrive as a map keyed by status, because the vocabulary is data: a fixed set
  // of named counters could not report a status this build has never heard of, and the
  // whole point of the feature is that a tenant can add one.

  assert.deepEqual(
    {
      draft: totals.byStatus.draft,
      available: totals.byStatus.available,
      reserved: totals.byStatus.reserved,
      sold: totals.byStatus.sold,
    },

    { draft: 1, available: 1, reserved: 1, sold: 1 },
  )

  // Zero-filled across the whole vocabulary rather than only the statuses in use, so
  // the tiles can render an empty status without the client inventing its count.

  assert.equal(totals.byStatus.cancelled, 0)

  assert.equal(totals.byStatus.booked, 0)

  // Money already earned is not stock value, while a draft still carries the price

  // its publisher intends — which is why there are two figures and not one.

  assert.equal(totals.openValue, 3_000_000)

  assert.equal(totals.totalValue, 7_500_000)

  // The client cannot know the currency from the tenant it already holds, so the

  // response states it rather than letting a client-side default guess.

  assert.equal(listed.body.currency, "AED")

  // A project with nothing on it answers with zeroes rather than nulls or an error.

  const empty = await projectFor(cookies, "Unit Empty Plot")

  const emptyList = await call(cookies, "GET", `/api/projects/${empty}/units`)

  assert.equal(emptyList.status, 200)

  assert.deepEqual(emptyList.body.units, [])

  assert.equal(emptyList.body.totals.total, 0)

  assert.equal(emptyList.body.totals.openValue, 0)
})

test("attributes are replaced whole, which is what makes a removal possible", async () => {
  const { cookies } = await signIn("projects@deedorbit.com")

  const { projectId, nodeId } = await inventoryPlot(
    cookies,

    "Unit Replace Plot",
  )

  const created = await addUnit(cookies, projectId, {
    ...validUnitBody(nodeId),

    attributes: [
      { key: "Bedrooms", value: "3" },

      { key: "Corner unit", value: "Yes" },
    ],
  })

  assert.equal(created.status, 200, JSON.stringify(created.body))

  const unitId = created.body.unit.id

  // Omitting attributes leaves them alone, so a price change cannot silently drop

  // facts a user recorded earlier.

  const priceOnly = await call(
    cookies,

    "PATCH",

    `/api/projects/${projectId}/units/${unitId}`,

    { basePrice: 2_600_000 },
  )

  assert.equal(priceOnly.status, 200)

  assert.equal(priceOnly.body.unit.attributes.length, 2)

  // Sending a set replaces it, so the removed tag is genuinely gone rather than

  // merged away or shadowed by the survivor.

  const trimmed = await call(
    cookies,

    "PATCH",

    `/api/projects/${projectId}/units/${unitId}`,

    { attributes: [{ key: "Bedrooms", value: "3" }] },
  )

  assert.equal(trimmed.status, 200)

  assert.deepEqual(trimmed.body.unit.attributes, [
    { key: "Bedrooms", value: "3" },
  ])

  // An empty list clears them all, which is the one thing a merge cannot express.

  const cleared = await call(
    cookies,

    "PATCH",

    `/api/projects/${projectId}/units/${unitId}`,

    { attributes: [] },
  )

  assert.equal(cleared.status, 200)

  assert.deepEqual(cleared.body.unit.attributes, [])

  // A failed write leaves the attributes as they were rather than half-applied.

  const refused = await call(
    cookies,

    "PATCH",

    `/api/projects/${projectId}/units/${unitId}`,

    { attributes: [{ key: "Bedrooms", value: "3" }], sizeSqft: 12.5 },
  )

  assert.equal(refused.status, 400)

  const afterRefusal = await call(
    cookies,

    "GET",

    `/api/projects/${projectId}/units`,
  )

  assert.deepEqual(rows(afterRefusal.body.units, "units")[0].attributes, [])
})

test("a unit can be moved within its project, but not out of it", async () => {
  const { cookies } = await signIn("projects@deedorbit.com")

  const { projectId, nodeId } = await inventoryPlot(cookies, "Unit Move Plot")

  const floor = await addNode(cookies, projectId, {
    name: "Level 12",

    kind: "floor",

    parentId: nodeId,
  })

  assert.equal(floor.status, 200, JSON.stringify(floor.body))

  const created = await addUnit(cookies, projectId, validUnitBody(nodeId))

  assert.equal(created.status, 200)

  assert.deepEqual(created.body.unit.structurePath, ["Tower A"])

  const moved = await call(
    cookies,

    "PATCH",

    `/api/projects/${projectId}/units/${created.body.unit.id}`,

    { structureNodeId: floor.body.node.id },
  )

  assert.equal(moved.status, 200, JSON.stringify(moved.body))

  assert.deepEqual(moved.body.unit.structurePath, ["Tower A", "Level 12"])

  // Every other field survived the move, because a PATCH that omits a key is saying

  // "not changing this".

  assert.equal(moved.body.unit.unitCode, "A-1201")

  assert.equal(moved.body.unit.basePrice, 2_450_000)

  assert.equal(moved.body.unit.sizeSqft, 1450)

  // Another project in the same workspace is not a legal home for this unit, even

  // though the caller can see that project's nodes.

  const other = await projectFor(cookies, "Unit Move Other Plot")

  const otherTower = await addNode(cookies, other, {
    name: "Tower B",

    kind: "block",
  })

  const escaped = await call(
    cookies,

    "PATCH",

    `/api/projects/${projectId}/units/${created.body.unit.id}`,

    { structureNodeId: otherTower.body.node.id },
  )

  assert.equal(escaped.status, 404)

  // Still where it was left.

  const afterEscape = await call(
    cookies,

    "GET",

    `/api/projects/${projectId}/units`,
  )

  const stillThere = rows(afterEscape.body.units, "units").find(
    (unit) => unit.id === created.body.unit.id,
  )

  assert.deepEqual(stillThere?.structurePath, ["Tower A", "Level 12"])
})

test("clearing the location is a deliberate act", async () => {
  const { cookies } = await signIn("projects@deedorbit.com")

  const { projectId, nodeId } = await inventoryPlot(
    cookies,

    "Unit Location Plot",
  )

  const created = await addUnit(cookies, projectId, validUnitBody(nodeId))

  assert.equal(created.body.unit.location, "North-facing, podium level")

  const untouched = await call(
    cookies,

    "PATCH",

    `/api/projects/${projectId}/units/${created.body.unit.id}`,

    { basePrice: 2_400_000 },
  )

  assert.equal(untouched.status, 200)

  assert.equal(untouched.body.unit.location, "North-facing, podium level")

  const cleared = await call(
    cookies,

    "PATCH",

    `/api/projects/${projectId}/units/${created.body.unit.id}`,

    { location: "" },
  )

  assert.equal(cleared.status, 200)

  assert.equal(cleared.body.unit.location, null)
})

test("a node holding units cannot be deleted out from under them", async () => {
  const { cookies } = await signIn("projects@deedorbit.com")

  const { projectId, nodeId } = await inventoryPlot(cookies, "Unit Guard Plot")

  const created = await addUnit(cookies, projectId, {
    ...validUnitBody(nodeId),

    attributes: [{ key: "Bedrooms", value: "3" }],
  })

  assert.equal(created.status, 200)

  const refused = await call(
    cookies,

    "DELETE",

    `/api/projects/${projectId}/structure/${nodeId}`,
  )

  assert.equal(refused.status, 422)

  assert.match(refused.body.error.message, /still holds 1 unit/)

  // The refusal says so in a sentence rather than surfacing the foreign key as a 500.

  const unit = await call(
    cookies,

    "DELETE",

    `/api/projects/${projectId}/units/${created.body.unit.id}`,
  )

  assert.equal(unit.status, 200, JSON.stringify(unit.body))

  assertExactKeys("DELETE unit", record(unit.body, "delete"), ["deleted"])

  assert.equal(unit.body.deleted.id, created.body.unit.id)

  // The attributes went with it: a unit holds nothing but its own custom fields, so

  // there is nothing a cascade here could take by surprise.

  const orphans = get<{ total: number }>(
    `SELECT count(*) AS total FROM inventory_unit_attributes WHERE unit_id = ?`,

    created.body.unit.id,
  )

  assert.equal(orphans?.total, 0)

  // With the unit gone the node is free, and deleting it leaves nothing behind.

  const nowEmpty = await call(
    cookies,

    "DELETE",

    `/api/projects/${projectId}/structure/${nodeId}`,
  )

  assert.equal(nowEmpty.status, 200, JSON.stringify(nowEmpty.body))

  const reread = await call(cookies, "GET", `/api/projects/${projectId}/units`)

  assert.deepEqual(reread.body.units, [])
})

test("reading inventory needs inventory.view and writing needs inventory.edit", async () => {
  const { cookies: manager } = await signIn("projects@deedorbit.com")

  const { projectId, nodeId } = await inventoryPlot(
    manager,

    "Unit Permission Plot",
  )

  const { cookies: agent } = await signIn("sales.agent@deedorbit.com")

  // A view-only role reads the units...

  const read = await call(agent, "GET", `/api/projects/${projectId}/units`)

  assert.equal(read.status, 200)

  assert.equal(read.body.canEdit, false)

  // ...and the nodes a unit could be attached to.

  const structure = await call(
    agent,

    "GET",

    `/api/projects/${projectId}/units/structure`,
  )

  assert.equal(structure.status, 200)

  assertExactKeys(
    "GET units/structure",

    record(structure.body, "structure"),

    UNIT_STRUCTURE_KEYS,
  )

  assert.deepEqual(
    structure.body.options.map((option: Json) => option.path),

    [["Tower A"]],
  )

  // ...and cannot change any of them. Creating and deleting both need

  // `inventory.edit` rather than `inventory.create`/`inventory.delete`: the roles

  // that publish a project's stock hold the former and not the others.

  const create = await addUnit(agent, projectId, validUnitBody(nodeId))

  assert.equal(create.status, 403)

  assert.equal(create.body.error.code, "permission_denied")

  const edit = await addUnit(manager, projectId, validUnitBody(nodeId))

  assert.equal(edit.status, 200)

  const repriced = await call(
    agent,

    "PATCH",

    `/api/projects/${projectId}/units/${edit.body.unit.id}`,

    { basePrice: 1 },
  )

  assert.equal(repriced.status, 403)

  const removed = await call(
    agent,

    "DELETE",

    `/api/projects/${projectId}/units/${edit.body.unit.id}`,
  )

  assert.equal(removed.status, 403)

  // The refusals changed nothing.

  const after = await call(manager, "GET", `/api/projects/${projectId}/units`)

  assert.equal(rows(after.body.units, "units").length, 1)

  assert.equal(rows(after.body.units, "units")[0].basePrice, 2_450_000)
})

test("a project with no structure offers no unit targets", async () => {
  const { cookies } = await signIn("projects@deedorbit.com")

  const projectId = await projectFor(cookies, "Inventory No Structure Plot")

  // The picker has nothing to offer, which is what the panel reads to decide that
  // units cannot be recorded yet rather than showing an empty select.

  const structure = await call(
    cookies,

    "GET",

    `/api/projects/${projectId}/units/structure`,
  )

  assert.equal(structure.status, 200)

  assert.deepEqual(structure.body.options, [])

  // The units list is still readable and simply reports nothing to attach to.

  const units = await call(cookies, "GET", `/api/projects/${projectId}/units`)

  assert.equal(units.status, 200)

  assert.deepEqual(units.body.units, [])

  assert.equal(units.body.totals.total, 0)

  // Creating without a structure node is refused rather than stored unplaced.

  const orphan = await addUnit(cookies, projectId, {
    unitCode: "NS-01",
    unitType: "apartment",
    sizeSqft: 900,
    basePrice: 1_000_000,
  })

  assert.equal(orphan.status, 400)

  assert.equal(orphan.body.error.code, "bad_request")
})

test("the unit picker lists structure as a tree, not by raw sort order", async () => {
  const { cookies } = await signIn("projects@deedorbit.com")

  const projectId = await projectFor(cookies, "Inventory Tree Order Plot")

  // Named so a flat sort by `sort_order` then name would put "Alpha" before its own

  // parent "Zone": both sit at sort order 0, and A sorts before Z.

  const zone = await addNode(cookies, projectId, {
    name: "Zone",

    kind: "block",
  })

  assert.equal(zone.status, 200, JSON.stringify(zone.body))

  const alpha = await addNode(cookies, projectId, {
    name: "Alpha",

    kind: "floor",

    parentId: zone.body.node.id,
  })

  assert.equal(alpha.status, 200, JSON.stringify(alpha.body))

  const beta = await addNode(cookies, projectId, {
    name: "Beta",

    kind: "floor",

    parentId: zone.body.node.id,
  })

  assert.equal(beta.status, 200, JSON.stringify(beta.body))

  const yard = await addNode(cookies, projectId, {
    name: "Yard",

    kind: "block",
  })

  assert.equal(yard.status, 200, JSON.stringify(yard.body))

  const structure = await call(
    cookies,

    "GET",

    `/api/projects/${projectId}/units/structure`,
  )

  assert.equal(structure.status, 200)

  assert.deepEqual(
    structure.body.options.map((option: Json) => option.path),

    [["Zone"], ["Zone", "Alpha"], ["Zone", "Beta"], ["Yard"]],
  )
})

test("another workspace's units are neither listed nor reachable", async () => {
  const { cookies } = await signIn("projects@deedorbit.com")

  const { projectId, nodeId } = await inventoryPlot(
    cookies,

    "Unit Isolation Plot",
  )

  const created = await addUnit(cookies, projectId, validUnitBody(nodeId))

  assert.equal(created.status, 200)

  // A second, unrelated workspace whose owner holds every permission. Nothing can

  // refuse these calls on rights, so the tenant scope is the only barrier and it has

  // to hide the units rather than expose them.

  const signup = await call(jar(), "POST", "/api/auth/signup", {
    email: "inventory.rival@example.com",

    fullName: "Inventory Rival",

    workspaceName: "Rival Inventory",

    password: "Rival-Shelf-2026",
  })

  assert.equal(signup.status, 200)

  const { cookies: rival } = await signIn(
    "inventory.rival@example.com",

    "Rival-Shelf-2026",
  )

  const listed = await call(rival, "GET", `/api/projects/${projectId}/units`)

  assert.equal(listed.status, 404)

  assert.equal(listed.body.error.code, "not_found")

  const structure = await call(
    rival,

    "GET",

    `/api/projects/${projectId}/units/structure`,
  )

  assert.equal(structure.status, 404)

  const repriced = await call(
    rival,

    "PATCH",

    `/api/projects/${projectId}/units/${created.body.unit.id}`,

    { basePrice: 1 },
  )

  assert.equal(repriced.status, 404)

  const removed = await call(
    rival,

    "DELETE",

    `/api/projects/${projectId}/units/${created.body.unit.id}`,
  )

  assert.equal(removed.status, 404)

  // A rival cannot attach a unit to our node, nor create one under our project by

  // naming our node.

  const hijack = await addUnit(rival, projectId, validUnitBody(nodeId))

  assert.equal(hijack.status, 404)

  // Everything is still here, still ours, and still at its original price.

  const after = await call(cookies, "GET", `/api/projects/${projectId}/units`)

  assert.equal(rows(after.body.units, "units").length, 1)

  assert.equal(rows(after.body.units, "units")[0].basePrice, 2_450_000)

  const orphanCheck = get<{ total: number }>(
    `SELECT count(*) AS total FROM inventory_units WHERE tenant_id = ?`,

    "tn_deedorbit_holdings",
  )

  assert.ok((orphanCheck?.total ?? 0) > 0)
})

test("deleting a project takes its units and attributes with it", async () => {
  const { cookies } = await signIn("projects@deedorbit.com")

  const { projectId, nodeId } = await inventoryPlot(
    cookies,

    "Unit Cascade Plot",
  )

  const created = await addUnit(cookies, projectId, {
    ...validUnitBody(nodeId),

    attributes: [{ key: "Bedrooms", value: "3" }],
  })

  assert.equal(created.status, 200, JSON.stringify(created.body))

  // There is no DELETE /api/projects yet, so this is asserted against the database:

  // the cascade is a property of the schema, and a future delete route must not be

  // able to leave sold units behind.

  getDb()

    .prepare("DELETE FROM projects WHERE tenant_id = ? AND id = ?")

    .run("tn_deedorbit_holdings", projectId)

  const remaining = get<{ total: number }>(
    `SELECT count(*) AS total FROM inventory_units WHERE project_id = ?`,

    projectId,
  )

  assert.equal(remaining?.total, 0)

  const attributes = get<{ total: number }>(
    `SELECT count(*) AS total FROM inventory_unit_attributes WHERE unit_id = ?`,

    created.body.unit.id,
  )

  assert.equal(attributes?.total, 0)
})

test("the project inventory migration is re-runnable", async () => {
  getDb()

  const db = getDb()

  const indexes = () =>
    all<{ name: string }>(
      `SELECT name FROM sqlite_master
        WHERE type = 'index' AND tbl_name = 'inventory_units'
        ORDER BY name`,
    ).map((row) => row.name)

  const before = indexes()

  db.exec(
    readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),

        "migrations",

        "006_project_inventory.sql",
      ),

      "utf8",
    ),
  )

  // The per-project code index is the constraint doing the real work, so its

  // continued presence is what a second run has to prove.

  assert.deepEqual(indexes(), before)

  assert.ok(before.includes("idx_inventory_units_project_code"))

  const columns = new Set(
    all<{ name: string }>(
      "SELECT name FROM pragma_table_info('inventory_units')",
    ).map((row) => row.name),
  )

  for (const column of [
    "tenant_id",

    "project_id",

    "structure_node_id",

    "unit_code",

    "unit_type",

    "location",

    "size_sqft",

    "base_price",

    "pricing_config",

    "status",

    "created_at",

    "updated_at",
  ]) {
    assert.ok(columns.has(column), `missing column ${column}`)
  }

  const attributeColumns = new Set(
    all<{ name: string }>(
      "SELECT name FROM pragma_table_info('inventory_unit_attributes')",
    ).map((row) => row.name),
  )

  for (const column of ["unit_id", "key", "value", "created_at"]) {
    assert.ok(attributeColumns.has(column), `missing column ${column}`)
  }
})

// --- The property category vocabulary, and what a unit carries from it ----------

// Migration 0054 turned "what kind of thing is this unit" from five checked literals
// into nine lists a workspace owns. These tests hold the three things the upgrade cannot
// be allowed to break: an existing unit still opens, a unit's classification drives what
// the form asks and what a booking requires, and one tenant's vocabulary stays its own.

function readCategoryLists(cookies: CookieJar): Promise<CallResult> {
  return call(cookies, "GET", "/api/inventory-options")
}

function addOption(
  cookies: CookieJar,

  body: Record<string, unknown>,
): Promise<CallResult> {
  return call(cookies, "POST", "/api/inventory-options", body)
}

function renameOption(
  cookies: CookieJar,

  optionId: string,

  body: Record<string, unknown>,
): Promise<CallResult> {
  return call(cookies, "PATCH", `/api/inventory-options/${optionId}`, body)
}

/** Every option id a tenant holds, so a refused write can be proved to have written nothing. */
function optionIds(listed: Json): string[] {
  const ids: string[] = []

  for (const kind of INVENTORY_OPTION_KINDS) {
    for (const option of rows(listed.options[kind], `options.${kind}`)) {
      ids.push(option.id)
    }
  }

  return ids.sort()
}

/** The option row for one stored key, read from a live list response. */
function optionByKey(listed: Json, kind: string, key: string): Json {
  const found = rows(listed.options[kind], `options.${kind}`).find(
    (option: Json) => option.key === key,
  )

  assert.ok(found, `no ${kind} option keyed ${key}`)

  return found
}

test("a workspace opens with the nine category lists, and reading them is not managing them", async () => {
  const { cookies: admin } = await signIn("admin@deedorbit.com")

  const listed = await readCategoryLists(admin)

  assert.equal(listed.status, 200, JSON.stringify(listed.body))

  assertExactKeys(
    "GET inventory-options",

    record(listed.body, "inventory options"),

    INVENTORY_OPTIONS_KEYS,
  )

  // All nine, keyed by kind, so a list added to the shared vocabulary has to be served
  // before it can be rendered: a tenth place to remember is a list nobody configures.
  assert.deepEqual(
    Object.keys(listed.body.options).sort(),

    [...INVENTORY_OPTION_KINDS].sort(),
  )

  const propertyTypes = rows(
    listed.body.options.property_type,
    "property types",
  )

  assertExactKeys(
    "InventoryOptionView",

    record(propertyTypes[0], "a property type"),

    INVENTORY_OPTION_KEYS,
  )

  // Seeded from the shared table in picker order, so shipping a new type is the only
  // edit needed and no screen carries a private copy of the list.
  assert.deepEqual(
    propertyTypes.map((option: Json) => option.key),

    INVENTORY_OPTION_SEEDS.property_type.map((seed) => seed.key),
  )

  assert.deepEqual(
    propertyTypes.map((option: Json) => option.label),

    INVENTORY_OPTION_SEEDS.property_type.map((seed) => seed.label),
  )

  // A variant belongs to exactly one type, which is what keeps Park Facing out of a
  // Shop's picker; the parent travels on the row rather than being guessed from a name.
  assert.deepEqual(
    rows(listed.body.options.property_subtype, "sub-types").map(
      (option: Json) => [option.parentKey, option.key],
    ),

    INVENTORY_OPTION_SEEDS.property_subtype.map((seed) => [
      seed.parent ?? null,
      seed.key,
    ]),
  )

  // A marla is 225 square feet in most of Punjab and 242 in parts of the Sindh canal
  // colonies, so the factor is workspace data an admin may correct — but every stored
  // square foot comes from it, so it has to start somewhere.
  assert.deepEqual(
    rows(listed.body.options.size_unit, "size units").map((option: Json) => [
      option.key,
      option.valueNum,
    ]),

    INVENTORY_OPTION_SEEDS.size_unit.map((seed) => [
      seed.key,
      seed.factor ?? null,
    ]),
  )

  for (const kind of INVENTORY_OPTION_KINDS) {
    const options = rows(listed.body.options[kind], `options.${kind}`)

    assert.deepEqual(
      options.map((option: Json) => option.key),

      INVENTORY_OPTION_SEEDS[kind].map((seed) => seed.key),

      `${kind} does not carry the shipped list`,
    )

    for (const option of options) {
      assert.equal(
        option.isBuiltin,
        true,
        `${kind}:${option.key} is not built-in`,
      )

      assert.equal(
        option.isArchived,
        false,
        `${kind}:${option.key} starts retired`,
      )
    }

    assert.equal(
      listed.body.archived[kind].length,
      0,
      `${kind} starts with archived rows`,
    )
  }

  // Land is what hides bedrooms, so it is a flag on the row rather than a name match: a
  // Farmhouse is land plus a house and its owner still needs the rooms.
  const land = new Set(
    propertyTypes
      .filter((option: Json) => option.isLand === true)
      .map((option: Json) => option.key),
  )

  assert.deepEqual(
    [...land].sort(),

    ["agricultural_land", "commercial_plot", "plot", "residential_plot"],
  )

  assert.equal(listed.body.canManage, true)

  // A sales consultant may not change the vocabulary but does have to read all nine
  // lists: the filter chips, the unit form and a printed quotation all name a type.
  const { cookies: agent } = await signIn("sales.agent@deedorbit.com")

  const agentRead = await readCategoryLists(agent)

  assert.equal(agentRead.status, 200, JSON.stringify(agentRead.body))

  assert.equal(agentRead.body.canManage, false)

  assert.deepEqual(
    Object.keys(agentRead.body.options).sort(),

    Object.keys(listed.body.options).sort(),
  )

  assert.equal(
    agentRead.body.options.property_type.length,

    listed.body.options.property_type.length,
  )
})

test("a unit carries the category block every screen reads", async () => {
  const { cookies } = await signIn("projects@deedorbit.com")

  const { projectId, nodeId } = await inventoryPlot(
    cookies,
    "Category Contract Plot",
  )

  const created = await addUnit(cookies, projectId, {
    unitCode: "CAT-1",

    structureNodeId: nodeId,

    propertyType: "Shop",

    subtype: "Corner Shop",

    furnishing: "Unfurnished",

    saleMode: "Both Available",

    possession: "Ready",

    ownership: "Freehold",

    sizeValue: 9,

    sizeUnit: "Marla",

    basePrice: 18_500_000,

    bedrooms: 3,

    bathrooms: 2,

    parking: 1,

    facing: "north",

    floorNumber: 1,

    amenities: ["Lift", "Security"],

    address: "Plot 12, Main Boulevard",

    areaCity: "Site Area D",

    latitude: 24.7039,

    longitude: 67.0915,

    description: "Corner shop on the ground floor.",

    media: [
      { kind: "photo", href: "https://cdn.test/shop-1.jpg", isMain: true },

      { kind: "photo", href: "https://cdn.test/shop-2.jpg", isMain: true },

      {
        kind: "floor_plan",
        href: "https://cdn.test/shop-plan.pdf",
        isMain: true,
      },

      {
        kind: "video",
        href: "https://cdn.test/shop-walkthrough.mp4",
        isMain: true,
      },
    ],
  })

  assert.equal(created.status, 200, JSON.stringify(created.body))

  const unit = record(created.body.unit, "unit")

  const category = record(unit.category, "unit.category")

  assertExactKeys("UnitView", unit, UNIT_KEYS)

  assertExactKeys("UnitCategoryView", category, UNIT_CATEGORY_KEYS)

  assertExactKeys(
    "visibleFields",

    record(category.visibleFields, "visibleFields"),

    UNIT_VISIBLE_FIELD_KEYS,
  )

  // No `unitType` was sent: the property type names the coarse family the rest of the
  // product counts by, so a five-word select is not a second thing to fill in.
  assert.equal(unit.unitType, "shop")

  assert.equal(unit.sizeSqft, 2025)

  assert.equal(category.propertyTypeKey, "shop")

  assert.equal(category.propertyTypeLabel, "Shop")

  // Usage came from the type rather than from the request: choosing Shop should not also
  // require someone to say "Commercial".
  assert.equal(category.usageKey, "commercial")

  assert.equal(category.usageLabel, "Commercial")

  assert.equal(category.subtypeKey, "corner_shop")

  assert.equal(category.subtypeLabel, "Corner Shop")

  assert.equal(category.furnishingKey, "unfurnished")

  assert.equal(category.saleModeKey, "both")

  assert.equal(category.saleModeLabel, "Both Available")

  assert.equal(category.allowsInstallments, true)

  assert.equal(category.possessionKey, "ready")

  assert.equal(category.ownershipKey, "freehold")

  assert.equal(category.isLand, false)

  // Typed in marla, stored in square feet: the form shows what the seller said and every
  // price-per-square-foot comparison reads the converted figure.
  assert.equal(category.sizeValue, 9)

  assert.equal(category.sizeUnitKey, "marla")

  assert.equal(category.sizeUnitLabel, "Marla")

  assert.equal(category.sizeDisplay, "9 Marla")

  // A shop is nowhere anyone sleeps, so bedrooms are not offered — even though three
  // were sent and are kept on the row rather than silently thrown away.
  assert.equal(category.visibleFields.bedrooms, false)

  assert.equal(category.visibleFields.kitchens, false)

  assert.equal(category.visibleFields.lounges, false)

  assert.equal(category.visibleFields.bathrooms, true)

  assert.equal(category.visibleFields.floorNumber, true)

  assert.equal(category.visibleFields.subtype, true)

  assert.equal(category.visibleFields.amenities, true)

  assert.equal(category.bedrooms, 3)

  assert.deepEqual(category.detailSummary, [
    "2 bath",

    "1 parking",

    "North facing",

    "Floor 1",
  ])

  // Only this type's variants, in the order the workspace set them.
  assert.deepEqual(
    rows(category.subtypeOptions, "subtypeOptions").map(
      (option: Json) => option.key,
    ),

    [
      "ground_floor",

      "mezzanine",

      "corner_shop",

      "main_road",

      "inside_mall",

      "food_court",

      "kiosk",
    ],
  )

  assert.ok(
    !rows(category.subtypeOptions).some(
      (option: Json) => option.key === "park_facing",
    ),

    "a plot variant leaked into a shop's variants",
  )

  assert.deepEqual(category.amenityKeys, ["lift", "security"])

  assert.deepEqual(category.amenities, ["Lift", "Security"])

  const media = rows(category.media, "media")

  assert.equal(media.length, 4)

  assertExactKeys(
    "UnitMediaView",
    record(media[0], "a media item"),
    UNIT_MEDIA_KEYS,
  )

  assert.deepEqual(
    media.map((item: Json) => [item.kind, item.sortOrder]),

    [
      ["photo", 0],

      ["photo", 1],

      ["floor_plan", 2],

      ["video", 3],
    ],
  )

  // One card image by definition: only a photo may be main and the first request wins,
  // so four `isMain: true` in the payload is one main photo on the row.
  assert.deepEqual(
    media.filter((item: Json) => item.isMain).map((item: Json) => item.href),

    ["https://cdn.test/shop-1.jpg"],
  )

  assert.equal(category.mainPhoto, "https://cdn.test/shop-1.jpg")

  assert.equal(category.address, "Plot 12, Main Boulevard")

  assert.equal(category.areaCity, "Site Area D")

  assert.equal(category.latitude, 24.7039)

  assert.equal(category.longitude, 67.0915)

  // The list carries the same block, because the table, the grid and the sheet all read
  // one response rather than re-resolving a unit each.
  const listed = await call(cookies, "GET", `/api/projects/${projectId}/units`)

  assert.equal(listed.status, 200, JSON.stringify(listed.body))

  assertExactKeys("GET units", record(listed.body, "unit list"), UNIT_LIST_KEYS)

  const row = rows(listed.body.units, "units").find(
    (each: Json) => each.unitCode === "CAT-1",
  )

  assert.ok(row, "the unit is missing from its own project's list")

  assertExactKeys(
    "UnitCategoryView in a list",

    record(row.category, "a listed unit category"),

    UNIT_CATEGORY_KEYS,
  )

  assert.equal(row.category.sizeDisplay, "9 Marla")

  assert.deepEqual(
    rows(row.category.subtypeOptions).map((option: Json) => option.key),

    rows(category.subtypeOptions).map((option: Json) => option.key),
  )
})

test("the property type decides which detail fields are relevant", async () => {
  const { cookies } = await signIn("projects@deedorbit.com")

  const { projectId, nodeId } = await inventoryPlot(
    cookies,
    "Relevant Fields Plot",
  )

  // A flat is lived in and built on, so the room fields belong — and its variant picker
  // is empty, because this type has no variants to offer.
  const flat = await addUnit(cookies, projectId, {
    unitCode: "FLD-1",

    structureNodeId: nodeId,

    propertyType: "Flat",

    sizeValue: 12,

    sizeUnit: "Marla",

    basePrice: 9_800_000,

    bedrooms: 3,

    bathrooms: 2,
  })

  assert.equal(flat.status, 200, JSON.stringify(flat.body))

  assert.equal(flat.body.unit.unitType, "apartment")

  assert.equal(flat.body.unit.sizeSqft, 2700)

  const flatCategory = record(flat.body.unit.category, "flat category")

  assert.equal(flatCategory.usageKey, "residential")

  assert.equal(flatCategory.visibleFields.bedrooms, true)

  assert.equal(flatCategory.visibleFields.subtype, false)

  assert.deepEqual(rows(flatCategory.subtypeOptions, "flat variants"), [])

  assert.deepEqual(flatCategory.detailSummary, ["3 bed", "2 bath"])

  // Bare land answers a different question, so nobody sleeps on a plot and the room and
  // floor fields go. Parking, facing and amenities are exactly what a plot buyer asks
  // about, so those stay offered.
  const plot = await addUnit(cookies, projectId, {
    unitCode: "FLD-2",

    structureNodeId: nodeId,

    propertyType: "Plot",

    sizeValue: 2,

    sizeUnit: "Kanal",

    basePrice: 42_000_000,

    bedrooms: 4,

    bathrooms: 3,

    floorsCount: 2,

    floorNumber: 1,

    parking: 1,

    facing: "east",

    view: "Park facing",

    ageYears: 5,
  })

  assert.equal(plot.status, 200, JSON.stringify(plot.body))

  assert.equal(plot.body.unit.unitType, "plot")

  assert.equal(plot.body.unit.sizeSqft, 9000)

  const plotCategory = record(plot.body.unit.category, "plot category")

  assert.equal(plotCategory.isLand, true)

  assert.equal(plotCategory.sizeDisplay, "2 Kanal")

  for (const field of [
    "bedrooms",

    "bathrooms",

    "kitchens",

    "lounges",

    "floorsCount",

    "floorNumber",

    "view",

    "ageYears",
  ]) {
    assert.equal(
      plotCategory.visibleFields[field],

      false,

      `bare land still offers ${field}`,
    )
  }

  for (const field of ["parking", "facing", "amenities"]) {
    assert.equal(
      plotCategory.visibleFields[field],

      true,

      `bare land stopped offering ${field}`,
    )
  }

  // Kept on the row rather than thrown away, so re-typing the unit does not lose what
  // somebody recorded while it was called a house.
  assert.equal(plotCategory.bedrooms, 4)

  assert.deepEqual(plotCategory.detailSummary, ["1 parking", "East facing"])

  assert.deepEqual(
    rows(plotCategory.subtypeOptions, "plot variants").map(
      (option: Json) => option.key,
    ),

    ["corner", "park_facing", "main_boulevard", "normal"],
  )

  // The override a mixed-use building needs: shop downstairs, residence above, so it is
  // the usage and not the type that brings the bedrooms field back.
  const mixed = await addUnit(cookies, projectId, {
    unitCode: "FLD-3",

    structureNodeId: nodeId,

    propertyType: "Shop",

    usageCategory: "Mixed Use",

    subtype: "Mezzanine",

    sizeValue: 4,

    sizeUnit: "Marla",

    basePrice: 12_000_000,

    bedrooms: 1,
  })

  assert.equal(mixed.status, 200, JSON.stringify(mixed.body))

  const mixedCategory = record(mixed.body.unit.category, "mixed category")

  assert.equal(mixedCategory.usageKey, "mixed_use")

  assert.equal(mixedCategory.subtypeKey, "mezzanine")

  assert.equal(mixedCategory.visibleFields.bedrooms, true)

  // Three refusals, each isolating one field. An unknown type is refused by name rather
  // than defaulted, because silently turning "Houseboat" into a Plot is a wrong word in
  // front of a buyer; `unitType` is sent so the type is the only thing wrong with it.
  const unknownType = await addUnit(cookies, projectId, {
    unitCode: "FLD-4",

    structureNodeId: nodeId,

    unitType: "apartment",

    propertyType: "Houseboat",

    sizeValue: 5,

    sizeUnit: "Marla",

    basePrice: 1_000_000,
  })

  assert.equal(unknownType.status, 400, JSON.stringify(unknownType.body))

  assert.match(unknownType.body.error.fields.propertyType, /^Choose one of: /)

  assert.ok(!unknownType.body.error.fields.propertyType.includes("Houseboat"))

  // A variant that belongs to another type is refused even though the word is real: Park
  // Facing is a correct answer, just not one a shop can give.
  const wrongParent = await addUnit(cookies, projectId, {
    unitCode: "FLD-5",

    structureNodeId: nodeId,

    propertyType: "Shop",

    subtype: "Park Facing",

    sizeValue: 5,

    sizeUnit: "Marla",

    basePrice: 1_000_000,
  })

  assert.equal(wrongParent.status, 400, JSON.stringify(wrongParent.body))

  assert.ok(wrongParent.body.error.fields.subtype)

  const oddFacing = await addUnit(cookies, projectId, {
    unitCode: "FLD-6",

    structureNodeId: nodeId,

    propertyType: "Shop",

    facing: "upwards",

    sizeValue: 5,

    sizeUnit: "Marla",

    basePrice: 1_000_000,
  })

  assert.equal(oddFacing.status, 400, JSON.stringify(oddFacing.body))

  assert.equal(
    oddFacing.body.error.fields.facing,
    "Choose North, South, East or West.",
  )

  // None of the three refusals landed.
  const listed = await call(cookies, "GET", `/api/projects/${projectId}/units`)

  assert.equal(rows(listed.body.units, "units").length, 3)
})

test("a unit recorded before categories existed still opens, and is filled without its own figures moving", async () => {
  const { cookies } = await signIn("projects@deedorbit.com")

  const { projectId, nodeId } = await inventoryPlot(
    cookies,
    "Legacy Backfill Plot",
  )

  // The pre-category shape of the same request: a coarse `unitType`, a square-foot size,
  // and none of the twenty-five new columns. This is what every stored row already looks
  // like, so the upgrade has to leave it working rather than merely writable.
  const created = await addUnit(cookies, projectId, validUnitBody(nodeId))

  assert.equal(created.status, 200, JSON.stringify(created.body))

  const legacy = record(created.body.unit.category, "legacy category")

  assert.equal(legacy.propertyTypeKey, null)

  // Nothing is invented: with no type there are no variants, and the fields a residential
  // unit would need stay hidden until somebody says what this is.
  assert.equal(legacy.usageKey, null)

  assert.equal(legacy.saleModeKey, null)

  assert.equal(legacy.allowsInstallments, true)

  assert.deepEqual(rows(legacy.subtypeOptions, "legacy variants"), [])

  assert.equal(legacy.visibleFields.bedrooms, false)

  // The word still prints, derived from the family the row already carried, because a
  // document with a blank where a category belongs reads like broken software.
  assert.equal(legacy.propertyTypeLabel, "Apartment")

  assert.equal(created.body.unit.unitType, "apartment")

  assert.equal(legacy.sizeValue, 1450)

  assert.equal(legacy.sizeDisplay, "1450 Square Feet")

  assert.deepEqual(legacy.amenityKeys, [])

  assert.deepEqual(rows(legacy.media, "legacy media"), [])

  assert.equal(legacy.mainPhoto, null)

  assert.equal(legacy.bedrooms, null)

  assert.equal(created.body.unit.basePrice, 2_450_000)

  // An unrelated edit neither disturbs the classification nor manufactures one.
  const repriced = await call(
    cookies,

    "PATCH",

    `/api/projects/${projectId}/units/${created.body.unit.id}`,

    { basePrice: 2_600_000 },
  )

  assert.equal(repriced.status, 200, JSON.stringify(repriced.body))

  assert.equal(repriced.body.unit.category.propertyTypeKey, null)

  assert.equal(repriced.body.unit.basePrice, 2_600_000)

  const nullCount = () =>
    get<{ total: number }>(
      `SELECT count(*) AS total FROM inventory_units WHERE property_type IS NULL`,
    )?.total ?? 0

  assert.ok(nullCount() > 0, "nothing was left for the backfill to do")

  backfillUnitCategories(getDb())

  assert.equal(nullCount(), 0)

  // Re-running the upgrade on a database that has already had it is a no-op, which is the
  // only reason it is safe to leave in the migration rather than run once by hand.
  backfillUnitCategories(getDb())

  assert.equal(nullCount(), 0)

  const filled = await call(cookies, "GET", `/api/projects/${projectId}/units`)

  assert.equal(filled.status, 200, JSON.stringify(filled.body))

  const row = rows(filled.body.units, "units").find(
    (each: Json) => each.id === created.body.unit.id,
  )

  assert.ok(row, "the backfilled unit vanished from its own project")

  const category = record(row.category, "backfilled category")

  // The coarse family it already carried, read as the type that names it.
  assert.equal(category.propertyTypeKey, "apartment")

  assert.equal(category.usageKey, "residential")

  assert.equal(category.furnishingKey, "unfurnished")

  assert.equal(category.saleModeKey, "both")

  assert.equal(category.ownershipKey, "freehold")

  assert.equal(category.sizeUnitKey, "square_feet")

  // A unit still on the market is not a unit handed over.
  assert.equal(category.possessionKey, "under_construction")

  assert.equal(category.allowsInstallments, true)

  // Now that the type is known, the fields it makes relevant appear — but the room
  // counts stay a dash, because no old row ever held them and inventing three bedrooms
  // for every legacy apartment would be a fact nobody recorded.
  assert.equal(category.visibleFields.bedrooms, true)

  assert.equal(category.bedrooms, null)

  // And the price a human set is still exactly what a human set it to.
  assert.equal(row.basePrice, 2_600_000)

  assert.equal(row.sizeSqft, 1450)

  assert.equal(category.sizeValue, 1450)
})

test("a workspace can add a property type and use it wherever a built-in one works", async () => {
  const { cookies } = await signIn("admin@deedorbit.com")

  // The admin owns the vocabulary, but the plot and the unit that use it belong to the
  // project manager: only that role holds `projects.create`.

  const { cookies: manager } = await signIn("projects@deedorbit.com")

  const added = await addOption(cookies, {
    kind: "property_type",

    label: "Guest House",

    unitType: "villa",

    usageKey: "residential",
  })

  assert.equal(added.status, 200, JSON.stringify(added.body))

  assertExactKeys("POST inventory-options", record(added.body, "add option"), [
    "option",
  ])

  const option = record(added.body.option, "added option")

  assertExactKeys("InventoryOptionView", option, INVENTORY_OPTION_KEYS)

  assert.equal(option.key, "guest_house")

  // The coarse family is chosen by the admin rather than guessed, because reports, dealer
  // scopes and the sold/available tiles still count by it.
  assert.equal(option.legacyType, "villa")

  assert.equal(option.usageKey, "residential")

  assert.equal(option.isBuiltin, false)

  // Appended after the shipped list rather than squeezed into it, so the order an admin
  // set is not reshuffled by the next release adding a type.
  assert.equal(option.sortOrder, INVENTORY_OPTION_SEEDS.property_type.length)

  // While nothing holds the row, renaming it is an ordinary edit and the stored key
  // follows the word — which is exactly what has to stop being true once a unit does.
  const renamed = await renameOption(cookies, option.id, {
    label: "Guest Suite",
  })

  assert.equal(renamed.status, 200, JSON.stringify(renamed.body))

  assert.equal(renamed.body.option.key, "guest_suite")

  assert.equal(renamed.body.option.label, "Guest Suite")

  const { projectId, nodeId } = await inventoryPlot(
    manager,

    "Custom Type Plot",
  )

  // Typed the way the CSV importer types it — the label, not the key — and it resolves.
  const created = await addUnit(manager, projectId, {
    unitCode: "CUS-1",

    structureNodeId: nodeId,

    propertyType: "Guest Suite",

    sizeValue: 10,

    sizeUnit: "Marla",

    basePrice: 25_000_000,

    bedrooms: 5,
  })

  assert.equal(created.status, 200, JSON.stringify(created.body))

  const category = record(created.body.unit.category, "custom category")

  assert.equal(category.propertyTypeKey, "guest_suite")

  assert.equal(category.propertyTypeLabel, "Guest Suite")

  assert.equal(category.usageKey, "residential")

  assert.equal(created.body.unit.unitType, "villa")

  assert.equal(created.body.unit.sizeSqft, 2250)

  assert.equal(category.visibleFields.bedrooms, true)

  assert.deepEqual(rows(category.subtypeOptions, "custom variants"), [])

  // The Settings tab counts units per option, which is what lets it warn "1 unit still
  // says Guest Suite" before an admin retires the word.
  const listed = await readCategoryLists(cookies)

  assert.equal(listed.body.unitCounts["property_type:guest_suite"], 1)
})

test("renaming or retiring a category the stock already uses leaves the stock readable", async () => {
  const { cookies } = await signIn("admin@deedorbit.com")

  // Renaming and retiring are the admin's, but the stock that holds the word is filed by
  // the project manager, the only role with `projects.create`.

  const { cookies: manager } = await signIn("projects@deedorbit.com")

  const { projectId, nodeId } = await inventoryPlot(
    manager,

    "Rename Hold Plot",
  )

  const created = await addUnit(manager, projectId, {
    unitCode: "REN-1",

    structureNodeId: nodeId,

    propertyType: "Guest Suite",

    sizeValue: 8,

    sizeUnit: "Marla",

    basePrice: 20_000_000,
  })

  assert.equal(created.status, 200, JSON.stringify(created.body))

  const unitId = created.body.unit.id

  const before = await readCategoryLists(cookies)

  const option = optionByKey(before.body, "property_type", "guest_suite")

  // Held by a unit now, so the key stays put and only the word moves: `REN-1` must keep
  // resolving to this row instead of becoming an unknown category overnight.
  const renamed = await renameOption(cookies, option.id, {
    label: "Heritage Bungalow",
  })

  assert.equal(renamed.status, 200, JSON.stringify(renamed.body))

  assert.equal(renamed.body.option.key, "guest_suite")

  assert.equal(renamed.body.option.label, "Heritage Bungalow")

  const reread = await call(cookies, "GET", `/api/projects/${projectId}/units`)

  const held = rows(reread.body.units, "units").find(
    (each: Json) => each.id === unitId,
  )

  assert.ok(held, "the renamed unit vanished from its own project")

  assert.equal(held.category.propertyTypeKey, "guest_suite")

  assert.equal(held.category.propertyTypeLabel, "Heritage Bungalow")

  assert.equal(before.body.unitCounts["property_type:guest_suite"], 2)

  // Retiring it takes the word out of every picker while the unit that already holds it
  // still reads correctly, which is the whole point of a soft archive.
  const retired = await renameOption(cookies, option.id, { isArchived: true })

  assert.equal(retired.status, 200, JSON.stringify(retired.body))

  assert.equal(retired.body.option.isArchived, true)

  const afterRetire = await readCategoryLists(cookies)

  assert.ok(
    !rows(afterRetire.body.options.property_type, "property types").some(
      (each: Json) => each.key === "guest_suite",
    ),

    "a retired type is still offered in the picker",
  )

  assert.deepEqual(
    rows(afterRetire.body.archived.property_type, "archived types").map(
      (each: Json) => each.key,
    ),

    ["guest_suite"],
  )

  const stillReadable = await call(
    cookies,
    "GET",
    `/api/projects/${projectId}/units`,
  )

  const stillHeld = rows(stillReadable.body.units, "units").find(
    (each: Json) => each.id === unitId,
  )

  assert.ok(stillHeld, "the archived type's unit vanished from its own project")

  assert.equal(stillHeld.category.propertyTypeLabel, "Heritage Bungalow")

  // But a new unit cannot be filed under a word this workspace has retired, so retiring
  // one actually stops the stock growing under it.
  const refused = await addUnit(manager, projectId, {
    unitCode: "REN-2",

    structureNodeId: nodeId,

    unitType: "villa",

    propertyType: "Heritage Bungalow",

    sizeValue: 8,

    sizeUnit: "Marla",

    basePrice: 20_000_000,
  })

  assert.equal(refused.status, 400, JSON.stringify(refused.body))

  assert.match(refused.body.error.fields.propertyType, /^Choose one of: /)

  assert.ok(
    !refused.body.error.fields.propertyType.includes("Heritage Bungalow"),
  )

  // A built-in category may be renamed, which is the one place it differs from a built-in
  // status: a status is a state machine other code switches on, while these lists are only
  // the words a workspace files its own stock under.
  const kiosk = optionByKey(afterRetire.body, "property_type", "kiosk")

  assert.equal(kiosk.isBuiltin, true)

  const renamedBuiltin = await renameOption(cookies, kiosk.id, {
    label: "Kiosk Corner",
  })

  assert.equal(renamedBuiltin.status, 200, JSON.stringify(renamedBuiltin.body))

  assert.equal(renamedBuiltin.body.option.isBuiltin, true)

  assert.equal(renamedBuiltin.body.option.key, "kiosk_corner")

  // Put the shipped word back before anything else reads the vocabulary: the seed list is
  // what every other workspace and the import template are written against.
  const restored = await renameOption(cookies, kiosk.id, { label: "Kiosk" })

  assert.equal(restored.status, 200, JSON.stringify(restored.body))

  assert.equal(restored.body.option.key, "kiosk")
})

test("the vocabulary is one admin's to edit, and a bad body is refused on its own field", async () => {
  const { cookies: admin } = await signIn("admin@deedorbit.com")

  const { cookies: agent } = await signIn("sales.agent@deedorbit.com")

  // A consultant reads all nine lists to fill the pickers and may not change one word of
  // them: what a unit can be filed as is a workspace-wide decision, not a desk decision.
  const refusedAdd = await addOption(agent, {
    kind: "amenity",
    label: "Concierge",
  })

  assert.equal(refusedAdd.status, 403, JSON.stringify(refusedAdd.body))

  assert.equal(refusedAdd.body.error.code, "permission_denied")

  assert.match(refusedAdd.body.error.message, /settings\.edit/)

  const listed = await readCategoryLists(admin)

  const kiosk = optionByKey(listed.body, "property_type", "kiosk")

  const refusedRename = await renameOption(agent, kiosk.id, {
    label: "Kiosk Two",
  })

  assert.equal(refusedRename.status, 403, JSON.stringify(refusedRename.body))

  assert.match(refusedRename.body.error.message, /settings\.edit/)

  const idsBefore = optionIds(listed.body)

  // Each body below is wrong in exactly one way, and the refusal names exactly that
  // field, so the Settings form can put the sentence under the input rather than in a
  // banner over the page. `Object.keys` is asserted so a second, accidental error on the
  // same body cannot hide behind the one being checked.
  const noKind = await addOption(admin, { label: "Concierge" })

  assert.equal(noKind.status, 400, JSON.stringify(noKind.body))

  assert.deepEqual(Object.keys(noKind.body.error.fields), ["kind"])

  assert.equal(noKind.body.error.fields.kind, "Choose which list to add to.")

  const noName = await addOption(admin, { kind: "property_type", label: "" })

  assert.equal(noName.status, 400, JSON.stringify(noName.body))

  assert.deepEqual(Object.keys(noName.body.error.fields), ["label"])

  assert.equal(noName.body.error.fields.label, "Give the option a name.")

  const duplicate = await addOption(admin, {
    kind: "property_type",
    label: "Shop",
  })

  assert.equal(duplicate.status, 400, JSON.stringify(duplicate.body))

  assert.deepEqual(Object.keys(duplicate.body.error.fields), ["label"])

  assert.equal(
    duplicate.body.error.fields.label,
    'An option called "Shop" already exists.',
  )

  // A name is normalised into the stored key, and a name of pure punctuation normalises
  // to nothing — an unusable value the label would never explain.
  const unusable = await addOption(admin, {
    kind: "property_type",
    label: "???",
  })

  assert.equal(unusable.status, 400, JSON.stringify(unusable.body))

  assert.deepEqual(Object.keys(unusable.body.error.fields), ["label"])

  assert.equal(
    unusable.body.error.fields.label,
    "Use at least one letter or digit in the name.",
  )

  const orphanSubtype = await addOption(admin, {
    kind: "property_subtype",

    label: "Rooftop Deck",
  })

  assert.equal(orphanSubtype.status, 400, JSON.stringify(orphanSubtype.body))

  assert.deepEqual(Object.keys(orphanSubtype.body.error.fields), ["parentKey"])

  assert.equal(
    orphanSubtype.body.error.fields.parentKey,

    "Choose which property type this variant belongs to.",
  )

  // A variant hung off a type that does not exist would be unreachable in every picker,
  // because the picker only ever asks for variants of a type it already has.
  const phantomParent = await addOption(admin, {
    kind: "property_subtype",

    label: "Rooftop Deck",

    parentKey: "houseboat",
  })

  assert.equal(phantomParent.status, 400, JSON.stringify(phantomParent.body))

  assert.deepEqual(Object.keys(phantomParent.body.error.fields), ["parentKey"])

  assert.match(
    phantomParent.body.error.fields.parentKey,

    /^Choose which property type this variant belongs to: /,
  )

  const noFactor = await addOption(admin, { kind: "size_unit", label: "Foot" })

  assert.equal(noFactor.status, 400, JSON.stringify(noFactor.body))

  assert.deepEqual(Object.keys(noFactor.body.error.fields), ["valueNum"])

  assert.equal(
    noFactor.body.error.fields.valueNum,

    "Enter how many square feet one of this unit is.",
  )

  const zeroFactor = await addOption(admin, {
    kind: "size_unit",

    label: "Square Metre",

    valueNum: 0,
  })

  assert.equal(zeroFactor.status, 400, JSON.stringify(zeroFactor.body))

  assert.deepEqual(Object.keys(zeroFactor.body.error.fields), ["valueNum"])

  assert.match(
    zeroFactor.body.error.fields.valueNum,

    /^Enter a square-foot value between /,
  )

  // Every refusal above wrote nothing, so a rejected request cannot leave a half-list or
  // reorder the pickers every other screen reads.
  const finalLists = await readCategoryLists(admin)

  assert.deepEqual(optionIds(finalLists.body), idsBefore)
})

test("another tenant cannot see, rename, or reuse this workspace's categories", async () => {
  const { cookies: admin } = await signIn("admin@deedorbit.com")

  // The unit that proves the isolation is filed by the project manager, which is the role
  // that holds `projects.create` alongside `inventory.edit`.

  const { cookies: manager } = await signIn("projects@deedorbit.com")

  const added = await addOption(admin, {
    kind: "property_type",

    label: "Board Office",

    unitType: "office",

    usageKey: "commercial",
  })

  assert.equal(added.status, 200, JSON.stringify(added.body))

  const optionId = added.body.option.id

  const signup = await call(jar(), "POST", "/api/auth/signup", {
    email: "categories.rival@example.com",

    fullName: "Categories Rival",

    workspaceName: "Rival Categories",

    password: "Rival-Labels-2026",
  })

  assert.equal(signup.status, 200, JSON.stringify(signup.body))

  const { cookies: rival } = await signIn(
    "categories.rival@example.com",

    "Rival-Labels-2026",
  )

  // A brand-new workspace starts with exactly the shipped vocabulary: it neither inherits
  // another tenant's additions nor has to configure anything before it can be used.
  const rivalLists = await readCategoryLists(rival)

  assert.equal(rivalLists.status, 200, JSON.stringify(rivalLists.body))

  assert.deepEqual(
    rows(rivalLists.body.options.property_type, "rival types").map(
      (each: Json) => each.key,
    ),

    INVENTORY_OPTION_SEEDS.property_type.map((seed) => seed.key),
  )

  assert.ok(
    !rows(rivalLists.body.options.property_type).some(
      (each: Json) => each.key === "board_office",
    ),

    "another tenant's custom category leaked into this workspace's list",
  )

  // Their option id is a miss rather than a forbidden: a 403 would confirm the row exists
  // and leak that some workspace files stock under "Board Office".
  const crossRename = await renameOption(rival, optionId, { label: "Stolen" })

  assert.equal(crossRename.status, 404, JSON.stringify(crossRename.body))

  const { projectId: rivalProject, nodeId: rivalNode } = await inventoryPlot(
    rival,

    "Rival Board Plot",
  )

  const rivalBody = {
    structureNodeId: rivalNode,

    unitType: "office",

    sizeValue: 3,

    sizeUnit: "Marla",

    basePrice: 5_000_000,
  }

  // It cannot file a unit under the other tenant's type in either language, and the
  // refusal lists only its own words, so the name does not leak back through the error.
  const byKey = await addUnit(rival, rivalProject, {
    ...rivalBody,

    unitCode: "RBO-1",

    propertyType: "board_office",
  })

  assert.equal(byKey.status, 400, JSON.stringify(byKey.body))

  assert.match(byKey.body.error.fields.propertyType, /^Choose one of: /)

  assert.ok(!byKey.body.error.fields.propertyType.includes("Board Office"))

  const byLabel = await addUnit(rival, rivalProject, {
    ...rivalBody,

    unitCode: "RBO-2",

    propertyType: "Board Office",
  })

  assert.equal(byLabel.status, 400, JSON.stringify(byLabel.body))

  assert.ok(byLabel.body.error.fields.propertyType)

  // The owning workspace uses it freely, which is what makes the four refusals above
  // about tenancy rather than about the word itself.
  const { projectId, nodeId } = await inventoryPlot(
    manager,

    "Board Office Plot",
  )

  const ours = await addUnit(manager, projectId, {
    unitCode: "BRD-1",

    structureNodeId: nodeId,

    propertyType: "Board Office",

    sizeValue: 3,

    sizeUnit: "Marla",

    basePrice: 5_000_000,
  })

  assert.equal(ours.status, 200, JSON.stringify(ours.body))

  assert.equal(ours.body.unit.category.propertyTypeKey, "board_office")

  assert.equal(ours.body.unit.category.usageKey, "commercial")

  assert.equal(ours.body.unit.unitType, "office")

  // The breakdown is scoped by tenant, not by the project id in the query string: naming
  // another workspace's project reads as an empty stock rather than as somebody else's.
  const rivalSummary = await call(
    rival,

    "GET",

    `/api/inventory-categories?project=${projectId}`,
  )

  assert.equal(rivalSummary.status, 200, JSON.stringify(rivalSummary.body))

  assert.equal(rivalSummary.body.total, 0)

  assert.deepEqual(rows(rivalSummary.body.groups, "rival groups"), [])

  const oursSummary = await call(
    admin,

    "GET",

    `/api/inventory-categories?project=${projectId}`,
  )

  assert.equal(oursSummary.status, 200, JSON.stringify(oursSummary.body))

  assert.equal(oursSummary.body.total, 1)

  assert.equal(oursSummary.body.groups[0].label, "Board Office")
})

/**
 * Split one CSV line into cells, honouring a quoted field that contains a comma.
 *
 * Only as much of a reader as the template needs, and written here rather than imported
 * from the client so the test measures the file as a spreadsheet would read it.
 */

function splitCsvRow(line: string): string[] {
  const cells: string[] = []

  let cell = ""

  let quoted = false

  for (let index = 0; index < line.length; index++) {
    const char = line[index]

    if (quoted) {
      if (char === '"') {
        if (line[index + 1] === '"') {
          cell += '"'

          index++
        } else quoted = false
      } else cell += char

      continue
    }

    if (char === '"') {
      quoted = true

      continue
    }

    if (char === ",") {
      cells.push(cell)

      cell = ""

      continue
    }

    cell += char
  }

  cells.push(cell)

  return cells
}

test("the downloadable template lines every example cell up with its own column", () => {
  const columns = UNIT_IMPORT_FIELDS.map((field) => field.column)

  assert.deepEqual(splitCsvRow(unitImportTemplateHeader()), columns)

  const rows = unitImportTemplateRows()

  assert.equal(rows.length, 1)

  const cells = splitCsvRow(rows[0] ?? "")

  // The failure this exists to catch is a short example row: hand-typed commas drift when
  // a column is added, and everything after the gap then sits under the wrong name —
  // `North` filed as Floors, the amenity list filed as an age — in the one file people use
  // to learn the format. Counting cells against the field list makes that impossible to
  // write, and counting them again here makes it impossible to ship.

  assert.equal(
    cells.length,

    columns.length,

    `the example carries ${cells.length} cells for ${columns.length} columns`,
  )

  const example = new Map(
    columns.map((column, index) => [column, cells[index] ?? ""]),
  )

  assert.equal(example.get("Unit Code"), "SHOP-12")

  assert.equal(example.get("Property Type"), "Shop")

  assert.equal(example.get("Sub-type"), "Corner Shop")

  assert.equal(example.get("Usage"), "Commercial")

  assert.equal(example.get("Block / Floor"), "Tower A / Ground Floor")

  assert.equal(example.get("Size Unit"), "Marla")

  assert.equal(example.get("Payment Mode"), "Installment")

  assert.equal(example.get("Furnishing"), "Unfurnished")

  assert.equal(example.get("Possession"), "Ready")

  assert.equal(example.get("Ownership"), "Freehold")

  assert.equal(example.get("Status"), "Available")

  // What the example is for: a shop records no bedrooms, and the room counts that do
  // belong to it sit in their own columns rather than drifting left.

  assert.equal(example.get("Bedrooms"), "")

  assert.equal(example.get("Bathrooms"), "2")

  assert.equal(example.get("Kitchens"), "")

  assert.equal(example.get("Parking"), "1")

  assert.equal(example.get("Floors"), "")

  assert.equal(example.get("Floor Number"), "1")

  assert.equal(example.get("Facing"), "North")

  assert.equal(example.get("View"), "Park view")

  assert.equal(example.get("Age (years)"), "")

  assert.equal(example.get("Amenities"), "Lift; Generator; Security; Parking")

  assert.equal(example.get("Address"), "Plot 12 Main Boulevard")

  assert.equal(example.get("Area / City"), "Site Area D")

  assert.equal(example.get("Latitude"), "24.7039")

  assert.equal(example.get("Longitude"), "67.0915")

  assert.equal(example.get("Photos"), "https://example.com/shop-12.jpg")

  assert.notEqual(example.get("Description"), "")

  for (const field of UNIT_IMPORT_FIELDS) {
    const value = (example.get(field.column) ?? "").trim()

    if (field.required) {
      assert.notEqual(
        value,

        "",

        `${field.column} is required, so the example cannot leave it blank`,
      )
    }

    // A number column holding text would be refused on every row a person copies from the
    // example, which reads as the importer being broken rather than the sheet.

    if (field.kind === "integer" || field.kind === "decimal") {
      if (value === "") continue

      assert.ok(
        Number.isFinite(Number(value.replace(/,/g, ""))),

        `${field.column} holds ${value}, which is not a number`,
      )
    }
  }
})

test("a bulk import lands the good rows and reports the bad ones by row and field", async () => {
  const { cookies } = await signIn("projects@deedorbit.com")

  const { projectId } = await inventoryPlot(cookies, "Bulk Import Plot")

  // The cells a spreadsheet hands over are text, so every value here is quoted: a sheet
  // that could only import the numbers a parser had already turned into numbers would be
  // a second format nobody writes.
  const shopRow = {
    row: 2,

    values: {
      unitCode: "IMP-1",

      propertyType: "Shop",

      subtype: "Corner Shop",

      usage: "Commercial",

      structurePath: "Tower A",

      sizeValue: "4.5",

      sizeUnit: "Marla",

      basePrice: "18500000",

      saleMode: "Lump Sum",

      furnishing: "Unfurnished",

      possession: "Ready",

      ownership: "Freehold",

      status: "Available",

      bathrooms: "2",

      amenities: "Lift; Generator",

      photos: "https://cdn.test/a.jpg;https://cdn.test/b.jpg",

      floorPlanUrl: "https://cdn.test/plan.pdf",

      videoUrl: "https://cdn.test/walk.mp4",

      facing: "North",

      address: "Shop 4, Main Boulevard",

      areaCity: "Clifton Block 5, Karachi",
    },
  }

  const flatRow = {
    row: 3,

    values: {
      unitCode: "IMP-2",

      propertyType: "Flat",

      structurePath: "Tower A",

      sizeValue: "1450",

      basePrice: "9800000",

      bedrooms: "3",

      bathrooms: "2",
    },
  }

  const unknownRow = {
    row: 4,

    values: {
      ...shopRow.values,

      unitCode: "IMP-3",

      propertyType: "Houseboat",
    },
  }

  const duplicateRow = {
    row: 5,

    values: shopRow.values,
  }

  const phantomRow = {
    row: 6,

    values: {
      ...shopRow.values,

      unitCode: "IMP-4",

      structurePath: "Tower Z",
    },
  }

  const imported = await call(
    cookies,

    "POST",

    `/api/projects/${projectId}/units/import`,

    { rows: [shopRow, flatRow, unknownRow, duplicateRow, phantomRow] },
  )

  assert.equal(imported.status, 200, JSON.stringify(imported.body))

  assertExactKeys(
    "POST units import",
    record(imported.body, "import"),
    UNIT_IMPORT_KEYS,
  )

  // A sheet with three typos in five rows is a normal thing, so the batch is not refused:
  // the two good rows land and the three bad ones come back as a report.
  assert.equal(imported.body.created, 2)

  assert.equal(imported.body.failed, 3)

  const units = rows(imported.body.units, "imported units")

  assert.equal(units.length, 2)

  assertExactKeys("UnitView", record(units[0], "an imported unit"), UNIT_KEYS)

  const shop = units[0]

  assert.equal(shop.unitCode, "IMP-1")

  assert.equal(shop.unitType, "shop")

  // Four and a half marla is not a whole square foot, and the column is: the figure the
  // price-per-square-foot comparisons read is rounded once, on the way in.
  assert.equal(shop.sizeSqft, 1013)

  const shopCategory = record(shop.category, "imported shop category")

  assert.equal(shopCategory.propertyTypeKey, "shop")

  assert.equal(shopCategory.subtypeKey, "corner_shop")

  assert.equal(shopCategory.usageKey, "commercial")

  assert.equal(shopCategory.saleModeKey, "lump_sum")

  assert.equal(shopCategory.allowsInstallments, false)

  assert.equal(shopCategory.sizeUnitKey, "marla")

  assert.equal(shopCategory.sizeDisplay, "4.5 Marla")

  assert.equal(shop.status, "available")

  assert.deepEqual(shop.structurePath, ["Tower A"])

  // The template's Amenities column is one cell of text, and a semicolon is the separator
  // a sheet already uses for a multi-value cell because a comma is inside every column.
  assert.deepEqual(shopCategory.amenityKeys, ["generator", "lift"])

  assert.deepEqual(shopCategory.amenities, ["Generator", "Lift"])

  assert.deepEqual(
    rows(shopCategory.media, "imported media").map((item: Json) => item.kind),

    ["photo", "photo", "floor_plan", "video"],
  )

  assert.equal(shopCategory.mainPhoto, "https://cdn.test/a.jpg")

  assert.deepEqual(shopCategory.detailSummary, ["2 bath", "North facing"])

  assert.equal(shopCategory.address, "Shop 4, Main Boulevard")

  assert.equal(shopCategory.areaCity, "Clifton Block 5, Karachi")

  // A row that names no size unit is not a broken row: square feet is what the template
  // says to assume, and the two columns stay consistent rather than one staying null.
  const flat = units[1]

  assert.equal(flat.unitCode, "IMP-2")

  assert.equal(flat.unitType, "apartment")

  assert.equal(flat.sizeSqft, 1450)

  assert.equal(flat.category.sizeUnitKey, "square_feet")

  assert.equal(flat.category.visibleFields.bedrooms, true)

  assert.deepEqual(flat.category.detailSummary, ["3 bed", "2 bath"])

  // An imported unit is on the market because a person said so with a sheet, so its trail
  // names that person. The history column carries a foreign key to `users`, which means a
  // fabricated actor is not merely untidy: it cannot be written at all.
  const trail = await call(
    cookies,

    "GET",

    `/api/projects/${projectId}/units/${shop.id}/status-history`,
  )

  assert.equal(trail.status, 200, JSON.stringify(trail.body))

  const opening = rows(trail.body.entries, "imported trail").at(-1)

  assert.ok(opening)

  assert.equal(opening.toStatus, "available")

  assert.equal(opening.source, "manual")

  assert.notEqual(opening.changedByUserId, "import")

  assert.ok(
    get<{ id: string }>(
      `SELECT id FROM users WHERE id = ?`,
      opening.changedByUserId,
    ),

    "the import trail names a user who does not exist",
  )

  assert.ok(opening.changedByName)

  // The report keeps the sheet's own row numbers, so "row 4" is the line the user sees.
  const failures = rows(imported.body.failures, "import failures")

  assert.deepEqual(
    failures.map((each: Json) => each.row),
    [4, 5, 6],
  )

  for (const failure of failures) {
    assertExactKeys(
      "import failure",

      record(failure, "a failure"),

      UNIT_IMPORT_FAILURE_KEYS,
    )
  }

  // A type this workspace does not have is refused in words it can act on, and does not
  // quietly become "plot" the way a defaulted import would.
  assert.deepEqual(Object.keys(failures[0].errors), ["propertyType"])

  assert.equal(
    failures[0].errors.propertyType,

    "Every row needs a property type this workspace has.",
  )

  assert.equal(failures[0].unitCode, "IMP-3")

  assert.deepEqual(Object.keys(failures[1].errors), ["unitCode"])

  assert.equal(
    failures[1].errors.unitCode,

    "Two rows in this file use the same unit code.",
  )

  assert.deepEqual(Object.keys(failures[2].errors), ["structurePath"])

  assert.equal(
    failures[2].errors.structurePath,

    'This project has no structure node called "Tower Z".',
  )

  // A code the project already holds is a row error too, not a constraint violation that
  // ends the batch: the other rows are still somebody's good work.
  const again = await call(
    cookies,

    "POST",

    `/api/projects/${projectId}/units/import`,

    { rows: [{ row: 7, values: shopRow.values }] },
  )

  assert.equal(again.status, 200, JSON.stringify(again.body))

  assert.equal(again.body.created, 0)

  assert.equal(
    again.body.failures[0].errors.unitCode,
    "This project already has a unit with that code.",
  )

  const listed = await call(cookies, "GET", `/api/projects/${projectId}/units`)

  assert.equal(rows(listed.body.units, "units").length, 2)

  // The guards a dialog needs before it has parsed anything.
  const noRows = await call(
    cookies,

    "POST",

    `/api/projects/${projectId}/units/import`,

    {},
  )

  assert.equal(noRows.status, 400, JSON.stringify(noRows.body))

  assert.equal(noRows.body.error.fields.rows, "Send the parsed rows to import.")

  const emptyRows = await call(
    cookies,

    "POST",

    `/api/projects/${projectId}/units/import`,

    { rows: [] },
  )

  assert.equal(emptyRows.status, 400, JSON.stringify(emptyRows.body))

  assert.match(emptyRows.body.error.fields.rows, /nothing to import/i)

  // Importing is bulk editing, so it needs the edit grant rather than the view one.
  const { cookies: agent } = await signIn("sales.agent@deedorbit.com")

  const refused = await call(
    agent,

    "POST",

    `/api/projects/${projectId}/units/import`,

    { rows: [shopRow] },
  )

  assert.equal(refused.status, 403, JSON.stringify(refused.body))
})

test("a lump-sum unit is booked without a payment plan step, and an installment unit still needs one", async () => {
  const { cookies: admin } = await signIn("admin@deedorbit.com")

  await setApprovalPolicy(admin, "booking", false, 0)

  const fixture = await bookableFixture(
    "Lump Sum Booking Plot",

    "LUMP-1",

    "+971501999001",
  )

  const { projectId, unitId } = fixture

  // Two saves, because re-typing a unit deliberately clears the variant that hung off the
  // old type — which is the cascade that would otherwise leave a Corner Shop on a Flat.
  const retyped = await call(
    admin,

    "PATCH",

    `/api/projects/${projectId}/units/${unitId}`,

    { propertyType: "shop" },
  )

  assert.equal(retyped.status, 200, JSON.stringify(retyped.body))

  // The coarse family moved with the type instead of staying `apartment` behind it, so the
  // reports and dealer scopes that count by `unit_type` follow what the form now says.
  assert.equal(retyped.body.unit.unitType, "shop")

  assert.equal(retyped.body.unit.category.propertyTypeKey, "shop")

  assert.equal(retyped.body.unit.category.usageKey, "commercial")

  assert.equal(retyped.body.unit.category.subtypeKey, null)

  const detailed = await call(
    admin,

    "PATCH",

    `/api/projects/${projectId}/units/${unitId}`,

    {
      subtype: "Corner Shop",

      saleMode: "Lump Sum",

      sizeValue: 5,

      sizeUnit: "Marla",

      parking: 1,

      facing: "north",
    },
  )

  assert.equal(detailed.status, 200, JSON.stringify(detailed.body))

  assert.equal(detailed.body.unit.category.subtypeKey, "corner_shop")

  assert.equal(detailed.body.unit.category.saleModeKey, "lump_sum")

  assert.equal(detailed.body.unit.category.allowsInstallments, false)

  assert.equal(detailed.body.unit.sizeSqft, 1125)

  const made = await call(fixture.manager, "POST", "/api/bookings", {
    projectId,

    unitId,

    customerId: fixture.customerId,

    bookingAmount: 500000,

    bookingDate: "2020-01-15",

    terms: "Full payment on transfer.",
  })

  assert.equal(made.status, 200, JSON.stringify(made.body))

  const bookingId = made.body.booking.id

  // The booking reads its own copy of the classification, so a quotation and a booking page
  // cannot disagree about what the thing being sold is.
  const read = await call(fixture.manager, "GET", `/api/bookings/${bookingId}`)

  assert.equal(read.status, 200, JSON.stringify(read.body))

  const facts = record(read.body.booking.unitFacts, "booking unitFacts")

  assertExactKeys("UnitFacts", facts, UNIT_FACTS_KEYS)

  assert.equal(facts.unitCode, "LUMP-1")

  assert.equal(facts.propertyType, "Shop")

  assert.equal(facts.subtype, "Corner Shop")

  assert.equal(facts.usage, "Commercial")

  assert.equal(facts.saleMode, "Lump Sum")

  assert.equal(facts.allowsInstallments, false)

  assert.equal(facts.sizeDisplay, "5 Marla")

  assert.deepEqual(facts.detailSummary, ["1 parking", "North facing"])

  // Nothing is invented for a document: a field nobody recorded prints a dash, not a guess.
  assert.equal(facts.furnishing, null)

  assert.equal(facts.possession, null)

  assert.equal(facts.ownership, null)

  assert.equal(facts.address, null)

  assert.equal(facts.areaCity, null)

  const { cookies: owner } = await signIn("owner@deedorbit.com")

  const plan = await call(
    owner,
    "GET",
    `/api/bookings/${bookingId}/payment-plan`,
  )

  assert.equal(plan.status, 200, JSON.stringify(plan.body))

  // The flag that hides the schedule builder is the same one the route below refuses on, so
  // the button and the server cannot disagree about whether a plan exists.
  assert.equal(plan.body.allowsInstallments, false)

  assert.equal(plan.body.saleMode, "Lump Sum")

  assert.equal(plan.body.canCreate, false)

  assert.equal(plan.body.plan, null)

  assert.deepEqual(rows(plan.body.installments, "installments"), [])

  const refused = await call(
    owner,

    "POST",

    `/api/bookings/${bookingId}/payment-plan/confirm`,

    {
      netAmount: 500000,

      downPaymentPercent: 20,

      charges: 0,

      frequency: "monthly",

      installmentCount: 4,

      balloonAmount: 0,

      startDate: "2020-01-31",
    },
  )

  assert.equal(refused.status, 422, JSON.stringify(refused.body))

  assert.match(refused.body.error.message, /^LUMP-1 is sold Lump Sum only/)

  // Contrast: the identical request against a unit nobody restricted still builds a plan,
  // so the refusal above is about the sale mode and not about a broken code path.
  const contrast = await bookableFixture(
    "Installment Contrast Plot",

    "LUMP-2",

    "+971501999002",
  )

  const second = await call(contrast.manager, "POST", "/api/bookings", {
    projectId: contrast.projectId,

    unitId: contrast.unitId,

    customerId: contrast.customerId,

    bookingAmount: 500000,

    bookingDate: "2020-01-15",

    terms: "Against the schedule.",
  })

  assert.equal(second.status, 200, JSON.stringify(second.body))

  const openPlan = await call(
    owner,

    "GET",

    `/api/bookings/${second.body.booking.id}/payment-plan`,
  )

  assert.equal(openPlan.status, 200, JSON.stringify(openPlan.body))

  assert.equal(openPlan.body.allowsInstallments, true)

  assert.equal(openPlan.body.saleMode, null)

  assert.equal(openPlan.body.canCreate, true)

  const built = await call(
    owner,

    "POST",

    `/api/bookings/${second.body.booking.id}/payment-plan/confirm`,

    {
      netAmount: 500000,

      downPaymentPercent: 20,

      charges: 0,

      frequency: "monthly",

      installmentCount: 4,

      balloonAmount: 0,

      startDate: "2020-01-31",
    },
  )

  assert.equal(built.status, 200, JSON.stringify(built.body))

  assert.equal(rows(built.body.installments, "installments").length, 5)

  // Left off, the way every booking test after this one expects it.
  await setApprovalPolicy(admin, "booking", false, 0)
})

test("the category cards and the dashboard breakdown count the stock the table shows", async () => {
  const { cookies } = await signIn("projects@deedorbit.com")

  const { projectId, nodeId } = await inventoryPlot(
    cookies,
    "Category Summary Plot",
  )

  const corner = await addUnit(cookies, projectId, {
    unitCode: "SUM-1",

    structureNodeId: nodeId,

    propertyType: "Shop",

    subtype: "Corner Shop",

    sizeValue: 9,

    sizeUnit: "Marla",

    basePrice: 18_500_000,
  })

  assert.equal(corner.status, 200, JSON.stringify(corner.body))

  const mezzanine = await addUnit(cookies, projectId, {
    unitCode: "SUM-2",

    structureNodeId: nodeId,

    propertyType: "Shop",

    subtype: "Mezzanine",

    sizeValue: 5,

    sizeUnit: "Marla",

    basePrice: 12_000_000,
  })

  assert.equal(mezzanine.status, 200, JSON.stringify(mezzanine.body))

  const flat = await addUnit(cookies, projectId, {
    unitCode: "SUM-3",

    structureNodeId: nodeId,

    propertyType: "Flat",

    sizeValue: 6,

    sizeUnit: "Marla",

    basePrice: 9_800_000,

    bedrooms: 2,
  })

  assert.equal(flat.status, 200, JSON.stringify(flat.body))

  const listed = await call(cookies, "GET", `/api/projects/${projectId}/units`)

  assert.equal(listed.status, 200, JSON.stringify(listed.body))

  const groups = rows(listed.body.categories, "unit list categories")

  assertExactKeys(
    "category group",

    record(groups[0], "a group"),

    CATEGORY_GROUP_KEYS,
  )

  // Largest first, because the card worth the space at the top of the panel is the one with
  // the most stock behind it — and the cards describe this project's table, not the tenant.
  assert.deepEqual(
    groups.map((each: Json) => each.key),
    ["shop", "flat"],
  )

  const shopGroup = record(groups[0], "the shop group")

  assert.equal(shopGroup.label, "Shop")

  assert.equal(shopGroup.usageLabel, "Commercial")

  assert.equal(shopGroup.total, 2)

  assert.equal(shopGroup.available, 2)

  assert.equal(shopGroup.value, 30_500_000)

  const subtypes = rows(shopGroup.subtypes, "shop subtypes")

  assertExactKeys(
    "category subtype group",

    record(subtypes[0], "a subtype group"),

    CATEGORY_SUBTYPE_KEYS,
  )

  // One unit each, so the label decides the order: the variant line on a card has to be
  // stable between saves rather than follow whichever row the query happened to read first.
  assert.deepEqual(
    subtypes.map((each: Json) => [each.key, each.count]),

    [
      ["corner_shop", 1],

      ["mezzanine", 1],
    ],
  )

  assert.deepEqual(
    rows(record(groups[1], "the flat group").subtypes, "flat subtypes"),
    [],
  )

  const summary = await call(
    cookies,

    "GET",

    `/api/inventory-categories?project=${projectId}`,
  )

  assert.equal(summary.status, 200, JSON.stringify(summary.body))

  assertExactKeys(
    "category summary",

    record(summary.body, "summary"),

    CATEGORY_SUMMARY_KEYS,
  )

  assert.equal(summary.body.total, 3)

  assert.deepEqual(
    rows(summary.body.groups, "summary groups").map((each: Json) => each.label),

    ["Shop", "Flat"],
  )

  // The dashboard breakdown asks for the same variants per card, so a tenant-wide read of
  // one project must not caption its cards with counts taken from the whole workspace.
  assert.deepEqual(
    rows(summary.body.subtypes, "summary subtypes").map((each: Json) => [
      each.key,
      each.count,
    ]),

    [
      ["corner_shop", 1],

      ["mezzanine", 1],
    ],
  )

  const wide = await call(cookies, "GET", "/api/inventory-categories")

  assert.equal(wide.status, 200, JSON.stringify(wide.body))

  assert.ok(wide.body.total >= 3)
})

// --- The status vocabulary, and the trail a status leaves --------------------

const UNIT_STATUS_KEYS = keysOf<UnitStatusView>({
  id: true,

  key: true,

  label: true,

  tone: true,

  isBuiltin: true,

  isArchived: true,

  sortOrder: true,
})

const UNIT_STATUS_LIST_KEYS = keysOf<UnitStatusListResponse>({
  statuses: true,

  archived: true,

  archivedCount: true,

  unitCounts: true,

  canManage: true,
})

const STATUS_HISTORY_ENTRY_KEYS = keysOf<StatusHistoryEntry>({
  id: true,

  unitId: true,

  fromStatus: true,

  fromStatusLabel: true,

  fromStatusTone: true,

  toStatus: true,

  toStatusLabel: true,

  toStatusTone: true,

  changedByUserId: true,

  changedByName: true,

  source: true,

  note: true,

  changedAt: true,
})

const STATUS_HISTORY_KEYS = keysOf<StatusHistoryResponse>({
  entries: true,

  truncated: true,
})

// Spelled out rather than spread from the entry above: `keysOf` asks for exactly the

// keys of the type it is given, so a spread would widen it back to a bag of strings and

// stop the check that the project feed really does add the unit code.

const PROJECT_STATUS_CHANGE_KEYS = keysOf<ProjectStatusChangeEntry>({
  id: true,

  unitId: true,

  fromStatus: true,

  fromStatusLabel: true,

  fromStatusTone: true,

  toStatus: true,

  toStatusLabel: true,

  toStatusTone: true,

  changedByUserId: true,

  changedByName: true,

  source: true,

  note: true,

  changedAt: true,

  unitCode: true,
})

const PROJECT_STATUS_CHANGES_KEYS = keysOf<ProjectStatusChangesResponse>({
  entries: true,

  truncated: true,
})

/** A status created for one of these tests, with a name no other test uses. */

async function addStatus(
  cookies: CookieJar,

  label: string,

  tone = "info",
): Promise<CallResult> {
  return call(cookies, "POST", "/api/unit-statuses", { label, tone })
}

async function readStatuses(cookies: CookieJar): Promise<CallResult> {
  return call(cookies, "GET", "/api/unit-statuses")
}

test("a workspace opens with the built-in statuses, and reading them is not managing them", async () => {
  const { cookies: admin } = await signIn("admin@deedorbit.com")

  const listed = await readStatuses(admin)

  assert.equal(listed.status, 200, JSON.stringify(listed.body))

  assertExactKeys("GET unit-statuses", listed.body, UNIT_STATUS_LIST_KEYS)

  // Seeded from the shared table rather than a literal list, so adding a built-in in
  // the product fails this test until it is seeded for every existing workspace too.

  assert.deepEqual(
    listed.body.statuses.map((status: Json) => status.key),

    BUILT_IN_UNIT_STATUSES.map((status) => status.key),
  )

  assert.deepEqual(
    listed.body.statuses.map((status: Json) => status.label),

    BUILT_IN_UNIT_STATUSES.map((status) => status.label),
  )

  for (const status of rows(listed.body.statuses, "statuses")) {
    assert.equal(status.isBuiltin, true, `${status.key} is not marked built-in`)

    assert.equal(status.isArchived, false, `${status.key} is archived`)

    assert.equal(status.unitCounts, undefined)
  }

  assert.equal(listed.body.archivedCount, 0)

  assert.equal(listed.body.archived.length, 0)

  // The counts are tenant-wide rather than per project, and are keyed by the stored key
  // rather than the label, because a status label may be renamed later while the key
  // it is counted under is not.

  assert.equal(typeof listed.body.unitCounts, "object")

  assert.equal(listed.body.canManage, true)

  // A sales consultant may not change the vocabulary, but does have to read it: the
  // status filter and the status column both render from it. A list that refused to
  // read would leave the table showing raw keys to the people who use it most.

  const { cookies: agent } = await signIn("sales.agent@deedorbit.com")

  const agentRead = await readStatuses(agent)

  assert.equal(agentRead.status, 200)

  assert.equal(agentRead.body.canManage, false)

  assert.equal(agentRead.body.statuses.length, listed.body.statuses.length)
})

test("a custom status can be added to a workspace and then used on a unit", async () => {
  const { cookies } = await signIn("admin@deedorbit.com")

  // Projects are opened by the project manager rather than by whoever edits the

  // vocabulary: only that role holds `projects.create`, and the plot is just a place

  // to hang a unit.

  const { cookies: manager } = await signIn("projects@deedorbit.com")

  const created = await addStatus(cookies, "Under offer")

  assert.equal(created.status, 200, JSON.stringify(created.body))

  assertExactKeys("POST unit-statuses", created.body.status, UNIT_STATUS_KEYS)

  // The key is derived from the label and stored, never shown: it is what a unit holds,
  // and deriving it here rather than trusting the client keeps two units from being
  // filed under "Under Offer" and "under offer" as two different statuses.

  assert.equal(created.body.status.key, "under_offer")

  assert.equal(created.body.status.label, "Under offer")

  assert.equal(created.body.status.tone, "info")

  assert.equal(created.body.status.isBuiltin, false)

  // A new status lands after the built-in set rather than among it, because the built-in
  // order is how far a unit travels and an addition should not interrupt that.

  const listed = await readStatuses(cookies)

  const offered = rows(listed.body.statuses, "statuses")

  const last = offered[offered.length - 1]

  assert.ok(last)

  assert.equal(last.id, created.body.status.id)

  assert.ok(
    created.body.status.sortOrder > BUILT_IN_UNIT_STATUSES.at(-1)!.sortOrder,
  )

  // A status is only real once a unit can hold it, so the next step is the one that
  // matters: creating a unit in it, and having the table resolve the label and tone
  // server-side rather than the client guessing from a key.

  const { projectId, nodeId } = await inventoryPlot(
    manager,
    "Custom Status Plot",
  )

  const unit = await addUnit(manager, projectId, {
    ...validUnitBody(nodeId),

    unitCode: "OFF-1",

    status: "under_offer",
  })

  assert.equal(unit.status, 200, JSON.stringify(unit.body))

  assert.equal(unit.body.unit.status, "under_offer")

  assert.equal(unit.body.unit.statusLabel, "Under offer")

  assert.equal(unit.body.unit.statusTone, "info")

  // Counts are keyed by status, so a status this build has never heard of reports its

  // own count rather than disappearing from the totals.

  const inventory = await call(
    manager,

    "GET",

    `/api/projects/${projectId}/units`,
  )

  assert.equal(inventory.body.totals.byStatus.under_offer, 1)

  // A custom status is not an open status until a role with `inventory.change_status`

  // decides it is one: only `available` and `reserved` count towards open value, so an

  // addition cannot quietly inflate the headline figure by making units count twice.

  assert.equal(inventory.body.totals.openValue, 0)

  assert.equal(inventory.body.totals.totalValue, 2_450_000)
})

test("a status name has to be one this workspace does not already use", async () => {
  const { cookies } = await signIn("admin@deedorbit.com")

  // A duplicate is refused by name rather than by silently merging, because two statuses
  // with one label would give an operator no way to tell which is which.

  const dupe = await addStatus(cookies, "Available")

  assert.equal(dupe.status, 400)

  assert.equal(dupe.body.error.code, "bad_request")

  assert.match(dupe.body.error.fields.label, /already exists/)

  // Same name, different case: the comparison is case-insensitive, which is why this
  // is a duplicate rather than a second status that reads identically in the list.

  const shouty = await addStatus(cookies, "UNDER OFFER")

  assert.equal(shouty.status, 400)

  assert.match(shouty.body.error.fields.label, /already exists/)

  // A label made only of punctuation normalises to an empty key, which would be an
  // unusable stored value even though the label itself is long enough to pass the
  // length rule.

  const punctuation = await addStatus(cookies, "///")

  assert.equal(punctuation.status, 400)

  assert.match(punctuation.body.error.fields.label, /letter or digit/)

  const blank = await addStatus(cookies, "   ")

  assert.equal(blank.status, 400)

  assert.ok(blank.body.error.fields.label)

  // The tone is a closed set because it drives a badge colour, and an unknown one would
  // render as a class the stylesheet does not define.

  const badTone = await addStatus(cookies, "Quietly hopeful", "chartreuse")

  assert.equal(badTone.status, 400)

  assert.ok(badTone.body.error.fields.tone)

  const tooLong = await addStatus(
    cookies,
    "V".repeat(UNIT_STATUS_LABEL_MAX + 1),
  )

  assert.equal(tooLong.status, 400)

  assert.ok(tooLong.body.error.fields.label)

  // Nothing above was written, so the vocabulary is exactly the seeded set plus the one
  // status the earlier test added.

  const listed = await readStatuses(cookies)

  assert.equal(
    listed.body.statuses.length,

    BUILT_IN_UNIT_STATUSES.length + 1,
  )
})

test("managing the vocabulary needs Settings, not Inventory", async () => {
  const { cookies } = await signIn("admin@deedorbit.com")

  const { cookies: agent } = await signIn("sales.agent@deedorbit.com")

  const listed = await readStatuses(cookies)

  const custom = rows(listed.body.statuses, "statuses").find(
    (status) => status.key === "under_offer",
  )

  assert.ok(custom)

  // `inventory.view` is not the right to write the vocabulary: the statuses belong to
  // the workspace rather than to any project, so they are workspace configuration and
  // ride on the same grant as the rest of Settings.

  const agentCreate = await addStatus(agent, "Agent idea")

  assert.equal(agentCreate.status, 403)

  assert.equal(agentCreate.body.error.code, "permission_denied")

  const agentRename = await call(
    agent,

    "PATCH",

    `/api/unit-statuses/${custom.id}`,

    { label: "Renamed by an agent" },
  )

  assert.equal(agentRename.status, 403)

  // The built-in statuses are the shared vocabulary every dashboard, report and
  // workflow in the product is written against, so they cannot be renamed, recoloured
  // or retired by one tenant: `under_offer` would stop meaning what it means
  // everywhere else. Retiring them would be worse still, because units already hold them.

  const builtin = BUILT_IN_UNIT_STATUSES[0]

  const relabel = await call(
    cookies,

    "PATCH",

    `/api/unit-statuses/${custom.id}`,

    { isBuiltin: false, label: builtin.label },
  )

  assert.equal(relabel.status, 400)

  assert.match(relabel.body.error.fields.label, /already exists/)

  const builtInRow = get<{ id: string }>(
    `SELECT id FROM inventory_unit_statuses
      WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'deedorbit') AND key = ?`,

    builtin.key,
  )

  assert.ok(builtInRow)

  const attempts: Record<string, unknown>[] = [
    { label: "On hold, officially" },

    { tone: "danger" },

    { isArchived: true },
  ]

  // A conflict is a 422 in this codebase rather than a 409: the request was understood,

  // the row is right there, and the state of the resource is what makes it refused.

  for (const attempt of attempts) {
    const refused: CallResult = await call(
      cookies,

      "PATCH",

      `/api/unit-statuses/${builtInRow.id}`,

      attempt,
    )

    assert.equal(refused.status, 422, JSON.stringify(refused.body))

    assert.equal(refused.body.error.code, "conflict")
  }

  // The refusals left it exactly as seeded.

  const after = await readStatuses(cookies)

  const untouched = rows(after.body.statuses, "statuses").find(
    (status) => status.id === builtInRow.id,
  )

  assert.ok(untouched)

  assert.equal(untouched.label, builtin.label)

  assert.equal(untouched.isArchived, false)
})

test("a custom status can be recoloured and retired, and the units holding it still read", async () => {
  const { cookies } = await signIn("admin@deedorbit.com")

  const { cookies: manager } = await signIn("projects@deedorbit.com")

  const created = await addStatus(cookies, "Held for exchange", "neutral")

  assert.equal(created.status, 200, JSON.stringify(created.body))

  const statusId = created.body.status.id

  const { projectId, nodeId } = await inventoryPlot(
    manager,
    "Retire Status Plot",
  )

  const unit = await addUnit(manager, projectId, {
    ...validUnitBody(nodeId),

    unitCode: "EXC-1",

    status: "held_for_exchange",
  })

  assert.equal(unit.status, 200, JSON.stringify(unit.body))

  const unitId = unit.body.unit.id

  // Recolouring is not renaming: the label and the key both stay, so no unit's stored
  // key is disturbed by what is purely a presentation change.

  const recoloured = await call(
    cookies,

    "PATCH",

    `/api/unit-statuses/${statusId}`,

    { tone: "warning" },
  )

  assert.equal(recoloured.status, 200, JSON.stringify(recoloured.body))

  assert.equal(recoloured.body.status.tone, "warning")

  assert.equal(recoloured.body.status.label, "Held for exchange")

  assert.equal(recoloured.body.status.key, "held_for_exchange")

  // Retiring a status that units still hold is allowed. Refusing would force an admin to
  // walk every attached unit out of it first, which is friction with no benefit: the
  // flag stops new assignments, and the units that hold it keep reading correctly.

  const retired = await call(
    cookies,

    "PATCH",

    `/api/unit-statuses/${statusId}`,

    { isArchived: true },
  )

  assert.equal(retired.status, 200, JSON.stringify(retired.body))

  assert.equal(retired.body.status.isArchived, true)

  const listed = await readStatuses(cookies)

  // It is gone from the offer list, and reported as retired rather than silently
  // dropped, so an admin can tell the difference between "never existed" and "retired".

  assert.equal(
    listed.body.statuses.some((status: Json) => status.id === statusId),

    false,
  )

  assert.equal(listed.body.archivedCount, 1)

  // The retired row itself, reported apart from the ones that may still be chosen:

  // a client that can restore needs the whole status, not just how many there are.

  assert.equal(listed.body.archived.length, 1)

  assert.equal(listed.body.archived[0].id, statusId)

  assert.equal(listed.body.archived[0].isArchived, true)

  // The count that tells the admin which units are affected, which is why the list route
  // counts archived statuses too.

  assert.equal(listed.body.unitCounts.held_for_exchange, 1)

  // The unit holding it still reads. `describeStatus` resolves archived rows as well as
  // live ones precisely so that retiring a status cannot leave a table full of raw keys.

  const inventory = await call(
    cookies,
    "GET",
    `/api/projects/${projectId}/units`,
  )

  const holding = rows(inventory.body.units, "units").find(
    (unitRow: Json) => unitRow.id === unitId,
  )

  assert.ok(holding)

  assert.equal(holding.statusLabel, "Held for exchange")

  assert.equal(holding.statusTone, "warning")

  // And it can no longer be assigned to anything, which is the point of retiring it.

  // The offer list is what refuses it, and the refusal is a bad choice of status rather

  // than a right, so the project manager is used here to keep the two apart.

  const rejected = await addUnit(manager, projectId, {
    ...validUnitBody(nodeId),

    unitCode: "EXC-2",

    status: "held_for_exchange",
  })

  assert.equal(rejected.status, 400)

  // The message lists the statuses this workspace may still use — by label, since that

  // is what the picker offers — and the retired one is not among them.

  assert.match(rejected.body.error.fields.status, /Choose one of: /)

  assert.equal(
    /Held for exchange/.test(rejected.body.error.fields.status),
    false,
  )
})

test("renaming a status moves its key only while no unit holds it", async () => {
  const { cookies } = await signIn("admin@deedorbit.com")

  const { cookies: manager } = await signIn("projects@deedorbit.com")

  // One status that a unit holds, and one that nothing holds yet.

  const held = await addStatus(cookies, "Reserved for parking")

  assert.equal(held.status, 200)

  assert.equal(held.body.status.key, "reserved_for_parking")

  const { projectId, nodeId } = await inventoryPlot(
    manager,
    "Rename Status Plot",
  )

  const unit = await addUnit(manager, projectId, {
    ...validUnitBody(nodeId),

    unitCode: "PRK-1",

    status: "reserved_for_parking",
  })

  assert.equal(unit.status, 200)

  const heldRenamed = await call(
    cookies,

    "PATCH",

    `/api/unit-statuses/${held.body.status.id}`,

    { label: "Parking reserved" },
  )

  assert.equal(heldRenamed.status, 200, JSON.stringify(heldRenamed.body))

  // The label moves and the key does not, because a unit stores the key: moving it would
  // leave every attached unit pointing at a key this workspace no longer has. The rename
  // is still visible to the reader, which is the only part of a status anybody sees.

  assert.equal(heldRenamed.body.status.label, "Parking reserved")

  assert.equal(heldRenamed.body.status.key, "reserved_for_parking")

  const inventory = await call(
    cookies,
    "GET",
    `/api/projects/${projectId}/units`,
  )

  const row = rows(inventory.body.units, "units")[0]

  assert.equal(row.status, "reserved_for_parking")

  assert.equal(row.statusLabel, "Parking reserved")

  // An unused status has no such constraint, so its key follows its label and the stored
  // value keeps matching what it is called.

  const unused = await addStatus(cookies, "Awaiting paperwork")

  assert.equal(unused.status, 200)

  assert.equal(unused.body.status.key, "awaiting_paperwork")

  const unusedRenamed = await call(
    cookies,

    "PATCH",

    `/api/unit-statuses/${unused.body.status.id}`,

    { label: "Paperwork pending" },
  )

  assert.equal(unusedRenamed.status, 200, JSON.stringify(unusedRenamed.body))

  assert.equal(unusedRenamed.body.status.label, "Paperwork pending")

  assert.equal(unusedRenamed.body.status.key, "paperwork_pending")

  // Renaming onto a name already in use is refused rather than merging the two.

  const collision = await call(
    cookies,

    "PATCH",

    `/api/unit-statuses/${unused.body.status.id}`,

    { label: "Under offer" },
  )

  assert.equal(collision.status, 400)

  assert.match(collision.body.error.fields.label, /already exists/)
})

test("a status change is recorded with who and why, and re-saving it is not a change", async () => {
  const { cookies: agent } = await signIn("sales.manager@deedorbit.com")

  const { cookies } = await signIn("projects@deedorbit.com")

  const { projectId, nodeId } = await inventoryPlot(cookies, "History Plot")

  const unit = await addUnit(cookies, projectId, {
    ...validUnitBody(nodeId),

    unitCode: "HIS-1",
  })

  assert.equal(unit.status, 200, JSON.stringify(unit.body))

  const unitId = unit.body.unit.id

  const reserved = await call(
    cookies,

    "PATCH",

    `/api/projects/${projectId}/units/${unitId}`,

    { status: "reserved", statusNote: "Buyer signed the reservation form" },
  )

  assert.equal(reserved.status, 200, JSON.stringify(reserved.body))

  // Changing a status and then changing it straight back is two real events, so the
  // trail keeps both. What is not an event is re-saving the same status.

  const reverted = await call(
    cookies,

    "PATCH",

    `/api/projects/${projectId}/units/${unitId}`,

    { status: "available" },
  )

  assert.equal(reverted.status, 200)

  const sameAgain = await call(
    cookies,

    "PATCH",

    `/api/projects/${projectId}/units/${unitId}`,

    { status: "available", statusNote: "Nothing actually changed here" },
  )

  assert.equal(sameAgain.status, 200, JSON.stringify(sameAgain.body))

  // A note on its own is not a transition, so it is not recorded either. Recording it
  // would fill the trail with entries whose two ends are identical.

  const noteOnly = await call(
    cookies,

    "PATCH",

    `/api/projects/${projectId}/units/${unitId}`,

    { basePrice: 2_500_000, statusNote: "Repositioned after the survey" },
  )

  assert.equal(noteOnly.status, 200)

  const history = await call(
    cookies,

    "GET",

    `/api/projects/${projectId}/units/${unitId}/status-history`,
  )

  assert.equal(history.status, 200, JSON.stringify(history.body))

  assertExactKeys("GET unit status-history", history.body, STATUS_HISTORY_KEYS)

  const entries = rows(history.body.entries, "entries")

  // Newest first, because the question being asked of a dialog is "what happened to this
  // unit lately?" — and it begins with the unit being created, so a unit that opened as
  // reserved and closed as sold has a trail rather than one entry.

  assert.equal(entries.length, 3)

  assert.equal(history.body.truncated, false)

  assertExactKeys("status history entry", entries[0], STATUS_HISTORY_ENTRY_KEYS)

  assert.deepEqual(
    entries.map((entry: Json) => `${entry.fromStatus} -> ${entry.toStatus}`),

    ["reserved -> available", "available -> reserved", "null -> available"],
  )

  const transition = entries[1]

  // Both ends are described, not just the destination: a trail of bare destinations
  // cannot tell a promotion from a demotion.

  assert.equal(transition.fromStatus, "available")

  assert.equal(transition.fromStatusLabel, "Available")

  assert.equal(transition.fromStatusTone, "success")

  assert.equal(transition.toStatus, "reserved")

  assert.equal(transition.toStatusLabel, "Reserved")

  assert.equal(transition.source, "manual")

  assert.equal(transition.note, "Buyer signed the reservation form")

  // The name is stored beside the id, so the trail does not go blank when somebody
  // leaves the workspace — which is the whole reason the column exists.

  assert.equal(transition.changedByName, "Bilal Chaudhry")

  assert.ok(transition.changedByUserId)

  assert.ok(transition.changedAt)

  // The entry that records the creation has nothing before it, and carries no note.

  assert.equal(entries[2].fromStatus, null)

  assert.equal(entries[2].fromStatusLabel, null)

  assert.equal(entries[2].toStatus, "available")

  assert.equal(entries[2].note, null)

  // A status note longer than the column allows is refused rather than truncated, since
  // a silently shortened reason is worse than no reason.

  const overlong = await call(
    cookies,

    "PATCH",

    `/api/projects/${projectId}/units/${unitId}`,

    { status: "sold", statusNote: "n".repeat(UNIT_STATUS_NOTE_MAX + 1) },
  )

  assert.equal(overlong.status, 400)

  assert.ok(overlong.body.error.fields.statusNote)

  // The project-wide feed is the same trail with the unit named, for a manager who wants
  // what changed across the project rather than one unit at a time.

  const feed = await call(
    cookies,

    "GET",

    `/api/projects/${projectId}/units/status-changes`,
  )

  assert.equal(feed.status, 200, JSON.stringify(feed.body))

  assertExactKeys(
    "GET unit status-changes",
    feed.body,
    PROJECT_STATUS_CHANGES_KEYS,
  )

  assert.equal(feed.body.entries.length, 3)

  assertExactKeys(
    "project status change entry",

    feed.body.entries[0],

    PROJECT_STATUS_CHANGE_KEYS,
  )

  for (const entry of rows(feed.body.entries, "entries")) {
    assert.equal(entry.unitCode, "HIS-1")
  }

  // The refused note left the unit where it was.

  const after = await call(cookies, "GET", `/api/projects/${projectId}/units`)

  assert.equal(rows(after.body.units, "units")[0].status, "available")

  // The trail is not readable from another workspace. The rival's owner holds every
  // permission, so tenant scope is the only barrier and it has to hide the unit rather
  // than merely forbid the read.

  const signup = await call(jar(), "POST", "/api/auth/signup", {
    email: "history.rival@example.com",

    fullName: "History Rival",

    workspaceName: "Rival History",

    password: "Rival-Trail-2026",
  })

  assert.equal(signup.status, 200)

  const { cookies: rival } = await signIn(
    "history.rival@example.com",

    "Rival-Trail-2026",
  )

  const rivalHistory = await call(
    rival,

    "GET",

    `/api/projects/${projectId}/units/${unitId}/status-history`,
  )

  assert.equal(rivalHistory.status, 404)

  assert.equal(rivalHistory.body.error.code, "not_found")

  const rivalFeed = await call(
    rival,

    "GET",

    `/api/projects/${projectId}/units/status-changes`,
  )

  assert.equal(rivalFeed.status, 404)

  // And a role that may read inventory may read the trail: it rides on `inventory.view`
  // rather than on a separate grant, because it is inventory.

  const agentHistory = await call(
    agent,

    "GET",

    `/api/projects/${projectId}/units/${unitId}/status-history`,
  )

  assert.equal(agentHistory.status, 200)

  assert.equal(agentHistory.body.entries.length, 3)
})

test("adding a unit is not deciding its status, so those are separate rights", async () => {
  // The procurement officer holds `inventory.edit` — it prepares stock — but not
  // `inventory.change_status`, which is the right that decides whether a unit is on the
  // market.

  const { cookies } = await signIn("procurement@deedorbit.com")

  // The plot belongs to the project manager, because only that role opens projects.

  // Everything below happens on that project but is done by the procurement officer,

  // which is the point: the rights are the procurement officer's, not the project's.

  const { cookies: manager } = await signIn("projects@deedorbit.com")

  const { projectId, nodeId } = await inventoryPlot(manager, "Procurement Plot")

  // Creating a unit as Available is preparation, so it is allowed.

  const created = await addUnit(cookies, projectId, validUnitBody(nodeId))

  assert.equal(created.status, 200, JSON.stringify(created.body))

  assert.equal(created.body.unit.status, "available")

  // Editing the unit is allowed too.

  const repriced = await call(
    cookies,

    "PATCH",

    `/api/projects/${projectId}/units/${created.body.unit.id}`,

    { basePrice: 2_600_000 },
  )

  assert.equal(repriced.status, 200, JSON.stringify(repriced.body))

  // Moving it is not, and the refusal is about the status rather than the unit: the
  // same role may do everything else to this row.

  const moved = await call(
    cookies,

    "PATCH",

    `/api/projects/${projectId}/units/${created.body.unit.id}`,

    { status: "sold" },
  )

  assert.equal(moved.status, 403)

  assert.equal(moved.body.error.code, "permission_denied")

  // Creating a unit as Sold is the same decision by another route, and is refused for
  // the same reason: otherwise the grant would be one request wide.

  const preSold = await addUnit(cookies, projectId, {
    ...validUnitBody(nodeId),

    unitCode: "PRC-2",

    status: "sold",
  })

  assert.equal(preSold.status, 403)

  assert.equal(preSold.body.error.code, "permission_denied")

  // Neither refusal moved the unit or wrote a trail entry: the unit is still Available,
  // and its history is still the single creation entry.

  const listed = await call(cookies, "GET", `/api/projects/${projectId}/units`)

  const units = rows(listed.body.units, "units")

  assert.equal(units.length, 1)

  assert.equal(units[0].status, "available")

  assert.equal(units[0].basePrice, 2_600_000)

  assert.equal(listed.body.canChangeStatus, false)

  const history = await call(
    cookies,

    "GET",

    `/api/projects/${projectId}/units/${created.body.unit.id}/status-history`,
  )

  assert.equal(history.body.entries.length, 1)

  assert.equal(history.body.entries[0].toStatus, "available")

  // A role that holds the right sees it on the same response, so the client does not

  // have to guess whether to offer the status control. The manager is the one who

  // opened this project, so the same session is reused rather than signed in twice.

  const managerRead = await call(
    manager,

    "GET",

    `/api/projects/${projectId}/units`,
  )

  assert.equal(managerRead.body.canChangeStatus, true)
})

test("the status migration left the vocabulary, the trail and the grant in place", async () => {
  getDb()

  // The trail is a table of its own rather than a column, so these are the columns that
  // have to exist for a transition to be readable back.

  const historyColumns = new Set(
    all<{ name: string }>(
      "SELECT name FROM pragma_table_info('inventory_unit_status_history')",
    ).map((row) => row.name),
  )

  for (const column of [
    "id",

    "tenant_id",

    "project_id",

    "unit_id",

    "from_status",

    "to_status",

    "changed_by_user_id",

    "changed_by_name",

    "source",

    "note",

    "changed_at",
  ]) {
    assert.ok(historyColumns.has(column), `missing column ${column}`)
  }

  // A trail is only as private as its index, so the unit-scoped read is what the

  // endpoint's own query relies on. The pragma is used rather than `sqlite_master`

  // because it reports whether an index is unique, which is the property that has to

  // hold.

  const historyIndexes = all<{
    name: string

    unique: number
  }>("SELECT * FROM pragma_index_list('inventory_unit_status_history')")

  assert.ok(
    historyIndexes.some(
      (index) => index.name === "idx_unit_status_history_unit",
    ),
  )

  // Two statuses in one workspace may not share a key, and the same key may exist in two

  // workspaces — the unique index is per tenant.

  const statusIndexes = all<{
    name: string

    unique: number
  }>("SELECT * FROM pragma_index_list('inventory_unit_statuses')")

  const tenantKey = statusIndexes.find(
    (index) => index.name === "idx_unit_statuses_tenant_key",
  )

  assert.ok(tenantKey)

  assert.equal(tenantKey.unique, 1)

  // Every workspace has the built-in set, including one created by signup and one
  // created by the seed. The migration's backfill and the seeder cover different cases
  // and neither alone would: on a fresh install the migration runs before any tenant
  // exists.

  const tenants = all<{
    id: string

    slug: string
  }>("SELECT id, slug FROM tenants")

  assert.ok(tenants.length >= 2)

  for (const tenant of tenants) {
    const seeded = all<{ key: string }>(
      `SELECT key FROM inventory_unit_statuses
        WHERE tenant_id = ? AND is_builtin = 1
        ORDER BY sort_order`,

      tenant.id,
    ).map((row) => row.key)

    assert.deepEqual(
      seeded,
      BUILT_IN_UNIT_STATUSES.map((status) => status.key),
    )
  }

  // A unit created outside the API still lands on a real status rather than an empty
  // string, so a hand-written row cannot break the totals.

  const defaults = new Set(
    all<{ dflt_value: string }>(
      "SELECT dflt_value FROM pragma_table_info('inventory_units') WHERE name = 'status'",
    ).map((row) => row.dflt_value),
  )

  assert.ok([...defaults].some((value) => value.includes("available")))

  // The `change_status` grant exists as data rather than in code, and the permissions

  // table's own check constraint is what had to be widened for the migration to write

  // it: a constraint left behind would have refused the seed, so the presence of this

  // row is itself the proof that the constraint accepts the new action.

  const grant = get<{ count: number }>(
    `SELECT count(*) AS count FROM permissions
      WHERE permission_id = 'inventory.change_status'`,
  )

  assert.equal(grant?.count, 1)

  // And it lands on the roles the tests above sign in as, so the split they assert is

  // the one this seed actually configured rather than one the fixture happens to allow.

  const holders = all<{ role_id: string }>(
    `SELECT role_id FROM role_permission_defaults
      WHERE permission_id = 'inventory.change_status'
      ORDER BY role_id`,
  ).map((row) => row.role_id)

  assert.equal(holders.includes("tenant_admin"), true)

  assert.equal(holders.includes("project_manager"), true)

  // The role that prepares stock deliberately does not hold it.

  assert.equal(holders.includes("procurement_officer"), false)

  // The two platform-wide roles hold every permission by design, which is what makes

  // them useful for signing in as — they are the ones this suite falls back on when a

  // test needs to prove something about scope rather than about rights.

  assert.equal(holders.includes("tenant_owner"), true)

  assert.equal(holders.includes("platform_super_admin"), true)

  // The seed must not be able to grant it to a role that did not ask for it either: an

  // override is what would change that, and there is none for this permission.

  const overrides = get<{ count: number }>(
    `SELECT count(*) AS count FROM role_permission_overrides
      WHERE permission_id = 'inventory.change_status'`,
  )

  assert.equal(overrides?.count, 0)
})

test("unit quotations can be generated and reviewed as history", async () => {
  const { cookies: sales } = await signIn("sales.agent@deedorbit.com")

  const { cookies } = await signIn("projects@deedorbit.com")

  const { projectId, nodeId } = await inventoryPlot(cookies, "Quotation Plot")

  const unit = await addUnit(cookies, projectId, {
    ...validUnitBody(nodeId),

    unitCode: "Q-1",

    basePrice: 880_000,
  })

  assert.equal(unit.status, 200, JSON.stringify(unit.body))

  const lead = await call(sales, "POST", "/api/leads", {
    name: "Quote Lead",
    phone: "+971 50 999 1111",
    source: "Website",
  })

  assert.equal(lead.status, 200, JSON.stringify(lead.body))

  const created = await call(
    cookies,

    "POST",

    `/api/projects/${projectId}/units/${unit.body.unit.id}/quotations`,

    {
      leadId: lead.body.lead.id,
      discountType: "percent",
      discountValue: 5,
      extraCharges: 15_000,
      downPaymentPercent: 30,
      installmentCount: 12,
      notes: "Includes landscaping surcharge",
    },
  )

  assert.equal(created.status, 200, JSON.stringify(created.body))

  assert.ok(created.body.quote.quoteNumber)

  assert.equal(created.body.quote.basePrice, 880_000)

  assert.equal(created.body.quote.discountAmount, 44_000)

  assert.equal(created.body.quote.total, 851_000)

  const listed = await call(
    cookies,

    "GET",

    `/api/projects/${projectId}/units/${unit.body.unit.id}/quotations`,
  )

  assert.equal(listed.status, 200, JSON.stringify(listed.body))

  assert.equal(listed.body.quotations.length, 1)

  assert.equal(listed.body.quotations[0].leadName, "Quote Lead")

  assert.equal(listed.body.quotations[0].total, 851_000)
})

test("leads can be captured, listed, and updated with agent ownership", async () => {
  const { cookies } = await signIn("sales.agent@deedorbit.com")

  const listedBefore = await call(cookies, "GET", "/api/leads")

  assert.equal(listedBefore.status, 200, JSON.stringify(listedBefore.body))

  const agent = listedBefore.body.agents[0]

  assert.ok(agent)

  const created = await call(cookies, "POST", "/api/leads", {
    name: "Amina Hassan",
    phone: "+971 50 123 4567",
    email: "amina@example.com",
    source: "Referral",
    campaign: "Autumn launch",
    projectInterest: "Harbour Point Residences",
    budgetMin: 1_000_000,
    budgetMax: 2_000_000,
    assignedAgentId: agent.id,
  })

  assert.equal(created.status, 200, JSON.stringify(created.body))
  assert.equal(created.body.lead.name, "Amina Hassan")
  assert.equal(created.body.lead.status, "new")
  assert.equal(created.body.lead.assignedAgentName, agent.name)

  const updated = await call(
    cookies,
    "PATCH",
    `/api/leads/${created.body.lead.id}`,
    { status: "qualified" },
  )

  assert.equal(updated.status, 200, JSON.stringify(updated.body))
  assert.equal(updated.body.lead.status, "qualified")
  assert.equal(updated.body.lead.budgetMin, 1_000_000)
  assert.equal(updated.body.lead.projectInterest, "Harbour Point Residences")

  const listedAfter = await call(cookies, "GET", "/api/leads")

  assert.ok(
    listedAfter.body.leads.some(
      (lead: Json) => lead.id === created.body.lead.id,
    ),
  )
  assert.equal(listedAfter.body.totals.qualified, 1)
})

test("lead budgets are validated before anything is stored", async () => {
  const { cookies } = await signIn("sales.agent@deedorbit.com")

  const result = await call(cookies, "POST", "/api/leads", {
    name: "Invalid Budget",
    phone: "+1 555 123 4567",
    source: "Website",
    budgetMin: 800_000,
    budgetMax: 500_000,
  })

  assert.equal(result.status, 400)
  assert.ok(result.body.error.fields.budgetMax)
})

test("lead records are tenant-scoped and import remains an explicit placeholder", async () => {
  const { cookies } = await signIn("sales.agent@deedorbit.com")

  const created = await call(cookies, "POST", "/api/leads", {
    name: "Private Lead",
    phone: "+1 555 123 4567",
    source: "Walk-in",
  })

  assert.equal(created.status, 200)

  const signup = await call(jar(), "POST", "/api/auth/signup", {
    email: "leads.scope@example.com",
    fullName: "Lead Scope Owner",
    workspaceName: "Lead Scope Holdings",
    password: "Lead-Scope-2026",
  })

  assert.equal(signup.status, 200)

  const { cookies: otherCookies } = await signIn(
    "leads.scope@example.com",
    "Lead-Scope-2026",
  )

  const listed = await call(otherCookies, "GET", "/api/leads")
  assert.equal(listed.status, 200)
  assert.equal(listed.body.leads.length, 0)

  const crossTenant = await call(
    otherCookies,
    "PATCH",
    `/api/leads/${created.body.lead.id}`,
    { name: "Taken" },
  )
  assert.equal(crossTenant.status, 404)

  const placeholder = await call(otherCookies, "POST", "/api/leads/import", {})
  assert.equal(placeholder.status, 501)
  assert.equal(placeholder.body.error.code, "not_implemented")
})

test("pipeline stages, follow-ups, activity, lost reasons, and customer conversion work together", async () => {
  const { cookies } = await signIn("sales.manager@deedorbit.com")

  const initial = await call(cookies, "GET", "/api/leads")
  assert.deepEqual(
    initial.body.stages.map((stage: Json) => stage.label),
    [
      "New",
      "Contacted",
      "Qualified",
      "Site Visit",
      "Negotiation",
      "Won",
      "Lost",
    ],
  )

  const addedStage = await call(cookies, "POST", "/api/leads/stages", {
    label: "Nurture",
  })
  assert.equal(addedStage.status, 200, JSON.stringify(addedStage.body))
  const customStage = addedStage.body.stages.find(
    (stage: Json) => stage.key === "custom_nurture",
  )
  assert.ok(customStage)

  const renamedStage = await call(
    cookies,
    "PATCH",
    `/api/leads/stages/${customStage.id}`,
    { label: "Long-term nurture", sortOrder: 7 },
  )
  assert.equal(renamedStage.status, 200, JSON.stringify(renamedStage.body))
  assert.equal(
    renamedStage.body.stages.find((stage: Json) => stage.id === customStage.id)
      .label,
    "Long-term nurture",
  )

  const created = await call(cookies, "POST", "/api/leads", {
    name: "Pipeline Test Lead",
    phone: "+1 555 777 8888",
    email: "pipeline@example.com",
    source: "Website",
    followUpDate: "2026-10-12",
  })
  assert.equal(created.status, 200, JSON.stringify(created.body))
  const leadId = created.body.lead.id
  assert.equal(created.body.lead.followUpDate, "2026-10-12")

  await call(cookies, "POST", `/api/leads/${leadId}/activities`, {
    note: "Prefers a two-bedroom unit near the park.",
  })

  const moved = await call(cookies, "PATCH", `/api/leads/${leadId}`, {
    status: "site_visit",
  })
  assert.equal(moved.status, 200, JSON.stringify(moved.body))
  assert.equal(moved.body.lead.status, "site_visit")

  const lostWithoutReason = await call(
    cookies,
    "PATCH",
    `/api/leads/${leadId}`,
    { status: "lost" },
  )
  assert.equal(lostWithoutReason.status, 400)
  assert.ok(lostWithoutReason.body.error.fields.lostReason)

  const lost = await call(cookies, "PATCH", `/api/leads/${leadId}`, {
    status: "lost",
    lostReason: "Buyer postponed the purchase.",
  })
  assert.equal(lost.status, 200, JSON.stringify(lost.body))
  assert.equal(lost.body.lead.lostReason, "Buyer postponed the purchase.")

  const won = await call(cookies, "PATCH", `/api/leads/${leadId}`, {
    status: "won",
  })
  assert.equal(won.status, 200, JSON.stringify(won.body))
  assert.equal(won.body.lead.lostReason, null)

  const detail = await call(cookies, "GET", `/api/leads/${leadId}`)
  assert.equal(detail.status, 200)
  assert.ok(
    detail.body.activities.some((entry: Json) =>
      entry.body.includes("Prefers a two-bedroom"),
    ),
  )
  assert.ok(
    detail.body.activities.some(
      (entry: Json) => entry.toStage === "site_visit",
    ),
  )

  const converted = await call(cookies, "POST", `/api/leads/${leadId}/convert`)
  assert.equal(converted.status, 200, JSON.stringify(converted.body))
  assert.equal(converted.body.customer.sourceLeadId, leadId)

  const customers = await call(cookies, "GET", "/api/customers")
  assert.equal(customers.body.canCreate, true)
  assert.equal(customers.body.canEdit, true)
  assert.ok(
    customers.body.customers.some(
      (customer: Json) => customer.id === converted.body.customer.id,
    ),
  )

  const manualCustomer = await call(cookies, "POST", "/api/customers", {
    fullName: "Mariam Saleh",
    phone: "+971 55 765 4321",
    email: "Mariam@example.com",
    addressLine1: "12 Marina Walk",
    city: "Dubai",
    country: "United Arab Emirates",
    idDocumentType: "Passport",
    idDocumentNumber: "P1234567",
    idIssuingAuthority: "UAE",
    idIssueDate: "2024-02-01",
    idExpiryDate: "2030-02-01",
    nomineeName: "Omar Saleh",
    nomineeRelationship: "Spouse",
    nomineePhone: "+971 55 111 2233",
    nextOfKinName: "Huda Saleh",
    nextOfKinRelationship: "Sibling",
    nextOfKinEmail: "huda@example.com",
  })
  assert.equal(manualCustomer.status, 200, JSON.stringify(manualCustomer.body))
  const manualCustomerId = manualCustomer.body.customer.id
  assert.equal(manualCustomer.body.customer.email, "mariam@example.com")
  assert.equal(manualCustomer.body.customer.sourceLeadId, null)

  const manualDetail = await call(
    cookies,
    "GET",
    `/api/customers/${manualCustomerId}`,
  )
  assert.equal(manualDetail.status, 200)
  assert.equal(manualDetail.body.customer.idDocumentNumber, "P1234567")
  assert.equal(manualDetail.body.customer.nomineeName, "Omar Saleh")

  const manualUpdate = await call(
    cookies,
    "PATCH",
    `/api/customers/${manualCustomerId}`,
    {
      city: "Abu Dhabi",
    },
  )
  assert.equal(manualUpdate.status, 200, JSON.stringify(manualUpdate.body))
  assert.equal(manualUpdate.body.customer.city, "Abu Dhabi")
  assert.equal(manualUpdate.body.customer.addressLine1, "12 Marina Walk")
  assert.equal(manualUpdate.body.customer.idDocumentNumber, "P1234567")

  const invalidIdDates = await call(
    cookies,
    "PATCH",
    `/api/customers/${manualCustomerId}`,
    {
      idIssueDate: "2025-01-01",
      idExpiryDate: "2024-01-01",
    },
  )
  assert.equal(invalidIdDates.status, 400)
  assert.ok(invalidIdDates.body.error.fields.idExpiryDate)

  const signup = await call(jar(), "POST", "/api/auth/signup", {
    email: "customer.profile.scope@example.com",
    fullName: "Customer Profile Scope Owner",
    workspaceName: "Customer Profile Scope Holdings",
    password: "Customer-Profile-Scope-2026",
  })
  assert.equal(signup.status, 200)
  const { cookies: otherCookies } = await signIn(
    "customer.profile.scope@example.com",
    "Customer-Profile-Scope-2026",
  )
  const crossTenant = await call(
    otherCookies,
    "GET",
    `/api/customers/${manualCustomerId}`,
  )
  assert.equal(crossTenant.status, 404)

  const duplicateConversion = await call(
    cookies,
    "POST",
    `/api/leads/${leadId}/convert`,
  )
  assert.equal(duplicateConversion.status, 400)

  const performanceBefore = await call(
    cookies,
    "GET",
    "/api/sales-agents?month=2026-10",
  )
  assert.equal(
    performanceBefore.status,
    200,
    JSON.stringify(performanceBefore.body),
  )
  const salesAgent = performanceBefore.body.agents.find(
    (agent: Json) => agent.email === "sales.agent@deedorbit.com",
  )
  assert.ok(salesAgent)

  const manager = performanceBefore.body.managers.find(
    (entry: Json) => entry.role === "Sales Manager",
  )
  assert.ok(manager)

  const teamCreated = await call(cookies, "POST", "/api/sales-agents/teams", {
    name: "Harbour Sales",
    managerUserId: manager.id,
  })
  assert.equal(teamCreated.status, 200, JSON.stringify(teamCreated.body))
  const team = teamCreated.body.teams.find(
    (entry: Json) => entry.name === "Harbour Sales",
  )
  assert.ok(team)

  const assignment = await call(
    cookies,
    "PUT",
    `/api/sales-agents/${salesAgent.id}/team`,
    { teamId: team.id },
  )
  assert.equal(assignment.status, 200)

  const targetSave = await call(
    cookies,
    "PUT",
    `/api/sales-agents/${salesAgent.id}/targets`,
    {
      month: "2026-10",
      leadsTarget: 8,
      bookingsTarget: 3,
      collectionsTarget: 500_000,
    },
  )
  assert.equal(targetSave.status, 200, JSON.stringify(targetSave.body))

  const performance = await call(
    cookies,
    "GET",
    "/api/sales-agents?month=2026-10",
  )
  assert.equal(performance.status, 200)
  const measured = performance.body.agents.find(
    (agent: Json) => agent.id === salesAgent.id,
  )
  assert.equal(measured.teamId, team.id)
  assert.equal(measured.leadsTarget, 8)
  assert.equal(measured.bookingsTarget, 3)
  assert.equal(measured.collectionsTarget, 500_000)
  assert.equal(measured.bookingsClosed, null)
  assert.equal(measured.collectionsMade, null)
  assert.equal(performance.body.currency, "AED")

  const { cookies: agentCookies } = await signIn("sales.agent@deedorbit.com")
  const managerOnly = await call(agentCookies, "GET", "/api/sales-agents")
  assert.equal(managerOnly.status, 403)

  const removedStage = await call(
    cookies,
    "DELETE",
    `/api/leads/stages/${customStage.id}`,
  )
  assert.equal(removedStage.status, 200)
  assert.equal(
    removedStage.body.stages.some((stage: Json) => stage.id === customStage.id),
    false,
  )
})

// ---------------------------------------------------------------------------

// Bookings
//
// The one behaviour that makes a booking more than a row is that creating it
// moves the unit. These tests set the unit up as a project manager (the create
// right lives there), then make and cancel the booking as a sales manager, and
// read the unit back to prove the status was driven by the system rather than
// by an inventory edit the booking role does not even hold.
// ---------------------------------------------------------------------------

test("a booking links customer and unit and drives the unit to Booked", async () => {
  const { cookies: projectCookies } = await signIn("projects@deedorbit.com")

  const { projectId, nodeId } = await inventoryPlot(
    projectCookies,

    "Booking Acceptance Plot",
  )

  const createdUnit = await addUnit(projectCookies, projectId, {
    ...validUnitBody(nodeId),

    unitCode: "A-2001",

    status: "available",
  })

  assert.equal(createdUnit.status, 200, JSON.stringify(createdUnit.body))

  const unitId = createdUnit.body.unit.id

  const { cookies } = await signIn("sales.manager@deedorbit.com")

  const customer = await call(cookies, "POST", "/api/customers", {
    fullName: "Aisha Rahman",

    phone: "+971501112222",
  })

  assert.equal(customer.status, 200, JSON.stringify(customer.body))

  const customerId = customer.body.customer.id

  const booking = await call(cookies, "POST", "/api/bookings", {
    projectId,

    unitId,

    customerId,

    bookingAmount: 250000,

    bookingDate: "2026-04-01",

    terms: "25% on booking, balance on handover.",
  })

  assert.equal(booking.status, 200, JSON.stringify(booking.body))

  const made = booking.body.booking

  assert.equal(made.reference, "BK-A-2001-001")

  assert.equal(made.status, "confirmed")

  assert.equal(made.bookingAmount, 250000)

  assert.equal(made.customerName, "Aisha Rahman")

  assert.equal(made.unitCode, "A-2001")

  assert.equal(booking.body.currency, "AED")

  // The unit is where the booking left it: booked, through the system path.

  const units = await call(
    cookies,

    "GET",

    `/api/projects/${projectId}/units`,
  )

  assert.equal(units.status, 200)

  const bookedUnit = units.body.units.find((entry: Json) => entry.id === unitId)

  assert.equal(bookedUnit.status, "booked")

  // The newest trail entry is the system move, with no user behind it.

  const history = await call(
    cookies,

    "GET",

    `/api/projects/${projectId}/units/${unitId}/status-history`,
  )

  assert.equal(history.status, 200)

  const newest = history.body.entries[0]

  assert.equal(newest.source, "system")

  assert.equal(newest.toStatus, "booked")

  assert.equal(newest.changedByUserId, null)

  // Cancelling calls the booking off and returns the unit to the market.

  const cancelled = await call(
    cookies,

    "POST",

    `/api/bookings/${made.id}/cancel`,
  )

  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body))

  assert.equal(cancelled.body.booking.status, "cancelled")

  const afterUnits = await call(
    cookies,

    "GET",

    `/api/projects/${projectId}/units`,
  )

  const reverted = afterUnits.body.units.find(
    (entry: Json) => entry.id === unitId,
  )

  assert.equal(reverted.status, "available")

  // The detail read reflects the cancellation.

  const detail = await call(cookies, "GET", `/api/bookings/${made.id}`)

  assert.equal(detail.status, 200)

  assert.equal(detail.body.booking.status, "cancelled")

  // A booking cannot be cancelled twice.

  const recancel = await call(
    cookies,

    "POST",

    `/api/bookings/${made.id}/cancel`,
  )

  assert.equal(recancel.status, 422)
})

// ---------------------------------------------------------------------------

// Approvals and payment plans

//

// The maker-checker queue only engages once a policy is switched on, so these

// tests turn one on, exercise the hold / self-block / approve / reject and the

// gated cancel, then switch it back off — leaving every other flow immediate.

// The payment-plan test then confirms a plan and drives a line part- then fully

// paid, checking the generated schedule sums to the net plus the charges exactly.

// ---------------------------------------------------------------------------

/** Write one approval policy; the threshold is meaningful only for the actions that carry one. */

function setApprovalPolicy(
  cookies: CookieJar,

  actionKey: string,

  enabled: boolean,

  thresholdAmount: number,
): Promise<CallResult> {
  return call(cookies, "PATCH", "/api/settings/approval-policies", {
    policies: [{ actionKey, enabled, thresholdAmount }],
  })
}

/** The current status of a unit, or `__missing__` when it is not in the list. */

async function unitStatus(
  cookies: CookieJar,

  projectId: string,

  unitId: string,
): Promise<string> {
  const units = await call(cookies, "GET", `/api/projects/${projectId}/units`)

  const entry = units.body.units.find((each: Json) => each.id === unitId)

  return entry ? entry.status : "__missing__"
}

/** A project with one available unit and a fresh customer, ready to be booked. */

interface BookableFixture {
  projectId: string

  unitId: string

  customerId: string

  manager: CookieJar
}

async function bookableFixture(
  name: string,

  unitCode: string,

  phone: string,
): Promise<BookableFixture> {
  const { cookies: pm } = await signIn("projects@deedorbit.com")

  const { projectId, nodeId } = await inventoryPlot(pm, name)

  const createdUnit = await addUnit(pm, projectId, {
    ...validUnitBody(nodeId),

    unitCode,

    status: "available",
  })

  assert.equal(createdUnit.status, 200, JSON.stringify(createdUnit.body))

  const { cookies: manager } = await signIn("sales.manager@deedorbit.com")

  const customer = await call(manager, "POST", "/api/customers", {
    fullName: `Customer ${unitCode}`,

    phone,
  })

  assert.equal(customer.status, 200, JSON.stringify(customer.body))

  return {
    projectId,

    unitId: createdUnit.body.unit.id,

    customerId: customer.body.customer.id,

    manager,
  }
}

test("a booking above the threshold is held, then maker-checker approved", async () => {
  const { cookies: admin } = await signIn("admin@deedorbit.com")

  const enabled = await setApprovalPolicy(admin, "booking", true, 1000)

  assert.equal(enabled.status, 200, JSON.stringify(enabled.body))

  const fixture = await bookableFixture(
    "Approval Booking Plot",

    "A-3001",

    "+971501113001",
  )

  const held = await call(fixture.manager, "POST", "/api/bookings", {
    projectId: fixture.projectId,

    unitId: fixture.unitId,

    customerId: fixture.customerId,

    bookingAmount: 250000,

    bookingDate: "2026-05-01",

    terms: "Held for sign-off.",
  })

  assert.equal(held.status, 200, JSON.stringify(held.body))

  assert.equal(held.body.pending, true)

  assert.equal(held.body.booking, undefined)

  assert.equal(held.body.approval.status, "pending")

  assert.equal(held.body.approval.actionKey, "booking")

  const approvalId = held.body.approval.id

  // Nothing moved: the request only waits, so the unit stays on the market.

  assert.equal(
    await unitStatus(fixture.manager, fixture.projectId, fixture.unitId),

    "available",
  )

  // The requester holds approve, yet may not clear their own request.

  const self = await call(
    fixture.manager,

    "POST",

    `/api/approvals/${approvalId}/approve`,

    {},
  )

  assert.equal(self.status, 403)

  // A different approver signs it off, and the replay makes the booking as if it

  // had never been held.

  const approved = await call(
    admin,

    "POST",

    `/api/approvals/${approvalId}/approve`,

    { decisionNote: "Cleared." },
  )

  assert.equal(approved.status, 200, JSON.stringify(approved.body))

  assert.equal(approved.body.approval.status, "approved")

  const bookingId = approved.body.approval.resultEntityId

  assert.ok(bookingId)

  const detail = await call(admin, "GET", `/api/bookings/${bookingId}`)

  assert.equal(detail.status, 200)

  assert.equal(detail.body.booking.status, "confirmed")

  assert.equal(
    await unitStatus(fixture.manager, fixture.projectId, fixture.unitId),

    "booked",
  )

  const history = await call(
    fixture.manager,

    "GET",

    `/api/projects/${fixture.projectId}/units/${fixture.unitId}/status-history`,
  )

  assert.equal(history.body.entries[0].source, "system")

  await setApprovalPolicy(admin, "booking", false, 0)
})

test("a held booking that is rejected was never made", async () => {
  const { cookies: admin } = await signIn("admin@deedorbit.com")

  await setApprovalPolicy(admin, "booking", true, 1000)

  const fixture = await bookableFixture(
    "Rejected Booking Plot",

    "A-3002",

    "+971501113002",
  )

  const held = await call(fixture.manager, "POST", "/api/bookings", {
    projectId: fixture.projectId,

    unitId: fixture.unitId,

    customerId: fixture.customerId,

    bookingAmount: 300000,

    bookingDate: "2026-05-01",

    terms: "Awaiting decision.",
  })

  const approvalId = held.body.approval.id

  // A rejection must carry a reason.

  const noteless = await call(
    admin,

    "POST",

    `/api/approvals/${approvalId}/reject`,

    {},
  )

  assert.equal(noteless.status, 400)

  const rejected = await call(
    admin,

    "POST",

    `/api/approvals/${approvalId}/reject`,

    { decisionNote: "Unit reserved elsewhere." },
  )

  assert.equal(rejected.status, 200, JSON.stringify(rejected.body))

  assert.equal(rejected.body.approval.status, "rejected")

  // The declined request applied nothing.

  assert.equal(
    await unitStatus(fixture.manager, fixture.projectId, fixture.unitId),

    "available",
  )

  await setApprovalPolicy(admin, "booking", false, 0)
})

test("a gated cancellation is held, then approved by another to release the unit", async () => {
  const { cookies: admin } = await signIn("admin@deedorbit.com")

  // A confirmed booking made while the booking gate is off, then the cancel gate on.

  const fixture = await bookableFixture(
    "Cancel Gate Plot",

    "A-3003",

    "+971501113003",
  )

  const made = await call(fixture.manager, "POST", "/api/bookings", {
    projectId: fixture.projectId,

    unitId: fixture.unitId,

    customerId: fixture.customerId,

    bookingAmount: 200000,

    bookingDate: "2026-05-01",

    terms: "Direct.",
  })

  assert.equal(made.body.pending, undefined)

  const bookingId = made.body.booking.id

  assert.equal(
    await unitStatus(fixture.manager, fixture.projectId, fixture.unitId),

    "booked",
  )

  await setApprovalPolicy(admin, "cancellation", true, 0)

  const held = await call(
    fixture.manager,

    "POST",

    `/api/bookings/${bookingId}/cancel`,
  )

  assert.equal(held.status, 200, JSON.stringify(held.body))

  assert.equal(held.body.pending, true)

  const approvalId = held.body.approval.id

  // Until the decision, the booking stands and the unit stays booked.

  const stillConfirmed = await call(
    fixture.manager,

    "GET",

    `/api/bookings/${bookingId}`,
  )

  assert.equal(stillConfirmed.body.booking.status, "confirmed")

  assert.equal(
    await unitStatus(fixture.manager, fixture.projectId, fixture.unitId),

    "booked",
  )

  const approved = await call(
    admin,

    "POST",

    `/api/approvals/${approvalId}/approve`,

    {},
  )

  assert.equal(approved.status, 200, JSON.stringify(approved.body))

  const after = await call(fixture.manager, "GET", `/api/bookings/${bookingId}`)

  assert.equal(after.body.booking.status, "cancelled")

  assert.equal(
    await unitStatus(fixture.manager, fixture.projectId, fixture.unitId),

    "available",
  )

  await setApprovalPolicy(admin, "cancellation", false, 0)
})

test("confirming a plan generates an exact dated schedule and payments move a line", async () => {
  const { cookies: admin } = await signIn("admin@deedorbit.com")

  // Defensive: both gates off so the booking below is immediate.

  await setApprovalPolicy(admin, "booking", false, 0)

  await setApprovalPolicy(admin, "cancellation", false, 0)

  const fixture = await bookableFixture(
    "Payment Plan Plot",

    "A-3004",

    "+971501113004",
  )

  const made = await call(fixture.manager, "POST", "/api/bookings", {
    projectId: fixture.projectId,

    unitId: fixture.unitId,

    customerId: fixture.customerId,

    bookingAmount: 600000,

    bookingDate: "2020-01-15",

    terms: "Plan test.",
  })

  assert.equal(made.status, 200, JSON.stringify(made.body))

  const bookingId = made.body.booking.id

  // The owner holds every payments grant and keeps its seeded password, unlike the
  // accounts desk whose credentials an earlier reset test rotated.

  const { cookies: accounts } = await signIn("owner@deedorbit.com")

  const confirmed = await call(
    accounts,

    "POST",

    `/api/bookings/${bookingId}/payment-plan/confirm`,

    {
      netAmount: 600000,

      downPaymentPercent: 20,

      charges: 600,

      frequency: "monthly",

      installmentCount: 6,

      balloonAmount: 1000,

      startDate: "2020-01-31",
    },
  )

  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body))

  const lines = rows(confirmed.body.installments)

  // One down payment, six installments, one balloon.

  assert.equal(lines.length, 8)

  assert.equal(lines[0].kind, "down_payment")

  assert.equal(lines[0].dueDate, "2020-01-31")

  assert.equal(lines[0].amount, 120000)

  assert.equal(lines.filter((line) => line.kind === "installment").length, 6)

  const last = lines[lines.length - 1]

  assert.equal(last.kind, "balloon")

  assert.equal(last.amount, 1000)

  // Monthly steps land on the last day of a shorter month, not past it.

  assert.equal(lines[1].dueDate, "2020-02-29")

  assert.equal(last.dueDate, "2020-07-31")

  let amountSum = 0

  let chargesSum = 0

  let totalSum = 0

  for (const line of lines) {
    amountSum += line.amount

    chargesSum += line.charges

    totalSum += line.total

    // Every date is in the past and nothing is paid: the reading is overdue.

    assert.equal(line.displayStatus, "overdue")

    assert.equal(line.paidAmount, 0)
  }

  assert.equal(amountSum, 600000)

  assert.equal(chargesSum, 600)

  assert.equal(totalSum, 600600)

  // A confirmed plan cannot be replaced.

  const replace = await call(
    accounts,

    "POST",

    `/api/bookings/${bookingId}/payment-plan/confirm`,

    {
      netAmount: 600000,

      downPaymentPercent: 10,

      charges: 0,

      frequency: "monthly",

      installmentCount: 6,

      balloonAmount: 0,

      startDate: "2020-01-31",
    },
  )

  assert.equal(replace.status, 422)

  const downLineId = lines[0].id

  const partial = await call(
    accounts,

    "POST",

    `/api/payment-installments/${downLineId}/payments`,

    { amount: 50000 },
  )

  assert.equal(partial.status, 200, JSON.stringify(partial.body))

  assert.equal(partial.body.installment.paidAmount, 50000)

  assert.equal(partial.body.installment.status, "partially_paid")

  assert.equal(partial.body.installment.displayStatus, "partially_paid")

  const settled = await call(
    accounts,

    "POST",

    `/api/payment-installments/${downLineId}/payments`,

    { amount: 70000 },
  )

  assert.equal(settled.status, 200, JSON.stringify(settled.body))

  assert.equal(settled.body.installment.paidAmount, 120000)

  assert.equal(settled.body.installment.status, "paid")

  assert.equal(settled.body.installment.displayStatus, "paid")

  // A line cannot be recorded beyond its balance.

  const over = await call(
    accounts,

    "POST",

    `/api/payment-installments/${downLineId}/payments`,

    { amount: 1 },
  )

  assert.equal(over.status, 400)
})

// ---------------------------------------------------------------------------

// Collections, refunds, ledger, and money actions

//

// The plan-level money moves: a payment split across a customer's schedule, a late

// fee that sweeps onto an overdue line and can be waived through approval, a refund

// raised against a receipt, a cancellation that charges and refunds under tenant

// rules, a booking transfer that repoints a customer with paired ledger entries,

// and the collections summary that classifies what is due and overdue. Each test

// turns the relevant settings on, exercises the flow end-to-end, and puts them

// back exactly as they were so the surrounding tests see a clean slate.

// ---------------------------------------------------------------------------

/** Confirm a fresh plan on a booking and return the dated installment lines. */
async function confirmPlan(
  cookies: CookieJar,

  bookingId: string,

  body: Record<string, unknown>,
): Promise<Json[]> {
  const result = await call(
    cookies,

    "POST",

    `/api/bookings/${bookingId}/payment-plan/confirm`,

    body,
  )

  assert.equal(result.status, 200, JSON.stringify(result.body))

  return rows(result.body.installments)
}

/** Book a fixture's unit and confirm a plan on it, returning both ids and the lines. */
interface PlannedFixture {
  fixture: BookableFixture

  bookingId: string

  installments: Json[]
}

async function plannedFixture(
  payCookies: CookieJar,

  name: string,

  code: string,

  phone: string,

  plan: Record<string, unknown>,
): Promise<PlannedFixture> {
  const fixture = await bookableFixture(name, code, phone)

  const made = await call(fixture.manager, "POST", "/api/bookings", {
    projectId: fixture.projectId,

    unitId: fixture.unitId,

    customerId: fixture.customerId,

    bookingAmount: 500000,

    bookingDate: "2020-01-15",

    terms: `${name} terms.`,
  })

  assert.equal(made.status, 200, JSON.stringify(made.body))

  const bookingId = made.body.booking.id

  const installments = await confirmPlan(payCookies, bookingId, plan)

  return { fixture, bookingId, installments }
}

test("recording an allocated payment mints a receipt and appends a ledger row", async () => {
  const { cookies: admin } = await signIn("admin@deedorbit.com")

  // Gate both bookings and cancellations off so the fixture below books and

  // (in sibling tests) cancels without needing an approval detour.

  await setApprovalPolicy(admin, "booking", false, 0)

  await setApprovalPolicy(admin, "cancellation", false, 0)

  // Late fees off: this test only cares about the payment + ledger + receipt.

  await call(admin, "PATCH", "/api/settings/late-fees", {
    enabled: false,

    mode: "fixed",

    amount: 0,

    percentBps: 0,

    graceDays: 0,

    maxAssessments: 0,
  })

  const { cookies: owner } = await signIn("owner@deedorbit.com")

  const planned = await plannedFixture(
    owner,

    "Allocation Ledger Plot",

    "A-4101",

    "+971501141001",

    {
      netAmount: 500000,

      downPaymentPercent: 20,

      charges: 0,

      frequency: "monthly",

      installmentCount: 4,

      balloonAmount: 0,

      startDate: "2020-01-31",
    },
  )

  const down = planned.installments[0]

  const first = planned.installments[1]

  assert.equal(down.kind, "down_payment")

  assert.equal(down.amount, 100000)

  const recorded = await call(owner, "POST", "/api/payments", {
    customerId: planned.fixture.customerId,

    method: "bank",

    amount: 150000,

    allocations: [
      { installmentId: down.id, amount: 100000 },

      { installmentId: first.id, amount: 50000 },
    ],

    receivedAt: "2020-02-01",

    note: "Two lines on one wire.",
  })

  assert.equal(recorded.status, 200, JSON.stringify(recorded.body))

  assert.ok(
    typeof recorded.body.payment.receiptNumber === "string" &&
      recorded.body.payment.receiptNumber !== "",

    "the payment should carry a receipt number",
  )

  assert.equal(recorded.body.ledgerEntry.kind, "payment")

  assert.equal(recorded.body.ledgerEntry.amount, -150000)

  assert.equal(recorded.body.ledgerEntry.balanceAfter, -150000)

  // Down is paid; the first installment is now partially paid.

  const plan = await call(
    owner,

    "GET",

    `/api/bookings/${planned.bookingId}/payment-plan`,
  )

  assert.equal(plan.status, 200, JSON.stringify(plan.body))

  const refreshed = rows(plan.body.installments)

  assert.equal(refreshed[0].paidAmount, 100000)

  assert.equal(refreshed[0].status, "paid")

  assert.equal(refreshed[1].paidAmount, 50000)

  assert.equal(refreshed[1].status, "partially_paid")

  // A second payment mints a fresh, distinct receipt number.

  const second = await call(owner, "POST", "/api/payments", {
    customerId: planned.fixture.customerId,

    method: "cash",

    amount: 10000,

    allocations: [{ installmentId: first.id, amount: 10000 }],

    receivedAt: "2020-02-15",
  })

  assert.equal(second.status, 200, JSON.stringify(second.body))

  assert.notEqual(
    second.body.payment.receiptNumber,

    recorded.body.payment.receiptNumber,
  )

  const ledger = await call(
    owner,

    "GET",

    `/api/customers/${planned.fixture.customerId}/ledger`,
  )

  const entries = rows(ledger.body.entries)

  assert.equal(entries.length, 2)

  assert.equal(entries[1].balanceAfter, -160000)

  // Reading the receipt gives the printable view: allocations, tenant, customer.

  const receipt = await call(
    owner,

    "GET",

    `/api/payments/${recorded.body.payment.id}`,
  )

  assert.equal(receipt.status, 200, JSON.stringify(receipt.body))

  assert.equal(rows(receipt.body.lines).length, 2)

  assert.equal(receipt.body.tenant.name !== "", true)

  // Reject an allocation that over-pays one line.

  const tooMuch = await call(owner, "POST", "/api/payments", {
    customerId: planned.fixture.customerId,

    method: "cash",

    amount: 999999,

    allocations: [{ installmentId: first.id, amount: 999999 }],
  })

  assert.equal(tooMuch.status, 400)

  // Reject a payment whose parts do not sum to the header amount.

  const mismatch = await call(owner, "POST", "/api/payments", {
    customerId: planned.fixture.customerId,

    method: "cash",

    amount: 30000,

    allocations: [{ installmentId: first.id, amount: 20000 }],
  })

  assert.equal(mismatch.status, 400)
})

test("a late fee sweeps once per episode and clears through approval", async () => {
  const { cookies: admin } = await signIn("admin@deedorbit.com")

  await setApprovalPolicy(admin, "booking", false, 0)

  // Fixed 500 per overdue line, no grace, unlimited assessments.

  const saved = await call(admin, "PATCH", "/api/settings/late-fees", {
    enabled: true,

    mode: "fixed",

    amount: 500,

    percentBps: 0,

    graceDays: 0,

    maxAssessments: 0,
  })

  assert.equal(saved.status, 200, JSON.stringify(saved.body))

  const { cookies: owner } = await signIn("owner@deedorbit.com")

  // A plan starting back in 2020 so every line reads overdue today.

  const planned = await plannedFixture(
    owner,

    "Late Fee Sweep Plot",

    "F-4201",

    "+971501142001",

    {
      netAmount: 500000,

      downPaymentPercent: 20,

      charges: 0,

      frequency: "monthly",

      installmentCount: 1,

      balloonAmount: 0,

      startDate: "2020-01-31",
    },
  )

  // The overdue read runs the sweep before it returns the table.

  const overdue = await call(owner, "GET", "/api/collections/overdue")

  assert.equal(overdue.status, 200, JSON.stringify(overdue.body))

  const feeRows = rows(overdue.body.rows).filter(
    (row) => row.bookingId === planned.bookingId,
  )

  assert.ok(
    feeRows.length >= 2,
    "the down payment and one installment are overdue",
  )

  // At least one assessment now exists for this customer, and a matching ledger row.

  const ledger = await call(
    owner,

    "GET",

    `/api/customers/${planned.fixture.customerId}/ledger`,
  )

  const feeEntries = rows(ledger.body.entries).filter(
    (entry) => entry.kind === "late_fee",
  )

  assert.ok(feeEntries.length >= 1)

  assert.equal(feeEntries[0].amount > 0, true)

  // Idempotent within the same tenant day: a second sweep adds nothing new.

  await call(owner, "GET", "/api/collections/overdue")

  const ledgerAfter = await call(
    owner,

    "GET",

    `/api/customers/${planned.fixture.customerId}/ledger`,
  )

  const feeEntriesAfter = rows(ledgerAfter.body.entries).filter(
    (entry) => entry.kind === "late_fee",
  )

  assert.equal(feeEntriesAfter.length, feeEntries.length)

  // Take the assessment for the down-payment line via the DB read the sweep wrote.

  interface AssessmentRow {
    id: string

    installment_id: string

    amount: number

    status: string
  }

  const assessments = all<AssessmentRow>(
    `SELECT id, installment_id, amount, status FROM late_fee_assessments

      WHERE tenant_id = ? AND customer_id = ? AND status = 'applied'

      ORDER BY rowid ASC`,

    getTenantIdForEmail("owner@deedorbit.com"),

    planned.fixture.customerId,
  )

  assert.ok(assessments.length >= 1)

  const target = assessments[0]

  // Waive: the request goes through a maker-checker gate; nothing reverses yet.

  const waived = await call(
    owner,
    "POST",
    `/api/late-fee-assessments/${target.id}/waive`,
    {
      reason: "Bank error, not the customer.",
    },
  )

  assert.equal(waived.status, 200, JSON.stringify(waived.body))

  assert.equal(waived.body.pending, true)

  // The requester cannot approve their own waiver.

  const self = await call(
    owner,

    "POST",

    `/api/approvals/${waived.body.approvalId}/approve`,

    {},
  )

  assert.equal(self.status, 403)

  // A different approver signs it through, and the ledger credit appears.

  const approved = await call(
    admin,

    "POST",

    `/api/approvals/${waived.body.approvalId}/approve`,

    { decisionNote: "Cleared." },
  )

  assert.equal(approved.status, 200, JSON.stringify(approved.body))

  const ledgerEnd = await call(
    owner,

    "GET",

    `/api/customers/${planned.fixture.customerId}/ledger`,
  )

  const waiverEntries = rows(ledgerEnd.body.entries).filter(
    (entry) => entry.kind === "waiver",
  )

  assert.equal(waiverEntries.length, 1)

  assert.equal(waiverEntries[0].amount, -target.amount)

  // Turn the rule off again so the rest of the file's tests see a clean slate.

  await call(admin, "PATCH", "/api/settings/late-fees", {
    enabled: false,

    mode: "fixed",

    amount: 0,

    percentBps: 0,

    graceDays: 0,

    maxAssessments: 0,
  })
})

test("a refund is held for approval, then paid with a credit number", async () => {
  const { cookies: admin } = await signIn("admin@deedorbit.com")

  await setApprovalPolicy(admin, "booking", false, 0)

  await setApprovalPolicy(admin, "cancellation", false, 0)

  await call(admin, "PATCH", "/api/settings/late-fees", {
    enabled: false,

    mode: "fixed",

    amount: 0,

    percentBps: 0,

    graceDays: 0,

    maxAssessments: 0,
  })

  const { cookies: owner } = await signIn("owner@deedorbit.com")

  const planned = await plannedFixture(
    owner,

    "Refund Trail Plot",

    "R-4301",

    "+971501143001",

    {
      netAmount: 500000,

      downPaymentPercent: 20,

      charges: 0,

      frequency: "monthly",

      installmentCount: 1,

      balloonAmount: 0,

      startDate: "2020-01-31",
    },
  )

  const down = planned.installments[0]

  const payment = await call(owner, "POST", "/api/payments", {
    customerId: planned.fixture.customerId,

    method: "bank",

    amount: 100000,

    allocations: [{ installmentId: down.id, amount: 100000 }],

    receivedAt: "2020-02-01",
  })

  assert.equal(payment.status, 200, JSON.stringify(payment.body))

  const paymentId = payment.body.payment.id

  // Over-refund is refused at request time.

  const greedy = await call(owner, "POST", "/api/refunds", {
    customerId: planned.fixture.customerId,

    paymentId,

    amount: 200000,

    reason: "More than we ever received.",
  })

  assert.equal(greedy.status, 400)

  const refund = await call(owner, "POST", "/api/refunds", {
    customerId: planned.fixture.customerId,

    paymentId,

    amount: 40000,

    reason: "Customer downgrade, part refund.",

    bookingId: planned.bookingId,
  })

  assert.equal(refund.status, 200, JSON.stringify(refund.body))

  assert.equal(refund.body.refund.status, "pending")

  assert.equal(refund.body.pending, true)

  const approved = await call(
    admin,

    "POST",

    `/api/approvals/${refund.body.refund.approvalId}/approve`,

    { decisionNote: "Approved refund." },
  )

  assert.equal(approved.status, 200, JSON.stringify(approved.body))

  const list = await call(
    owner,

    "GET",

    `/api/customers/${planned.fixture.customerId}/refunds`,
  )

  const paid = rows(list.body.refunds).find(
    (r) => r.id === refund.body.refund.id,
  )

  assert.equal(paid?.status, "paid")

  assert.ok(typeof paid?.creditNumber === "string" && paid.creditNumber !== "")

  const ledger = await call(
    owner,

    "GET",

    `/api/customers/${planned.fixture.customerId}/ledger`,
  )

  const refundEntry = rows(ledger.body.entries).find(
    (entry) => entry.kind === "refund",
  )

  assert.ok(refundEntry)

  assert.equal(refundEntry.amount, 40000)

  assert.equal(refundEntry.reference, paid.creditNumber)
})

test("a cancellation with a rule charges and refunds what the preview promised", async () => {
  const { cookies: admin } = await signIn("admin@deedorbit.com")

  await setApprovalPolicy(admin, "booking", false, 0)

  // Turn the cancellation gate on so the cancel below is held.

  await setApprovalPolicy(admin, "cancellation", true, 0)

  await call(admin, "PATCH", "/api/settings/late-fees", {
    enabled: false,

    mode: "fixed",

    amount: 0,

    percentBps: 0,

    graceDays: 0,

    maxAssessments: 0,
  })

  // Keep 10% of what has been paid; refund the rest; free the unit back to the market.

  await call(admin, "PATCH", "/api/settings/cancellation-rules", {
    enabled: true,

    mode: "percent",

    amount: 0,

    percentBps: 1000,

    capAmount: 0,

    unitOutcome: "available",
  })

  const { cookies: owner } = await signIn("owner@deedorbit.com")

  const planned = await plannedFixture(
    owner,

    "Cancel Charge Plot",

    "C-4401",

    "+971501144001",

    {
      netAmount: 500000,

      downPaymentPercent: 20,

      charges: 0,

      frequency: "monthly",

      installmentCount: 1,

      balloonAmount: 0,

      startDate: "2020-01-31",
    },
  )

  const down = planned.installments[0]

  const payment = await call(owner, "POST", "/api/payments", {
    customerId: planned.fixture.customerId,

    method: "cash",

    amount: 60000,

    allocations: [{ installmentId: down.id, amount: 60000 }],

    receivedAt: "2020-02-01",
  })

  assert.equal(payment.status, 200, JSON.stringify(payment.body))

  // Preview before cancelling: 60000 paid, 10% charge = 6000, refund = 54000.

  const preview = await call(
    fixtureManagerFor(planned.fixture),

    "GET",

    `/api/bookings/${planned.bookingId}/cancellation-preview`,
  )

  assert.equal(preview.status, 200, JSON.stringify(preview.body))

  assert.equal(preview.body.paidAmount, 60000)

  assert.equal(preview.body.chargeAmount, 6000)

  assert.equal(preview.body.refundAmount, 54000)

  assert.equal(preview.body.requiresApproval, true)

  // Manager holds bookings.approve and requests the cancel; nothing applies yet.

  const held = await call(
    planned.fixture.manager,

    "POST",

    `/api/bookings/${planned.bookingId}/cancel`,

    { reason: "Customer request." },
  )

  assert.equal(held.status, 200, JSON.stringify(held.body))

  assert.equal(held.body.pending, true)

  const stillConfirmed = await call(
    planned.fixture.manager,

    "GET",

    `/api/bookings/${planned.bookingId}`,
  )

  assert.equal(stillConfirmed.body.booking.status, "confirmed")

  const approved = await call(
    admin,

    "POST",

    `/api/approvals/${held.body.approval.id}/approve`,

    {},
  )

  assert.equal(approved.status, 200, JSON.stringify(approved.body))

  const after = await call(
    planned.fixture.manager,

    "GET",

    `/api/bookings/${planned.bookingId}`,
  )

  assert.equal(after.body.booking.status, "cancelled")

  assert.equal(
    await unitStatus(
      planned.fixture.manager,
      planned.fixture.projectId,
      planned.fixture.unitId,
    ),

    "available",
  )

  const ledger = await call(
    owner,

    "GET",

    `/api/customers/${planned.fixture.customerId}/ledger`,
  )

  const charge = rows(ledger.body.entries).find(
    (entry) => entry.kind === "cancellation_charge",
  )

  const refund = rows(ledger.body.entries).find(
    (entry) => entry.kind === "cancellation_refund",
  )

  assert.ok(charge)

  assert.ok(refund)

  // A charge adds to what the customer owes; a refund takes the remaining money out
  // (credit), which is what the preview promised: 60 000 paid - 6 000 charge = 54 000.

  assert.equal(charge.amount, 6000)

  assert.equal(refund.amount, -54000)

  // Rules off again so nothing else inherits this workspace-wide behaviour.

  await call(admin, "PATCH", "/api/settings/cancellation-rules", {
    enabled: false,

    mode: "percent",

    amount: 0,

    percentBps: 0,

    capAmount: 0,

    unitOutcome: "available",
  })

  await setApprovalPolicy(admin, "cancellation", false, 0)
})

test("an approved transfer repoints the booking and books the paired ledger", async () => {
  const { cookies: admin } = await signIn("admin@deedorbit.com")

  await setApprovalPolicy(admin, "booking", false, 0)

  await setApprovalPolicy(admin, "cancellation", false, 0)

  await call(admin, "PATCH", "/api/settings/late-fees", {
    enabled: false,

    mode: "fixed",

    amount: 0,

    percentBps: 0,

    graceDays: 0,

    maxAssessments: 0,
  })

  const { cookies: owner } = await signIn("owner@deedorbit.com")

  const planned = await plannedFixture(
    owner,

    "Transfer Booking Plot",

    "T-4501",

    "+971501145001",

    {
      netAmount: 500000,

      downPaymentPercent: 20,

      charges: 0,

      frequency: "monthly",

      installmentCount: 1,

      balloonAmount: 0,

      startDate: "2020-01-31",
    },
  )

  // A second, distinct customer to move the booking to.

  const other = await call(planned.fixture.manager, "POST", "/api/customers", {
    fullName: "Receiving Party",

    phone: "+971501145002",
  })

  assert.equal(other.status, 200, JSON.stringify(other.body))

  const toCustomerId = other.body.customer.id

  // 20 000 paid on a 100 000 down and a 400 000 installment still open: 480 000 of
  // unpaid balance travels with the booking, all of it counted by `outstandingOnBooking`.

  const down = planned.installments[0]

  await call(owner, "POST", "/api/payments", {
    customerId: planned.fixture.customerId,

    method: "cash",

    amount: 20000,

    allocations: [{ installmentId: down.id, amount: 20000 }],

    receivedAt: "2020-02-01",
  })

  const held = await call(planned.fixture.manager, "POST", "/api/transfers", {
    bookingId: planned.bookingId,

    toCustomerId,

    fee: 1000,

    reason: "Assignment to a partner.",
  })

  assert.equal(held.status, 200, JSON.stringify(held.body))

  assert.equal(held.body.transfer.status, "pending")

  assert.equal(held.body.pending, true)

  const approved = await call(
    admin,

    "POST",

    `/api/approvals/${held.body.transfer.approvalId}/approve`,

    {},
  )

  assert.equal(approved.status, 200, JSON.stringify(approved.body))

  const booking = await call(
    planned.fixture.manager,

    "GET",

    `/api/bookings/${planned.bookingId}`,
  )

  assert.equal(booking.body.booking.customerId, toCustomerId)

  const oldLedger = await call(
    owner,

    "GET",

    `/api/customers/${planned.fixture.customerId}/ledger`,
  )

  const outEntry = rows(oldLedger.body.entries).find(
    (entry) => entry.kind === "transfer_out",
  )

  assert.ok(outEntry)

  // The old customer's balance falls by the amount that moved; the payment row

  // is still visible on their trail, so the before/after history is intact.

  const paymentOnOldLedger = rows(oldLedger.body.entries).some(
    (entry) => entry.kind === "payment",
  )

  assert.equal(paymentOnOldLedger, true)

  const newLedger = await call(
    owner,

    "GET",

    `/api/customers/${toCustomerId}/ledger`,
  )

  const inEntry = rows(newLedger.body.entries).find(
    (entry) => entry.kind === "transfer_in",
  )

  const feeEntry = rows(newLedger.body.entries).find(
    (entry) => entry.kind === "adjustment",
  )

  assert.ok(inEntry)

  assert.equal(inEntry.amount, 480000)

  assert.ok(outEntry)

  assert.equal(outEntry.amount, -480000)

  assert.ok(feeEntry)

  assert.equal(feeEntry.amount, 1000)
})

test("the collections summary classifies forward windows and aging bands", async () => {
  const { cookies: admin } = await signIn("admin@deedorbit.com")

  await setApprovalPolicy(admin, "booking", false, 0)

  await setApprovalPolicy(admin, "cancellation", false, 0)

  await call(admin, "PATCH", "/api/settings/late-fees", {
    enabled: false,

    mode: "fixed",

    amount: 0,

    percentBps: 0,

    graceDays: 0,

    maxAssessments: 0,
  })

  const { cookies: owner } = await signIn("owner@deedorbit.com")

  // A custom interval plan so the dates land where the buckets need them. The
  // generator offsets the first line by one interval, so startDate is 90 days back
  // and the four due dates come out at -60 / -30 / today / +30 — one line each in
  // the `31-60` and `0-30` bands, with the next 30-day window covered by the last.

  const fixture = await bookableFixture(
    "Collections Windows Plot",

    "K-4601",

    "+971501146001",
  )

  const made = await call(fixture.manager, "POST", "/api/bookings", {
    projectId: fixture.projectId,

    unitId: fixture.unitId,

    customerId: fixture.customerId,

    bookingAmount: 400000,

    bookingDate: "2020-01-15",

    terms: "Collections windows.",
  })

  assert.equal(made.status, 200, JSON.stringify(made.body))

  const bookingId = made.body.booking.id

  // Four 30-day-interval installments; the generator's +1 step places the first at
  // -60, then -30, today, +30.

  const today = new Date()

  const daysAgo = (n: number) => {
    const date = new Date(today.getTime() - n * 86400000)

    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
  }

  const installments = await confirmPlan(owner, bookingId, {
    netAmount: 400000,

    downPaymentPercent: 0,

    charges: 0,

    frequency: "custom",

    customIntervalDays: 30,

    installmentCount: 4,

    balloonAmount: 0,

    startDate: daysAgo(90),
  })

  assert.equal(installments.length, 4)

  // The summary runs the sweep and reads the schedule against the tenant day.

  const summary = await call(owner, "GET", "/api/collections/summary")

  assert.equal(summary.status, 200, JSON.stringify(summary.body))

  assert.ok(summary.body.kpis)

  assert.ok(Array.isArray(summary.body.aging))

  // One line is 60 days past due; the 31-60 band picks it up.

  const band = rows(summary.body.aging).find((b) => b.bucket === "31-60")

  assert.ok(band)

  assert.equal(band.count >= 1, true)

  // Assigning an officer to a line, then reading it back.

  const recovery = await call(admin, "GET", "/api/users")

  const officer = rows(recovery.body.users).find(
    (u) => u.roleId === "recovery_officer",
  )

  assert.ok(officer, "the seeded recovery officer should exist")

  const assigned = await call(
    owner,

    "POST",

    `/api/payment-installments/${installments[0].id}/assign`,

    { officerUserId: officer.id },
  )

  assert.equal(assigned.status, 200, JSON.stringify(assigned.body))

  const reSummary = await call(owner, "GET", "/api/collections/summary")

  const workload = rows(reSummary.body.officers).find(
    (row) => row.officerUserId === officer.id,
  )

  assert.ok(workload)

  assert.equal(workload.openCount >= 1, true)

  // Set a target for this officer and read the aggregate back.

  const period = new Date().toISOString().slice(0, 7)

  const withTargets = await call(
    admin,

    "PATCH",

    "/api/settings/collection-targets",

    {
      targets: [{ officerUserId: officer.id, period, targetAmount: 100000 }],
    },
  )

  assert.equal(withTargets.status, 200, JSON.stringify(withTargets.body))

  const withKpis = await call(owner, "GET", "/api/collections/summary")

  assert.equal(withKpis.body.kpis.targetPeriodAmount, 100000)

  // Clear the officer assignment so nothing downstream sees this officer's load.

  await call(
    owner,

    "POST",

    `/api/payment-installments/${installments[0].id}/assign`,

    { officerUserId: "" },
  )
})

/** The signed-in manager for a fixture (a fresh cookie jar each call keeps tests isolated). */
function fixtureManagerFor(fixture: BookableFixture): CookieJar {
  return fixture.manager
}

/** Resolve the tenant id from a signed-in email, used only by the late-fee test. */
function getTenantIdForEmail(email: string): string {
  const row = get<{ tenant_id: string }>(
    `SELECT tenant_id FROM users WHERE email = ?`,

    email,
  )

  assert.ok(row, `no seeded user for ${email}`)

  return row.tenant_id
}

// ---------------------------------------------------------------------------

// Assistant: "Ask DeedOrbit" natural-language reads over the tenant's own data

// ---------------------------------------------------------------------------

const { ASSISTANT_INTENTS } = await import("../shared/assistant.ts")

test("assistant is a securable module in the catalogue", () => {
  // The whole point of the shared registry: a module that appears in the
  // navigation must also be grantable. `assistant.view` therefore exists as a
  // permission and is a default grant for the workspace owner.
  const permission = get<{ count: number }>(
    "SELECT COUNT(*) AS count FROM permissions WHERE permission_id = 'assistant.view'",
  )?.count

  assert.equal(permission, 1, "assistant.view must be seeded as a permission")

  const ownerHolds = get<{ count: number }>(
    `SELECT COUNT(*) AS count FROM role_permission_defaults
      WHERE role_id = 'tenant_owner' AND permission_id = 'assistant.view'`,
  )?.count

  assert.equal(ownerHolds, 1, "the owner's all:true expands to assistant.view")
})

test("the assistant answers an overdue question for a role that can read payments", async () => {
  const { cookies: admin } = await signIn("admin@deedorbit.com")

  await setApprovalPolicy(admin, "booking", false, 0)

  const { cookies: owner } = await signIn("owner@deedorbit.com")

  // One line due back in 2020 is far past any threshold the question names.
  const planned = await plannedFixture(
    owner,

    "Ask Assistant Overdue Plot",

    "AA-5101",

    "+9715051145101",

    {
      netAmount: 500000,

      downPaymentPercent: 20,

      charges: 0,

      frequency: "monthly",

      installmentCount: 1,

      balloonAmount: 0,

      startDate: "2020-01-31",
    },
  )

  const answer = await call(owner, "POST", "/api/assistant/ask", {
    question: "which units are overdue over 60 days",
  })

  assert.equal(answer.status, 200, JSON.stringify(answer.body))

  assert.equal(answer.body.intentId, "overdue_lines")

  assert.equal(answer.body.requiresModule, "payments")

  assert.equal(answer.body.permitted, true)

  assert.ok(
    typeof answer.body.answer === "string" && answer.body.answer.length > 0,
  )

  // Every returned line really is past the threshold the question asked for.
  const lineRows = rows(answer.body.rows)

  assert.ok(
    lineRows.length >= 1,
    `expected the fixture to surface as overdue: ${planned.bookingId}`,
  )

  for (const row of lineRows) {
    assert.ok(
      row.daysOverdue >= 60,
      `row was not 60+ days overdue: ${row.unit}`,
    )
  }

  assert.ok(answer.body.matchedCount >= 1)
})

test("the assistant reads a day threshold out of the question", async () => {
  const { cookies: owner } = await signIn("owner@deedorbit.com")

  const narrow = await call(owner, "POST", "/api/assistant/ask", {
    question: "list instalments overdue by more than 300 days",
  })

  assert.equal(narrow.status, 200, JSON.stringify(narrow.body))

  assert.equal(narrow.body.intentId, "overdue_lines")

  for (const row of rows(narrow.body.rows)) {
    assert.ok(row.daysOverdue >= 300, `expected a 300+ day floor: ${row.unit}`)
  }
})

test("the assistant can total and rank overdue lines", async () => {
  const { cookies: owner } = await signIn("owner@deedorbit.com")

  const summary = await call(owner, "POST", "/api/assistant/ask", {
    question: "how much is overdue in total, give me a breakdown by bucket",
  })

  assert.equal(summary.status, 200, JSON.stringify(summary.body))

  assert.equal(summary.body.intentId, "overdue_summary")

  const columns = rows<{ key: string }>(summary.body.columns).map(
    (column) => column.key,
  )

  assert.ok(columns.includes("bucket"), "summary returns aging bands")

  assert.ok(columns.includes("count"))

  assert.ok(columns.includes("amount"))

  const oldest = await call(owner, "POST", "/api/assistant/ask", {
    question: "what are the oldest overdue payments",
  })

  assert.equal(oldest.status, 200, JSON.stringify(oldest.body))

  assert.equal(oldest.body.intentId, "oldest_overdue")

  const ranked = rows(oldest.body.rows)

  for (let i = 1; i < ranked.length; i++) {
    assert.ok(
      ranked[i - 1]!.daysOverdue >= ranked[i]!.daysOverdue,
      "oldest first, deepest delinquency at the top",
    )
  }
})

test("the assistant declines a question it cannot read without inventing an answer", async () => {
  const { cookies: owner } = await signIn("owner@deedorbit.com")

  const miss = await call(owner, "POST", "/api/assistant/ask", {
    question: "what is the weather in Dubai today",
  })

  assert.equal(miss.status, 200, JSON.stringify(miss.body))

  assert.equal(miss.body.intentId, null, "no intent should match a weather ask")

  assert.equal(miss.body.permitted, true)

  assert.equal(rows(miss.body.rows).length, 0)

  assert.ok(
    rows(miss.body.examples).length >= ASSISTANT_INTENTS.length,
    "the fallback offers example prompts to steer the next question",
  )

  const empty = await call(owner, "POST", "/api/assistant/ask", {
    question: "   ",
  })

  assert.equal(empty.status, 400, "a blank question is rejected outright")
})

test("the assistant refuses a topic whose module the role cannot open", async () => {
  const { cookies: pm } = await signIn("projects@deedorbit.com")

  // The project manager holds assistant.view (so reaches the endpoint) but not
  // payments.view (so the overdue rows must stay hidden). This is the whole
  // second gate: the assistant cannot show what the module already would not.
  const session = await call(pm, "GET", "/api/auth/session")

  const modules = rows<string>(session.body.modules, "session.modules")

  assert.ok(modules.includes("assistant"), "project manager can open assistant")

  assert.ok(
    !modules.includes("payments"),
    "project manager cannot open payments",
  )

  const refused = await call(pm, "POST", "/api/assistant/ask", {
    question: "which units are overdue over 60 days",
  })

  assert.equal(refused.status, 200, JSON.stringify(refused.body))

  assert.equal(refused.body.intentId, "overdue_lines")

  assert.equal(refused.body.requiresModule, "payments")

  assert.equal(
    refused.body.permitted,
    false,
    "the answer must report the refusal, not throw",
  )

  assert.equal(rows(refused.body.rows).length, 0)

  assert.ok(
    /payments/i.test(refused.body.answer),
    "the refusal names the module that is missing",
  )
})

test("the assistant endpoint is closed to a role without assistant.view", async () => {
  const { cookies: buyer } = await signIn("customer@deedorbit.com")

  const denied = await call(buyer, "POST", "/api/assistant/ask", {
    question: "which units are overdue",
  })

  assert.equal(denied.status, 403, JSON.stringify(denied.body))

  assert.equal(denied.body.error.code, "permission_denied")
})

// ---------------------------------------------------------------------------

// Accounting stack: chart of accounts, expenses, vendors, journal

// ---------------------------------------------------------------------------

// A short unique token so vendor names and references never collide with a
// fixture created earlier in the shared database.

function uid(): string {
  return Math.random().toString(36).slice(2, 8)
}

const { EXPENSE_ATTACHMENT_MAX_BYTES } = await import("../shared/expenses.ts")

const { COA_SOURCES } = await import("../shared/chart-of-accounts.ts")

/** A tiny, valid base64 data URL for the given mime. */
function dataUrl(mime: string, bytes: number): string {
  const base64 = Buffer.alloc(bytes, 0x41).toString("base64")

  return `data:${mime};base64,${base64}`
}

test("chart of accounts: GET returns every source, empty by default", async () => {
  const { cookies } = await signIn("admin@deedorbit.com")

  const result = await call(cookies, "GET", "/api/settings/chart-of-accounts")

  assert.equal(result.status, 200, JSON.stringify(result.body))

  const mappings = rows(result.body.mappings)

  assert.equal(mappings.length, COA_SOURCES.length)

  for (const mapping of mappings) {
    assert.equal(
      mapping.accountCode,
      "",
      `${mapping.source} should default empty`,
    )
  }
})

test("chart of accounts: PATCH writes and round-trips", async () => {
  const { cookies } = await signIn("admin@deedorbit.com")

  const write = await call(
    cookies,
    "PATCH",
    "/api/settings/chart-of-accounts",
    {
      mappings: [{ source: "booking_income", accountCode: "4000-INC" }],
    },
  )

  assert.equal(write.status, 200, JSON.stringify(write.body))

  const bookingIncome = rows(write.body.mappings).find(
    (m) => m.source === "booking_income",
  )

  assert.equal(bookingIncome?.accountCode, "4000-INC")

  const read = await call(cookies, "GET", "/api/settings/chart-of-accounts")

  const reread = rows(read.body.mappings).find(
    (m) => m.source === "booking_income",
  )

  assert.equal(reread?.accountCode, "4000-INC")
})

test("chart of accounts: an invalid account code is 400", async () => {
  const { cookies } = await signIn("admin@deedorbit.com")

  const result = await call(
    cookies,
    "PATCH",
    "/api/settings/chart-of-accounts",
    {
      mappings: [{ source: "receivables", accountCode: "bad code!" }],
    },
  )

  assert.equal(result.status, 400, JSON.stringify(result.body))
})

test("chart of accounts: reading without settings.view is 403", async () => {
  const { cookies } = await signIn("sales.agent@deedorbit.com")

  const result = await call(cookies, "GET", "/api/settings/chart-of-accounts")

  assert.equal(result.status, 403, JSON.stringify(result.body))
})

test("expenses: draft → submit → approve (peer) → mark-paid, and paid_at is set", async () => {
  const { cookies: maker } = await signIn("admin@deedorbit.com")

  const { cookies: checker } = await signIn("owner@deedorbit.com")

  const created = await call(maker, "POST", "/api/expenses", {
    category: "office",
    description: `Stationery run ${uid()}`,
    amount: 2500,
    occurredAt: "2031-04-01",
  })

  assert.equal(created.status, 200, JSON.stringify(created.body))

  const expenseId = created.body.expense.id as string

  assert.equal(created.body.expense.status, "draft")

  const submitted = await call(
    maker,
    "POST",
    `/api/expenses/${expenseId}/submit`,
  )

  assert.equal(submitted.status, 200, JSON.stringify(submitted.body))

  assert.equal(submitted.body.expense.status, "pending_approval")

  assert.ok(submitted.body.approvalId, "submit should return an approval id")

  // The request landed in the queue, pointed at this expense.

  const queue = await call(maker, "GET", "/api/approvals?status=pending")

  const held = rows(queue.body.approvals).find(
    (a) => a.actionKey === "expense" && a.resultEntityId === expenseId,
  )

  assert.ok(held, "the expense approval should appear in the queue")

  // A different user clears it (maker-checker), flipping the expense to approved.

  const approved = await call(
    checker,
    "POST",
    `/api/approvals/${held!.id}/approve`,
    {
      decisionNote: "Checked the receipt.",
    },
  )

  assert.equal(approved.status, 200, JSON.stringify(approved.body))

  const readAfterApprove = await call(
    maker,
    "GET",
    `/api/expenses/${expenseId}`,
  )

  assert.equal(readAfterApprove.body.expense.status, "approved")

  const paid = await call(maker, "POST", `/api/expenses/${expenseId}/mark-paid`)

  assert.equal(paid.status, 200, JSON.stringify(paid.body))

  assert.equal(paid.body.expense.status, "paid")

  assert.ok(paid.body.expense.paidAt, "mark-paid should set paid_at")
})

test("expenses: an approver cannot clear their own submission", async () => {
  const { cookies } = await signIn("admin@deedorbit.com")

  const created = await call(cookies, "POST", "/api/expenses", {
    category: "marketing",
    description: `Self-check ${uid()}`,
    amount: 900,
    occurredAt: "2031-04-02",
  })

  const expenseId = created.body.expense.id as string

  await call(cookies, "POST", `/api/expenses/${expenseId}/submit`)

  const queue = await call(cookies, "GET", "/api/approvals?status=pending")

  const held = rows(queue.body.approvals).find(
    (a) => a.actionKey === "expense" && a.resultEntityId === expenseId,
  )

  const self = await call(
    cookies,
    "POST",
    `/api/approvals/${held!.id}/approve`,
    {
      decisionNote: "no",
    },
  )

  assert.equal(self.status, 403, JSON.stringify(self.body))

  assert.equal(self.body.error.code, "self_approval")
})

test("expenses: a rejected expense stays rejected and cannot be paid", async () => {
  const { cookies: maker } = await signIn("admin@deedorbit.com")

  const { cookies: checker } = await signIn("owner@deedorbit.com")

  const created = await call(maker, "POST", "/api/expenses", {
    category: "office",
    description: `Rejected spend ${uid()}`,
    amount: 400,
    occurredAt: "2031-04-03",
  })

  const expenseId = created.body.expense.id as string

  await call(maker, "POST", `/api/expenses/${expenseId}/submit`)

  const queue = await call(maker, "GET", "/api/approvals?status=pending")

  const held = rows(queue.body.approvals).find(
    (a) => a.actionKey === "expense" && a.resultEntityId === expenseId,
  )

  const rejected = await call(
    checker,

    "POST",

    `/api/approvals/${held!.id}/reject`,

    { decisionNote: "Missing invoice." },
  )

  assert.equal(rejected.status, 200, JSON.stringify(rejected.body))

  const read = await call(maker, "GET", `/api/expenses/${expenseId}`)

  assert.equal(read.body.expense.status, "rejected")

  const markPaid = await call(
    maker,
    "POST",
    `/api/expenses/${expenseId}/mark-paid`,
  )

  assert.equal(markPaid.status, 400, JSON.stringify(markPaid.body))
})

test("expenses: attachments enforce mime, size, and a two-per-expense cap", async () => {
  const { cookies } = await signIn("admin@deedorbit.com")

  const created = await call(cookies, "POST", "/api/expenses", {
    category: "project",
    description: `Attachment cap ${uid()}`,
    amount: 1500,
    occurredAt: "2031-04-04",
  })

  const expenseId = created.body.expense.id as string

  const badMime = await call(
    cookies,

    "POST",

    `/api/expenses/${expenseId}/attachments`,

    { filename: "notes.txt", dataUrl: dataUrl("text/plain", 8) },
  )

  assert.equal(badMime.status, 400, JSON.stringify(badMime.body))

  const oversize = await call(
    cookies,

    "POST",

    `/api/expenses/${expenseId}/attachments`,

    {
      filename: "huge.png",

      dataUrl: dataUrl("image/png", EXPENSE_ATTACHMENT_MAX_BYTES + 1),
    },
  )

  assert.equal(oversize.status, 400, JSON.stringify(oversize.body))

  const first = await call(
    cookies,

    "POST",

    `/api/expenses/${expenseId}/attachments`,

    { filename: "a.png", dataUrl: dataUrl("image/png", 16) },
  )

  assert.equal(first.status, 200, JSON.stringify(first.body))

  const second = await call(
    cookies,

    "POST",

    `/api/expenses/${expenseId}/attachments`,

    { filename: "b.pdf", dataUrl: dataUrl("application/pdf", 16) },
  )

  assert.equal(second.status, 200, JSON.stringify(second.body))

  const third = await call(
    cookies,

    "POST",

    `/api/expenses/${expenseId}/attachments`,

    { filename: "c.png", dataUrl: dataUrl("image/png", 16) },
  )

  assert.equal(third.status, 400, JSON.stringify(third.body))

  const detail = await call(cookies, "GET", `/api/expenses/${expenseId}`)

  assert.equal(rows(detail.body.attachments).length, 2)

  const removed = await call(
    cookies,

    "DELETE",

    `/api/expenses/${expenseId}/attachments/${first.body.attachmentId}`,
  )

  assert.equal(removed.status, 200, JSON.stringify(removed.body))

  const afterDelete = await call(cookies, "GET", `/api/expenses/${expenseId}`)

  assert.equal(rows(afterDelete.body.attachments).length, 1)
})

test("vendors: create + contract + invoice lands a positive ledger row", async () => {
  const { cookies } = await signIn("admin@deedorbit.com")

  const vendor = await call(cookies, "POST", "/api/vendors", {
    name: `Acme Supplies ${uid()}`,
    contactName: "Sam Acme",
    email: "ap@acme.test",
  })

  assert.equal(vendor.status, 200, JSON.stringify(vendor.body))

  const vendorId = vendor.body.vendor.id as string

  const contract = await call(
    cookies,

    "POST",

    `/api/vendors/${vendorId}/contracts`,

    {
      reference: `CT-${uid()}`,
      title: "Annual supply",
      value: 120000,
      startDate: "2031-01-01",
      endDate: "2031-12-31",
    },
  )

  assert.equal(contract.status, 200, JSON.stringify(contract.body))

  const invoice = await call(
    cookies,

    "POST",

    `/api/vendors/${vendorId}/invoices`,

    {
      reference: `INV-${uid()}`,
      amount: 5000,
      issuedAt: "2031-04-10",
      contractId: contract.body.contract.id,
    },
  )

  assert.equal(invoice.status, 200, JSON.stringify(invoice.body))

  assert.equal(invoice.body.invoice.status, "open")

  const ledger = await call(cookies, "GET", `/api/vendors/${vendorId}/ledger`)

  assert.equal(ledger.status, 200, JSON.stringify(ledger.body))

  const entries = rows(ledger.body.entries)

  const invoiceEntry = entries.find((e) => e.kind === "invoice")

  assert.ok(invoiceEntry, "the invoice should write a ledger row")

  assert.equal(invoiceEntry!.amount, 5000)

  assert.equal(invoiceEntry!.balanceAfter, 5000)

  assert.equal(ledger.body.balance, 5000)
})

test("vendors: a payment reduces the ledger and marks the invoice paid", async () => {
  const { cookies } = await signIn("admin@deedorbit.com")

  const vendor = await call(cookies, "POST", "/api/vendors", {
    name: `Paid Co ${uid()}`,
  })

  const vendorId = vendor.body.vendor.id as string

  const invoice = await call(
    cookies,

    "POST",

    `/api/vendors/${vendorId}/invoices`,

    { reference: `PINV-${uid()}`, amount: 6000, issuedAt: "2031-04-11" },
  )

  const invoiceId = invoice.body.invoice.id as string

  // A partial payment keeps the invoice open and adds a negative row.

  const partial = await call(
    cookies,

    "POST",

    `/api/vendors/${vendorId}/payments`,

    { invoiceId, amount: 2000, occurredAt: "2031-04-12" },
  )

  assert.equal(partial.status, 200, JSON.stringify(partial.body))

  const afterPartial = await call(
    cookies,
    "GET",
    `/api/vendors/${vendorId}/ledger`,
  )

  const paymentRows = rows(afterPartial.body.entries).filter(
    (e) => e.kind === "payment",
  )

  assert.equal(paymentRows.length, 1)

  assert.equal(paymentRows[0].amount, -2000)

  assert.equal(afterPartial.body.balance, 4000)

  const stillOpen = await call(
    cookies,

    "GET",

    `/api/vendors/${vendorId}/invoices?status=open`,
  )

  assert.equal(rows(stillOpen.body.invoices).length, 1)

  // Covering the remainder flips it to paid.

  await call(cookies, "POST", `/api/vendors/${vendorId}/payments`, {
    invoiceId,

    amount: 4000,

    occurredAt: "2031-04-13",
  })

  const invoices = await call(
    cookies,
    "GET",
    `/api/vendors/${vendorId}/invoices`,
  )

  const paidInvoice = rows(invoices.body.invoices).find(
    (i) => i.id === invoiceId,
  )

  assert.equal(paidInvoice!.status, "paid")

  const afterFull = await call(
    cookies,
    "GET",
    `/api/vendors/${vendorId}/ledger`,
  )

  assert.equal(afterFull.body.balance, 0)
})

test("vendors: voiding an open invoice writes an opposite adjustment", async () => {
  const { cookies } = await signIn("admin@deedorbit.com")

  const vendor = await call(cookies, "POST", "/api/vendors", {
    name: `Void Co ${uid()}`,
  })

  const vendorId = vendor.body.vendor.id as string

  const invoice = await call(
    cookies,

    "POST",

    `/api/vendors/${vendorId}/invoices`,

    { reference: `VINV-${uid()}`, amount: 3000, issuedAt: "2031-04-14" },
  )

  const invoiceId = invoice.body.invoice.id as string

  const voided = await call(
    cookies,

    "POST",

    `/api/vendors/${vendorId}/invoices/${invoiceId}/void`,
  )

  assert.equal(voided.status, 200, JSON.stringify(voided.body))

  assert.equal(voided.body.invoice.status, "void")

  const ledger = await call(cookies, "GET", `/api/vendors/${vendorId}/ledger`)

  const entries = rows(ledger.body.entries)

  // Both rows survive: the original invoice and an equal-and-opposite adjustment.

  const invoiceRow = entries.find((e) => e.kind === "invoice")

  const adjustmentRow = entries.find((e) => e.kind === "adjustment")

  assert.equal(invoiceRow!.amount, 3000)

  assert.equal(adjustmentRow!.amount, -3000)

  assert.equal(ledger.body.balance, 0)
})

test("journal: composed lines map through the chart of accounts", async () => {
  const { cookies } = await signIn("admin@deedorbit.com")

  const tenantId = getTenantIdForEmail("admin@deedorbit.com")

  // Map the office-expense source; leave vendor_payable unmapped on purpose.

  const mapped = await call(
    cookies,
    "PATCH",
    "/api/settings/chart-of-accounts",
    {
      mappings: [{ source: "expense_office", accountCode: "6100-OFC" }],
    },
  )

  assert.equal(mapped.status, 200, JSON.stringify(mapped.body))

  // One vendor invoice (payable side, unmapped) on a distinctive date.

  const vendor = await call(cookies, "POST", "/api/vendors", {
    name: `Journal Co ${uid()}`,
  })

  const vendorId = vendor.body.vendor.id as string

  const invoice = await call(
    cookies,

    "POST",

    `/api/vendors/${vendorId}/invoices`,

    { reference: `JINV-${uid()}`, amount: 5000, issuedAt: "2031-05-06" },
  )

  assert.equal(invoice.status, 200, JSON.stringify(invoice.body))

  // One paid office expense, inserted directly so the test isolates the range.

  const expenseId = `exp_journal_${uid()}`

  run(
    `INSERT INTO expenses (
        id, tenant_id, category, project_id, vendor_id, description, amount,
        currency, occurred_at, status, paid_at, created_by_user_id,
        created_by_name, created_at, updated_at
      ) VALUES (?, ?, 'office', NULL, NULL, ?, 3000, 'AED', ?, 'paid', ?, 'tester', 'Tester', ?, ?)`,
    expenseId,
    tenantId,
    "Journal office expense",
    "2031-05-06T00:00:00.000Z",
    "2031-05-06T00:00:00.000Z",
    "2031-05-06T00:00:00.000Z",
    "2031-05-06T00:00:00.000Z",
  )

  const journal = await call(
    cookies,

    "GET",

    "/api/journal?from=2031-05-06&to=2031-05-06",
  )

  assert.equal(journal.status, 200, JSON.stringify(journal.body))

  const lines = rows(journal.body.lines)

  const expenseLine = lines.find(
    (l) => l.sourceType === "expense" && l.sourceId === expenseId,
  )

  assert.ok(expenseLine, "the paid expense should appear as a journal line")

  assert.equal(expenseLine!.account, "6100-OFC")

  assert.equal(expenseLine!.unmapped, false)

  assert.equal(expenseLine!.debit, 3000)

  assert.equal(expenseLine!.credit, 0)

  const vendorLine = lines.find(
    (l) => l.sourceType === "vendor_ledger" && l.debit === 5000,
  )

  assert.ok(vendorLine, "the vendor invoice should appear as a debit line")

  // The payable source has no mapping, so the account stays blank and flagged.

  assert.equal(vendorLine!.account, "")

  assert.equal(vendorLine!.unmapped, true)

  // Every line carries exactly one non-zero side.

  for (const line of lines) {
    const debitOnly = line.debit > 0 && line.credit === 0

    const creditOnly = line.credit > 0 && line.debit === 0

    assert.ok(
      debitOnly || creditOnly,
      `line ${line.sourceId} must have one side`,
    )
  }

  const totals = rows(journal.body.totals)

  const officeTotal = totals.find((t) => t.account === "6100-OFC")

  assert.equal(officeTotal?.debit, 3000)
})

// ---------------------------------------------------------------------------

// Documents, Customer Portal, Support Tickets, Communications, Campaigns
//
// These five features stack on the shipped platform, so their fixtures are
// built the same way the platform builds records: one project, its structure
// node, a unit, two customers (the buyer under test and a decoy), and a
// confirmed booking apiece. Every suite calls `makeBusinessFixture()` for a
// fresh, uniquely-tagged set so nothing leaks between tests.
// ---------------------------------------------------------------------------

const { DOCUMENT_MAX_PER_ENTITY, DOCUMENT_MAX_BYTES } = await import(
  "../shared/documents.ts"
)

const { TICKET_SLA_HOURS } = await import("../shared/tickets.ts")

const { MESSAGE_CHANNELS, MESSAGE_LANGUAGES, TEMPLATE_KEYS, renderTemplate } =
  await import("../shared/communications.ts")

const FIXTURE_TENANT = "tn_deedorbit_holdings"

/** The seeded `customer@deedorbit.com` login (the eleventh demo user). */
const CUSTOMER_USER_ID = "usr_demo_11"

/** A tiny valid PNG body, base64-wrapped as the upload endpoints expect. */
const PNG_DATA_URL = `data:image/png;base64,${Buffer.from("deedorbit-pixel").toString("base64")}`

const PDF_DATA_URL = `data:application/pdf;base64,${Buffer.from("%PDF-1.4 test document").toString("base64")}`

let fixtureCounter = 0

function nowIso(): string {
  return new Date().toISOString()
}

function todayDate(): string {
  return new Date().toISOString().slice(0, 10)
}

function dateInDays(days: number): string {
  return new Date(Date.now() + days * 8_640_000).toISOString().slice(0, 10)
}

interface BusinessFixture {
  tag: string

  projectId: string

  nodeId: string

  unitId: string

  customerId: string

  otherCustomerId: string

  bookingId: string

  otherBookingId: string
}

/** Builds one isolated commercial record set the new features can hang off. */
function makeBusinessFixture(): BusinessFixture {
  const tag = `fx${(fixtureCounter += 1)}`

  const stamp = nowIso()

  const projectId = `prj_${tag}`

  run(
    `INSERT INTO projects (id, tenant_id, name, developer, location, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'on_sale', ?, ?)`,

    projectId,
    FIXTURE_TENANT,
    `Project ${tag}`,
    "DeedOrbit Development",
    "Dubai",
    stamp,
    stamp,
  )

  const nodeId = `nod_${tag}`

  run(
    `INSERT INTO project_structure_nodes (id, tenant_id, project_id, parent_id, kind, name, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, NULL, 'floor', ?, 0, ?, ?)`,

    nodeId,
    FIXTURE_TENANT,
    projectId,
    `Level ${tag}`,
    stamp,
    stamp,
  )

  const unitId = `unit_${tag}`

  run(
    `INSERT INTO inventory_units (id, tenant_id, project_id, structure_node_id, unit_code, unit_type, size_sqft, base_price, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'apartment', 1000, 900000, 'sold', ?, ?)`,

    unitId,
    FIXTURE_TENANT,
    projectId,
    nodeId,
    `U-${tag}`,
    stamp,
    stamp,
  )

  const customerId = `cus_${tag}`

  run(
    `INSERT INTO customers (id, tenant_id, full_name, phone, email, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,

    customerId,
    FIXTURE_TENANT,
    `Buyer ${tag}`,
    "+971500000000",
    `buyer.${tag}@example.com`,
    stamp,
    stamp,
  )

  const otherCustomerId = `cus2_${tag}`

  run(
    `INSERT INTO customers (id, tenant_id, full_name, phone, email, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,

    otherCustomerId,
    FIXTURE_TENANT,
    `Decoy Buyer ${tag}`,
    "+971500000001",
    `decoy.${tag}@example.com`,
    stamp,
    stamp,
  )

  run(
    `INSERT INTO bookings (id, tenant_id, project_id, unit_id, customer_id, reference, unit_code, customer_name, booking_amount, booking_date, status, terms, created_by_user_id, created_by_name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 900000, ?, 'confirmed', 'Standard payment terms.', 'usr_demo_04', 'Omar Haddad', ?, ?)`,

    `bkg_${tag}`,
    FIXTURE_TENANT,
    projectId,
    unitId,
    customerId,
    `BRK-${tag}`,
    `U-${tag}`,
    `Buyer ${tag}`,
    todayDate(),
    stamp,
    stamp,
  )

  run(
    `INSERT INTO bookings (id, tenant_id, project_id, unit_id, customer_id, reference, unit_code, customer_name, booking_amount, booking_date, status, terms, created_by_user_id, created_by_name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 900000, ?, 'confirmed', 'Standard payment terms.', 'usr_demo_04', 'Omar Haddad', ?, ?)`,

    `bkg2_${tag}`,
    FIXTURE_TENANT,
    projectId,
    unitId,
    otherCustomerId,
    `BRK2-${tag}`,
    `U-${tag}`,
    `Decoy Buyer ${tag}`,
    todayDate(),
    stamp,
    stamp,
  )

  return {
    tag,
    projectId,
    nodeId,
    unitId,
    customerId,
    otherCustomerId,
    bookingId: `bkg_${tag}`,
    otherBookingId: `bkg2_${tag}`,
  }
}

/** Adds a single unpaid instalment line to a booking, due on `dueDate`. */
function addPaymentSchedule(
  idTag: string,
  bookingId: string,
  dueDate: string,
): void {
  const stamp = nowIso()

  run(
    `INSERT INTO payment_plans (id, tenant_id, booking_id, currency, net_amount, down_payment_percent, charges, frequency, installment_count, balloon_amount, start_date, status, created_by_user_id, created_by_name, created_at, confirmed_at)
     VALUES (?, ?, ?, 'AED', 900000, 10, 0, 'monthly', 3, 0, ?, 'confirmed', 'usr_demo_07', 'Layla Aziz', ?, ?)`,

    `pln_${idTag}`,
    FIXTURE_TENANT,
    bookingId,
    dueDate,
    stamp,
    stamp,
  )

  run(
    `INSERT INTO payment_installments (id, tenant_id, plan_id, booking_id, number, kind, due_date, amount, charges, total, paid_amount, status)
     VALUES (?, ?, ?, ?, 1, 'installment', ?, 300000, 0, 300000, 0, 'scheduled')`,

    `ins_${idTag}`,
    FIXTURE_TENANT,
    `pln_${idTag}`,
    bookingId,
    dueDate,
  )
}

interface BinaryResult {
  status: number

  contentType: string | null

  text: string
}

/** The file/stream endpoints answer with bytes, not the JSON envelope `call` expects. */
async function fetchBinary(
  cookies: CookieJar,
  path: string,
): Promise<BinaryResult> {
  const response = await fetch(`${base}${path}`, {
    headers: { Cookie: cookies.header() },
  })

  const buffer = Buffer.from(await response.arrayBuffer())

  return {
    status: response.status,

    contentType: response.headers.get("content-type"),

    text: buffer.toString("utf8"),
  }
}

/** Unlinks every customer profile from the demo buyer so a portal test starts clean. */
function clearBuyerLinks(): void {
  run(
    `DELETE FROM customer_portal_links WHERE tenant_id = ? AND user_id = ?`,

    FIXTURE_TENANT,

    CUSTOMER_USER_ID,
  )
}

// --- documents --------------------------------------------------------------

test("documents file against every entity type and stream the stored bytes back", async () => {
  const fixture = makeBusinessFixture()

  const { cookies } = await signIn("owner@deedorbit.com")

  const targets = [
    { entityType: "project", entityId: fixture.projectId },
    { entityType: "unit", entityId: fixture.unitId },
    { entityType: "customer", entityId: fixture.customerId },
    { entityType: "booking", entityId: fixture.bookingId },
  ]

  const filedIds: Record<string, string> = {}

  for (const target of targets) {
    const uploaded = await call(cookies, "POST", "/api/documents", {
      entityType: target.entityType,

      entityId: target.entityId,

      docType: "other",

      title: `${target.entityType} file`,

      filename: `${target.entityType}.png`,

      dataUrl: PNG_DATA_URL,
    })

    assert.equal(
      uploaded.status,

      200,

      `upload to ${target.entityType}: ${JSON.stringify(uploaded.body)}`,
    )

    assert.equal(uploaded.body.document.entityType, target.entityType)

    filedIds[target.entityType] = uploaded.body.document.id
  }

  const list = await call(
    cookies,

    "GET",

    `/api/documents?entityType=booking&entityId=${fixture.bookingId}`,
  )

  assert.equal(list.status, 200)

  assert.ok(
    rows(list.body.documents).some((d) => d.id === filedIds.booking),

    "the booking document should list",
  )

  // Expiry round-trips through PATCH.
  const expiry = dateInDays(120)

  const patched = await call(
    cookies,

    "PATCH",

    `/api/documents/${filedIds.booking}`,

    { expiresAt: expiry },
  )

  assert.equal(patched.status, 200)

  assert.equal(patched.body.document.expiresAt, expiry)

  // The stream endpoint releases the stored bytes under their original mime.
  const pdfUpload = await call(cookies, "POST", "/api/documents", {
    entityType: "project",

    entityId: fixture.projectId,

    docType: "other",

    title: "Brochure",

    filename: "brochure.pdf",

    dataUrl: PDF_DATA_URL,
  })

  assert.equal(pdfUpload.status, 200)

  const streamed = await fetchBinary(
    cookies,

    `/api/documents/${pdfUpload.body.document.id}/file`,
  )

  assert.equal(streamed.status, 200)

  assert.equal(streamed.contentType, "application/pdf")

  assert.equal(streamed.text, "%PDF-1.4 test document")

  // Delete removes the row for good.
  const removed = await call(
    cookies,

    "DELETE",

    `/api/documents/${filedIds.project}`,
  )

  assert.equal(removed.status, 200)

  const afterDelete = await call(
    cookies,

    "GET",

    `/api/documents?entityType=project&entityId=${fixture.projectId}`,
  )

  assert.ok(
    !rows(afterDelete.body.documents).some((d) => d.id === filedIds.project),

    "the deleted document should no longer list",
  )
})

test("the per-type access gate keeps an ID copy away from a role without customers.edit", async () => {
  const fixture = makeBusinessFixture()

  const owner = (await signIn("owner@deedorbit.com")).cookies

  const filed = await call(owner, "POST", "/api/documents", {
    entityType: "customer",

    entityId: fixture.customerId,

    docType: "id_copy",

    title: "Passport copy",

    filename: "passport.png",

    dataUrl: PNG_DATA_URL,
  })

  assert.equal(filed.status, 200)

  const docId = filed.body.document.id

  // A sales agent holds documents.view but not customers.edit, so they may
  // neither file the ID copy, nor see it in a list, nor stream it.
  const agent = (await signIn("sales.agent@deedorbit.com")).cookies

  const deniedFile = await call(agent, "POST", "/api/documents", {
    entityType: "customer",

    entityId: fixture.customerId,

    docType: "id_copy",

    title: "Should not land",

    filename: "nope.png",

    dataUrl: PNG_DATA_URL,
  })

  assert.equal(deniedFile.status, 403)

  assert.equal(deniedFile.body.error.code, "permission_denied")

  const agentList = await call(
    agent,

    "GET",

    `/api/documents?entityType=customer&entityId=${fixture.customerId}`,
  )

  assert.equal(agentList.status, 200)

  assert.ok(
    !rows(agentList.body.documents).some((d) => d.id === docId),

    "the ID copy must be dropped from a list the caller cannot open",
  )

  const agentFile = await fetchBinary(agent, `/api/documents/${docId}/file`)

  assert.equal(agentFile.status, 403)
})

test("document uploads reject a bad mime and an oversized file, and cap the count per entity", async () => {
  const fixture = makeBusinessFixture()

  const { cookies } = await signIn("owner@deedorbit.com")

  const badMime = await call(cookies, "POST", "/api/documents", {
    entityType: "project",

    entityId: fixture.projectId,

    docType: "other",

    title: "Animated",

    filename: "clip.gif",

    dataUrl: `data:image/gif;base64,${Buffer.from("gifbytes").toString("base64")}`,
  })

  assert.equal(badMime.status, 400)

  // One byte past the stored cap, still inside the request envelope, fails the
  // size validator rather than the transport limit.
  const oversize = Buffer.alloc(DOCUMENT_MAX_BYTES + 1, 1).toString("base64")

  const tooBig = await call(cookies, "POST", "/api/documents", {
    entityType: "project",

    entityId: fixture.projectId,

    docType: "other",

    title: "Huge",

    filename: "huge.png",

    dataUrl: `data:image/png;base64,${oversize}`,
  })

  assert.equal(tooBig.status, 400)

  // Fill a fresh project to the cap, then prove the next one is refused.
  const capFixture = makeBusinessFixture()

  for (let i = 0; i < DOCUMENT_MAX_PER_ENTITY; i += 1) {
    const ok = await call(cookies, "POST", "/api/documents", {
      entityType: "project",

      entityId: capFixture.projectId,

      docType: "other",

      title: `Doc ${i}`,

      filename: `doc${i}.png`,

      dataUrl: PNG_DATA_URL,
    })

    assert.equal(ok.status, 200, `upload ${i} should succeed`)
  }

  const overflow = await call(cookies, "POST", "/api/documents", {
    entityType: "project",

    entityId: capFixture.projectId,

    docType: "other",

    title: "One too many",

    filename: "overflow.png",

    dataUrl: PNG_DATA_URL,
  })

  assert.equal(overflow.status, 400)
})

// --- customer portal --------------------------------------------------------

test("a buyer with no linked profile is refused every portal read", async () => {
  clearBuyerLinks()

  const { cookies } = await signIn("customer@deedorbit.com")

  for (const path of [
    "/api/portal/overview",

    "/api/portal/payments",

    "/api/portal/documents",

    "/api/portal/requests",
  ]) {
    const result = await call(cookies, "GET", path)

    assert.equal(result.status, 403, path)

    assert.equal(result.body.error.code, "portal_not_linked", path)
  }

  const raise = await call(cookies, "POST", "/api/portal/requests", {
    subject: "Anything",

    description: "Still refused",

    priority: "normal",
  })

  assert.equal(raise.status, 403)

  assert.equal(raise.body.error.code, "portal_not_linked")
})

test("a linked buyer reads only their own account across every portal surface", async () => {
  const fixture = makeBusinessFixture()

  addPaymentSchedule(`${fixture.tag}_own`, fixture.bookingId, dateInDays(5))

  addPaymentSchedule(
    `${fixture.tag}_oth`,
    fixture.otherBookingId,
    dateInDays(5),
  )

  const staff = (await signIn("sales.manager@deedorbit.com")).cookies

  const link = await call(
    staff,

    "PUT",

    `/api/customers/${fixture.customerId}/portal-access`,

    { userIds: [CUSTOMER_USER_ID] },
  )

  assert.equal(link.status, 200)

  const owner = (await signIn("owner@deedorbit.com")).cookies

  // A receipt is customer-visible, so the portal shows the buyer's own and
  // hides the decoy's, filed against a booking that is not theirs.
  for (const bookingId of [fixture.bookingId, fixture.otherBookingId]) {
    const filed = await call(owner, "POST", "/api/documents", {
      entityType: "booking",

      entityId: bookingId,

      docType: "receipt",

      title: `Receipt ${bookingId}`,

      filename: "receipt.png",

      dataUrl: PNG_DATA_URL,
    })

    assert.equal(filed.status, 200)
  }

  const buyer = (await signIn("customer@deedorbit.com")).cookies

  const overview = await call(buyer, "GET", "/api/portal/overview")

  assert.equal(overview.status, 200)

  const references = rows(overview.body.properties).map(
    (p) => p.bookingReference,
  )

  assert.ok(references.includes(`BRK-${fixture.tag}`))

  assert.ok(!references.includes(`BRK2-${fixture.tag}`), "decoy booking leaked")

  const payments = await call(buyer, "GET", "/api/portal/payments")

  assert.equal(payments.status, 200)

  const scheduleRefs = new Set(
    rows(payments.body.schedule).map((line) => line.bookingReference),
  )

  assert.ok(scheduleRefs.has(`BRK-${fixture.tag}`))

  assert.ok(!scheduleRefs.has(`BRK2-${fixture.tag}`), "decoy schedule leaked")

  const documents = await call(buyer, "GET", "/api/portal/documents")

  assert.equal(documents.status, 200)

  const docRefs = rows(documents.body.documents).map((d) => d.bookingReference)

  assert.ok(docRefs.includes(`BRK-${fixture.tag}`))

  assert.ok(!docRefs.includes(`BRK2-${fixture.tag}`), "decoy document leaked")

  clearBuyerLinks()
})

test("raising a portal request creates a staff ticket with a priority-derived SLA", async () => {
  clearBuyerLinks()

  const fixture = makeBusinessFixture()

  const staff = (await signIn("sales.manager@deedorbit.com")).cookies

  await call(
    staff,
    "PUT",
    `/api/customers/${fixture.customerId}/portal-access`,
    {
      userIds: [CUSTOMER_USER_ID],
    },
  )

  const buyer = (await signIn("customer@deedorbit.com")).cookies

  const raised = await call(buyer, "POST", "/api/portal/requests", {
    subject: "Handover timeline",

    description: "When is the unit ready for handover?",

    priority: "urgent",

    bookingId: fixture.bookingId,
  })

  assert.equal(raised.status, 200)

  const requestId = raised.body.requestId

  const stored = get<{
    status: string

    raised_by: string

    sla_due_by: string

    customer_id: string
  }>(
    `SELECT status, raised_by, sla_due_by, customer_id FROM support_tickets WHERE tenant_id = ? AND id = ?`,

    FIXTURE_TENANT,

    requestId,
  )

  assert.ok(stored, "the ticket row should exist")

  assert.equal(stored!.status, "open")

  assert.equal(stored!.raised_by, "customer")

  assert.equal(stored!.customer_id, fixture.customerId)

  const hours =
    (new Date(stored!.sla_due_by).getTime() - Date.now()) / 3_600_000

  assert.ok(
    hours > TICKET_SLA_HOURS.urgent - 1 &&
      hours <= TICKET_SLA_HOURS.urgent + 0.5,

    `expected an ~${TICKET_SLA_HOURS.urgent}h SLA, got ${hours.toFixed(2)}h`,
  )

  // The staff queue sees the buyer's ticket; the buyer cannot read the queue.
  const queue = await call(staff, "GET", "/api/tickets")

  assert.equal(queue.status, 200)

  assert.ok(rows(queue.body.tickets).some((t) => t.id === requestId))

  const buyerQueue = await call(buyer, "GET", "/api/tickets")

  assert.equal(buyerQueue.status, 403)

  // The buyer can read their own request detail and close it.
  const detail = await call(buyer, "GET", `/api/portal/requests/${requestId}`)

  assert.equal(detail.status, 200)

  assert.ok(rows<string>(detail.body.nextStatuses).includes("closed"))

  clearBuyerLinks()
})

// --- support tickets (staff) ------------------------------------------------

test("the staff queue walks a ticket from open through assignment to resolution", async () => {
  const fixture = makeBusinessFixture()

  const staff = (await signIn("sales.manager@deedorbit.com")).cookies

  const created = await call(staff, "POST", "/api/tickets", {
    customerId: fixture.customerId,

    subject: "Title deed query",

    description: "Please advise on the deed handover.",

    priority: "high",
  })

  assert.equal(created.status, 200)

  const ticketId = created.body.ticket.id

  assert.equal(created.body.ticket.status, "open")

  assert.equal(created.body.ticket.raisedBy, "staff")

  // Assigning an open ticket moves it into progress and records the owner.
  const assigned = await call(staff, "PATCH", `/api/tickets/${ticketId}`, {
    assigneeUserId: "usr_demo_03",
  })

  assert.equal(assigned.status, 200)

  assert.equal(assigned.body.ticket.status, "in_progress")

  assert.equal(assigned.body.ticket.assigneeUserId, "usr_demo_03")

  const comment = await call(
    staff,
    "POST",
    `/api/tickets/${ticketId}/comments`,
    {
      body: "Chasing the developer for the deed.",
    },
  )

  assert.equal(comment.status, 200)

  const attachment = await call(
    staff,

    "POST",

    `/api/tickets/${ticketId}/attachments`,

    { filename: "note.png", dataUrl: PNG_DATA_URL },
  )

  assert.equal(attachment.status, 200)

  const detail = await call(staff, "GET", `/api/tickets/${ticketId}`)

  assert.equal(detail.status, 200)

  assert.ok(
    rows(detail.body.comments).some(
      (c) => c.id === comment.body.commentId && c.authorKind === "staff",
    ),
  )

  assert.ok(
    rows(detail.body.attachments).some(
      (a) => a.id === attachment.body.attachmentId,
    ),
  )

  const streamed = await fetchBinary(
    staff,

    `/api/tickets/${ticketId}/attachments/${attachment.body.attachmentId}`,
  )

  assert.equal(streamed.status, 200)

  assert.equal(streamed.contentType, "image/png")

  const removed = await call(
    staff,

    "DELETE",

    `/api/tickets/${ticketId}/attachments/${attachment.body.attachmentId}`,
  )

  assert.equal(removed.status, 200)

  // Resolving stamps resolved_at; the state machine then refuses a reopen.
  const resolved = await call(staff, "PATCH", `/api/tickets/${ticketId}`, {
    status: "resolved",
  })

  assert.equal(resolved.status, 200)

  assert.equal(resolved.body.ticket.status, "resolved")

  assert.ok(
    resolved.body.ticket.resolvedAt,
    "resolution should stamp resolved_at",
  )

  const closed = await call(staff, "PATCH", `/api/tickets/${ticketId}`, {
    status: "closed",
  })

  assert.equal(closed.status, 200)

  const reopen = await call(staff, "PATCH", `/api/tickets/${ticketId}`, {
    status: "open",
  })

  assert.equal(reopen.status, 422, "a closed ticket cannot jump back to open")
})

// --- communications ---------------------------------------------------------

test("communication defaults seed, an edit persists, and preview reports the tokens", async () => {
  const admin = (await signIn("admin@deedorbit.com")).cookies

  const view = await call(admin, "GET", "/api/settings/communications")

  assert.equal(view.status, 200)

  assert.equal(
    rows(view.body.templates).length,

    MESSAGE_CHANNELS.length * TEMPLATE_KEYS.length * MESSAGE_LANGUAGES.length,
  )

  const saved = await call(
    admin,

    "PUT",

    "/api/settings/communications/template",

    {
      channel: "email",

      key: "receipt",

      body: "Custom receipt for {customer_name}.",

      enabled: true,
    },
  )

  assert.equal(saved.status, 200)

  const reread = await call(admin, "GET", "/api/settings/communications")

  const edited = rows(reread.body.templates).find(
    (t) =>
      t.channel === "email" &&
      t.templateKey === "receipt" &&
      t.language === "en",
  )

  assert.ok(edited, "the edited receipt template should be present")

  assert.equal(edited!.body, "Custom receipt for {customer_name}.")

  const preview = await call(
    admin,

    "POST",

    "/api/settings/communications/preview",

    { channel: "email", key: "receipt", context: { customer_name: "Aisha" } },
  )

  assert.equal(preview.status, 200)

  assert.ok(preview.body.text.includes("Aisha"))

  // The renderer substitutes known tokens, leaves an unknown brace in place,
  // and reports both a known-but-empty token and an unrecognised one.
  const rendered = renderTemplate(
    "Hi {customer_name}, you owe {due_amount} for {not_a_token}.",

    { customer_name: "Sam" },
  )

  assert.equal(rendered.text, "Hi Sam, you owe {due_amount} for {not_a_token}.")

  assert.deepEqual([...rendered.missingTokens].sort(), [
    "due_amount",
    "not_a_token",
  ])

  // A buyer holds no settings grant and is refused the whole surface.
  const buyer = (await signIn("customer@deedorbit.com")).cookies

  const denied = await call(buyer, "GET", "/api/settings/communications")

  assert.equal(denied.status, 403)
})

test("the reminder dry run renders a due instalment and performs no sends", async () => {
  const fixture = makeBusinessFixture()

  addPaymentSchedule(`${fixture.tag}_due`, fixture.bookingId, todayDate())

  const admin = (await signIn("admin@deedorbit.com")).cookies

  const templatesBefore = get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM message_templates WHERE tenant_id = ?`,

    FIXTURE_TENANT,
  )!.n

  const result = await call(
    admin,

    "GET",

    "/api/settings/communications/upcoming-reminders?days=3&channel=email",
  )

  assert.equal(result.status, 200)

  assert.equal(result.body.sent, false)

  const reminder = rows(result.body.reminders).find(
    (r) => r.bookingId === fixture.bookingId,
  )

  assert.ok(reminder, "the due instalment should render a reminder")

  assert.equal(reminder!.installmentNumber, 1)

  assert.ok(reminder!.body.length > 0)

  const templatesAfter = get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM message_templates WHERE tenant_id = ?`,

    FIXTURE_TENANT,
  )!.n

  assert.equal(
    templatesAfter,
    templatesBefore,
    "the dry run must not write templates",
  )
})

// --- campaigns --------------------------------------------------------------

test("campaign CRUD drives a public webhook, and rotation strands the old token", async () => {
  const staff = (await signIn("sales.manager@deedorbit.com")).cookies

  const created = await call(staff, "POST", "/api/campaigns", {
    name: "Marina Launch",

    channel: "social",

    source: "Marina Facebook",
  })

  assert.equal(created.status, 200)

  const campaignId = created.body.campaignId

  const token = created.body.webhookToken

  // The webhook needs no session; it lands a lead stamped with the campaign.
  const lead = await call(
    null,
    "POST",
    `/api/public/campaigns/${token}/leads`,
    {
      fullName: "Aisha Khan",

      phone: "+971500000009",

      email: "aisha@example.com",
    },
  )

  assert.equal(lead.status, 200)

  const storedLead = get<{
    tenant_id: string

    campaign_id: string

    status: string
  }>(
    `SELECT tenant_id, campaign_id, status FROM leads WHERE id = ?`,
    lead.body.leadId,
  )

  assert.ok(storedLead)

  assert.equal(storedLead!.campaign_id, campaignId)

  assert.equal(storedLead!.status, "new")

  assert.equal(storedLead!.tenant_id, FIXTURE_TENANT)

  const missingFields = await call(
    null,

    "POST",

    `/api/public/campaigns/${token}/leads`,

    { fullName: "No Phone" },
  )

  assert.equal(missingFields.status, 400)

  const unknownToken = await call(
    null,

    "POST",

    "/api/public/campaigns/cap_doesnotexist000000000/leads",

    { fullName: "X", phone: "+1" },
  )

  assert.equal(unknownToken.status, 404)

  const rotated = await call(
    staff,

    "POST",

    `/api/campaigns/${campaignId}/rotate-token`,

    {},
  )

  assert.equal(rotated.status, 200)

  const oldIsDead = await call(
    null,

    "POST",

    `/api/public/campaigns/${token}/leads`,

    { fullName: "X", phone: "+1" },
  )

  assert.equal(oldIsDead.status, 404, "the old token should no longer resolve")

  const newWorks = await call(
    null,

    "POST",

    `/api/public/campaigns/${rotated.body.webhookToken}/leads`,

    { fullName: "Fresh Lead", phone: "+1" },
  )

  assert.equal(newWorks.status, 200)

  // Archiving flips active off; the live token then refuses enquiries.
  const archived = await call(staff, "DELETE", `/api/campaigns/${campaignId}`)

  assert.equal(archived.status, 200)

  const inactive = await call(
    null,

    "POST",

    `/api/public/campaigns/${rotated.body.webhookToken}/leads`,

    { fullName: "X", phone: "+1" },
  )

  assert.equal(inactive.status, 403)

  assert.equal(inactive.body.error.code, "campaign_inactive")
})

test("campaign metrics trace leads through conversion to bookings", async () => {
  const fixture = makeBusinessFixture()

  const staff = (await signIn("sales.manager@deedorbit.com")).cookies

  const created = await call(staff, "POST", "/api/campaigns", {
    name: `Funnel ${fixture.tag}`,

    channel: "portal",
  })

  assert.equal(created.status, 200)

  const campaignId = created.body.campaignId

  const stamp = nowIso()

  // One converted lead whose customer holds a confirmed booking, one raw lead.
  run(
    `INSERT INTO leads (id, tenant_id, full_name, phone, source, campaign, status, campaign_id, customer_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'converted', ?, ?, ?, ?)`,

    `lead_${fixture.tag}_conv`,
    FIXTURE_TENANT,
    "Converted Lead",
    "+971500000002",
    "Funnel",
    `Funnel ${fixture.tag}`,
    campaignId,
    fixture.customerId,
    stamp,
    stamp,
  )

  run(
    `INSERT INTO leads (id, tenant_id, full_name, phone, source, campaign, status, campaign_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'new', ?, ?, ?)`,

    `lead_${fixture.tag}_raw`,
    FIXTURE_TENANT,
    "Raw Lead",
    "+971500000003",
    "Funnel",
    `Funnel ${fixture.tag}`,
    campaignId,
    stamp,
    stamp,
  )

  const list = await call(staff, "GET", "/api/campaigns")

  assert.equal(list.status, 200)

  const campaign = rows(list.body.campaigns).find((c) => c.id === campaignId)

  assert.ok(campaign, "the campaign should list with its metrics")

  assert.equal(campaign!.metrics.leads, 2)

  assert.equal(campaign!.metrics.converted, 1)

  assert.equal(campaign!.metrics.bookings, 1)

  assert.equal(campaign!.metrics.activeBookings, 1)

  assert.equal(campaign!.metrics.leadToBookingRate, 50)
})

// ---------------------------------------------------------------------------

// Reports, dashboard, global search & saved views
// ---------------------------------------------------------------------------

const { REPORT_IDS } = await import("../shared/reports.ts")

const { SAVED_VIEW_SCOPES } = await import("../shared/saved-views.ts")

const { AUDIT_MODULE_IDS } = await import("../shared/audit.ts")

/** Group keys the search route returns, mapped to the module that gates them. */

const SEARCH_GROUP_MODULE: Record<string, string> = {
  projects: "projects",

  units: "inventory",

  customers: "customers",

  bookings: "bookings",
}

// Named interfaces rather than inline generic object literals: `oxfmt` strips the
// member separators from a multi-member literal written on one line.

interface ReportSummaryRow {
  id: string

  label: string

  supportedFilters: unknown
}

interface ReportMetaRow {
  label: string

  value: string
}

interface SavedViewRow {
  id: string

  name: string

  state: string
}

interface ProjectRow {
  id: string

  name: string
}

interface SearchHitRow {
  id: string

  path: string
}

test("the reports catalog lists every report and the tenant's branches", async () => {
  const { cookies } = await signIn("admin@deedorbit.com")

  const catalog = await call(cookies, "GET", "/api/reports")

  assert.equal(catalog.status, 200)

  const summaries = rows<ReportSummaryRow>(
    catalog.body.reports,

    "reports",
  )

  assert.equal(summaries.length, REPORT_IDS.length)

  assert.deepEqual(
    summaries.map((entry) => entry.id).sort(),

    [...REPORT_IDS].sort(),
  )

  assert.ok(Array.isArray(catalog.body.branches), "branches should be an array")

  for (const summary of summaries) {
    assert.ok(summary.label, `${summary.id} is missing a label`)

    assert.ok(Array.isArray(summary.supportedFilters))
  }
})

test("every report id renders a well-formed result", async () => {
  const { cookies } = await signIn("admin@deedorbit.com")

  for (const id of REPORT_IDS) {
    const result = await call(cookies, "GET", `/api/reports/${id}`)

    assert.equal(
      result.status,
      200,
      `${id} should render: ${JSON.stringify(result.body)}`,
    )

    assert.equal(result.body.reportId, id)

    assert.ok(typeof result.body.title === "string" && result.body.title)

    assert.ok(rows(result.body.columns, `${id} columns`).length > 0)

    assert.ok(Array.isArray(result.body.rows), `${id} rows`)

    assert.ok(rows(result.body.meta, `${id} meta`).length > 0)
  }
})

test("an unknown report id is a 404, not an empty report", async () => {
  const { cookies } = await signIn("admin@deedorbit.com")

  const missing = await call(cookies, "GET", "/api/reports/does_not_exist")

  assert.equal(missing.status, 404)

  assert.equal(missing.body.error.code, "not_found")
})

test("the date filter narrows a report and echoes back in the meta", async () => {
  const { cookies } = await signIn("admin@deedorbit.com")

  const wide = await call(cookies, "GET", "/api/reports/sales")

  assert.equal(wide.status, 200)

  const wideRows = rows(wide.body.rows, "sales rows").length

  const narrow = await call(
    cookies,

    "GET",

    "/api/reports/sales?from=1900-01-01&to=1900-01-02",
  )

  assert.equal(narrow.status, 200)

  // An impossible window can only hold rows if the filter was ignored.

  assert.equal(rows(narrow.body.rows, "narrow rows").length, 0)

  assert.ok(rows(narrow.body.rows, "narrow rows").length <= wideRows)

  const period = rows<ReportMetaRow>(
    narrow.body.meta,

    "meta",
  ).find((line) => line.label === "Period")

  assert.equal(period?.value, "1900-01-01 → 1900-01-02")
})

test("a project filter is resolved into the report meta", async () => {
  const { cookies } = await signIn("admin@deedorbit.com")

  const projects = await call(cookies, "GET", "/api/projects")

  assert.equal(projects.status, 200)

  const list = rows<ProjectRow>(
    projects.body.projects,

    "projects",
  )

  if (list.length === 0) return

  const target = list[0]

  const filtered = await call(
    cookies,

    "GET",

    `/api/reports/sales?projectId=${encodeURIComponent(target.id)}`,
  )

  assert.equal(filtered.status, 200)

  const projectLine = rows<ReportMetaRow>(
    filtered.body.meta,

    "meta",
  ).find((line) => line.label === "Project")

  assert.ok(
    projectLine && projectLine.value !== "All projects",
    "the project filter should be reflected in the report meta",
  )
})

test("reports are closed to a role without reports.view", async () => {
  const { cookies } = await signIn("sales.agent@deedorbit.com")

  const catalog = await call(cookies, "GET", "/api/reports")

  assert.equal(catalog.status, 403)

  assert.equal(catalog.body.error.code, "permission_denied")

  assert.match(catalog.body.error.message, /reports\.view/)

  const one = await call(cookies, "GET", "/api/reports/sales")

  assert.equal(one.status, 403)
})

test("the dashboard summary returns KPIs and chart series", async () => {
  const { cookies } = await signIn("sales.agent@deedorbit.com")

  const summary = await call(cookies, "GET", "/api/dashboard/summary")

  assert.equal(summary.status, 200)

  assert.equal(summary.body.period, "12m")

  const kpis = record(summary.body.kpis, "kpis")

  for (const key of [
    "totalInventory",

    "sold",

    "available",

    "totalReceivables",

    "overdueAmount",

    "revenue",

    "expense",
  ]) {
    assert.ok(key in kpis, `kpis should carry ${key}`)
  }

  assert.ok(Array.isArray(kpis.topAgents))

  const charts = record(summary.body.charts, "charts")

  assert.ok(Array.isArray(charts.collectionsTrend))

  assert.ok(Array.isArray(charts.salesByProject))

  assert.ok(Array.isArray(charts.soldVsAvailable))
})

test("the dashboard period is validated and defaults to twelve months", async () => {
  const { cookies } = await signIn("admin@deedorbit.com")

  const short = await call(cookies, "GET", "/api/dashboard/summary?period=30d")

  assert.equal(short.status, 200)

  assert.equal(short.body.period, "30d")

  const bogus = await call(cookies, "GET", "/api/dashboard/summary?period=nope")

  assert.equal(bogus.status, 200)

  assert.equal(bogus.body.period, "12m")
})

test("a blank or too-short search query returns no groups", async () => {
  const { cookies } = await signIn("admin@deedorbit.com")

  const short = await call(cookies, "GET", "/api/search?q=a")

  assert.equal(short.status, 200)

  for (const group of Object.keys(SEARCH_GROUP_MODULE)) {
    assert.deepEqual(rows(short.body[group], group), [])
  }
})

test("global search returns hits for a term a viewer can open", async () => {
  const { cookies } = await signIn("admin@deedorbit.com")

  const projects = await call(cookies, "GET", "/api/projects")

  const list = rows<ProjectRow>(
    projects.body.projects,

    "projects",
  )

  if (list.length === 0) return

  const term = list[0].name.slice(0, 3)

  const found = await call(
    cookies,

    "GET",

    `/api/search?q=${encodeURIComponent(term)}`,
  )

  assert.equal(found.status, 200)

  const hits = rows<SearchHitRow>(found.body.projects, "projects")

  assert.ok(hits.length > 0, "a known project name should surface a hit")

  assert.ok(hits[0].path.startsWith("/projects/"))
})

test("search never returns a group the caller cannot view", async () => {
  const { cookies, session } = await signIn("sales.agent@deedorbit.com")

  const permissions = session.permissions as Record<string, boolean>

  const found = await call(cookies, "GET", "/api/search?q=a")

  // The short query returns nothing, so drive a real term across the fields.

  const broad = await call(cookies, "GET", "/api/search?q=e")

  assert.equal(broad.status, 200)

  void found

  for (const [group, module] of Object.entries(SEARCH_GROUP_MODULE)) {
    const hits = rows(broad.body[group], group)

    if (hits.length > 0) {
      assert.equal(
        permissions[`${module}.view`],

        true,

        `${group} results were returned without ${module}.view`,
      )
    }
  }
})

test("a saved view round-trips through create and list", async () => {
  const { cookies } = await signIn("admin@deedorbit.com")

  const scope = SAVED_VIEW_SCOPES[0]

  const name = `Roundtrip ${Date.now()}`

  const state = JSON.stringify({ status: "confirmed" })

  const created = await call(cookies, "POST", "/api/saved-views", {
    scope,

    name,

    state,
  })

  assert.equal(created.status, 200, JSON.stringify(created.body))

  assert.equal(created.body.ok, true)

  assert.equal(record(created.body.view, "view").scope, scope)

  const listed = await call(
    cookies,

    "GET",

    `/api/saved-views?scope=${encodeURIComponent(scope)}`,
  )

  assert.equal(listed.status, 200)

  const views = rows<SavedViewRow>(
    listed.body.views,

    "views",
  )

  const match = views.find((view) => view.name === name)

  assert.ok(match, "the new view should appear in the scoped list")

  assert.equal(match!.state, state)

  assert.equal(match!.id, created.body.view.id)
})

test("a duplicate saved-view name in the same scope conflicts", async () => {
  const { cookies } = await signIn("admin@deedorbit.com")

  const scope = "expenses"

  const name = `Dup ${Date.now()}`

  const first = await call(cookies, "POST", "/api/saved-views", {
    scope,

    name,

    state: JSON.stringify({ category: "marketing" }),
  })

  assert.equal(first.status, 200)

  const clash = await call(cookies, "POST", "/api/saved-views", {
    scope,

    name,

    state: JSON.stringify({ category: "office" }),
  })

  assert.equal(clash.status, 422)

  assert.equal(clash.body.error.code, "conflict")
})

test("saved-view validation rejects a bad scope, name, and state", async () => {
  const { cookies } = await signIn("admin@deedorbit.com")

  const badScope = await call(cookies, "POST", "/api/saved-views", {
    scope: "not-a-scope",

    name: "Whatever",

    state: "{}",
  })

  assert.equal(badScope.status, 400)

  const longName = await call(cookies, "POST", "/api/saved-views", {
    scope: "bookings",

    name: "x".repeat(61),

    state: "{}",
  })

  assert.equal(longName.status, 400)

  const badState = await call(cookies, "POST", "/api/saved-views", {
    scope: "bookings",

    name: `State ${Date.now()}`,

    state: "not json",
  })

  assert.equal(badState.status, 400)
})

test("saved views are isolated to the user who created them", async () => {
  const { cookies: owner } = await signIn("admin@deedorbit.com")

  const scope = "vendors"

  const name = `Private ${Date.now()}`

  const created = await call(owner, "POST", "/api/saved-views", {
    scope,

    name,

    state: JSON.stringify({ status: "active" }),
  })

  assert.equal(created.status, 200)

  const id = created.body.view.id

  const { cookies: other } = await signIn("sales.agent@deedorbit.com")

  const peek = await call(
    other,

    "GET",

    `/api/saved-views?scope=${encodeURIComponent(scope)}`,
  )

  assert.equal(peek.status, 200)

  const leaked = rows<{ id: string }>(peek.body.views, "views").some(
    (view) => view.id === id,
  )

  assert.ok(!leaked, "another user's saved view must not be visible")

  const steal = await call(other, "DELETE", `/api/saved-views/${id}`)

  assert.equal(steal.status, 404)

  const removed = await call(owner, "DELETE", `/api/saved-views/${id}`)

  assert.equal(removed.status, 200)

  assert.equal(removed.body.ok, true)

  const afterDelete = await call(
    owner,

    "GET",

    `/api/saved-views?scope=${encodeURIComponent(scope)}`,
  )

  const stillThere = rows<{ id: string }>(
    afterDelete.body.views,

    "views",
  ).some((view) => view.id === id)

  assert.ok(!stillThere, "the deleted view should be gone")
})

test("saved views require a signed-in caller", async () => {
  const anon = await call(null, "GET", "/api/saved-views?scope=bookings")

  assert.equal(anon.status, 401)
})

// ---------------------------------------------------------------------------

// Audit log
// ---------------------------------------------------------------------------

// Named interfaces rather than inline generic object literals: `oxfmt` strips the
// member separators from a multi-member literal written on one line.

interface AuditFacetRow {
  value: string

  label: string

  count: number
}

interface AuditEntryRow {
  id: string

  action: string

  module: string

  moduleLabel: string

  actorEmail: string | null

  createdAt: string
}

test("the audit log returns entries with the shape and facets the page needs", async () => {
  const { cookies } = await signIn("admin@deedorbit.com")

  const res = await call(cookies, "GET", "/api/audit-log")

  assert.equal(res.status, 200, JSON.stringify(res.body))

  assert.ok(Array.isArray(res.body.entries), "entries should be an array")

  assert.ok(
    Array.isArray(res.body.moduleFacets),
    "moduleFacets should be an array",
  )

  assert.ok(
    Array.isArray(res.body.actorFacets),
    "actorFacets should be an array",
  )

  assert.equal(typeof res.body.limit, "number")

  assert.equal(typeof res.body.truncated, "boolean")

  for (const entry of rows<AuditEntryRow>(res.body.entries, "entries")) {
    assert.ok(
      (AUDIT_MODULE_IDS as readonly string[]).includes(entry.module),
      `${entry.action} was tagged with an unknown module`,
    )

    assert.ok(entry.moduleLabel, `${entry.id} should carry a module label`)

    assert.ok(typeof entry.createdAt === "string" && entry.createdAt)
  }
})

test("an out-of-range date window returns no audit entries", async () => {
  const { cookies } = await signIn("admin@deedorbit.com")

  const narrow = await call(
    cookies,

    "GET",

    "/api/audit-log?from=1900-01-01&to=1900-01-02",
  )

  assert.equal(narrow.status, 200)

  assert.deepEqual(rows(narrow.body.entries, "entries"), [])

  // An unparseable bound is dropped rather than applied, so the window is
  // effectively open again — never a silent empty result.
  const bogus = await call(cookies, "GET", "/api/audit-log?from=not-a-date")

  assert.equal(bogus.status, 200)

  assert.ok(Array.isArray(bogus.body.entries))
})

test("the audit module filter keeps only that module", async () => {
  const { cookies } = await signIn("admin@deedorbit.com")

  const base = await call(cookies, "GET", "/api/audit-log")

  assert.equal(base.status, 200)

  const facets = rows<AuditFacetRow>(base.body.moduleFacets, "module facets")

  if (facets.length === 0) return

  const pick = facets[0]

  const filtered = await call(
    cookies,

    "GET",

    `/api/audit-log?module=${encodeURIComponent(pick.value)}`,
  )

  assert.equal(filtered.status, 200)

  const entries = rows<AuditEntryRow>(filtered.body.entries, "entries")

  assert.ok(entries.length > 0, `${pick.value} should have returned rows`)

  for (const entry of entries) {
    assert.equal(entry.module, pick.value)
  }
})

test("the audit actor filter keeps only that user", async () => {
  const { cookies } = await signIn("admin@deedorbit.com")

  const base = await call(cookies, "GET", "/api/audit-log")

  assert.equal(base.status, 200)

  const facets = rows<AuditFacetRow>(base.body.actorFacets, "actor facets")

  if (facets.length === 0) return

  const pick = facets[0]

  const filtered = await call(
    cookies,

    "GET",

    `/api/audit-log?actorEmail=${encodeURIComponent(pick.value)}`,
  )

  assert.equal(filtered.status, 200)

  const entries = rows<AuditEntryRow>(filtered.body.entries, "entries")

  assert.ok(entries.length > 0, `${pick.value} should have returned rows`)

  for (const entry of entries) {
    assert.equal(entry.actorEmail, pick.value)
  }
})

test("an unrecognised audit module is a 400, not an ignored filter", async () => {
  const { cookies } = await signIn("admin@deedorbit.com")

  const bad = await call(cookies, "GET", "/api/audit-log?module=not-a-module")

  assert.equal(bad.status, 400)

  assert.equal(bad.body.error.code, "bad_request")
})

test("a refused privileged action is readable in the audit log under its module", async () => {
  // A role without reports.view is denied, and the denial itself is audited as
  // `permission.denied.*`, which categorises into the `user` module.
  const { cookies: agent } = await signIn("sales.agent@deedorbit.com")

  const denied = await call(agent, "GET", "/api/reports")

  assert.equal(denied.status, 403)

  const { cookies: admin } = await signIn("admin@deedorbit.com")

  const res = await call(admin, "GET", "/api/audit-log?module=user")

  assert.equal(res.status, 200)

  const entries = rows<AuditEntryRow>(res.body.entries, "entries")

  assert.ok(
    entries.some((entry) => entry.action.startsWith("permission.denied")),
    "the permission denial should surface as an auditable event",
  )
})

test("the audit log is closed to a role without audit.view", async () => {
  const { cookies } = await signIn("sales.agent@deedorbit.com")

  const res = await call(cookies, "GET", "/api/audit-log")

  assert.equal(res.status, 403)

  assert.equal(res.body.error.code, "permission_denied")

  assert.match(res.body.error.message, /audit\.view/)
})

test("the audit log requires a signed-in caller", async () => {
  const anon = await call(null, "GET", "/api/audit-log")

  assert.equal(anon.status, 401)
})

// ---------------------------------------------------------------------------

// Notifications
// ---------------------------------------------------------------------------

const { NOTIFICATION_TYPES } = await import("../shared/notifications.ts")

interface NotificationRow {
  id: string

  type: string

  typeLabel: string

  title: string

  body: string | null

  linkPath: string | null

  channel: string

  actorName: string | null

  readAt: string | null

  createdAt: string
}

interface NotificationSettingRow {
  type: string

  label: string

  description: string

  channel: string
}

test("the notifications inbox returns the shape the bell and page need", async () => {
  const { cookies } = await signIn("admin@deedorbit.com")

  const res = await call(cookies, "GET", "/api/notifications")

  assert.equal(res.status, 200, JSON.stringify(res.body))

  assert.ok(Array.isArray(res.body.notifications), "notifications is an array")

  assert.equal(typeof res.body.unreadCount, "number")

  assert.equal(typeof res.body.limit, "number")

  assert.equal(typeof res.body.truncated, "boolean")

  for (const note of rows<NotificationRow>(
    res.body.notifications,
    "notifications",
  )) {
    assert.ok(
      (NOTIFICATION_TYPES as readonly string[]).includes(note.type),
      `${note.id} carries an unknown type`,
    )

    assert.ok(note.typeLabel, `${note.id} should carry a type label`)

    assert.ok(note.title, `${note.id} should carry a title`)

    assert.ok(typeof note.createdAt === "string" && note.createdAt)
  }
})

test("the notifications inbox requires a signed-in caller", async () => {
  const anon = await call(null, "GET", "/api/notifications")

  assert.equal(anon.status, 401)
})

test("an unrecognised notification type filter is a 400, not an ignored filter", async () => {
  const { cookies } = await signIn("admin@deedorbit.com")

  const bad = await call(cookies, "GET", "/api/notifications?type=not-a-type")

  assert.equal(bad.status, 400)

  assert.equal(bad.body.error.code, "bad_request")
})

test("marking an unknown notification read is a 404", async () => {
  const { cookies } = await signIn("admin@deedorbit.com")

  const missing = await call(
    cookies,

    "POST",

    "/api/notifications/does-not-exist/read",
  )

  assert.equal(missing.status, 404)
})

test("an approval request notifies approvers but not its requester, then reads back", async () => {
  const { cookies: admin } = await signIn("admin@deedorbit.com")

  await setApprovalPolicy(admin, "booking", true, 1000)

  const fixture = await bookableFixture(
    "Notify Approval Plot",

    "A-7701",

    "+971501117701",
  )

  const held = await call(fixture.manager, "POST", "/api/bookings", {
    projectId: fixture.projectId,

    unitId: fixture.unitId,

    customerId: fixture.customerId,

    bookingAmount: 250000,

    bookingDate: "2026-05-01",

    terms: "Held for sign-off.",
  })

  assert.equal(held.status, 200, JSON.stringify(held.body))

  const approvalId = held.body.approval.id

  // The approver's own inbox carries the request, unread.

  const inbox = await call(
    admin,

    "GET",

    "/api/notifications?type=approval_requested&limit=200",
  )

  assert.equal(inbox.status, 200, JSON.stringify(inbox.body))

  const hits = rows<NotificationRow>(
    inbox.body.notifications,

    "notifications",
  ).filter((note) => note.linkPath === `/approvals/${approvalId}`)

  assert.ok(
    hits.length > 0,
    "the approver should receive an approval_requested notification",
  )

  assert.ok(inbox.body.unreadCount >= 1, "a fresh request is unread")

  // The member who raised it is never notified of their own request.

  const own = await call(
    fixture.manager,

    "GET",

    "/api/notifications?type=approval_requested&limit=200",
  )

  const selfHits = rows<NotificationRow>(
    own.body.notifications,

    "notifications",
  ).filter((note) => note.linkPath === `/approvals/${approvalId}`)

  assert.equal(
    selfHits.length,
    0,
    "the requester should not be notified of their own request",
  )

  // Marking the single item read stamps a real timestamp.

  const marked = await call(
    admin,

    "POST",

    `/api/notifications/${hits[0].id}/read`,
  )

  assert.equal(marked.status, 200, JSON.stringify(marked.body))

  assert.ok(marked.body.readAt, "the read timestamp is recorded")

  // Mark-all sweeps the rest, and the unread filter comes back empty.

  const swept = await call(admin, "POST", "/api/notifications/read-all")

  assert.equal(swept.status, 200, JSON.stringify(swept.body))

  const afterUnread = await call(
    admin,

    "GET",

    "/api/notifications?read=unread&limit=200",
  )

  assert.equal(
    rows(afterUnread.body.notifications, "unread").length,
    0,
    "no unread items remain after marking all read",
  )
})

test("notification settings resolve every event with email honestly off", async () => {
  const { cookies } = await signIn("admin@deedorbit.com")

  const res = await call(cookies, "GET", "/api/notifications/settings")

  assert.equal(res.status, 200, JSON.stringify(res.body))

  const settings = rows<NotificationSettingRow>(
    res.body.settings,

    "settings",
  )

  assert.equal(settings.length, NOTIFICATION_TYPES.length)

  // There is no mail gateway wired, so email is never reported as connected.

  assert.equal(res.body.emailConnected, false)

  for (const setting of settings) {
    assert.ok((NOTIFICATION_TYPES as readonly string[]).includes(setting.type))

    assert.ok(["in_app", "email", "both", "off"].includes(setting.channel))
  }
})

test("notification settings round-trip a saved channel", async () => {
  const { cookies } = await signIn("admin@deedorbit.com")

  const saved = await call(cookies, "PUT", "/api/notifications/settings", {
    settings: { document_uploaded: "off" },
  })

  assert.equal(saved.status, 200, JSON.stringify(saved.body))

  const off = rows<NotificationSettingRow>(
    saved.body.settings,

    "settings",
  ).find((setting) => setting.type === "document_uploaded")

  assert.equal(off?.channel, "off")

  // Read it back to confirm it persisted.

  const reread = await call(cookies, "GET", "/api/notifications/settings")

  const persisted = rows<NotificationSettingRow>(
    reread.body.settings,

    "settings",
  ).find((setting) => setting.type === "document_uploaded")

  assert.equal(persisted?.channel, "off")
})

test("notification settings reject an unknown channel and an unknown type", async () => {
  const { cookies } = await signIn("admin@deedorbit.com")

  const badChannel = await call(cookies, "PUT", "/api/notifications/settings", {
    settings: { booking_confirmed: "carrier-pigeon" },
  })

  assert.equal(badChannel.status, 400)

  const badType = await call(cookies, "PUT", "/api/notifications/settings", {
    settings: { made_up_type: "email" },
  })

  assert.equal(badType.status, 400)
})

// ---------------------------------------------------------------------------

// Platform super admin
//
// The gate is the role *scope*, not a permission module: a tenant owner holds
// every module through `all: true`, so the owner must still be told these
// endpoints do not exist. The lifecycle tests exercise the machine the
// operator actually gets: current -> invoice -> due -> grace -> (expiry) ->
// suspend -> reactivate -> due -> payment.
// ---------------------------------------------------------------------------

const {
  BILLING_EVENT_KINDS,

  DERIVED_BILLING_STATUSES,
} = await import("../shared/platform.ts")

async function superAdminJar() {
  return (await signIn("superadmin@deedorbit.com")).cookies
}

test("the platform surface does not exist for tenant roles or anonymous callers", async () => {
  const { cookies } = await signIn("admin@deedorbit.com")

  // 404, not 403: the guard refuses to disclose the surface at all.

  assert.equal(
    (await call(cookies, "GET", "/api/platform/tenants")).status,
    404,
  )

  assert.equal(
    (
      await call(
        cookies,

        "POST",

        "/api/platform/tenants/tn_deedorbit_holdings/suspend",

        {},
      )
    ).status,

    404,
  )

  // The tenant owner holds every permission module through `all: true` and is
  // still locked out, which is why the gate is a role scope and not a module.

  const owner = await signIn("owner@deedorbit.com")

  assert.equal(
    (await call(owner.cookies, "GET", "/api/platform/tenants")).status,

    404,

    "a tenant owner must not reach the platform console",
  )

  assert.equal((await call(null, "GET", "/api/platform/tenants")).status, 401)
})

test("the operator directory lists every workspace with derived billing state", async () => {
  const cookies = await superAdminJar()

  const res = await call(cookies, "GET", "/api/platform/tenants")

  assert.equal(res.status, 200, JSON.stringify(res.body))

  const tenants = rows<PlatformTenantView>(res.body.tenants, "platform tenants")

  const byId = new Map(tenants.map((tenant) => [tenant.id, tenant]))

  const deedorbit = byId.get("tn_deedorbit_holdings")

  assert.ok(deedorbit, "the seeded flagship must be in the directory")

  assert.equal(deedorbit.billingStatus, "current")

  assert.equal(deedorbit.planLabel, "Enterprise")

  assert.equal(deedorbit.usage.users.limit, 250)

  assert.ok(deedorbit.revenueCollected >= 3 * 12000)

  const meridian = byId.get("tn_meridian_residences")

  assert.ok(meridian)

  assert.equal(meridian.status, "suspended")

  assert.equal(
    meridian.billingStatus,

    "grace_expired",

    "a grace window that closed reads as expired without any job flipping it",
  )

  const harbourline = byId.get("tn_harbourline_properties")

  assert.ok(harbourline)

  assert.equal(harbourline.status, "active")

  assert.equal(harbourline.billingStatus, "grace_expired")

  assert.ok(harbourline.outstanding > 0, "the unpaid invoice is still owed")

  for (const tenant of tenants) {
    assert.ok(
      (DERIVED_BILLING_STATUSES as readonly string[]).includes(
        tenant.billingStatus,
      ),

      `unexpected billing status ${tenant.billingStatus}`,
    )
  }

  const totals = record(res.body.totals, "platform totals")

  assert.equal(totals.workspaces, tenants.length)

  assert.equal(totals.active + totals.suspended, tenants.length)

  assert.ok(totals.needingAttention >= 1)

  // Money is never added across currencies: each total carries its own code.

  for (const entry of rows(record(totals, "totals").collectedByCurrency)) {
    assert.equal(typeof entry.currency, "string")

    assert.ok(entry.amount > 0)
  }
})

test("the workspace detail reads exactly as its recorded ledger", async () => {
  const cookies = await superAdminJar()

  const res = await call(
    cookies,
    "GET",
    "/api/platform/tenants/tn_harbourline_properties",
  )

  assert.equal(res.status, 200, JSON.stringify(res.body))

  const tenant = record(res.body.tenant, "platform tenant")

  const events = rows<PlatformBillingEventView>(
    res.body.events,
    "billing events",
  )

  assert.ok(events.length >= 4, "the seeded history exists")

  for (const [index, event] of events.entries()) {
    assert.ok(
      (BILLING_EVENT_KINDS as readonly string[]).includes(event.kind),

      `unknown event kind ${event.kind}`,
    )

    if (index > 0) {
      assert.ok(
        events[index - 1].createdAt >= event.createdAt,

        "the timeline is newest first",
      )
    }
  }

  const invoiced = events

    .filter((event) => event.kind === "invoice")

    .reduce((sum, event) => sum + (event.amount ?? 0), 0)

  const collected = events

    .filter((event) => event.kind === "payment")

    .reduce((sum, event) => sum + (event.amount ?? 0), 0)

  assert.equal(tenant.amountInvoiced, invoiced)

  assert.equal(tenant.revenueCollected, collected)

  assert.equal(tenant.outstanding, invoiced - collected)

  assert.equal(
    (await call(cookies, "GET", "/api/platform/tenants/tn_not_a_workspace"))
      .status,

    404,
  )
})

test("a fresh workspace walks the full billing lifecycle with refusals on the way", async () => {
  const signup = await call(jar(), "POST", "/api/auth/signup", {
    email: "ledger@example.com",

    fullName: "Lena Ledger",

    workspaceName: "Ledger Realty",

    password: "Ledger-Desk-2026",
  })

  assert.equal(signup.status, 200, JSON.stringify(signup.body))

  const tenantId = record(signup.body).tenant.id as string

  const cookies = await superAdminJar()

  const readDetail = async () =>
    record(
      (await call(cookies, "GET", `/api/platform/tenants/${tenantId}`)).body,

      "platform detail",
    )

  // A brand-new workspace is born paid-up: signup writes the subscription row.

  assert.equal((await readDetail()).tenant.billingStatus, "current")

  // Grace on nothing outstanding is theatre, so the server refuses it.

  assert.equal(
    (
      await call(
        cookies,

        "POST",

        `/api/platform/tenants/${tenantId}/grace`,

        { days: 5, reason: "too early for grace" },
      )
    ).status,

    400,
  )

  // An invoice with no amount defaults to the standard plan's list price.

  const invoice = await call(
    cookies,

    "POST",

    `/api/platform/tenants/${tenantId}/invoice`,

    {},
  )

  assert.equal(invoice.status, 200, JSON.stringify(invoice.body))

  assert.equal(record(invoice.body).tenant.amountInvoiced, 4500)

  const due = await call(
    cookies,

    "POST",

    `/api/platform/tenants/${tenantId}/due`,

    {},
  )

  assert.equal(due.status, 200, JSON.stringify(due.body))

  assert.equal(record(due.body).tenant.billingStatus, "due")

  assert.equal(
    (await call(cookies, "POST", `/api/platform/tenants/${tenantId}/due`, {}))
      .status,

    400,

    "an already-due workspace cannot be marked due twice",
  )

  // Grace input validation.

  assert.equal(
    (
      await call(
        cookies,

        "POST",

        `/api/platform/tenants/${tenantId}/grace`,

        { days: 0, reason: "no days at all" },
      )
    ).status,

    400,
  )

  assert.equal(
    (
      await call(
        cookies,

        "POST",

        `/api/platform/tenants/${tenantId}/grace`,

        { days: 5, reason: "abc" },
      )
    ).status,

    400,

    "a granted grace has to carry an explainable reason",
  )

  const grace = await call(
    cookies,

    "POST",

    `/api/platform/tenants/${tenantId}/grace`,

    { days: 7, reason: "wire transfer promised by Friday" },
  )

  assert.equal(grace.status, 200, JSON.stringify(grace.body))

  const granted = record(grace.body).tenant

  assert.equal(granted.billingStatus, "grace_active")

  assert.ok(new Date(granted.graceEndsAt).getTime() > Date.now())

  // The open window blocks the cut-off... and the due re-mark too.

  assert.equal(
    (
      await call(
        cookies,
        "POST",
        `/api/platform/tenants/${tenantId}/suspend`,
        {},
      )
    ).status,

    400,

    "suspension is refused while a grace window is running",
  )

  assert.equal(
    (await call(cookies, "POST", `/api/platform/tenants/${tenantId}/due`, {}))
      .status,

    400,
  )

  // Let the clock do what no cron would: backdate the window past its end.

  getDb()

    .prepare(
      "UPDATE tenant_subscriptions SET grace_ends_at = ? WHERE tenant_id = ?",
    )

    .run(new Date(Date.now() - 86_400_000).toISOString(), tenantId)

  assert.equal(
    (await readDetail()).tenant.billingStatus,

    "grace_expired",

    "the derived status flips at read time, not by a job",
  )

  // And a payment settles everything: back to current, grace cleared.

  const payment = await call(
    cookies,

    "POST",

    `/api/platform/tenants/${tenantId}/payment`,

    {},
  )

  assert.equal(payment.status, 200, JSON.stringify(payment.body))

  const settled = record(payment.body).tenant

  assert.equal(settled.billingStatus, "current")

  assert.equal(settled.outstanding, 0)

  assert.equal(settled.revenueCollected, 4500)

  // The operator's decisions are auditable under the actor's own workspace.

  const audit = await call(cookies, "GET", "/api/audit?limit=50")

  assert.equal(audit.status, 200, JSON.stringify(audit.body))

  const actions = rows(record(audit.body).entries).map((entry) => entry.action)

  assert.ok(actions.includes("platform.billing.grace_granted"))

  assert.ok(actions.includes("platform.billing.payment"))
})

test("suspension revokes tenant sessions but never locks the platform out", async () => {
  const ownerJar = jar()

  const signup = await call(ownerJar, "POST", "/api/auth/signup", {
    email: "quay@example.com",

    fullName: "Quay Owner",

    workspaceName: "Quay Partners",

    password: "Quay-Desk-2026",
  })

  assert.equal(signup.status, 200, JSON.stringify(signup.body))

  const tenantId = record(signup.body).tenant.id as string

  const cookies = await superAdminJar()

  // Nothing outstanding yet: suspension is refused before the money story

  // allows it, whatever the workspace's own mood.

  assert.equal(
    (
      await call(
        cookies,
        "POST",
        `/api/platform/tenants/${tenantId}/suspend`,
        {},
      )
    ).status,

    400,
  )

  const due = await call(
    cookies,

    "POST",

    `/api/platform/tenants/${tenantId}/due`,

    {},
  )

  assert.equal(due.status, 200)

  const suspend = await call(
    cookies,

    "POST",

    `/api/platform/tenants/${tenantId}/suspend`,

    { reason: "unpaid after the due date" },
  )

  assert.equal(suspend.status, 200, JSON.stringify(suspend.body))

  assert.equal(record(suspend.body).tenant.status, "suspended")

  // A suspension that left staff working would be theatre: their session is

  // revoked and a fresh sign-in is refused.

  assert.equal(
    (await call(ownerJar, "GET", "/api/auth/session")).body.authenticated,

    false,

    "the suspended workspace revoked its own staff sessions",
  )

  const refused = await call(jar(), "POST", "/api/auth/login", {
    email: "quay@example.com",

    password: "Quay-Desk-2026",
  })

  assert.equal(refused.status, 403)

  assert.equal(refused.body.error.code, "tenant_suspended")

  // Reactivating returns the workspace but not the write-off: billing comes

  // back due, and only a recorded payment settles it.

  const reactivate = await call(
    cookies,

    "POST",

    `/api/platform/tenants/${tenantId}/reactivate`,

    { note: "settlement agreed" },
  )

  assert.equal(reactivate.status, 200, JSON.stringify(reactivate.body))

  const back = record(reactivate.body).tenant

  assert.equal(back.status, "active")

  assert.equal(back.billingStatus, "due")

  const settled = await call(
    cookies,

    "POST",

    `/api/platform/tenants/${tenantId}/payment`,

    {},
  )

  assert.equal(settled.status, 200)

  assert.equal(record(settled.body).tenant.billingStatus, "current")
})

test("suspending the operator's own workspace neither revokes their session nor locks them out", async () => {
  const cookies = await superAdminJar()

  // The superadmin's membership lives inside tn_deedorbit_holdings, which this
  // test suspends. It runs last in the suite because the purge would revoke
  // every tenant-scoped session in that workspace.

  const due = await call(
    cookies,

    "POST",

    "/api/platform/tenants/tn_deedorbit_holdings/due",

    {},
  )

  assert.equal(due.status, 200, JSON.stringify(due.body))

  const suspend = await call(
    cookies,

    "POST",

    "/api/platform/tenants/tn_deedorbit_holdings/suspend",

    { reason: "self-lockout guard test" },
  )

  assert.equal(suspend.status, 200, JSON.stringify(suspend.body))

  assert.equal(record(suspend.body).tenant.status, "suspended")

  // The session that performed the suspension survives it: platform-scope

  // active roles are exempt from the purge, or the console that reverses a

  // suspension would be unreachable from inside one.

  assert.equal(
    (await call(cookies, "GET", "/api/auth/session")).body.authenticated,

    true,

    "the platform session must survive suspending its own workspace",
  )

  // And a fresh sign-in through the suspended workspace's door still lands,

  // because the login refusal is scoped to tenant-scope memberships.

  const relog = await call(jar(), "POST", "/api/auth/login", {
    email: "superadmin@deedorbit.com",

    password: DEMO_PASSWORD,
  })

  assert.equal(relog.status, 200, JSON.stringify(relog.body))

  assert.equal(relog.body.authenticated, true)

  // Restore the demo workspace exactly as the seed left it: active and paid.

  const reactivate = await call(
    cookies,

    "POST",

    "/api/platform/tenants/tn_deedorbit_holdings/reactivate",

    {},
  )

  assert.equal(reactivate.status, 200, JSON.stringify(reactivate.body))

  assert.equal(record(reactivate.body).tenant.billingStatus, "due")

  const settle = await call(
    cookies,

    "POST",

    "/api/platform/tenants/tn_deedorbit_holdings/payment",

    {},
  )

  assert.equal(settle.status, 200, JSON.stringify(settle.body))

  assert.equal(record(settle.body).tenant.status, "active")

  assert.equal(record(settle.body).tenant.billingStatus, "current")
})

test("plan changes move only between catalogue plans and never to the same one", async () => {
  const cookies = await superAdminJar()

  const samePlan = await call(
    cookies,

    "POST",

    "/api/platform/tenants/tn_harbourline_properties/plan",

    { plan: "starter" },
  )

  assert.equal(samePlan.status, 400, JSON.stringify(samePlan.body))

  assert.equal(
    (
      await call(
        cookies,

        "POST",

        "/api/platform/tenants/tn_harbourline_properties/plan",

        { plan: "unobtanium" },
      )
    ).status,

    400,

    "the plan column is free text; the catalogue is the contract",
  )

  const moved = await call(
    cookies,

    "POST",

    "/api/platform/tenants/tn_harbourline_properties/plan",

    { plan: "standard" },
  )

  assert.equal(moved.status, 200, JSON.stringify(moved.body))

  const tenant = record(moved.body).tenant

  assert.equal(tenant.planLabel, "Standard")

  assert.equal(tenant.usage.users.limit, 50, "limits follow the new plan")

  assert.equal(tenant.monthlyAmount, 4500)

  const detail = await call(
    cookies,

    "GET",

    "/api/platform/tenants/tn_harbourline_properties",
  )

  const events = rows(record(detail.body).events, "billing events")

  assert.equal(events[0].kind, "plan_change")

  // Leave the demo ledger as the seed wrote it.

  const restore = await call(
    cookies,

    "POST",

    "/api/platform/tenants/tn_harbourline_properties/plan",

    { plan: "starter" },
  )

  assert.equal(restore.status, 200, JSON.stringify(restore.body))
})

// ---------------------------------------------------------------------------

// Construction, procurement, signatures, integrations
// ---------------------------------------------------------------------------

/**
 * The four operational modules read back through the same black box as the
 * rest of the suite: statuses, codes, and the derived numbers the platform
 * promises (spend as a SUM, stock as a SUM, progress as a weighted mean) are
 * re-computed here from the stored rows, so a derivation that drifts from its
 * own definition fails loudly rather than agreeing with itself.
 */

interface SignedCeremonyView {
  envelope: Json

  me: Json

  chain: Json[]

  canSign: boolean

  documentDownloadPath: string | null
}

/** A phase's tagged spend, re-summed per currency straight from the rows. */

interface PhaseSpendSum {
  currency: string

  amount: number
}

/** `/sign/<token>?recipientId=<id>` -> the bare token. */

function signTokenOf(path: string): string {
  return path.slice("/sign/".length).split("?")[0] ?? ""
}

/**
 * Two earlier tests mutate shared state the operational sections read: the
 * password-reset test rotates the accounts desk's password, and the derived
 * figures test deletes every demo project — the cascade takes the build plan
 * with it, and the `ON DELETE SET NULL` spend links leave the seeded ledger
 * rows untagged. Re-establish the boot-level anchors before reading them. The
 * seed is `INSERT OR IGNORE` on fixed keys; the password restore touches only
 * the one user those tests deliberately changed; the tag re-assertion writes
 * back exactly what the seed defined and nothing else. Called once, at the head
 * of the section.
 */

function restoreOperationalFixtures(): void {
  seedOperationalModules()

  run(
    "UPDATE users SET password_hash = ? WHERE email = ?",

    hashPassword(DEMO_PASSWORD),

    "accounts@deedorbit.com",
  )

  run(
    "UPDATE expenses SET construction_phase_id = 'ph_demo_sub' WHERE id = 'exp_demo_sub'",
  )

  run(
    `UPDATE expenses
        SET construction_phase_id = 'ph_demo_sub', construction_task_id = 'ct_demo_ftg'
      WHERE id = 'exp_demo_ftg'`,
  )

  run(
    "UPDATE vendor_invoices SET construction_phase_id = 'ph_demo_sub' WHERE id IN ('vi_demo_sub', 'vi_demo_usd')",
  )
}

// --- Construction ------------------------------------------------------------

test("construction answers only to roles that hold the grant", async () => {
  restoreOperationalFixtures()

  const agent = (await signIn("sales.agent@deedorbit.com")).cookies

  const phases = await call(agent, "GET", "/api/construction/phases")

  assert.equal(phases.status, 403, JSON.stringify(phases.body))

  assert.equal(phases.body.error.code, "permission_denied")

  assert.match(phases.body.error.message, /construction\.view/)

  const agentWrite = await call(agent, "POST", "/api/construction/phases", {
    projectId: "proj_demo_marina",

    name: "Phantom phase",
  })

  assert.equal(agentWrite.status, 403, JSON.stringify(agentWrite.body))

  // A project manager owns the build plan but no seeded role holds
  // `construction.delete` — deletion is the owner's deliberate act.

  const manager = (await signIn("projects@deedorbit.com")).cookies

  const managerCreate = await call(
    manager,
    "POST",
    "/api/construction/phases",
    {
      projectId: "proj_demo_marina",

      name: "Test delete guard phase",
    },
  )

  assert.equal(managerCreate.status, 200, JSON.stringify(managerCreate.body))

  const createdId = record(managerCreate.body).phase.id as string

  const managerDelete = await call(
    manager,

    "DELETE",

    `/api/construction/phases/${createdId}`,
  )

  assert.equal(managerDelete.status, 403, JSON.stringify(managerDelete.body))

  const accounts = (await signIn("accounts@deedorbit.com")).cookies

  assert.equal(
    (await call(accounts, "GET", "/api/construction/phases")).status,
    200,
  )

  const accountsWrite = await call(
    accounts,
    "POST",
    "/api/construction/phases",
    {
      projectId: "proj_demo_marina",

      name: "Ledger-only phase",
    },
  )

  assert.equal(accountsWrite.status, 403, JSON.stringify(accountsWrite.body))

  // Cross-tenant ids read as missing, never as someone else's phase.

  const owner = (await signIn("owner@deedorbit.com")).cookies

  const foreign = await call(
    owner,
    "GET",
    "/api/construction/phases/ph_does_not_exist",
  )

  assert.equal(foreign.status, 404, JSON.stringify(foreign.body))

  // The manager's throwaway phase has to go before the next test counts rows.

  const cleanup = await call(
    owner,

    "DELETE",

    `/api/construction/phases/${createdId}`,
  )

  assert.equal(cleanup.status, 200, JSON.stringify(cleanup.body))
})

test("a phase's actuals are the SUM of tagged rows, and a foreign currency is never folded in", async () => {
  const { cookies } = await signIn("admin@deedorbit.com")

  const detail = record(
    (await call(cookies, "GET", "/api/construction/phases/ph_demo_sub")).body,
  )

  const phase = record(detail.phase)

  // Re-computed here from the stored rows — expenses in ('approved','paid')

  // plus vendor invoices not void, tagged to the phase or one of its tasks —

  // grouped per currency, because the point of the derivation is that no

  // second book of money exists.

  const sums = all<PhaseSpendSum>(
    `SELECT currency, SUM(amount) AS amount FROM (
        SELECT e.currency AS currency, e.amount AS amount FROM expenses e
          WHERE e.status IN ('approved', 'paid')
            AND (e.construction_phase_id = 'ph_demo_sub'
              OR e.construction_task_id IN (
                SELECT id FROM construction_tasks WHERE phase_id = 'ph_demo_sub'))
          UNION ALL
        SELECT v.currency AS currency, v.amount AS amount FROM vendor_invoices v
          WHERE v.status <> 'void'
            AND (v.construction_phase_id = 'ph_demo_sub'
              OR v.construction_task_id IN (
                SELECT id FROM construction_tasks WHERE phase_id = 'ph_demo_sub')))
      GROUP BY currency`,
  )

  const byCurrency = new Map(
    sums.map((row) => [row.currency, Number(row.amount)]),
  )

  assert.equal(phase.budgetCurrency, "AED")

  assert.equal(phase.budgetAmount, 500000000)

  const actual = rows<Json>(phase.actualByCurrency, "actualByCurrency")

  assert.equal(
    actual.length,
    1,
    "only the budget currency lands in the actuals",
  )

  assert.equal(actual[0].currency, "AED")

  assert.equal(
    actual[0].amount,

    byCurrency.get("AED"),

    "the view's actual equals the SUM of tagged rows in the budget currency",
  )

  assert.equal(actual[0].amount, 230000000)

  const foreign = rows<Json>(phase.foreignActuals, "foreignActuals")

  assert.equal(foreign.length, 1, "the USD invoice is shown, never summed")

  assert.equal(foreign[0].currency, "USD")

  assert.equal(foreign[0].amount, byCurrency.get("USD"))

  assert.equal(phase.variance, 500000000 - 230000000)

  assert.equal(detail.canEdit, true)

  // Progress is the task mean with milestones weighted double: (100 + 2*60 +

  // 30) / 4 = 62.5 -> 63. The manual figure exists but never speaks here.

  assert.equal(phase.progressMode, "derived")

  assert.equal(phase.derivedProgress, 63)

  assert.equal(phase.progress, 63)

  assert.equal(phase.taskCount, 3)

  assert.equal(phase.milestoneCount, 1)

  assert.equal(phase.milestoneDoneCount, 0)

  rows(detail.tasks, "tasks")

  rows(detail.progressLog, "progress log")
})

test("a task's movement is the phase's progress", async () => {
  const { cookies } = await signIn("admin@deedorbit.com")

  const before = record(
    (await call(cookies, "GET", "/api/construction/phases/ph_demo_sub")).body
      .phase,
  )

  assert.equal(before.progress, 63)

  const raised = await call(
    cookies,

    "PATCH",

    "/api/construction/tasks/ct_demo_ftg",

    { progress: 80 },
  )

  assert.equal(raised.status, 200, JSON.stringify(raised.body))

  assert.equal(record(raised.body).task.progress, 80)

  const after = record(
    (await call(cookies, "GET", "/api/construction/phases/ph_demo_sub")).body
      .phase,
  )

  assert.equal(after.derivedProgress, 73, "(100 + 2*80 + 30) / 4")

  assert.equal(after.progressMode, "derived")

  const agent = (await signIn("sales.agent@deedorbit.com")).cookies

  const refused = await call(
    agent,

    "PATCH",

    "/api/construction/tasks/ct_demo_ftg",

    { progress: 10 },
  )

  assert.equal(refused.status, 403, JSON.stringify(refused.body))

  // Put the demo build back exactly as the seed wrote it.

  const restored = await call(
    cookies,

    "PATCH",

    "/api/construction/tasks/ct_demo_ftg",

    { progress: 60 },
  )

  assert.equal(restored.status, 200)

  const same = record(
    (await call(cookies, "GET", "/api/construction/phases/ph_demo_sub")).body
      .phase,
  )

  assert.equal(same.progress, 63)
})

test("logging progress without tasks sets the manual figure, and the log keeps the history", async () => {
  const { cookies } = await signIn("admin@deedorbit.com")

  const created = await call(cookies, "POST", "/api/construction/phases", {
    projectId: "proj_demo_marina",

    name: "Progress log phase",
  })

  assert.equal(created.status, 200, JSON.stringify(created.body))

  const phaseId = record(record(created.body).phase).id as string

  const bad = await call(
    cookies,

    "POST",

    `/api/construction/phases/${phaseId}/log-progress`,

    { percent: 140 },
  )

  assert.equal(bad.status, 400, JSON.stringify(bad.body))

  assert.equal(bad.body.error.code, "bad_request")

  const logged = await call(
    cookies,

    "POST",

    `/api/construction/phases/${phaseId}/log-progress`,

    { percent: 35, note: "Site team's first count" },
  )

  assert.equal(logged.status, 200, JSON.stringify(logged.body))

  const phase = record(record(logged.body).phase)

  assert.equal(
    phase.progressMode,
    "manual",
    "no tasks: the manager's figure speaks",
  )

  assert.equal(phase.progress, 35)

  assert.equal(phase.manualProgress, 35)

  const detail = record(
    (await call(cookies, "GET", `/api/construction/phases/${phaseId}`)).body,
  )

  const log = rows<Json>(detail.progressLog, "progress log")

  assert.equal(log.length, 1)

  assert.equal(log[0].percent, 35)

  assert.equal(log[0].note, "Site team's first count")

  // Add a task and the derivation takes over: the stored manual figure stays,

  // but the displayed progress is the tasks' weighted mean.

  const task = await call(
    cookies,

    "POST",

    `/api/construction/phases/${phaseId}/tasks`,

    {
      name: "Set out the core wall",
      milestone: true,
      contractorId: "con_demo_sub",
    },
  )

  assert.equal(task.status, 200, JSON.stringify(task.body))

  const after = record(
    (await call(cookies, "GET", `/api/construction/phases/${phaseId}`)).body
      .phase,
  )

  assert.equal(after.progressMode, "derived")

  assert.equal(after.progress, 0)

  assert.equal(after.derivedProgress, 0)

  assert.equal(after.manualProgress, 35)

  assert.equal(after.taskCount, 1)

  assert.equal(after.milestoneCount, 1)

  const anonymous = await call(
    jar(),
    "DELETE",
    `/api/construction/phases/${phaseId}`,
  )

  assert.equal(anonymous.status, 401, "the guard refuses an anonymous delete")
})

test("a phase that carries tagged spend cannot be deleted; an empty one can", async () => {
  const owner = (await signIn("owner@deedorbit.com")).cookies

  const held = await call(
    owner,

    "DELETE",

    "/api/construction/phases/ph_demo_sub",
  )

  assert.equal(held.status, 400, JSON.stringify(held.body))

  assert.match(held.body.error.message, /tagged spend/)

  // The refusal must not have taken anything with it.

  assert.equal(
    get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM construction_phases WHERE id = 'ph_demo_sub'",
    )?.n,

    1,
  )

  const created = await call(owner, "POST", "/api/construction/phases", {
    projectId: "proj_demo_marina",

    name: "Throwaway phase",
  })

  assert.equal(created.status, 200, JSON.stringify(created.body))

  const phaseId = record(record(created.body).phase).id as string

  const removed = await call(
    owner,
    "DELETE",
    `/api/construction/phases/${phaseId}`,
  )

  assert.equal(removed.status, 200, JSON.stringify(removed.body))

  assert.equal(
    get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM construction_phases WHERE id = ?",

      phaseId,
    )?.n,

    0,
  )

  // And the demo phase can be *archived* by status — the plan's answer to a

  // phase that carries money but no longer needs attention.

  const archived = await call(
    owner,

    "PATCH",

    "/api/construction/phases/ph_demo_sup",

    { status: "on_hold" },
  )

  assert.equal(archived.status, 200, JSON.stringify(archived.body))

  assert.equal(record(record(archived.body).phase).status, "on_hold")

  const restored = await call(
    owner,

    "PATCH",

    "/api/construction/phases/ph_demo_sup",

    { status: "pending" },
  )

  assert.equal(restored.status, 200)
})

// --- Procurement -------------------------------------------------------------

test("the purchase trail answers only to roles that hold the grant", async () => {
  const agent = (await signIn("sales.agent@deedorbit.com")).cookies

  const blocked = await call(agent, "GET", "/api/procurement/materials")

  assert.equal(blocked.status, 403, JSON.stringify(blocked.body))

  assert.match(blocked.body.error.message, /procurement\.view/)

  // The finance desk signs requisitions off but never raises one.

  const accounts = (await signIn("accounts@deedorbit.com")).cookies

  const cannotCreate = await call(
    accounts,
    "POST",
    "/api/procurement/requisitions",
    {
      justification: "Ledger desk cannot raise",
      lines: [{ description: "x", quantity: 1, unit: "each", unitPrice: 1 }],
    },
  )

  assert.equal(cannotCreate.status, 403, JSON.stringify(cannotCreate.body))

  // The procurement desk raises, but has no seat at the approvals queue.

  const officer = (await signIn("procurement@deedorbit.com")).cookies

  const canCreate = await call(
    officer,
    "POST",
    "/api/procurement/requisitions",
    {
      justification: "Site hoarding for the north boundary",
      projectId: "proj_demo_marina",
      currency: "AED",
      lines: [
        {
          description: "Hoarding panels",
          quantity: 12,
          unit: "each",
          unitPrice: 80000,
        },
      ],
    },
  )

  assert.equal(canCreate.status, 200, JSON.stringify(canCreate.body))

  const reqId = record(record(canCreate.body).requisition).id as string

  const cannotApprove = await call(
    officer,
    "POST",
    "/api/approvals/appr_none/approve",
    {},
  )

  assert.equal(cannotApprove.status, 403, JSON.stringify(cannotApprove.body))

  // Leave no orphan: an approved requisition is the only one that converts, so
  // a draft simply stands as demo state and is read back for the reference.

  const refetched = record(
    record(
      (await call(officer, "GET", `/api/procurement/requisitions/${reqId}`))
        .body,
    ).requisition,
  )

  assert.match(refetched.reference, /^PRQ-\d{4}$/)
})

test("a requisition is raised by one desk and cleared by another", async () => {
  const admin = (await signIn("admin@deedorbit.com")).cookies

  const created = await call(admin, "POST", "/api/procurement/requisitions", {
    justification: "Cement for the podium deck",
    projectId: "proj_demo_marina",
    phaseId: "ph_demo_sub",
    currency: "AED",
    lines: [
      {
        description: "Portland Cement 50kg",
        quantity: 100,
        unit: "bag",
        unitPrice: 1200,
      },
    ],
  })

  assert.equal(created.status, 200, JSON.stringify(created.body))

  const req = record(record(created.body).requisition)

  assert.equal(req.status, "draft")

  assert.match(req.reference, /^PRQ-\d{4}$/)

  assert.equal(req.estimatedAmount, 120000)

  const submitted = await call(
    admin,

    "POST",

    `/api/procurement/requisitions/${req.id}/submit`,
  )

  assert.equal(submitted.status, 200, JSON.stringify(submitted.body))

  const sub = record(record(submitted.body).requisition)

  assert.equal(sub.status, "submitted")

  const approvalId = sub.approvalId as string

  assert.ok(approvalId, "submitting must hold an approval request")

  // Maker-checker: the desk that raised the requisition cannot sign it off.

  const selfApprove = await call(
    admin,

    "POST",

    `/api/approvals/${approvalId}/approve`,

    { decisionNote: "I raised it" },
  )

  assert.equal(selfApprove.status, 403, JSON.stringify(selfApprove.body))

  assert.equal(selfApprove.body.error.code, "self_approval")

  // A different entitlement — the finance desk — clears it, and the replay

  // lands the requisition as approved.

  const accounts = (await signIn("accounts@deedorbit.com")).cookies

  const approved = await call(
    accounts,

    "POST",

    `/api/approvals/${approvalId}/approve`,

    { decisionNote: "Within budget" },
  )

  assert.equal(approved.status, 200, JSON.stringify(approved.body))

  const reloaded = record(
    record(
      (await call(admin, "GET", `/api/procurement/requisitions/${req.id}`))
        .body,
    ).requisition,
  )

  assert.equal(reloaded.status, "approved")

  // Once decided, the requisition is no longer editable from the draft path.

  const editAfter = await call(
    admin,

    "PATCH",

    `/api/procurement/requisitions/${req.id}`,

    { justification: "Too late to change" },
  )

  assert.equal(editAfter.status, 422, JSON.stringify(editAfter.body))

  assert.equal(editAfter.body.error.code, "conflict")
})

test("a purchase order number comes from the numbering settings and advances", async () => {
  const admin = (await signIn("admin@deedorbit.com")).cookies

  const makePo = async (): Promise<Json> => {
    const response = await call(
      admin,
      "POST",
      "/api/procurement/purchase-orders",
      {
        vendorId: "ven_demo_alnoor",

        projectId: "proj_demo_marina",

        currency: "AED",

        lines: [
          {
            description: "Test line",
            quantity: 2,
            unit: "each",
            unitPrice: 500,
          },
        ],
      },
    )

    assert.equal(response.status, 200, JSON.stringify(response.body))

    return record(record(response.body).purchaseOrder)
  }

  const first = await makePo()

  const second = await makePo()

  assert.match(first.poNumber, /^PO-\d{4}$/)

  const sequenceOf = (number: string) => Number(number.slice(3))

  assert.equal(sequenceOf(second.poNumber), sequenceOf(first.poNumber) + 1)

  // The seed's demo PO is a hard-coded number, not a draw from this sequence —

  // proof the counter is settings-driven rather than copied from the demo.

  assert.notEqual(first.poNumber, "PO-0901")
})

test("material stock is the SUM of movements, and a missing target is a dash", async () => {
  const admin = (await signIn("admin@deedorbit.com")).cookies

  const list = await call(admin, "GET", "/api/procurement/materials")

  assert.equal(list.status, 200, JSON.stringify(list.body))

  const materials = rows(record(list.body).materials)

  const cement = materials.find((material) => material.id === "mat_cement")

  assert.ok(cement, "cement is seeded")

  // Re-derived from the ledger here, so the endpoint's own figure is checked

  // against the definition it claims to implement.

  const fromLedger = Number(
    get<{ s: number }>(
      "SELECT COALESCE(SUM(quantity), 0) AS s FROM stock_movements WHERE material_id = 'mat_cement'",
    )?.s ?? 0,
  )

  assert.equal(Number(cement.currentStock), fromLedger)

  assert.equal(cement.belowTarget, fromLedger < Number(cement.targetStock))

  const gloves = materials.find((material) => material.id === "mat_gloves")

  assert.ok(gloves, "gloves are seeded")

  assert.equal(gloves.targetStock, null)

  // With no target there is nothing to fall short of: a dash, never a warning.

  assert.equal(gloves.belowTarget, false)

  const glovesBefore = Number(
    get<{ s: number }>(
      "SELECT COALESCE(SUM(quantity), 0) AS s FROM stock_movements WHERE material_id = 'mat_gloves'",
    )?.s ?? 0,
  )

  const adjusted = await call(
    admin,

    "POST",

    "/api/procurement/materials/mat_gloves/adjust",

    { type: "adjustment", quantity: 40, note: "Opening count" },
  )

  assert.equal(adjusted.status, 200, JSON.stringify(adjusted.body))

  assert.equal(
    Number(record(record(adjusted.body).material).currentStock),

    glovesBefore + 40,
  )

  // A receipt cannot be minted from this door — that is a GRN's job.

  const badType = await call(
    admin,

    "POST",

    "/api/procurement/materials/mat_gloves/adjust",

    { type: "receipt", quantity: 5 },
  )

  assert.equal(badType.status, 400, JSON.stringify(badType.body))
})

test("a goods receipt moves stock and raises the payable in one transaction", async () => {
  const admin = (await signIn("admin@deedorbit.com")).cookies

  const accounts = (await signIn("accounts@deedorbit.com")).cookies

  const po = record(
    record(
      (
        await call(admin, "POST", "/api/procurement/purchase-orders", {
          vendorId: "ven_demo_alnoor",

          projectId: "proj_demo_marina",

          currency: "AED",

          lines: [
            {
              description: "Portland Cement 50kg",

              materialId: "mat_cement",

              quantity: 30,

              unit: "bag",

              unitPrice: 1000,
            },
          ],
        })
      ).body,
    ).purchaseOrder,
  )

  const poId = po.id as string

  const poLineId = rows(po.lines)[0].id as string

  await call(admin, "POST", `/api/procurement/purchase-orders/${poId}/submit`)

  const approval = get<{ id: string }>(
    "SELECT id FROM approvals WHERE action_key = 'purchase_order' AND result_entity_id = ?",

    poId,
  )

  assert.ok(approval, "submitting a PO must hold an approval request")

  const approved = await call(
    accounts,

    "POST",

    `/api/approvals/${approval.id}/approve`,

    { decisionNote: "Approved" },
  )

  assert.equal(approved.status, 200, JSON.stringify(approved.body))

  const sent = record(
    record(
      (
        await call(
          admin,
          "POST",
          `/api/procurement/purchase-orders/${poId}/send`,
        )
      ).body,
    ).purchaseOrder,
  )

  assert.equal(sent.status, "sent")

  const cementBefore = Number(
    get<{ s: number }>(
      "SELECT COALESCE(SUM(quantity), 0) AS s FROM stock_movements WHERE material_id = 'mat_cement'",
    )?.s ?? 0,
  )

  const grn = await call(
    admin,

    "POST",

    `/api/procurement/purchase-orders/${poId}/receipts`,

    { createInvoice: true, lines: [{ poLineId, quantity: 30 }] },
  )

  assert.equal(grn.status, 200, JSON.stringify(grn.body))

  const invoice = record(grn.body).invoice

  assert.ok(invoice, "createInvoice must raise a payable")

  assert.equal(Number(record(invoice).amount), 30000)

  // The receipt wrote exactly its quantity into the material's ledger.

  const cementAfter = Number(
    get<{ s: number }>(
      "SELECT COALESCE(SUM(quantity), 0) AS s FROM stock_movements WHERE material_id = 'mat_cement'",
    )?.s ?? 0,
  )

  assert.equal(cementAfter, cementBefore + 30)

  // Fully received, and the three-way match columns agree at the PO's prices.

  const poAfter = record(
    record(
      (await call(admin, "GET", `/api/procurement/purchase-orders/${poId}`))
        .body,
    ).purchaseOrder,
  )

  assert.equal(poAfter.status, "received")

  assert.equal(Number(poAfter.totalAmount), 30000)

  assert.equal(Number(poAfter.receivedValue), 30000)

  assert.equal(Number(poAfter.invoicedValue), 30000)

  // The payable is an ordinary vendor invoice: it shows on the vendor ledger.

  const ledger = await call(admin, "GET", "/api/vendors/ven_demo_alnoor/ledger")

  assert.equal(ledger.status, 200, JSON.stringify(ledger.body))

  const entries = rows(record(ledger.body).entries)

  assert.ok(
    entries.some(
      (entry) =>
        entry.sourceType === "goods_receipt" &&
        entry.invoiceId === record(invoice).id,
    ),

    "the GRN payable appears on the vendor ledger",
  )
})

test("the seeded PO's three-way match reads ordered, received, and invoiced", async () => {
  const admin = (await signIn("admin@deedorbit.com")).cookies

  const detail = record(
    (await call(admin, "GET", "/api/procurement/purchase-orders/po_demo_1"))
      .body,
  )

  const po = record(detail.purchaseOrder)

  assert.equal(po.poNumber, "PO-0901")

  // Ordered = the PO total; received = GRN quantities at the PO prices; invoiced

  // = the live payable tagged to the order. All three are 500,600,000 minor.

  assert.equal(Number(po.totalAmount), 500600000)

  assert.equal(Number(po.receivedValue), 500600000)

  assert.equal(Number(po.invoicedValue), 500600000)

  assert.equal(rows(detail.receipts).length, 1)

  assert.equal(rows(detail.invoices).length, 1)
})

// --- Documents & signatures --------------------------------------------------

test("the signature desk answers only to roles that hold the grant", async () => {
  // Accounts has no seat at the signature module at all.

  const accounts = (await signIn("accounts@deedorbit.com")).cookies

  const blocked = await call(accounts, "GET", "/api/signatures/envelopes")

  assert.equal(blocked.status, 403, JSON.stringify(blocked.body))

  assert.match(blocked.body.error.message, /signatures\.view/)

  // A sales agent may put an envelope out, but releasing a template is above it.

  const agent = (await signIn("sales.agent@deedorbit.com")).cookies

  const draft = await call(agent, "POST", "/api/signatures/templates", {
    name: "Agent draft template",

    category: "noc",

    body: "No objection re {{unitCode}}.",
  })

  assert.equal(draft.status, 200, JSON.stringify(draft.body))

  const templateId = record(draft.body).id as string

  const release = await call(
    agent,

    "POST",

    `/api/signatures/templates/${templateId}/release`,
  )

  assert.equal(release.status, 403, JSON.stringify(release.body))

  assert.match(release.body.error.message, /signatures\.approve/)
})

test("the signing ceremony runs without a session and files the agreement", async () => {
  const admin = (await signIn("admin@deedorbit.com")).cookies

  const created = await call(admin, "POST", "/api/signatures/envelopes", {
    title: "Countersignature test",

    message: "Please review and sign.",

    projectId: "proj_demo_marina",

    body: "The undersigned agree to the terms of this test.",

    recipients: [
      {
        name: "First Signer",

        email: "one@example.invalid",

        role: "signer",

        signOrder: 1,
      },
      {
        name: "Second Signer",

        email: "two@example.invalid",

        role: "signer",

        signOrder: 2,
      },
      {
        name: "Witness",

        email: "cc@example.invalid",

        role: "cc",

        signOrder: 3,
      },
    ],
  })

  assert.equal(created.status, 200, JSON.stringify(created.body))

  const envelopeId = record(record(created.body).envelope).id as string

  const sent = await call(
    admin,

    "POST",

    `/api/signatures/envelopes/${envelopeId}/send`,
  )

  assert.equal(sent.status, 200, JSON.stringify(sent.body))

  const links = rows(record(sent.body).links)

  // Only signers receive a link; a cc is never given one.

  assert.equal(links.length, 2)

  const token = signTokenOf(links[0].path as string)

  const ceremony = await call<SignedCeremonyView>(
    null,

    "GET",

    `/api/sign/${token}?recipientId=${links[0].recipientId}`,
  )

  assert.equal(ceremony.status, 200, JSON.stringify(ceremony.body))

  assert.equal(ceremony.body.canSign, true)

  assert.equal(
    record(ceremony.body.me).status,

    "opened",

    "first open marks the signer opened",
  )

  // A cc recipient cannot sign, even with a live token.

  const chain = rows(
    record(
      record(
        (await call(admin, "GET", `/api/signatures/envelopes/${envelopeId}`))
          .body,
      ).envelope,
    ).recipients,
  )

  const ccRecipient = chain.find((recipient) => recipient.role === "cc")

  assert.ok(ccRecipient, "a cc recipient exists in the chain")

  const ccId = ccRecipient.id as string

  const ccTry = await call(null, "POST", `/api/sign/${token}/sign`, {
    recipientId: ccId,

    action: "sign",

    fullName: "Witness Will",
  })

  assert.equal(ccTry.status, 403, JSON.stringify(ccTry.body))

  assert.equal(ccTry.body.error.code, "cc_cannot_sign")

  // The first signer signs — the envelope is still open while the second waits.

  const firstSign = await call(null, "POST", `/api/sign/${token}/sign`, {
    recipientId: links[0].recipientId,

    action: "sign",

    fullName: "First Signer",
  })

  assert.equal(firstSign.status, 200, JSON.stringify(firstSign.body))

  assert.equal(record(firstSign.body).status, "sent")

  assert.equal(record(firstSign.body).completedDocumentId, null)

  // The last signer signs — the envelope completes and files the agreement.

  const secondSign = await call(null, "POST", `/api/sign/${token}/sign`, {
    recipientId: links[1].recipientId,

    action: "sign",

    fullName: "Second Signer",
  })

  assert.equal(secondSign.status, 200, JSON.stringify(secondSign.body))

  assert.equal(record(secondSign.body).status, "completed")

  const documentId = record(secondSign.body).completedDocumentId as string

  assert.ok(documentId, "completion returns the filed document id")

  assert.ok(
    get<{ id: string }>("SELECT id FROM documents WHERE id = ?", documentId),

    "the completed agreement is written back into documents",
  )

  // Re-signing a closed envelope is refused, not silently ignored.

  const again = await call(null, "POST", `/api/sign/${token}/sign`, {
    recipientId: links[0].recipientId,

    action: "sign",

    fullName: "First Signer",
  })

  assert.equal(again.status, 422, JSON.stringify(again.body))
})

test("voiding an envelope kills its signing token", async () => {
  const admin = (await signIn("admin@deedorbit.com")).cookies

  const created = record(
    record(
      (
        await call(admin, "POST", "/api/signatures/envelopes", {
          title: "Void test",

          projectId: "proj_demo_marina",

          body: "This envelope is about to be withdrawn.",

          recipients: [
            {
              name: "Solo",

              email: "solo@example.invalid",

              role: "signer",

              signOrder: 1,
            },
          ],
        })
      ).body,
    ).envelope,
  )

  const sent = record(
    (
      await call(
        admin,

        "POST",

        `/api/signatures/envelopes/${created.id}/send`,
      )
    ).body,
  )

  const link = rows(sent.links)[0]

  const token = signTokenOf(link.path as string)

  const live = await call(
    null,

    "GET",

    `/api/sign/${token}?recipientId=${link.recipientId}`,
  )

  assert.equal(live.status, 200, JSON.stringify(live.body))

  const voided = await call(
    admin,

    "POST",

    `/api/signatures/envelopes/${created.id}/void`,

    { reason: "Withdrawn by sender" },
  )

  assert.equal(voided.status, 200, JSON.stringify(voided.body))

  assert.equal(record(record(voided.body).envelope).status, "void")

  // The token no longer resolves to anything — the door is shut.

  const dead = await call(null, "GET", `/api/sign/${token}`)

  assert.equal(dead.status, 404, JSON.stringify(dead.body))

  // A completed envelope is beyond voiding — reuse the seeded one.

  const voidCompleted = await call(
    admin,

    "POST",

    "/api/signatures/envelopes/env_signed/void",

    { reason: "too late" },
  )

  assert.equal(voidCompleted.status, 422, JSON.stringify(voidCompleted.body))
})

// --- Settings: integrations --------------------------------------------------

test("integrations answers only to the settings grant", async () => {
  const agent = (await signIn("sales.agent@deedorbit.com")).cookies

  const blocked = await call(agent, "GET", "/api/settings/integrations")

  assert.equal(blocked.status, 403, JSON.stringify(blocked.body))

  assert.match(blocked.body.error.message, /settings\.view/)

  // The open surface has no session at all — only a bearer key reaches it.

  const anon = await fetch(`${base}/api/open/leads`)

  assert.equal(anon.status, 401)
})

test("an API key reveals its plaintext once and only its prefix afterwards", async () => {
  const admin = (await signIn("admin@deedorbit.com")).cookies

  const created = await call(
    admin,

    "POST",

    "/api/settings/integrations/api-keys",

    { label: "Test reader key" },
  )

  assert.equal(created.status, 200, JSON.stringify(created.body))

  const token = record(created.body).token as string

  assert.ok(token.startsWith("iv_"), "the plaintext key is shown once")

  const view = record(created.body).apiKey

  assert.equal(view.prefix, token.slice(0, 8))

  // The list carries the display prefix and nothing that looks like the secret.

  const panel = record(
    (await call(admin, "GET", "/api/settings/integrations")).body,
  )

  const listed = rows(panel.apiKeys).find((key) => key.id === view.id)

  assert.ok(listed, "the new key is listed")

  assert.equal(listed.prefix, token.slice(0, 8))

  assert.equal(listed.token, undefined)

  assert.ok(
    !JSON.stringify(listed).includes(token),

    "no plaintext leaks into the list",
  )

  // A live key authenticates the one read-only surface, tenant from the key.

  const open = await fetch(`${base}/api/open/leads`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  assert.equal(open.status, 200)

  assert.ok(Array.isArray(((await open.json()) as Json).leads))

  // An unknown key is refused outright.

  const bad = await fetch(`${base}/api/open/leads`, {
    headers: { Authorization: "Bearer iv_not_a_real_key" },
  })

  assert.equal(bad.status, 401)

  // Revoked, the same key is a real credential that no longer works — 403.

  const revoked = await call(
    admin,

    "POST",

    `/api/settings/integrations/api-keys/${view.id}/revoke`,
  )

  assert.equal(revoked.status, 200, JSON.stringify(revoked.body))

  const after = await fetch(`${base}/api/open/leads`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  assert.equal(after.status, 403)

  const afterBody = (await after.json()) as Json

  assert.equal(afterBody.error.code, "api_key_revoked")
})

test("webhook dispatch makes a real POST and records what the receiver said", async () => {
  const { createServer } = await import("node:http")

  const { deliverToEndpoint, loadEndpointRow } = await import("./webhooks.ts")

  const admin = (await signIn("admin@deedorbit.com")).cookies

  // A local sink stands in for the subscriber, exactly like the app server.

  const sink = createServer((request, response) => {
    request.resume()

    response.writeHead(200, { "content-type": "application/json" })

    response.end('{"ok":true}')
  })

  await new Promise<void>((resolve) => sink.listen(0, "127.0.0.1", resolve))

  const port = (sink.address() as AddressInfo).port

  try {
    const created = await call(
      admin,

      "POST",

      "/api/settings/integrations/webhooks",

      {
        url: `http://127.0.0.1:${port}/hook`,

        events: ["lead_created"],
      },
    )

    assert.equal(created.status, 200, JSON.stringify(created.body))

    const body = record(created.body)

    const endpoint = record(body.endpoint)

    assert.ok(endpoint.secret, "the signing secret is returned once on create")

    const row = loadEndpointRow("tn_deedorbit_holdings", endpoint.id as string)

    assert.ok(row)

    await deliverToEndpoint(
      row,

      "lead_created",

      { event: "lead_created", source: "test" },

      false,
    )

    const deliveries = await call(
      admin,

      "GET",

      "/api/settings/integrations/deliveries?event=lead_created",
    )

    assert.equal(deliveries.status, 200, JSON.stringify(deliveries.body))

    const mine = rows(record(deliveries.body).deliveries).find(
      (delivery) => delivery.endpointId === endpoint.id,
    )

    assert.ok(mine, "the attempt is written to the delivery log")

    assert.equal(mine.status, "success")

    assert.equal(Number(mine.httpStatus), 200)

    assert.equal(mine.isTest, false)
  } finally {
    await new Promise<void>((resolve, reject) =>
      sink.close((error) => (error ? reject(error) : resolve())),
    )
  }
})

test("five consecutive failures auto-pause an endpoint", async () => {
  const { deliverToEndpoint, loadEndpointRow } = await import("./webhooks.ts")

  const admin = (await signIn("admin@deedorbit.com")).cookies

  // An unroutable address fails fast and for real — no receiver to answer.

  const created = record(
    record(
      (
        await call(
          admin,

          "POST",

          "/api/settings/integrations/webhooks",

          {
            url: "https://example.invalid/webhooks/probe",

            events: ["booking_created"],
          },
        )
      ).body,
    ).endpoint,
  )

  const endpointId = created.id as string

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const row = loadEndpointRow("tn_deedorbit_holdings", endpointId)

    assert.ok(row)

    await deliverToEndpoint(
      row,

      "booking_created",

      { event: "booking_created", attempt },

      false,
    )
  }

  const panel = record(
    (await call(admin, "GET", "/api/settings/integrations")).body,
  )

  const paused = rows(panel.endpoints).find(
    (endpoint) => endpoint.id === endpointId,
  )

  assert.ok(paused)

  assert.equal(paused.status, "paused")

  assert.equal(Number(paused.consecutiveFailures), 5)

  assert.match(String(paused.pauseReason), /^auto:/)

  // A test delivery never counts toward the streak: resume, then test once.

  const resumed = await call(
    admin,

    "PATCH",

    `/api/settings/integrations/webhooks/${endpointId}`,

    { status: "active" },
  )

  assert.equal(resumed.status, 200, JSON.stringify(resumed.body))

  const testRun = await call(
    admin,

    "POST",

    `/api/settings/integrations/webhooks/${endpointId}/test`,
  )

  assert.equal(testRun.status, 200, JSON.stringify(testRun.body))

  const still = rows(
    record((await call(admin, "GET", "/api/settings/integrations")).body)
      .endpoints,
  ).find((endpoint) => endpoint.id === endpointId)

  assert.ok(still)

  // The failed test did not push it back to paused — tests never count.

  assert.equal(still.status, "active")
})
