import { content } from "@/features/marketing/content"
import { useMarketingLang } from "@/features/marketing/i18n"
import { useCountUp, useReveal } from "@/features/marketing/hooks"
import { Container, Eyebrow, Reveal, Section } from "@/features/marketing/ui"

interface StatProps {
  value: string
  label: string
  active: boolean
}

/**
 * Animates only the numeric prefix of a value ("8+" counts 0→8 then adds the "+"),
 * and renders non-numeric capabilities ("∞", "24/7") as-is. Reduced motion shows the
 * final value immediately.
 */
function Stat({ value, label, active }: StatProps) {
  const match = /^(\d+)(.*)$/.exec(value)
  const target = match ? Number(match[1]) : null
  const suffix = match ? match[2] : ""
  const shown = useCountUp(target ?? 0, active && target !== null)

  return (
    <div className="text-center">
      <div className="font-display text-4xl font-semibold tracking-tight text-white sm:text-5xl">
        {target === null ? value : `${shown}${suffix}`}
      </div>
      <p className="mt-2 text-[14px] text-nav-muted">{label}</p>
    </div>
  )
}

export function Numbers() {
  const { t } = useMarketingLang()
  const n = content.numbers
  const { ref, visible } = useReveal({ threshold: 0.3 })

  return (
    <Section band="dark" id="numbers">
      <Container>
        <div className="mx-auto max-w-2xl text-center">
          <div className="flex justify-center">
            <Eyebrow dark>{t(n.eyebrow)}</Eyebrow>
          </div>
          <h2 className="font-display mt-4 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            {t(n.title)}
          </h2>
        </div>

        <div
          ref={ref}
          className="mt-14 grid grid-cols-2 gap-8 border-y border-white/10 py-10 lg:grid-cols-4"
        >
          {n.items.map((item, index) => (
            <Reveal key={item.value} delay={index * 80}>
              <Stat value={item.value} label={t(item.label)} active={visible} />
            </Reveal>
          ))}
        </div>

        <p className="mx-auto mt-8 max-w-xl text-center text-[12.5px] text-nav-muted">
          {t(n.note)}
        </p>
      </Container>
    </Section>
  )
}
