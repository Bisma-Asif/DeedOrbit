/**
 * One construction phase in detail.
 *
 * The plan (budget, dates, the manager's site figure) sits beside the evidence
 * (actual spend derived from tagged ledger rows, the task rollup) and the two
 * are never fused: a budget in one currency and spend in another read as
 * separate lines, and progress carries the mode that produced it. Tasks list
 * with their milestones flagged and weighted; the progress log below is the
 * phase's history, newest first.
 *
 * Deletions here are narrow — a task carrying tagged spend is refused by the
 * server, and the refusal surfaces rather than quietly orphaning the ledger.
 */

import { useMemo, useState } from "react"

import {
  ArrowLeft,
  Flag,
  HardHat,
  ListChecks,
  Pencil,
  Plus,
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

import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

import { EmptyState } from "@/components/empty-state"

import { PageHeader } from "@/components/page-header"

import { Progress } from "@/components/ui/progress"

import { Skeleton } from "@/components/ui/skeleton"

import { StatCard } from "@/components/stat-card"

import { LogProgressDialog } from "@/features/construction/log-progress-dialog"

import { PhaseFormDialog } from "@/features/construction/phase-form-dialog"

import { TaskDialog } from "@/features/construction/task-dialog"

import {
  PROGRESS_MODE_LABELS,
  phaseStatusTone,
  taskStatusTone,
} from "@/features/construction/construction-bits"

import {
  formatCurrency,
  formatDate,
  formatDateTime,
  orDash,
} from "@/lib/format"

import { navigate } from "@/lib/router"

import { useSession } from "@/lib/session-context"

import { useAsyncResource } from "@/lib/use-async-resource"

import { constructionApi } from "@/lib/construction-api"

import { useSave } from "@/features/organization/use-save"

import {
  TASK_STATUS_LABELS,
  type ConstructionTaskView,
} from "@shared/construction"

interface PhaseDetailPageProps {
  phaseId: string
}

export function PhaseDetailPage({ phaseId }: PhaseDetailPageProps) {
  const session = useSession()

  const canView = session.can("construction", "view")

  const resource = useAsyncResource(
    (signal) => constructionApi.getPhase(phaseId, signal),

    canView,
  )

  const [editingPhase, setEditingPhase] = useState(false)

  const [logging, setLogging] = useState(false)

  const [taskDialog, setTaskDialog] = useState<{
    open: boolean

    task: ConstructionTaskView | null
  }>({ open: false, task: null })

  const [confirmDelete, setConfirmDelete] =
    useState<ConstructionTaskView | null>(null)

  const del = useSave()

  const phase = resource.data?.phase ?? null

  const tasks = resource.data?.tasks ?? []

  const progressLog = resource.data?.progressLog ?? []

  const canEdit = resource.data?.canEdit ?? false

  const budgetActual = useMemo(() => {
    if (!phase?.budgetCurrency) return null

    return (
      phase.actualByCurrency.find(
        (slice) => slice.currency === phase.budgetCurrency,
      )?.amount ?? 0
    )
  }, [phase])

  if (!canView) {
    return (
      <EmptyState
        icon={HardHat}
        title="Construction is not available to your role"
        description="Ask a workspace administrator for the construction grant."
        tone="pending"
      />
    )
  }

  async function runDelete(task: ConstructionTaskView) {
    const done = await del.run(async () => {
      await constructionApi.deleteTask(task.id)
    })

    if (done) {
      setConfirmDelete(null)

      await resource.reload()
    }
  }

  if (resource.loading && !phase) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (!phase) {
    return (
      <EmptyState
        icon={HardHat}
        title="That phase does not exist"
        description="It may have been removed, or the link is wrong."
        action={
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate("/construction")}
          >
            <ArrowLeft size={13} />
            Back to construction
          </Button>
        }
      />
    )
  }

  const statusLabel = phase.status.replace(/_/g, " ")

  const actions = (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => navigate("/construction")}
      >
        <ArrowLeft size={13} />
        Back
      </Button>
      {canEdit ? (
        <>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEditingPhase(true)}
          >
            <Pencil size={13} />
            Edit phase
          </Button>
          <Button variant="outline" size="sm" onClick={() => setLogging(true)}>
            <Flag size={13} />
            Log progress
          </Button>
          <Button
            size="sm"
            onClick={() => setTaskDialog({ open: true, task: null })}
          >
            <Plus size={14} />
            New task
          </Button>
        </>
      ) : null}
    </>
  )

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={phase.name}
        scope={
          <>
            <button
              type="button"
              onClick={() => navigate("/construction")}
              className="text-muted-foreground underline-offset-2 hover:underline"
            >
              {orDash(phase.projectName)}
            </button>
            <Badge variant={phaseStatusTone(phase.status)}>{statusLabel}</Badge>
          </>
        }
        description={`Phase ${phase.sequence} · ${
          phase.plannedStart || phase.plannedEnd
            ? `${orDash(phase.plannedStart ? formatDate(phase.plannedStart) : null)} → ${orDash(
                phase.plannedEnd ? formatDate(phase.plannedEnd) : null,
              )}`
            : "No dates set"
        }`}
        actions={actions}
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Budget"
          value={
            phase.budgetAmount === null
              ? undefined
              : formatCurrency(
                  phase.budgetAmount,
                  phase.budgetCurrency ?? "AED",
                  {
                    maximumFractionDigits: 0,
                  },
                )
          }
          hint={
            phase.budgetAmount === null
              ? "No budget set"
              : (phase.budgetCurrency ?? "")
          }
        />
        <StatCard
          label="Actual spend"
          value={
            budgetActual === null
              ? undefined
              : formatCurrency(budgetActual, phase.budgetCurrency ?? "AED", {
                  maximumFractionDigits: 0,
                })
          }
          hint={
            phase.variance !== null && phase.variance < 0
              ? `Over by ${formatCurrency(Math.abs(phase.variance), phase.budgetCurrency ?? "AED", { maximumFractionDigits: 0 })}`
              : phase.variance !== null
                ? `Under by ${formatCurrency(phase.variance, phase.budgetCurrency ?? "AED", { maximumFractionDigits: 0 })}`
                : "Derived from tagged ledger rows"
          }
          trend={
            phase.variance === null
              ? undefined
              : {
                  direction: phase.variance < 0 ? "up" : "down",

                  tone: phase.variance < 0 ? "negative" : "positive",

                  label: phase.variance < 0 ? "overspend" : "on plan",
                }
          }
        />
        <StatCard
          label="Progress"
          value={phase.progress === null ? undefined : `${phase.progress}%`}
          hint={PROGRESS_MODE_LABELS[phase.progressMode]}
        />
        <StatCard
          label="Milestones"
          value={
            phase.milestoneCount === 0
              ? undefined
              : `${phase.milestoneDoneCount}/${phase.milestoneCount}`
          }
          hint={
            phase.milestoneCount === 0
              ? "No milestones"
              : "Weighted double in the rollup"
          }
        />
      </div>

      {phase.foreignActuals.length > 0 ? (
        <Alert variant="pending">
          <AlertDescription>
            Also spent in other currencies (kept separate, never summed into the
            budget):{" "}
            {phase.foreignActuals

              .map(
                (slice) =>
                  `${slice.currency} ${formatCurrency(slice.amount, slice.currency, { maximumFractionDigits: 0 })}`,
              )

              .join(" · ")}
          </AlertDescription>
        </Alert>
      ) : null}

      {phase.progressMode === "derived" && phase.manualProgress !== null ? (
        <p className="text-[11.5px] text-muted-foreground">
          The task rollup ({phase.derivedProgress ?? 0}%) leads here; the latest
          site report reads {phase.manualProgress}%.
        </p>
      ) : null}

      {del.error ? (
        <Alert variant="danger">
          <AlertDescription>{del.error}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <ListChecks size={15} className="text-muted-foreground" />
            <CardTitle>Tasks</CardTitle>
          </div>
          <CardDescription>
            Units of work in this phase. Their progress rolls up to the figure
            above; milestones count double.
          </CardDescription>
        </CardHeader>
        <CardContent className="py-2">
          {tasks.length === 0 ? (
            <EmptyState
              icon={ListChecks}
              title="No tasks yet"
              description="Break the phase into tasks to roll progress up automatically."
              size="sm"
              action={
                canEdit ? (
                  <Button
                    size="sm"
                    onClick={() => setTaskDialog({ open: true, task: null })}
                  >
                    <Plus size={14} />
                    New task
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {tasks.map((task) => (
                <li
                  key={task.id}
                  className="flex items-start justify-between gap-3 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-[13.5px] font-medium text-foreground">
                      <span className="truncate">{task.name}</span>
                      {task.milestone ? (
                        <Badge variant="info">
                          <Flag size={10} />
                          Milestone
                        </Badge>
                      ) : null}
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11.5px] text-muted-foreground">
                      <Badge variant={taskStatusTone(task.status)}>
                        {TASK_STATUS_LABELS[
                          (task.status as keyof typeof TASK_STATUS_LABELS)
                        ] ?? task.status}
                      </Badge>
                      {task.contractorName ? (
                        <Badge variant="outline">{task.contractorName}</Badge>
                      ) : (
                        <span>Unassigned</span>
                      )}
                      <span>
                        {task.plannedStart || task.plannedEnd
                          ? `${orDash(task.plannedStart ? formatDate(task.plannedStart) : null)} → ${orDash(
                              task.plannedEnd
                                ? formatDate(task.plannedEnd)
                                : null,
                            )}`
                          : "No dates"}
                      </span>
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                      <Progress value={task.progress} className="max-w-40" />
                      <span className="text-[11px] tabular-nums text-muted-foreground">
                        {task.progress}%
                      </span>
                    </div>
                  </div>
                  {canEdit ? (
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => setTaskDialog({ open: true, task })}
                        aria-label={`Edit ${task.name}`}
                      >
                        <Pencil size={13} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => setConfirmDelete(task)}
                        aria-label={`Delete ${task.name}`}
                      >
                        <Trash2 size={13} />
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Site progress log</CardTitle>
          <CardDescription>
            Every report, newest first. The latest one is what the list screens
            read as the site figure.
          </CardDescription>
        </CardHeader>
        <CardContent className="py-2">
          {progressLog.length === 0 ? (
            <p className="py-2 text-[12.5px] text-muted-foreground">
              No progress logged yet.
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {progressLog.map((log) => (
                <li key={log.id} className="flex items-start gap-3 py-2.5">
                  <span className="mt-0.5 w-12 shrink-0 text-right text-[13px] font-semibold tabular-nums text-foreground">
                    {log.percent}%
                  </span>
                  <div className="min-w-0">
                    {log.note ? (
                      <p className="text-[12.5px] text-foreground">
                        {log.note}
                      </p>
                    ) : null}
                    <p className="text-[11px] text-muted-foreground">
                      {log.actorName} · {formatDateTime(log.createdAt)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <PhaseFormDialog
        open={editingPhase}
        projectId={phase.projectId}
        phase={phase}
        onOpenChange={setEditingPhase}
        onSaved={() => {
          void resource.reload()
        }}
      />

      <LogProgressDialog
        open={logging}
        onOpenChange={setLogging}
        phase={phase}
        tasks={tasks}
        onSaved={() => {
          void resource.reload()
        }}
      />

      <TaskDialog
        open={taskDialog.open}
        phaseId={phase.id}
        task={taskDialog.task}
        onOpenChange={(open) =>
          setTaskDialog((current) => ({
            open,
            task: open ? current.task : null,
          }))
        }
        onSaved={() => {
          void resource.reload()
        }}
      />

      <Dialog
        open={confirmDelete !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmDelete(null)
        }}
      >
        <DialogContent className="max-w-[30rem]">
          <DialogHeader>
            <DialogTitle>Delete task</DialogTitle>
            <DialogDescription>
              {confirmDelete
                ? `Remove “${confirmDelete.name}” from this phase? This only succeeds if no spend is tagged to it.`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            {del.fields.taskId ? (
              <Alert variant="danger">
                <AlertDescription>{del.fields.taskId}</AlertDescription>
              </Alert>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmDelete(null)}
              disabled={del.saving}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => confirmDelete && void runDelete(confirmDelete)}
              disabled={del.saving}
            >
              {del.saving ? "Deleting…" : "Delete task"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
