/**
 * Session lifecycle.
 *
 * A session is a row keyed by the SHA-256 digest of an opaque token. The token
 * itself only ever exists in the client's cookie, so a dump of the database
 * cannot be replayed as a login.
 *
 * Two lifetimes:
 *   - absolute: `expires_at`, the session dies regardless of activity.
 *   - idle:     refreshed `last_seen_at`, extended on use up to the absolute cap.
 */

import { generateToken, hashToken, newId } from "./crypto.ts"

import { all, get, getDb, run } from "./db.ts"

export const SESSION_COOKIE = "deedorbit_session"

const IDLE_TIMEOUT_MS = 8 * 60 * 60 * 1000 // 8 hours

const ABSOLUTE_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

export type SessionUser = {
  id: string

  email: string

  fullName: string

  jobTitle: string | null

  status: "invited" | "active" | "suspended" | "deactivated"

  twofaEnabled: boolean

  lastLoginAt: string | null

  createdAt: string
}

export type Membership = {
  id: string

  name: string

  legalName: string | null

  slug: string

  status: string

  logoInitials: string | null

  roleId: string

  roleLabel: string

  isDefault: boolean
}

export type SessionRecord = {
  id: string

  userId: string

  tenantId: string

  roleId: string

  expiresAt: string

  pendingTwofa: boolean

  user: SessionUser

  tenant: Membership

  memberships: Membership[]
}

type UserRow = {
  id: string

  email: string

  full_name: string

  job_title: string | null

  status: SessionUser["status"]

  twofa_enabled: number

  last_login_at: string | null

  created_at: string
}

type SessionRow = {
  id: string

  user_id: string

  tenant_id: string

  active_role_id: string | null

  expires_at: string

  pending_twofa: number

  last_seen_at: string
}

type MembershipRow = {
  id: string

  name: string

  legal_name: string | null

  slug: string

  status: string

  logo_initials: string | null

  role_id: string

  role_label: string

  is_default: number
}

const MEMBERSHIP_SQL = `
  SELECT t.id, t.name, t.legal_name, t.slug, t.status, t.logo_initials,
         m.role_id, COALESCE(r.label, m.role_id) AS role_label, m.is_default
    FROM tenant_memberships m
    JOIN tenants t ON t.id = m.tenant_id
    LEFT JOIN roles r ON r.role_id = m.role_id`

function toMembership(row: MembershipRow): Membership {
  return {
    id: row.id,

    name: row.name,

    legalName: row.legal_name,

    slug: row.slug,

    status: row.status,

    logoInitials: row.logo_initials,

    roleId: row.role_id,

    roleLabel: row.role_label,

    isDefault: row.is_default === 1,
  }
}

export function listMemberships(userId: string): Membership[] {
  return all<MembershipRow>(
    `${MEMBERSHIP_SQL} WHERE m.user_id = ? ORDER BY m.is_default DESC, t.name`,

    userId,
  ).map(toMembership)
}

/** The caller's membership in one tenant, or null if they are not a member. */

export function loadMembership(
  userId: string,

  tenantId: string,
): Membership | null {
  const row = get<MembershipRow>(
    `${MEMBERSHIP_SQL} WHERE m.user_id = ? AND m.tenant_id = ?`,

    userId,

    tenantId,
  )

  return row ? toMembership(row) : null
}

export interface CreateSessionInput {
  userId: string
  tenantId: string
  roleId: string
  userAgent?: string
  ipAddress?: string
  pendingTwofa?: boolean
}

export interface IssuedSession {
  token: string
  sessionId: string
  expiresAt: string
}

export function createSession(input: CreateSessionInput): IssuedSession {
  const now = new Date()

  const expiresAt = new Date(now.getTime() + ABSOLUTE_TIMEOUT_MS).toISOString()

  const token = generateToken()

  const sessionId = newId("ses")

  run(
    `INSERT INTO sessions (
        id, user_id, tenant_id, active_role_id, token_hash,
        user_agent, ip_address, pending_twofa,
        created_at, last_seen_at, expires_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,

    sessionId,

    input.userId,

    input.tenantId,

    input.roleId,

    hashToken(token),

    input.userAgent ?? null,

    input.ipAddress ?? null,

    input.pendingTwofa ? 1 : 0,

    now.toISOString(),

    now.toISOString(),

    expiresAt,
  )

  return { token, sessionId, expiresAt }
}

/**
 * Promotes a pending session once the second factor is accepted, rather than
 * issuing a new token — keeps the original session id in the audit trail.
 */

export function confirmTwofa(sessionId: string): void {
  run(
    "UPDATE sessions SET pending_twofa = 0, last_seen_at = ? WHERE id = ?",

    new Date().toISOString(),

    sessionId,
  )
}

export function verifySessionToken(token: string | null): SessionRecord | null {
  if (!token) return null

  const now = new Date()

  const row = get<SessionRow>(
    `SELECT id, user_id, tenant_id, active_role_id, expires_at, pending_twofa, last_seen_at
       FROM sessions
      WHERE token_hash = ? AND revoked_at IS NULL`,

    hashToken(token),
  )

  if (!row) return null

  if (row.expires_at <= now.toISOString()) {
    revokeSession(row.id, "expired")

    return null
  }

  // Idle window: re-anchor on activity, but never past the absolute cap.

  const idleFor = now.getTime() - new Date(row.last_seen_at).getTime()

  if (idleFor > IDLE_TIMEOUT_MS) {
    revokeSession(row.id, "idle_timeout")

    return null
  }

  // A suspended or deactivated account loses access immediately, even when the

  // session itself has not expired.

  const user = get<UserRow>(
    `SELECT id, email, full_name, job_title, status, twofa_enabled, last_login_at, created_at
       FROM users WHERE id = ?`,

    row.user_id,
  )

  if (!user || user.status !== "active") return null

  const membership = loadMembership(row.user_id, row.tenant_id)

  if (!membership) return null

  if (membership.status !== "active") {
    // The same exemption the login route applies, one layer down: a session is
    // only as alive as the check that re-reads it on every request. A
    // platform-scope active role is not inside the tenant lifecycle it is
    // managing, so suspending a workspace must not silently unauthenticate the
    // operator whose own membership lives inside it.
    const callerRole = get<{ scope: string }>(
      "SELECT scope FROM roles WHERE role_id = ?",

      row.active_role_id,
    )

    if (callerRole?.scope !== "platform") return null
  }

  run(
    "UPDATE sessions SET last_seen_at = ? WHERE id = ?",

    now.toISOString(),

    row.id,
  )

  const memberships = listMemberships(row.user_id)

  return {
    id: row.id,

    userId: row.user_id,

    tenantId: row.tenant_id,

    roleId: membership.roleId,

    expiresAt: row.expires_at,

    pendingTwofa: row.pending_twofa === 1,

    user: toSessionUser(user),

    tenant: membership,

    memberships,
  }
}

/** Switches the tenant on an existing session, after checking membership. */

export function switchSessionTenant(
  session: SessionRecord,

  tenantId: string,
): SessionRecord | null {
  const membership = session.memberships.find((m) => m.id === tenantId)

  if (!membership) return null

  run(
    "UPDATE sessions SET tenant_id = ?, active_role_id = ? WHERE id = ?",

    tenantId,

    membership.roleId,

    session.id,
  )

  return { ...session, tenantId, roleId: membership.roleId, tenant: membership }
}

export function setSessionRole(sessionId: string, roleId: string): void {
  run("UPDATE sessions SET active_role_id = ? WHERE id = ?", roleId, sessionId)
}

export function revokeSession(sessionId: string, reason = "signed_out"): void {
  run(
    `UPDATE sessions SET revoked_at = ?, revoked_reason = ?
      WHERE id = ? AND revoked_at IS NULL`,

    new Date().toISOString(),

    reason,

    sessionId,
  )
}

export function revokeAllForUser(userId: string, reason: string): number {
  return Number(
    getDb()

      .prepare(
        `UPDATE sessions SET revoked_at = ?, revoked_reason = ?
          WHERE user_id = ? AND revoked_at IS NULL`,
      )

      .run(new Date().toISOString(), reason, userId).changes,
  )
}

export function listActiveSessions(
  userId: string,
): {
  id: string

  userAgent: string | null

  ipAddress: string | null

  createdAt: string

  lastSeenAt: string

  expiresAt: string
}[] {
  return all<{
    id: string

    user_agent: string | null

    ip_address: string | null

    created_at: string

    last_seen_at: string

    expires_at: string
  }>(
    `SELECT id, user_agent, ip_address, created_at, last_seen_at, expires_at
       FROM sessions
      WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?
      ORDER BY last_seen_at DESC`,

    userId,

    new Date().toISOString(),
  ).map((row) => ({
    id: String(row.id),

    userAgent: row.user_agent === null ? null : String(row.user_agent),

    ipAddress: row.ip_address === null ? null : String(row.ip_address),

    createdAt: String(row.created_at),

    lastSeenAt: String(row.last_seen_at),

    expiresAt: String(row.expires_at),
  }))
}

export function purgeExpiredSessions(): number {
  return Number(
    getDb()

      .prepare("DELETE FROM sessions WHERE expires_at < ?")

      .run(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
      .changes,
  )
}

function toSessionUser(row: UserRow): SessionUser {
  return {
    id: row.id,

    email: row.email,

    fullName: row.full_name,

    jobTitle: row.job_title,

    status: row.status,

    twofaEnabled: row.twofa_enabled === 1,

    lastLoginAt: row.last_login_at,

    createdAt: row.created_at,
  }
}
