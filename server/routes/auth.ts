/**
 * Authentication: signup, login, session, password reset, and optional 2FA.
 *
 * Two rules shape everything here:
 *
 *  - Responses never reveal whether an account exists. `forgot-password`
 *    answers identically for a known and an unknown address, and a failed login
 *    says "email or password is incorrect" rather than which half was wrong.
 *
 *  - 2FA is opt-in per user and enforced only when a secret exists. The
 *    enrolment endpoints are live, but nothing requires a second factor until
 *    an account turns it on — so enabling it later needs no migration.
 */

import {
  checkPassword,
  generatePassword,
  generateRecoveryCodes,
  generateToken,
  generateTwofaSecret,
  hashPassword,
  hashToken,
  newId,
  otpauthUrl,
  totpCode,
  verifyPassword,
  verifyTotp,
} from "../crypto.ts"

import { get, getDb, isUniqueViolation, run, transaction } from "../db.ts"

import {
  badRequest,
  clearCookie,
  conflict,
  forbidden,
  readJsonBody,
  setCookie,
  tooManyRequests,
  unauthorized,
  type RequestContext,
} from "../http.ts"

import { requireAuth, writeAudit } from "../middleware.ts"

import { recordLoginEvent } from "../login-events.ts"

import type { LoginOutcome } from "../login-events.ts"

import { invalidateGrantCache, resolveRoleGrants } from "../rbac.ts"

import {
  SESSION_COOKIE,
  confirmTwofa,
  createSession,
  listActiveSessions,
  revokeAllForUser,
  revokeSession,
  switchSessionTenant,
  verifySessionToken,
  type SessionRecord,
} from "../session.ts"

import { BUILT_IN_UNIT_STATUSES } from "../../shared/inventory.ts"

import { seedInventoryCategoryOptions } from "../inventory-seed.ts"

import { brand } from "../../shared/brand.ts"

const RESET_TTL_MS = 60 * 60 * 1000

const MAX_FAILED_LOGINS = 8

const LOCKOUT_MS = 15 * 60 * 1000

// --- Login throttling (in-process; single-node deployment) -----------------

interface AttemptWindow {
  count: number
  resetAt: number
}

interface TwofaUserRow {
  email: string
  twofa_secret: string | null
  twofa_enabled: number
}

interface MembershipRow {
  id: string
  tenant_id: string
}

interface PasswordResetRow {
  id: string
  user_id: string
}

const loginAttempts = new Map<string, AttemptWindow>()

function throttleKey(ip: string, email: string): string {
  return `${ip}|${email.toLowerCase()}`
}

function checkThrottle(key: string): void {
  const window = loginAttempts.get(key)

  if (!window) return

  if (Date.now() > window.resetAt) {
    loginAttempts.delete(key)

    return
  }

  if (window.count >= MAX_FAILED_LOGINS) {
    const seconds = Math.ceil((window.resetAt - Date.now()) / 1000)

    throw tooManyRequests(
      `Too many failed attempts. Try again in ${Math.ceil(seconds / 60)} minute(s).`,
    )
  }
}

function recordFailure(key: string): void {
  const existing = loginAttempts.get(key)

  if (!existing || Date.now() > existing.resetAt) {
    loginAttempts.set(key, { count: 1, resetAt: Date.now() + LOCKOUT_MS })

    return
  }

  existing.count += 1
}

function clearFailures(key: string): void {
  loginAttempts.delete(key)
}

// --- Validation ------------------------------------------------------------

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

interface StringBounds {
  min?: number
  max?: number
}

function requireString(
  body: Record<string, unknown>,
  field: string,
  { min = 1, max = 500 }: StringBounds = {},
): string {
  const value = body[field]

  if (typeof value !== "string" || value.trim().length < min) {
    throw badRequest(`${field} is required`, {
      [field]: "This field is required",
    })
  }

  const trimmed = value.trim()

  if (trimmed.length > max) {
    throw badRequest(`${field} is too long`, {
      [field]: `Use at most ${max} characters`,
    })
  }

  return trimmed
}

function requireEmail(body: Record<string, unknown>, field = "email"): string {
  const value = requireString(body, field, { max: 254 }).toLowerCase()

  if (!EMAIL_PATTERN.test(value)) {
    throw badRequest("Enter a valid email address", {
      [field]: "Enter a valid email address",
    })
  }

  return value
}

function slugify(value: string): string {
  return (
    value

      .toLowerCase()

      .normalize("NFKD")

      .replace(/[^a-z0-9]+/g, "-")

      .replace(/^-+|-+$/g, "")

      .slice(0, 48) || "workspace"
  )
}

function uniqueSlug(base: string): string {
  const seed = slugify(base)

  let candidate = seed

  let suffix = 2

  while (get("SELECT id FROM tenants WHERE slug = ?", candidate)) {
    candidate = `${seed}-${suffix}`

    suffix += 1
  }

  return candidate
}

// --- Session payload -------------------------------------------------------

function sessionPayload(session: SessionRecord) {
  const grants = resolveRoleGrants(session.tenantId, session.roleId)

  return {
    user: {
      id: session.user.id,

      email: session.user.email,

      fullName: session.user.fullName,

      jobTitle: session.user.jobTitle,

      twofaEnabled: session.user.twofaEnabled,

      lastLoginAt: session.user.lastLoginAt,
    },

    tenant: {
      id: session.tenant.id,

      name: session.tenant.name,

      legalName: session.tenant.legalName,

      slug: session.tenant.slug,

      logoInitials: session.tenant.logoInitials,
    },

    role: { id: session.roleId, label: session.tenant.roleLabel },

    memberships: session.memberships,

    // Module list drives the navigation; the flat map drives per-action

    // affordances (whether to show Invite, Delete, Approve).

    modules: grants.permissions

      .filter((p) => p.action === "view" && p.allowed)

      .map((p) => p.module),

    permissions: Object.fromEntries(
      grants.permissions.map((p) => [p.permissionId, p.allowed]),
    ),

    expiresAt: session.expiresAt,
  }
}

function issueSessionCookie(ctx: RequestContext, token: string): void {
  setCookie(ctx.res, SESSION_COOKIE, token, {
    maxAgeMs: 7 * 24 * 60 * 60 * 1000,

    httpOnly: true,

    sameSite: "Lax",

    secure: process.env.NODE_ENV === "production",
  })
}

/**
 * Creates a session and reads it straight back, so the handler always returns
 * the same shape a later `GET /session` would — including the full membership
 * list, which the client needs to populate the tenant switcher.
 */

function startSession(
  ctx: RequestContext,

  input: {
    userId: string

    tenantId: string

    roleId: string

    pendingTwofa: boolean
  },
): SessionRecord {
  const { token } = createSession({
    userId: input.userId,

    tenantId: input.tenantId,

    roleId: input.roleId,

    userAgent: ctx.userAgent,

    ipAddress: ctx.ip,

    pendingTwofa: input.pendingTwofa,
  })

  issueSessionCookie(ctx, token)

  const session = verifySessionToken(token)

  if (!session) throw new Error("Session could not be created")

  return session
}

/** Audit helper for events that happen before a session exists. */

function auditAnonymous(
  ctx: RequestContext,

  action: string,

  tenantId: string,

  userId: string,

  email: string,

  targetId?: string,
): void {
  writeAudit(
    {
      ...ctx,

      session: {
        tenantId,

        userId,

        user: { email },
      } as unknown as SessionRecord,
    },

    action,

    "user",

    targetId ?? userId,

    null,

    ctx.ip,
  )
}

// --- Handlers --------------------------------------------------------------

/**
 * GET /api/auth/session — the client's boot call.
 *
 * `twofaRequired` is always present so the client can discriminate on a complete
 * shape. A bare `{ authenticated: false }` would leave "signed out" and "awaiting
 * a second factor" indistinguishable to a type checker.
 */

export async function getSession(ctx: RequestContext) {
  const session = verifySessionToken(ctx.cookies[SESSION_COOKIE] ?? null)

  if (!session)
    return { authenticated: false as const, twofaRequired: false as const }

  if (session.pendingTwofa) {
    return { authenticated: false as const, twofaRequired: true as const }
  }

  return { authenticated: true as const, ...sessionPayload(session) }
}

/** POST /api/auth/signup — creates a workspace and its owning Tenant Admin. */

export async function signup(ctx: RequestContext) {
  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const email = requireEmail(body)

  const password = requireString(body, "password", { min: 1, max: 200 })

  const fullName = requireString(body, "fullName", { min: 2, max: 120 })

  const workspaceName = requireString(body, "workspaceName", {
    min: 2,

    max: 120,
  })

  const check = checkPassword(password)

  if (!check.ok) {
    throw badRequest("Password does not meet the policy", {
      password: check.problems[0],
    })
  }

  if (get("SELECT id FROM users WHERE email = ?", email)) {
    throw conflict("That email address is already registered", {
      email: "That email address is already registered",
    })
  }

  const now = new Date().toISOString()

  const tenantId = newId("tn")

  const userId = newId("usr")

  try {
    transaction(() => {
      run(
        `INSERT INTO tenants (
            id, name, legal_name, slug, status, plan, logo_initials,
            timezone, currency, created_at, updated_at
         ) VALUES (?, ?, NULL, ?, 'active', 'standard', ?, 'Asia/Dubai', 'AED', ?, ?)`,

        tenantId,

        workspaceName,

        uniqueSlug(workspaceName),

        initialsOf(workspaceName),

        now,

        now,
      )

      // A brand-new workspace starts paid-up and unstated: the platform billing
      // route opens it on `current` with no grace, so the directory reads a real
      // row rather than a missing one. This is the only place a subscription is
      // born besides the migration's backfill of pre-existing tenants.
      run(
        `INSERT INTO tenant_subscriptions (
            tenant_id, billing_status, grace_ends_at, grace_reason, updated_at
         ) VALUES (?, 'current', NULL, NULL, ?)`,

        tenantId,

        now,
      )

      run(
        `INSERT INTO users (
            id, tenant_id, email, full_name, status, password_hash,
            password_changed_at, email_verified_at, twofa_enabled,
            failed_login_count, created_at, updated_at
         ) VALUES (?, ?, ?, ?, 'active', ?, ?, ?, 0, 0, ?, ?)`,

        userId,

        tenantId,

        email,

        fullName,

        hashPassword(password),

        now,

        now,

        now,

        now,
      )

      run(
        `INSERT INTO tenant_memberships (tenant_id, user_id, role_id, is_default, created_at)
         VALUES (?, ?, 'tenant_owner', 1, ?)`,

        tenantId,

        userId,

        now,
      )

      // The built-in status vocabulary, from the same table migration 0007 seeded the
      // existing tenants from. A tenant created after that migration would otherwise
      // have no statuses at all, and a unit could not be created in one — which is the
      // first thing the new workspace tries to do. Driven off the shared seeds rather
      // than a second copy of the list in SQL, so the two cannot drift.

      for (const status of BUILT_IN_UNIT_STATUSES) {
        run(
          `INSERT INTO inventory_unit_statuses (
              id, tenant_id, key, label, tone, is_builtin, is_archived, sort_order,
              created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?, ?)`,

          `st_${tenantId}_${status.key}`,

          tenantId,

          status.key,

          status.label,

          status.tone,

          status.sortOrder,

          now,

          now,
        )
      }

      // And the property category lists, from the same shared seeds the migration used
      // for tenants that already existed. A workspace whose Property Type picker is
      // empty cannot classify its first unit, and adding a unit is the first thing a
      // new workspace does.
      seedInventoryCategoryOptions(getDb(), tenantId, now)
    })
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw conflict("That email address is already registered", {
        email: "That email address is already registered",
      })
    }

    throw error
  }

  const session = startSession(ctx, {
    userId,

    tenantId,

    roleId: "tenant_owner",

    pendingTwofa: false,
  })

  invalidateGrantCache(tenantId)

  return { authenticated: true as const, ...sessionPayload(session) }
}

/** POST /api/auth/login */

export async function login(ctx: RequestContext) {
  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const email = requireEmail(body)

  const password = requireString(body, "password", { min: 1, max: 200 })

  const key = throttleKey(ctx.ip, email)

  checkThrottle(key)

  const user = get<{
    id: string

    status: string

    password_hash: string | null

    twofa_enabled: number

    twofa_secret: string | null

    failed_login_count: number

    locked_until: string | null

    must_reset_password: number

    tenant_id: string
  }>(
    `SELECT u.id, u.status, u.password_hash, u.twofa_enabled, u.twofa_secret,
            u.failed_login_count, u.locked_until, u.must_reset_password, u.tenant_id
       FROM users u
      WHERE u.email = ?`,

    email,
  )

  // One generic failure for: unknown email, wrong password, suspended account.

  // The explicit annotation on the *variable* is what lets TypeScript treat

  // these as narrowing points rather than dead code.

  // `outcome` is a parameter so a refused attempt records exactly one row: a

  // suspended account is more usefully filed as `suspended` than as `failed`,

  // but recording both would show the administrator two attempts where there

  // was one.

  const fail: (message: string, outcome?: LoginOutcome) => never = (
    message,

    outcome = "failed",
  ) => {
    recordFailure(key)

    recordLoginEvent({
      tenantId: user?.tenant_id ?? null,
      userId: user?.id ?? null,
      email,
      outcome,
      ip: ctx.ip,
      userAgent: ctx.req.headers["user-agent"] ?? null,
    })

    throw unauthorized(message, "invalid_credentials")
  }

  if (!user) fail("Email or password is incorrect")

  if (user.locked_until && user.locked_until > new Date().toISOString()) {
    recordLoginEvent({
      tenantId: user.tenant_id,
      userId: user.id,
      email,
      outcome: "locked",
      ip: ctx.ip,
      userAgent: ctx.req.headers["user-agent"] ?? null,
    })

    throw tooManyRequests(
      "This account is temporarily locked. Try again shortly.",
    )
  }

  // Checked before the password so the caller learns the account exists but

  // has not been activated yet — there is nothing to guess here.

  if (user.status === "invited") {
    throw forbidden(
      "Your invitation has not been accepted yet. Use the link in your invitation email.",

      "invitation_pending",
    )
  }

  if (user.status !== "active") {
    fail("Email or password is incorrect", "suspended")
  }

  if (!user.password_hash) fail("Email or password is incorrect")

  if (!verifyPassword(password, user.password_hash)) {
    fail("Email or password is incorrect")
  }

  clearFailures(key)

  run(
    "UPDATE users SET failed_login_count = 0, locked_until = NULL, last_login_at = ? WHERE id = ?",

    new Date().toISOString(),

    user.id,
  )

  const membership = get<{
    tenant_id: string

    role_id: string

    is_default: number
  }>(
    `SELECT tenant_id, role_id, is_default
       FROM tenant_memberships
      WHERE user_id = ?
      ORDER BY is_default DESC, created_at
      LIMIT 1`,

    user.id,
  )

  if (!membership) {
    throw forbidden(
      "This account is not a member of any workspace",

      "no_membership",
    )
  }

  // A suspended workspace must refuse sign-in explicitly rather than letting

  // the session bootstrap fail later.

  const tenant = get<{ status: string }>(
    "SELECT status FROM tenants WHERE id = ?",

    membership.tenant_id,
  )

  if (!tenant) {
    throw forbidden(
      "This account is not a member of any workspace",

      "no_membership",
    )
  }

  if (tenant.status !== "active") {
    // A platform-scope member is the exception: the operator who suspends a
    // workspace must be able to sign in to the console that reverses it, even
    // when their own default membership lives inside that workspace. The
    // refusal is a tenant-lifecycle rule, and platform scope sits outside any
    // single tenant.
    const callerRole = get<{ scope: string }>(
      "SELECT scope FROM roles WHERE role_id = ?",

      membership.role_id,
    )

    if (callerRole?.scope !== "platform") {
      throw forbidden(
        "This workspace is suspended. Contact the platform administrator.",

        "tenant_suspended",
      )
    }
  }

  // The password was correct, which is what proves this really is the member and
  // not someone guessing. A reset token is issued here so they can finish the
  // job on this screen; no session is created, so nothing is opened until the
  // new password exists.
  if (user.must_reset_password === 1) {
    const resetToken = generateToken()

    const now = new Date()

    transaction(() => {
      run(
        "DELETE FROM password_reset_tokens WHERE user_id = ? AND used_at IS NULL",
        user.id,
      )

      run(
        `INSERT INTO password_reset_tokens (
            id, tenant_id, user_id, token_hash, created_at, expires_at
         ) VALUES (?, ?, ?, ?, ?, ?)`,
        newId("prt"),
        membership.tenant_id,
        user.id,
        hashToken(resetToken),
        now.toISOString(),
        new Date(now.getTime() + RESET_TTL_MS).toISOString(),
      )
    })

    recordLoginEvent({
      tenantId: membership.tenant_id,
      userId: user.id,
      email,
      outcome: "reset_required",
      ip: ctx.ip,
      userAgent: ctx.req.headers["user-agent"] ?? null,
    })

    return {
      authenticated: false as const,
      passwordResetRequired: true as const,
      resetToken,
    }
  }

  const needsTwofa = user.twofa_enabled === 1 && Boolean(user.twofa_secret)

  const session = startSession(ctx, {
    userId: user.id,

    tenantId: membership.tenant_id,

    roleId: membership.role_id,

    pendingTwofa: needsTwofa,
  })

  // Deliberately not recorded as a success yet: with a second factor still
  // outstanding this attempt is not a sign-in. The `success` row is written
  // after the branch below, by the verify step for a 2FA account and here for
  // everyone else, so one sign-in is one row in the member's timeline.

  if (needsTwofa) {
    auditAnonymous(
      ctx,

      "auth.twofa_challenged",

      membership.tenant_id,

      user.id,

      email,

      user.id,
    )

    recordLoginEvent({
      tenantId: membership.tenant_id,
      userId: user.id,
      email,
      outcome: "twofa_challenged",
      ip: ctx.ip,
      userAgent: ctx.req.headers["user-agent"] ?? null,
    })

    return { authenticated: false as const, twofaRequired: true as const }
  }

  recordLoginEvent({
    tenantId: membership.tenant_id,
    userId: user.id,
    email,
    outcome: "success",
    ip: ctx.ip,
    userAgent: ctx.req.headers["user-agent"] ?? null,
  })

  return { authenticated: true as const, ...sessionPayload(session) }
}

/** POST /api/auth/twofa/verify — completes a session held at the 2FA step. */

export async function verifyTwofa(ctx: RequestContext) {
  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const code = requireString(body, "code", { min: 6, max: 6 })

  const session = verifySessionToken(ctx.cookies[SESSION_COOKIE] ?? null)

  if (!session) throw unauthorized("Your sign-in attempt expired. Start again.")

  if (!session.pendingTwofa)
    return { authenticated: true as const, ...sessionPayload(session) }

  const user = get<TwofaUserRow>(
    "SELECT email, twofa_secret, twofa_enabled FROM users WHERE id = ?",
    session.userId,
  )

  const recoveryCode =
    typeof body.recoveryCode === "string" ? body.recoveryCode : ""

  let accepted = false

  if (user?.twofa_secret && !recoveryCode) {
    accepted = verifyTotp(user.twofa_secret, code)
  } else if (recoveryCode) {
    const record = get<{ id: string }>(
      "SELECT id FROM twofa_recovery_codes WHERE user_id = ? AND code_hash = ? AND used_at IS NULL",

      session.userId,

      hashPassword(recoveryCode.trim().toUpperCase()),
    )

    if (record) {
      run(
        "UPDATE twofa_recovery_codes SET used_at = ? WHERE id = ?",

        new Date().toISOString(),

        record.id,
      )

      accepted = true
    }
  }

  if (!accepted) {
    recordLoginEvent({
      tenantId: session.tenantId,
      userId: session.userId,
      email: user?.email ?? "",
      outcome: "failed",
      ip: ctx.ip,
      userAgent: ctx.req.headers["user-agent"] ?? null,
    })

    throw unauthorized("That code is not valid", "twofa_invalid")
  }

  confirmTwofa(session.id)

  const refreshed = verifySessionToken(ctx.cookies[SESSION_COOKIE]!)

  if (!refreshed) throw new Error("Session could not be resumed")

  // The sign-in only completes here, so this is where a 2FA member's `success`
  // row belongs. The challenge written by `login` stays as the attempt's start.
  recordLoginEvent({
    tenantId: refreshed.tenantId,
    userId: refreshed.userId,
    email: user?.email ?? "",
    outcome: "success",
    ip: ctx.ip,
    userAgent: ctx.req.headers["user-agent"] ?? null,
  })

  writeAudit(
    { ...ctx, session: refreshed },

    "auth.twofa_passed",

    "user",

    refreshed.userId,

    null,

    ctx.ip,
  )

  return { authenticated: true as const, ...sessionPayload(refreshed) }
}

/** POST /api/auth/logout */

export async function logout(ctx: RequestContext) {
  const session = verifySessionToken(ctx.cookies[SESSION_COOKIE] ?? null)

  if (session) {
    revokeSession(session.id, "signed_out")

    writeAudit(
      { ...ctx, session },

      "auth.signed_out",

      "user",

      session.userId,

      null,

      ctx.ip,
    )
  }

  clearCookie(ctx.res, SESSION_COOKIE)

  return { ok: true }
}

/** POST /api/auth/switch-tenant */

export async function switchTenant(ctx: RequestContext) {
  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const tenantId = requireString(body, "tenantId", { max: 64 })

  const session = verifySessionToken(ctx.cookies[SESSION_COOKIE] ?? null)

  if (!session) throw unauthorized("Sign in to continue")

  if (session.pendingTwofa)
    throw unauthorized("Two-factor verification is required", "twofa_required")

  const switched = switchSessionTenant(session, tenantId)

  if (!switched) throw forbidden("You are not a member of that workspace")

  writeAudit(
    { ...ctx, session },

    "auth.tenant_switched",

    "tenant",

    tenantId,

    null,

    ctx.ip,
  )

  return { authenticated: true as const, ...sessionPayload(switched) }
}

/** POST /api/auth/forgot-password — always the same response. */

export async function forgotPassword(ctx: RequestContext) {
  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const email = requireEmail(body)

  const user = get<MembershipRow>(
    "SELECT id, tenant_id FROM users WHERE email = ? AND status = 'active'",

    email,
  )

  if (user) {
    const token = generateToken()

    const now = new Date()

    run(
      "DELETE FROM password_reset_tokens WHERE user_id = ? AND used_at IS NULL",

      user.id,
    )

    run(
      `INSERT INTO password_reset_tokens (id, tenant_id, user_id, token_hash, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,

      newId("prt"),

      user.tenant_id,

      user.id,

      hashToken(token),

      now.toISOString(),

      new Date(now.getTime() + RESET_TTL_MS).toISOString(),
    )

    auditAnonymous(
      ctx,

      "auth.password_reset_requested",

      user.tenant_id,

      user.id,

      email,

      user.id,
    )

    // A real deployment delivers this by email. With no mail transport

    // configured the token is returned so the flow is testable end to end.

    if (process.env.DEEDORBIT_EXPOSE_RESET_TOKEN === "1") {
      return {
        ok: true,

        message: "If that address is registered, a reset link is on its way.",

        devResetToken: token,
      }
    }
  }

  return {
    ok: true,

    message: "If that address is registered, a reset link is on its way.",
  }
}

/** POST /api/auth/reset-password */

export async function resetPassword(ctx: RequestContext) {
  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const token = requireString(body, "token", { min: 10, max: 200 })

  const password = requireString(body, "password", { min: 1, max: 200 })

  const check = checkPassword(password)

  if (!check.ok) {
    throw badRequest("Password does not meet the policy", {
      password: check.problems[0],
    })
  }

  const record = get<PasswordResetRow>(
    `SELECT id, user_id
       FROM password_reset_tokens
      WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?`,

    hashToken(token),

    new Date().toISOString(),
  )

  if (!record) {
    throw badRequest("This reset link is invalid or has expired", {
      token: "This reset link is invalid or has expired",
    })
  }

  const now = new Date().toISOString()

  transaction(() => {
    run(
      "UPDATE users SET password_hash = ?, password_changed_at = ?, failed_login_count = 0, locked_until = NULL, updated_at = ? WHERE id = ?",

      hashPassword(password),

      now,

      now,

      record.user_id,
    )

    // A reset is also how a forced reset is satisfied. Clearing it here rather
    // than in a second step means there is no order in which the member has a
    // new password but is still locked out, or the reverse.
    run(
      "UPDATE users SET must_reset_password = 0, password_reset_required_at = NULL WHERE id = ?",
      record.user_id,
    )

    run(
      "UPDATE password_reset_tokens SET used_at = ? WHERE id = ?",

      now,

      record.id,
    )
  })

  // A reset invalidates every existing session on the account.

  revokeAllForUser(record.user_id, "password_reset")

  clearCookie(ctx.res, SESSION_COOKIE)

  return {
    ok: true,

    message: "Password updated. Sign in with your new password.",
  }
}

/** POST /api/auth/change-password — requires a live session. */

export async function changePassword(ctx: RequestContext) {
  const guarded = requireAuth(ctx)

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const current = requireString(body, "currentPassword", { max: 200 })

  const next = requireString(body, "newPassword", { min: 1, max: 200 })

  const row = get<{ password_hash: string | null }>(
    "SELECT password_hash FROM users WHERE id = ?",

    guarded.userId,
  )

  if (!verifyPassword(current, row?.password_hash ?? null)) {
    throw badRequest("Current password is incorrect", {
      currentPassword: "Current password is incorrect",
    })
  }

  const check = checkPassword(next)

  if (!check.ok) {
    throw badRequest("Password does not meet the policy", {
      newPassword: check.problems[0],
    })
  }

  if (verifyPassword(next, row?.password_hash ?? null)) {
    throw badRequest("Choose a password you have not used before", {
      newPassword: "Choose a password you have not used before",
    })
  }

  const now = new Date().toISOString()

  run(
    "UPDATE users SET password_hash = ?, password_changed_at = ?, updated_at = ? WHERE id = ?",

    hashPassword(next),

    now,

    now,

    guarded.userId,
  )

  writeAudit(
    { ...ctx, session: guarded.session },

    "auth.password_changed",

    "user",

    guarded.userId,

    null,

    ctx.ip,
  )

  return { ok: true, message: "Password updated." }
}

/** POST /api/auth/twofa/enroll — step 1: issue a secret to scan. */

export async function enrollTwofa(ctx: RequestContext) {
  const guarded = requireAuth(ctx)

  if (guarded.session.user.twofaEnabled) {
    throw conflict(
      "Two-factor authentication is already enabled on this account",
    )
  }

  const secret = generateTwofaSecret()

  run(
    "UPDATE users SET twofa_pending_secret = ?, updated_at = ? WHERE id = ?",

    secret,

    new Date().toISOString(),

    guarded.userId,
  )

  return {
    secret,

    otpauthUrl: otpauthUrl(
      secret,

      guarded.session.user.email,

      brand.name,
    ),

    // Shown in the UI so the flow is testable without a QR scanner.

    currentCode: totpCode(secret),
  }
}

/** POST /api/auth/twofa/confirm — step 2: verify and switch it on. */

export async function confirmTwofaEnrolment(ctx: RequestContext) {
  const guarded = requireAuth(ctx)

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const code = requireString(body, "code", { min: 6, max: 6 })

  const row = get<{ twofa_pending_secret: string | null }>(
    "SELECT twofa_pending_secret FROM users WHERE id = ?",

    guarded.userId,
  )

  const secret = row?.twofa_pending_secret

  if (!secret) {
    throw badRequest("Start the two-factor setup again before confirming")
  }

  if (!verifyTotp(secret, code)) {
    throw badRequest("That code is not valid", {
      code: "That code is not valid",
    })
  }

  const codes = generateRecoveryCodes()

  const now = new Date().toISOString()

  transaction(() => {
    run(
      "UPDATE users SET twofa_secret = ?, twofa_pending_secret = NULL, twofa_enabled = 1, updated_at = ? WHERE id = ?",

      secret,

      now,

      guarded.userId,
    )

    run("DELETE FROM twofa_recovery_codes WHERE user_id = ?", guarded.userId)

    for (const recoveryCode of codes) {
      run(
        "INSERT INTO twofa_recovery_codes (id, tenant_id, user_id, code_hash, created_at) VALUES (?, ?, ?, ?, ?)",

        newId("rco"),

        guarded.tenantId,

        guarded.userId,

        hashPassword(recoveryCode),

        now,
      )
    }
  })

  writeAudit(
    { ...ctx, session: guarded.session },

    "auth.twofa_enabled",

    "user",

    guarded.userId,

    null,

    ctx.ip,
  )

  return { ok: true, recoveryCodes: codes }
}

/** POST /api/auth/twofa/disable */

export async function disableTwofa(ctx: RequestContext) {
  const guarded = requireAuth(ctx)

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const password = requireString(body, "password", { max: 200 })

  const row = get<{ password_hash: string | null }>(
    "SELECT password_hash FROM users WHERE id = ?",

    guarded.userId,
  )

  if (!verifyPassword(password, row?.password_hash ?? null)) {
    throw badRequest("Password is incorrect", {
      password: "Password is incorrect",
    })
  }

  const now = new Date().toISOString()

  run(
    "UPDATE users SET twofa_secret = NULL, twofa_pending_secret = NULL, twofa_enabled = 0, updated_at = ? WHERE id = ?",

    now,

    guarded.userId,
  )

  run("DELETE FROM twofa_recovery_codes WHERE user_id = ?", guarded.userId)

  writeAudit(
    { ...ctx, session: guarded.session },

    "auth.twofa_disabled",

    "user",

    guarded.userId,

    null,

    ctx.ip,
  )

  return { ok: true }
}

/** GET /api/auth/sessions — the caller's own live sessions. */

export async function listMySessions(ctx: RequestContext) {
  const guarded = requireAuth(ctx)

  return {
    sessions: listActiveSessions(guarded.userId).map((s) => ({
      ...s,

      current: s.id === guarded.session.id,
    })),
  }
}

/** POST /api/auth/sessions/revoke-others — sign out every other device. */

export async function revokeOtherSessions(ctx: RequestContext) {
  const guarded = requireAuth(ctx)

  const live = listActiveSessions(guarded.userId).filter(
    (s) => s.id !== guarded.session.id,
  )

  for (const session of live) revokeSession(session.id, "revoked_by_user")

  writeAudit(
    { ...ctx, session: guarded.session },

    "auth.sessions_revoked",

    "user",

    guarded.userId,

    { count: live.length },

    ctx.ip,
  )

  return { ok: true, revoked: live.length }
}

/** POST /api/auth/dev-generate-password — helper for the admin UI. */

export async function suggestPassword(ctx: RequestContext) {
  requireAuth(ctx)

  const password = generatePassword()

  return { password, check: checkPassword(password) }
}

// --- helpers ---------------------------------------------------------------

function initialsOf(name: string): string {
  const words = name.split(/\s+/).filter(Boolean)

  if (words.length === 0) return "WS"

  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase()

  return `${words[0]![0]}${words[words.length - 1]![0]}`.toUpperCase()
}
