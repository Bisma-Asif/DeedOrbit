import { useCallback, useEffect, useState } from "react"

import {
  Check,
  Image as ImageIcon,
  LoaderCircle,
  RefreshCw,
  Video,
} from "lucide-react"

import { Alert, AlertDescription } from "@/components/ui/alert"

import { Button } from "@/components/ui/button"

import { Checkbox } from "@/components/ui/checkbox"

import { api, ApiError } from "@/lib/api"

import type { StoredMediaAsset } from "@shared/media"

interface ReviewSlot {
  key: string

  label: string

  type: "photo" | "video"

  optional: boolean

  selected: StoredMediaAsset | null

  previewUrl: string | null
}

interface ReviewResponse {
  slots: ReviewSlot[]

  updatedAt: string
}

interface Candidate {
  id: string

  slot: string

  type: "photo" | "video"

  provider: "Pexels" | "Pixabay"

  sourceUrl: string

  contributor: string

  description: string

  width: number

  height: number

  duration: number | null

  licenseNote: string

  previewUrl: string
}

function messageFor(error: unknown): string {
  if (error instanceof ApiError) return error.message

  return error instanceof Error ? error.message : "The media request failed."
}

function Preview({
  src,

  type,

  label,

  controls = false,
}: {
  src: string

  type: "photo" | "video"

  label: string

  controls?: boolean
}) {
  if (type === "video") {
    return (
      <video
        src={src}
        aria-label={label}
        controls={controls}
        muted
        loop
        playsInline
        preload="none"
        className="aspect-video w-full rounded-md bg-slate-950 object-cover"
      />
    )
  }

  return (
    <img
      src={src}
      alt={label}
      width={1280}
      height={800}
      loading="lazy"
      decoding="async"
      className="aspect-video w-full rounded-md bg-slate-100 object-cover"
    />
  )
}

export function MediaReviewPage() {
  const [slots, setSlots] = useState<ReviewSlot[]>([])

  const [pending, setPending] = useState<Record<string, Candidate>>({})

  const [seen, setSeen] = useState<Record<string, string[]>>({})

  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({})

  const [busy, setBusy] = useState<Record<string, boolean>>({})

  const [errors, setErrors] = useState<Record<string, string>>({})

  const [loading, setLoading] = useState(true)

  const loadReview = useCallback(async () => {
    setLoading(true)

    try {
      const result = await api.get<ReviewResponse>("/api/platform/media/review")

      setSlots(result.slots)
    } catch (error) {
      setErrors((current) => ({ ...current, page: messageFor(error) }))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadReview()
  }, [loadReview])

  async function pickAnother(slot: ReviewSlot) {
    setBusy((current) => ({ ...current, [slot.key]: true }))

    setErrors((current) => ({ ...current, [slot.key]: "" }))

    setConfirmed((current) => ({ ...current, [slot.key]: false }))

    const excludeIds = [
      ...(seen[slot.key] ?? []),

      ...(slot.selected ? [slot.selected.candidateId] : []),
    ]

    try {
      const result = await api.post<{ candidates: Candidate[] }>(
        "/api/platform/media/candidates",

        { slot: slot.key, excludeIds },
      )

      const candidate = result.candidates[0]

      if (!candidate) {
        setErrors((current) => ({
          ...current,

          [slot.key]:
            "No additional suitable candidates were found for this slot.",
        }))

        return
      }

      setPending((current) => ({ ...current, [slot.key]: candidate }))

      setSeen((current) => ({
        ...current,

        [slot.key]: [...(current[slot.key] ?? []), candidate.id],
      }))
    } catch (error) {
      setErrors((current) => ({ ...current, [slot.key]: messageFor(error) }))
    } finally {
      setBusy((current) => ({ ...current, [slot.key]: false }))
    }
  }

  async function useCandidate(slot: ReviewSlot) {
    const candidate = pending[slot.key]

    if (!candidate || !confirmed[slot.key]) return

    setBusy((current) => ({ ...current, [slot.key]: true }))

    setErrors((current) => ({ ...current, [slot.key]: "" }))

    try {
      const result = await api.post<ReviewResponse>(
        "/api/platform/media/select",

        {
          slot: slot.key,

          candidateId: candidate.id,

          visuallyReviewed: true,
        },
      )

      setSlots(result.slots)

      setPending((current) => {
        const next = { ...current }

        delete next[slot.key]

        return next
      })

      setConfirmed((current) => ({ ...current, [slot.key]: false }))

      window.dispatchEvent(new Event("media-config-changed"))
    } catch (error) {
      setErrors((current) => ({ ...current, [slot.key]: messageFor(error) }))
    } finally {
      setBusy((current) => ({ ...current, [slot.key]: false }))
    }
  }

  return (
    <main className="mx-auto w-full max-w-7xl px-5 py-7 sm:px-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
            Platform administration
          </p>
          <h1 className="mt-1 text-[24px] font-semibold tracking-tight text-foreground">
            Media review
          </h1>
          <p className="mt-2 max-w-3xl text-[13px] leading-5 text-muted-foreground">
            Review every locally served image and video. New candidates are
            fetched server-side and saved to the media directory only after
            approval.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => void loadReview()}
          disabled={loading}
        >
          <RefreshCw size={14} /> Refresh
        </Button>
      </div>

      <div className="mt-5 rounded-lg border border-warning-border bg-warning-subtle px-4 py-3 text-[12px] leading-5 text-warning">
        Before saving a candidate, inspect its preview and source page. Reject
        editorial-only content, identifiable people as the main subject, visible
        brands or logos, readable signage, and heavy watermarks.
      </div>

      {errors.page ? (
        <Alert variant="danger" className="mt-5">
          <AlertDescription>{errors.page}</AlertDescription>
        </Alert>
      ) : null}

      {loading ? (
        <div className="mt-8 flex items-center gap-2 text-[13px] text-muted-foreground">
          <LoaderCircle size={16} className="animate-spin" /> Loading media
          slots…
        </div>
      ) : (
        <div className="mt-6 grid gap-4 xl:grid-cols-2">
          {slots.map((slot) => {
            const candidate = pending[slot.key]

            const busySlot = Boolean(busy[slot.key])

            return (
              <section
                key={slot.key}
                className="rounded-xl border border-border bg-card p-4 shadow-card"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-[15px] font-semibold text-foreground">
                      {slot.label}
                    </h2>
                    <p className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      {slot.type === "video" ? (
                        <Video size={13} />
                      ) : (
                        <ImageIcon size={13} />
                      )}
                      {slot.type === "video" ? "Video" : "Photo"}
                      {slot.optional ? " · optional clip" : ""}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void pickAnother(slot)}
                    disabled={busySlot}
                  >
                    {busySlot ? (
                      <LoaderCircle size={13} className="animate-spin" />
                    ) : (
                      <RefreshCw size={13} />
                    )}
                    Pick another
                  </Button>
                </div>

                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <div className="min-w-0">
                    <p className="mb-2 text-[11px] font-semibold text-muted-foreground">
                      Current selection
                    </p>
                    {slot.selected && slot.previewUrl ? (
                      <>
                        <Preview
                          src={slot.previewUrl}
                          type={slot.type}
                          label={slot.label}
                          controls
                        />
                        <p className="mt-2 break-all text-[11px] text-muted-foreground">
                          {slot.selected.contributor} · {slot.selected.provider}
                        </p>
                        <a
                          href={slot.selected.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-1 inline-block text-[11px] font-medium text-primary underline"
                        >
                          View source page
                        </a>
                      </>
                    ) : (
                      <div className="flex aspect-video items-center justify-center rounded-md bg-slate-100 text-[12px] text-muted-foreground">
                        {slot.optional
                          ? "No suitable clip selected yet"
                          : "No media selected yet"}
                      </div>
                    )}
                  </div>

                  {candidate ? (
                    <div className="min-w-0">
                      <p className="mb-2 text-[11px] font-semibold text-muted-foreground">
                        Candidate for review
                      </p>
                      <Preview
                        src={candidate.previewUrl}
                        type={candidate.type}
                        label={`${slot.label} candidate`}
                        controls
                      />
                      <p className="mt-2 break-all text-[11px] text-muted-foreground">
                        {candidate.contributor} · {candidate.provider} ·{" "}
                        {candidate.width} × {candidate.height}
                        {candidate.duration ? ` · ${candidate.duration}s` : ""}
                      </p>
                      <a
                        href={candidate.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-block text-[11px] font-medium text-primary underline"
                      >
                        View source page
                      </a>
                      <p className="mt-2 text-[10.5px] leading-4 text-muted-foreground">
                        {candidate.licenseNote}
                      </p>
                      <label className="mt-3 flex cursor-pointer items-start gap-2 text-[11px] leading-4 text-foreground">
                        <Checkbox
                          checked={Boolean(confirmed[slot.key])}
                          onCheckedChange={(checked) =>
                            setConfirmed((current) => ({
                              ...current,

                              [slot.key]: checked === true,
                            }))
                          }
                        />
                        I verified the image has no prohibited people, brands,
                        signage, watermarks, or editorial-only markings.
                      </label>
                      <Button
                        type="button"
                        size="sm"
                        className="mt-3"
                        onClick={() => void useCandidate(slot)}
                        disabled={!confirmed[slot.key] || busySlot}
                      >
                        <Check size={13} /> Use this media
                      </Button>
                    </div>
                  ) : null}
                </div>

                {slot.selected ? (
                  <p className="mt-3 break-all text-[10.5px] text-muted-foreground">
                    Local file: {slot.selected.fileName} · License:{" "}
                    {slot.selected.licenseNote}
                  </p>
                ) : null}
                {errors[slot.key] ? (
                  <p role="alert" className="mt-3 text-[12px] text-danger">
                    {errors[slot.key]}
                  </p>
                ) : null}
              </section>
            )
          })}
        </div>
      )}
    </main>
  )
}

export default MediaReviewPage
