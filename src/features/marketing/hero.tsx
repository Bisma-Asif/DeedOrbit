import { content } from "@/features/marketing/content"
import { useMarketingLang } from "@/features/marketing/i18n"
import { usePrefersReducedMotion } from "@/features/marketing/hooks"
import { BuildingScene } from "@/features/marketing/building-scene"
import { LandingIcon } from "@/features/marketing/icons"
import { MarketingButton } from "@/features/marketing/button"
import { Container, scrollToSection, SECTION_IDS } from "@/features/marketing/ui"
import { navigate } from "@/lib/router"

interface HeroProps {
  onBookDemo: () => void
}

export function Hero({ onBookDemo }: HeroProps) {
  const { t } = useMarketingLang()
  const reduced = usePrefersReducedMotion()
  const h = content.hero

  return (
    <section className="relative flex min-h-[100svh] items-center overflow-hidden bg-slate-950">
      {/* Cinematic background. Under reduced motion the poster still alone is the
          surface; the video never auto-plays. Sources 404 gracefully until the
          owner uploads /media, in which case the poster carries the frame. */}
      <div className="absolute inset-0" aria-hidden>
        <img
          src={content.media.heroPoster}
          alt=""
          className="h-full w-full object-cover"
          fetchPriority="high"
          width={1920}
          height={1080}
        />
        {!reduced ? (
          <video
            className="absolute inset-0 h-full w-full object-cover"
            autoPlay
            muted
            loop
            playsInline
            poster={content.media.heroPoster}
            preload="none"
          >
            <source src={content.media.heroVideoWebm} type="video/webm" />
            <source src={content.media.heroVideo} type="video/mp4" />
          </video>
        ) : null}
        {/* Dark slate scrim for legibility (allowed over video). */}
        <div className="absolute inset-0 bg-slate-950/75" />
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/20 to-slate-950/60" />
      </div>

      <Container className="relative z-10 py-28 lg:py-32">
        <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_0.95fr]">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[12px] font-semibold tracking-wide text-emerald-300">
              {t(h.eyebrow)}
            </span>
            <h1 className="font-display mt-5 text-4xl font-semibold leading-[1.1] tracking-tight text-white sm:text-5xl lg:text-6xl">
              {t(h.headline)}
            </h1>
            <p className="mt-5 max-w-xl text-[16px] leading-7 text-slate-200 sm:text-[17px]">
              {t(h.sub)}
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <MarketingButton size="lg" onClick={() => navigate("/signup")}>
                {t(h.ctaPrimary)}
              </MarketingButton>
              <MarketingButton size="lg" variant="outline" onClick={onBookDemo}>
                {t(h.ctaSecondary)}
              </MarketingButton>
            </div>
            <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-3">
              {h.trust.map((item) => (
                <li
                  key={item.icon}
                  className="flex items-center gap-2 text-[13.5px] text-slate-200"
                >
                  <LandingIcon
                    name={item.icon}
                    size={18}
                    className="text-emerald-400"
                  />
                  {t(item.label)}
                </li>
              ))}
            </ul>
          </div>

          <div className="hidden lg:block">
            <BuildingScene cards={h.orbitCards.map((c) => t(c))} />
          </div>
        </div>
      </Container>

      <button
        type="button"
        onClick={() => scrollToSection(SECTION_IDS.features)}
        aria-label={t(h.scroll)}
        className="absolute inset-x-0 bottom-6 z-10 mx-auto flex w-max flex-col items-center gap-2 text-white/70 transition-colors hover:text-white"
      >
        <span className="text-[11px] font-medium tracking-[0.16em] uppercase">
          {t(h.scroll)}
        </span>
        <span className="flex h-9 w-5 items-start justify-center rounded-full border border-white/40 p-1">
          <span className="mk-anim-cue size-1.5 rounded-full bg-emerald-400" />
        </span>
      </button>
    </section>
  )
}
