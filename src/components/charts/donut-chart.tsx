/**
 * A hand-rolled donut ring — no charting dependency.
 *
 * The dashboard's "sold vs available" split, drawn as a stroked arc per segment
 * around one circle. Only three hue families are permitted here: the accent for
 * units that are gone, amber for units committed or held, and slate for the rest.
 * Each status gets its own shade rather than an opacity of its neighbour, because
 * two arcs of one colour at different strengths read as one segment. The centre
 * carries the total. Each segment is stroked rather than filled so the ring stays
 * crisp at any card width, and the legend below pairs the colour with the plain
 * label and count, so status never depends on colour alone.
 */

import type { ChartDatum } from "@shared/reports"

import { formatNumber } from "@/lib/format"

interface DonutChartProps {
  data: ChartDatum[]
}

const SIZE = 160

const STROKE = 22

const RADIUS = (SIZE - STROKE) / 2

const CIRCUMFERENCE = 2 * Math.PI * RADIUS

// Segment order maps to the design-system meaning, not the data order.

const SEGMENT_CLASSES: Record<string, string> = {
  Sold: "fill-chart-sold stroke-chart-sold",

  Available: "stroke-chart-available",

  Booked: "stroke-chart-booked",

  Reserved: "stroke-chart-reserved",

  Blocked: "stroke-chart-blocked",

  Other: "stroke-chart-other",
}

const SWATCH_CLASSES: Record<string, string> = {
  Sold: "bg-chart-sold",

  Available: "bg-chart-available",

  Booked: "bg-chart-booked",

  Reserved: "bg-chart-reserved",

  Blocked: "bg-chart-blocked",

  Other: "bg-chart-other",
}

export function DonutChart({ data }: DonutChartProps) {
  const segments = data.filter((point) => point.value > 0)

  const total = data.reduce((sum, point) => sum + point.value, 0)

  if (total === 0) {
    return (
      <p className="text-muted-foreground py-6 text-center text-[13px]">
        No inventory recorded
      </p>
    )
  }

  let offset = 0

  const arcs = segments.map((point) => {
    const fraction = point.value / total

    const length = fraction * CIRCUMFERENCE

    const arc = { point, length, offset }

    offset += length

    return arc
  })

  return (
    <div className="flex items-center gap-5">
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="h-[128px] w-[128px] shrink-0"
        role="img"
        aria-label={`${formatNumber(total)} units: ${segments

          .map((point) => `${point.label} ${formatNumber(point.value)}`)

          .join(", ")}`}
      >
        <title>{`${formatNumber(total)} units`}</title>

        <g transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}>
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            className="stroke-muted"
            strokeWidth={STROKE}
          />

          {arcs.map(({ point, length, offset }) => (
            <circle
              key={point.label}
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              fill="none"
              strokeWidth={STROKE}
              strokeDasharray={`${length.toFixed(2)} ${(CIRCUMFERENCE - length)

                .toFixed(2)}`}
              strokeDashoffset={(-offset).toFixed(2)}
              className={SEGMENT_CLASSES[point.label] ?? "stroke-chart-other"}
            />
          ))}
        </g>

        <text
          x={SIZE / 2}
          y={SIZE / 2 - 4}
          textAnchor="middle"
          dominantBaseline="middle"
          className="fill-foreground tabular-nums"
          fontSize={22}
          fontWeight={600}
        >
          {formatNumber(total)}
        </text>

        <text
          x={SIZE / 2}
          y={SIZE / 2 + 14}
          textAnchor="middle"
          dominantBaseline="middle"
          className="fill-muted-foreground"
          fontSize={11}
        >
          units
        </text>
      </svg>

      <ul className="flex flex-col gap-1.5">
        {data.map((point) => (
          <li key={point.label} className="flex items-center gap-2 text-[13px]">
            <span
              className={`h-2.5 w-2.5 rounded-sm ${
                SWATCH_CLASSES[point.label] ?? "bg-chart-other"
              }`}
              aria-hidden
            />

            <span className="text-muted-foreground">{point.label}</span>

            <span className="text-foreground ml-auto tabular-nums font-medium">
              {formatNumber(point.value)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
