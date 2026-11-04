/**
 * A hand-rolled area+line chart — no charting dependency.
 *
 * The dashboard's collections trend is the only series this renders, so it stays
 * deliberately narrow: a month-labelled x-axis, a y-scale from the largest value,
 * a single emerald line over a faint fill. Colours come straight from the design
 * tokens (emerald `--primary` for the series, slate neutrals for the grid and
 * labels), sized to read as business-dense rather than decorative. The SVG is
 * responsive via `viewBox`; a screen reader gets one `role="img"` summary.
 */

import type { ChartDatum } from "@shared/reports"

import { formatCurrencyCompact, formatNumber } from "@/lib/format"

interface LineChartProps {
  data: ChartDatum[]

  /** Money series format their own axis; a count series passes false. */

  currency?: string | null

  height?: number
}

const WIDTH = 640

const PAD_LEFT = 8

const PAD_RIGHT = 8

const PAD_TOP = 14

const PAD_BOTTOM = 22

function niceMax(value: number): number {
  if (value <= 0) return 1

  const magnitude = 10 ** Math.floor(Math.log10(value))

  const normalized = value / magnitude

  const step =
    normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10

  return step * magnitude
}

export function LineChart({
  data,

  currency = null,

  height = 180,
}: LineChartProps) {
  const innerW = WIDTH - PAD_LEFT - PAD_RIGHT

  const innerH = height - PAD_TOP - PAD_BOTTOM

  const max = niceMax(Math.max(0, ...data.map((point) => point.value)))

  const count = data.length

  const xAt = (index: number): number =>
    count <= 1
      ? PAD_LEFT + innerW / 2
      : PAD_LEFT + (index * innerW) / (count - 1)

  const yAt = (value: number): number =>
    PAD_TOP + innerH * (1 - (max === 0 ? 0 : value / max))

  const baseline = PAD_TOP + innerH

  const line = data

    .map(
      (point, index) =>
        `${index === 0 ? "M" : "L"}${xAt(index).toFixed(1)},${yAt(
          point.value,
        ).toFixed(1)}`,
    )

    .join(" ")

  const area =
    data.length > 0
      ? `M${xAt(0).toFixed(1)},${baseline} ` +
        data

          .map(
            (point, index) =>
              `L${xAt(index).toFixed(1)},${yAt(point.value).toFixed(1)}`,
          )

          .join(" ") +
        ` L${xAt(count - 1).toFixed(1)},${baseline} Z`
      : ""

  const axisLabel = (value: number): string =>
    currency ? formatCurrencyCompact(value, currency) : formatNumber(value)

  const total = data.reduce((sum, point) => sum + point.value, 0)

  const label =
    count === 0
      ? "No data"
      : `${axisLabel(total)} across ${count} periods, peaking at ${axisLabel(
          Math.max(0, ...data.map((point) => point.value)),
        )}`

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${height}`}
      className="h-auto w-full"
      role="img"
      aria-label={label}
      preserveAspectRatio="none"
    >
      <title>{label}</title>

      <line
        x1={PAD_LEFT}
        y1={baseline}
        x2={WIDTH - PAD_RIGHT}
        y2={baseline}
        className="stroke-border"
        strokeWidth={1}
      />

      <line
        x1={PAD_LEFT}
        y1={PAD_TOP}
        x2={WIDTH - PAD_RIGHT}
        y2={PAD_TOP}
        className="stroke-border"
        strokeWidth={1}
        strokeDasharray="3 4"
      />

      {area && <path d={area} className="fill-primary/10" />}

      {line && (
        <path
          d={line}
          fill="none"
          className="stroke-primary"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      )}

      {data.map((point, index) => (
        <circle
          key={point.label}
          cx={xAt(index)}
          cy={yAt(point.value)}
          r={2}
          className="fill-primary"
        />
      ))}

      <text
        x={PAD_LEFT}
        y={PAD_TOP - 4}
        className="fill-muted-foreground"
        fontSize={11}
      >
        {axisLabel(max)}
      </text>

      {data.map((point, index) => {
        // Thin the month labels so a twelve-point axis never overlaps.

        const show = count <= 6 || index % 2 === 0 || index === count - 1

        if (!show) return null

        return (
          <text
            key={`label-${point.label}`}
            x={xAt(index)}
            y={height - 6}
            textAnchor="middle"
            className="fill-muted-foreground"
            fontSize={11}
          >
            {point.label}
          </text>
        )
      })}
    </svg>
  )
}
