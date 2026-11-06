import { useEffect, useState } from "react"
import { content } from "@/features/marketing/content"
import { useMarketingLang } from "@/features/marketing/i18n"

const DISMISS_KEY = "deedorbit.cookieNotice"

/**
 * A slim cookie acknowledgement. The product sets only essential session cookies,
 * so the copy says exactly that; the notice hides permanently once dismissed.
 */
export function CookieNotice() {
  const { t } = useMarketingLang()
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    try {
      setVisible(window.localStorage.getItem(DISMISS_KEY) !== "1")
    } catch {
      setVisible(true)
    }
  }, [])

  if (!visible) return null

  const accept = () => {
    setVisible(false)
    try {
      window.localStorage.setItem(DISMISS_KEY, "1")
    } catch {
      // Ignore storage failures; the notice simply shows again next visit.
    }
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-[55] border-t border-border bg-background/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-col items-center gap-3 px-5 py-3 sm:flex-row sm:justify-between sm:px-8">
        <p className="text-[13px] leading-5 text-muted-foreground">
          {t(content.cookie.body)}
        </p>
        <button
          type="button"
          onClick={accept}
          className="shrink-0 rounded-lg bg-primary px-4 py-2 text-[13px] font-semibold text-white hover:bg-primary-hover"
        >
          {t(content.cookie.accept)}
        </button>
      </div>
    </div>
  )
}
