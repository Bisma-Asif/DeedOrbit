/**
 * Request a refund of money already received.
 *
 * A refund unwinds a receipt, so it is always approval-gated and always tied to a real
 * payment: choose which receipt to refund, name the amount (bounded on the server against
 * what is left of that payment after any earlier refunds), and say why. Nothing moves
 * until a sign-off, and this dialog only raises the held request.
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

import { Skeleton } from "@/components/ui/skeleton"

import { EmptyState } from "@/components/empty-state"

import { useSave } from "@/features/organization/use-save"

import { useAsyncResource } from "@/lib/use-async-resource"

import { formatCurrency, formatDate } from "@/lib/format"

import { paymentsApi } from "@/lib/payments-api"

import { refundsApi } from "@/lib/refunds-api"

import { REFUND_REASON_MAX } from "@shared/refunds"

import { PAYMENT_METHOD_LABELS } from "@shared/payments"

import { Receipt } from "lucide-react"

interface RefundRequestDialogProps {
  open: boolean

  customerId: string

  currency: string

  /** Preselect one of the customer's payments, when opened from a receipt row. */

  prefillPaymentId?: string | null

  onClose: () => void

  onDone: () => void
}

export function RefundRequestDialog({
  open,

  customerId,

  currency,

  prefillPaymentId = null,

  onClose,

  onDone,
}: RefundRequestDialogProps) {
  const save = useSave()

  const [paymentId, setPaymentId] = useState(prefillPaymentId ?? "")

  const [amount, setAmount] = useState("")

  const [reason, setReason] = useState("")

  const payments = useAsyncResource(
    (signal) => paymentsApi.list(customerId, signal),

    open,
  )

  useEffect(() => {
    if (!open) return

    setPaymentId(prefillPaymentId ?? "")

    setAmount("")

    setReason("")

    save.clear()

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, prefillPaymentId])

  const options = payments.data?.payments ?? []

  const selected = useMemo(
    () => options.find((payment) => payment.id === paymentId) ?? null,

    [options, paymentId],
  )

  const money = (value: number) =>
    formatCurrency(value, currency, { maximumFractionDigits: 0 })

  async function submit() {
    if (!paymentId || !selected) return

    const parsed = Math.trunc(Number(amount) || 0)

    if (parsed <= 0 || reason.trim() === "") return

    const done = await save.run(async () => {
      await refundsApi.request({
        customerId,

        paymentId,

        amount: parsed,

        reason: reason.trim(),

        bookingId: selected.bookingId,
      })

      onDone()
    })

    if (done) onClose()
  }

  const canSubmit =
    Boolean(paymentId) &&
    Math.trunc(Number(amount) || 0) > 0 &&
    reason.trim() !== "" &&
    !save.saving

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Request refund</DialogTitle>
          <DialogDescription>
            Refunding a receipt is held for approval; nothing is paid out until
            a sign-off.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-4">
          {save.error ? (
            <Alert variant="danger">
              <AlertDescription>{save.error}</AlertDescription>
            </Alert>
          ) : null}

          <Field
            label="Original payment"
            htmlFor="refund-payment"
            required
            error={save.fields.paymentId}
          >
            {payments.loading && !payments.data ? (
              <Skeleton className="h-9 w-full" />
            ) : options.length === 0 ? (
              <EmptyState
                icon={Receipt}
                size="sm"
                title="No payments to refund"
                description="This customer has no recorded receipt yet."
              />
            ) : (
              <Select
                value={paymentId}
                onValueChange={(value) => {
                  setPaymentId(value)

                  const chosen = options.find((payment) => payment.id === value)

                  if (chosen) setAmount(String(chosen.amount))

                  save.clear()
                }}
              >
                <SelectTrigger id="refund-payment">
                  <SelectValue placeholder="Choose a receipt" />
                </SelectTrigger>
                <SelectContent>
                  {options.map((payment) => (
                    <SelectItem key={payment.id} value={payment.id}>
                      {payment.receiptNumber ?? payment.id}
                      <span className="ml-1.5 text-muted-foreground">
                        {money(payment.amount)} ·{" "}
                        {PAYMENT_METHOD_LABELS[payment.method]} ·{" "}
                        {formatDate(payment.receivedAt)}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>

          <Field
            label="Amount to refund"
            htmlFor="refund-amount"
            required
            error={save.fields.amount}
            hint={
              selected
                ? `Payment was ${money(selected.amount)}.`
                : "Choose a payment first."
            }
          >
            <Input
              id="refund-amount"
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              disabled={!selected}
              value={amount}
              onChange={(event) => {
                setAmount(event.target.value)

                save.clear()
              }}
            />
          </Field>

          <Field
            label="Reason"
            htmlFor="refund-reason"
            required
            error={save.fields.reason}
            hint={`${reason.length}/${REFUND_REASON_MAX} characters.`}
          >
            <Textarea
              id="refund-reason"
              rows={3}
              maxLength={REFUND_REASON_MAX}
              value={reason}
              placeholder="Why the money is being returned."
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
          <Button onClick={() => void submit()} disabled={!canSubmit}>
            {save.saving ? "Submitting…" : "Request refund"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
