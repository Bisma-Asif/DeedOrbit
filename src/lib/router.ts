import { useEffect, useState } from "react"

/**
 * Minimal hash router. The shell is a single-page back-office tool, so a hash
 * route keeps deep links working without adding a router dependency. Every
 * module in `navigation.ts` owns one of these paths.
 */

function readPath(): string {
  const raw = window.location.hash.replace(/^#/, "")
  // A bare URL (no hash) opens the public marketing home. The landing owns "/";
  // `App` decides whether that shows the pitch or, for a signed-in visitor, the
  // "Go to Dashboard" entry. Every in-app screen still uses an explicit hash, so
  // deep links like `#/dashboard` and `#/bookings/:id` are unaffected.
  if (!raw) return "/"
  return raw.startsWith("/") ? raw : `/${raw}`
}

export function useRoute(): string {
  const [path, setPath] = useState(readPath)

  useEffect(() => {
    const sync = () => setPath(readPath())
    window.addEventListener("hashchange", sync)
    return () => window.removeEventListener("hashchange", sync)
  }, [])

  return path
}

/**
 * A form that owns input the server does not have registers one of these, and returns
 * `true` to say it took the decision over. `navigate` then does nothing but notify it.
 *
 * The registry lives with the router rather than with the guard component so that neither
 * imports the other: a component that both registers and navigates would be a cycle, and
 * `navigate` has to consult the guards without knowing who they are.
 */
export type NavigationGuard = (target: string) => boolean

const navigationGuards = new Set<NavigationGuard>()

export function registerNavigationGuard(guard: NavigationGuard): () => void {
  navigationGuards.add(guard)

  return () => {
    navigationGuards.delete(guard)
  }
}

/** True when a form wants to be asked first. Every guard still gets to see the target. */
function navigationBlocked(target: string): boolean {
  let blocked = false

  for (const guard of navigationGuards) {
    if (guard(target)) blocked = true
  }

  return blocked
}

export function navigate(to: string) {
  const target = to.startsWith("/") ? to : `/${to}`
  if (readPath() === target) return
  if (navigationBlocked(target)) return
  window.location.hash = target
}

/**
 * Stable callback form of `navigate`, for event handlers inside components that
 * already read the route. Returns the module-level function, so its identity
 * never changes and it is safe in dependency arrays.
 */
export function useNavigate(): (to: string) => void {
  return navigate
}

export function href(path: string): string {
  return `#${path}`
}

/**
 * Reads a single query parameter out of the current hash route. Recovery links
 * arrive as `#/recover/reset?token=...`, and `useRoute` deliberately returns the
 * raw string, so the caller parses it.
 */
export function readQueryParam(key: string, from?: string): string | null {
  const source = from ?? window.location.hash.replace(/^#/, "")
  const queryIndex = source.indexOf("?")
  if (queryIndex === -1) return null
  return new URLSearchParams(source.slice(queryIndex + 1)).get(key)
}

/** Path without its query string, for route matching. */
export function routePath(path: string): string {
  const queryIndex = path.indexOf("?")
  return queryIndex === -1 ? path : path.slice(0, queryIndex)
}

/**
 * The path a `#/…` href points at, in the same shape `readPath` returns.
 *
 * Sidebar links are real anchors so middle-click and "Copy link" keep working, which means
 * a guard that wants to stop one has to read the target off the element rather than catch
 * it in `navigate`.
 */
export function hashLinkPath(hrefValue: string): string | null {
  if (!hrefValue.startsWith("#")) return null

  const raw = hrefValue.slice(1)

  if (raw === "" || raw === "/") return "/dashboard"

  return raw.startsWith("/") ? raw : `/${raw}`
}
