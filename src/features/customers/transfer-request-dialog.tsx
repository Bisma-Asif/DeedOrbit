/**
 * Move a confirmed booking to a different customer.
 *
 * A transfer repoints who owns a booking, and everything hanging off it — the plan,
 * the installments, the receipts — travels with it. It is always approval-gated, so
 * this only raises the request: choose the customer the booking is moving to, note an
 * optional fee (charged to the incoming party), and say why. On sign-off the server
 * posts the paired out/in ledger movements; until then the booking stands as it was.
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

import { useSession } from "@/lib/session-context"

import { formatCurrency } from "@/lib/format"

import { customersApi, type CustomerListItem } from "@/lib/leads-api"

import { transfersApi } from "@/lib/transfers-api"

import { TRANSFER_REASON_MAX } from "@shared/transfers"

import { ArrowRightLeft } from "lucide-react"

interface TransferRequestDialogProps {
  open: boolean

  bookingId: string

  bookingReference: string

  /** The booking's current owner, excluded from the target list. */

  fromCustomerId: string

  currency: string

  onClose: () => void

  onDone: () => void
}

export function TransferRequestDialog({
  open,

  bookingId,

  bookingReference,

  fromCustomerId,

  currency,

  onClose,

  onDone,
}: TransferRequestDialogProps) {
  const { can } = useSession()

  const canReadCustomers = can("customers", "view")

  const save = useSave()

  const [toCustomerId, setToCustomerId] = useState("")

  const [fee, setFee] = useState("")

  const [reason, setReason] = useState("")

  const customers = useAsyncResource(
    (signal) => customersApi.list(signal),

    open && canReadCustomers,
  )

  useEffect(() => {
    if (!open) return

    setToCustomerId("")

    setFee("")

    setReason("")

    save.clear()

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, bookingId])

  const options = useMemo(
    () =>
      (customers.data?.customers ?? [])

        .filter((customer: CustomerListItem) => customer.id !== fromCustomerId)

        .map((customer: CustomerListItem) => ({
          id: customer.id,

          primary: customer.name,

          secondary: customer.phone,
        })),

    [customers.data, fromCustomerId],
  )

  const feeValue = Math.trunc(Number(fee) || 0)

  async function submit() {
    if (!toCustomerId) return

    const done = await save.run(async () => {
      await transfersApi.request({
        bookingId,

        toCustomerId,

        fee: feeValue > 0 ? feeValue : undefined,

        reason: reason.trim() || undefined,
      })

      onDone()
    })

    if (done) onClose()
  }

  const canSubmit = Boolean(toCustomerId) && !save.saving

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Transfer booking</DialogTitle>
          <DialogDescription>
            Moving {bookingReference} to another customer is held for approval
            before anything changes.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-4">
          {save.error ? (
            <Alert variant="danger">
              <AlertDescription>{save.error}</AlertDescription>
            </Alert>
          ) : null}

          <Field
            label="Transfer to customer"
            htmlFor="transfer-to"
            required
            error={save.fields.toCustomerId}
            hint={
              !canReadCustomers
                ? "Your role cannot read the customer list, so a transfer cannot be requested here."
                : undefined
            }
          >
            {customers.loading && !customers.data ? (
              <Skeleton className="h-9 w-full" />
            ) : options.length === 0 ? (
              <EmptyState
                icon={ArrowRightLeft}
                size="sm"
                title="No other customers"
                description="There is no different customer to move this booking to."
              />
            ) : (
              <Select
                value={toCustomerId}
                onValueChange={(value) => {
                  setToCustomerId(value)

                  save.clear()
                }}
                disabled={!canReadCustomers}
              >
                <SelectTrigger id="transfer-to">
                  <SelectValue placeholder="Choose a customer" />
                </SelectTrigger>
                <SelectContent>
                  {options.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.primary}
                      <span className="ml-1.5 text-muted-foreground">
                        {option.secondary}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>

          <Field
            label="Transfer fee"
            htmlFor="transfer-fee"
            error={save.fields.fee}
            hint={
              feeValue > 0
                ? `Charged to the incoming party: ${formatCurrency(feeValue, currency, { maximumFractionDigits: 0 })}.`
                : "Optional. Leave blank for no fee."
            }
          >
            <Input
              id="transfer-fee"
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              value={fee}
              onChange={(event) => {
                setFee(event.target.value)

                save.clear()
              }}
            />
          </Field>

          <Field
            label="Reason"
            htmlFor="transfer-reason"
            error={save.fields.reason}
            hint={`${reason.length}/${TRANSFER_REASON_MAX} characters.`}
          >
            <Textarea
              id="transfer-reason"
              rows={3}
              maxLength={TRANSFER_REASON_MAX}
              value={reason}
              placeholder="Why the booking is changing hands."
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
            {save.saving ? "Submitting…" : "Request transfer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
