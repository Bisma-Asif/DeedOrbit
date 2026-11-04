import type { LucideIcon } from "lucide-react"
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react"
import { cn } from "@/lib/utils"
import { Card } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

type TrendTone = "positive" | "pending" | "negative" | "neutral"

const trendTone: Record<TrendTone, string> = {
  positive: "text-success",
  pending: "text-warning",
  negative: "text-danger",
  neutral: "text-muted-foreground",
}

const trendIcon: Record<"up" | "down" | "flat", LucideIcon> = {
  up: ArrowUpRight,
  down: ArrowDownRight,
  flat: Minus,
}

export type StatCardProps = {
  label: string
  /**
   * Pass `undefined` to render the pre-data placeholder. KPI tiles must never
   * fabricate a number, so an absent value shows a dash rather than 0.
   */
  value?: React.ReactNode
  /** Secondary line under the value, e.g. "vs previous quarter". */
  hint?: React.ReactNode
  trend?: {
    direction: "up" | "down" | "flat"
    tone: TrendTone
    label: string
  }
  icon?: LucideIcon
  footer?: React.ReactNode
  loading?: boolean
  className?: string
}

export function StatCard({
  label,
  value,
  hint,
  trend,
  icon: Icon,
  footer,
  loading = false,
  className,
}: StatCardProps) {
  const TrendIcon = trend ? trendIcon[trend.direction] : null
  const hasValue = value !== undefined && value !== null && value !== ""

  return (
    <Card className={cn("px-3.5 py-3", className)}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[10.5px] font-semibold tracking-[0.07em] text-muted-foreground uppercase">
          {label}
        </p>
        {Icon && (
          <Icon size={14} className="shrink-0 text-muted-foreground/70" />
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        {loading ? (
          <Skeleton className="h-7 w-24" />
        ) : (
          <span
            className={cn(
              "text-[22px] leading-7 font-semibold tracking-tight tabular-nums",
              hasValue ? "text-foreground" : "text-muted-foreground/45",
            )}
          >
            {hasValue ? value : "—"}
          </span>
        )}
        {trend && TrendIcon && (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 text-[11.5px] font-medium tabular-nums",
              trendTone[trend.tone],
            )}
          >
            <TrendIcon size={12} />
            {trend.label}
          </span>
        )}
      </div>

      <p className="mt-1 min-h-4 text-[11.5px] leading-4 text-muted-foreground">
        {hint ?? (hasValue ? <>&nbsp;</> : "No data for this period")}
      </p>

      {footer && (
        <div className="mt-2.5 border-t border-border pt-2">{footer}</div>
      )}
    </Card>
  )
}
