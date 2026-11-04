import { useState } from "react"

import {
  CheckCircle2,
  Circle,
  Database,
  ListChecks,
  Sparkles,
  Trash2,
} from "lucide-react"

import { Alert, AlertDescription } from "@/components/ui/alert"

import { Badge } from "@/components/ui/badge"

import { Button } from "@/components/ui/button"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

import { Progress } from "@/components/ui/progress"

import { Skeleton } from "@/components/ui/skeleton"

import type { DashboardChecklist } from "@shared/dashboard"

import { dashboardApi } from "@/lib/dashboard-api"

import { ApiError } from "@/lib/api"

import { navigate } from "@/lib/router"

import { WidgetShell } from "./widget-shell"

import type { DashboardWidgetState } from "./use-dashboard"

/**
 * The first-login state.
 *
 * A workspace with no rows never gets a page of zeros: this card names the
 * five things that make the dashboard mean something and links each one to the
 * screen that does it. The sample-data pair is opt-in, labelled, and refused by
 * the server unless the role holds `settings.edit`; the rows it writes are
 * registered as demo rows so they can be removed in one click and never pass
 * for the tenant's own business.
 */

export function GetStartedCard({
  state,

  sampleActive,

  canManageSample,

  onChange,

  /** Called after a load or removal so the whole page re-reads the new truth. */
}: {
  state: DashboardWidgetState

  sampleActive: boolean

  canManageSample: boolean

  onChange: () => void
}) {
  const [busy, setBusy] = useState<"load" | "remove" | null>(null)

  const [failure, setFailure] = useState<string | null>(null)

  async function run(kind: "load" | "remove") {
    setBusy(kind)

    setFailure(null)

    try {
      if (kind === "load") await dashboardApi.loadSample()
      else await dashboardApi.removeSample()

      onChange()
    } catch (error) {
      setFailure(
        error instanceof ApiError
          ? error.message
          : "That request could not be completed.",
      )
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border border-success-border bg-success-subtle text-success">
            <ListChecks size={14} aria-hidden />
          </span>

          <div className="min-w-0">
            <CardTitle>Get your workspace ready</CardTitle>

            <CardDescription>
              Five steps turn this dashboard from a blank board into your
              business. Everything here is your own data — nothing is filled in
              for you.
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <WidgetShell<DashboardChecklist>
          state={state}
          skeleton={
            <div className="flex flex-col gap-2">
              <Skeleton className="h-1.5 w-full" />

              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          }
        >
          {({ steps, completedCount, totalCount }) => {
            const pct =
              totalCount > 0
                ? Math.round((completedCount / totalCount) * 100)
                : 0

            return (
              <>
                <div>
                  <div className="flex items-center justify-between text-[11.5px]">
                    <span className="text-muted-foreground">
                      Setup progress
                    </span>

                    <span className="tabular-nums font-medium text-foreground">
                      {completedCount} of {totalCount} done
                    </span>
                  </div>

                  <Progress
                    value={pct}
                    className="mt-1.5"
                    aria-label={`${completedCount} of ${totalCount} setup steps complete`}
                  />
                </div>

                <ol className="flex flex-col divide-y divide-border">
                  {steps.map((step, index) => (
                    <li
                      key={step.key}
                      className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0"
                    >
                      <span
                        className={
                          step.done
                            ? "text-success"
                            : "text-muted-foreground/60"
                        }
                        aria-hidden
                      >
                        {step.done ? (
                          <CheckCircle2 size={15} />
                        ) : (
                          <Circle size={15} />
                        )}
                      </span>

                      <div className="min-w-0 flex-1">
                        <p
                          className={
                            step.done
                              ? "text-[12.5px] text-muted-foreground line-through"
                              : "text-[12.5px] font-medium text-foreground"
                          }
                        >
                          {index + 1}. {step.label}
                        </p>

                        <p className="truncate text-[11.5px] text-muted-foreground">
                          {step.description}
                        </p>
                      </div>

                      {step.done ? (
                        <Badge variant="success">Done</Badge>
                      ) : (
                        <Button
                          variant="subtle"
                          size="sm"
                          onClick={() => navigate(step.path)}
                        >
                          {step.actionLabel}
                        </Button>
                      )}
                    </li>
                  ))}
                </ol>
              </>
            )
          }}
        </WidgetShell>

        {canManageSample && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
            <p className="flex items-center gap-2 text-[12px] text-muted-foreground">
              <Database size={13} aria-hidden />
              {sampleActive
                ? "A labelled demo dataset is loaded. It is flagged as sample data and can be removed at any time."
                : "Exploring for the first time? Load a clearly labelled demo dataset to see the dashboard with figures in it."}
            </p>

            <div className="flex items-center gap-2">
              {sampleActive ? (
                <Button
                  variant="danger-outline"
                  size="sm"
                  onClick={() => void run("remove")}
                  disabled={busy !== null}
                >
                  <Trash2 size={13} />
                  {busy === "remove" ? "Removing…" : "Remove sample data"}
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void run("load")}
                  disabled={busy !== null}
                >
                  <Sparkles size={13} />
                  {busy === "load" ? "Loading…" : "Load sample data"}
                </Button>
              )}
            </div>
          </div>
        )}

        {failure && (
          <Alert variant="danger">
            <AlertDescription>{failure}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  )
}
