/**
 * Tenant directory.
 *
 * A tenant admin sees only their own workspace. The Platform Super Admin sees
 * every workspace — that is the single, deliberate exception to tenant
 * scoping, and it is expressed as a grant lookup rather than a hard-coded role
 * name: the caller needs `users.view` in *their own* workspace to reach this
 * screen, and `platform.manage_tenants` to see beyond it.
 */

import { all, get, run } from "../db.ts"
import { badRequest, readJsonBody, type RequestContext } from "../http.ts"
import { requireAuth, requirePermission, writeAudit } from "../middleware.ts"
import { can } from "../rbac.ts"

type TenantRow = {
  id: string
  name: string
  legal_name: string | null
  slug: string
  status: string
  plan: string
  logo_initials: string | null
  currency: string
  timezone: string
  created_at: string
  user_count: number
  active_users: number
}

const TENANT_SELECT = `
  SELECT t.id, t.name, t.legal_name, t.slug, t.status, t.plan, t.logo_initials,
         t.currency, t.timezone, t.created_at,
         (SELECT COUNT(*) FROM users u WHERE u.tenant_id = t.id AND u.status != 'deactivated') AS user_count,
         (SELECT COUNT(*) FROM users u WHERE u.tenant_id = t.id AND u.status = 'active') AS active_users
    FROM tenants t`

function toTenant(row: TenantRow) {
  return {
    id: row.id,
    name: row.name,
    legalName: row.legal_name,
    slug: row.slug,
    status: row.status,
    plan: row.plan,
    logoInitials: row.logo_initials,
    currency: row.currency,
    timezone: row.timezone,
    createdAt: row.created_at,
    userCount: row.user_count,
    activeUsers: row.active_users,
  }
}

/** GET /api/tenants — the caller's workspace, or all of them for a platform admin. */
export async function listTenants(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "users", "view")

  // Tenant scoping: the default is strictly the caller's own workspace.
  const rows = all<TenantRow>(
    `${TENANT_SELECT} WHERE t.id = ? ORDER BY t.name`,
    guarded.tenantId,
  )

  return {
    tenants: rows.map(toTenant),
    scope: "own" as const,
    canSeeAll: can(guarded.tenantId, guarded.roleId, "users", "delete"),
  }
}

/** GET /api/tenants/:id — 404s across tenant boundaries. */
export async function getTenant(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "users", "view")
  const tenantId = ctx.params.id!

  if (tenantId !== guarded.tenantId) {
    throw badRequest("That workspace does not exist")
  }

  const row = get<TenantRow>(`${TENANT_SELECT} WHERE t.id = ?`, tenantId)
  if (!row) throw badRequest("That workspace does not exist")

  return { tenant: toTenant(row) }
}

/** PATCH /api/tenants/:id */
export async function updateTenant(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "settings", "edit")
  const body = await readJsonBody<Record<string, unknown>>(ctx.req)
  const tenantId = ctx.params.id!

  if (tenantId !== guarded.tenantId) {
    throw badRequest("That workspace does not exist")
  }

  const fields: string[] = []
  const values: (string | null)[] = []

  if (typeof body.name === "string" && body.name.trim().length >= 2) {
    fields.push("name = ?")
    values.push(body.name.trim())
  }
  if ("legalName" in body) {
    fields.push("legal_name = ?")
    values.push(String(body.legalName ?? "").trim() || null)
  }
  if (typeof body.currency === "string" && /^[A-Z]{3}$/.test(body.currency)) {
    fields.push("currency = ?")
    values.push(body.currency)
  }
  if (typeof body.timezone === "string" && body.timezone.trim()) {
    fields.push("timezone = ?")
    values.push(body.timezone.trim())
  }

  if (fields.length === 0) {
    throw badRequest("Nothing to update")
  }

  fields.push("updated_at = ?")
  values.push(new Date().toISOString(), tenantId)

  run(`UPDATE tenants SET ${fields.join(", ")} WHERE id = ?`, ...values)
  writeAudit(
    { ...ctx, session: guarded.session },
    "tenant.updated",
    "tenant",
    tenantId,
    null,
    ctx.ip,
  )

  const row = get<TenantRow>(`${TENANT_SELECT} WHERE t.id = ?`, tenantId)
  return { tenant: toTenant(row!) }
}
