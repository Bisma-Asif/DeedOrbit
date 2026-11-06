import { useEffect, useRef, useState } from "react"
import { ChevronDown, Menu, X } from "lucide-react"
import { content } from "@/features/marketing/content"
import { useMarketingLang } from "@/features/marketing/i18n"
import { useScrolled } from "@/features/marketing/hooks"
import { SECTION_IDS, scrollToSection } from "@/features/marketing/ui"
import { MarketingButton } from "@/features/marketing/button"
import { navigate } from "@/lib/router"
import { useSession } from "@/lib/session-context"
import { cn } from "@/lib/utils"

/** The DeedOrbit wordmark: an emerald orbit dot set beside the serif name. */
function Wordmark({ dark }: { dark: boolean }) {
  return (
    <button
      type="button"
      onClick={() => navigate("/")}
      className="group flex items-center gap-2.5 outline-none"
      aria-label="DeedOrbit home"
    >
      <span className="relative flex size-8 items-center justify-center rounded-lg bg-primary">
        <span className="size-2 rounded-full bg-white" />
        <span className="absolute inset-1 rounded-full border border-white/40" />
      </span>
      <span
        className={cn(
          "font-display text-[20px] font-semibold tracking-tight",
          dark ? "text-white" : "text-foreground",
        )}
      >
        {content.site.name}
      </span>
    </button>
  )
}

export function Navbar() {
  const { t, lang, toggle } = useMarketingLang()
  const scrolled = useScrolled(12)
  const { data, signOut } = useSession()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)

  // Hero is dark, so at the very top the bar is transparent with light text; once
  // scrolled it becomes a solid off-white sheet with a hairline border.
  const onDark = !scrolled && !mobileOpen

  useEffect(() => {
    if (!menuOpen) return
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node))
        setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false)
    }
    document.addEventListener("mousedown", onClick)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onClick)
      document.removeEventListener("keydown", onKey)
    }
  }, [menuOpen])

  const goSection = (id: string) => {
    setMobileOpen(false)
    scrollToSection(id)
  }

  const links = content.nav.links
  const signedIn = Boolean(data)

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 transition-colors duration-300",
        onDark
          ? "bg-transparent"
          : "border-b border-border/70 bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70",
      )}
    >
      <nav className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-5 sm:px-8">
        <Wordmark dark={onDark} />

        <div className="hidden items-center gap-1 lg:flex">
          {links.map((link) => (
            <button
              key={link.id}
              type="button"
              onClick={() => goSection(SECTION_IDS[link.id as keyof typeof SECTION_IDS] ?? link.id)}
              className={cn(
                "rounded-md px-3 py-2 text-[14px] font-medium transition-colors",
                onDark
                  ? "text-white/80 hover:text-white hover:bg-white/10"
                  : "text-foreground/70 hover:text-foreground hover:bg-black/5",
              )}
            >
              {t(link.label)}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggle}
            aria-label="Switch language"
            className={cn(
              "hidden rounded-md px-2.5 py-1.5 text-[13px] font-semibold transition-colors sm:inline-flex",
              onDark
                ? "text-white/80 hover:text-white hover:bg-white/10"
                : "text-foreground/70 hover:text-foreground hover:bg-black/5",
            )}
          >
            {lang === "en" ? "اردو" : "EN"}
          </button>

          {signedIn ? (
            <div className="relative hidden items-center gap-2 lg:flex">
              <MarketingButton
                onClick={() => navigate("/dashboard")}
                variant="primary"
                size="md"
              >
                {t(content.nav.dashboard)}
              </MarketingButton>
              <div ref={menuRef}>
                <button
                  type="button"
                  onClick={() => setMenuOpen((v) => !v)}
                  aria-expanded={menuOpen}
                  aria-haspopup="menu"
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg px-3 py-2 text-[14px] font-medium transition-colors",
                    onDark
                      ? "text-white/85 hover:bg-white/10"
                      : "text-foreground/75 hover:bg-black/5",
                  )}
                >
                  <span className="max-w-[140px] truncate">
                    {data?.user.fullName ?? ""}
                  </span>
                  <ChevronDown size={15} />
                </button>
                {menuOpen ? (
                  <div
                    role="menu"
                    className="absolute end-0 mt-1 w-52 overflow-hidden rounded-xl border border-border bg-popover p-1 shadow-overlay"
                  >
                    <button
                      role="menuitem"
                      type="button"
                      onClick={() => {
                        setMenuOpen(false)
                        void signOut()
                        navigate("/")
                      }}
                      className="flex w-full items-center rounded-lg px-3 py-2 text-start text-[14px] text-foreground hover:bg-muted"
                    >
                      {t(content.nav.signOut)}
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="hidden items-center gap-2 lg:flex">
              <MarketingButton
                onClick={() => navigate("/login")}
                variant={onDark ? "outline" : "outlineLight"}
              >
                {t(content.nav.signIn)}
              </MarketingButton>
              <MarketingButton onClick={() => navigate("/signup")}>
                {t(content.nav.signUp)}
              </MarketingButton>
            </div>
          )}

          <button
            type="button"
            onClick={() => setMobileOpen((v) => !v)}
            aria-label="Menu"
            aria-expanded={mobileOpen}
            className={cn(
              "inline-flex size-10 items-center justify-center rounded-lg transition-colors lg:hidden",
              onDark
                ? "text-white hover:bg-white/10"
                : "text-foreground hover:bg-black/5",
            )}
          >
            {mobileOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </nav>

      {mobileOpen ? (
        <div className="border-t border-border bg-background lg:hidden">
          <div className="mx-auto flex max-w-7xl flex-col gap-1 px-5 py-4 sm:px-8">
            {links.map((link) => (
              <button
                key={link.id}
                type="button"
                onClick={() =>
                  goSection(SECTION_IDS[link.id as keyof typeof SECTION_IDS] ?? link.id)
                }
                className="rounded-lg px-3 py-2.5 text-start text-[15px] font-medium text-foreground hover:bg-muted"
              >
                {t(link.label)}
              </button>
            ))}
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={toggle}
                className="rounded-lg border border-border px-3 py-2 text-[14px] font-semibold text-foreground"
              >
                {lang === "en" ? "اردو" : "EN"}
              </button>
              {signedIn ? (
                <>
                  <MarketingButton
                    onClick={() => {
                      setMobileOpen(false)
                      navigate("/dashboard")
                    }}
                    className="flex-1"
                  >
                    {t(content.nav.dashboard)}
                  </MarketingButton>
                  <MarketingButton
                    variant="ghostLight"
                    onClick={() => {
                      setMobileOpen(false)
                      void signOut()
                      navigate("/")
                    }}
                  >
                    {t(content.nav.signOut)}
                  </MarketingButton>
                </>
              ) : (
                <>
                  <MarketingButton
                    variant="outlineLight"
                    onClick={() => {
                      setMobileOpen(false)
                      navigate("/login")
                    }}
                    className="flex-1"
                  >
                    {t(content.nav.signIn)}
                  </MarketingButton>
                  <MarketingButton
                    onClick={() => {
                      setMobileOpen(false)
                      navigate("/signup")
                    }}
                    className="flex-1"
                  >
                    {t(content.nav.signUp)}
                  </MarketingButton>
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </header>
  )
}
