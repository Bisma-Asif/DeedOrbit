import { useState } from "react"
import { ImageOff } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * A single media slot used across the landing page. It renders the real image
 * from `src` when the owner has uploaded it; if the file is missing (the default
 * until upload) it falls back to a neutral, clearly-labelled placeholder so the
 * layout never shows a broken image. No hotlinked stock art — just a labelled box.
 */

interface ImageSlotProps {
  src: string
  alt: string
  label?: string
  className?: string
  imgClassName?: string
  width: number
  height: number
  eager?: boolean
}

export function ImageSlot({
  src,
  alt,
  label,
  className,
  imgClassName,
  width,
  height,
  eager = false,
}: ImageSlotProps) {
  const [failed, setFailed] = useState(false)

  if (failed || !src) {
    return (
      <div
        role="img"
        aria-label={alt}
        className={cn(
          "flex items-center justify-center bg-sand-deep/60 text-slate-500",
          className,
        )}
        style={{ aspectRatio: `${width} / ${height}` }}
      >
        <div className="flex flex-col items-center gap-1.5 px-4 text-center">
          <ImageOff size={22} strokeWidth={1.5} />
          <span className="text-[12px] font-medium">
            {label ?? "Image placeholder"}
          </span>
        </div>
      </div>
    )
  }

  return (
    <img
      src={src}
      alt={alt}
      width={width}
      height={height}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      onError={() => setFailed(true)}
      className={cn("h-full w-full object-cover", imgClassName, className)}
    />
  )
}

interface VideoClipProps {
  src: string
  poster: string
  label?: string
  className?: string
}

/**
 * A short gallery clip. Renders a looping muted video when a clip path is set and
 * loads; otherwise a placeholder note so a missing clip never breaks the tile.
 */
export function VideoClip({ src, poster, label, className }: VideoClipProps) {
  const [failed, setFailed] = useState(false)
  if (!src || failed) {
    return (
      <div
        className={cn(
          "flex items-center justify-center bg-slate-800 text-[12px] text-slate-300",
          className,
        )}
      >
        {label ?? "Video placeholder"}
      </div>
    )
  }
  return (
    <video
      className={cn("h-full w-full object-cover", className)}
      src={src}
      poster={poster}
      autoPlay
      muted
      loop
      playsInline
      onError={() => setFailed(true)}
    />
  )
}
