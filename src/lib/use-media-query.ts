import { useEffect, useState } from "react"

/** SSR-safe media query hook used for the sidebar rail / off-canvas switch. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === "undefined") return false
    return window.matchMedia(query).matches
  })

  useEffect(() => {
    const media = window.matchMedia(query)
    const sync = () => setMatches(media.matches)
    sync()
    media.addEventListener("change", sync)
    return () => media.removeEventListener("change", sync)
  }, [query])

  return matches
}

/** Breakpoints that the shell switches layout at. */
export const BREAKPOINTS = {
  /** Below this the sidebar becomes an off-canvas drawer. */
  sidebarOverlay: "(max-width: 1023px)",
  /** Below this the desktop sidebar is a 64px icon rail. */
  sidebarExpanded: "(min-width: 1280px)",
} as const
