import { Badge } from "@/components/ui/badge"

import { Progress } from "@/components/ui/progress"

import { formatBytes, formatNumber } from "@/lib/format"

import {
  DERIVED_BILLING_LABELS,
  type BillingEventTone,
  type DerivedBillingStatus,
  type PlatformUsage,
} from "@shared/platform"

import { cn } from "@/lib/utils"

/**
 * Shared render pieces for the platform screens, so the directory and the
 * detail page read the same derived billing status the same way.
 */

const BILLING_VARIANT: Record<DerivedBillingStatus, "success" | "pending" | "danger"> =
  {
    current: "success",

    due: "pending",

    grace_active: "pending",

    grace_expired: "danger",
  }

export function BillingStatusBadge({
  status,
}: {
  status: DerivedBillingStatus
}) {
  return (
    <Badge variant={BILLING_VARIANT[status]}>
      {DERIVED_BILLING_LABELS[status]}
    </Badge>
  )
}

const WORKSPACE_VARIANT: Record<string, "success" | "danger" | "neutral"> = {
  active: "success",

  suspended: "danger",

  closed: "neutral",
}

const WORKSPACE_LABEL: Record<string, string> = {
  active: "Active",

  suspended: "Suspended",

  closed: "Closed",
}

/** The lifecycle badge. Separate from billing on purpose: paid-up and suspended can coexist. */

export function WorkspaceStatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={WORKSPACE_VARIANT[status] ?? "neutral"}>
      {WORKSPACE_LABEL[status] ?? status}
    </Badge>
  )
}

export const EVENT_TONE_BADGE: Record<BillingEventTone, "success" | "pending" | "danger" | "neutral"> =
  {
    success: "success",

    pending: "pending",

    danger: "danger",

    neutral: "neutral",
  }

/**
 * One usage dimension against its plan limit: `used / limit` in words plus a
 * bar that turns amber near the cap and muted red at or over it. A null limit
 * means the workspace sits on an unknown plan — the count still shows, the
 * bar and the limit render as a dash rather than an invented cap.
 */

export function UsageMeter({ usage }: { usage: PlatformUsage }) {
  const ratio =
    usage.limit === null || usage.limit === 0
      ? null
      : Math.min(1, usage.used / usage.limit)

  const over =
    usage.limit !== null && usage.limit > 0 && usage.used >= usage.limit

  const near = ratio !== null && !over && ratio >= 0.8

  return (
    <div className="w-24">
      <p className="text-[11.5px] tabular-nums">
        <span className={cn(over && "font-medium text-danger")}>
          {formatNumber(usage.used)}
        </span>
        <span className="text-muted-foreground">
          {" / "}
          {usage.limit === null ? "—" : formatNumber(usage.limit)}
        </span>
      </p>
      <Progress
        value={ratio === null ? 0 : Math.round(ratio * 100)}
        aria-hidden="true"
        className="mt-1 h-1"
        indicatorClassName={
          over ? "bg-danger" : near ? "bg-warning" : undefined
        }
      />
    </div>
  )
}

/** Storage row of the same meter, formatted as bytes instead of a headcount. */

export function StorageMeter({ usage }: { usage: PlatformUsage }) {
  const ratio =
    usage.limit === null || usage.limit === 0
      ? null
      : Math.min(1, usage.used / usage.limit)

  const over =
    usage.limit !== null && usage.limit > 0 && usage.used >= usage.limit

  const near = ratio !== null && !over && ratio >= 0.8

  return (
    <div className="w-28">
      <p className="text-[11.5px] tabular-nums">
        <span className={cn(over && "font-medium text-danger")}>
          {formatBytes(usage.used)}
        </span>
        <span className="text-muted-foreground">
          {" / "}
          {usage.limit === null ? "—" : formatBytes(usage.limit)}
        </span>
      </p>
      <Progress
        value={ratio === null ? 0 : Math.round(ratio * 100)}
        aria-hidden="true"
        className="mt-1 h-1"
        indicatorClassName={
          over ? "bg-danger" : near ? "bg-warning" : undefined
        }
      />
    </div>
  )
}
