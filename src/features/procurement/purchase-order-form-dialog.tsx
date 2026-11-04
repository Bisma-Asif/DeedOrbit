/**
 * Draft a purchase order.
 *
 * A PO names one vendor (the supplier master stays `vendors`) and carries priced
 * lines; a PO number is minted from the workspace's numbering when it is
 * created, never typed here. Lines may point at a material — those are the ones
 * a goods receipt moves stock against — or stand alone. Unit prices are whole
 * numbers, so the line total and the PO total are arithmetic, not an estimate:
 * every line needs a price.
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

import {
  procurementApi,
  type PurchaseOrderLineInput,
} from "@/lib/procurement-api"

import { vendorsApi } from "@/lib/vendors-api"

import { useAsyncResource } from "@/lib/use-async-resource"

import { formatCurrency } from "@/lib/format"

import {
  LINE_QUANTITY_MAX,
  PO_LINE_MAX,
  UNIT_PRICE_MAX,
  type PurchaseOrderView,
} from "@shared/procurement"

interface PurchaseOrderFormDialogProps {
  open: boolean

  onOpenChange: (open: boolean) => void

  /** Pre-fills the vendor when launched from a requisition conversion. */

  defaultVendorId?: string

  defaultProjectId?: string | null

  onCreated: (purchaseOrder: PurchaseOrderView) => void
}

interface LineDraft {
  description: string

  materialId: string

  quantity: string

  unit: string

  unitPrice: string
}

interface PoDraft {
  vendorId: string

  currency: string

  notes: string

  lines: LineDraft[]
}

function blankLine(): LineDraft {
  return {
    description: "",
    materialId: "",
    quantity: "",
    unit: "",
    unitPrice: "",
  }
}

function wholeNumber(raw: string, max: number): number | null {
  const trimmed = raw.trim()

  if (trimmed === "") return null

  const parsed = Math.trunc(Number(trimmed))

  return Number.isFinite(parsed) && parsed >= 1 && parsed <= max ? parsed : null
}

export function PurchaseOrderFormDialog({
  open,

  onOpenChange,

  defaultVendorId,

  onCreated,
}: PurchaseOrderFormDialogProps) {
  const [draft, setDraft] = useState<PoDraft>(() => ({
    vendorId: "",

    currency: "",

    notes: "",

    lines: [blankLine()],
  }))

  const [invalid, setInvalid] = useState<Record<string, string>>({})

  const save = useSave()

  const vendors = useAsyncResource(
    (signal) => vendorsApi.list({}, signal),

    open,
  )

  const materials = useAsyncResource(
    (signal) => procurementApi.listMaterials(undefined, "active", signal),

    open,
  )

  const vendorOptions = useMemo(
    () => vendors.data?.vendors ?? [],
    [vendors.data],
  )

  const materialOptions = useMemo(
    () => materials.data?.materials ?? [],

    [materials.data],
  )

  useEffect(() => {
    if (!open) return

    setDraft({
      vendorId: defaultVendorId ?? "",

      currency: "",

      notes: "",

      lines: [blankLine()],
    })

    setInvalid({})

    save.clear()

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultVendorId])

  const total = useMemo(() => {
    let sum = 0

    for (const line of draft.lines) {
      const quantity = Math.trunc(Number(line.quantity))

      const price = Math.trunc(Number(line.unitPrice))

      if (!Number.isFinite(quantity) || !Number.isFinite(price)) return null

      sum += quantity * price
    }

    return draft.lines.length > 0 ? sum : null
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

  function chooseMaterial(index: number, materialId: string) {
    const material = materialOptions.find((m) => m.id === materialId)

    setDraft((current) => ({
      ...current,

      lines: current.lines.map((line, i) =>
        i === index
          ? {
              ...line,

              materialId,

              unit: material ? material.unitOfMeasure : line.unit,

              description:
                line.description === "" && material
                  ? material.name
                  : line.description,
            }
          : line,
      ),
    }))

    save.clear()
  }

  function addLine() {
    setDraft((current) =>
      current.lines.length >= PO_LINE_MAX
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

    if (draft.vendorId === "") errors.vendorId = "Choose the supplier."

    if (draft.lines.length === 0) errors.lines = "Add at least one line."

    draft.lines.forEach((line, index) => {
      if (line.description.trim() === "") {
        errors[`line${index}`] = "Describe the line."
      } else if (wholeNumber(line.quantity, LINE_QUANTITY_MAX) === null) {
        errors[`line${index}`] = "Enter a whole quantity."
      } else if (line.unit.trim() === "") {
        errors[`line${index}`] = "Add a unit."
      } else if (wholeNumber(line.unitPrice, UNIT_PRICE_MAX) === null) {
        errors[`line${index}`] = "Every PO line needs a whole unit price."
      }
    })

    if (Object.keys(errors).length > 0) {
      setInvalid(errors)

      return
    }

    setInvalid({})

    const lines: PurchaseOrderLineInput[] = draft.lines.map((line) => ({
      description: line.description.trim(),

      materialId: line.materialId === "" ? null : line.materialId,

      quantity: Math.trunc(Number(line.quantity)),

      unit: line.unit.trim(),

      unitPrice: Math.trunc(Number(line.unitPrice)),
    }))

    const done = await save.run(async () => {
      const result = await procurementApi.createPurchaseOrder({
        vendorId: draft.vendorId,

        currency: draft.currency.trim().toUpperCase() || undefined,

        notes: draft.notes.trim() || null,

        lines,
      })

      onCreated(result.purchaseOrder)
    })

    if (done) onOpenChange(false)
  }

  const errorFor = (key: string) => invalid[key] ?? save.fields[key]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[48rem]">
        <DialogHeader>
          <DialogTitle>New purchase order</DialogTitle>
          <DialogDescription>
            Order from one supplier. The PO number is issued on save; lines that
            point at a material are the ones a receipt moves stock against.
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
              label="Vendor"
              htmlFor="po-vendor"
              required
              error={errorFor("vendorId")}
            >
              <Select
                value={draft.vendorId || "__none"}
                onValueChange={(value) =>
                  setDraft((current) => ({
                    ...current,

                    vendorId: value === "__none" ? "" : value,
                  }))
                }
              >
                <SelectTrigger id="po-vendor">
                  <SelectValue placeholder="Choose a supplier" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none" disabled>
                    Choose a supplier
                  </SelectItem>
                  {vendorOptions.map((vendor) => (
                    <SelectItem key={vendor.id} value={vendor.id}>
                      {vendor.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field
              label="Currency"
              htmlFor="po-currency"
              hint="Blank uses your workspace currency."
              error={errorFor("currency")}
            >
              <Input
                id="po-currency"
                maxLength={3}
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
                  className="flex flex-col gap-2 rounded-md border border-border p-2"
                >
                  <div className="grid grid-cols-1 items-start gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1.3fr)]">
                    <Input
                      aria-label={`Line ${index + 1} description`}
                      placeholder="Description"
                      value={line.description}
                      onChange={(event) =>
                        setLine(index, { description: event.target.value })
                      }
                    />

                    <Select
                      value={line.materialId || "__none"}
                      onValueChange={(value) =>
                        chooseMaterial(index, value === "__none" ? "" : value)
                      }
                    >
                      <SelectTrigger aria-label={`Line ${index + 1} material`}>
                        <SelectValue placeholder="No material (non-stock)" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none">
                          No material (non-stock)
                        </SelectItem>
                        {materialOptions.map((material) => (
                          <SelectItem key={material.id} value={material.id}>
                            {material.sku} · {material.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grid grid-cols-[70px_70px_minmax(0,1fr)_28px] items-start gap-2">
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
                      placeholder="Unit price"
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
                  </div>

                  {errorFor(`line${index}`) ? (
                    <p className="text-[11.5px] font-medium text-danger">
                      {errorFor(`line${index}`)}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          </div>

          <Field label="Notes" htmlFor="po-notes" error={errorFor("notes")}>
            <Textarea
              id="po-notes"
              rows={2}
              value={draft.notes}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  notes: event.target.value,
                }))
              }
            />
          </Field>

          <p className="text-right text-[12.5px] text-muted-foreground">
            Order total:{" "}
            <span className="font-semibold tabular-nums text-foreground">
              {total === null
                ? "—"
                : formatCurrency(total, draft.currency || "AED", {
                    maximumFractionDigits: 0,
                  })}
            </span>
          </p>
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={save.saving}>
            {save.saving ? "Creating…" : "Create draft PO"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
