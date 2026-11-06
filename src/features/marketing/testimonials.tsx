import { content, type Localized } from "@/features/marketing/content"
import { useMarketingLang } from "@/features/marketing/i18n"
import { Container, Eyebrow, Reveal, Section, SectionHeading } from "@/features/marketing/ui"

interface TestimonialItem {
  author: string
  role: string
  quote: Localized
}

/**
 * Testimonials render ONLY when `content.testimonials.show` is true and real,
 * permissioned quotes exist. While hidden, the section prints nothing rather than
 * fabricating a review — the honesty rule from the brief.
 */
export function Testimonials() {
  const { t } = useMarketingLang()
  const s = content.testimonials
  // Widen the `as const` literals so the render path below stays reachable once the
  // owner flips `show` and fills `items`.
  const show: boolean = s.show
  const items: readonly TestimonialItem[] = s.items
  if (!show || items.length === 0) return null

  return (
    <Section band="light" id="testimonials">
      <Container>
        <Reveal>
          <Eyebrow>{t(s.eyebrow)}</Eyebrow>
          <div className="mt-4">
            <SectionHeading title={t(s.title)} />
          </div>
        </Reveal>
        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {items.map((item) => (
            <Reveal key={item.author}>
              <figure className="flex h-full flex-col rounded-2xl border border-border bg-white p-6 shadow-card">
                <blockquote className="flex-1 text-[15px] leading-7 text-foreground">
                  “{t(item.quote)}”
                </blockquote>
                <figcaption className="mt-4 text-[13px] text-muted-foreground">
                  <span className="font-semibold text-foreground">{item.author}</span>
                  {" — "}
                  {item.role}
                </figcaption>
              </figure>
            </Reveal>
          ))}
        </div>
      </Container>
    </Section>
  )
}
