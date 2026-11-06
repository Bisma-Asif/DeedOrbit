import { useState } from "react"
import { ChevronDown } from "lucide-react"
import { content } from "@/features/marketing/content"
import { useMarketingLang } from "@/features/marketing/i18n"
import {
  Container,
  Eyebrow,
  Reveal,
  Section,
  SectionHeading,
} from "@/features/marketing/ui"
import { cn } from "@/lib/utils"

export function Faq() {
  const { t } = useMarketingLang()
  const f = content.faq
  const [open, setOpen] = useState<number | null>(0)

  return (
    <Section band="light" id="faq">
      <Container className="max-w-3xl">
        <Reveal>
          <Eyebrow>{t(f.eyebrow)}</Eyebrow>
          <div className="mt-4">
            <SectionHeading title={t(f.title)} />
          </div>
        </Reveal>

        <div className="mt-8 divide-y divide-border border-y border-border">
          {f.items.map((item, index) => {
            const expanded = open === index
            const panelId = `faq-panel-${index}`
            const buttonId = `faq-button-${index}`
            return (
              <div key={item.q.en}>
                <h3>
                  <button
                    id={buttonId}
                    type="button"
                    aria-expanded={expanded}
                    aria-controls={panelId}
                    onClick={() => setOpen(expanded ? null : index)}
                    className="flex w-full items-center justify-between gap-4 py-5 text-start"
                  >
                    <span className="text-[16px] font-medium text-foreground">
                      {t(item.q)}
                    </span>
                    <ChevronDown
                      size={20}
                      className={cn(
                        "shrink-0 text-muted-foreground transition-transform duration-300",
                        expanded && "rotate-180",
                      )}
                    />
                  </button>
                </h3>
                <div
                  id={panelId}
                  role="region"
                  aria-labelledby={buttonId}
                  hidden={!expanded}
                  className="pb-5 text-[14.5px] leading-7 text-muted-foreground"
                >
                  {t(item.a)}
                </div>
              </div>
            )
          })}
        </div>
      </Container>
    </Section>
  )
}
