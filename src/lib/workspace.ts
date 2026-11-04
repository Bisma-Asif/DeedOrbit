import type { AuthUser, SessionPayload } from "@/lib/api"

/**
 * View models for the chrome.
 *
 * The tenant and the signed-in user are owned by the server and arrive on the
 * session payload, so nothing here is invented. These types exist only to give
 * the layout and the dashboard narrow props, and to keep the `legalName` /
 * `initials` fallbacks in one place.
 */

export type Tenant = {
  id: string
  name: string
  /** Falls back to the trading name when the tenant has not set a legal name. */
  legalName: string
  initials: string
  role: string
  roleId: string
  status: "active" | "suspended"
}

export type SessionUser = {
  id: string
  name: string
  email: string
  initials: string
  role: string
  roleLabel: string
}

export function tenantFromSession(session: SessionPayload): Tenant {
  return {
    id: session.tenant.id,
    name: session.tenant.name,
    legalName: session.tenant.legalName ?? session.tenant.name,
    initials: session.tenant.logoInitials ?? initialsOf(session.tenant.name),
    role: session.role.label,
    roleId: session.role.id,
    status: "active",
  }
}

export function userFromSession(
  user: AuthUser,
  roleLabel: string,
): SessionUser {
  return {
    id: user.id,
    name: user.fullName,
    email: user.email,
    initials: initialsOf(user.fullName),
    role: user.jobTitle ?? roleLabel,
    roleLabel,
  }
}

/** Up to two letters from the first two words, e.g. "DeedOrbit Holdings" -> "DH". */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "--"
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}
