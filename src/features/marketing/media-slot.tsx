import { useState } from "react"

import { cn } from "@/lib/utils"

/** Local media rendering with responsive derivatives and a non-broken fallback. */

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

function responsiveSource(src: string, format: "webp" | "avif") {
  const match = /^(.*)\.(?:jpe?g|png)(\?.*)?$/i.exec(src)

  if (!match) return undefined

  const query = match[2] ?? ""

  return [800, 1600]

    .map((size) => `${match[1]}-${size}.${format}${query} ${size}w`)

    .join(", ")
}

export function ImageSlot({
  src,

  alt,

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
      />
    )
  }

  return (
    <picture className={cn("block h-full w-full", className)}>
      <source
        type="image/avif"
        srcSet={responsiveSource(src, "avif")}
        sizes="(max-width: 640px) 100vw, 800px"
      />
      <source
        type="image/webp"
        srcSet={responsiveSource(src, "webp")}
        sizes="(max-width: 640px) 100vw, 800px"
      />
      <img
        src={src}
        alt={alt}
        width={width}
        height={height}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        onError={() => setFailed(true)}
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
