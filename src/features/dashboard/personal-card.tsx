import { Target, UserRound } from "lucide-react"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

import { Progress } from "@/components/ui/progress"

import { Skeleton } from "@/components/ui/skeleton"

import type { DashboardPersonal } from "@shared/dashboard"

import { formatNumber } from "@/lib/format"

import { MoneyText } from "./money-text"

import { WidgetShell } from "./widget-shell"

import type { DashboardWidgetState } from "./use-dashboard"

/**
 * The self-scoped panel a sales agent or a channel partner gets instead of the
 * tenant-wide KPI row. Every figure on it is their own book — their leads,
 * their bookings, their commission — which is exactly what the server scoped it
 * to; the note in the footer says so in plain words so nobody reads a personal
 * number as a company total.
 */

export function PersonalCard({
  state,

  currency,
}: {
  state: DashboardWidgetState

  currency: string
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground">
            <UserRound size={14} aria-hidden />
          </span>

          <div className="min-w-0">
            <CardTitle>My numbers</CardTitle>

            <CardDescription>
              Your own book for the selected period.
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        <WidgetShell<DashboardPersonal>
          state={state}
          skeleton={
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-16" />
              ))}
            </div>
          }
        >
          {(personal) => (
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Figure
                  label={personal.heading || "Sales value"}
                  value={
                    <MoneyText
                      value={personal.salesValue}
                      currency={currency}
                    />
                  }
                />

                <Figure
                  label="Bookings"
                  value={
                    personal.bookingsCount === null
                      ? "—"
                      : formatNumber(personal.bookingsCount)
                  }
                />

                <Figure
                  label="Open leads"
                  value={
                    personal.openLeads === null
                      ? "—"
                      : formatNumber(personal.openLeads)
                  }
                />
              </div>

              {personal.commissionOrTarget && (
                <div className="rounded-md border border-border bg-muted/40 p-3">
                  <div className="flex items-center justify-between gap-2 text-[12px]">
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <Target size={12} aria-hidden />
                      {personal.commissionOrTarget.label}
                    </span>

                    <span className="tabular-nums font-medium text-foreground">
                      <MoneyText
                        value={personal.commissionOrTarget.value}
                        currency={currency}
                      />
                    </span>
                  </div>

                  {personal.commissionOrTarget.target !== null && (
                    <>
                      <Progress
                        value={Math.min(
                          100,

                          personal.commissionOrTarget.achievedPct ?? 0,
                        )}
                        className="mt-2"
                        aria-label={`${personal.commissionOrTarget.label} achieved`}
                      />

                      <p className="mt-1 text-right text-[11px] tabular-nums text-muted-foreground">
                        {personal.commissionOrTarget.achievedPct === null
                          ? "No target set"
                          : `${personal.commissionOrTarget.achievedPct}% of target`}
                      </p>
                    </>
                  )}
                </div>
              )}

              <p className="text-[11.5px] text-muted-foreground">
                {personal.scopeNote}
              </p>
            </div>
          )}
        </WidgetShell>
      </CardContent>
    </Card>
  )
}

function Figure({
  label,

  value,
}: {
  label: string

  value: React.ReactNode
}) {
  return (
    <div className="rounded-md border border-border px-3 py-2.5">
      <p className="text-[10.5px] font-semibold tracking-[0.07em] text-muted-foreground uppercase">
        {label}
      </p>

      <p className="mt-1 text-[18px] leading-6 font-semibold tabular-nums text-foreground">
        {value}
      </p>
    </div>
  )
}
