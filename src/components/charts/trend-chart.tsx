/**
 * "Sales & Collections Trend" — the dashboard's wide combined chart.
 *
 * Sales draws as the accent area and line, collections as a solid slate line
 * with its own dots, and the target as a dashed lighter slate line. The three
 * series are separated by hue family, marker and dash pattern — not by the
 * opacity of one colour, which reads as a single line at a glance — so they
 * stay separable in greyscale and for colour-blind readers. One invisible hit
 * rect per bucket carries the exact figures in a native title, and the whole
 * chart exposes an aria description, so the data is reachable without a mouse.
 * Null series entries (a role can't see the money, no target was set) simply
 * don't draw.
 */

import type { DashboardTrendPoint } from "@shared/dashboard"

import { formatMoneyLakh } from "@/lib/format"

interface TrendChartProps {
  data: DashboardTrendPoint[]

  currency: string
}

const W = 720

const H = 240

const PAD_LEFT = 8

const PAD_RIGHT = 8

const PAD_TOP = 12

const PAD_BOTTOM = 26

function niceMax(value: number): number {
  if (value <= 0) return 1

  const magnitude = 10 ** Math.floor(Math.log10(value))

  const step = Math.ceil(value / magnitude)

  return step * magnitude
}

export default function TrendChart({ data, currency }: TrendChartProps) {
  if (data.length === 0) {
    return (
      <p className="text-muted-foreground py-6 text-center text-[13px]">
        No activity in this period
      </p>
    )
  }

  const values: number[] = []

  for (const point of data) {
    if (point.sales !== null) values.push(point.sales)

    if (point.collections !== null) values.push(point.collections)

    if (point.target !== null) values.push(point.target)
  }

  const hasAny = values.some((v) => v > 0)

  const max = niceMax(Math.max(...values, 1))

  const innerW = W - PAD_LEFT - PAD_RIGHT

  const innerH = H - PAD_TOP - PAD_BOTTOM

  const x = (i: number) =>
    data.length === 1
      ? PAD_LEFT + innerW / 2
      : PAD_LEFT + (i * innerW) / (data.length - 1)

  const y = (v: number) => PAD_TOP + innerH - (v / max) * innerH

  const path = (pick: (p: DashboardTrendPoint) => number | null): string => {
    const parts: string[] = []

    let started = false

    data.forEach((point, i) => {
      const v = pick(point)

      if (v === null) {
        started = false

        return
      }

      parts.push(`${started ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`)

      started = true
    })

    return parts.join(" ")
  }

  const salesLine = path((p) => p.sales)

  const salesArea =
    data.every((p) => p.sales !== null) && data.length > 1
      ? `${salesLine} L${x(data.length - 1).toFixed(1)},${(PAD_TOP + innerH).toFixed(1)} L${x(
          0,
        ).toFixed(1)},${(PAD_TOP + innerH).toFixed(1)} Z`
      : ""

  const collectionsLine = path((p) => p.collections)

  const targetLine = path((p) => p.target)

  // Label every bucket when there is room, otherwise thin to ~8 labels.

  const stride = Math.max(1, Math.ceil(data.length / 8))

  const gridYs = [0.25, 0.5, 0.75, 1].map((f) => f * max)

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-[240px] w-full"
        role="img"
        aria-label={`Sales and collections by ${data.length} periods. ${data

          .slice(0, 4)

          .map(
            (p) =>
              `${p.label}: sales ${
                p.sales === null ? "n/a" : formatMoneyLakh(p.sales, currency)
              }, collections ${
                p.collections === null
                  ? "n/a"
                  : formatMoneyLakh(p.collections, currency)
              }`,
          )

          .join("; ")}`}
      >
        {gridYs.map((v) => (
          <g key={v}>
            <line
              x1={PAD_LEFT}
              x2={W - PAD_RIGHT}
              y1={y(v)}
              y2={y(v)}
              className="stroke-border"
              strokeWidth={1}
              strokeDasharray="2 4"
            />

            <text
              x={PAD_LEFT + 2}
              y={y(v) - 3}
              className="fill-muted-foreground"
              fontSize={9}
            >
              {formatMoneyLakh(v, currency)}
            </text>
          </g>
        ))}

        <line
          x1={PAD_LEFT}
          x2={W - PAD_RIGHT}
          y1={y(0)}
          y2={y(0)}
          className="stroke-border-strong"
          strokeWidth={1}
        />

        {hasAny && salesArea !== "" ? (
          <path d={salesArea} className="fill-primary/10" />
        ) : null}

        {salesLine !== "" ? (
          <path
            d={salesLine}
            fill="none"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            className="stroke-chart-sales"
          />
        ) : null}

        {collectionsLine !== "" ? (
          <path
            d={collectionsLine}
            fill="none"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            className="stroke-chart-collections"
          />
        ) : null}

        {targetLine !== "" ? (
          <path
            d={targetLine}
            fill="none"
            strokeWidth={1.5}
            strokeDasharray="5 4"
            className="stroke-chart-target"
          />
        ) : null}

        {data.map((point, i) => (
          <g key={point.key}>
            <rect
              x={x(i) - innerW / (2 * Math.max(1, data.length - 1))}
              y={PAD_TOP}
              width={innerW / Math.max(1, data.length - 1)}
              height={innerH}
              fill="transparent"
            >
              <title>{`${point.label} — sales ${
                point.sales === null
                  ? "n/a"
                  : formatMoneyLakh(point.sales, currency)
              }, collections ${
                point.collections === null
                  ? "n/a"
                  : formatMoneyLakh(point.collections, currency)
              }${
                point.target !== null
                  ? `, target ${formatMoneyLakh(point.target, currency)}`
                  : ""
              }`}</title>
            </rect>

            {point.sales !== null && hasAny ? (
              <circle
                cx={x(i)}
                cy={y(point.sales)}
                r={2.2}
                className="fill-chart-sales"
              />
            ) : null}

            {point.collections !== null && hasAny ? (
              <circle
                cx={x(i)}
                cy={y(point.collections)}
                r={2.2}
                className="fill-chart-collections"
              />
            ) : null}

            {i % stride === 0 ? (
              <text
                x={x(i)}
                y={H - 8}
                textAnchor="middle"
                className="fill-muted-foreground"
                fontSize={10}
              >
                {point.label}
              </text>
            ) : null}
          </g>
        ))}
      </svg>

      <ul className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <li className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded bg-chart-sales" aria-hidden />{" "}
          Sales
        </li>
        <li className="flex items-center gap-1.5">
          <span
            className="h-0.5 w-4 rounded bg-chart-collections"
            aria-hidden
          />{" "}
          Collections
        </li>
        <li className="flex items-center gap-1.5">
          <span
            className="h-0 w-4 border-t border-dashed border-chart-target"
            aria-hidden
          />{" "}
          Target
        </li>
      </ul>
    </div>
  )
}
