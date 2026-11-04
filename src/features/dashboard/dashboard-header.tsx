import { Building2, CalendarDays, RotateCw } from "lucide-react"

import { Button } from "@/components/ui/button"

import { Input } from "@/components/ui/input"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

import type { DashboardOverviewMeta, DashboardRange } from "@shared/dashboard"

import { formatDateTime } from "@/lib/format"

import { cn } from "@/lib/utils"

import type { Tenant } from "@/lib/workspace"

const RANGE_LABELS: Record<DashboardRange, string> = {
  today: "Today",

  week: "This Week",

  month: "This Month",

  quarter: "This Quarter",

  year: "This Year",

  custom: "Custom",
}

const RANGE_ORDER: DashboardRange[] = [
  "today",

  "week",

  "month",

  "quarter",

  "year",

  "custom",
]

/** Time-of-day greeting, from the browser's local clock. */

function greeting(date: Date): string {
  const hour = date.getHours()

  if (hour < 12) return "Good morning"

  if (hour < 17) return "Good afternoon"

  return "Good evening"
}

export function DashboardHeader({
  tenant,

  firstName,

  meta,

  range,

  customFrom,

  customTo,

  projectId,

  onRangeChange,

  onCustomFromChange,

  onCustomToChange,

  onProjectChange,

  onRefresh,

  refreshing,
}: {
  tenant: Tenant

  firstName: string

  meta: DashboardOverviewMeta | null

  range: DashboardRange

  customFrom: string

  customTo: string

  projectId: string | null

  onRangeChange: (range: DashboardRange) => void

  onCustomFromChange: (value: string) => void

  onCustomToChange: (value: string) => void

  onProjectChange: (value: string | null) => void

  onRefresh: () => void

  refreshing: boolean
}) {
  const now = new Date()

  // The primitives carry a soft 15%-alpha ring, which is nearly invisible on the
  // off-white content background. The dashboard controls sit at the top of the
  // page and are the keyboard route to every widget below, so they use the same
  // solid ring with offset that the clickable KPI tiles already show.
  const filterRing =
    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"

  return (
    <header className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className="flex size-9 shrink-0 items-center justify-center rounded-md border border-nav-border bg-nav-hover text-[12.5px] font-semibold tracking-wide text-nav-foreground"
            aria-hidden
          >
            {tenant.initials}
          </span>

          <div className="min-w-0">
            <h1 className="truncate text-[19px] leading-7 font-semibold tracking-tight text-foreground">
              {greeting(now)}, {firstName}
            </h1>

            <p className="flex items-center gap-1.5 truncate text-[12.5px] text-muted-foreground">
              <Building2 size={12} aria-hidden />
              <span className="truncate">{tenant.name}</span>

              {meta && (
                <>
                  <span aria-hidden="true">·</span>

                  <span className="truncate">
                    {RANGE_LABELS[meta.range]} · {formatDate(meta.from)} –{" "}
                    {formatDate(meta.to)}
                  </span>
                </>
              )}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={range}
            onValueChange={(value) => onRangeChange(value as DashboardRange)}
          >
            <SelectTrigger
              size="sm"
              className={cn("w-[9.5rem]", filterRing)}
              aria-label="Date range"
            >
              <CalendarDays size={13} className="text-muted-foreground" />

              <SelectValue />
            </SelectTrigger>

            <SelectContent align="end">
              {RANGE_ORDER.map((option) => (
                <SelectItem key={option} value={option}>
                  {RANGE_LABELS[option]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {range === "custom" && (
            <>
              <Input
                type="date"
                value={customFrom}
                max={customTo || undefined}
                onChange={(event) => onCustomFromChange(event.target.value)}
                className={cn("w-[9.5rem]", filterRing)}
                aria-label="Custom range start"
              />

              <Input
                type="date"
                value={customTo}
                min={customFrom || undefined}
                onChange={(event) => onCustomToChange(event.target.value)}
                className={cn("w-[9.5rem]", filterRing)}
                aria-label="Custom range end"
              />
            </>
          )}

          <Select
            value={projectId ?? "__all"}
            onValueChange={(value) =>
              onProjectChange(value === "__all" ? null : value)
            }
          >
            <SelectTrigger
              size="sm"
              className={cn("w-[11rem]", filterRing)}
              aria-label="Project"
            >
              <SelectValue />
            </SelectTrigger>

            <SelectContent align="end">
              <SelectItem value="__all">All Projects</SelectItem>

              {(meta?.projectOptions ?? []).map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="flex items-center gap-1.5">
            {meta && (
              <span
                className="text-[11px] text-muted-foreground whitespace-nowrap"
                title={formatDateTime(meta.generatedAt)}
              >
                Last updated {formatTime(meta.generatedAt)}
              </span>
            )}

            <Button
              variant="outline"
              size="sm"
              onClick={onRefresh}
              disabled={refreshing}
              aria-label="Refresh dashboard data"
            >
              <RotateCw
                size={13}
                className={cn(refreshing && "animate-spin")}
              />
              Refresh
            </Button>
          </div>
        </div>
      </div>
    </header>
  )
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",

    month: "short",

    year: "numeric",
  }).format(new Date(value))
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",

    minute: "2-digit",

    hour12: false,
  }).format(new Date(value))
}
