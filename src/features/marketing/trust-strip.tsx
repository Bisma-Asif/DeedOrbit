import { content } from "@/features/marketing/content"
import { useMarketingLang } from "@/features/marketing/i18n"
import { LandingIcon } from "@/features/marketing/icons"
import { Container, Reveal } from "@/features/marketing/ui"

export function TrustStrip() {
  const { t } = useMarketingLang()
  const s = content.trustStrip

  return (
    <section className="border-b border-border bg-background py-12 sm:py-14">
      <Container>
        <Reveal>
          <p className="text-center text-[13px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
            {t(s.heading)}
          </p>
        </Reveal>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-x-10 gap-y-6">
          {s.items.map((item, index) => (
            <Reveal key={item.icon} delay={index * 60}>
              <div className="flex items-center gap-2.5 text-foreground/75">
                <LandingIcon name={item.icon} size={22} strokeWidth={1.6} />
                <span className="text-[15px] font-medium">{t(item.label)}</span>
              </div>
            </Reveal>
          ))}
        </div>
      </Container>
    </section>
  )
}
