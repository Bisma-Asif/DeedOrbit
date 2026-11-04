/**
 * New / edit a construction task.
 *
 * A task carries its own progress percent; the phase's derived figure is the
 * rollup of these (milestones weighted double). On edit the status and the
 * percent move together — a completed task reads 100 — because the server
 * refuses the mismatch rather than storing two truths, so the dialog keeps them
 * consistent instead of letting them drift.
 */

import { useEffect, useMemo, useState } from "react"

import { Alert, AlertDescription } from "@/components/ui/alert"

import { Button } from "@/components/ui/button"

import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

import { Field, FieldGrid } from "@/components/field"

import { Input } from "@/components/ui/input"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

import { Textarea } from "@/components/ui/textarea"

import { useSave } from "@/features/organization/use-save"

import { constructionApi } from "@/lib/construction-api"

import { useAsyncResource } from "@/lib/use-async-resource"

import {
  MONEY_MAX,
  NOTE_MAX,
  PROGRESS_MAX,
  PROGRESS_MIN,
  TASK_NAME_MAX,
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  type ConstructionTaskView,
  type TaskStatus,
} from "@shared/construction"

interface TaskDialogProps {
  open: boolean

  onOpenChange: (open: boolean) => void

  phaseId: string

  /** Present when editing; omitted/`null` opens create mode. */

  task?: ConstructionTaskView | null

  onSaved: () => void
}

interface TaskDraft {
  name: string

  description: string

  status: TaskStatus

  progress: string

  milestone: boolean

  plannedStart: string

  plannedEnd: string

  actualStart: string

  actualEnd: string

  contractorId: string

  budgetAmount: string
}

function emptyDraft(): TaskDraft {
  return {
    name: "",

    description: "",

    status: "pending",

    progress: "0",

    milestone: false,

    plannedStart: "",

    plannedEnd: "",

    actualStart: "",

    actualEnd: "",

    contractorId: "",

    budgetAmount: "",
  }
}

function fromTask(task: ConstructionTaskView): TaskDraft {
  return {
    name: task.name,

    description: task.description ?? "",

    status: task.status as TaskStatus ?? "pending",

    progress: String(task.progress),

    milestone: task.milestone,

    plannedStart: task.plannedStart?.slice(0, 10) ?? "",

    plannedEnd: task.plannedEnd?.slice(0, 10) ?? "",

    actualStart: task.actualStart?.slice(0, 10) ?? "",

    actualEnd: task.actualEnd?.slice(0, 10) ?? "",

    contractorId: task.contractorId ?? "",

    budgetAmount: task.budgetAmount === null ? "" : String(task.budgetAmount),
  }
}

function wholeNumber(raw: string): number | null {
  const trimmed = raw.trim()

  if (trimmed === "") return null

  const parsed = Math.trunc(Number(trimmed))

  return Number.isFinite(parsed) && parsed >= 1 ? parsed : null
}

export function TaskDialog({
  open,

  onOpenChange,

  phaseId,

  task,

  onSaved,
}: TaskDialogProps) {
  const editing = task ?? null

  const [draft, setDraft] = useState<TaskDraft>(() => emptyDraft())

  const [invalid, setInvalid] = useState<Record<string, string>>({})

  const save = useSave()

  const contractors = useAsyncResource(
    (signal) => constructionApi.listContractors(signal),

    open,
  )

  const contractorOptions = useMemo(
    () =>
      (contractors.data?.contractors ?? []).filter(
        (c) => c.status === "active",
      ),

    [contractors.data],
  )

  useEffect(() => {
    if (!open) return

    setDraft(editing ? fromTask(editing) : emptyDraft())

    setInvalid({})

    save.clear()

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing])

  function set<K extends keyof TaskDraft>(key: K, value: TaskDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }))

    setInvalid((current) => {
      if (!(key in current)) return current

      const next = { ...current }

      delete next[key]

      return next
    })

    save.clear()
  }

  async function submit() {
    const errors: Record<string, string> = {}

    if (draft.name.trim() === "") {
      errors.name = "Name this task."
    } else if (draft.name.length > TASK_NAME_MAX) {
      errors.name = `Use ${TASK_NAME_MAX} characters or fewer.`
    }

    const progressValue = (() => {
      const raw = draft.progress.trim()

      if (raw === "") return null

      const value = Math.trunc(Number(raw))

      return Number.isFinite(value) &&
        value >= PROGRESS_MIN &&
        value <= PROGRESS_MAX
        ? value
        : undefined
    })()

    if (!editing && progressValue === null) {
      errors.progress = `Use a whole percent between ${PROGRESS_MIN} and ${PROGRESS_MAX}.`
    } else if (editing && progressValue === undefined) {
      errors.progress = `Use a whole percent between ${PROGRESS_MIN} and ${PROGRESS_MAX}.`
    }

    const budgetAmount = wholeNumber(draft.budgetAmount)

    if (draft.budgetAmount.trim() !== "" && budgetAmount === null) {
      errors.budgetAmount = `Enter a whole number from 1 to ${MONEY_MAX}.`
    }

    if (Object.keys(errors).length > 0) {
      setInvalid(errors)

      return
    }

    setInvalid({})

    const description = draft.description.trim() || null

    const contractorId = draft.contractorId === "" ? null : draft.contractorId

    const milestone = draft.milestone

    // A completed task always reads 100 — the server refuses the mismatch, so

    // the dialog resolves it instead of shipping a rejected pair.

    const progress = draft.status === "completed" ? 100 : progressValue

    const done = await save.run(async () => {
      if (editing) {
        await constructionApi.updateTask(editing.id, {
          name: draft.name.trim(),

          description,

          status: draft.status,

          progress: progress ?? undefined,

          milestone,

          contractorId,

          plannedStart: draft.plannedStart || null,

          plannedEnd: draft.plannedEnd || null,

          actualStart: draft.actualStart || null,

          actualEnd: draft.actualEnd || null,

          budgetAmount: budgetAmount ?? null,
        })
      } else {
        await constructionApi.createTask(phaseId, {
          name: draft.name.trim(),

          description,

          milestone,

          plannedStart: draft.plannedStart || null,

          plannedEnd: draft.plannedEnd || null,

          contractorId,

          budgetAmount: budgetAmount ?? undefined,
        })
      }

      onSaved()
    })

    if (done) onOpenChange(false)
  }

  const errorFor = (key: string) => invalid[key] ?? save.fields[key]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[40rem]">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit task" : "New task"}</DialogTitle>
          <DialogDescription>
            A unit of work inside the phase. Its progress feeds the phase
            rollup; milestones count double.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-3">
          {save.error ? (
            <Alert variant="danger">
              <AlertDescription>{save.error}</AlertDescription>
            </Alert>
          ) : null}

          <Field
            label="Name"
            htmlFor="task-name"
            required
            error={errorFor("name")}
          >
            <Input
              id="task-name"
              maxLength={TASK_NAME_MAX}
              value={draft.name}
              onChange={(event) => set("name", event.target.value)}
            />
          </Field>

          <Field
            label="Description"
            htmlFor="task-description"
            error={errorFor("description")}
          >
            <Textarea
              id="task-description"
              rows={2}
              maxLength={NOTE_MAX}
              value={draft.description}
              onChange={(event) => set("description", event.target.value)}
            />
          </Field>

          {editing ? (
            <FieldGrid>
              <Field label="Status" htmlFor="task-status">
                <Select
                  value={draft.status}
                  onValueChange={(value) => {
                    const next = value as TaskStatus

                    setDraft((current) => ({
                      ...current,

                      status: next,

                      progress: next === "completed" ? "100" : current.progress,
                    }))

                    save.clear()
                  }}
                >
                  <SelectTrigger id="task-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TASK_STATUSES.map((status) => (
                      <SelectItem key={status} value={status}>
                        {TASK_STATUS_LABELS[status]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field
                label="Progress %"
                htmlFor="task-progress"
                hint={
                  draft.status === "completed"
                    ? "A completed task reads 100."
                    : undefined
                }
                error={errorFor("progress")}
              >
                <Input
                  id="task-progress"
                  type="number"
                  min={PROGRESS_MIN}
                  max={PROGRESS_MAX}
                  step={1}
                  inputMode="numeric"
                  disabled={draft.status === "completed"}
                  value={draft.progress}
                  onChange={(event) => set("progress", event.target.value)}
                />
              </Field>
            </FieldGrid>
          ) : null}

          <FieldGrid>
            <Field
              label="Contractor"
              htmlFor="task-contractor"
              error={errorFor("contractorId")}
            >
              <Select
                value={draft.contractorId || "__none"}
                onValueChange={(value) =>
                  set("contractorId", value === "__none" ? "" : value)
                }
              >
                <SelectTrigger id="task-contractor">
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">Unassigned</SelectItem>
                  {contractorOptions.map((contractor) => (
                    <SelectItem key={contractor.id} value={contractor.id}>
                      {contractor.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field
              label="Budget (optional)"
              htmlFor="task-budget"
              hint="A planned whole amount for this task."
              error={errorFor("budgetAmount")}
            >
              <Input
                id="task-budget"
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                value={draft.budgetAmount}
                onChange={(event) => set("budgetAmount", event.target.value)}
              />
            </Field>
          </FieldGrid>

          <FieldGrid>
            <Field
              label="Planned start"
              htmlFor="task-planned-start"
              error={errorFor("plannedStart")}
            >
              <Input
                id="task-planned-start"
                type="date"
                value={draft.plannedStart}
                onChange={(event) => set("plannedStart", event.target.value)}
              />
            </Field>

            <Field
              label="Planned end"
              htmlFor="task-planned-end"
              error={errorFor("plannedEnd")}
            >
              <Input
                id="task-planned-end"
                type="date"
                value={draft.plannedEnd}
                onChange={(event) => set("plannedEnd", event.target.value)}
              />
            </Field>
          </FieldGrid>

          {editing ? (
            <FieldGrid>
              <Field
                label="Actual start"
                htmlFor="task-actual-start"
                error={errorFor("actualStart")}
              >
                <Input
                  id="task-actual-start"
                  type="date"
                  value={draft.actualStart}
                  onChange={(event) => set("actualStart", event.target.value)}
                />
              </Field>

              <Field
                label="Actual end"
                htmlFor="task-actual-end"
                error={errorFor("actualEnd")}
              >
                <Input
                  id="task-actual-end"
                  type="date"
                  value={draft.actualEnd}
                  onChange={(event) => set("actualEnd", event.target.value)}
                />
              </Field>
            </FieldGrid>
          ) : null}

          <label className="flex items-center gap-2 text-[12.5px] text-foreground">
            <input
              type="checkbox"
              className="size-4 accent-emerald-600"
              checked={draft.milestone}
              onChange={(event) => set("milestone", event.target.checked)}
            />
            Milestone — weighted double in the phase rollup
          </label>
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={save.saving}>
            {save.saving ? "Saving…" : editing ? "Save task" : "Add task"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
