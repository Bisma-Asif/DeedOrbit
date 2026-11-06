import { content } from "@/features/marketing/content"
import { useMarketingLang } from "@/features/marketing/i18n"
import { useReveal } from "@/features/marketing/hooks"
import { LandingIcon } from "@/features/marketing/icons"
import { Container, Eyebrow, Section } from "@/features/marketing/ui"
import { cn } from "@/lib/utils"

/**
 * A framed browser mockup of the DeedOrbit workspace. The figures here are
 * illustrative sample data — the section prints a note saying so, in keeping with
 * the rule to never present made-up numbers as real. It tilts slightly and settles
 * upright as it scrolls into view, and straightens fully under reduced motion.
 */

const SAMPLE_TILES = [
  { label: "Total sales", value: "PKR 42.8M", trend: "+6.4%" },
  { label: "Collected", value: "PKR 18.2M", trend: "+3.1%" },
  { label: "Overdue", value: "PKR 5.6M", trend: "-1.2%" },
]

const SAMPLE_BARS = [38, 52, 46, 61, 55, 72, 68, 80]

export function DashboardPreview() {
  const { t } = useMarketingLang()
  const p = content.preview
  const { ref, visible } = useReveal({ threshold: 0.3 })

  return (
    <Section band="dark" id="preview">
      <Container>
        <div className="mx-auto max-w-3xl text-center">
          <div className="flex justify-center">
            <Eyebrow dark>{t(p.eyebrow)}</Eyebrow>
          </div>
          <h2 className="font-display mt-4 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            {t(p.title)}
          </h2>
        </div>

        <div
          ref={ref}
          className="mk-persp mx-auto mt-14 max-w-5xl transition-transform duration-1000 ease-out"
          style={{
            transform: visible
              ? "perspective(1600px) rotateX(0deg)"
              : "perspective(1600px) rotateX(9deg)",
          }}
        >
          <div className="relative rounded-2xl border border-white/10 bg-nav shadow-overlay">
            {/* Browser chrome */}
            <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
              <span className="size-2.5 rounded-full bg-white/25" />
              <span className="size-2.5 rounded-full bg-white/25" />
              <span className="size-2.5 rounded-full bg-white/25" />
              <div className="mx-auto flex h-6 w-full max-w-xs items-center justify-center rounded-md bg-white/5 text-[11px] text-nav-muted">
                app.deedorbit.com / dashboard
              </div>
            </div>

            <div className="grid grid-cols-[auto_1fr] gap-0 p-3 sm:p-4">
              {/* Rail */}
              <div className="hidden w-40 flex-col gap-1 pr-3 sm:flex">
                {["Dashboard", "Inventory", "Bookings", "Payments", "Documents", "Reports"].map(
                  (item, i) => (
                    <div
                      key={item}
                      className={cn(
                        "rounded-md px-3 py-2 text-[12.5px]",
                        i === 0
                          ? "bg-primary/20 text-white"
                          : "text-nav-muted",
                      )}
                    >
                      {item}
                    </div>
                  ),
                )}
              </div>

              {/* Content */}
              <div className="rounded-xl bg-white/5 p-4">
                <div className="grid grid-cols-3 gap-3">
                  {SAMPLE_TILES.map((tile) => (
                    <div
                      key={tile.label}
                      className="rounded-lg border border-white/10 bg-nav/60 p-3"
                    >
                      <p className="text-[11px] text-nav-muted">{tile.label}</p>
                      <p className="mt-1 text-[15px] font-semibold text-white sm:text-lg">
                        {tile.value}
                      </p>
                      <p className="mt-0.5 text-[11px] text-emerald-400">{tile.trend}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex items-end gap-2 rounded-lg border border-white/10 bg-nav/60 p-4">
                  {SAMPLE_BARS.map((h, i) => (
                    <div
                      key={i}
                      className="flex-1 rounded-t bg-emerald-500/70"
                      style={{ height: `${h}px` }}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Floating callouts */}
          <div className="pointer-events-none absolute -top-4 left-4 hidden sm:block">
            {p.callouts.slice(0, 1).map((c) => (
              <Callout key={c.icon} icon={c.icon} label={t(c.label)} hint={t(c.hint)} />
            ))}
          </div>
          <div className="pointer-events-none absolute top-1/3 -right-5 hidden sm:block">
            {p.callouts.slice(1, 2).map((c) => (
              <Callout key={c.icon} icon={c.icon} label={t(c.label)} hint={t(c.hint)} />
            ))}
          </div>
          <div className="pointer-events-none absolute -bottom-4 left-10 hidden sm:block">
            {p.callouts.slice(2, 3).map((c) => (
              <Callout key={c.icon} icon={c.icon} label={t(c.label)} hint={t(c.hint)} />
            ))}
          </div>
        </div>

        <p className="mx-auto mt-6 max-w-2xl text-center text-[12.5px] text-nav-muted">
          {t(p.note)}
        </p>
      </Container>
    </Section>
  )
}

interface CalloutProps {
  icon: string
  label: string
  hint: string
}

function Callout({ icon, label, hint }: CalloutProps) {
  return (
    <div className="mk-anim-bob flex items-center gap-3 rounded-xl border border-white/15 bg-nav/90 px-3.5 py-2.5 shadow-overlay backdrop-blur-sm">
      <span className="flex size-9 items-center justify-center rounded-lg bg-primary/20 text-emerald-300">
        <LandingIcon name={icon} size={18} />
      </span>
      <div>
        <p className="text-[12px] font-semibold text-white">{label}</p>
        <p className="text-[11px] text-nav-muted">{hint}</p>
      </div>
    </div>
  )
}
