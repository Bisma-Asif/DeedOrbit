/**
 * Permission resolution.
 *
 * The rule, in one line: a role may perform `module.action` when the database
 * says so. Nothing in this file special-cases a role id — `tenant_owner` has no
 * special case, it simply has more rows in `role_permission_defaults`. That is
 * what lets a tenant admin narrow a role without a code change.
 *
 * Precedence: per-tenant override, then platform default, then deny.
 */

import {
  ACTIONS,
  MODULES,
  ROLES,
  type Action,
  type PermissionModule,
  type RoleId,
  permissionId,
} from "../shared/access.ts"

import { all, get } from "./db.ts"

export type EffectivePermission = {
  permissionId: string

  module: PermissionModule

  action: Action

  allowed: boolean

  /** Where the decision came from, for the audit trail and the UI. */

  source: "override" | "default" | "none"

  effect: "allow" | "deny" | null
}

export type RoleGrants = {
  roleId: RoleId

  permissions: EffectivePermission[]

  allowedCount: number
}

type OverrideRow = {
  permission_id: string

  effect: "allow" | "deny"
}

type DefaultRow = {
  permission_id: string
}

export function listAllPermissionIds(): string[] {
  const ids: string[] = []

  for (const module of MODULES) {
    for (const action of ACTIONS) ids.push(permissionId(module, action))
  }

  return ids
}

/**
 * Effective grants for one role inside one tenant, as a full matrix.
 * A missing row means denied — the resolver is allow-by-exception.
 */

export function resolveRoleGrants(
  tenantId: string,

  roleId: string,
): RoleGrants {
  const overrides = new Map<string, "allow" | "deny">(
    all<OverrideRow>(
      `SELECT permission_id, effect
         FROM role_permission_overrides
        WHERE tenant_id = ? AND role_id = ?`,

      tenantId,

      roleId,
    ).map((row) => [row.permission_id, row.effect]),
  )

  const defaults = new Set(
    all<DefaultRow>(
      `SELECT permission_id
         FROM role_permission_defaults
        WHERE role_id = ?`,

      roleId,
    ).map((row) => row.permission_id),
  )

  const permissions: EffectivePermission[] = []

  let allowedCount = 0

  for (const module of MODULES) {
    for (const action of ACTIONS) {
      const id = permissionId(module, action)

      const override = overrides.get(id)

      const allowed = override ? override === "allow" : defaults.has(id)

      const source: EffectivePermission["source"] = override
        ? "override"
        : defaults.has(id)
          ? "default"
          : "none"

      const effect: EffectivePermission["effect"] =
        override ?? (defaults.has(id) ? "allow" : null)

      if (allowed) allowedCount += 1

      permissions.push({
        permissionId: id,

        module,

        action,

        allowed,

        source,

        effect,
      })
    }
  }

  return { roleId: roleId as RoleId, permissions, allowedCount }
}

/** Every role's grants for a tenant, keyed by role id. */

export function resolveTenantMatrix(
  tenantId: string,
): Record<string, RoleGrants> {
  const matrix: Record<string, RoleGrants> = {}

  for (const role of ROLES) {
    matrix[role.id] = resolveRoleGrants(tenantId, role.id)
  }

  return matrix
}

interface CachedGrants {
  at: number
  grants: RoleGrants
}

const grantsCache = new Map<string, CachedGrants>()

const GRANTS_TTL_MS = 5_000

/**
 * Grants for a user's *active* role. Cached briefly because a single screen
 * can hit the permission check dozens of times; the TTL keeps an admin's edit
 * visible almost immediately without a cache-invalidation protocol.
 */

export function grantsForRole(tenantId: string, roleId: string): RoleGrants {
  const key = `${tenantId}:${roleId}`

  const hit = grantsCache.get(key)

  if (hit && Date.now() - hit.at < GRANTS_TTL_MS) return hit.grants

  const grants = resolveRoleGrants(tenantId, roleId)

  grantsCache.set(key, { at: Date.now(), grants })

  return grants
}

export function invalidateGrantCache(tenantId?: string): void {
  if (!tenantId) {
    grantsCache.clear()

    return
  }

  for (const key of [...grantsCache.keys()]) {
    if (key.startsWith(`${tenantId}:`)) grantsCache.delete(key)
  }
}

export function can(
  tenantId: string,

  roleId: string,

  module: string,

  action: string,
): boolean {
  const id = permissionId(module as PermissionModule, action as Action)

  const grants = grantsForRole(tenantId, roleId)

  return grants.permissions.some((p) => p.permissionId === id && p.allowed)
}

/** All modules the role can at least view. Used to shape the navigation. */

export function viewableModules(
  tenantId: string,

  roleId: string,
): PermissionModule[] {
  const grants = grantsForRole(tenantId, roleId)

  const seen = new Set<PermissionModule>()

  for (const entry of grants.permissions) {
    if (entry.action === "view" && entry.allowed) seen.add(entry.module)
  }

  return [...seen]
}

export function roleExists(roleId: string): boolean {
  return ROLES.some((role) => role.id === roleId)
}

export function roleLabel(roleId: string): string {
  const row = get<{ label: string }>(
    "SELECT label FROM roles WHERE role_id = ?",

    roleId,
  )

  return row?.label ?? roleId
}
