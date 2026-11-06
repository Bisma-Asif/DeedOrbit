import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import { content, type Localized } from "@/features/marketing/content"

/**
 * Landing-site language state.
 *
 * Only the public marketing/auth/legal pages read this; the back-office app is
 * untouched. Switching to Urdu flips `dir="rtl"` and `lang="ur"` on `<html>` for
 * the lifetime of the mounted marketing tree, then restores whatever the app had
 * — so an authenticated screen is never left in a right-to-left document.
 */

type Lang = "en" | "ur"

interface MarketingLangState {
  lang: Lang
  dir: "ltr" | "rtl"
  setLang: (next: Lang) => void
  toggle: () => void
  /** Resolve a bilingual string for the active language (Urdu falls back to EN). */
  t: (pair: Localized) => string
}

const STORAGE_KEY = "deedorbit.lang"

function readInitialLang(): Lang {
  if (typeof window === "undefined") return content.site.langDefault
  const stored = window.localStorage.getItem(STORAGE_KEY)
  return stored === "en" || stored === "ur" ? stored : content.site.langDefault
}

const MarketingLangContext = createContext<MarketingLangState | null>(null)

export function MarketingLangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readInitialLang)
  const dir: "ltr" | "rtl" = lang === "ur" ? "rtl" : "ltr"

  // Flip the document for the duration of the marketing tree only.
  useEffect(() => {
    const root = document.documentElement
    const prevLang = root.lang
    const prevDir = root.getAttribute("dir")
    root.lang = lang
    root.dir = dir
    return () => {
      root.lang = prevLang
      if (prevDir === null) root.removeAttribute("dir")
      else root.setAttribute("dir", prevDir)
    }
  }, [lang, dir])

  const setLang = useCallback((next: Lang) => {
    setLangState(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Private-mode storage failures are non-fatal; the toggle still works.
    }
  }, [])

  const toggle = useCallback(
    () => setLang(lang === "en" ? "ur" : "en"),
    [lang, setLang],
  )

  const t = useCallback(
    (pair: Localized) => (lang === "ur" ? pair.ur || pair.en : pair.en),
    [lang],
  )

  const value = useMemo(
    () => ({ lang, dir, setLang, toggle, t }),
    [lang, dir, setLang, toggle, t],
  )

  return (
    <MarketingLangContext.Provider value={value}>
      {children}
    </MarketingLangContext.Provider>
  )
}

export function useMarketingLang(): MarketingLangState {
  const ctx = useContext(MarketingLangContext)
  if (!ctx)
    throw new Error("useMarketingLang must be used within MarketingLangProvider")
  return ctx
}
