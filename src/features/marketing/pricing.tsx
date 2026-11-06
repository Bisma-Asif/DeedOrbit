import { useState } from "react"
import { Check } from "lucide-react"
import { content } from "@/features/marketing/content"
import { useMarketingLang } from "@/features/marketing/i18n"
import { MarketingButton } from "@/features/marketing/button"
import {
  Container,
  Eyebrow,
  Reveal,
  Section,
  SectionHeading,
} from "@/features/marketing/ui"
import { navigate } from "@/lib/router"
import { cn } from "@/lib/utils"

interface PricingProps {
  onBookDemo: () => void
}

type Cycle = "monthly" | "yearly"

function formatPKR(amount: number) {
  return amount.toLocaleString("en-PK")
}

export function Pricing({ onBookDemo }: PricingProps) {
  const { t } = useMarketingLang()
  const p = content.pricing
  const [cycle, setCycle] = useState<Cycle>("monthly")

  return (
    <Section band="sand" id="pricing">
      <Container>
        <Reveal>
          <div className="flex flex-col items-center text-center">
            <Eyebrow>{t(p.eyebrow)}</Eyebrow>
            <div className="mt-4">
              <SectionHeading title={t(p.title)} center />
            </div>
          </div>
        </Reveal>

        <div className="mt-8 flex items-center justify-center gap-1.5">
          <div className="inline-flex rounded-full border border-slate-900/10 bg-white p-1">
            {(["monthly", "yearly"] as Cycle[]).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setCycle(option)}
                aria-pressed={cycle === option}
                className={cn(
                  "rounded-full px-4 py-1.5 text-[14px] font-semibold transition-colors",
                  cycle === option
                    ? "bg-primary text-white"
                    : "text-foreground/70 hover:text-foreground",
                )}
              >
                {t(option === "monthly" ? p.toggleMonthly : p.toggleYearly)}
              </button>
            ))}
          </div>
          <span className="rounded-full bg-warning-subtle px-2.5 py-1 text-[12px] font-semibold text-warning">
            {t(p.yearlyBadge)}
          </span>
        </div>

        <div className="mt-10 grid gap-5 lg:grid-cols-4">
          {p.plans.map((plan, index) => {
            const popular = "popular" in plan && plan.popular === true
            const amount = cycle === "monthly" ? plan.monthly : plan.yearly
            return (
              <Reveal key={plan.id} delay={index * 70}>
                <div
                  className={cn(
                    "relative flex h-full flex-col rounded-2xl border bg-white p-6 shadow-card",
                    popular
                      ? "border-primary shadow-raised lg:-mt-3 lg:mb-3"
                      : "border-slate-900/10",
                  )}
                >
                  {popular ? (
                    <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-1 text-[11px] font-semibold tracking-wide text-white uppercase">
                      {t(p.popular)}
                    </span>
                  ) : null}

                  <h3 className="text-[17px] font-semibold text-foreground">
                    {t(plan.name)}
                  </h3>
                  <p className="mt-1 text-[13px] leading-5 text-muted-foreground">
                    {t(plan.tagline)}
                  </p>

                  <div className="mt-5 min-h-[64px]">
                    {amount !== null ? (
                      <>
                        <div className="flex items-end gap-1">
                          <span className="text-[15px] font-medium text-muted-foreground">
                            {p.currency}
                          </span>
                          <span className="font-display text-3xl font-semibold text-foreground">
                            {formatPKR(amount)}
                          </span>
                        </div>
                        <span className="text-[13px] text-muted-foreground">
                          / {t(cycle === "monthly" ? p.toggleMonthly : p.toggleYearly).toLowerCase()}
                        </span>
                      </>
                    ) : (
                      <div className="font-display text-3xl font-semibold text-foreground">
                        {"priceLabel" in plan && plan.priceLabel
                          ? t(plan.priceLabel)
                          : ""}
                      </div>
                    )}
                  </div>

                  <ul className="mt-5 flex-1 space-y-2.5">
                    {plan.features.map((feature) => (
                      <li
                        key={feature.en}
                        className="flex items-start gap-2.5 text-[13.5px] text-foreground/85"
                      >
                        <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                          <Check size={13} strokeWidth={2.5} />
                        </span>
                        {t(feature)}
                      </li>
                    ))}
                  </ul>

                  <MarketingButton
                    className="mt-6 w-full"
                    variant={popular ? "primary" : "outlineLight"}
                    onClick={() =>
                      plan.id === "enterprise"
                        ? onBookDemo()
                        : navigate("/signup")
                    }
                  >
                    {t(plan.cta)}
                  </MarketingButton>
                </div>
              </Reveal>
            )
          })}
        </div>

        <p className="mt-8 text-center text-[13px] text-muted-foreground">
          {t(p.trialNote)} · {t(p.taxNote)}
        </p>
      </Container>
    </Section>
  )
}
