import type { ReactNode } from "react"

import { RotateCw, TriangleAlert } from "lucide-react"

import { Button } from "@/components/ui/button"

import { Skeleton } from "@/components/ui/skeleton"

import type { WidgetEnvelope } from "@shared/dashboard"

import { cn } from "@/lib/utils"

import type { DashboardWidgetState } from "./use-dashboard"

/**
 * The one state machine every dashboard card goes through.
 *
 * A card is either skeleton, failed-with-retry, empty-with-a-next-step, or
 * real content — never a blank box and never a spinner-only page. Because the
 * aggregated endpoint answers each widget in its own envelope, one failing
 * loader degrades only the card that owns it, and the retry re-answers just
 * that widget through the server cache.
 */

export function WidgetShell<T>({
  state,

  children,

  isEmpty,

  empty,

  skeleton,

  skeletonHeight = "h-40",

  className,

  /** Renders the empty state instead of the widget when the payload has no rows. */

  /** Optional bespoke skeleton; the default is a block of the card's own height. */
}: {
  state: DashboardWidgetState

  children: (data: T) => ReactNode

  isEmpty?: (data: T) => boolean

  empty?: ReactNode

  skeleton?: ReactNode

  skeletonHeight?: string

  className?: string
}) {
  if (state.loading || state.envelope === undefined) {
    return (
      <div className={className}>
        {skeleton ?? <Skeleton className={cn("w-full", skeletonHeight)} />}
      </div>
    )
  }

  const envelope: WidgetEnvelope<unknown> = state.envelope

  if (!envelope.ok) {
    return (
      <div
        className={cn(
          "flex min-h-32 flex-col items-center justify-center gap-2 px-4 py-6 text-center",

          className,
        )}
        role="alert"
      >
        <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-danger">
          <TriangleAlert size={14} />
          This section could not load
        </span>
        <p className="max-w-sm text-[11.5px] text-muted-foreground">
          {envelope.error}
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={state.retry}
          className="mt-1"
        >
          <RotateCw size={12} />
          Retry
        </Button>
      </div>
    )
  }

  const data = envelope.data as T

  if (isEmpty?.(data) === true && empty) {
    return <div className={className}>{empty}</div>
  }

  return <div className={className}>{children(data)}</div>
}

/** Row arrays are the common payload shape — this keeps the emptiness test honest. */

export function isEmptyRows(data: unknown): boolean {
  return Array.isArray(data) && data.length === 0
}
