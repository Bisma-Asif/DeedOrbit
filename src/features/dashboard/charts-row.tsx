import { HandCoins, PackageOpen } from "lucide-react"

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

import { DonutChart } from "@/components/charts/donut-chart"

import TrendChart from "@/components/charts/trend-chart"

import { EmptyState } from "@/components/empty-state"

import type {
  DashboardInventorySlice,
  DashboardTrendPoint,
} from "@shared/dashboard"

import { navigate } from "@/lib/router"

import { isEmptyRows, WidgetShell } from "./widget-shell"

import type { DashboardWidgetState } from "./use-dashboard"

/**
 * The charts row: a wide sales/collections trend and the inventory donut.
 *
 * Both are hidden entirely when the role may not see them — the server decides
 * visibility and the page simply does not render the section, so a sales agent
 * never meets an empty frame where an accounting chart would have been.
 */

export function ChartsRow({
  trendState,

  inventoryState,

  showTrend,

  showInventory,

  currency,

  granularityLabel,

  hasProjects,

  /** "day", "week" or "month" — resolved server-side from the window width. */
}: {
  trendState: DashboardWidgetState

  inventoryState: DashboardWidgetState

  showTrend: boolean

  showInventory: boolean

  currency: string

  granularityLabel: string

  hasProjects: boolean
}) {
  if (!showTrend && !showInventory) return null

  return (
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-12">
      {showTrend && (
        <Card className="xl:col-span-7">
          <CardHeader>
            <div>
              <CardTitle>Sales &amp; Collections Trend</CardTitle>

              <CardDescription>
                Booked value against cash received, bucketed by{" "}
                {granularityLabel}. The dashed line is the collections target
                for the selected window.
              </CardDescription>
            </div>
            <CardAction>
              <button
                type="button"
                onClick={trendState.retry}
                className="text-[11.5px] font-medium text-primary underline-offset-4 hover:underline"
              >
                Reload
              </button>
            </CardAction>
          </CardHeader>

          <CardContent>
            <WidgetShell<Array<DashboardTrendPoint>>
              state={trendState}
              isEmpty={isEmptyRows}
              skeletonHeight="h-56"
              empty={
                <EmptyState
                  icon={HandCoins}
                  size="sm"
                  title="No sales or collections in this window"
                  description="Confirmed bookings and allocated receipts are charted here once there is activity in the selected range."
                  action={
                    hasProjects ? (
                      <button
                        type="button"
                        onClick={() => navigate("/bookings")}
                        className="text-[12.5px] font-medium text-primary underline-offset-4 hover:underline"
                      >
                        Go to bookings
                      </button>
                    ) : undefined
                  }
                />
              }
            >
              {(points) => <TrendChart data={points} currency={currency} />}
            </WidgetShell>
          </CardContent>
        </Card>
      )}

      {showInventory && (
        <Card className={showTrend ? "xl:col-span-5" : "xl:col-span-12"}>
          <CardHeader>
            <div>
              <CardTitle>Inventory Status</CardTitle>

              <CardDescription>
                Units by current status across the selected scope.
              </CardDescription>
            </div>
            <CardAction>
              <button
                type="button"
                onClick={inventoryState.retry}
                className="text-[11.5px] font-medium text-primary underline-offset-4 hover:underline"
              >
                Reload
              </button>
            </CardAction>
          </CardHeader>

          <CardContent>
            <WidgetShell<Array<DashboardInventorySlice>>
              state={inventoryState}
              isEmpty={isEmptyRows}
              skeletonHeight="h-44"
              empty={
                <EmptyState
                  icon={PackageOpen}
                  size="sm"
                  title="No units published yet"
                  description="Units added to a project are summarised here by status."
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
              }
            >
              {(slices) => (
                <DonutChart
                  data={slices.map((slice) => ({
                    label: slice.label,

                    value: slice.count,
                  }))}
                />
              )}
            </WidgetShell>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
