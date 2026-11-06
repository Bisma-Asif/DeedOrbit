import { useEffect, useState, type CSSProperties } from "react"
import { cn } from "@/lib/utils"
import {
  useParallax,
  usePrefersReducedMotion,
} from "@/features/marketing/hooks"

/**
 * The hero's stylized building, assembled entirely from CSS 3D faces — no model
 * file, no WebGL library. It slowly rotates, tilts a few degrees toward the
 * cursor, and carries a thin emerald orbit ring with floating status chips.
 *
 * A single `wantsStatic` decision collapses the whole thing to an inline SVG
 * illustration when motion is reduced, WebGL is unavailable, or a small
 * coarse-pointer (low-power) device is detected — which is the required fallback.
 */

interface BuildingSceneProps {
  /** Resolved labels for the orbiting cards, e.g. ["Unit Booked", …]. */
  cards: string[]
  className?: string
}

const SLATE_FRONT = "linear-gradient(180deg,#1e293b,#0f172a)"
const SLATE_SIDE = "linear-gradient(180deg,#0b1220,#0f172a)"
const STONE_FRONT = "linear-gradient(180deg,#efe9dd,#ded6c7)"
const STONE_SIDE = "linear-gradient(180deg,#d9d2c5,#c8bfad)"
const WINDOW_PATTERN =
  "repeating-linear-gradient(0deg,transparent 0 9px,rgba(16,185,129,0.22) 9px 11px)," +
  "repeating-linear-gradient(90deg,transparent 0 8px,rgba(16,185,129,0.18) 8px 10px)"

function faceStyle(
  transform: string,
  background: string,
  width: number,
  height: number,
): CSSProperties {
  return {
    position: "absolute",
    width,
    height,
    transform,
    background,
    backfaceVisibility: "visible",
    border: "1px solid rgba(148,163,184,0.10)",
  }
}

function Box({
  width,
  height,
  depth,
  front,
  side,
  top,
  windows,
  style,
}: {
  width: number
  height: number
  depth: number
  front: string
  side: string
  top: string
  windows?: boolean
  style?: CSSProperties
}) {
  const win = windows ? `${WINDOW_PATTERN},` : ""
  return (
    <div className="mk-3d" style={{ position: "absolute", ...style }}>
      <div style={faceStyle(`translateZ(${depth / 2}px)`, win + front, width, height)} />
      <div
        style={faceStyle(
          `rotateY(180deg) translateZ(${depth / 2}px)`,
          win + front,
          width,
          height,
        )}
      />
      <div
        style={faceStyle(
          `rotateY(90deg) translateZ(${width / 2}px)`,
          win + side,
          depth,
          height,
        )}
      />
      <div
        style={faceStyle(
          `rotateY(-90deg) translateZ(${width / 2}px)`,
          win + side,
          depth,
          height,
        )}
      />
      <div
        style={faceStyle(
          `rotateX(90deg) translateZ(${height / 2}px)`,
          top,
          width,
          depth,
        )}
      />
    </div>
  )
}

function StaticIllustration({ cards }: { cards: string[] }) {
  return (
    <div className="flex flex-col items-center gap-6">
      <svg
        viewBox="0 0 260 220"
        role="img"
        aria-label="DeedOrbit building illustration"
        className="h-56 w-64"
      >
        <defs>
          <linearGradient id="mk-tower" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#1e293b" />
            <stop offset="1" stopColor="#0f172a" />
          </linearGradient>
        </defs>
        <ellipse cx="130" cy="196" rx="96" ry="16" fill="#0f172a" opacity="0.12" />
        <rect x="150" y="120" width="58" height="76" rx="3" fill="#d9d2c5" />
        <rect x="96" y="52" width="70" height="144" rx="4" fill="url(#mk-tower)" />
        {Array.from({ length: 24 }).map((_, i) => (
          <rect
            key={i}
            x={104 + (i % 4) * 16}
            y={64 + Math.floor(i / 4) * 20}
            width="9"
            height="12"
            rx="1.5"
            fill="#10b981"
            opacity={i % 3 === 0 ? 0.85 : 0.4}
          />
        ))}
        <ellipse
          cx="130"
          cy="120"
          rx="118"
          ry="42"
          fill="none"
          stroke="#10b981"
          strokeWidth="1.5"
          strokeDasharray="4 7"
          opacity="0.7"
        />
      </svg>
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
  ).toFixed(2)}deg)`

  return (
    <div className={cn("mk-persp relative mx-auto aspect-square w-full max-w-[440px]", className)}>
      {/* Emerald halo behind the tower. */}
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
        <div className="mk-3d mk-anim-orbit relative" style={{ transform: "rotateX(-16deg)" }}>
          {/* Podium (stone) + tower (slate), sharing one rotating origin. */}
          <Box
            width={130}
            height={170}
            depth={90}
            front={SLATE_FRONT}
            side={SLATE_SIDE}
            top="#334155"
            windows
            style={{ left: -65, top: -170 }}
          />
          <Box
            width={92}
            height={86}
            depth={78}
            front={STONE_FRONT}
            side={STONE_SIDE}
            top="#efe9dd"
            windows
            style={{ left: -150, top: -86 }}
          />
          <Box
            width={64}
            height={110}
            depth={64}
            front={SLATE_FRONT}
            side={SLATE_SIDE}
            top="#334155"
            windows
            style={{ left: 40, top: -110 }}
          />
        </div>

        {/* Thin emerald orbit ring, counter to the tower spin. */}
        <div
          aria-hidden
          className="mk-anim-ring pointer-events-none absolute inset-0"
          style={{ transform: "rotateX(72deg)" }}
        >
          <div
            className="absolute left-1/2 top-1/2 h-[420px] w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-emerald-400/40"
            style={{ boxShadow: "0 0 24px rgba(16,185,129,0.25)" }}
          />
        </div>

        {/* Floating status chips — kept upright, gently bobbing, on the ring. */}
        {cards.map((label, index) => {
          const angle = (index / cards.length) * Math.PI * 2
          const radius = 178
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
