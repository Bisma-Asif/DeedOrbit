import { Boxes, TriangleAlert } from "lucide-react"

import { Button } from "@/components/ui/button"

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

import { EmptyState } from "@/components/empty-state"

import { Skeleton } from "@/components/ui/skeleton"

import { inventoryCategoriesApi } from "@/lib/inventory-categories-api"

import { formatCurrencyCompact, formatNumber } from "@/lib/format"

import { navigate } from "@/lib/router"

import { useAsyncResource } from "@/lib/use-async-resource"

/** How many property types are charted before the rest are folded into a line. */

const TOP_GROUPS = 8

/**
 * What the workspace is actually made of — units grouped by property type.
 *
 * The donut beside this one answers "how far along is each unit in the sales
 * lifecycle"; this answers the other question a principal asks on Monday morning,
 * "what have we got to sell". The figures come from the same category endpoint the
 * inventory screen uses, so the two can never report a different number of plots.
 *
 * Fetched here rather than added to the aggregated overview because the overview is
 * scoped to a date window and a property mix is not: `4.5 Marla` plots do not become
 * fewer because the range moved to this month.
 */

export function CategoryBreakdownCard({
  projectId,

  currency,

  /** The dashboard's project filter; null asks for the whole workspace. */
}: {
  projectId: string | null

  currency: string
}) {
  const resource = useAsyncResource((signal) =>
    inventoryCategoriesApi.summary(projectId ?? undefined, signal),
  )

  const data = resource.data

  const groups = data?.groups ?? []

  const shown = groups.slice(0, TOP_GROUPS)

  const folded = groups.length - shown.length

  const max = shown.reduce((peak, group) => Math.max(peak, group.total), 0)

  const restTotal = groups

    .slice(TOP_GROUPS)

    .reduce((sum, group) => sum + group.total, 0)

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Stock by category</CardTitle>

          <CardDescription>
            Units grouped by property type, with how many are still open for
            sale. The same counts the inventory screen puts on its cards.
          </CardDescription>
        </div>

        <CardAction>
          <button
            type="button"
            onClick={() => navigate("/inventory")}
            className="text-[12px] font-medium text-primary underline-offset-4 hover:underline"
          >
            Open inventory
          </button>
        </CardAction>
      </CardHeader>

      <CardContent>
        {resource.loading && !data ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-4 w-full" />

            <Skeleton className="h-4 w-5/6" />

            <Skeleton className="h-4 w-4/6" />
          </div>
        ) : resource.error ? (
          <div
            className="flex flex-col items-center gap-2 py-6 text-center"
            role="alert"
          >
            <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-danger">
              <TriangleAlert size={14} aria-hidden />
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
        ) : data && data.total === 0 ? (
          <EmptyState
            icon={Boxes}
            size="sm"
            title="No units in this scope yet"
            description="Units are classified by property type when they are added, and the mix builds up from there."
            action={
              <button
                type="button"
                onClick={() => navigate("/inventory")}
                className="text-[12.5px] font-medium text-primary underline-offset-4 hover:underline"
              >
                Add units
              </button>
            }
          />
        ) : data ? (
          <div className="flex flex-col gap-2">
            {shown.map((group) => (
              <div
                key={group.key ?? "unclassified"}
                className="rounded-md px-1 py-0.5"
              >
                <div className="flex items-baseline justify-between gap-2 text-[12.5px]">
                  <span className="min-w-0 truncate text-foreground">
                    {group.label}
                  </span>

                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {formatNumber(group.total)} units ·{" "}
                    <span className="text-emerald-700">
                      {formatNumber(group.available)} open
                    </span>
                  </span>
                </div>

                <div className="mt-1 flex items-center gap-2">
                  <span
                    className="h-2 rounded-sm bg-emerald-500/70"
                    style={{
                      width: `${
                        max === 0 ? 0 : Math.round((group.total / max) * 100)
                      }%`,
                    }}
                    aria-hidden
                  />

                  <span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground">
                    {group.value > 0
                      ? formatCurrencyCompact(group.value, currency)
                      : "—"}
                  </span>
                </div>

                {group.subtypes.length > 0 ? (
                  <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                    {group.subtypes

                      .slice(0, 3)

                      .map((subtype) => `${subtype.label} ${subtype.count}`)

                      .join(" · ")}
                  </p>
                ) : null}
              </div>
            ))}

            {folded > 0 ? (
              <p className="mt-1 text-[11.5px] text-muted-foreground">
                {formatNumber(restTotal)} {restTotal === 1 ? "unit" : "units"}{" "}
                across {folded} further {folded === 1 ? "type" : "types"} are
                not charted.
              </p>
            ) : null}

            {data.total > 0 ? (
              <p className="mt-1 border-t border-border pt-2 text-[11px] text-muted-foreground">
                {formatNumber(data.total)} units in this scope. Types come from
                Settings &rsaquo; Inventory setup, which this workspace edits
                itself.
              </p>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
