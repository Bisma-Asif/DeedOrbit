import { useEffect, useState } from "react"
import { X } from "lucide-react"
import { content } from "@/features/marketing/content"
import { useMarketingLang } from "@/features/marketing/i18n"
import { ImageSlot, VideoClip } from "@/features/marketing/media-slot"
import { Container, Eyebrow, Section, SectionHeading } from "@/features/marketing/ui"

type GalleryKey = keyof typeof content.media.gallery

interface ActiveItem {
  src: string
  clip: string
  label: string
}

export function Gallery() {
  const { t } = useMarketingLang()
  const g = content.gallery
  const [active, setActive] = useState<ActiveItem | null>(null)

  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setActive(null)
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [active])

  return (
    <Section band="light" id="gallery" className="overflow-hidden">
      <Container>
        <div className="flex items-end justify-between gap-6">
          <div>
            <Eyebrow>{t(g.eyebrow)}</Eyebrow>
            <div className="mt-4">
              <SectionHeading title={t(g.title)} />
            </div>
          </div>
          <p className="hidden shrink-0 text-[12.5px] text-muted-foreground sm:block">
            {t(g.lightboxHint)}
          </p>
        </div>
      </Container>

      <div className="mt-10">
        <ul className="flex snap-x snap-mandatory gap-4 overflow-x-auto px-5 pb-4 sm:px-8 [scrollbar-width:thin]">
          {g.items.map((item) => {
            const key = item.key as GalleryKey
            const src = content.media.gallery[key]
            const clip =
              key in content.media.clips
                ? content.media.clips[key as keyof typeof content.media.clips]
                : ""
            return (
              <li
                key={item.key}
                className="w-[260px] shrink-0 snap-start sm:w-[320px]"
              >
                <button
                  type="button"
                  onClick={() =>
                    setActive({ src, clip, label: t(item.label) })
                  }
                  className="group relative block aspect-[4/3] w-full overflow-hidden rounded-2xl border border-border bg-white text-start shadow-card"
                >
                  <ImageSlot
                    src={src}
                    alt={t(item.label)}
                    label={t(item.label)}
                    width={640}
                    height={480}
                    imgClassName="transition-transform duration-500 ease-out group-hover:scale-105"
                  />
                  <span className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-slate-950/65 px-3.5 py-2 text-[13px] font-medium text-white">
                    {t(item.label)}
                    {clip ? (
                      <span className="text-[11px] text-emerald-300">Clip</span>
                    ) : null}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </div>

      {active ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={active.label}
          onClick={() => setActive(null)}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/85 p-4"
        >
          <div
            className="relative w-full max-w-3xl overflow-hidden rounded-2xl bg-nav shadow-overlay"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setActive(null)}
              aria-label="Close"
              className="absolute end-3 top-3 z-10 flex size-9 items-center justify-center rounded-lg bg-slate-950/60 text-white hover:bg-slate-950/80"
            >
              <X size={18} />
            </button>
            <div className="aspect-[16/10]">
              {active.clip ? (
                <VideoClip
                  src={active.clip}
                  poster={active.src}
                  label={active.label}
                  className="h-full w-full"
                />
              ) : (
                <ImageSlot
                  src={active.src}
                  alt={active.label}
                  label={active.label}
                  width={1200}
                  height={750}
                  className="h-full w-full"
                />
              )}
            </div>
            <div className="px-5 py-3 text-[14px] font-medium text-white">
              {active.label}
            </div>
          </div>
        </div>
      ) : null}
    </Section>
  )
}
