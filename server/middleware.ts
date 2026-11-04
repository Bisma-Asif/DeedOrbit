/**
 * The three checks every business route must pass, in order:
 *
 *   1. requireAuth       — is there a live session for a real, active user?
 *   2. requirePermission — does the DATABASE say this role may do this action?
 *   3. tenantScope       — does the record or query belong to this tenant?
 *
 * They are separate functions rather than one `authorize` so a route can be
 * explicit about what it needs, and so a platform-level route (the tenant
 * directory) can opt out of the tenant check with a stated reason.
 *
 * The tenant check is the one most easily forgotten, so the helpers here make
 * the safe path the default: `scopedSelect` always injects the tenant
 * predicate, and `assertSameTenant` throws rather than returning a soft
 * failure. A cross-tenant id produces 404, not 403 — a 403 would confirm the
 * record exists.
 */

import type { Action, PermissionModule } from "../shared/access.ts"

import { get, run } from "./db.ts"

import {
  forbidden,
  notFound,
  unauthorized,
  type RequestContext,
} from "./http.ts"

import { can } from "./rbac.ts"

import {
  SESSION_COOKIE,
  verifySessionToken,
  type SessionRecord,
} from "./session.ts"

export type GuardedContext = RequestContext & {
  session: SessionRecord

  tenantId: string

  userId: string

  roleId: string

  can: (module: PermissionModule, action: Action) => boolean
}

// --- Check 1: authentication ----------------------------------------------

export function requireAuth(ctx: RequestContext): GuardedContext {
  const token = ctx.cookies[SESSION_COOKIE] ?? null

  const session = verifySessionToken(token)

  if (!session) {
    throw unauthorized("Sign in to continue")
  }

  if (session.pendingTwofa) {
    throw unauthorized("Two-factor verification is required", "twofa_required")
  }

  const guarded: GuardedContext = {
    ...ctx,

    session,

    tenantId: session.tenantId,

    userId: session.user.id,

    roleId: session.roleId,

    can: (module, action) =>
      can(session.tenantId, session.roleId, module, action),
  }

  return guarded
}

// --- Check 2: permission ---------------------------------------------------

/**
 * Returns the context unchanged so guards chain:
 * `requirePermission(requireAuth(ctx), 'users', 'edit')`.
 */

export function requirePermission(
  ctx: GuardedContext,

  module: PermissionModule,

  action: Action,
): GuardedContext {
  if (can(ctx.tenantId, ctx.roleId, module, action)) return ctx

  // Records the attempt so a rejected privileged action is investigable.

  writeAudit(ctx, `permission.denied.${action}`, "role", ctx.roleId, {
    module,

    action,

    path: ctx.pathname,
  })

  throw forbidden(
    `Your role does not allow "${module}.${action}". Ask a tenant admin to adjust the role.`,

    "permission_denied",
  )
}

/** Runs any one of the listed actions — used where several are equivalent. */

export function requireAnyPermission(
  ctx: GuardedContext,

  module: PermissionModule,

  actions: Action[],
): GuardedContext {
  if (actions.some((action) => can(ctx.tenantId, ctx.roleId, module, action)))
    return ctx

  throw forbidden(
    `Your role does not allow this action on ${module}.`,

    "permission_denied",
  )
}

// --- Check 3: tenant scoping ----------------------------------------------

/**
 * Throws unless `row` belongs to the caller's tenant. Use on any record
 * fetched by a caller-supplied id.
 */

export function assertSameTenant(
  ctx: GuardedContext,

  row: { tenant_id?: unknown } | null | undefined,

  label = "record",
): void {
  if (!row) throw notFound(`That ${label} does not exist`)

  if (String(row.tenant_id) !== ctx.tenantId) {
    // Deliberately indistinguishable from "not found".

    throw notFound(`That ${label} does not exist`)
  }
}

export interface TenantPredicate {
  sql: string
  value: string
}

export function tenantPredicate(
  ctx: GuardedContext,
  column = "tenant_id",
): TenantPredicate {
  return { sql: `${column} = ?`, value: ctx.tenantId }
}

/** The id of the tenant a new row must be written with. */

export function scopedTenantId(ctx: GuardedContext): string {
  return ctx.tenantId
}

/**
 * Strips the tenant predicate from a caller-supplied value. Any route that
 * accepts a tenant id from the client must route it through this, so a client
 * cannot read or write another tenant's rows by posting someone else's id.
 */

export function resolveTargetTenantId(
  ctx: GuardedContext,

  requested: unknown,
): string {
  if (requested === undefined || requested === null || requested === "") {
    return ctx.tenantId
  }

  const value = String(requested)

  if (value !== ctx.tenantId) {
    throw forbidden("You can only act on your own workspace")
  }

  return ctx.tenantId
}

// --- Convenience -----------------------------------------------------------

/** requireAuth + requirePermission in one call. */

export function guard(
  ctx: RequestContext,

  module: PermissionModule,

  action: Action,
): GuardedContext {
  const guarded = requireAuth(ctx)

  requirePermission(guarded, module, action)

  return guarded
}

/** Loads a row by id and enforces tenant ownership in one step. */

export function loadScoped<T extends Record<string, unknown>>(
  ctx: GuardedContext,

  table: string,

  id: string,

  label = "record",
): T {
  const row = get<T & { tenant_id: string }>(
    `SELECT * FROM ${table} WHERE id = ?`,

    id,
  )

  if (!row) throw notFound(`That ${label} does not exist`)

  assertSameTenant(ctx, row, label)

  return row
}

// --- Audit -----------------------------------------------------------------

export type AuditInput = {
  action: string

  targetType?: string | null

  targetId?: string | null

  detail?: Record<string, unknown> | null

  ip?: string | null
}

export function writeAudit(
  ctx: RequestContext & { session?: SessionRecord },

  action: string,

  targetType: string | null = null,

  targetId: string | null = null,

  detail: Record<string, unknown> | null = null,

  ip: string | null = null,
): void {
  const session = ctx.session

  const tenantId = session?.tenantId ?? null

  if (!tenantId) return

  run(
    `INSERT INTO audit_log (
        id, tenant_id, actor_user_id, actor_email, action,
        target_type, target_id, detail, ip_address, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,

    `aud_${Math.random().toString(36).slice(2, 12)}${Date.now().toString(36)}`,

    tenantId,

    session?.userId ?? null,

    session?.user.email ?? null,

    action,

    targetType,

    targetId,

    detail ? JSON.stringify(detail) : null,

    ip,

    new Date().toISOString(),
  )
}
