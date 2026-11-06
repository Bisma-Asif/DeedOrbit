import { Check } from "lucide-react"
import { content } from "@/features/marketing/content"
import { useMarketingLang } from "@/features/marketing/i18n"
import { LandingIcon } from "@/features/marketing/icons"
import {
  Container,
  Eyebrow,
  Reveal,
  Section,
  SectionHeading,
} from "@/features/marketing/ui"

export function ProblemSolution() {
  const { t } = useMarketingLang()
  const p = content.problem

  return (
    <Section band="light">
      <Container>
        <Reveal>
          <Eyebrow>{t(p.eyebrow)}</Eyebrow>
          <div className="mt-4">
            <SectionHeading title={t(p.title)} />
          </div>
        </Reveal>

        <div className="mt-12 grid gap-8 lg:grid-cols-2">
          <div className="grid gap-4 sm:grid-cols-1">
            {p.pains.map((pain, index) => (
              <Reveal key={pain.icon} delay={index * 80}>
                <div className="flex gap-4 rounded-xl border border-border bg-white p-5 shadow-card">
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-danger-subtle text-danger">
                    <LandingIcon name={pain.icon} size={22} />
                  </span>
                  <div>
                    <h3 className="text-[16px] font-semibold text-foreground">
                      {t(pain.title)}
                    </h3>
                    <p className="mt-1 text-[14px] leading-6 text-muted-foreground">
                      {t(pain.body)}
                    </p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>

          <Reveal delay={120}>
            <div className="flex h-full flex-col justify-center rounded-2xl bg-nav p-7 text-nav-foreground shadow-raised sm:p-9">
              <h3 className="font-display text-2xl font-semibold text-white">
                {t(p.solution.title)}
              </h3>
              <p className="mt-3 text-[15px] leading-7 text-nav-muted">
                {t(p.solution.body)}
              </p>
              <ul className="mt-6 space-y-3">
                {p.solution.points.map((point) => (
                  <li key={point.en} className="flex items-start gap-3">
                    <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-white">
                      <Check size={15} strokeWidth={2.5} />
                    </span>
                    <span className="text-[15px] text-slate-100">{t(point)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>
        </div>
      </Container>
    </Section>
  )
}
