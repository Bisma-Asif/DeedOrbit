/**
 * A 96x28 sparkline — the tiny tail under a KPI figure.
 *
 * Hand-rolled SVG like the other charts: a soft emerald area under one
 * emerald line, with a dot on the latest point. Deliberately no axes, no
 * tooltips, and no second colour — it shows shape, not precision, and the
 * exact number already sits in the card headline. An empty series renders
 * nothing, so a metric with no history never draws a fake flat line.
 */

import { cn } from "@/lib/utils"

interface SparklineProps {
  points: number[]

  /** Tail tone follows meaning: emerald default, red only for overdue. */

  tone?: "primary" | "danger"

  className?: string
}

const W = 96

const H = 28

const PAD = 2

export default function Sparkline({
  points,
  tone = "primary",
  className,
}: SparklineProps) {
  if (points.length < 2) return null

  const max = Math.max(...points)

  const min = Math.min(...points)

  const span = max - min

  const x = (i: number) => PAD + (i * (W - 2 * PAD)) / (points.length - 1)

  // A flat series sits mid-box rather than on the floor, where it would read

  // as "everything is zero" even when the level is high.

  const y = (v: number) =>
    span === 0 ? H / 2 : H - PAD - ((v - min) / span) * (H - 2 * PAD)

  const line = points
    .map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`)
    .join(" ")

  const area = `${PAD},${H - PAD} ${line} ${(W - PAD).toFixed(1)},${H - PAD}`

  const stroke = tone === "danger" ? "stroke-danger" : "stroke-primary"

  const fill = tone === "danger" ? "fill-danger/10" : "fill-primary/10"

  const last = points.length - 1

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={cn("h-7 w-24", className)}
      aria-hidden="true"
    >
      <polygon points={area} className={fill} />

      <polyline
        points={line}
        fill="none"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        className={stroke}
      />

      <circle
        cx={x(last)}
        cy={y(points[last] ?? 0)}
        r={1.8}
        className={stroke}
      />
    </svg>
  )
}
