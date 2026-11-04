import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import { navigate } from "@/lib/router"
import { ApiError, authApi, type AuthResult } from "@/lib/api"
import {
  SessionContext,
  type LiveSession,
  type SessionState,
} from "@/lib/session-context"

const EMPTY_GRANTS: Record<string, boolean> = {}

type SessionStore = {
  loading: boolean
  data: LiveSession | null
  twofaRequired: boolean
  error: string | null
}

const SIGNED_OUT: SessionStore = {
  loading: false,
  data: null,
  twofaRequired: false,
  error: null,
}

/**
 * Owns the authenticated session for the whole app.
 *
 * The session token is an http-only cookie, so there is nothing sensitive held
 * in JavaScript — this provider keeps only the *derived* profile (name, role,
 * tenant) needed to render the shell. A page reload revalidates against
 * `GET /api/auth/session`, which means a server-side revocation takes effect on
 * the next navigation rather than lingering in a stale local cache.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionStore>({
    loading: true,
    data: null,
    twofaRequired: false,
    error: null,
  })

  const apply = useCallback((result: AuthResult) => {
    if (result.authenticated) {
      setState({
        loading: false,
        data: result,
        twofaRequired: false,
        error: null,
      })
      return
    }
    setState({
      loading: false,
      data: null,
      // A forced password reset leaves nothing outstanding here: no session was
      // issued, so the caller is sent to the reset screen rather than a
      // challenge. `signIn` below handles the hand-off.
      twofaRequired: Boolean(result.twofaRequired),
      error: null,
    })
  }, [])

  const refresh = useCallback(async () => {
    try {
      apply(await authApi.session())
    } catch (error) {
      setState({
        loading: false,
        data: null,
        twofaRequired: false,
        error:
          error instanceof ApiError
            ? error.message
            : "Could not reach the server.",
      })
    }
  }, [apply])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const signIn = useCallback<SessionState["signIn"]>(
    async (email, password) => {
      const result = await authApi.login(email, password)
      apply(result)
      if (result.authenticated) {
        navigate("/dashboard")
        return "ok"
      }
      // The password was right but an administrator retired it. The server
      // issued a single-use token in that same response, so the member can set
      // a new one without waiting on an email that this deployment cannot send.
      if (result.passwordResetRequired) {
        if (!result.resetToken) {
          navigate("/recover")
          return "reset"
        }
        navigate(
          `/recover/reset?token=${encodeURIComponent(result.resetToken)}`,
        )
        return "reset"
      }
      // The cookie is set but held at pending_twofa; App swaps in the challenge.
      return "twofa"
    },
    [apply],
  )

  const signUp = useCallback<SessionState["signUp"]>(
    async (input) => {
      apply(await authApi.signup(input))
      navigate("/dashboard")
    },
    [apply],
  )

  const completeTwofa = useCallback<SessionState["completeTwofa"]>(
    async (code, recoveryCode) => {
      apply(await authApi.verifyTwofa(code, recoveryCode))
      navigate("/dashboard")
    },
    [apply],
  )

  const signOut = useCallback<SessionState["signOut"]>(async () => {
    try {
      await authApi.logout()
    } finally {
      setState(SIGNED_OUT)
      navigate("/login")
    }
  }, [])

  const switchTenant = useCallback<SessionState["switchTenant"]>(
    async (tenantId) => {
      apply(await authApi.switchTenant(tenantId))
      navigate("/dashboard")
    },
    [apply],
  )

  /**
   * Grants arrive with the session, so affordance checks are a map lookup with
   * no extra request. The server re-checks every action regardless — this only
   * decides what to *show*, never what is allowed.
   */
  const grants = state.data?.permissions ?? EMPTY_GRANTS

  const value = useMemo<SessionState>(() => {
    const viewable = new Set<string>(state.data?.modules ?? [])

    return {
      loading: state.loading,
      data: state.data,
      twofaRequired: state.twofaRequired,
      error: state.error,
      signIn,
      signUp,
      completeTwofa,
      signOut,
      switchTenant,
      refresh,
      can: (module, action = "view") => Boolean(grants[`${module}.${action}`]),
      canView: (module) => viewable.has(module),
    }
  }, [
    state,
    grants,
    signIn,
    signUp,
    completeTwofa,
    signOut,
    switchTenant,
    refresh,
  ])

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  )
}
