/**
 * Typed API client.
 *
 * The session lives in an http-only cookie the browser attaches automatically,
 * so there is no token to store in JS. `credentials: "same-origin"` is explicit
 * because the default differs across browsers, and this must not regress.
 *
 * Errors arrive as `{ error: { code, message, fields? } }`. `ApiError` keeps the
 * field map so a form can attach server-side validation to the right control
 * instead of showing one generic banner.
 */

import type { Action, PermissionModule, RoleId } from "@shared/access"

export type ApiErrorPayload = {
  code: string

  message: string

  fields?: Record<string, string>
}

export class ApiError extends Error {
  status: number

  code: string

  fields: Record<string, string>

  constructor(status: number, payload: ApiErrorPayload) {
    super(payload.message)

    this.name = "ApiError"

    this.status = status

    this.code = payload.code

    this.fields = payload.fields ?? {}
  }
}

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE"

  body?: unknown

  signal?: AbortSignal
}

async function request<T>(
  path: string,

  options: RequestOptions = {},
): Promise<T> {
  let response: Response

  try {
    response = await fetch(path, {
      method: options.method ?? "GET",

      credentials: "same-origin",

      headers:
        options.body === undefined
          ? {}
          : { "Content-Type": "application/json" },

      ...(options.body === undefined
        ? {}
        : { body: JSON.stringify(options.body) }),

      ...(options.signal ? { signal: options.signal } : {}),
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError")
      throw error

    throw new ApiError(0, {
      code: "network_error",

      message:
        "Could not reach the server. Check your connection and try again.",
    })
  }

  if (response.status === 204) return undefined as T

  const text = await response.text()

  const payload = text ? safeParse(text) : null

  if (!response.ok) {
    const error = (payload as { error?: ApiErrorPayload } | null)?.error

    throw new ApiError(
      response.status,

      error ?? {
        code: "unknown_error",

        message: "Something went wrong. Try again.",
      },
    )
  }

  return payload as T
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) =>
    request<T>(path, signal ? { signal } : {}),

  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body }),

  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body }),

  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PUT", body }),

  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
}

// --- Response shapes -------------------------------------------------------

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

export type AuthUser = {
  id: string

  email: string

  fullName: string

  jobTitle: string | null

  twofaEnabled: boolean

  lastLoginAt: string | null
}

export interface RoleRef {
  id: RoleId
  label: string
}

export interface TenantRef {
  id: string
  name: string
  legalName: string | null
  slug: string
  logoInitials: string | null
}

export type SessionPayload = {
  authenticated: true

  user: AuthUser

  tenant: TenantRef

  role: RoleRef

  memberships: Membership[]

  /** Modules whose `view` grant is held — drives the navigation. */

  modules: PermissionModule[]

  /** Flat `module.action` -> allowed map, read from the database grants. */

  permissions: Record<string, boolean>

  expiresAt: string
}

/**
 * The three answers a sign-in attempt can have.
 *
 * The `never` markers keep the two unauthenticated arms disjoint, so reading
 * `twofaRequired` off an arbitrary non-authenticated result type-checks without
 * every caller having to narrow by hand.
 */

export type AuthResult = { authenticated: true } & SessionPayload | {
  authenticated: false

  twofaRequired: boolean

  passwordResetRequired?: never

  resetToken?: never
} | {
  authenticated: false

  twofaRequired?: never

  passwordResetRequired: boolean

  resetToken?: string
}

export type TenantUser = {
  id: string

  email: string

  fullName: string

  phone: string | null

  jobTitle: string | null

  status: "invited" | "active" | "suspended" | "deactivated"

  twofaEnabled: boolean

  lastLoginAt: string | null

  createdAt: string

  /** An administrator forced a reset; the member cannot enter until it is done. */
  mustResetPassword: boolean

  passwordResetRequiredAt: string | null

  /** Wrong passwords and lockouts in the last seven days. */
  recentFailedLogins: number

  roleId: RoleId

  roleLabel: string

  roleRank: number

  isDefault: boolean

  activeSessions: number

  /** Empty means every branch — read `branchAccess` for the plain form. */
  branchIds: string[]

  branchNames: string[]

  branchAccess: "all" | "limited"

  pendingInvite: { expiresAt: string | null } | null
}

/** A workspace office, as offered by the branch filter and the scope editor. */
export type BranchOption = {
  id: string

  name: string

  code: string | null

  status: string

  memberCount: number
}

export type LoginEventOutcome = "success" | "failed" | "suspended" | "locked" | "reset_required" | "twofa_challenged"

export type LoginEvent = {
  id: string

  email: string

  outcome: LoginEventOutcome

  ipAddress: string | null

  userAgent: string | null

  createdAt: string

  success: boolean
}

/** One administrator action taken against a membership. */
export type MemberAction = {
  id: string

  action: string

  actorEmail: string | null

  detail: string | null

  createdAt: string
}

export type MemberActivity = {
  member: {
    id: string

    email: string

    fullName: string

    status: TenantUser["status"]

    roleId: RoleId

    roleLabel: string

    lastLoginAt: string | null

    mustResetPassword: boolean

    passwordResetRequiredAt: string | null

    recentFailedLogins: number

    branchNames: string[]
  }

  events: LoginEvent[]

  sessions: ActiveSession[]

  actions: MemberAction[]
}

export type UsersResponse = {
  users: TenantUser[]

  roleCounts: Record<string, number>

  branches: BranchOption[]
}

export type EffectivePermission = {
  permissionId: string

  module: PermissionModule

  action: Action

  allowed: boolean

  source: "override" | "default" | "none"

  effect: "allow" | "deny" | null
}

export type RoleSummary = {
  id: RoleId

  label: string

  scope: "platform" | "tenant"

  description: string

  rank: number

  assignable: boolean

  permissions: EffectivePermission[]

  allowedCount: number

  myRank: number

  userCount: number
}

export type RolesResponse = {
  roles: RoleSummary[]

  myRoleId: RoleId
}

export type AuditEntry = {
  id: string

  action: string

  actorEmail: string | null

  targetType: string | null

  targetId: string | null

  detail: string | null

  createdAt: string
}

export type Invitation = {
  id: string

  email: string

  fullName: string

  roleId: RoleId

  expiresAt: string

  devInviteToken?: string
}

// --- Endpoints -------------------------------------------------------------

interface OkMessage {
  ok: true
  message: string
}

interface OkMessageWithToken extends OkMessage {
  devResetToken?: string
}

interface OkRevoked {
  ok: true
  revoked: number
}

interface OkUser {
  ok: true
  user: TenantUser
}

interface OkInvitation {
  ok: true
  invitation: Invitation
}

interface OkRecoveryCodes {
  ok: true
  recoveryCodes: string[]
}

interface TwofaEnrolmentPayload {
  secret: string
  otpauthUrl: string
  currentCode: string
}

interface RolePermissionsPayload {
  role: RoleSummary
  permissions: EffectivePermission[]
}

export const authApi = {
  session: (signal?: AbortSignal) =>
    api.get<AuthResult>("/api/auth/session", signal),

  login: (email: string, password: string) =>
    api.post<AuthResult>("/api/auth/login", { email, password }),

  signup: (input: {
    fullName: string

    email: string

    password: string

    workspaceName: string
  }) => api.post<AuthResult>("/api/auth/signup", input),

  logout: () => api.post<{ ok: true }>("/api/auth/logout"),

  verifyTwofa: (code: string, recoveryCode?: string) =>
    api.post<AuthResult>("/api/auth/twofa/verify", {
      code,

      ...(recoveryCode ? { recoveryCode } : {}),
    }),

  forgotPassword: (email: string) =>
    api.post<OkMessageWithToken>(
      "/api/auth/forgot-password",

      { email },
    ),

  resetPassword: (token: string, password: string) =>
    api.post<OkMessage>("/api/auth/reset-password", {
      token,

      password,
    }),

  changePassword: (currentPassword: string, newPassword: string) =>
    api.post<OkMessage>("/api/auth/change-password", {
      currentPassword,

      newPassword,
    }),

  switchTenant: (tenantId: string) =>
    api.post<AuthResult>("/api/auth/switch-tenant", { tenantId }),

  sessions: () => api.get<{ sessions: ActiveSession[] }>("/api/auth/sessions"),

  revokeOthers: () => api.post<OkRevoked>("/api/auth/sessions/revoke-others"),

  enrollTwofa: () => api.post<TwofaEnrolmentPayload>("/api/auth/twofa/enroll"),

  confirmTwofa: (code: string) =>
    api.post<OkRecoveryCodes>("/api/auth/twofa/confirm", {
      code,
    }),

  disableTwofa: (password: string) =>
    api.post<{ ok: true }>("/api/auth/twofa/disable", { password }),
}

export type ActiveSession = {
  id: string

  userAgent: string | null

  ipAddress: string | null

  createdAt: string

  lastSeenAt: string

  expiresAt: string

  current?: boolean
}

export const usersApi = {
  list: (signal?: AbortSignal) => api.get<UsersResponse>("/api/users", signal),

  invite: (input: {
    email: string

    fullName: string

    roleId: RoleId

    jobTitle?: string
  }) => api.post<OkInvitation>("/api/users/invite", input),

  update: (
    id: string,

    input: {
      fullName?: string

      jobTitle?: string

      phone?: string | null

      roleId?: RoleId
    },
  ) => api.patch<OkUser>(`/api/users/${id}`, input),

  setStatus: (id: string, status: "active" | "suspended" | "deactivated") =>
    api.post<OkUser>(`/api/users/${id}/status`, {
      status,
    }),

  remove: (id: string) => api.delete<{ ok: true }>(`/api/users/${id}`),

  revokeSessions: (id: string) =>
    api.post<OkRevoked>(`/api/users/${id}/revoke-sessions`),

  sessions: (id: string) =>
    api.get<{ sessions: ActiveSession[] }>(`/api/users/${id}/sessions`),

  revokeSession: (id: string, sessionId: string) =>
    api.delete<{ ok: true }>(`/api/users/${id}/sessions/${sessionId}`),

  /**
   * Replaces the member's branch scope. An empty array grants every branch,
   * which is the default for a workspace administrator.
   */
  updateBranches: (id: string, branchIds: string[]) =>
    api.put<OkUser>(`/api/users/${id}/branches`, { branchIds }),

  forcePasswordReset: (id: string) =>
    api.post<{
      ok: true
      requiredAt: string
      expiresAt: string
      revokedSessions: number
      devResetToken?: string
    }>(`/api/users/${id}/force-password-reset`),

  activity: (id: string) =>
    api.get<MemberActivity>(`/api/users/${id}/activity`),
}

export const rolesApi = {
  list: (signal?: AbortSignal) => api.get<RolesResponse>("/api/roles", signal),

  detail: (id: string) => api.get<RolePermissionsPayload>(`/api/roles/${id}`),

  setPermissions: (id: string, permissions: string[]) =>
    api.put<{
      ok: true

      permissions: EffectivePermission[]

      allowedCount: number
    }>(`/api/roles/${id}/permissions`, { permissions }),
}

export const auditApi = {
  list: (limit = 50, signal?: AbortSignal) =>
    api.get<{ entries: AuditEntry[] }>(`/api/audit?limit=${limit}`, signal),
}

export const tenantsApi = {
  list: () =>
    api.get<{
      tenants: TenantSummary[]

      scope: "own"

      canSeeAll: boolean
    }>("/api/tenants"),

  update: (
    id: string,

    input: {
      name?: string

      legalName?: string

      currency?: string
    },
  ) => api.patch<{ tenant: TenantSummary }>(`/api/tenants/${id}`, input),
}

export type TenantSummary = {
  id: string

  name: string

  legalName: string | null

  slug: string

  status: string

  plan: string

  logoInitials: string | null

  currency: string

  timezone: string

  createdAt: string

  userCount: number

  activeUsers: number
}
