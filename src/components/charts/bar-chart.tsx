/**
 * A hand-rolled horizontal bar chart — no charting dependency.
 *
 * Used for "sales by project", where ranking by value reads better across a
 * horizontal axis than a tilted column set. Bars are sorted descending, each row
 * carries its own label and value, and the only non-neutral hue is emerald. The
 * SVG scales through `viewBox`; text stays a fixed 11–12px in the drawing
 * coordinate system so labels never balloon on a wide card.
 */

import type { ChartDatum } from "@shared/reports"

import { formatCurrencyCompact, formatNumber } from "@/lib/format"

interface BarChartProps {
  data: ChartDatum[]

  currency?: string | null

  /** Height allotted to each bar row, in drawing units. */

  rowHeight?: number
}

const WIDTH = 640

const LABEL_WIDTH = 128

const VALUE_WIDTH = 84

const PAD_TOP = 6

export function BarChart({
  data,

  currency = null,

  rowHeight = 30,
}: BarChartProps) {
  const sorted = [...data].sort((a, b) => b.value - a.value)

  const height = PAD_TOP * 2 + Math.max(1, sorted.length) * rowHeight

  const trackX = LABEL_WIDTH

  const trackW = WIDTH - LABEL_WIDTH - VALUE_WIDTH

  const max = Math.max(0, ...sorted.map((point) => point.value))

  const valueLabel = (value: number): string =>
    currency ? formatCurrencyCompact(value, currency) : formatNumber(value)

  const total = sorted.reduce((sum, point) => sum + point.value, 0)

  if (sorted.length === 0) {
    return (
      <p className="text-muted-foreground py-6 text-center text-[13px]">
        No data for this period
      </p>
    )
  }

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${height}`}
      className="h-auto w-full"
      role="img"
      aria-label={`${valueLabel(total)} across ${sorted.length} projects, led by ${
        sorted[0]?.label ?? "—"
      }`}
    >
      <title>{`${valueLabel(total)} across ${sorted.length} projects`}</title>

      {sorted.map((point, index) => {
        const y = PAD_TOP + index * rowHeight

        const barMid = y + rowHeight / 2

        const width = max === 0 ? 0 : (point.value / max) * trackW

        return (
          <g key={point.label}>
            <text
              x={0}
              y={barMid}
              dominantBaseline="middle"
              className="fill-foreground"
              fontSize={12}
            >
              {point.label.length > 20
                ? `${point.label.slice(0, 19)}…`
                : point.label}
            </text>

            <rect
              x={trackX}
              y={y + 6}
              width={trackW}
              height={rowHeight - 14}
              rx={2}
              className="fill-muted"
            />

            <rect
              x={trackX}
              y={y + 6}
              width={Math.max(2, width)}
              height={rowHeight - 14}
              rx={2}
              className="fill-primary"
            />

            <text
              x={WIDTH}
              y={barMid}
              textAnchor="end"
              dominantBaseline="middle"
              className="fill-muted-foreground tabular-nums"
              fontSize={12}
            >
              {valueLabel(point.value)}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
