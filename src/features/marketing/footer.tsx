import { content } from "@/features/marketing/content"
import { useMarketingLang } from "@/features/marketing/i18n"
import { Container, SECTION_IDS, scrollToSection } from "@/features/marketing/ui"
import { navigate } from "@/lib/router"

interface FooterProps {
  onBookDemo: () => void
}

export function Footer({ onBookDemo }: FooterProps) {
  const { t } = useMarketingLang()
  const f = content.footer
  const c = content.contact
  const year = new Date().getFullYear()

  // lucide-react ships no brand glyphs, so socials render as small monogram links
  // and only appear once the owner fills a URL in content.ts.
  const socialLinks = [
    { key: "linkedin", label: "LinkedIn", href: c.social.linkedin },
    { key: "facebook", label: "Facebook", href: c.social.facebook },
    { key: "x", label: "X", href: c.social.x },
    { key: "youtube", label: "YouTube", href: c.social.youtube },
  ].filter((s) => Boolean(s.href))

  const productTargets = [
    SECTION_IDS.features,
    SECTION_IDS.how,
    SECTION_IDS.pricing,
    null, // "Sign in"
  ]

  return (
    <footer className="bg-nav text-nav-foreground">
      <Container className="py-14">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div className="lg:col-span-1">
            <div className="flex items-center gap-2.5">
              <span className="relative flex size-8 items-center justify-center rounded-lg bg-primary">
                <span className="size-2 rounded-full bg-white" />
                <span className="absolute inset-1 rounded-full border border-white/40" />
              </span>
              <span className="font-display text-[19px] font-semibold text-white">
                {content.site.name}
              </span>
            </div>
            <p className="mt-3 max-w-xs text-[13px] leading-6 text-nav-muted">
              {t(content.site.description)}
            </p>
          </div>

          <div>
            <h3 className="text-[12px] font-semibold tracking-[0.14em] text-nav-muted uppercase">
              {t(f.productTitle)}
            </h3>
            <ul className="mt-4 space-y-2.5">
              {f.productLinks.map((label, index) => (
                <li key={label.en}>
                  <button
                    type="button"
                    onClick={() => {
                      const target = productTargets[index]
                      if (target) scrollToSection(target)
                      else navigate("/login")
                    }}
                    className="text-[14px] text-slate-300 transition-colors hover:text-white"
                  >
                    {t(label)}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="text-[12px] font-semibold tracking-[0.14em] text-nav-muted uppercase">
              {t(f.companyTitle)}
            </h3>
            <ul className="mt-4 space-y-2.5">
              <li>
                <button
                  type="button"
                  onClick={onBookDemo}
                  className="text-[14px] text-slate-300 transition-colors hover:text-white"
                >
                  {t(f.companyLinks[0])}
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => scrollToSection(SECTION_IDS.contact)}
                  className="text-[14px] text-slate-300 transition-colors hover:text-white"
                >
                  {t(f.companyLinks[1])}
                </button>
              </li>
              <li>
                <a
                  href={`mailto:${c.email}`}
                  className="text-[14px] text-slate-300 transition-colors hover:text-white"
                >
                  {c.email}
                </a>
              </li>
              <li>
                <a
                  href={`tel:${c.phoneHref}`}
                  className="text-[14px] text-slate-300 transition-colors hover:text-white"
                >
                  {c.phone}
                </a>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="text-[12px] font-semibold tracking-[0.14em] text-nav-muted uppercase">
              {t(f.legalTitle)}
            </h3>
            <ul className="mt-4 space-y-2.5">
              <li>
                <button
                  type="button"
                  onClick={() => navigate("/privacy")}
                  className="text-[14px] text-slate-300 transition-colors hover:text-white"
                >
                  {t(f.legal.privacy)}
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => navigate("/terms")}
                  className="text-[14px] text-slate-300 transition-colors hover:text-white"
                >
                  {t(f.legal.terms)}
                </button>
              </li>
            </ul>
            {socialLinks.length > 0 ? (
              <div className="mt-5 flex flex-wrap items-center gap-3">
                {socialLinks.map(({ key, label, href }) => (
                  <a
                    key={key}
                    href={href}
                    aria-label={label}
                    className="text-[13px] font-medium text-nav-muted transition-colors hover:text-white"
                  >
                    {label}
                  </a>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-3 border-t border-white/10 pt-6 text-[12.5px] text-nav-muted sm:flex-row">
          <p>
            © {year} {content.site.name}. {t(f.madeIn)}.
          </p>
          <p>{t(c.address)}</p>
        </div>
      </Container>
    </footer>
  )
}
