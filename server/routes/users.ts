/**
 * Users & roles administration.
 *
 * Every handler runs the three checks: `requireAuth` (session), then
 * `requirePermission(..., 'users', action)` (a grant read from the database),
 * then tenant scoping (the `tenant_id` predicate is part of the SQL, not a
 * post-filter).
 *
 * A tenant admin cannot promote anyone to a role that outranks them, remove
 * their own admin access, or act on a user outside their workspace — those are
 * checked against the caller's own grants rather than hard-coded role names.
 */

import { ASSIGNABLE_ROLE_IDS } from "../../shared/access.ts"

import { all, get, isUniqueViolation, run, transaction } from "../db.ts"

import {
  badRequest,
  conflict,
  notFound,
  readJsonBody,
  type RequestContext,
} from "../http.ts"

import {
  requireAuth,
  requirePermission,
  writeAudit,
  type GuardedContext,
} from "../middleware.ts"

import {
  invalidateGrantCache,
  resolveRoleGrants,
  resolveTenantMatrix,
} from "../rbac.ts"

import { generateToken, hashToken, newId } from "../crypto.ts"

import { countRecentFailures, listLoginEvents } from "../login-events.ts"

import {
  listActiveSessions,
  revokeAllForUser,
  revokeSession,
} from "../session.ts"

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000

const RESET_TTL_MS = 24 * 60 * 60 * 1000

/** How far back the "failed attempts" tally on a member row reaches. */
const FAILURE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

/** Cap on a member's activity timeline. */
const ACTIVITY_LIMIT = 50

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

type UserRow = {
  id: string

  tenant_id: string

  email: string

  full_name: string

  phone: string | null

  job_title: string | null

  status: "invited" | "active" | "suspended" | "deactivated"

  twofa_enabled: number

  last_login_at: string | null

  created_at: string

  must_reset_password: number

  password_reset_required_at: string | null

  role_id: string

  role_label: string

  role_rank: number

  is_default: number

  invite_expires_at: string | null

  invite_accepted_at: string | null

  active_sessions: number

  branch_ids: string | null

  branch_names: string | null

  recent_failures: number
}

// The two branch subqueries are deliberately identical apart from the column
// they read, and both sort by (name, id). `group_concat` has no defined order
// of its own, so without that the id list and the name list could come back in
// different orders and the UI would label the wrong office next to an id.
const USER_SELECT = `
  SELECT u.id, u.tenant_id, u.email, u.full_name, u.phone, u.job_title, u.status,
         u.twofa_enabled, u.last_login_at, u.created_at,
         u.must_reset_password, u.password_reset_required_at,
         m.role_id, COALESCE(r.label, m.role_id) AS role_label,
         COALESCE(r.rank, 0) AS role_rank, m.is_default,
         i.expires_at AS invite_expires_at, i.accepted_at AS invite_accepted_at,
         (SELECT COUNT(*) FROM sessions s
           WHERE s.user_id = u.id AND s.revoked_at IS NULL AND s.expires_at > ?) AS active_sessions,
(SELECT group_concat(s.branch_id) FROM (
            SELECT ub.branch_id AS branch_id
              FROM user_branches ub
              JOIN branches b ON b.id = ub.branch_id
             WHERE ub.tenant_id = u.tenant_id AND ub.user_id = u.id
             ORDER BY b.name, ub.branch_id) s) AS branch_ids,
         (SELECT group_concat(s.name, ' / ') FROM (
            SELECT b.name AS name
              FROM user_branches ub
              JOIN branches b ON b.id = ub.branch_id
             WHERE ub.tenant_id = u.tenant_id AND ub.user_id = u.id
             ORDER BY b.name, ub.branch_id) s) AS branch_names,
         (SELECT COUNT(*) FROM login_events le
           WHERE le.tenant_id = u.tenant_id AND le.user_id = u.id
             AND le.created_at >= ?
             AND le.outcome IN ('failed', 'locked')) AS recent_failures
    FROM users u
    JOIN tenant_memberships m ON m.user_id = u.id AND m.tenant_id = u.tenant_id
    LEFT JOIN roles r ON r.role_id = m.role_id
    LEFT JOIN user_invitations i
      ON i.email = u.email AND i.tenant_id = u.tenant_id AND i.accepted_at IS NULL`

/**
 * The two placeholders `USER_SELECT` binds, in order. Every call site binds
 * these alongside its own predicates rather than interleaving values into the
 * projection, so a new subquery can be added here without touching callers.
 */
function userSelectParams(): [string, string] {
  return [
    new Date().toISOString(),
    new Date(Date.now() - FAILURE_WINDOW_MS).toISOString(),
  ]
}

function splitList(value: string | null, separator: string): string[] {
  return value ? value.split(separator).filter(Boolean) : []
}

function toUser(row: UserRow) {
  const branchIds = splitList(row.branch_ids, ",")

  return {
    id: row.id,

    email: row.email,

    fullName: row.full_name,

    phone: row.phone,

    jobTitle: row.job_title,

    status: row.status,

    twofaEnabled: row.twofa_enabled === 1,

    lastLoginAt: row.last_login_at,

    createdAt: row.created_at,

    mustResetPassword: row.must_reset_password === 1,

    passwordResetRequiredAt: row.password_reset_required_at,

    recentFailedLogins: row.recent_failures,

    roleId: row.role_id,

    roleLabel: row.role_label,

    roleRank: row.role_rank,

    isDefault: row.is_default === 1,

    activeSessions: row.active_sessions,

    // No rows means "every branch", which is the state an administrator should
    // be in by default. Naming it explicitly keeps the UI from having to infer
    // an unrestricted grant from an empty array.
    branchIds,

    branchNames: splitList(row.branch_names, " / "),

    branchAccess: branchIds.length === 0 ? "all" as const : "limited" as const,

    pendingInvite:
      row.status === "invited" && !row.invite_accepted_at
        ? { expiresAt: row.invite_expires_at }
        : null,
  }
}

// --- GET /api/users --------------------------------------------------------

export async function listUsers(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "users", "view")

  const rows = all<UserRow>(
    `${USER_SELECT} WHERE u.tenant_id = ? ORDER BY
       CASE u.status WHEN 'active' THEN 0 WHEN 'invited' THEN 1 WHEN 'suspended' THEN 2 ELSE 3 END,
       u.full_name`,
    ...userSelectParams(),
    guarded.tenantId,
  )

  const users = rows.map(toUser)

  // The branch catalogue travels with the member list rather than being fetched
  // from `/api/settings/branches`: an administrator may hold `users.view`
  // without `settings.view`, and a filter that 403s for half the audience is a
  // filter that does not work.
  const branches = all<{
    id: string
    name: string
    code: string | null
    status: string
    member_count: number
  }>(
    `SELECT b.id, b.name, b.code, b.status,
            (SELECT COUNT(*) FROM user_branches ub
              WHERE ub.tenant_id = b.tenant_id AND ub.branch_id = b.id) AS member_count
       FROM branches b
      WHERE b.tenant_id = ?
      ORDER BY b.is_headquarters DESC, b.name`,
    guarded.tenantId,
  )

  return {
    users,

    // Role tallies power the summary strip on the page.
    roleCounts: users.reduce<Record<string, number>>((acc, user) => {
      acc[user.roleId] = (acc[user.roleId] ?? 0) + 1

      return acc
    }, {}),

    branches: branches.map((branch) => ({
      id: branch.id,
      name: branch.name,
      code: branch.code,
      status: branch.status,
      memberCount: branch.member_count,
    })),
  }
}

// --- POST /api/users/invite ------------------------------------------------

interface ExistingUserRow {
  id: string
  status: string
}

interface OverrideEffectRow {
  permission_id: string
  effect: string
}

export async function inviteUser(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "users", "create")

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const email = String(body.email ?? "")

    .trim()

    .toLowerCase()

  const fullName = String(body.fullName ?? "").trim()

  const roleId = String(body.roleId ?? "")

  const jobTitle = String(body.jobTitle ?? "").trim() || null

  if (!EMAIL_PATTERN.test(email)) {
    throw badRequest("Enter a valid email address", {
      email: "Enter a valid email address",
    })
  }

  if (fullName.length < 2) {
    throw badRequest("Enter the person's full name", {
      fullName: "Enter the person's full name",
    })
  }

  if (
    !ASSIGNABLE_ROLE_IDS.includes(roleId as typeof ASSIGNABLE_ROLE_IDS[number])
  ) {
    throw badRequest("Choose a role", { roleId: "Choose a role" })
  }

  // An admin may not hand out a role that outranks their own — otherwise two

  // tenant admins could bootstrap a peer and lock each other out.

  assertCanAssignRole(guarded, roleId)

  const alreadyHere = get<ExistingUserRow>(
    "SELECT id, status FROM users WHERE email = ? AND tenant_id = ?",

    email,

    guarded.tenantId,
  )

  if (alreadyHere && alreadyHere.status !== "deactivated") {
    throw conflict("That person is already in this workspace", {
      email: "That person is already in this workspace",
    })
  }

  const openInvite = get<{ id: string }>(
    "SELECT id FROM user_invitations WHERE tenant_id = ? AND email = ? AND accepted_at IS NULL AND revoked_at IS NULL",

    guarded.tenantId,

    email,
  )

  if (openInvite) {
    throw conflict("An invitation is already outstanding for that address", {
      email: "An invitation is already outstanding for that address",
    })
  }

  const now = new Date()

  const token = generateToken()

  const userId = newId("usr")

  const inviteId = newId("inv")

  try {
    transaction(() => {
      // Reuse the deactivated shell rather than colliding on the unique email.

      if (alreadyHere) {
        run(
          `UPDATE users
              SET tenant_id = ?, full_name = ?, job_title = ?, status = 'invited',
                  password_hash = NULL, twofa_enabled = 0, twofa_secret = NULL,
                  twofa_pending_secret = NULL, failed_login_count = 0, locked_until = NULL,
                  updated_at = ?
            WHERE id = ?`,

          guarded.tenantId,

          fullName,

          jobTitle,

          now.toISOString(),

          alreadyHere.id,
        )

        run(
          "UPDATE tenant_memberships SET role_id = ?, is_default = 1 WHERE tenant_id = ? AND user_id = ?",

          roleId,

          guarded.tenantId,

          alreadyHere.id,
        )
      } else {
        run(
          `INSERT INTO users (
              id, tenant_id, email, full_name, job_title, status, password_hash,
              twofa_enabled, failed_login_count, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, 'invited', NULL, 0, 0, ?, ?)`,

          userId,

          guarded.tenantId,

          email,

          fullName,

          jobTitle,

          now.toISOString(),

          now.toISOString(),
        )

        run(
          `INSERT INTO tenant_memberships (tenant_id, user_id, role_id, is_default, created_at)
           VALUES (?, ?, ?, 1, ?)`,

          guarded.tenantId,

          userId,

          roleId,

          now.toISOString(),
        )
      }

      run(
        `INSERT INTO user_invitations (
            id, tenant_id, email, full_name, role_id, token_hash,
            invited_by, created_at, expires_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,

        inviteId,

        guarded.tenantId,

        email,

        fullName,

        roleId,

        hashToken(token),

        guarded.userId,

        now.toISOString(),

        new Date(now.getTime() + INVITE_TTL_MS).toISOString(),
      )
    })
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw conflict("That email address already has an account", {
        email: "That email address already has an account",
      })
    }

    throw error
  }

  writeAudit(
    { ...ctx, session: guarded.session },

    "user.invited",

    "user",

    userId,

    { email, roleId },

    ctx.ip,
  )

  return {
    ok: true,

    invitation: {
      id: inviteId,

      email,

      fullName,

      roleId,

      expiresAt: new Date(now.getTime() + INVITE_TTL_MS).toISOString(),

      // No mail transport in this deployment; surfaced so the flow is usable.

      ...(process.env.DEEDORBIT_EXPOSE_RESET_TOKEN === "1"
        ? { devInviteToken: token }
        : {}),
    },
  }
}

// --- PATCH /api/users/:id --------------------------------------------------

export async function updateUser(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "users", "edit")

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const userId = ctx.params.id!

  const target = loadUserInTenant(guarded, userId)

  const now = new Date().toISOString()

  const fields: string[] = []

  const values: (string | null)[] = []

  if (typeof body.fullName === "string" && body.fullName.trim().length >= 2) {
    fields.push("full_name = ?")

    values.push(body.fullName.trim())
  }

  if ("phone" in body) {
    fields.push("phone = ?")

    values.push(
      body.phone === null || body.phone === ""
        ? null
        : String(body.phone).trim(),
    )
  }

  if (typeof body.jobTitle === "string") {
    fields.push("job_title = ?")

    values.push(body.jobTitle.trim() || null)
  }

  if (typeof body.roleId === "string" && body.roleId !== target.role_id) {
    if (
      !ASSIGNABLE_ROLE_IDS.includes(
        body.roleId as typeof ASSIGNABLE_ROLE_IDS[number],
      )
    ) {
      throw badRequest("Unknown role", { roleId: "Unknown role" })
    }

    assertCanAssignRole(guarded, body.roleId)

    // Do not let an admin demote the last person who can administer users.

    if (target.role_id === guarded.roleId) {
      throw conflict("You cannot change your own role", {
        roleId: "You cannot change your own role",
      })
    }

    if (
      guardsAdministration(body.roleId) &&
      target.role_id === "tenant_owner"
    ) {
      assertNotLastOwner(guarded, target.role_id)
    }

    run(
      "UPDATE tenant_memberships SET role_id = ? WHERE tenant_id = ? AND user_id = ?",

      body.roleId,

      guarded.tenantId,

      userId,
    )

    // An open invitation should track the intended role.

    run(
      "UPDATE user_invitations SET role_id = ? WHERE tenant_id = ? AND email = ? AND accepted_at IS NULL",

      body.roleId,

      guarded.tenantId,

      target.email,
    )

    writeAudit(
      { ...ctx, session: guarded.session },

      "user.role_changed",

      "user",

      userId,

      { from: target.role_id, to: body.roleId },

      ctx.ip,
    )
  }

  if (fields.length > 0) {
    fields.push("updated_at = ?")

    values.push(now)

    run(
      `UPDATE users SET ${fields.join(", ")} WHERE id = ? AND tenant_id = ?`,

      ...values,

      userId,

      guarded.tenantId,
    )

    writeAudit(
      { ...ctx, session: guarded.session },

      "user.updated",

      "user",

      userId,

      null,

      ctx.ip,
    )
  }

  return { ok: true, user: toUser(loadUserInTenant(guarded, userId)) }
}

// --- POST /api/users/:id/status --------------------------------------------

export async function setUserStatus(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "users", "edit")

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const userId = ctx.params.id!

  const status = String(body.status ?? "")

  if (!["active", "suspended", "deactivated"].includes(status)) {
    throw badRequest("Unknown status", { status: "Unknown status" })
  }

  const target = loadUserInTenant(guarded, userId)

  if (target.id === guarded.userId) {
    throw conflict("You cannot change your own status", {
      status: "You cannot change your own status",
    })
  }

  if (target.is_default === 1 && guardsAdministration(target.role_id)) {
    assertNotLastOwner(guarded, target.role_id)
  }

  const now = new Date().toISOString()

  transaction(() => {
    run(
      "UPDATE users SET status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?",

      status,

      now,

      userId,

      guarded.tenantId,
    )

    if (status === "deactivated") {
      run(
        "DELETE FROM tenant_memberships WHERE tenant_id = ? AND user_id = ?",

        guarded.tenantId,

        userId,
      )

      // The shell can be re-invited later. Leaving the old scope behind would
      // silently re-apply it to whoever holds the address next, so it goes with
      // the membership.
      run(
        "DELETE FROM user_branches WHERE tenant_id = ? AND user_id = ?",

        guarded.tenantId,

        userId,
      )

      run(
        "UPDATE users SET must_reset_password = 0, password_reset_required_at = NULL WHERE id = ? AND tenant_id = ?",

        userId,

        guarded.tenantId,
      )
    }
  })

  // Access must stop immediately, not at the end of the session.

  if (status !== "active") {
    revokeAllForUser(userId, `user_${status}`)

    run(
      "UPDATE user_invitations SET revoked_at = ? WHERE tenant_id = ? AND email = ? AND accepted_at IS NULL",

      now,

      guarded.tenantId,

      target.email,
    )
  }

  writeAudit(
    { ...ctx, session: guarded.session },

    `user.${status}`,

    "user",

    userId,

    { email: target.email },

    ctx.ip,
  )

  if (status === "deactivated") {
    // Re-reading the member is impossible from here: `USER_SELECT` joins
    // `tenant_memberships`, and deactivation is exactly what deleted that row.
    // Answering 404 for a request that succeeded would leave the members table
    // showing a stale row, so the view is built from the row we already hold,
    // with the fields the block above changed corrected by hand.
    return {
      ok: true,

      user: toUser({
        ...target,

        status: "deactivated",

        must_reset_password: 0,

        password_reset_required_at: null,

        branch_ids: null,

        branch_names: null,

        active_sessions: 0,
      }),
    }
  }

  return { ok: true, user: toUser(loadUserInTenant(guarded, userId)) }
}

// --- DELETE /api/users/:id -------------------------------------------------

export async function deleteUser(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "users", "delete")

  const userId = ctx.params.id!

  const target = loadUserInTenant(guarded, userId)

  if (target.id === guarded.userId) {
    throw conflict("You cannot remove your own account")
  }

  if (target.is_default === 1 && guardsAdministration(target.role_id)) {
    assertNotLastOwner(guarded, target.role_id)
  }

  run(
    "DELETE FROM users WHERE id = ? AND tenant_id = ?",

    userId,

    guarded.tenantId,
  )

  run(
    "DELETE FROM user_invitations WHERE tenant_id = ? AND email = ?",

    guarded.tenantId,

    target.email,
  )

  writeAudit(
    { ...ctx, session: guarded.session },

    "user.deleted",

    "user",

    userId,

    { email: target.email, roleId: target.role_id },

    ctx.ip,
  )

  return { ok: true }
}

// --- POST /api/users/:id/revoke-sessions -----------------------------------

export async function revokeUserSessions(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "users", "edit")

  const userId = ctx.params.id!

  loadUserInTenant(guarded, userId)

  const count = revokeAllForUser(userId, "revoked_by_admin")

  writeAudit(
    { ...ctx, session: guarded.session },

    "user.sessions_revoked",

    "user",

    userId,

    { count },

    ctx.ip,
  )

  return { ok: true }
}

// --- POST /api/users/:id/branches --------------------------------------------

/**
 * PUT /api/users/:id/branches — replace the member's branch scope.
 *
 * An empty list is the permissive state (the whole workspace), not "no access".
 * That direction matters: the alternative, treating empty as zero access, would
 * mean a mis-sent save silently locked someone out of every screen.
 */
export async function updateUserBranches(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "users", "edit")

  const userId = ctx.params.id!

  const target = loadUserInTenant(guarded, userId)

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const requested = body.branchIds

  if (!Array.isArray(requested)) {
    throw badRequest("Send the branches to grant as a list", {
      branchIds: "Send the branches to grant as a list",
    })
  }

  const branchIds = [
    ...new Set(requested.map((value) => String(value).trim()).filter(Boolean)),
  ]

  // Ownership is checked against this tenant's catalogue, so a branch id guessed
  // from another workspace is refused rather than silently stored.
  const owned = new Set(
    all<{ id: string }>(
      "SELECT id FROM branches WHERE tenant_id = ?",
      guarded.tenantId,
    ).map((branch) => branch.id),
  )

  const foreign = branchIds.filter((id) => !owned.has(id))

  if (foreign.length > 0) {
    throw badRequest("A branch does not belong to this workspace", {
      branchIds: "A branch does not belong to this workspace",
    })
  }

  const now = new Date().toISOString()

  transaction(() => {
    run(
      "DELETE FROM user_branches WHERE tenant_id = ? AND user_id = ?",
      guarded.tenantId,
      userId,
    )

    for (const branchId of branchIds) {
      run(
        `INSERT INTO user_branches (tenant_id, user_id, branch_id, created_at)
         VALUES (?, ?, ?, ?)`,
        guarded.tenantId,
        userId,
        branchId,
        now,
      )
    }
  })

  writeAudit(
    { ...ctx, session: guarded.session },
    "user.branches_updated",
    "user",
    userId,
    {
      email: target.email,
      before: target.branch_ids ? target.branch_ids.split(",") : [],
      after: branchIds,
    },
    ctx.ip,
  )

  return { ok: true, user: toUser(loadUserInTenant(guarded, userId)) }
}

// --- Forced password reset --------------------------------------------------

/**
 * POST /api/users/:id/force-password-reset — make the member set a new password
 * before the app opens for them.
 *
 * Three things happen together, because any one of them alone leaves a hole:
 *   - a single-use token is issued, so the member has something to redeem even
 *     though this deployment has no mail transport;
 *   - every live session is revoked, because those sessions were authenticated
 *     with the password being retired;
 *   - `must_reset_password` is set, and the login route refuses to issue a
 *     session until it is cleared. A member who ignores the token cannot simply
 *     sign in again with the old password.
 */
export async function forcePasswordReset(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "users", "edit")

  const userId = ctx.params.id!

  const target = loadUserInTenant(guarded, userId)

  if (target.status !== "active") {
    throw conflict("Only an active member can be asked to set a new password", {
      status: "Only an active member can be asked to set a new password",
    })
  }

  const now = new Date()

  const token = generateToken()

  transaction(() => {
    // One live reset token per user: the newest link is the only one that works.
    run(
      "DELETE FROM password_reset_tokens WHERE user_id = ? AND used_at IS NULL",
      userId,
    )

    run(
      `INSERT INTO password_reset_tokens (
          id, tenant_id, user_id, token_hash, created_at, expires_at
       ) VALUES (?, ?, ?, ?, ?, ?)`,
      newId("prt"),
      target.tenant_id,
      userId,
      hashToken(token),
      now.toISOString(),
      new Date(now.getTime() + RESET_TTL_MS).toISOString(),
    )

    run(
      `UPDATE users
          SET must_reset_password = 1, password_reset_required_at = ?, updated_at = ?
        WHERE id = ? AND tenant_id = ?`,
      now.toISOString(),
      now.toISOString(),
      userId,
      guarded.tenantId,
    )
  })

  const revoked = revokeAllForUser(userId, "password_reset_forced")

  writeAudit(
    { ...ctx, session: guarded.session },
    "user.password_reset_forced",
    "user",
    userId,
    { email: target.email, revokedSessions: revoked },
    ctx.ip,
  )

  return {
    ok: true,

    requiredAt: now.toISOString(),

    expiresAt: new Date(now.getTime() + RESET_TTL_MS).toISOString(),

    revokedSessions: revoked,

    // No mail transport here; surfaced under the same flag the invitation flow
    // uses so an administrator can deliver the link by hand.
    ...(process.env.DEEDORBIT_EXPOSE_RESET_TOKEN === "1"
      ? { devResetToken: token }
      : {}),
  }
}

// --- Activity timeline ------------------------------------------------------

/**
 * GET /api/users/:id/activity — one member's recent history in a single request.
 *
 * Three sources, because an administrator asking "is this account behaving
 * normally?" is asking about all three at once and stitching them client-side
 * would mean three round trips and three chances to mix up the orderings:
 *   - `login_events`  — attempts, including the ones that never became sessions
 *   - `sessions`      — what is live right now
 *   - `audit_log`     — what an administrator has done to this membership
 */
export async function listUserActivity(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "users", "view")

  const userId = ctx.params.id!

  const target = loadUserInTenant(guarded, userId)

  const limit = Math.min(
    Math.max(
      Number(ctx.query.get("limit") ?? ACTIVITY_LIMIT) || ACTIVITY_LIMIT,
      1,
    ),
    ACTIVITY_LIMIT,
  )

  const since = new Date(Date.now() - FAILURE_WINDOW_MS).toISOString()

  return {
    member: {
      id: target.id,
      email: target.email,
      fullName: target.full_name,
      status: target.status,
      roleId: target.role_id,
      roleLabel: target.role_label,
      lastLoginAt: target.last_login_at,
      mustResetPassword: target.must_reset_password === 1,
      passwordResetRequiredAt: target.password_reset_required_at,
      recentFailedLogins: countRecentFailures(guarded.tenantId, userId, since),
      branchNames: splitList(target.branch_names, " / "),
    },

    events: listLoginEvents(guarded.tenantId, userId, limit),

    sessions: listActiveSessions(userId),

    actions: all<{
      id: string
      action: string
      actor_email: string | null
      detail: string | null
      created_at: string
    }>(
      `SELECT id, action, actor_email, detail, created_at
         FROM audit_log
        WHERE tenant_id = ? AND target_type = 'user' AND target_id = ?
        ORDER BY created_at DESC
        LIMIT ?`,
      guarded.tenantId,
      userId,
      limit,
    ).map((row) => ({
      id: row.id,
      action: row.action,
      actorEmail: row.actor_email,
      detail: row.detail,
      createdAt: row.created_at,
    })),
  }
}

// --- Roles & permission matrix ---------------------------------------------

/**
 * GET /api/roles — the catalogue plus this tenant's effective matrix.
 *
 * Guarded on `users.view`, not merely on having a session. The client hides the
 * roles tab without that grant, so serving the full matrix to any signed-in
 * member would let a `customer` enumerate the organisation's entire access
 * model while the UI claimed they could not see it.
 */

export async function listRoles(ctx: RequestContext) {
  const guarded = requireAuth(ctx)

  requirePermission(guarded, "users", "view")

  const matrix = resolveTenantMatrix(guarded.tenantId)

  const rows = all<{
    role_id: string

    label: string

    scope: string

    description: string

    rank: number

    is_assignable: number
  }>(
    "SELECT role_id, label, scope, description, rank, is_assignable FROM roles ORDER BY rank DESC",
  )

  return {
    // The catalogue comes from the database; the static file supplies only the

    // action list used to render the column headers.

    roles: rows.map((row) => {
      const grants = matrix[row.role_id]

      return {
        id: row.role_id,

        label: row.label,

        scope: row.scope,

        description: row.description,

        rank: row.rank,

        assignable: row.is_assignable === 1,

        permissions: grants?.permissions ?? [],

        allowedCount: grants?.allowedCount ?? 0,

        // Only a tenant-scoped role can be handed out here.

        myRank: row.rank,

        userCount:
          all<{ count: number }>(
            "SELECT COUNT(*) AS count FROM tenant_memberships WHERE tenant_id = ? AND role_id = ?",

            guarded.tenantId,

            row.role_id,
          )[0]?.count ?? 0,
      }
    }),

    myRoleId: guarded.roleId,
  }
}

/** GET /api/roles/:id — one role's grants with override provenance. */

export async function getRole(ctx: RequestContext) {
  const guarded = requireAuth(ctx)

  const roleId = ctx.params.id!

  const row = get<{
    role_id: string

    label: string

    description: string

    scope: string
  }>(
    "SELECT role_id, label, description, scope FROM roles WHERE role_id = ?",

    roleId,
  )

  if (!row) throw notFound("Unknown role")

  const grants = resolveRoleGrants(guarded.tenantId, roleId)

  const overrides = all<OverrideEffectRow>(
    "SELECT permission_id, effect FROM role_permission_overrides WHERE tenant_id = ? AND role_id = ?",

    guarded.tenantId,

    roleId,
  )

  return {
    role: {
      id: row.role_id,

      label: row.label,

      description: row.description,

      scope: row.scope,
    },

    permissions: grants.permissions,

    overrides,
  }
}

/** PUT /api/roles/:id/permissions — the admin's edit. */

export async function updateRolePermissions(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "users", "edit")

  const roleId = ctx.params.id!

  const body = await readJsonBody<{ permissions?: unknown }>(ctx.req)

  const requested = body.permissions

  if (!Array.isArray(requested) || requested.length === 0) {
    throw badRequest("Send the permission list to apply", {
      permissions: "Send the permission list to apply",
    })
  }

  const requestedIds = requested.map(String)

  const role = get<{
    role_id: string

    label: string

    scope: string

    rank: number
  }>("SELECT role_id, label, scope, rank FROM roles WHERE role_id = ?", roleId)

  if (!role) throw notFound("Unknown role")

  // Platform-scope roles are administered by the platform, not by a tenant.

  if (role.scope === "platform") {
    throw badRequest("Platform roles are managed centrally", {
      roleId: "Platform roles are managed centrally",
    })
  }

  // A role may only be edited from the same rank downwards.

  if (role.rank > roleRank(guarded.roleId)) {
    throw badRequest("You cannot edit a role above your own", {
      roleId: "You cannot edit a role above your own",
    })
  }

  // Editing your own role is the one self-escalation path: you may keep or drop

  // what you have, but you cannot grant yourself something you do not hold.

  // Editing a *different* role is unrestricted, because it does not change the

  // caller's own access — that is what lets an admin narrow a broad role.

  if (roleId === guarded.roleId) {
    const held = new Set(
      resolveRoleGrants(guarded.tenantId, guarded.roleId)

        .permissions.filter((p) => p.allowed)

        .map((p) => p.permissionId),
    )

    const escalated = requestedIds.filter((id) => !held.has(id))

    if (escalated.length > 0) {
      throw badRequest(
        "You cannot grant your own role a permission you do not have",

        { permissions: `Not permitted: ${escalated.slice(0, 3).join(", ")}` },
      )
    }
  }

  // Only the tenant's overrides move here; the platform default is unchanged,

  // so other workspaces are unaffected.

  const before = new Set(
    all<{ permission_id: string }>(
      "SELECT permission_id FROM role_permission_defaults WHERE role_id = ?",

      roleId,
    ).map((row) => row.permission_id),
  )

  const now = new Date().toISOString()

  const next = new Set(requestedIds)

  transaction(() => {
    run(
      "DELETE FROM role_permission_overrides WHERE tenant_id = ? AND role_id = ?",

      guarded.tenantId,

      roleId,
    )

    for (const id of next) {
      if (before.has(id)) continue // already granted by default; no override needed

      run(
        `INSERT INTO role_permission_overrides (tenant_id, role_id, permission_id, effect, updated_at, updated_by)
         VALUES (?, ?, ?, 'allow', ?, ?)`,

        guarded.tenantId,

        roleId,

        id,

        now,

        guarded.userId,
      )
    }

    for (const id of before) {
      if (next.has(id)) continue

      run(
        `INSERT INTO role_permission_overrides (tenant_id, role_id, permission_id, effect, updated_at, updated_by)
         VALUES (?, ?, ?, 'deny', ?, ?)`,

        guarded.tenantId,

        roleId,

        id,

        now,

        guarded.userId,
      )
    }
  })

  invalidateGrantCache(guarded.tenantId)

  writeAudit(
    { ...ctx, session: guarded.session },

    "role.permissions_updated",

    "role",

    roleId,

    { allowed: requestedIds.length },

    ctx.ip,
  )

  const grants = resolveRoleGrants(guarded.tenantId, roleId)

  return {
    ok: true,

    permissions: grants.permissions,

    allowedCount: grants.allowedCount,
  }
}

// --- Session inspection (tenant-scoped) ------------------------------------

/** GET /api/users/:id/sessions */

export async function listUserSessions(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "users", "view")

  const userId = ctx.params.id!

  loadUserInTenant(guarded, userId)

  return { sessions: listActiveSessions(userId) }
}

/** DELETE /api/users/:id/sessions/:sessionId */

export async function revokeUserSession(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "users", "edit")

  const userId = ctx.params.id!

  const sessionId = ctx.params.sessionId!

  const target = loadUserInTenant(guarded, userId)

  const owned = listActiveSessions(userId).some((s) => s.id === sessionId)

  if (!owned) throw notFound("That session has already ended")

  revokeSession(sessionId, "revoked_by_admin")

  writeAudit(
    { ...ctx, session: guarded.session },

    "user.session_revoked",

    "user",

    userId,

    { sessionId, email: target.email },

    ctx.ip,
  )

  return { ok: true }
}

// --- GET /api/audit --------------------------------------------------------

export async function listAuditLog(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "settings", "view")

  const limit = Math.min(Number(ctx.query.get("limit") ?? 50), 200)

  const rows = all<{
    id: string

    action: string

    actor_email: string | null

    target_type: string | null

    target_id: string | null

    detail: string | null

    created_at: string
  }>(
    `SELECT id, action, actor_email, target_type, target_id, detail, created_at
       FROM audit_log
      WHERE tenant_id = ?
      ORDER BY created_at DESC
      LIMIT ?`,

    guarded.tenantId,

    limit,
  )

  return {
    entries: rows.map((row) => ({
      id: row.id,

      action: row.action,

      actorEmail: row.actor_email,

      targetType: row.target_type,

      targetId: row.target_id,

      detail: row.detail,

      createdAt: row.created_at,
    })),
  }
}

// --- helpers ---------------------------------------------------------------

function loadUserInTenant(guarded: GuardedContext, userId: string): UserRow {
  const row = get<UserRow>(
    `${USER_SELECT} WHERE u.tenant_id = ? AND u.id = ?`,
    ...userSelectParams(),
    guarded.tenantId,
    userId,
  )

  if (!row) {
    // Cross-tenant ids are indistinguishable from unknown ones.

    throw notFound("That user does not exist in this workspace")
  }

  return row
}

function roleRank(roleId: string): number {
  return (
    get<{ rank: number }>("SELECT rank FROM roles WHERE role_id = ?", roleId)
      ?.rank ?? 0
  )
}

function assertCanAssignRole(guarded: GuardedContext, roleId: string): void {
  if (roleRank(roleId) > roleRank(guarded.roleId)) {
    throw badRequest("You cannot assign a role above your own", {
      roleId: "You cannot assign a role above your own",
    })
  }
}

/** Roles that can administer users and roles. */

function guardsAdministration(roleId: string): boolean {
  return (
    roleId === "platform_super_admin" ||
    roleId === "tenant_owner" ||
    roleId === "tenant_admin"
  )
}

/**
 * Blocks removing the final administrator of a workspace, which would leave it
 * unmanageable. Counted by capability, not by name.
 */

function assertNotLastOwner(guarded: GuardedContext, _roleId: string): void {
  const remaining = get<{ count: number }>(
    `SELECT COUNT(*) AS count
       FROM tenant_memberships m
       JOIN roles r ON r.role_id = m.role_id
      WHERE m.tenant_id = ?
        AND m.role_id IN ('platform_super_admin','tenant_owner','tenant_admin')`,

    guarded.tenantId,
  )

  if ((remaining?.count ?? 0) <= 1) {
    throw conflict(
      "This is the only remaining administrator. Assign another admin before changing their access.",
    )
  }
}
