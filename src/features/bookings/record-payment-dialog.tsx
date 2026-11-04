/**
 * Booking a receipt against one installment line.
 *
 * A deliberately small dialog: a single amount, defaulted to the line's remaining
 * balance, validated on the server against what is already paid so a line can never
 * be over-recorded. The whole interaction is one number and one confirm.
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

import { useSave } from "@/features/organization/use-save"

import { formatCurrency } from "@/lib/format"

import { paymentsApi, type Installment } from "@/lib/payments-api"

interface RecordPaymentDialogProps {
  open: boolean

  installment: Installment | null

  currency: string

  onClose: () => void

  onRecorded: () => void
}

export function RecordPaymentDialog({
  open,

  installment,

  currency,

  onClose,

  onRecorded,
}: RecordPaymentDialogProps) {
  const save = useSave()

  const balance = installment ? installment.total - installment.paidAmount : 0

  const [amount, setAmount] = useState("")

  // Pre-fill the balance each time the dialog opens for a line, so the common case

  // (paying it off) is a single confirm and a stale draft never carries across lines.

  useEffect(() => {
    if (open && installment) {
      setAmount(String(installment.total - installment.paidAmount))

      save.clear()
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, installment?.id])

  if (!installment) return null

  const line = installment

  async function submit() {
    const done = await save.run(async () => {
      await paymentsApi.recordPayment(line.id, Number(amount))

      onRecorded()
    })

    if (done) {
      save.clear()

      onClose()
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Record payment</DialogTitle>
          <DialogDescription>
            Line {installment.number} · due{" "}
            {formatDateOnly(installment.dueDate)} ·{" "}
            {formatCurrency(installment.total, currency, {
              maximumFractionDigits: 0,
            })}{" "}
            total.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-4">
          {save.error ? (
            <Alert variant="danger">
              <AlertDescription>{save.error}</AlertDescription>
            </Alert>
          ) : null}

          <Field
            label="Amount received"
            htmlFor="payment-amount"
            required
            error={save.fields.amount}
            hint={`Remaining balance ${formatCurrency(balance, currency, { maximumFractionDigits: 0 })}.`}
          >
            <Input
              id="payment-amount"
              type="number"
              min={1}
              max={balance}
              step={1}
              inputMode="numeric"
              value={amount}
              onChange={(event) => {
                setAmount(event.target.value)

                save.clear()
              }}
            />
          </Field>
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={save.saving}>
            Cancel
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={
              save.saving || amount.trim() === "" || Number(amount) <= 0
            }
          >
            {save.saving ? "Recording…" : "Record payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function formatDateOnly(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",

    month: "short",

    year: "numeric",
  }).format(new Date(value))
}
