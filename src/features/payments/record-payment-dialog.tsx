/**
 * Record one payment and spread it across a customer's open installments.
 *
 * The office is handed a sum of money and told which lines it settles. This dialog
 * mirrors that: choose the customer, read back every installment still carrying a
 * balance, then type an amount onto the lines it actually covers. Partial and
 * advance lines are both legal — paying a line that is not yet due is a real thing
 * customers do — so nothing here forces a whole line or a due date.
 *
 * The payment amount is the sum of what is allocated, so a receipt is never minted
 * for a figure that does not match its lines; the submit stays blocked until at
 * least one line carries a positive whole amount. On success the caller opens the
 * printable receipt and refreshes its list.
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

import { Badge } from "@/components/ui/badge"

import { useSave } from "@/features/organization/use-save"

import { useSession } from "@/lib/session-context"

import { useAsyncResource } from "@/lib/use-async-resource"

import { formatCurrency, formatDate } from "@/lib/format"

import { customersApi, type CustomerListItem } from "@/lib/leads-api"

import {
  paymentsApi,
  type OpenInstallment,
  type Payment,
} from "@/lib/payments-api"

import {
  INSTALLMENT_DISPLAY_STATUS_LABELS,
  INSTALLMENT_DISPLAY_STATUS_TONES,
} from "@shared/payment-plans"

import {
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_NOTE_MAX,
  type PaymentMethod,
} from "@shared/payments"

import { Inbox, Wallet } from "lucide-react"

interface RecordAllocationDialogProps {
  open: boolean

  /** The currency to render amounts in; falls back to the response's own currency. */

  currency: string

  /** Prefill the customer, for a "record payment" opened from one customer's page. */

  initialCustomerId?: string | null

  onClose: () => void

  onRecorded: (payment: Payment) => void
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

export function RecordAllocationDialog({
  open,

  currency,

  initialCustomerId = null,

  onClose,

  onRecorded,
}: RecordAllocationDialogProps) {
  const { can } = useSession()

  const canReadCustomers = can("customers", "view")

  const save = useSave()

  const [customerId, setCustomerId] = useState(initialCustomerId ?? "")

  const [method, setMethod] = useState<PaymentMethod>("cash")

  const [receivedAt, setReceivedAt] = useState(today)

  const [note, setNote] = useState("")

  const [allocations, setAllocations] = useState<Record<string, string>>({})

  const [loadingLines, setLoadingLines] = useState(false)

  const [lineError, setLineError] = useState<string | null>(null)

  const [lines, setLines] = useState<OpenInstallment[]>([])

  const [linesCurrency, setLinesCurrency] = useState(currency)

  const customers = useAsyncResource(
    (signal) => customersApi.list(signal),

    open && canReadCustomers,
  )

  // Reset the draft each time the dialog opens, so a stale customer or a half-typed

  // allocation never carries into the next payment.

  useEffect(() => {
    if (!open) return

    setCustomerId(initialCustomerId ?? "")

    setMethod("cash")

    setReceivedAt(today())

    setNote("")

    setAllocations({})

    setLines([])

    save.clear()

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialCustomerId])

  // Read the customer's open installments whenever the selection changes. Abandon the

  // request if a newer selection wins the race.

  useEffect(() => {
    if (!open || !customerId) {
      setLines([])

      return
    }

    const controller = new AbortController()

    setLoadingLines(true)

    setLineError(null)

    paymentsApi

      .openInstallments(customerId, controller.signal)

      .then((result) => {
        if (controller.signal.aborted) return

        setLines(result.installments)

        setLinesCurrency(result.currency)

        setLoadingLines(false)
      })

      .catch((error: unknown) => {
        if (controller.signal.aborted) return

        setLines([])

        setLineError(
          error instanceof Error
            ? error.message
            : "Could not load installments.",
        )

        setLoadingLines(false)
      })

    return () => controller.abort()
  }, [open, customerId])

  const money = (value: number) =>
    formatCurrency(value, linesCurrency, { maximumFractionDigits: 0 })

  const allocatedTotal = useMemo(
    () =>
      lines.reduce(
        (sum, line) =>
          sum + Math.max(0, Math.trunc(Number(allocations[line.id] ?? 0) || 0)),

        0,
      ),

    [lines, allocations],
  )

  // A line may not be over-allocated beyond its remaining balance.

  const anyOver = useMemo(
    () =>
      lines.some(
        (line) =>
          Math.trunc(Number(allocations[line.id] ?? 0) || 0) > line.remaining,
      ),

    [lines, allocations],
  )

  const canSubmit =
    Boolean(customerId) &&
    allocatedTotal > 0 &&
    !anyOver &&
    !save.saving &&
    !loadingLines

  const customerOptions = (customers.data?.customers ?? []).map(
    (customer: CustomerListItem) => ({
      id: customer.id,

      primary: customer.name,

      secondary: customer.phone,
    }),
  )

  async function submit() {
    if (!canSubmit) return

    const chosen = lines

      .map((line) => ({
        installmentId: line.id,

        amount: Math.trunc(Number(allocations[line.id] ?? 0) || 0),
      }))

      .filter((entry) => entry.amount > 0)

    const done = await save.run(async () => {
      const result = await paymentsApi.recordAllocated({
        customerId,

        method,

        amount: allocatedTotal,

        allocations: chosen,

        receivedAt: receivedAt || undefined,

        note: note.trim() || undefined,
      })

      onRecorded(result.payment)
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
      <DialogContent className="flex max-h-[90dvh] w-[calc(100%-2rem)] max-w-2xl flex-col">
        <DialogHeader>
          <DialogTitle>Record payment</DialogTitle>
          <DialogDescription>
            Allocate one receipt across the customer's open installments.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
          {save.error ? (
            <Alert variant="danger">
              <AlertDescription>{save.error}</AlertDescription>
            </Alert>
          ) : null}

          <Field
            label="Customer"
            htmlFor="allocation-customer"
            required
            error={save.fields.customerId}
            hint={
              !canReadCustomers
                ? "Your role cannot read the customer list, so a payment cannot be recorded here."
                : undefined
            }
          >
            <Select
              value={customerId}
              onValueChange={(value) => {
                setCustomerId(value)

                setAllocations({})

                save.clear()
              }}
              disabled={
                !canReadCustomers ||
                customers.loading ||
                customerOptions.length === 0
              }
            >
              <SelectTrigger id="allocation-customer">
                <SelectValue
                  placeholder={
                    customers.loading
                      ? "Loading…"
                      : customerOptions.length === 0
                        ? "No customers to choose yet"
                        : "Choose a customer"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {customerOptions.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.primary}
                    <span className="ml-1.5 text-muted-foreground">
                      {option.secondary}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Method" htmlFor="allocation-method">
              <Select
                value={method}
                onValueChange={(value) => setMethod(value as PaymentMethod)}
              >
                <SelectTrigger id="allocation-method">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {PAYMENT_METHOD_LABELS[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Date received" htmlFor="allocation-date">
              <Input
                id="allocation-date"
                type="date"
                value={receivedAt}
                onChange={(event) => setReceivedAt(event.target.value)}
              />
            </Field>
          </div>

          {/* Allocation lines --------------------------------------------- */}
          <div className="flex flex-col gap-2">
            <p className="text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
              Allocate to installments
            </p>

            {!customerId ? (
              <EmptyState
                icon={Inbox}
                size="sm"
                title="Choose a customer"
                description="Their open installments will appear here to allocate against."
              />
            ) : loadingLines ? (
              <Skeleton className="h-24 w-full" />
            ) : lineError ? (
              <Alert variant="danger">
                <AlertDescription>{lineError}</AlertDescription>
              </Alert>
            ) : lines.length === 0 ? (
              <EmptyState
                icon={Wallet}
                size="sm"
                title="No open installments"
                description="Every installment on this customer's confirmed bookings is already settled."
              />
            ) : (
              <div className="flex flex-col divide-y divide-border rounded-md border border-border">
                {lines.map((line) => (
                  <div
                    key={line.id}
                    className="flex items-center gap-3 px-3 py-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium text-foreground">
                          {line.bookingReference} · #{line.number}
                        </span>
                        <Badge
                          variant={
                            INSTALLMENT_DISPLAY_STATUS_TONES[line.displayStatus]
                          }
                        >
                          {
                            INSTALLMENT_DISPLAY_STATUS_LABELS[
                              line.displayStatus
                            ]
                          }
                        </Badge>
                      </div>
                      <p className="truncate text-[11.5px] text-muted-foreground">
                        Due {formatDate(line.dueDate)} · remaining{" "}
                        {money(line.remaining)}
                      </p>
                    </div>

                    <Input
                      type="number"
                      min={0}
                      max={line.remaining}
                      step={1}
                      inputMode="numeric"
                      aria-label={`Amount for ${line.bookingReference} installment ${line.number}`}
                      className="w-28 text-right tabular-nums"
                      value={allocations[line.id] ?? ""}
                      onChange={(event) => {
                        setAllocations((current) => ({
                          ...current,

                          [line.id]: event.target.value,
                        }))

                        save.clear()
                      }}
                    />
                  </div>
                ))}
              </div>
            )}

            {anyOver ? (
              <p className="text-[11.5px] font-medium text-danger">
                An allocation exceeds a line's remaining balance.
              </p>
            ) : null}
          </div>

          <Field
            label="Note"
            htmlFor="allocation-note"
            error={save.fields.note}
            hint={`${note.length}/${PAYMENT_NOTE_MAX} characters.`}
          >
            <Textarea
              id="allocation-note"
              rows={2}
              maxLength={PAYMENT_NOTE_MAX}
              value={note}
              placeholder="Reference, cheque number, or anything worth remembering."
              onChange={(event) => {
                setNote(event.target.value)

                save.clear()
              }}
            />
          </Field>
        </DialogBody>

        <DialogFooter>
          <div className="mr-auto flex items-baseline gap-2 text-[12.5px]">
            <span className="text-muted-foreground">Payment total</span>
            <span className="font-semibold tabular-nums text-foreground">
              {money(allocatedTotal)}
            </span>
          </div>
          <Button variant="outline" onClick={onClose} disabled={save.saving}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={!canSubmit}>
            {save.saving ? "Recording…" : "Record payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
