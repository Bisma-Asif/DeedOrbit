/**
 * Role permission tests.
 *
 * The access model has three layers, and each is proved here at the layer where
 * it actually lives:
 *
 *   1. The catalogue-to-database contract. Every role × module × action the
 *      product ships is resolved through `can()` and compared to the documented
 *      platform defaults (`defaultGrants`). This is the whole 11 × 22 × 6 matrix —
 *      "every module and action" in the literal sense — and it catches any drift
 *      between the seed and the registry.
 *
 *   2. Precedence. A per-tenant override must win over the platform default in
 *      both directions (grant a denial, deny a grant), then revert cleanly.
 *
 *   3. Enforcement. The HTTP guard must apply the model, not just agree with it.
 *      For a curated set of real routes — a read route for every one of the 22
 *      modules plus create/edit/delete/approve routes across the surface — each
 *      of the ten tenant-scoped roles is driven through `requirePermission`, and
 *      the response is 403 `permission_denied` if and only if `can()` denies. The
 *      guard runs before body parsing, so the boundary is a pure permission check.
 *
 * Two behaviours the guard does not express as a single module.action are tested
 * on their own terms: the inventory `change_status` gate (gated apart from `edit`),
 * and an approval-required action (a booking held over threshold, refused to its
 * own maker, cleared by a different entitled approver).
 *
 * Nothing here changes app behaviour; it asserts the contract the code documents.
 */

import { test, before, after } from "node:test"

import assert from "node:assert/strict"

import {
  ACTIONS,
  MODULES,
  ROLES,
  defaultGrants,
  permissionId,
} from "../shared/access.ts"

import {
  TENANT_A,
  bootstrap,
  call,
  can,
  invalidateGrantCache,
  makeBookingFrame,
  run,
  setApprovalPolicy,
  signInAsRole,
  unitStatus,
} from "./test-harness.ts"

import type { CookieJar, Json } from "./test-harness.ts"

let close: () => void

// Every tenant-scoped role, each backed by a real member of the demo workspace.

const TENANT_ROLES = [
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
]

const roleJars = new Map<string, CookieJar>()

before(async () => {
  close = (await bootstrap()).close

  for (const role of TENANT_ROLES) {
    const { cookies } = await signInAsRole(role, role)

    roleJars.set(role, cookies)
  }
})

after(() => {
  close?.()
})

// ---------------------------------------------------------------------------

// 1. The full catalogue matrix resolves exactly as documented

// ---------------------------------------------------------------------------

test("every role's grants match the platform default catalogue across all modules and actions", () => {
  const expected = new Map<string, Set<string>>(
    defaultGrants().map((grant) => [
      grant.roleId,
      new Set(grant.permissionIds),
    ]),
  )

  for (const role of ROLES) {
    const want = expected.get(role.id)

    assert.ok(want, `no default grant set for role ${role.id}`)

    for (const module of MODULES) {
      for (const action of ACTIONS) {
        const allowed = can(TENANT_A, role.id, module, action)

        assert.equal(
          allowed,

          want.has(permissionId(module, action)),

          `${role.id} ${module}.${action}: resolver disagreed with the catalogue`,
        )
      }
    }
  }
})

// ---------------------------------------------------------------------------

// 2. Per-tenant overrides win over the platform default

// ---------------------------------------------------------------------------

test("a per-tenant override takes precedence over the platform default, both ways", () => {
  const stamp = new Date().toISOString()

  const override = (permissionIdArg: string, effect: "allow" | "deny") => {
    run(
      `INSERT INTO role_permission_overrides (
          tenant_id, role_id, permission_id, effect, updated_at, updated_by
        ) VALUES (?, 'sales_agent', ?, ?, ?, NULL)
        ON CONFLICT (tenant_id, role_id, permission_id)
        DO UPDATE SET effect = excluded.effect, updated_at = excluded.updated_at`,

      TENANT_A,

      permissionIdArg,

      effect,

      stamp,
    )
  }

  try {
    // Default denies leads.delete for a Sales Agent; an allow override grants it.

    invalidateGrantCache(TENANT_A)

    assert.equal(can(TENANT_A, "sales_agent", "leads", "delete"), false)

    override("leads.delete", "allow")

    invalidateGrantCache(TENANT_A)

    assert.equal(can(TENANT_A, "sales_agent", "leads", "delete"), true)

    // Default grants leads.view; a deny override strips it.

    assert.equal(can(TENANT_A, "sales_agent", "leads", "view"), true)

    override("leads.view", "deny")

    invalidateGrantCache(TENANT_A)

    assert.equal(can(TENANT_A, "sales_agent", "leads", "view"), false)
  } finally {
    run(
      `DELETE FROM role_permission_overrides
        WHERE tenant_id = ? AND role_id = 'sales_agent'`,

      TENANT_A,
    )

    invalidateGrantCache(TENANT_A)
  }

  // Back to the baseline once the overrides are gone.

  assert.equal(can(TENANT_A, "sales_agent", "leads", "delete"), false)

  assert.equal(can(TENANT_A, "sales_agent", "leads", "view"), true)
})

// ---------------------------------------------------------------------------

// 3. The HTTP guard enforces the model

// ---------------------------------------------------------------------------

interface RouteProbe {
  module: string

  action: string

  method: string

  path: string
}

// One read route for every module in the catalogue.

const READ_PROBES: RouteProbe[] = [
  {
    module: "dashboard",
    action: "view",
    method: "GET",
    path: "/api/dashboard/summary",
  },

  { module: "projects", action: "view", method: "GET", path: "/api/projects" },

  {
    module: "inventory",
    action: "view",
    method: "GET",
    path: "/api/projects/perm-probe/units",
  },

  { module: "leads", action: "view", method: "GET", path: "/api/leads" },

  {
    module: "sales_agents",
    action: "view",
    method: "GET",
    path: "/api/sales-agents",
  },

  { module: "dealers", action: "view", method: "GET", path: "/api/dealers" },

  { module: "bookings", action: "view", method: "GET", path: "/api/bookings" },

  {
    module: "approvals",
    action: "view",
    method: "GET",
    path: "/api/approvals",
  },

  { module: "payments", action: "view", method: "GET", path: "/api/payments" },

  {
    module: "customers",
    action: "view",
    method: "GET",
    path: "/api/customers",
  },

  { module: "expenses", action: "view", method: "GET", path: "/api/expenses" },

  { module: "vendors", action: "view", method: "GET", path: "/api/vendors" },

  {
    module: "construction",
    action: "view",
    method: "GET",
    path: "/api/construction/phases",
  },

  {
    module: "procurement",
    action: "view",
    method: "GET",
    path: "/api/procurement/requisitions",
  },

  {
    module: "documents",
    action: "view",
    method: "GET",
    path: "/api/documents",
  },

  {
    module: "signatures",
    action: "view",
    method: "GET",
    path: "/api/signatures/templates",
  },

  { module: "tickets", action: "view", method: "GET", path: "/api/tickets" },

  {
    module: "campaigns",
    action: "view",
    method: "GET",
    path: "/api/campaigns",
  },

  { module: "reports", action: "view", method: "GET", path: "/api/reports" },

  { module: "users", action: "view", method: "GET", path: "/api/users" },

  {
    module: "settings",
    action: "view",
    method: "GET",
    path: "/api/settings/organization",
  },

  { module: "audit", action: "view", method: "GET", path: "/api/audit" },
]

// Write routes covering create, edit, delete and approve across the surface.

const WRITE_PROBES: RouteProbe[] = [
  {
    module: "projects",
    action: "create",
    method: "POST",
    path: "/api/projects",
  },

  {
    module: "projects",
    action: "edit",
    method: "PATCH",
    path: "/api/projects/perm-probe",
  },

  {
    module: "inventory",
    action: "edit",
    method: "POST",
    path: "/api/projects/perm-probe/units",
  },

  { module: "leads", action: "create", method: "POST", path: "/api/leads" },

  {
    module: "leads",
    action: "edit",
    method: "PATCH",
    path: "/api/leads/perm-probe",
  },

  {
    module: "sales_agents",
    action: "create",
    method: "POST",
    path: "/api/sales-agents/teams",
  },

  { module: "dealers", action: "create", method: "POST", path: "/api/dealers" },

  {
    module: "bookings",
    action: "create",
    method: "POST",
    path: "/api/bookings",
  },

  {
    module: "bookings",
    action: "approve",
    method: "POST",
    path: "/api/bookings/perm-probe/cancel",
  },

  {
    module: "customers",
    action: "create",
    method: "POST",
    path: "/api/customers",
  },

  {
    module: "customers",
    action: "edit",
    method: "PATCH",
    path: "/api/customers/perm-probe",
  },

  {
    module: "payments",
    action: "create",
    method: "POST",
    path: "/api/payments",
  },

  {
    module: "payments",
    action: "edit",
    method: "POST",
    path: "/api/late-fee-assessments/perm-probe/waive",
  },

  {
    module: "approvals",
    action: "approve",
    method: "POST",
    path: "/api/approvals/perm-probe/approve",
  },

  {
    module: "expenses",
    action: "create",
    method: "POST",
    path: "/api/expenses",
  },

  { module: "vendors", action: "create", method: "POST", path: "/api/vendors" },

  {
    module: "construction",
    action: "create",
    method: "POST",
    path: "/api/construction/phases",
  },

  {
    module: "construction",
    action: "edit",
    method: "PATCH",
    path: "/api/construction/phases/perm-probe",
  },

  {
    module: "procurement",
    action: "create",
    method: "POST",
    path: "/api/procurement/requisitions",
  },

  {
    module: "documents",
    action: "create",
    method: "POST",
    path: "/api/documents",
  },

  {
    module: "documents",
    action: "delete",
    method: "DELETE",
    path: "/api/documents/perm-probe",
  },

  {
    module: "signatures",
    action: "create",
    method: "POST",
    path: "/api/signatures/templates",
  },

  {
    module: "signatures",
    action: "approve",
    method: "POST",
    path: "/api/signatures/templates/perm-probe/release",
  },

  { module: "tickets", action: "create", method: "POST", path: "/api/tickets" },

  {
    module: "campaigns",
    action: "create",
    method: "POST",
    path: "/api/campaigns",
  },

  {
    module: "campaigns",
    action: "delete",
    method: "DELETE",
    path: "/api/campaigns/perm-probe",
  },

  {
    module: "users",
    action: "create",
    method: "POST",
    path: "/api/users/invite",
  },

  {
    module: "users",
    action: "edit",
    method: "PATCH",
    path: "/api/users/perm-probe",
  },

  {
    module: "users",
    action: "delete",
    method: "DELETE",
    path: "/api/users/perm-probe",
  },

  {
    module: "settings",
    action: "edit",
    method: "PATCH",
    path: "/api/settings/organization",
  },

  {
    module: "assistant",
    action: "view",
    method: "POST",
    path: "/api/assistant/ask",
  },
]

async function assertGuardMatchesModel(probes: RouteProbe[]) {
  for (const probe of probes) {
    for (const [role, cookies] of roleJars) {
      const denied = !can(TENANT_A, role, probe.module, probe.action)

      const body =
        probe.method === "GET" || probe.method === "DELETE" ? undefined : {}

      const result = await call(cookies, probe.method, probe.path, body)

      if (denied) {
        assert.equal(
          result.status,

          403,

          `${role} on ${probe.method} ${probe.path} should be denied (${probe.module}.${probe.action})`,
        )

        assert.equal(
          (result.body as Json)?.error?.code,

          "permission_denied",

          `${role} ${probe.module}.${probe.action}: wrong denial code`,
        )
      } else {
        assert.notEqual(
          result.status,

          403,

          `${role} on ${probe.method} ${probe.path} was denied though the role holds ${probe.module}.${probe.action}: ${JSON.stringify(result.body?.error)}`,
        )
      }
    }
  }
}

test("every module's read route answers 403 exactly when the role lacks the view grant", async () => {
  await assertGuardMatchesModel(READ_PROBES)
})

test("create, edit, delete and approve routes answer 403 exactly when the role lacks the grant", async () => {
  await assertGuardMatchesModel(WRITE_PROBES)
})

// ---------------------------------------------------------------------------

// 4. The inventory change_status gate (separate from edit)

// ---------------------------------------------------------------------------

test("a role that can edit units but not change their status is blocked from moving one", async () => {
  const owner = roleJars.get("tenant_owner")!

  const frame = await makeBookingFrame(owner, {
    code: "CS-1",

    name: "Change Status Plot",

    phone: "+971509990001",
  })

  // Procurement Officer holds inventory.edit but not inventory.change_status.

  assert.equal(can(TENANT_A, "procurement_officer", "inventory", "edit"), true)

  assert.equal(
    can(TENANT_A, "procurement_officer", "inventory", "change_status"),
    false,
  )

  const officer = roleJars.get("procurement_officer")!

  const blocked = await call(
    officer,

    "PATCH",

    `/api/projects/${frame.projectId}/units/${frame.unitId}`,

    { status: "reserved" },
  )

  assert.equal(blocked.status, 403, JSON.stringify(blocked.body))

  assert.equal(blocked.body.error.code, "permission_denied")

  // The same move by a role that does hold change_status is not a permission failure.

  const allowed = await call(
    owner,

    "PATCH",

    `/api/projects/${frame.projectId}/units/${frame.unitId}`,

    { status: "reserved" },
  )

  assert.notEqual(allowed.status, 403, JSON.stringify(allowed.body?.error))
})

// ---------------------------------------------------------------------------

// 5. An approval-required action is held, maker-checked, then applied

// ---------------------------------------------------------------------------

test("a booking over the threshold is held for approval and applied only by another approver", async () => {
  const requester = (await signInAsRole("tenant_owner", "appr_requester"))
    .cookies

  const clearer = (await signInAsRole("tenant_owner", "appr_clearer")).cookies

  await setApprovalPolicy(requester, "booking", true, 100_000)

  const frame = await makeBookingFrame(requester, {
    code: "APR-1",

    name: "Approval Gated Plot",

    phone: "+971509990002",
  })

  const held = await call(requester, "POST", "/api/bookings", {
    projectId: frame.projectId,

    unitId: frame.unitId,

    customerId: frame.customerId,

    bookingAmount: 500_000,

    bookingDate: "2020-01-15",

    terms: "Approval required.",
  })

  assert.equal(held.status, 200, JSON.stringify(held.body))

  assert.equal(
    held.body.pending,
    true,
    "the over-threshold booking must be held, not made",
  )

  const approvalId = held.body.approval.id as string

  assert.ok(approvalId, "a pending approval record is returned")

  // Held means nothing moved: the unit is still on the market.

  assert.equal(
    await unitStatus(requester, frame.projectId, frame.unitId),

    "available",

    "a held booking must not take the unit off the market",
  )

  // Maker-checker: the person who raised the request cannot clear it.

  const self = await call(
    requester,
    "POST",
    `/api/approvals/${approvalId}/approve`,
    {},
  )

  assert.equal(self.status, 403, JSON.stringify(self.body))

  assert.equal(self.body.error.code, "self_approval")

  // A different entitled owner approves it, and the deferred booking finally applies.

  const cleared = await call(
    clearer,

    "POST",

    `/api/approvals/${approvalId}/approve`,

    { decisionNote: "Approved." },
  )

  assert.equal(cleared.status, 200, JSON.stringify(cleared.body))

  assert.equal(
    await unitStatus(requester, frame.projectId, frame.unitId),

    "booked",

    "approval must drive the unit to booked",
  )
})
