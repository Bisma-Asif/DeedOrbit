/**
 * The two materials dialogs.
 *
 * `MaterialFormDialog` creates or edits the master: an SKU, a name, a category,
 * a unit, an optional target floor, and notes. The SKU is fixed at creation —
 * it is the identifier other rows point at — and stock is never a field,
 * because on-hand is the SUM of movements, not something to type.
 *
 * `StockAdjustDialog` is the one way a quantity moves outside a goods receipt.
 * A movement is a recorded fact with a direction (a signed quantity: negative
 * reduces stock, positive increases it), and a correction is always a *new*
 * signed row rather than an edit of an old one. An adjustment must say why.
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

import { procurementApi } from "@/lib/procurement-api"

import { projectsApi } from "@/lib/projects-api"

import { useAsyncResource } from "@/lib/use-async-resource"

import {
  LINE_QUANTITY_MAX,
  MATERIAL_CATEGORIES,
  MATERIAL_CATEGORY_LABELS,
  MOVEMENT_TYPES,
  type MaterialCategory,
  type MaterialView,
  type MovementType,
} from "@shared/procurement"

const ADJUST_TYPES: MovementType[] = MOVEMENT_TYPES.filter(
  (type) => type !== "receipt",
)

interface MaterialFormDialogProps {
  open: boolean

  onOpenChange: (open: boolean) => void

  material?: MaterialView | null

  onSaved: (material: MaterialView) => void
}

interface MaterialDraft {
  sku: string

  name: string

  category: MaterialCategory

  unitOfMeasure: string

  targetStock: string

  notes: string

  status: string
}

function emptyMaterial(): MaterialDraft {
  return {
    sku: "",

    name: "",

    category: "material",

    unitOfMeasure: "",

    targetStock: "",

    notes: "",

    status: "active",
  }
}

function fromMaterial(material: MaterialView): MaterialDraft {
  return {
    sku: material.sku,

    name: material.name,

    category: material.category as MaterialCategory ?? "material",

    unitOfMeasure: material.unitOfMeasure,

    targetStock:
      material.targetStock === null ? "" : String(material.targetStock),

    notes: material.notes ?? "",

    status: material.status,
  }
}

export function MaterialFormDialog({
  open,

  onOpenChange,

  material,

  onSaved,
}: MaterialFormDialogProps) {
  const editing = material ?? null

  const [draft, setDraft] = useState<MaterialDraft>(() => emptyMaterial())

  const [invalid, setInvalid] = useState<Record<string, string>>({})

  const save = useSave()

  useEffect(() => {
    if (!open) return

    setDraft(editing ? fromMaterial(editing) : emptyMaterial())

    setInvalid({})

    save.clear()

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing])

  function set<K extends keyof MaterialDraft>(key: K, value: MaterialDraft[K]) {
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

    if (!editing && draft.sku.trim() === "") errors.sku = "Give this an SKU."

    if (draft.name.trim() === "") errors.name = "Name the material."

    if (draft.unitOfMeasure.trim() === "")
      errors.unitOfMeasure = "Add a unit (e.g. ea, m, kg)."

    const targetRaw = draft.targetStock.trim()

    const target =
      targetRaw === ""
        ? null
        : Number.isSafeInteger(Number(targetRaw))
          ? Number(targetRaw)
          : undefined

    if (target === undefined)
      errors.targetStock = "Use a whole number, or leave it blank."

    if (Object.keys(errors).length > 0) {
      setInvalid(errors)

      return
    }

    setInvalid({})

    const done = await save.run(async () => {
      const result = editing
        ? await procurementApi.updateMaterial(editing.id, {
            name: draft.name.trim(),

            category: draft.category,

            unitOfMeasure: draft.unitOfMeasure.trim(),

            status: draft.status,

            targetStock: target,

            notes: draft.notes.trim() || null,
          })
        : await procurementApi.createMaterial({
            sku: draft.sku.trim(),

            name: draft.name.trim(),

            category: draft.category,

            unitOfMeasure: draft.unitOfMeasure.trim(),

            targetStock: target,

            notes: draft.notes.trim() || null,
          })

      onSaved(result.material)
    })

    if (done) onOpenChange(false)
  }

  const errorFor = (key: string) => invalid[key] ?? save.fields[key]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[36rem]">
        <DialogHeader>
          <DialogTitle>
            {editing ? "Edit material" : "New material"}
          </DialogTitle>
          <DialogDescription>
            The stock master. On-hand is never typed here — it is the sum of
            this material's movements.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-3">
          {save.error ? (
            <Alert variant="danger">
              <AlertDescription>{save.error}</AlertDescription>
            </Alert>
          ) : null}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field
              label="SKU"
              htmlFor="material-sku"
              required={!editing}
              hint={editing ? "The SKU is fixed once created." : undefined}
              error={errorFor("sku")}
            >
              <Input
                id="material-sku"
                disabled={Boolean(editing)}
                value={draft.sku}
                onChange={(event) => set("sku", event.target.value)}
              />
            </Field>

            <Field
              label="Name"
              htmlFor="material-name"
              required
              error={errorFor("name")}
            >
              <Input
                id="material-name"
                value={draft.name}
                onChange={(event) => set("name", event.target.value)}
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Category" htmlFor="material-category">
              <Select
                value={draft.category}
                onValueChange={(value) =>
                  set("category", value as MaterialCategory)
                }
              >
                <SelectTrigger id="material-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MATERIAL_CATEGORIES.map((category) => (
                    <SelectItem key={category} value={category}>
                      {MATERIAL_CATEGORY_LABELS[category]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field
              label="Unit of measure"
              htmlFor="material-unit"
              required
              error={errorFor("unitOfMeasure")}
            >
              <Input
                id="material-unit"
                value={draft.unitOfMeasure}
                onChange={(event) => set("unitOfMeasure", event.target.value)}
                placeholder="ea"
              />
            </Field>
          </div>

          <Field
            label="Target stock (optional)"
            htmlFor="material-target"
            hint="A floor for the below-target flag. Blank means no target — a dash, not zero."
            error={errorFor("targetStock")}
          >
            <Input
              id="material-target"
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              value={draft.targetStock}
              onChange={(event) => set("targetStock", event.target.value)}
            />
          </Field>

          {editing ? (
            <Field label="Status" htmlFor="material-status">
              <Select
                value={draft.status}
                onValueChange={(value) => set("status", value)}
              >
                <SelectTrigger id="material-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>

                  <SelectItem value="archived">Archived</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          ) : null}

          <Field
            label="Notes"
            htmlFor="material-notes"
            error={errorFor("notes")}
          >
            <Textarea
              id="material-notes"
              rows={2}
              maxLength={500}
              value={draft.notes}
              onChange={(event) => set("notes", event.target.value)}
            />
          </Field>
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={save.saving}>
            {save.saving
              ? "Saving…"
              : editing
                ? "Save material"
                : "Create material"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface StockAdjustDialogProps {
  open: boolean

  onOpenChange: (open: boolean) => void

  material: MaterialView

  onSaved: () => void
}

function signedQuantity(raw: string): number | null | undefined {
  const trimmed = raw.trim()

  if (trimmed === "") return null

  const parsed = Number(trimmed)

  return Number.isSafeInteger(parsed) &&
    parsed !== 0 &&
    Math.abs(parsed) <= LINE_QUANTITY_MAX
    ? parsed
    : undefined
}

export function StockAdjustDialog({
  open,

  onOpenChange,

  material,

  onSaved,
}: StockAdjustDialogProps) {
  const [type, setType] = useState<MovementType>("issue")

  const [quantity, setQuantity] = useState("")

  const [note, setNote] = useState("")

  const [projectId, setProjectId] = useState("")

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

    setType("issue")

    setQuantity("")

    setNote("")

    setProjectId("")

    setInvalid({})

    save.clear()

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const parsed = signedQuantity(quantity)

  const preview =
    parsed === null || parsed === undefined
      ? null
      : material.currentStock + parsed

  async function submit() {
    const errors: Record<string, string> = {}

    const value = signedQuantity(quantity)

    if (value === null) {
      errors.quantity = "Enter a whole, non-zero quantity."
    } else if (value === undefined) {
      errors.quantity = "Use a whole number within the platform maximum."
    }

    if (note.trim() === "" && type === "adjustment") {
      errors.note = "Say why the count is being corrected."
    }

    if (Object.keys(errors).length > 0) {
      setInvalid(errors)

      return
    }

    setInvalid({})

    const done = await save.run(async () => {
      await procurementApi.adjustStock(material.id, {
        type,

        quantity: value as number,

        note: note.trim() || null,

        projectId: projectId || null,
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
      <DialogContent className="max-w-[32rem]">
        <DialogHeader>
          <DialogTitle>Adjust stock</DialogTitle>
          <DialogDescription>
            {material.name} — on-hand {material.currentStock}{" "}
            {material.unitOfMeasure}. A movement is recorded with its direction;
            on-hand becomes the sum.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-3">
          {save.error ? (
            <Alert variant="danger">
              <AlertDescription>{save.error}</AlertDescription>
            </Alert>
          ) : null}

          <Field label="Movement" htmlFor="adjust-type">
            <Select
              value={type}
              onValueChange={(value) => setType(value as MovementType)}
            >
              <SelectTrigger id="adjust-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ADJUST_TYPES.map((movement) => (
                  <SelectItem key={movement} value={movement}>
                    {movement[0]!.toUpperCase() + movement.slice(1)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field
            label="Quantity"
            htmlFor="adjust-quantity"
            required
            hint="Negative reduces stock, positive increases it."
            error={errorFor("quantity")}
          >
            <Input
              id="adjust-quantity"
              type="number"
              step={1}
              value={quantity}
              onChange={(event) => {
                setQuantity(event.target.value)

                setInvalid((current) => {
                  if (!("quantity" in current)) return current

                  const next = { ...current }

                  delete next.quantity

                  return next
                })

                save.clear()
              }}
            />
          </Field>

          {preview !== null ? (
            <p className="text-[12px] text-muted-foreground">
              New on-hand:{" "}
              <span className="font-semibold tabular-nums text-foreground">
                {preview} {material.unitOfMeasure}
              </span>
            </p>
          ) : null}

          <Field
            label="Note"
            htmlFor="adjust-note"
            required={type === "adjustment"}
            error={errorFor("note")}
          >
            <Textarea
              id="adjust-note"
              rows={2}
              maxLength={500}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </Field>

          <Field label="Project (optional)" htmlFor="adjust-project">
            <Select
              value={projectId || "__none"}
              onValueChange={(value) =>
                setProjectId(value === "__none" ? "" : value)
              }
            >
              <SelectTrigger id="adjust-project">
                <SelectValue placeholder="No project" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">No project</SelectItem>
                {projectOptions.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={save.saving}>
            {save.saving ? "Recording…" : "Record movement"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
