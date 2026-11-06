import { Check } from "lucide-react"
import { content } from "@/features/marketing/content"
import { useMarketingLang } from "@/features/marketing/i18n"
import { LandingIcon } from "@/features/marketing/icons"
import { ImageSlot } from "@/features/marketing/media-slot"
import {
  Container,
  Eyebrow,
  Reveal,
  Section,
  SectionHeading,
} from "@/features/marketing/ui"
import { cn } from "@/lib/utils"

export function Features() {
  const { t } = useMarketingLang()
  const f = content.features

  return (
    <Section band="sand" id="features">
      <Container>
        <Reveal>
          <Eyebrow>{t(f.eyebrow)}</Eyebrow>
          <div className="mt-4">
            <SectionHeading title={t(f.title)} />
          </div>
        </Reveal>

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {f.cards.map((card, index) => (
            <Reveal key={card.icon} delay={(index % 4) * 70}>
              <div className="group h-full rounded-xl border border-slate-900/10 bg-white p-5 shadow-card transition-shadow hover:shadow-raised">
                <span className="flex size-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <LandingIcon name={card.icon} size={22} />
                </span>
                <h3 className="mt-4 text-[15.5px] font-semibold text-foreground">
                  {t(card.title)}
                </h3>
                <p className="mt-1.5 text-[13.5px] leading-6 text-muted-foreground">
                  {t(card.body)}
                </p>
              </div>
            </Reveal>
          ))}
        </div>

        <div className="mt-16 space-y-14">
          {f.showcases.map((showcase, index) => (
            <Reveal key={showcase.screenshotSlot}>
              <div
                className={cn(
                  "grid items-center gap-8 lg:grid-cols-2 lg:gap-12",
                )}
              >
                <div className={cn(index % 2 === 1 && "lg:order-2")}>
                  <span className="flex size-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <LandingIcon name={showcase.icon} size={22} />
                  </span>
                  <h3 className="font-display mt-4 text-2xl font-semibold tracking-tight text-foreground sm:text-[28px]">
                    {t(showcase.title)}
                  </h3>
                  <p className="mt-3 text-[15px] leading-7 text-muted-foreground">
                    {t(showcase.body)}
                  </p>
                  <ul className="mt-5 space-y-2.5">
                    {showcase.bullets.map((bullet) => (
                      <li
                        key={bullet.en}
                        className="flex items-start gap-2.5 text-[14.5px] text-foreground/85"
                      >
                        <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-white">
                          <Check size={13} strokeWidth={2.5} />
                        </span>
                        {t(bullet)}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className={cn("lg:order-none", index % 2 === 1 && "lg:order-1")}>
                  <div className="overflow-hidden rounded-2xl border border-slate-900/10 bg-white p-2 shadow-raised">
                    <div className="flex items-center gap-1.5 px-2 py-1.5">
                      <span className="size-2.5 rounded-full bg-slate-300" />
                      <span className="size-2.5 rounded-full bg-slate-300" />
                      <span className="size-2.5 rounded-full bg-slate-300" />
                    </div>
                    <div className="overflow-hidden rounded-xl">
                      <ImageSlot
                        src=""
                        alt={t(showcase.title)}
                        label={`Screenshot slot: ${showcase.screenshotSlot}`}
                        width={1280}
                        height={800}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </Container>
    </Section>
  )
}
