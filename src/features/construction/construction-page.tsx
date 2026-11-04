/**
 * The construction overview.
 *
 * A project picker across the top and one card per phase below. Each card pairs
 * the *plan* (a stored budget, a progress figure) with the *evidence* (actual
 * spend derived from tagged expense/invoice rows) and never fuses the two: an
 * amount in a currency other than the phase budget is listed on its own line
 * rather than added into a number that would be a lie. Progress carries the
 * mode it came from so a site report and a task rollup read differently.
 */

import { useEffect, useMemo, useState } from "react"

import { HardHat, Plus, Users } from "lucide-react"

import { Alert, AlertDescription } from "@/components/ui/alert"

import { Badge } from "@/components/ui/badge"

import { Button } from "@/components/ui/button"

import { Card } from "@/components/ui/card"

import { EmptyState } from "@/components/empty-state"

import { Field } from "@/components/field"

import { PageHeader } from "@/components/page-header"

import { Progress } from "@/components/ui/progress"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

import { Skeleton } from "@/components/ui/skeleton"

import { ContractorsDialog } from "@/features/construction/contractors-dialog"

import { PhaseFormDialog } from "@/features/construction/phase-form-dialog"

import {
  PROGRESS_MODE_LABELS,
  phaseStatusTone,
} from "@/features/construction/construction-bits"

import { formatCurrency, orDash } from "@/lib/format"

import { navigate } from "@/lib/router"

import { useSession } from "@/lib/session-context"

import { useAsyncResource } from "@/lib/use-async-resource"

import { projectsApi } from "@/lib/projects-api"

import { constructionApi } from "@/lib/construction-api"

import type { ConstructionPhaseView } from "@shared/construction"

export function ConstructionPage() {
  const session = useSession()

  const canView = session.can("construction", "view")

  const projectResource = useAsyncResource(
    (signal) => projectsApi.list(signal),

    canView,
  )

  const projects = useMemo(
    () => projectResource.data?.projects ?? [],

    [projectResource.data],
  )

  const [projectId, setProjectId] = useState<string>("")

  // Land on the first project once the list resolves, so the phase grid has a

  // scope without a click. An empty portfolio stays empty and says so.

  useEffect(() => {
    if (projectId === "" && projects.length > 0) {
      setProjectId(projects[0]!.id)
    }
  }, [projects, projectId])

  const phaseResource = useAsyncResource(
    (signal) => constructionApi.listPhases(projectId, signal),

    canView && projectId !== "",
  )

  const phases = phaseResource.data?.phases ?? []

  const canCreate = phaseResource.data?.canCreate ?? false

  const statusLabels: Record<string, string> =
    phaseResource.data?.statusLabels ?? {}

  const [creating, setCreating] = useState(false)

  const [managingContractors, setManagingContractors] = useState(false)

  if (!canView) {
    return (
      <EmptyState
        icon={HardHat}
        title="Construction is not available to your role"
        description="Ask a workspace administrator for the construction grant to view this page."
        tone="pending"
      />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Construction"
        description="Phases, tasks, and site progress per project. Actual spend is read from tagged ledger rows — never a parallel money system."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setManagingContractors(true)}
            >
              <Users size={13} />
              Contractors
            </Button>
            {canCreate && projectId ? (
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus size={14} />
                New phase
              </Button>
            ) : null}
          </>
        }
      />

      <Card className="p-3">
        <Field
          label="Project"
          htmlFor="construction-project"
          className="max-w-sm"
        >
          <Select value={projectId} onValueChange={setProjectId}>
            <SelectTrigger id="construction-project" size="sm">
              <SelectValue placeholder="Choose a project" />
            </SelectTrigger>
            <SelectContent>
              {projects.map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </Card>

      {projectResource.error ? (
        <Alert variant="danger">
          <AlertDescription>{projectResource.error}</AlertDescription>
        </Alert>
      ) : null}

      {projectResource.loading && !projectResource.data ? (
        <Skeleton className="h-40 w-full" />
      ) : projects.length === 0 ? (
        <EmptyState
          icon={HardHat}
          title="No projects yet"
          description="Construction hangs off a project. Add one and its phases will appear here."
        />
      ) : phaseResource.loading && !phaseResource.data ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((n) => (
            <Skeleton key={n} className="h-44 w-full" />
          ))}
        </div>
      ) : phaseResource.error ? (
        <Alert variant="danger">
          <AlertDescription>{phaseResource.error}</AlertDescription>
        </Alert>
      ) : phases.length === 0 ? (
        <EmptyState
          icon={HardHat}
          title="No phases for this project"
          description="Break the build into phases and track progress and spend against each."
          action={
            canCreate ? (
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus size={14} />
                New phase
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {phases.map((phase) => (
            <PhaseCard
              key={phase.id}
              phase={phase}
              statusLabel={statusLabels[phase.status] ?? phase.status}
            />
          ))}
        </div>
      )}

      <PhaseFormDialog
        open={creating}
        projectId={projectId}
        onOpenChange={setCreating}
        onSaved={() => {
          void phaseResource.reload()
        }}
      />

      <ContractorsDialog
        open={managingContractors}
        onOpenChange={setManagingContractors}
      />
    </div>
  )
}

interface PhaseCardProps {
  phase: ConstructionPhaseView

  statusLabel: string
}

function PhaseCard({ phase, statusLabel }: PhaseCardProps) {
  // The actuals that share the budget's currency fold into the variance; any

  // other currency is a separate line the server already isolated for us.

  const budgetActual = phase.budgetCurrency
    ? (phase.actualByCurrency.find(
        (slice) => slice.currency === phase.budgetCurrency,
      )?.amount ?? 0)
    : null

  return (
    <Card
      className="flex cursor-pointer flex-col gap-3 p-3.5 transition-colors hover:border-border-strong"
      onClick={() => navigate(`/construction/phases/${phase.id}`)}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[13.5px] font-semibold text-foreground">
            {phase.name}
          </p>
          <p className="text-[11px] text-muted-foreground">
            Phase {phase.sequence} · {orDash(phase.projectName)}
          </p>
        </div>
        <Badge variant={phaseStatusTone(phase.status)}>{statusLabel}</Badge>
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>{PROGRESS_MODE_LABELS[phase.progressMode]}</span>
          <span className="tabular-nums">
            {phase.progress === null ? "—" : `${phase.progress}%`}
          </span>
        </div>
        <Progress value={phase.progress ?? 0} />
      </div>

      <div className="grid grid-cols-2 gap-2 border-t border-border pt-2.5 text-[12px]">
        <div>
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            Budget
          </p>
          <p className="tabular-nums text-foreground">
            {phase.budgetAmount === null
              ? "—"
              : formatCurrency(
                  phase.budgetAmount,
                  phase.budgetCurrency ?? "AED",
                  {
                    maximumFractionDigits: 0,
                  },
                )}
          </p>
        </div>
        <div>
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            Actual
          </p>
          <p className="tabular-nums text-foreground">
            {budgetActual === null
              ? "—"
              : formatCurrency(budgetActual, phase.budgetCurrency ?? "AED", {
                  maximumFractionDigits: 0,
                })}
          </p>
        </div>
      </div>

      {phase.variance !== null ? (
        <p
          className={
            phase.variance < 0
              ? "text-[11.5px] font-medium text-danger"
              : "text-[11.5px] text-muted-foreground"
          }
        >
          {phase.variance < 0 ? "Over budget by " : "Under budget by "}
          {formatCurrency(
            Math.abs(phase.variance),

            phase.budgetCurrency ?? "AED",

            { maximumFractionDigits: 0 },
          )}
        </p>
      ) : (
        <p className="text-[11.5px] text-muted-foreground">
          No budget set — variance is not computed.
        </p>
      )}

      {phase.foreignActuals.length > 0 ? (
        <p className="text-[11px] text-warning">
          Also spent:{" "}
          {phase.foreignActuals

            .map(
              (slice) =>
                `${slice.currency} ${formatCurrency(slice.amount, slice.currency, { maximumFractionDigits: 0 })}`,
            )

            .join(" · ")}{" "}
          (kept separate, not summed)
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
        <span className="tabular-nums">
          {phase.taskCount} task{phase.taskCount === 1 ? "" : "s"}
        </span>
        {phase.contractorNames.slice(0, 2).map((name) => (
          <Badge key={name} variant="outline">
            {name}
          </Badge>
        ))}
        {phase.contractorNames.length > 2 ? (
          <span>+{phase.contractorNames.length - 2}</span>
        ) : null}
      </div>
    </Card>
  )
}
