import { useState } from "react"

import { cn } from "@/lib/utils"

/** Local media rendering with a bundled fallback for unavailable assets. */

interface ImageSlotProps {
  src: string

  fallbackSrc?: string

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

  fallbackSrc,

  alt,

  className,

  imgClassName,

  width,

  height,

  eager = false,
}: ImageSlotProps) {
  const [failed, setFailed] = useState(false)
  const [fallbackFailed, setFallbackFailed] = useState(false)

  const useFallback = failed && Boolean(fallbackSrc) && fallbackSrc !== src

  if (fallbackFailed || (failed && !useFallback) || !src) {
    return (
      <div
        role="img"
        aria-label={alt}
        className={cn(
          "flex items-center justify-center bg-sand-deep/60 text-slate-500",

          className,
        )}
        style={{ aspectRatio: `${width} / ${height}` }}
      />
    )
  }

  return (
    <picture className={cn("block h-full w-full", className)}>
      <img
        src={useFallback ? fallbackSrc : src}
        alt={alt}
        width={width}
        height={height}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        onError={() => {
          if (useFallback) {
            setFallbackFailed(true)
          } else {
            setFailed(true)
          }
        }}
        className={cn("h-full w-full object-cover", imgClassName)}
      />
    </picture>
  )
}

interface VideoClipProps {
  src: string

  webm?: string

  poster: string

  label?: string

  className?: string
}

/** A muted local gallery clip that falls back to its locally stored poster. */

export function VideoClip({
  src,

  webm,

  poster,

  label,

  className,
}: VideoClipProps) {
  const [failed, setFailed] = useState(false)

  if (!src || failed) {
    return (
      <img
        src={poster}
        alt={label ?? ""}
        width={1280}
        height={800}
        loading="lazy"
        decoding="async"
        className={cn("h-full w-full object-cover", className)}
      />
    )
  }

  return (
    <video
      className={cn("h-full w-full object-cover", className)}
      poster={poster}
      autoPlay
      muted
      loop
      playsInline
      preload="metadata"
      onError={() => setFailed(true)}
    >
      {webm ? <source src={webm} type="video/webm" /> : null}
      <source src={src} type="video/mp4" />
    </video>
  )
}
