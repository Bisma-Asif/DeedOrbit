import { CalendarClock, FolderClock, ShieldCheck } from "lucide-react"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

import { Progress } from "@/components/ui/progress"

import { Skeleton } from "@/components/ui/skeleton"

import type { DashboardDocumentVerification } from "@shared/dashboard"

import { formatNumber } from "@/lib/format"

import { WidgetShell } from "./widget-shell"

import type { DashboardWidgetState } from "./use-dashboard"

/**
 * The verification desk at a glance.
 *
 * Every figure is a tenant-wide read over the customer document files, so the
 * card only mounts for a role that can see documents; a role that cannot gets
 * no panel at all rather than a row of zeros it has no business reading. The
 * average score is folded from the same per-customer checklist rollup the
 * checklist screen shows, so the two never disagree, and it renders a dash when
 * no customer holds papers yet.
 */

export function DocumentVerificationCard({
  state,
}: {
  state: DashboardWidgetState
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground">
            <ShieldCheck size={14} aria-hidden />
          </span>

          <div className="min-w-0">
            <CardTitle>Document verification</CardTitle>

            <CardDescription>
              Customer papers awaiting the desk.
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        <WidgetShell<DashboardDocumentVerification | null>
          state={state}
          isEmpty={(data) => data === null}
          empty={
            <p className="text-[11.5px] text-muted-foreground">
              No customer documents on file yet.
            </p>
          }
          skeleton={
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-16" />
              ))}
            </div>
          }
        >
          {(data) => {
            if (data === null) return null
            return (
              <div className="flex flex-col gap-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <Figure
                    label="Pending review"
                    value={formatNumber(data.pendingReview)}
                    icon={<FolderClock size={12} aria-hidden />}
                    tone="pending"
                  />

                  <Figure
                    label="Rejected"
                    value={formatNumber(data.rejected)}
                    icon={<ShieldCheck size={12} aria-hidden />}
                    tone="danger"
                  />

                  <Figure
                    label="Expiring soon"
                    value={formatNumber(data.expiringSoon)}
                    icon={<CalendarClock size={12} aria-hidden />}
                    tone="pending"
                  />
                </div>

                <div className="rounded-md border border-border bg-muted/40 p-3">
                  <div className="flex items-center justify-between gap-2 text-[12px]">
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <ShieldCheck size={12} aria-hidden />
                      Average verification score
                    </span>

                    <span className="tabular-nums font-medium text-foreground">
                      {data.averageScore === null
                        ? "—"
                        : `${data.averageScore}%`}
                    </span>
                  </div>

                  {data.averageScore !== null && (
                    <Progress
                      value={Math.min(100, Math.max(0, data.averageScore))}
                      className="mt-2"
                      aria-label="Average verification score"
                    />
                  )}
                </div>
              </div>
            )
          }}
        </WidgetShell>
      </CardContent>
    </Card>
  )
}

function Figure({
  label,

  value,

  icon,

  tone,
}: {
  label: string

  value: string

  icon: React.ReactNode

  tone: "pending" | "danger"
}) {
  return (
    <div className="rounded-md border border-border px-3 py-2.5">
      <p className="flex items-center gap-1.5 text-[10.5px] font-semibold tracking-[0.07em] text-muted-foreground uppercase">
        {icon}
        {label}
      </p>

      <p
        className={
          tone === "danger"
            ? "mt-1 text-[18px] leading-6 font-semibold tabular-nums text-danger"
            : "mt-1 text-[18px] leading-6 font-semibold tabular-nums text-warning"
        }
      >
        {value}
      </p>
    </div>
  )
}
