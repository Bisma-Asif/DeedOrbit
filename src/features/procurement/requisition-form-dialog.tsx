/**
 * New / edit a purchase requisition.
 *
 * A requisition is a request for something to be bought, with a justification
 * and a set of lines. Editing is only allowed while it is a draft (the server
 * refuses otherwise), so this dialog never fights the maker-checker queue: once
 * submitted the lines are frozen and the decision happens on the detail page and
 * in the approvals surface. An estimated total is shown live but is only real
 * when every line is priced — a single unpriced line makes the total a dash,
 * because guessing the missing half of an estimate is exactly what the platform
 * refuses to do.
 */

import { useEffect, useMemo, useState } from "react"

import { Plus, Trash2 } from "lucide-react"

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

import { projectsApi } from "@/lib/projects-api"

import {
  procurementApi,
  type RequisitionLineInput,
} from "@/lib/procurement-api"

import { useAsyncResource } from "@/lib/use-async-resource"

import { formatCurrency } from "@/lib/format"

import {
  LINE_QUANTITY_MAX,
  REQUISITION_LINE_MAX,
  UNIT_PRICE_MAX,
  type RequisitionView,
} from "@shared/procurement"

interface RequisitionFormDialogProps {
  open: boolean

  onOpenChange: (open: boolean) => void

  /** Present when editing a draft; omitted/`null` opens create mode. */

  requisition?: RequisitionView | null

  onSaved: (requisition: RequisitionView) => void
}

interface LineDraft {
  description: string

  quantity: string

  unit: string

  unitPrice: string
}

interface ReqDraft {
  justification: string

  neededBy: string

  projectId: string

  currency: string

  lines: LineDraft[]
}

function blankLine(): LineDraft {
  return { description: "", quantity: "", unit: "", unitPrice: "" }
}

function emptyDraft(): ReqDraft {
  return {
    justification: "",

    neededBy: "",

    projectId: "",

    currency: "",

    lines: [blankLine()],
  }
}

function fromRequisition(requisition: RequisitionView): ReqDraft {
  return {
    justification: requisition.justification,

    neededBy: requisition.neededBy?.slice(0, 10) ?? "",

    projectId: requisition.projectId ?? "",

    currency: requisition.currency,

    lines: requisition.lines.map((line) => ({
      description: line.description,

      quantity: String(line.quantity),

      unit: line.unit,

      unitPrice: line.unitPrice === null ? "" : String(line.unitPrice),
    })),
  }
}

function wholeNumber(raw: string, max: number): number | null | undefined {
  const trimmed = raw.trim()

  if (trimmed === "") return undefined

  const parsed = Math.trunc(Number(trimmed))

  return Number.isFinite(parsed) && parsed >= 1 && parsed <= max ? parsed : null
}

function toLines(lines: LineDraft[]): RequisitionLineInput[] {
  return lines.map((line) => {
    const quantity = Math.trunc(Number(line.quantity))

    const priceRaw = line.unitPrice.trim()

    const unitPrice = priceRaw === "" ? null : Math.trunc(Number(priceRaw))

    return {
      description: line.description.trim(),

      quantity: Number.isFinite(quantity) && quantity >= 1 ? quantity : 0,

      unit: line.unit.trim(),

      unitPrice:
        unitPrice !== null && Number.isFinite(unitPrice) ? unitPrice : null,
    }
  })
}

export function RequisitionFormDialog({
  open,

  onOpenChange,

  requisition,

  onSaved,
}: RequisitionFormDialogProps) {
  const editing = requisition ?? null

  const [draft, setDraft] = useState<ReqDraft>(() => emptyDraft())

  const [invalid, setInvalid] = useState<Record<string, string>>({})

  const save = useSave()

  const projects = useAsyncResource(
    (signal) => projectsApi.list(signal),

    open,
  )

  const projectOptions = useMemo(
    () => projects.data?.projects ?? [],

    [projects.data],
  )

  useEffect(() => {
    if (!open) return

    setDraft(editing ? fromRequisition(editing) : emptyDraft())

    setInvalid({})

    save.clear()

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing])

  const estimate = useMemo(() => {
    let total = 0

    for (const line of draft.lines) {
      const quantity = Math.trunc(Number(line.quantity))

      const priceRaw = line.unitPrice.trim()

      if (priceRaw === "") return null

      const price = Math.trunc(Number(priceRaw))

      if (!Number.isFinite(quantity) || !Number.isFinite(price)) return null

      total += quantity * price
    }

    return draft.lines.length > 0 ? total : null
  }, [draft.lines])

  function setLine(index: number, patch: Partial<LineDraft>) {
    setDraft((current) => ({
      ...current,

      lines: current.lines.map((line, i) =>
        i === index ? { ...line, ...patch } : line,
      ),
    }))

    save.clear()
  }

  function addLine() {
    setDraft((current) =>
      current.lines.length >= REQUISITION_LINE_MAX
        ? current
        : { ...current, lines: [...current.lines, blankLine()] },
    )
  }

  function removeLine(index: number) {
    setDraft((current) => ({
      ...current,

      lines:
        current.lines.length === 1
          ? current.lines
          : current.lines.filter((_, i) => i !== index),
    }))
  }

  async function submit() {
    const errors: Record<string, string> = {}

    if (draft.justification.trim() === "") {
      errors.justification = "Say why this is needed."
    }

    if (draft.lines.length === 0) {
      errors.lines = "Add at least one line."
    }

    draft.lines.forEach((line, index) => {
      if (line.description.trim() === "") {
        errors[`line${index}`] = "Describe the line."
      } else if (wholeNumber(line.quantity, LINE_QUANTITY_MAX) === null) {
        errors[`line${index}`] = "Enter a whole quantity."
      } else if (line.unit.trim() === "") {
        errors[`line${index}`] = "Add a unit (e.g. ea, m, kg)."
      } else if (wholeNumber(line.unitPrice, UNIT_PRICE_MAX) === null) {
        errors[`line${index}`] = "Enter a whole unit price, or leave it blank."
      }
    })

    if (Object.keys(errors).length > 0) {
      setInvalid(errors)

      return
    }

    setInvalid({})

    const lines = toLines(draft.lines)

    const done = await save.run(async () => {
      const result = editing
        ? await procurementApi.updateRequisition(editing.id, {
            justification: draft.justification.trim(),

            neededBy: draft.neededBy || null,

            lines,
          })
        : await procurementApi.createRequisition({
            justification: draft.justification.trim(),

            neededBy: draft.neededBy || null,

            projectId: draft.projectId || null,

            currency: draft.currency.trim().toUpperCase() || undefined,

            lines,
          })

      onSaved(result.requisition)
    })

    if (done) onOpenChange(false)
  }

  const errorFor = (key: string) => invalid[key] ?? save.fields[key]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[46rem]">
        <DialogHeader>
          <DialogTitle>
            {editing ? "Edit requisition" : "New requisition"}
          </DialogTitle>
          <DialogDescription>
            Request what needs buying. Only a draft can be edited here — once
            submitted the lines freeze and the decision runs through approvals.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-3">
          {save.error ? (
            <Alert variant="danger">
              <AlertDescription>{save.error}</AlertDescription>
            </Alert>
          ) : null}

          <Field
            label="Justification"
            htmlFor="req-justification"
            required
            error={errorFor("justification")}
          >
            <Textarea
              id="req-justification"
              rows={2}
              value={draft.justification}
              onChange={(event) => {
                setDraft((current) => ({
                  ...current,

                  justification: event.target.value,
                }))

                save.clear()
              }}
              placeholder="What is needed and why."
            />
          </Field>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Needed by" htmlFor="req-needed">
              <Input
                id="req-needed"
                type="date"
                value={draft.neededBy}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,

                    neededBy: event.target.value,
                  }))
                }
              />
            </Field>

            <Field
              label="Currency"
              htmlFor="req-currency"
              hint="Blank uses your workspace currency."
              error={errorFor("currency")}
            >
              <Input
                id="req-currency"
                maxLength={3}
                disabled={Boolean(editing)}
                value={draft.currency}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,

                    currency: event.target.value.toUpperCase(),
                  }))
                }
                placeholder="AED"
              />
            </Field>

            {!editing ? (
              <Field label="Project (optional)" htmlFor="req-project">
                <Select
                  value={draft.projectId || "__none"}
                  onValueChange={(value) =>
                    setDraft((current) => ({
                      ...current,

                      projectId: value === "__none" ? "" : value,
                    }))
                  }
                >
                  <SelectTrigger id="req-project">
                    <SelectValue placeholder="Not tied to a project" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">
                      Not tied to a project
                    </SelectItem>
                    {projectOptions.map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                Lines
              </p>
              <Button variant="outline" size="sm" onClick={addLine}>
                <Plus size={13} />
                Add line
              </Button>
            </div>

            {errorFor("lines") ? (
              <p className="text-[11.5px] font-medium text-danger">
                {errorFor("lines")}
              </p>
            ) : null}

            <div className="flex flex-col gap-2">
              {draft.lines.map((line, index) => (
                <div
                  key={index}
                  className="grid grid-cols-1 items-start gap-2 rounded-md border border-border p-2 sm:grid-cols-[minmax(0,2fr)_70px_70px_90px_28px]"
                >
                  <Input
                    aria-label={`Line ${index + 1} description`}
                    placeholder="Description"
                    value={line.description}
                    onChange={(event) =>
                      setLine(index, { description: event.target.value })
                    }
                  />

                  <Input
                    aria-label={`Line ${index + 1} quantity`}
                    type="number"
                    min={1}
                    step={1}
                    inputMode="numeric"
                    placeholder="Qty"
                    value={line.quantity}
                    onChange={(event) =>
                      setLine(index, { quantity: event.target.value })
                    }
                  />

                  <Input
                    aria-label={`Line ${index + 1} unit`}
                    placeholder="Unit"
                    value={line.unit}
                    onChange={(event) =>
                      setLine(index, { unit: event.target.value })
                    }
                  />

                  <Input
                    aria-label={`Line ${index + 1} unit price`}
                    type="number"
                    min={1}
                    step={1}
                    inputMode="numeric"
                    placeholder="Price"
                    value={line.unitPrice}
                    onChange={(event) =>
                      setLine(index, { unitPrice: event.target.value })
                    }
                  />

                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => removeLine(index)}
                    disabled={draft.lines.length === 1}
                    aria-label={`Remove line ${index + 1}`}
                  >
                    <Trash2 size={13} />
                  </Button>

                  {errorFor(`line${index}`) ? (
                    <p className="col-span-full text-[11.5px] font-medium text-danger">
                      {errorFor(`line${index}`)}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          </div>

          <p className="text-right text-[12.5px] text-muted-foreground">
            Estimated total:{" "}
            <span className="font-semibold tabular-nums text-foreground">
              {estimate === null
                ? "—"
                : formatCurrency(estimate, draft.currency || "AED", {
                    maximumFractionDigits: 0,
                  })}
            </span>
            {estimate === null &&
            draft.lines.some((l) => l.unitPrice.trim() === "")
              ? " (price every line to estimate)"
              : ""}
          </p>
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={save.saving}>
            {save.saving
              ? "Saving…"
              : editing
                ? "Save requisition"
                : "Create requisition"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
