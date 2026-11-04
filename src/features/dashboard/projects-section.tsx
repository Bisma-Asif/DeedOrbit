import { Building2, CalendarClock, MapPin } from "lucide-react"

import { Badge, type BadgeVariant } from "@/components/ui/badge"

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

import { Progress } from "@/components/ui/progress"

import { EmptyState } from "@/components/empty-state"

import { Skeleton } from "@/components/ui/skeleton"

import type { DashboardProjectCard } from "@shared/dashboard"

import { formatNumber, formatDate } from "@/lib/format"

import { navigate } from "@/lib/router"

import { MoneyText } from "./money-text"

import { WidgetShell } from "./widget-shell"

import type { DashboardWidgetState } from "./use-dashboard"

/**
 * Project status colours follow the design system's single meaning per colour:
 * emerald is a live sellable project, amber is a stage awaiting action, slate
 * is planning or parked. Nothing else is introduced.
 */

interface StatusBadgeSpec {
  label: string

  variant: BadgeVariant
}

const STATUS_BADGES: Record<string, StatusBadgeSpec> = {
  planning: { label: "Planning", variant: "outline" },

  pre_launch: { label: "Pre-launch", variant: "pending" },

  on_sale: { label: "Active", variant: "success" },

  on_hold: { label: "On Hold", variant: "neutral" },

  handed_over: { label: "Completed", variant: "success" },
}

export function ProjectsSection({
  state,

  currency,
}: {
  state: DashboardWidgetState

  currency: string
}) {
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Active &amp; Pending Projects</CardTitle>

          <CardDescription>
            Portfolio pace this period — sold share, open stock, and the next
            committed date.
          </CardDescription>
        </div>
        <CardAction>
          <button
            type="button"
            onClick={() => navigate("/projects")}
            className="text-[12px] font-medium text-primary underline-offset-4 hover:underline"
          >
            View all projects
          </button>
        </CardAction>
      </CardHeader>

      <CardContent>
        <WidgetShell<Array<DashboardProjectCard>>
          state={state}
          isEmpty={(rows) => rows.length === 0}
          empty={
            <EmptyState
              icon={Building2}
              size="sm"
              title="No projects yet"
              description="Create a project, then publish its units, and progress starts reporting itself here."
              action={
                <button
                  type="button"
                  onClick={() => navigate("/projects")}
                  className="text-[12.5px] font-medium text-primary underline-offset-4 hover:underline"
                >
                  Create a project
                </button>
              }
            />
          }
          skeleton={
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <Card key={i} className="gap-2 p-3">
                  <Skeleton className="h-4 w-32" />

                  <Skeleton className="h-3 w-24" />

                  <Skeleton className="mt-2 h-1.5 w-full" />

                  <Skeleton className="h-3 w-40" />
                </Card>
              ))}
            </div>
          }
        >
          {(projects) => (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {projects.map((project) => {
                const badge = STATUS_BADGES[project.status] ?? {
                  label: project.statusLabel,
                  variant: "neutral",
                }

                const pct = project.soldPct

                return (
                  <a
                    key={project.id}
                    href={`#/projects/${project.id}`}
                    aria-label={`Open ${project.name}`}
                    className="block rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  >
                    <Card className="h-full gap-2.5 p-3 transition-colors hover:border-primary/40">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-[13.5px] font-semibold text-foreground">
                            {project.name}
                          </p>

                          <p className="mt-0.5 flex items-center gap-1 text-[11.5px] text-muted-foreground">
                            <MapPin size={11} aria-hidden />
                            <span className="truncate">{project.location}</span>
                          </p>
                        </div>

                        <Badge variant={badge.variant}>{badge.label}</Badge>
                      </div>

                      <div>
                        <div className="flex items-center justify-between text-[11.5px]">
                          <span className="text-muted-foreground">
                            Units sold
                          </span>

                          <span className="tabular-nums font-medium text-foreground">
                            {pct === null ? "—" : `${pct}%`}
                          </span>
                        </div>

                        <Progress
                          value={pct ?? 0}
                          className="mt-1"
                          aria-label={`${project.name} units sold percentage`}
                        />
                      </div>

                      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11.5px]">
                        <dt className="text-muted-foreground">Available</dt>

                        <dd className="text-right tabular-nums text-foreground">
                          {/* "0 of 0" is true but reads like a stub: a project with
                              no units says so in words. */}
                          {project.totalUnits === 0
                            ? "No units yet"
                            : `${formatNumber(project.availableUnits)} of ${formatNumber(
                                project.totalUnits,
                              )}`}
                        </dd>

                        <dt className="text-muted-foreground">Collections</dt>

                        <dd className="text-right tabular-nums text-foreground">
                          <MoneyText
                            value={project.collectionsInPeriod}
                            currency={currency}
                          />
                        </dd>
                      </dl>

                      {project.nextDate && (
                        <p className="mt-auto flex items-center gap-1.5 border-t border-border pt-2 text-[11.5px] text-muted-foreground">
                          <CalendarClock size={12} aria-hidden />
                          <span>
                            {project.nextDateLabel ?? "Next date"} ·{" "}
                            <span className="text-foreground">
                              {formatDate(project.nextDate)}
                            </span>
                          </span>
                        </p>
                      )}
                    </Card>
                  </a>
                )
              })}
            </div>
          )}
        </WidgetShell>
      </CardContent>
    </Card>
  )
}
