import { createContext, useContext } from "react"
import type { Action, PermissionModule, RoleId } from "@shared/access"
import type { AuthResult, Membership } from "@/lib/api"

/** The signed-in shape, extracted so the context does not repeat the union. */
export type LiveSession = Extract<AuthResult, { authenticated: true }>

export type SessionState = {
  loading: boolean
  /** Null until the session is resolved; the app shows a boot state meanwhile. */
  data: LiveSession | null
  /** Set when the API answered but requires a second factor first. */
  twofaRequired: boolean
  error: string | null
  signIn: (email: string, password: string) => Promise<"ok" | "twofa" | "reset">
  signUp: (input: {
    fullName: string
    email: string
    password: string
    workspaceName: string
  }) => Promise<void>
  completeTwofa: (code: string, recoveryCode?: string) => Promise<void>
  signOut: () => Promise<void>
  switchTenant: (tenantId: string) => Promise<void>
  refresh: () => Promise<void>
  can: (module: PermissionModule, action?: Action) => boolean
  /**
   * Whether a nav module should render. Broadened to `string` because a nav
   * entry may map to a different permission module (its `viewModule`), so the
   * caller passes either a module id or a permission module without the
   * contravariance breaking the shell's `(module) => boolean` prop.
   */
  canView: (module: string) => boolean
}

export const SessionContext = createContext<SessionState | null>(null)

export function useSession(): SessionState {
  const value = useContext(SessionContext)
  if (!value)
    throw new Error("useSession must be used inside <SessionProvider>")
  return value
}

export type { Membership, RoleId, PermissionModule }
