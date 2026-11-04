import type { LucideIcon } from "lucide-react"

import {
  AlarmClock,
  HandCoins,
  PackageOpen,
  Receipt,
  Users,
  UserPlus,
} from "lucide-react"

import { Card } from "@/components/ui/card"

import { Skeleton } from "@/components/ui/skeleton"

import { StatCard } from "@/components/stat-card"

import { EmptyState } from "@/components/empty-state"

import { MoneyText } from "./money-text"

import Sparkline from "@/components/charts/sparkline"

import { navigate } from "@/lib/router"

import type {
  DashboardKpi,
  DashboardKpiKey,
  DashboardKpis,
} from "@shared/dashboard"

import { formatMoneyFull, formatNumber, formatPercent } from "@/lib/format"

import { cn } from "@/lib/utils"

import type { DashboardWidgetState } from "./use-dashboard"

/** The window label used by the trend badge, e.g. "vs last week". */

const COMPARE_LABELS: Record<string, string> = {
  today: "vs yesterday",

  week: "vs last week",

  month: "vs last month",

  quarter: "vs last quarter",

  year: "vs last year",

  custom: "vs previous window",
}

/**
 * A rise is only good when the metric is one you want more of. Receivables,
 * overdue and expenses invert: growth there is a warning, so the badge carries
 * the amber/red meaning rather than a reflexive green arrow.
 */

function trendOf(
  kpi: DashboardKpi,

  higherIsBetter: boolean,

  compareLabel: string,
): StatCardPropsTrend {
  if (kpi.deltaPct === null) {
    return {
      direction: "flat",

      tone: "neutral",

      label: "No previous-period data",
    }
  }

  const delta = kpi.deltaPct

  const up = delta > 0

  const flat = delta === 0

  const good = flat || (up ? higherIsBetter : !higherIsBetter)

  return {
    direction: flat ? "flat" : up ? "up" : "down",

    tone: flat ? "neutral" : good ? "positive" : "negative",

    label: `${delta > 0 ? "+" : ""}${delta}% ${compareLabel}`,
  }
}

type StatCardPropsTrend = {
  direction: "up" | "down" | "flat"

  tone: "positive" | "pending" | "negative" | "neutral"

  label: string
}

/**
 * The card face stays compact (lakh/crore) and carries the exact figure in a
 * native title, so hovering or long-pressing a tile gives the whole number.
 */

function moneyValue(value: number | null, currency: string): React.ReactNode {
  if (value === null) return undefined

  return <MoneyText value={value} currency={currency} />
}

function moneyHint(
  value: number | null,
  currency: string,
  compareLabel: string,
): string {
  if (value === null) return `No ${compareLabel.replace("vs ", "")} figure`

  return `${formatMoneyFull(value, currency)} ${compareLabel}`
}

interface TileSpec {
  label: string

  icon: LucideIcon

  value?: React.ReactNode

  hint?: React.ReactNode

  trend?: StatCardPropsTrend

  sparkline?: number[]

  /** Danger tail tone and red figure — reserved for overdue money only. */

  danger?: boolean

  to: string

  linkLabel: string
}

function tileFor(
  key: DashboardKpiKey,

  kpis: DashboardKpis,

  currency: string,

  compareLabel: string,
): TileSpec {
  const money = (value: number | null) => moneyValue(value, currency)

  switch (key) {
    case "sales": {
      const kpi = kpis.sales

      return {
        label: "Total Sales Value",

        icon: Receipt,

        value: money(kpi.value),

        hint: moneyHint(kpi.previous, currency, compareLabel),

        trend: trendOf(kpi, true, compareLabel),

        sparkline: kpi.sparkline,

        to: "/bookings",

        linkLabel: "Open bookings",
      }
    }

    case "collections": {
      const kpi = kpis.collections

      return {
        label: "Collections Received",

        icon: HandCoins,

        value: money(kpi.value),

        hint: moneyHint(kpi.previous, currency, compareLabel),

        trend: trendOf(kpi, true, compareLabel),

        sparkline: kpi.sparkline,

        to: "/payments?tab=payments",

        linkLabel: "Open receipts",
      }
    }

    case "receivables": {
      const kpi = kpis.receivables

      return {
        label: "Total Receivables",

        icon: PackageOpen,

        value: money(kpi.value),

        hint: "Outstanding installment balance on confirmed bookings",

        trend: trendOf(kpi, false, compareLabel),

        sparkline: kpi.sparkline,

        to: "/payments?tab=collections",

        linkLabel: "Open the recovery dashboard",
      }
    }

    case "overdue": {
      const kpi = kpis.overdue

      return {
        label: "Overdue Amount",

        icon: AlarmClock,

        value: money(kpi.value),

        hint: "Past-due balance awaiting recovery action",

        trend: trendOf(kpi, false, compareLabel),

        sparkline: kpi.sparkline,

        danger: true,

        to: "/payments?tab=collections",

        linkLabel: "Open the recovery dashboard",
      }
    }

    case "unitsSold": {
      const kpi = kpis.unitsSold

      const sold = kpi.sold

      const total = kpi.total

      return {
        label: "Units Sold",

        icon: UserPlus,

        value:
          sold === null || total === null
            ? undefined
            : `${formatNumber(sold)} / ${formatNumber(total)}`,

        hint:
          kpi.soldPct === null
            ? "No inventory published"
            : `${formatPercent(kpi.soldPct)} of the portfolio sold`,

        trend:
          kpi.soldThisPeriod === null || kpi.soldPrevious === null
            ? undefined
            : soldTrend(kpi.soldThisPeriod, kpi.soldPrevious, compareLabel),

        sparkline: kpi.sparkline,

        to: "/inventory",

        linkLabel: "Open inventory",
      }
    }

    case "inventory": {
      const kpi = kpis.inventory

      return {
        label: "Available Inventory",

        icon: PackageOpen,

        value: kpi.value === null ? undefined : formatNumber(kpi.value),

        hint: "Units ready to sell right now",

        trend: trendOf(kpi, true, compareLabel),

        sparkline: kpi.sparkline,

        to: "/inventory",

        linkLabel: "Open inventory",
      }
    }

    case "customers": {
      const kpi = kpis.customers

      return {
        label: "Total Customers",

        icon: Users,

        value: kpi.total === null ? undefined : formatNumber(kpi.total),

        hint:
          kpi.newThisPeriod === null
            ? "No customer records yet"
            : `${formatNumber(kpi.newThisPeriod)} new ${compareLabel.replace("vs last ", "in the last ")}`,

        trend:
          kpi.newThisPeriod === null || kpi.newPrevious === null
            ? undefined
            : soldTrend(kpi.newThisPeriod, kpi.newPrevious, compareLabel),

        sparkline: kpi.sparkline,

        to: "/customers",

        linkLabel: "Open customers",
      }
    }

    case "leads": {
      const kpi = kpis.leads

      return {
        label: "Active Leads",

        icon: UserPlus,

        value: kpi.active === null ? undefined : formatNumber(kpi.active),

        // The ratio is won / (won + lost), so a bare "converted" reads as if
        // every lead had been closed out. Name the denominator instead.
        hint:
          kpi.conversionPct === null
            ? `${
                kpi.newThisPeriod === null ? 0 : formatNumber(kpi.newThisPeriod)
              } new this period`
            : `${
                kpi.newThisPeriod === null ? 0 : formatNumber(kpi.newThisPeriod)
              } new · ${formatPercent(kpi.conversionPct)} of decided leads won`,

        trend:
          kpi.newThisPeriod === null || kpi.newPrevious === null
            ? undefined
            : soldTrend(kpi.newThisPeriod, kpi.newPrevious, compareLabel),

        sparkline: kpi.sparkline,

        to: "/leads",

        linkLabel: "Open leads",
      }
    }

    case "expenses": {
      const kpi = kpis.expenses

      return {
        label: "Expenses",

        icon: Receipt,

        value: money(kpi.value),

        hint: moneyHint(kpi.previous, currency, compareLabel),

        trend: trendOf(kpi, false, compareLabel),

        sparkline: kpi.sparkline,

        to: "/expenses",

        linkLabel: "Open expenses",
      }
    }
  }
}

/** Count metrics have no percent helper on the payload, so the badge is built here. */

function soldTrend(
  current: number,

  previous: number,

  compareLabel: string,
): StatCardPropsTrend {
  if (previous === 0) {
    return {
      direction: current > 0 ? "up" : "flat",

      tone: current > 0 ? "positive" : "neutral",

      label: current > 0 ? "New this period" : "No change",
    }
  }

  const pct = Math.round(((current - previous) / previous) * 1000) / 10

  return {
    direction: pct > 0 ? "up" : pct < 0 ? "down" : "flat",

    tone: pct > 0 ? "positive" : pct < 0 ? "negative" : "neutral",

    label: `${pct > 0 ? "+" : ""}${pct}% ${compareLabel}`,
  }
}

function Tile({
  spec,

  loading,
}: {
  spec: TileSpec

  loading: boolean
}) {
  const card = (
    <StatCard
      label={spec.label}
      icon={spec.icon}
      loading={loading}
      value={
        spec.danger && spec.value !== undefined ? (
          <span className="text-danger">{spec.value}</span>
        ) : (
          spec.value
        )
      }
      hint={spec.hint}
      trend={spec.trend}
      footer={
        spec.sparkline && spec.sparkline.length > 1 ? (
          <Sparkline
            points={spec.sparkline}
            tone={spec.danger ? "danger" : "primary"}
            className="w-full"
          />
        ) : undefined
      }
    />
  )

  return (
    <a
      href={`#${spec.to}`}
      aria-label={`${spec.linkLabel} (${spec.label})`}
      className="group rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      {card}
    </a>
  )
}

export function KpiRow({
  state,

  kpiKeys,

  currency,

  range,

  hasData,

  /** False for a workspace that holds no business rows yet. */
}: {
  state: DashboardWidgetState

  kpiKeys: DashboardKpiKey[]

  currency: string

  range: string

  hasData: boolean
}) {
  const compareLabel = COMPARE_LABELS[range] ?? "vs previous window"

  if (state.loading || state.envelope === undefined) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {kpiKeys.map((key) => (
          <Card key={key} className="px-3.5 py-3">
            <Skeleton className="h-3 w-24" />

            <Skeleton className="mt-3 h-7 w-28" />

            <Skeleton className="mt-2 h-3 w-32" />

            <Skeleton className="mt-4 h-6 w-full" />
          </Card>
        ))}
      </div>
    )
  }

  if (!state.envelope.ok) {
    return (
      <Card className={cn("flex flex-col items-center gap-2 px-4 py-6")}>
        <p className="text-[12.5px] text-muted-foreground">
          {state.envelope.error}
        </p>
        <button
          type="button"
          onClick={state.retry}
          className="text-[12.5px] font-medium text-primary underline-offset-4 hover:underline"
        >
          Retry the KPI row
        </button>
      </Card>
    )
  }

  if (!hasData) {
    return (
      <Card className="px-4 py-2">
        <EmptyState
          icon={Receipt}
          size="sm"
          title="No figures yet"
          description="Sales, collections and inventory are counted from your own bookings, units and receipts. They appear here as soon as the workspace has activity in the selected window."
          action={
            <button
              type="button"
              onClick={() => navigate("/projects")}
              className="text-[12.5px] font-medium text-primary underline-offset-4 hover:underline"
            >
              Create your first project
            </button>
          }
        />
      </Card>
    )
  }

  const kpis = state.envelope.data as DashboardKpis

  const tiles = kpiKeys

    .map((key) => tileFor(key, kpis, currency, compareLabel))

    .filter((tile): tile is TileSpec => tile !== undefined)

  if (tiles.length === 0) return null

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {tiles.map((spec) => (
        <Tile key={spec.label} spec={spec} loading={false} />
      ))}
    </div>
  )
}
