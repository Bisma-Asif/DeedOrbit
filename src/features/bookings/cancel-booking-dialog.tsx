/**
 * Call off a booking — with the cost shown before it is committed.
 *
 * Cancellation is not a bare status flip any more: the tenant's rules can keep a charge
 * out of what the customer has paid and refund the rest, and the freed unit may go back
 * to the market or be held. This dialog reads that outcome live (the cancellation
 * preview) so the canceller sees the paid amount, the charge, the refund, and where the
 * unit lands before pressing confirm — and whether the action will apply now or wait on
 * an approval, because a gated workspace holds it instead of completing it.
 *
 * The reason is captured and travels with the request; the gate itself is enforced on the
 * server, and the canceller needs the same approve right the inline action always did.
 */

import { useEffect, useState } from "react"

import { AlertTriangle, XCircle } from "lucide-react"

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

import { Skeleton } from "@/components/ui/skeleton"

import { Textarea } from "@/components/ui/textarea"

import { useSave } from "@/features/organization/use-save"

import { formatCurrency } from "@/lib/format"

import { bookingsApi, type CancellationPreview } from "@/lib/bookings-api"

import {
  CANCELLATION_REASON_MAX,
  UNIT_OUTCOME_LABELS,
} from "@shared/cancellation"

export interface CancelTarget {
  id: string

  reference: string
}

interface CancelBookingDialogProps {
  open: boolean

  booking: CancelTarget | null

  currency: string

  onClose: () => void

  /** Receives whether the cancellation applied immediately or was held for approval. */

  onDone: (pending: boolean) => void
}

function PreviewRow({
  label,

  value,

  tone,
}: {
  label: string

  value: string

  tone?: "danger" | "success" | "muted"
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5">
      <span className="text-[12.5px] text-muted-foreground">{label}</span>
      <span
        className={
          tone === "danger"
            ? "text-[13px] font-semibold tabular-nums text-danger"
            : tone === "success"
              ? "text-[13px] font-semibold tabular-nums text-success"
              : "text-[13px] font-medium tabular-nums text-foreground"
        }
      >
        {value}
      </span>
    </div>
  )
}

export function CancelBookingDialog({
  open,

  booking,

  currency,

  onClose,

  onDone,
}: CancelBookingDialogProps) {
  const save = useSave()

  const [preview, setPreview] = useState<CancellationPreview | null>(null)

  const [reason, setReason] = useState("")

  useEffect(() => {
    if (!open || !booking) {
      setPreview(null)

      setReason("")

      return
    }

    const controller = new AbortController()

    bookingsApi

      .cancellationPreview(booking.id, controller.signal)

      .then((result) => {
        if (!controller.signal.aborted) setPreview(result)
      })

      .catch(() => {
        if (!controller.signal.aborted) setPreview(null)
      })

    return () => controller.abort()
  }, [open, booking])

  if (!booking) return null

  const money = (value: number) =>
    formatCurrency(value, currency, { maximumFractionDigits: 0 })

  async function submit() {
    const done = await save.run(async () => {
      const result = await bookingsApi.cancel(booking!.id, reason.trim())

      onDone("pending" in result && result.pending === true)
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
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Cancel booking</DialogTitle>
          <DialogDescription>
            Cancelling {booking.reference} frees the unit and, depending on the
            workspace's rules, charges and refunds against what has been paid.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-4">
          {save.error ? (
            <Alert variant="danger">
              <AlertDescription>{save.error}</AlertDescription>
            </Alert>
          ) : null}

          {preview === null ? (
            <Skeleton className="h-28 w-full" />
          ) : (
            <div className="rounded-md border border-border bg-muted/20 px-3 py-2">
              <PreviewRow
                label="Paid to date"
                value={money(preview.paidAmount)}
              />
              <PreviewRow
                label="Cancellation charge"
                value={money(preview.chargeAmount)}
                tone={preview.chargeAmount > 0 ? "danger" : undefined}
              />
              <PreviewRow
                label="Refund due"
                value={money(preview.refundAmount)}
                tone={preview.refundAmount > 0 ? "success" : undefined}
              />
              <PreviewRow
                label="Freed unit"
                value={UNIT_OUTCOME_LABELS[preview.unitOutcome]}
                tone="muted"
              />
            </div>
          )}

          {preview?.requiresApproval ? (
            <Alert>
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <AlertDescription>
                Cancellations are gated here, so this will be held for approval
                rather than applied immediately.
              </AlertDescription>
            </Alert>
          ) : null}

          <Field
            label="Reason"
            htmlFor="cancel-reason"
            error={save.fields.reason}
            hint={`${reason.length}/${CANCELLATION_REASON_MAX} characters.`}
          >
            <Textarea
              id="cancel-reason"
              rows={3}
              maxLength={CANCELLATION_REASON_MAX}
              value={reason}
              placeholder="Why the booking is being called off."
              onChange={(event) => {
                setReason(event.target.value)

                save.clear()
              }}
            />
          </Field>
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={save.saving}>
            Keep booking
          </Button>
          <Button
            variant="danger"
            onClick={() => void submit()}
            disabled={save.saving || preview === null}
          >
            {save.saving ? (
              "Cancelling…"
            ) : (
              <>
                <XCircle size={13} />
                Cancel booking
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
