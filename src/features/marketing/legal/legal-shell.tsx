import { content, type Localized } from "@/features/marketing/content"
import { MarketingLangProvider, useMarketingLang } from "@/features/marketing/i18n"
import { navigate } from "@/lib/router"
import { cn } from "@/lib/utils"

interface LegalSection {
  heading: Localized
  body: Localized
}

interface LegalShellProps {
  title: Localized
  sections: LegalSection[]
}

function LegalHeader() {
  const { t, lang, toggle } = useMarketingLang()
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-3xl items-center justify-between px-5 sm:px-8">
        <button
          type="button"
          onClick={() => navigate("/")}
          className="flex items-center gap-2.5"
          aria-label="DeedOrbit home"
        >
          <span className="relative flex size-8 items-center justify-center rounded-lg bg-primary">
            <span className="size-2 rounded-full bg-white" />
            <span className="absolute inset-1 rounded-full border border-white/40" />
          </span>
          <span className="font-display text-[19px] font-semibold tracking-tight text-foreground">
            {content.site.name}
          </span>
        </button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggle}
            className="rounded-md px-2.5 py-1.5 text-[13px] font-semibold text-foreground/70 hover:bg-black/5"
          >
            {lang === "en" ? "اردو" : "EN"}
          </button>
          <button
            type="button"
            onClick={() => navigate("/")}
            className="rounded-md px-3 py-1.5 text-[14px] font-medium text-primary hover:bg-primary/10"
          >
            {t(content.auth.backHome)}
          </button>
        </div>
      </div>
    </header>
  )
}

function LegalBody({ title, sections }: LegalShellProps) {
  const { t, lang } = useMarketingLang()
  return (
    <main
      className={cn(
        "mx-auto w-full max-w-3xl px-5 py-12 sm:px-8",
        lang === "ur" && "mk-rtl",
      )}
    >
      <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
        {t(title)}
      </h1>
      <div className="mt-5 rounded-lg border border-warning/30 bg-warning-subtle px-4 py-3 text-[13px] text-warning">
        {t(content.legal.draftBanner)}
      </div>
      <div className="mt-8 space-y-8">
        {sections.map((section) => (
          <section key={section.heading.en}>
            <h2 className="text-[17px] font-semibold text-foreground">
              {t(section.heading)}
            </h2>
            <p className="mt-2 text-[15px] leading-7 text-muted-foreground">
              {t(section.body)}
            </p>
          </section>
        ))}
      </div>

      <footer className="mt-12 border-t border-border pt-6 text-[12.5px] text-muted-foreground">
        <p>
          © {new Date().getFullYear()} {content.site.name}.{" "}
          {t(content.footer.madeIn)}.
        </p>
      </footer>
    </main>
  )
}

export function LegalShell(props: LegalShellProps) {
  return (
    <MarketingLangProvider>
      <div className="min-h-screen bg-background">
        <LegalHeader />
        <LegalBody {...props} />
      </div>
    </MarketingLangProvider>
  )
}
