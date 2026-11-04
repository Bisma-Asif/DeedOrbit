import { AlertTriangle, Gauge, TriangleAlert } from "lucide-react"

import { Button } from "@/components/ui/button"

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

import { Progress } from "@/components/ui/progress"

import { Skeleton } from "@/components/ui/skeleton"

import { AGING_BUCKET_LABELS, type AgingBucket } from "@shared/collections"

import { collectionsApi } from "@/lib/collections-api"

import { formatNumber } from "@/lib/format"

import { navigate } from "@/lib/router"

import { useAsyncResource } from "@/lib/use-async-resource"

import { MoneyText } from "./money-text"

/**
 * The recovery officer's aging view.
 *
 * This card is the collections dashboard's own summary read straight from its
 * endpoint — the same figures the recovery board computes, including the
 * late-fee sweep it runs on read — so the dashboard never re-derives overdue
 * money twice and risks disagreeing with the page it links to.
 */

export function RecoveryAgingCard() {
  const resource = useAsyncResource(
    (signal) => collectionsApi.summary(signal),

    true,
  )

  const data = resource.data

  const currency = data?.currency ?? "AED"

  const target = data?.kpis.targetPeriodAmount ?? 0

  const collected = data?.kpis.collectedPeriodAmount ?? 0

  const attainment =
    target > 0 ? Math.round((collected / target) * 1000) / 10 : null

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Recovery Position</CardTitle>

          <CardDescription>
            Overdue aging, dues ahead, and this month&rsquo;s collection target.
          </CardDescription>
        </div>

        <CardAction>
          <button
            type="button"
            onClick={() => navigate("/payments?tab=collections")}
            className="text-[12px] font-medium text-primary underline-offset-4 hover:underline"
          >
            Open recovery board
          </button>
        </CardAction>
      </CardHeader>

      <CardContent>
        {resource.loading && !data ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-14 w-full" />

            <Skeleton className="h-24 w-full" />
          </div>
        ) : resource.error ? (
          <div
            className="flex flex-col items-center gap-2 py-6 text-center"
            role="alert"
          >
            <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-danger">
              <TriangleAlert size={14} />
              This section could not load
            </span>

            <p className="max-w-sm text-[11.5px] text-muted-foreground">
              {resource.error}
            </p>

            <Button
              variant="outline"
              size="sm"
              onClick={() => void resource.reload()}
            >
              Retry
            </Button>
          </div>
        ) : data ? (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Cell
                label="Overdue"
                icon={AlertTriangle}
                value={
                  <MoneyText
                    value={data.kpis.overdueAmount}
                    currency={currency}
                    className="text-danger"
                  />
                }
                hint={`${formatNumber(data.kpis.overdueCount)} lines past due`}
              />

              <Cell
                label="Due in 7 days"
                value={
                  <MoneyText
                    value={data.kpis.dueNext7Amount}
                    currency={currency}
                  />
                }
                hint={`${formatNumber(data.kpis.dueNext7Count)} lines falling due`}
              />

              <Cell
                label="Collected this period"
                value={<MoneyText value={collected} currency={currency} />}
                hint={
                  target > 0
                    ? `${
                        attainment === null ? "—" : `${attainment}%`
                      } of ${formatNumber(target)} target`
                    : "No target set for this period"
                }
              />
            </div>

            {target > 0 && (
              <div>
                <div className="flex items-center justify-between text-[11.5px]">
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <Gauge size={12} aria-hidden />
                    Collection target
                  </span>

                  <span className="tabular-nums font-medium text-foreground">
                    {attainment === null ? "—" : `${attainment}%`}
                  </span>
                </div>

                <Progress
                  value={Math.min(100, attainment ?? 0)}
                  className="mt-1.5"
                  aria-label="Collection target attainment"
                />
              </div>
            )}

            <div>
              <p className="text-[11px] font-semibold tracking-[0.07em] text-muted-foreground uppercase">
                Overdue aging
              </p>

              <ul className="mt-2 flex flex-col gap-1.5">
                {data.aging.map((band) => (
                  <li
                    key={band.bucket}
                    className="flex items-center justify-between gap-2 text-[12.5px]"
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className={
                          band.bucket === "61-90" || band.bucket === "90+"
                            ? "h-2.5 w-2.5 rounded-sm bg-danger/60"
                            : "h-2.5 w-2.5 rounded-sm bg-warning/70"
                        }
                        aria-hidden
                      />

                      <span className="text-muted-foreground">
                        {AGING_BUCKET_LABELS[(band.bucket as AgingBucket)] ??
                          band.bucket}
                      </span>

                      <span className="text-muted-foreground/70 tabular-nums">
                        ({formatNumber(band.count)})
                      </span>
                    </span>

                    <span className="tabular-nums font-medium text-foreground">
                      <MoneyText value={band.amount} currency={currency} />
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

function Cell({
  label,

  value,

  hint,

  icon: Icon,
}: {
  label: string

  value: React.ReactNode

  hint: string

  icon?: typeof AlertTriangle
}) {
  return (
    <div className="rounded-md border border-border px-3 py-2.5">
      <p className="flex items-center gap-1.5 text-[10.5px] font-semibold tracking-[0.07em] text-muted-foreground uppercase">
        {Icon && <Icon size={11} aria-hidden />}
        {label}
      </p>

      <p className="mt-1 text-[16px] leading-6 font-semibold tabular-nums text-foreground">
        {value}
      </p>

      <p className="text-[11px] text-muted-foreground">{hint}</p>
    </div>
  )
}
