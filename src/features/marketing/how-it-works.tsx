import { content } from "@/features/marketing/content"
import { useMarketingLang } from "@/features/marketing/i18n"
import { useReveal } from "@/features/marketing/hooks"
import {
  Container,
  Eyebrow,
  Reveal,
  Section,
  SectionHeading,
} from "@/features/marketing/ui"

export function HowItWorks() {
  const { t } = useMarketingLang()
  const h = content.how
  const { ref, visible } = useReveal({ threshold: 0.25 })

  return (
    <Section band="light" id="how">
      <Container>
        <Reveal>
          <Eyebrow>{t(h.eyebrow)}</Eyebrow>
          <div className="mt-4">
            <SectionHeading title={t(h.title)} center />
          </div>
        </Reveal>

        <div ref={ref} className="relative mt-14">
          {/* Connector: a hairline that grows across the row once the section is in
              view. Hidden on mobile, where the steps stack vertically. */}
          <div
            aria-hidden
            className="absolute left-0 right-0 top-6 hidden h-px bg-border lg:block"
          >
            <div
              className="h-px origin-left bg-primary transition-transform duration-1000 ease-out"
              style={{ transform: `scaleX(${visible ? 1 : 0})`, width: "100%" }}
            />
          </div>

          <ol className="grid gap-8 lg:grid-cols-4 lg:gap-6">
            {h.steps.map((step, index) => (
              <Reveal key={step.title.en} delay={index * 90}>
                <li className="relative">
                  <div className="flex size-12 items-center justify-center rounded-full border border-primary/30 bg-white text-[16px] font-semibold text-primary shadow-card">
                    {index + 1}
                  </div>
                  <h3 className="mt-4 text-[16px] font-semibold text-foreground">
                    {t(step.title)}
                  </h3>
                  <p className="mt-1.5 text-[14px] leading-6 text-muted-foreground">
                    {t(step.body)}
                  </p>
                </li>
              </Reveal>
            ))}
          </ol>
        </div>
      </Container>
    </Section>
  )
}
