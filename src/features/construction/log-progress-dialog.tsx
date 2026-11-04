/**
 * Log a site-progress report against a phase.
 *
 * This is the one place a manager's own number enters the module: the percent
 * becomes the latest manual figure and an append-only log row in the same
 * server transaction. Where the phase has tasks, the rollup still speaks louder
 * than this figure on the overview — the screen labels which mode is in play —
 * so the dialog says so rather than implying the number is final.
 */

import { useEffect, useState } from "react"

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

import { Field } from "@/components/field"

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

import {
  NOTE_MAX,
  PROGRESS_MAX,
  PROGRESS_MIN,
  type ConstructionPhaseView,
  type ConstructionTaskView,
} from "@shared/construction"

interface LogProgressDialogProps {
  open: boolean

  onOpenChange: (open: boolean) => void

  phase: ConstructionPhaseView

  tasks: ConstructionTaskView[]

  onSaved: () => void
}

export function LogProgressDialog({
  open,

  onOpenChange,

  phase,

  tasks,

  onSaved,
}: LogProgressDialogProps) {
  const [percent, setPercent] = useState("")

  const [note, setNote] = useState("")

  const [taskId, setTaskId] = useState("")

  const [invalid, setInvalid] = useState<Record<string, string>>({})

  const save = useSave()

  useEffect(() => {
    if (!open) return

    setPercent("")

    setNote("")

    setTaskId("")

    setInvalid({})

    save.clear()

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const parsed = (() => {
    const raw = percent.trim()

    if (raw === "") return null

    const value = Math.trunc(Number(raw))

    return Number.isFinite(value) &&
      value >= PROGRESS_MIN &&
      value <= PROGRESS_MAX
      ? value
      : undefined
  })()

  async function submit() {
    const errors: Record<string, string> = {}

    if (parsed === null || parsed === undefined) {
      errors.percent = `Use a whole percent between ${PROGRESS_MIN} and ${PROGRESS_MAX}.`
    }

    if (Object.keys(errors).length > 0) {
      setInvalid(errors)

      return
    }

    setInvalid({})

    const done = await save.run(async () => {
      await constructionApi.logProgress(phase.id, {
        percent: parsed as number,

        note: note.trim() || null,

        taskId: taskId === "" ? null : taskId,
      })
    })

    if (done) {
      onSaved()

      onOpenChange(false)
    }
  }

  const errorFor = (key: string) => invalid[key] ?? save.fields[key]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[34rem]">
        <DialogHeader>
          <DialogTitle>Log site progress</DialogTitle>
          <DialogDescription>
            Record what the site reports today. Where this phase has tasks, the
            task rollup still leads on the overview — this is the manager's own
            figure, kept in the history.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-3">
          {save.error ? (
            <Alert variant="danger">
              <AlertDescription>{save.error}</AlertDescription>
            </Alert>
          ) : null}

          <Field
            label="Percent complete"
            htmlFor="progress-percent"
            required
            error={errorFor("percent")}
          >
            <Input
              id="progress-percent"
              type="number"
              min={PROGRESS_MIN}
              max={PROGRESS_MAX}
              step={1}
              inputMode="numeric"
              value={percent}
              onChange={(event) => {
                setPercent(event.target.value)

                setInvalid((current) => {
                  if (!("percent" in current)) return current

                  const next = { ...current }

                  delete next.percent

                  return next
                })

                save.clear()
              }}
            />
          </Field>

          {tasks.length > 0 ? (
            <Field
              label="Against a task (optional)"
              htmlFor="progress-task"
              hint="Ties this report to one task; the phase figure still reads across all of them."
            >
              <Select
                value={taskId || "__none"}
                onValueChange={(value) =>
                  setTaskId(value === "__none" ? "" : value)
                }
              >
                <SelectTrigger id="progress-task">
                  <SelectValue placeholder="Whole phase" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">Whole phase</SelectItem>
                  {tasks.map((task) => (
                    <SelectItem key={task.id} value={task.id}>
                      {task.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : null}

          <Field label="Note" htmlFor="progress-note" error={errorFor("note")}>
            <Textarea
              id="progress-note"
              rows={3}
              maxLength={NOTE_MAX}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="What moved, what is holding, what is next."
            />
          </Field>
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={save.saving || parsed === null || parsed === undefined}
          >
            {save.saving ? "Saving…" : "Log progress"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
