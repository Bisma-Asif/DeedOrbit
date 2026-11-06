import { content } from "@/features/marketing/content"
import { useMarketingLang } from "@/features/marketing/i18n"
import { MarketingButton } from "@/features/marketing/button"
import { Container } from "@/features/marketing/ui"
import { navigate } from "@/lib/router"

interface CtaBandProps {
  onBookDemo: () => void
}

export function CtaBand({ onBookDemo }: CtaBandProps) {
  const { t } = useMarketingLang()
  const c = content.ctaBand

  return (
    <section className="relative overflow-hidden bg-slate-950 py-20 sm:py-24">
      {/* Subtle orbit motif — thin emerald rings, no glow blobs, no color gradient. */}
      <svg
        aria-hidden
        viewBox="0 0 800 400"
        preserveAspectRatio="xMidYMid slice"
        className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.18]"
      >
        <g fill="none" stroke="#10b981" strokeWidth="1">
          <ellipse cx="400" cy="200" rx="360" ry="120" />
          <ellipse cx="400" cy="200" rx="260" ry="86" />
          <ellipse cx="400" cy="200" rx="160" ry="52" />
        </g>
        <circle cx="760" cy="200" r="6" fill="#10b981" />
        <circle cx="140" cy="200" r="4" fill="#10b981" />
      </svg>

      <Container className="relative text-center">
        <h2 className="font-display mx-auto max-w-2xl text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          {t(c.title)}
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-[15px] leading-7 text-slate-300">
          {t(c.body)}
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <MarketingButton size="lg" onClick={() => navigate("/signup")}>
            {t(c.primary)}
          </MarketingButton>
          <MarketingButton size="lg" variant="outline" onClick={onBookDemo}>
            {t(c.secondary)}
          </MarketingButton>
        </div>
      </Container>
    </section>
  )
}
