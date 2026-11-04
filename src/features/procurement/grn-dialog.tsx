/**
 * Receive goods against a purchase order.
 *
 * A GRN records what arrived, line by line, capped at the outstanding quantity
 * (ordered minus already received) — over-receipt is refused by the server, not
 * silently allowed, because more landing than was ordered is a fact to resolve
 * with the supplier. Every material-linked line writes a `receipt` stock
 * movement in the same transaction, so on-hand is the SUM of movements the
 * moment this saves. Optionally it raises an ordinary vendor invoice for the
 * received value at the PO's prices — the third leg of the match.
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

import { Textarea } from "@/components/ui/textarea"

import { useSave } from "@/features/organization/use-save"

import { procurementApi } from "@/lib/procurement-api"

import { formatCurrency } from "@/lib/format"

import type { PurchaseOrderView } from "@shared/procurement"

interface GrnDialogProps {
  open: boolean

  onOpenChange: (open: boolean) => void

  purchaseOrder: PurchaseOrderView

  onSaved: () => void
}

interface ReceivedLine {
  poLineId: string

  quantity: number
}

function remaining(quantity: number, received: number): number {
  return Math.max(0, quantity - received)
}

export function GrnDialog({
  open,

  onOpenChange,

  purchaseOrder,

  onSaved,
}: GrnDialogProps) {
  const [quantities, setQuantities] = useState<Record<string, string>>({})

  const [receivedAt, setReceivedAt] = useState("")

  const [note, setNote] = useState("")

  const [createInvoice, setCreateInvoice] = useState(false)

  const [invalid, setInvalid] = useState<Record<string, string>>({})

  const save = useSave()

  useEffect(() => {
    if (!open) return

    setQuantities({})

    setReceivedAt("")

    setNote("")

    setCreateInvoice(false)

    setInvalid({})

    save.clear()

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const receivedValue = useMemo(() => {
    let sum = 0

    for (const line of purchaseOrder.lines) {
      const raw = (quantities[line.id] ?? "").trim()

      if (raw === "") continue

      const quantity = Math.trunc(Number(raw))

      if (!Number.isFinite(quantity)) continue

      sum += quantity * line.unitPrice
    }

    return sum
  }, [quantities, purchaseOrder.lines])

  const hasAnyLine = Object.values(quantities).some(
    (value) => value.trim() !== "" && Math.trunc(Number(value)) > 0,
  )

  async function submit() {
    const errors: Record<string, string> = {}

    const lines = purchaseOrder.lines

      .map((line) => {
        const raw = (quantities[line.id] ?? "").trim()

        if (raw === "") return null

        const quantity = Math.trunc(Number(raw))

        const cap = remaining(line.quantity, line.quantityReceived)

        if (!Number.isFinite(quantity) || quantity <= 0) return null

        if (quantity > cap) {
          errors[line.id] = `At most ${cap} outstanding on this line.`

          return null
        }

        return { poLineId: line.id, quantity }
      })

      .filter((line): line is ReceivedLine => line !== null)

    if (Object.keys(errors).length > 0) {
      setInvalid(errors)

      return
    }

    if (lines.length === 0) {
      setInvalid({ lines: "Record a quantity on at least one line." })

      return
    }

    setInvalid({})

    const done = await save.run(async () => {
      await procurementApi.createGoodsReceipt(purchaseOrder.id, {
        receivedAt: receivedAt ? `${receivedAt}T00:00:00.000Z` : undefined,

        note: note.trim() || null,

        createInvoice,

        lines,
      })
    })

    if (done) {
      onSaved()

      onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[44rem]">
        <DialogHeader>
          <DialogTitle>Receive goods</DialogTitle>
          <DialogDescription>
            Record what arrived against {purchaseOrder.poNumber}. Quantities are
            capped at what is outstanding; material-linked lines move stock now.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-3">
          {save.error ? (
            <Alert variant="danger">
              <AlertDescription>{save.error}</AlertDescription>
            </Alert>
          ) : null}

          {invalid.lines ? (
            <p className="text-[11.5px] font-medium text-danger">
              {invalid.lines}
            </p>
          ) : null}

          <div className="flex flex-col divide-y divide-border">
            {purchaseOrder.lines.map((line) => {
              const cap = remaining(line.quantity, line.quantityReceived)

              return (
                <div
                  key={line.id}
                  className="flex items-center justify-between gap-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium text-foreground">
                      {line.description}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {line.quantityReceived}/{line.quantity} {line.unit}{" "}
                      received · {cap} outstanding
                    </p>
                    {invalid[line.id] ? (
                      <p className="text-[11px] font-medium text-danger">
                        {invalid[line.id]}
                      </p>
                    ) : null}
                  </div>

                  <Input
                    className="max-w-24 text-right"
                    type="number"
                    min={0}
                    max={cap}
                    step={1}
                    inputMode="numeric"
                    disabled={cap === 0}
                    aria-label={`Received quantity for ${line.description}`}
                    value={quantities[line.id] ?? ""}
                    onChange={(event) => {
                      setQuantities((current) => ({
                        ...current,

                        [line.id]: event.target.value,
                      }))

                      setInvalid((current) => {
                        if (!(line.id in current)) return current

                        const next = { ...current }

                        delete next[line.id]

                        return next
                      })

                      save.clear()
                    }}
                  />
                </div>
              )
            })}
          </div>

          <Field label="Received on" htmlFor="grn-date">
            <Input
              id="grn-date"
              type="date"
              value={receivedAt}
              onChange={(event) => setReceivedAt(event.target.value)}
            />
          </Field>

          <Field label="Note" htmlFor="grn-note">
            <Textarea
              id="grn-note"
              rows={2}
              maxLength={500}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </Field>

          <label className="flex items-start gap-2 text-[12.5px] text-foreground">
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-emerald-600"
              checked={createInvoice}
              onChange={(event) => setCreateInvoice(event.target.checked)}
            />
            <span>
              Raise a vendor invoice for the received value (
              <span className="tabular-nums">
                {formatCurrency(receivedValue, purchaseOrder.currency, {
                  maximumFractionDigits: 0,
                })}
              </span>
              ) — it lands on the ordinary vendor ledger.
            </span>
          </label>
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={save.saving || !hasAnyLine}
          >
            {save.saving ? "Recording…" : "Record receipt"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
