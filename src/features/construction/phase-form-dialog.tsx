/**
 * New / edit a construction phase.
 *
 * A phase is a plan: a name, an order, a window, and (optionally) a budget.
 * None of the money the overview shows is entered here — the actuals are
 * derived from ledger rows tagged to the phase, so this dialog only records
 * the intended budget and the dates. On edit the status joins the fields,
 * because retiring a phase is done by moving it to `on_hold`/`completed`
 * rather than deleting it (the evidence stays).
 *
 * The budget is a whole-unit amount and a three-letter currency; the currency
 * only means something once an amount exists, so it is disabled until then.
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

import { useSave } from "@/features/organization/use-save"

import { constructionApi } from "@/lib/construction-api"

import {
  MONEY_MAX,
  PHASE_NAME_MAX,
  PHASE_STATUSES,
  PHASE_STATUS_LABELS,
  type ConstructionPhaseView,
  type PhaseStatus,
} from "@shared/construction"

interface PhaseFormDialogProps {
  open: boolean

  onOpenChange: (open: boolean) => void

  /** The project a new phase is created under; ignored when editing. */

  projectId: string

  /** Present when editing an existing phase; `null`/omitted opens create mode. */

  phase?: ConstructionPhaseView | null

  onSaved: (phase: ConstructionPhaseView) => void
}

interface PhaseDraft {
  name: string

  sequence: string

  status: PhaseStatus

  plannedStart: string

  plannedEnd: string

  budgetAmount: string

  budgetCurrency: string
}

function emptyDraft(): PhaseDraft {
  return {
    name: "",

    sequence: "",

    status: "pending",

    plannedStart: "",

    plannedEnd: "",

    budgetAmount: "",

    budgetCurrency: "",
  }
}

function fromPhase(phase: ConstructionPhaseView): PhaseDraft {
  return {
    name: phase.name,

    sequence: String(phase.sequence),

    status: phase.status as PhaseStatus ?? "pending",

    plannedStart: phase.plannedStart?.slice(0, 10) ?? "",

    plannedEnd: phase.plannedEnd?.slice(0, 10) ?? "",

    budgetAmount: phase.budgetAmount === null ? "" : String(phase.budgetAmount),

    budgetCurrency: phase.budgetCurrency ?? "",
  }
}

function wholeNumber(raw: string): number | null {
  const trimmed = raw.trim()

  if (trimmed === "") return null

  const parsed = Math.trunc(Number(trimmed))

  return Number.isFinite(parsed) && parsed >= 1 ? parsed : null
}

export function PhaseFormDialog({
  open,

  onOpenChange,

  projectId,

  phase,

  onSaved,
}: PhaseFormDialogProps) {
  const editing = phase ?? null

  const [draft, setDraft] = useState<PhaseDraft>(() => emptyDraft())

  const [invalid, setInvalid] = useState<Record<string, string>>({})

  const save = useSave()

  useEffect(() => {
    if (!open) return

    setDraft(editing ? fromPhase(editing) : emptyDraft())

    setInvalid({})

    save.clear()

    // `save` is stable; listing it in the deps would loop the reset.

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing])

  const canSubmit = useMemo(() => draft.name.trim() !== "", [draft.name])

  function set<K extends keyof PhaseDraft>(key: K, value: PhaseDraft[K]) {
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
      errors.name = "Name this phase."
    } else if (draft.name.length > PHASE_NAME_MAX) {
      errors.name = `Use ${PHASE_NAME_MAX} characters or fewer.`
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

    const plannedStart = draft.plannedStart || null

    const plannedEnd = draft.plannedEnd || null

    const budgetCurrency =
      budgetAmount === null
        ? null
        : draft.budgetCurrency.trim().toUpperCase() || null

    const done = await save.run(async () => {
      const result = editing
        ? await constructionApi.updatePhase(editing.id, {
            name: draft.name.trim(),

            status: draft.status,

            plannedStart,

            plannedEnd,

            budgetAmount: budgetAmount ?? null,

            budgetCurrency,
          })
        : await constructionApi.createPhase({
            projectId,

            name: draft.name.trim(),

            sequence: wholeNumber(draft.sequence) ?? undefined,

            plannedStart,

            plannedEnd,

            budgetAmount: budgetAmount ?? undefined,

            budgetCurrency: budgetAmount === null ? undefined : budgetCurrency,
          })

      onSaved(result.phase)
    })

    if (done) onOpenChange(false)
  }

  const errorFor = (key: string) => invalid[key] ?? save.fields[key]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[38rem]">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit phase" : "New phase"}</DialogTitle>
          <DialogDescription>
            A phase carries a plan — a name, a window, a budget. Its actual
            spend is read from ledger rows tagged to it, never typed here.
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
            htmlFor="phase-name"
            required
            error={errorFor("name")}
          >
            <Input
              id="phase-name"
              maxLength={PHASE_NAME_MAX}
              value={draft.name}
              onChange={(event) => set("name", event.target.value)}
              placeholder="e.g. Substructure — Block A"
            />
          </Field>

          <FieldGrid>
            {editing ? (
              <Field label="Status" htmlFor="phase-status">
                <Select
                  value={draft.status}
                  onValueChange={(value) => set("status", value as PhaseStatus)}
                >
                  <SelectTrigger id="phase-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PHASE_STATUSES.map((status) => (
                      <SelectItem key={status} value={status}>
                        {PHASE_STATUS_LABELS[status]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            ) : (
              <Field
                label="Sequence (optional)"
                htmlFor="phase-sequence"
                hint="Leave blank to append after the existing phases."
                error={errorFor("sequence")}
              >
                <Input
                  id="phase-sequence"
                  type="number"
                  min={1}
                  step={1}
                  inputMode="numeric"
                  value={draft.sequence}
                  onChange={(event) => set("sequence", event.target.value)}
                />
              </Field>
            )}

            <Field
              label="Planned start"
              htmlFor="phase-start"
              error={errorFor("plannedStart")}
            >
              <Input
                id="phase-start"
                type="date"
                value={draft.plannedStart}
                onChange={(event) => set("plannedStart", event.target.value)}
              />
            </Field>

            <Field
              label="Planned end"
              htmlFor="phase-end"
              error={errorFor("plannedEnd")}
            >
              <Input
                id="phase-end"
                type="date"
                value={draft.plannedEnd}
                onChange={(event) => set("plannedEnd", event.target.value)}
              />
            </Field>
          </FieldGrid>

          <FieldGrid>
            <Field
              label="Budget (optional)"
              htmlFor="phase-budget"
              hint="A whole amount. Actual spend is derived, so leave this blank if unplanned."
              error={errorFor("budgetAmount")}
            >
              <Input
                id="phase-budget"
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                value={draft.budgetAmount}
                onChange={(event) => set("budgetAmount", event.target.value)}
              />
            </Field>

            <Field
              label="Currency"
              htmlFor="phase-currency"
              hint={
                budgetAmountOf(draft) === null
                  ? "Set a budget to choose a currency."
                  : "Three-letter code, e.g. AED."
              }
              error={errorFor("budgetCurrency")}
            >
              <Input
                id="phase-currency"
                maxLength={3}
                disabled={budgetAmountOf(draft) === null}
                value={draft.budgetCurrency}
                onChange={(event) =>
                  set("budgetCurrency", event.target.value.toUpperCase())
                }
                placeholder="AED"
              />
            </Field>
          </FieldGrid>
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={save.saving || !canSubmit}
          >
            {save.saving ? "Saving…" : editing ? "Save phase" : "Create phase"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** The parsed budget, so the currency field knows whether it is meaningful. */

function budgetAmountOf(draft: PhaseDraft): number | null {
  return wholeNumber(draft.budgetAmount)
}
