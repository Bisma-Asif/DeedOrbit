/**
 * Hold an accrued late fee for a waiver sign-off.
 *
 * Waiving a fee is forgiveness of money already owed, so it is never applied on the
 * spot: this raises a mandatory approval and leaves the charge standing until a
 * different member signs it off. The dialog only collects a reason — the fee and its
 * context come in from the row that opened it, so the requester sees exactly what is
 * being excused.
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

import { Textarea } from "@/components/ui/textarea"

import { useSave } from "@/features/organization/use-save"

import { formatCurrency } from "@/lib/format"

import { WAIVER_REASON_MAX } from "@shared/late-fees"

import { lateFeesApi } from "@/lib/late-fees-api"

interface WaiveFeeDialogProps {
  open: boolean

  /** The applied assessment to hold for waiver. */

  assessmentId: string | null

  /** The amount the fee is worth, shown so the waiver is never blind. */

  amount: number

  currency: string

  /** Optional one-line context (customer / installment reference). */

  context?: string

  onClose: () => void

  onDone: () => void
}

export function WaiveFeeDialog({
  open,

  assessmentId,

  amount,

  currency,

  context,

  onClose,

  onDone,
}: WaiveFeeDialogProps) {
  const save = useSave()

  const [reason, setReason] = useState("")

  useEffect(() => {
    if (open) {
      setReason("")

      save.clear()
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, assessmentId])

  async function submit() {
    if (!assessmentId || reason.trim() === "") return

    const done = await save.run(async () => {
      await lateFeesApi.requestWaiver(assessmentId, reason.trim())

      onDone()
    })

    if (done) onClose()
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
          <DialogTitle>Waive late fee</DialogTitle>
          <DialogDescription>
            Requesting a waiver sends the charge to approvals; it is removed
            only once another member signs it off.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-4">
          {save.error ? (
            <Alert variant="danger">
              <AlertDescription>{save.error}</AlertDescription>
            </Alert>
          ) : null}

          <div className="rounded-md border border-border bg-muted/30 px-3 py-2.5">
            <p className="text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
              Fee to waive
            </p>
            <p className="mt-0.5 text-[15px] font-semibold tabular-nums text-foreground">
              {formatCurrency(amount, currency, { maximumFractionDigits: 0 })}
            </p>
            {context ? (
              <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                {context}
              </p>
            ) : null}
          </div>

          <Field
            label="Reason"
            htmlFor="waive-fee-reason"
            required
            error={save.fields.reason}
            hint={`${reason.length}/${WAIVER_REASON_MAX} characters.`}
          >
            <Textarea
              id="waive-fee-reason"
              rows={3}
              maxLength={WAIVER_REASON_MAX}
              value={reason}
              placeholder="Why the fee should be excused."
              onChange={(event) => {
                setReason(event.target.value)

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
            disabled={save.saving || reason.trim() === ""}
          >
            {save.saving ? "Submitting…" : "Request waiver"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
