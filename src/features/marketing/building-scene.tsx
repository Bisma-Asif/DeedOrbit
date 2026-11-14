import { useEffect, useState } from "react"

import { cn } from "@/lib/utils"

import {
  useParallax,
  usePrefersReducedMotion,
} from "@/features/marketing/hooks"

interface BuildingSceneProps {
  cards: string[]

  className?: string
}

const BUILDING_IMAGE = "/media/hero-building-cutout.png"

function BuildingCutout({ animated = false }: { animated?: boolean }) {
  return (
    <div
      className={cn(
        "mk-building-model mk-3d",
        animated ? "mk-building-spin" : "mk-building-static",
      )}
      role="img"
      aria-label="3D rendered modern building"
    >
      <img
        src={BUILDING_IMAGE}
        alt="Modern multi-storey building"
        className="mk-building-image mk-building-front"
      />
    </div>
  )
}

function StaticIllustration({ cards }: { cards: string[] }) {
  return (
    <div className="mx-auto flex max-w-[440px] flex-col items-center gap-6">
      <div className="mk-persp relative h-[400px] w-full">
        <div className="absolute inset-0 flex items-center justify-center">
          <BuildingCutout />
        </div>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {cards.map((label) => (
          <span
            key={label}
            className="rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[12px] font-medium text-white backdrop-blur-sm"
          >
            {label}
          </span>
        ))}
      </div>
    </div>
  )
}

export function BuildingScene({ cards, className }: BuildingSceneProps) {
  const reduced = usePrefersReducedMotion()

  const [staticMode, setStaticMode] = useState(true)

  const parallax = useParallax(!staticMode)

  // Decide once on mount whether the animated scene is appropriate.

  useEffect(() => {
    if (reduced) {
      setStaticMode(true)

      return
    }

    let webgl = false

    try {
      const canvas = document.createElement("canvas")

      webgl = !!(
        window.WebGLRenderingContext &&
        (canvas.getContext("webgl") || canvas.getContext("experimental-webgl"))
      )
    } catch {
      webgl = false
    }

    const coarse =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(pointer: coarse)").matches

    const small = window.innerWidth < 640

    // CSS 3D does not require WebGL, but a device without it (or a small

    // touch phone) is exactly the "low power" signal to keep static.

    setStaticMode(!webgl || (coarse && small))
  }, [reduced])

  if (staticMode) {
    return (
      <div className={cn("mk-persp", className)}>
        <StaticIllustration cards={cards} />
      </div>
    )
  }

  const tilt = `rotateX(${(-parallax.y * 8).toFixed(2)}deg) rotateY(${(
    parallax.x * 10
  )

    .toFixed(2)}deg)`

  return (
    <div
      className={cn(
        "mk-persp relative mx-auto aspect-square w-full max-w-[440px]",
        className,
      )}
    >
      {/* Emerald halo behind the house. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-[18%] rounded-full blur-3xl"
        style={{
          background:
            "radial-gradient(circle at 50% 45%, rgba(16,185,129,0.28), transparent 70%)",
        }}
      />
      <div
        className="absolute inset-0 flex items-center justify-center transition-transform duration-300 ease-out"
        style={{ transform: tilt }}
      >
        <div className="mk-building-stage mk-3d absolute inset-0 flex items-center justify-center">
          <div className="mk-building-anchor mk-3d">
            <BuildingCutout animated />
          </div>
        </div>

        {/* Thin emerald orbit ring, counter to the tower spin. */}
        <div
          aria-hidden
          className="mk-anim-ring pointer-events-none absolute inset-0"
          style={{ transform: "rotateX(72deg)" }}
        >
          <div
            className="absolute left-1/2 top-1/2 h-[460px] w-[460px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-emerald-400/40"
            style={{ boxShadow: "0 0 24px rgba(16,185,129,0.25)" }}
          />
        </div>

        {/* Floating status chips — kept upright, gently bobbing, on the ring. */}
        {cards.map((label, index) => {
          const angle = (index / cards.length) * Math.PI * 2

          const radius = 210

          const x = Math.cos(angle) * radius

          const y = Math.sin(angle) * radius * 0.5

          return (
            <div
              key={label}
              className="mk-anim-bob absolute left-1/2 top-1/2"
              style={{
                transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`,

                animationDelay: `${index * 0.5}s`,
              }}
            >
              <div className="flex items-center gap-2 rounded-xl border border-white/15 bg-slate-900/70 px-3 py-1.5 text-[12px] font-medium text-white shadow-lg backdrop-blur-sm">
                <span className="size-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)]" />
                {label}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
