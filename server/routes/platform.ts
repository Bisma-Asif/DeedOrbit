/**
 * Platform Super Admin area: the tenant directory, its billing ledger, and the
 * suspension workflow.
 *
 * The gate here is *role scope*, not a permission module. `shared/access.ts`
 * grants tenant_owner `all: true`, which expands to every module in the
 * catalogue — so a "platform" module would hand tenant owners platform rights
 * until someone narrowed the seed. Scope is the one fact a permission row can
 * smuggle and a role id cannot be talked out of: the `roles` table itself says
 * which roles operate the platform, and every handler re-reads it.
 *
 * The rules the ledger enforces, in the order the product story needs them:
 *   - money only ever exists as a recorded event; revenue is a SUM, never an
 *     estimate;
 *   - a grace period is a *grant* with an end date, given deliberately;
 *   - suspension is refused while a grace window is still open — cutting a
 *     workspace off mid-grace is precisely what the grace was bought to
 *     prevent — and refused while the subscription reads as paid;
 *   - suspending invalidates the workspace's live sessions so the cut is real
 *     from this request onward, excepting platform-scope members, who must
 *     keep the console to be able to reverse it.
 */

import { all, get, run, transaction } from "../db.ts"

import {
  badRequest,
  notFound,
  readJsonBody,
  type RequestContext,
} from "../http.ts"

import { requireAuth, writeAudit, type GuardedContext } from "../middleware.ts"

import {
  BILLING_EVENT_LABELS,
  BILLING_EVENT_KIND_TONE,
  GRACE_DAYS_MAX,
  GRACE_DAYS_MIN,
  PLAN_DEFINITIONS,
  isPlatformPlan,
  planDefinition,
  type BillingEventKind,
  type DerivedBillingStatus,
  type PlatformBillingEventView,
  type PlatformMutationResponse,
  type PlatformTenantDetailResponse,
  type PlatformTenantListResponse,
  type PlatformTenantView,
} from "../../shared/platform.ts"

// --- Guard -------------------------------------------------------------------

/**
 * requireAuth plus a role-scope check read from the database the session was
 * minted from. A denied attempt is audited like every other refusal.
 */

function requirePlatform(ctx: RequestContext): GuardedContext {
  const guarded = requireAuth(ctx)

  const role = get<{ scope: string }>(
    "SELECT scope FROM roles WHERE role_id = ?",

    guarded.roleId,
  )

  if (role?.scope !== "platform") {
    writeAudit(
      guarded,

      "permission.denied.platform_only",

      "role",

      guarded.roleId,

      { path: guarded.pathname },

      guarded.ip,
    )

    throw notFound("That endpoint does not exist")
  }

  return guarded
}

// --- Rows and derivation -----------------------------------------------------

interface TenantDirectoryRow {
  id: string

  name: string

  legal_name: string | null

  slug: string

  status: string

  plan: string

  currency: string

  created_at: string

  billing_status: string

  grace_ends_at: string | null

  grace_reason: string | null

  user_count: number

  project_count: number

  storage_bytes: number

  collected: number

  invoiced: number

  last_billed_at: string | null
}

interface BillingEventRow {
  id: string

  kind: string

  amount: number | null

  currency: string | null

  note: string | null

  actor_email: string | null

  created_at: string
}

const DIRECTORY_SELECT = `
  SELECT t.id, t.name, t.legal_name, t.slug, t.status, t.plan, t.currency,
         t.created_at,
         COALESCE(s.billing_status, 'current') AS billing_status,
         s.grace_ends_at, s.grace_reason,
         (SELECT COUNT(*) FROM users u
           WHERE u.tenant_id = t.id AND u.status = 'active') AS user_count,
         (SELECT COUNT(*) FROM projects p
           WHERE p.tenant_id = t.id) AS project_count,
         (SELECT COALESCE(SUM(d.size_bytes), 0) FROM documents d
           WHERE d.tenant_id = t.id) AS storage_bytes,
         (SELECT COALESCE(SUM(e.amount), 0) FROM platform_billing_events e
           WHERE e.tenant_id = t.id AND e.kind = 'payment') AS collected,
         (SELECT COALESCE(SUM(e.amount), 0) FROM platform_billing_events e
           WHERE e.tenant_id = t.id AND e.kind = 'invoice') AS invoiced,
         (SELECT MAX(e.created_at) FROM platform_billing_events e
           WHERE e.tenant_id = t.id AND e.kind = 'invoice') AS last_billed_at
    FROM tenants t
    LEFT JOIN tenant_subscriptions s ON s.tenant_id = t.id`

/**
 * The stored status is current/due/grace; `grace` splits at read time into an
 * open or lapsed window on `grace_ends_at`. Nothing is written here, which is
 * the point: an expired grace is a fact about the clock, not a state a job has
 * to remember to move.
 */

function deriveBillingStatus(
  row: Pick<TenantDirectoryRow, "billing_status" | "grace_ends_at">,

  now: string,
): DerivedBillingStatus {
  if (row.billing_status === "due") return "due"

  if (row.billing_status !== "grace") return "current"

  const endsAt = row.grace_ends_at

  if (!endsAt) return "due"

  return endsAt > now ? "grace_active" : "grace_expired"
}

function toTenantView(
  row: TenantDirectoryRow,
  now: string,
): PlatformTenantView {
  const plan = planDefinition(row.plan)

  const collected = Number(row.collected)

  const invoiced = Number(row.invoiced)

  return {
    id: row.id,

    name: row.name,

    legalName: row.legal_name,

    slug: row.slug,

    status: row.status,

    plan: row.plan,

    planLabel: plan?.label ?? null,

    currency: row.currency,

    createdAt: row.created_at,

    billingStatus: deriveBillingStatus(row, now),

    graceEndsAt: row.billing_status === "grace" ? row.grace_ends_at : null,

    graceReason: row.billing_status === "grace" ? row.grace_reason : null,

    usage: {
      users: {
        used: Number(row.user_count),
        limit: plan?.limits.users ?? null,
      },

      projects: {
        used: Number(row.project_count),

        limit: plan?.limits.projects ?? null,
      },

      storageBytes: {
        used: Number(row.storage_bytes),

        limit: plan?.limits.storageBytes ?? null,
      },
    },

    monthlyAmount: plan?.monthlyAmount ?? null,

    revenueCollected: collected,

    amountInvoiced: invoiced,

    outstanding: invoiced - collected,

    lastBilledAt: row.last_billed_at,
  }
}

function readTenantRow(tenantId: string): TenantDirectoryRow {
  const row = get<TenantDirectoryRow>(
    `${DIRECTORY_SELECT} WHERE t.id = ?`,
    tenantId,
  )

  if (!row) throw notFound("That workspace does not exist")

  return row
}

function readTenantView(tenantId: string): PlatformTenantView {
  return toTenantView(readTenantRow(tenantId), new Date().toISOString())
}

function toEventView(row: BillingEventRow): PlatformBillingEventView {
  // `kind` comes from a CHECK-constrained column, so it is always a known key;

  // the cast keeps the map total without a runtime fallback that could never

  // fire.

  const kind = row.kind as BillingEventKind

  return {
    id: row.id,

    kind,

    kindLabel: BILLING_EVENT_LABELS[kind],

    tone: BILLING_EVENT_KIND_TONE[kind],

    amount: row.amount === null ? null : Number(row.amount),

    currency: row.currency,

    note: row.note,

    actorEmail: row.actor_email,

    createdAt: row.created_at,
  }
}

function listEvents(tenantId: string, limit = 200): PlatformBillingEventView[] {
  return all<BillingEventRow>(
    `SELECT id, kind, amount, currency, note, actor_email, created_at
       FROM platform_billing_events
      WHERE tenant_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT ?`,

    tenantId,

    limit,
  ).map(toEventView)
}

// --- Ledger writes -----------------------------------------------------------

function eventId(): string {
  return `pbe_${Math.random().toString(36).slice(2, 12)}${Date.now().toString(36)}`
}

interface NewEvent {
  id: string

  tenantId: string

  kind: BillingEventKind

  amount: number | null

  currency: string | null

  note: string | null

  actorEmail: string

  createdAt: string
}

// The id is minted inside the helper, not passed in, so no call site can

// collide two events on one key.

function recordEvent(event: Omit<NewEvent, "id">): PlatformBillingEventView {
  const row: NewEvent = { ...event, id: eventId() }

  run(
    `INSERT INTO platform_billing_events (
        id, tenant_id, kind, amount, currency, note, actor_email, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,

    row.id,

    row.tenantId,

    row.kind,

    row.amount,

    row.currency,

    row.note,

    row.actorEmail,

    row.createdAt,
  )

  return toEventView({
    id: row.id,

    kind: row.kind,

    amount: row.amount,

    currency: row.currency,

    note: row.note,

    actor_email: row.actorEmail,

    created_at: row.createdAt,
  })
}

function setSubscription(
  tenantId: string,

  status: "current" | "due" | "grace",

  graceEndsAt: string | null,

  graceReason: string | null,

  now: string,
): void {
  run(
    `INSERT INTO tenant_subscriptions (
        tenant_id, billing_status, grace_ends_at, grace_reason, updated_at
     ) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (tenant_id) DO UPDATE SET
        billing_status = excluded.billing_status,
        grace_ends_at = excluded.grace_ends_at,
        grace_reason = excluded.grace_reason,
        updated_at = excluded.updated_at`,

    tenantId,

    status,

    graceEndsAt,

    graceReason,

    now,
  )
}

function parseMoney(
  value: unknown,
  fallback: number | null,
  label: string,
): number {
  if (value === undefined || value === null || value === "") {
    if (fallback === null) {
      throw badRequest(
        `No default ${label.toLowerCase()} exists for this workspace's plan — enter an amount`,
      )
    }

    return fallback
  }

  const amount = Number(value)

  if (!Number.isInteger(amount) || amount < 0 || amount > 1000000000000) {
    throw badRequest(
      `${label} must be a whole amount between 0 and 1,000,000,000,000`,
    )
  }

  return amount
}

function parseNote(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null

  const note = String(value).trim()

  if (note.length > 300)
    throw badRequest("Note must be 300 characters or fewer")

  return note || null
}

function mutationResponse(
  tenantId: string,

  event: PlatformBillingEventView | null,
): PlatformMutationResponse {
  return { ok: true, tenant: readTenantView(tenantId), event }
}

// --- Reads -------------------------------------------------------------------

/** GET /api/platform/tenants — the whole directory, one row per workspace. */

export async function listPlatformTenants(
  ctx: RequestContext,
): Promise<PlatformTenantListResponse> {
  requirePlatform(ctx)

  const now = new Date().toISOString()

  const rows = all<TenantDirectoryRow>(`${DIRECTORY_SELECT} ORDER BY t.name`)

  const tenants = rows.map((row) => toTenantView(row, now))

  const collected = new Map<string, number>()

  for (const tenant of tenants) {
    if (tenant.revenueCollected > 0) {
      collected.set(
        tenant.currency,

        (collected.get(tenant.currency) ?? 0) + tenant.revenueCollected,
      )
    }
  }

  return {
    tenants,

    totals: {
      workspaces: tenants.length,

      active: tenants.filter((tenant) => tenant.status === "active").length,

      suspended: tenants.filter((tenant) => tenant.status !== "active").length,

      needingAttention: tenants.filter(
        (tenant) =>
          tenant.status === "active" &&
          (tenant.billingStatus === "due" ||
            tenant.billingStatus === "grace_expired"),
      ).length,

      collectedByCurrency: [...collected.entries()]

        .map(([currency, amount]) => ({ currency, amount }))

        .sort((a, b) => b.amount - a.amount),
    },
  }
}

/** GET /api/platform/tenants/:id — one workspace and its billing timeline. */

export async function getPlatformTenant(
  ctx: RequestContext,
): Promise<PlatformTenantDetailResponse> {
  requirePlatform(ctx)

  const row = readTenantRow(ctx.params.id!)

  return {
    tenant: toTenantView(row, new Date().toISOString()),

    events: listEvents(row.id),
  }
}

// --- Ledger actions ------------------------------------------------------------

/** POST /api/platform/tenants/:id/invoice — bill the workspace. */

export async function recordPlatformInvoice(ctx: RequestContext) {
  const guarded = requirePlatform(ctx)

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const row = readTenantRow(ctx.params.id!)

  const plan = planDefinition(row.plan)

  const amount = parseMoney(
    body.amount,
    plan?.monthlyAmount ?? null,
    "Invoice amount",
  )

  const note = parseNote(body.note)

  const now = new Date().toISOString()

  const event = recordEvent({
    tenantId: row.id,

    kind: "invoice",

    amount,

    currency: row.currency,

    note,

    actorEmail: guarded.session.user.email,

    createdAt: now,
  })

  writeAudit(
    guarded,
    "platform.billing.invoice",
    "tenant",
    row.id,
    { amount },
    guarded.ip,
  )

  return mutationResponse(row.id, event)
}

/** POST /api/platform/tenants/:id/payment — money received; returns the workspace to Current. */

export async function recordPlatformPayment(ctx: RequestContext) {
  const guarded = requirePlatform(ctx)

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const row = readTenantRow(ctx.params.id!)

  const plan = planDefinition(row.plan)

  const amount = parseMoney(
    body.amount,
    plan?.monthlyAmount ?? null,
    "Payment amount",
  )

  const note = parseNote(body.note)

  const now = new Date().toISOString()

  const event = transaction(() => {
    setSubscription(row.id, "current", null, null, now)

    return recordEvent({
      tenantId: row.id,

      kind: "payment",

      amount,

      currency: row.currency,

      note,

      actorEmail: guarded.session.user.email,

      createdAt: now,
    })
  })

  writeAudit(
    guarded,
    "platform.billing.payment",
    "tenant",
    row.id,
    { amount },
    guarded.ip,
  )

  return mutationResponse(row.id, event)
}

/** POST /api/platform/tenants/:id/due — the operator says the invoice is unpaid and past its date. */

export async function markPlatformTenantDue(ctx: RequestContext) {
  const guarded = requirePlatform(ctx)

  const body = await readJsonBody<Record<string, unknown>>(ctx.req).catch(
    (): Record<string, unknown> => ({}),
  )

  const row = readTenantRow(ctx.params.id!)

  const now = new Date().toISOString()

  const derived = deriveBillingStatus(row, now)

  if (derived === "due") {
    throw badRequest("This workspace is already marked due")
  }

  if (derived === "grace_active") {
    throw badRequest(
      `A grace period is still running until ${row.grace_ends_at} — a workspace inside its grace is not past due`,
    )
  }

  const event = transaction(() => {
    setSubscription(row.id, "due", null, null, now)

    return recordEvent({
      tenantId: row.id,

      kind: "billing_due",

      amount: null,

      currency: null,

      note: parseNote(body.note),

      actorEmail: guarded.session.user.email,

      createdAt: now,
    })
  })

  writeAudit(
    guarded,
    "platform.billing.due",
    "tenant",
    row.id,
    null,
    guarded.ip,
  )

  return mutationResponse(row.id, event)
}

/** POST /api/platform/tenants/:id/grace — buy the workspace time: N days, with a stated reason. */

export async function grantPlatformGrace(ctx: RequestContext) {
  const guarded = requirePlatform(ctx)

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const row = readTenantRow(ctx.params.id!)

  const now = new Date().toISOString()

  const days = Number(body.days)

  if (
    !Number.isInteger(days) ||
    days < GRACE_DAYS_MIN ||
    days > GRACE_DAYS_MAX
  ) {
    throw badRequest(
      `Grace must be a whole number of days between ${GRACE_DAYS_MIN} and ${GRACE_DAYS_MAX}`,
    )
  }

  const reason = typeof body.reason === "string" ? body.reason.trim() : ""

  if (reason.length < 4) {
    throw badRequest(
      "Give a short reason — a granted grace has to be explainable later",
    )
  }

  const derived = deriveBillingStatus(row, now)

  if (derived === "current") {
    throw badRequest(
      "This workspace has no outstanding invoice — mark it due before granting grace",
    )
  }

  // Extending an open window measures from its own end, never from today, so a

  // second grant cannot silently shorten the first.

  const openEnd =
    derived === "grace_active" && row.grace_ends_at && row.grace_ends_at > now
      ? new Date(row.grace_ends_at)
      : new Date(now)

  openEnd.setUTCDate(openEnd.getUTCDate() + days)

  const endsAt = openEnd.toISOString()

  const event = transaction(() => {
    setSubscription(row.id, "grace", endsAt, reason, now)

    return recordEvent({
      tenantId: row.id,

      kind: "grace_granted",

      amount: null,

      currency: null,

      note: `${days} day${days === 1 ? "" : "s"} of grace — ${reason}`,

      actorEmail: guarded.session.user.email,

      createdAt: now,
    })
  })

  writeAudit(
    guarded,

    "platform.billing.grace_granted",

    "tenant",

    row.id,

    { days, reason },

    guarded.ip,
  )

  return mutationResponse(row.id, event)
}

// --- Suspension --------------------------------------------------------------

/** POST /api/platform/tenants/:id/suspend — only ever after the money story allows it. */

export async function suspendPlatformTenant(ctx: RequestContext) {
  const guarded = requirePlatform(ctx)

  const body = await readJsonBody<Record<string, unknown>>(ctx.req).catch(
    (): Record<string, unknown> => ({}),
  )

  const row = readTenantRow(ctx.params.id!)

  const now = new Date().toISOString()

  if (row.status !== "active") {
    throw badRequest("This workspace is already suspended or closed")
  }

  const derived = deriveBillingStatus(row, now)

  if (derived === "grace_active") {
    throw badRequest(
      `The grace period runs until ${row.grace_ends_at}. Suspension is only available after a grace period ends`,
    )
  }

  if (derived === "current") {
    throw badRequest(
      "This workspace's subscription reads as paid. Mark it due before suspending it",
    )
  }

  const note = parseNote(body.reason)

  transaction(() => {
    run(
      "UPDATE tenants SET status = 'suspended', updated_at = ? WHERE id = ?",

      now,

      row.id,
    )

    recordEvent({
      tenantId: row.id,

      kind: "suspension",

      amount: null,

      currency: null,

      note,

      actorEmail: guarded.session.user.email,

      createdAt: now,
    })

    // A suspension that left staff working would be theatre. Platform-scope

    // sessions survive: the operator who suspended the workspace must be able

    // to open the console that reverses it, even when their own membership

    // lives inside it.

    run(
      `DELETE FROM sessions
        WHERE tenant_id = ?
          AND (active_role_id IS NULL
               OR active_role_id NOT IN
                  (SELECT role_id FROM roles WHERE scope = 'platform'))`,

      row.id,
    )
  })

  writeAudit(
    guarded,
    "platform.tenant.suspended",
    "tenant",
    row.id,
    { note },
    guarded.ip,
  )

  return mutationResponse(row.id, null)
}

/** POST /api/platform/tenants/:id/reactivate — reopen the workspace and settle its billing state. */

export async function reactivatePlatformTenant(ctx: RequestContext) {
  const guarded = requirePlatform(ctx)

  const body = await readJsonBody<Record<string, unknown>>(ctx.req).catch(
    (): Record<string, unknown> => ({}),
  )

  const row = readTenantRow(ctx.params.id!)

  const now = new Date().toISOString()

  if (row.status === "active") {
    throw badRequest("This workspace is already active")
  }

  const note = parseNote(body.note)

  transaction(() => {
    run(
      "UPDATE tenants SET status = 'active', updated_at = ? WHERE id = ?",
      now,
      row.id,
    )

    // Rejoining the platform without settling the old balance would quietly

    // write off the debt, so the workspace comes back *due* and the operator

    // decides from there: record the payment, or grant grace again.

    setSubscription(row.id, "due", null, null, now)

    recordEvent({
      tenantId: row.id,

      kind: "reactivation",

      amount: null,

      currency: null,

      note,

      actorEmail: guarded.session.user.email,

      createdAt: now,
    })
  })

  writeAudit(
    guarded,
    "platform.tenant.reactivated",
    "tenant",
    row.id,
    { note },
    guarded.ip,
  )

  return mutationResponse(row.id, null)
}

/** POST /api/platform/tenants/:id/plan — move the workspace between catalogue plans. */

export async function updatePlatformTenantPlan(ctx: RequestContext) {
  const guarded = requirePlatform(ctx)

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const row = readTenantRow(ctx.params.id!)

  const now = new Date().toISOString()

  const plan = typeof body.plan === "string" ? body.plan.trim() : ""

  if (!isPlatformPlan(plan)) {
    throw badRequest("Choose a plan from the catalogue")
  }

  if (plan === row.plan) {
    throw badRequest("This workspace is already on that plan")
  }

  const from = planDefinition(row.plan)?.label ?? row.plan

  // `isPlatformPlan` narrowed `plan` above, so its catalogue row exists.

  const to = PLAN_DEFINITIONS[plan].label

  transaction(() => {
    run(
      "UPDATE tenants SET plan = ?, updated_at = ? WHERE id = ?",
      plan,
      now,
      row.id,
    )

    recordEvent({
      tenantId: row.id,

      kind: "plan_change",

      amount: null,

      currency: null,

      note: `${from} → ${to}`,

      actorEmail: guarded.session.user.email,

      createdAt: now,
    })
  })

  writeAudit(
    guarded,

    "platform.tenant.plan_changed",

    "tenant",

    row.id,

    { from: row.plan, to: plan },

    guarded.ip,
  )

  return mutationResponse(row.id, null)
}
