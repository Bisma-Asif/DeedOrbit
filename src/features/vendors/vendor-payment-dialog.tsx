/**
 * Record a payment or an adjustment against a vendor.
 *
 * Paying an open invoice writes a negative `payment` row to the ledger inside
 * the server's transaction and flips the invoice to `paid` once the total paid
 * meets the invoice amount. Leaving the invoice blank records a signed
 * `adjustment` instead — the honest way to nudge a balance without a document.
 * The dialog only ever sends a positive magnitude for an invoice payment; the
 * sign is the server's concern, so the numbers here stay readable.
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

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

import { Textarea } from "@/components/ui/textarea"

import { useSave } from "@/features/organization/use-save"

import { vendorsApi, type VendorPaymentInput } from "@/lib/vendors-api"

import { VENDOR_INVOICE_AMOUNT_MAX } from "@shared/vendors"

interface OpenInvoiceOption {
  id: string

  reference: string

  amount: number
}

interface VendorPaymentDialogProps {
  open: boolean

  onOpenChange: (open: boolean) => void

  vendorId: string

  /** Pre-selected invoice, when the dialog is opened from an invoice row. */

  invoiceId?: string | null

  onSaved: () => void
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

interface PaymentDraft {
  invoiceId: string

  amount: number

  occurredAt: string

  note: string
}

function emptyDraft(invoiceId: string | null | undefined): PaymentDraft {
  return {
    invoiceId: invoiceId ?? "",

    amount: 0,

    occurredAt: today(),

    note: "",
  }
}

export function VendorPaymentDialog({
  open,

  onOpenChange,

  vendorId,

  invoiceId,

  onSaved,
}: VendorPaymentDialogProps) {
  const [draft, setDraft] = useState<PaymentDraft>(() => emptyDraft(invoiceId))

  const [invoices, setInvoices] = useState<OpenInvoiceOption[]>([])

  const save = useSave()

  useEffect(() => {
    if (!open) return

    setDraft(emptyDraft(invoiceId))

    save.clear()

    void vendorsApi

      .listInvoices(vendorId, "open")

      .then((result) =>
        setInvoices(
          result.invoices.map((invoice) => ({
            id: invoice.id,

            reference: invoice.reference,

            amount: invoice.amount,
          })),
        ),
      )

      .catch(() => setInvoices([]))

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, vendorId, invoiceId])

  function set<K extends keyof PaymentDraft>(key: K, value: PaymentDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }))

    save.clear()
  }

  const isAdjustment = draft.invoiceId === ""

  const selected = invoices.find((invoice) => invoice.id === draft.invoiceId)

  async function submit() {
    // A zero magnitude is rejected server-side with a field error, so nothing

    // special happens here — the run below surfaces it under the amount input.

    const magnitude = Math.abs(draft.amount)

    const body: VendorPaymentInput = {
      invoiceId: isAdjustment ? null : draft.invoiceId,

      // An invoice payment sends a positive magnitude; the server negates it. An

      // adjustment keeps the caller's sign so it can raise or lower the payable.

      amount: isAdjustment ? draft.amount : magnitude,

      occurredAt: `${draft.occurredAt.slice(0, 10)}T00:00:00.000Z`,

      note: draft.note.trim() || null,
    }

    const done = await save.run(async () => {
      await vendorsApi.recordPayment(vendorId, body)

      onSaved()
    })

    if (done) onOpenChange(false)
  }

  const errorFor = (key: string) => save.fields[key]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[32rem]">
        <DialogHeader>
          <DialogTitle>
            {isAdjustment ? "Record an adjustment" : "Record a payment"}
          </DialogTitle>
          <DialogDescription>
            {isAdjustment
              ? "A signed entry straight onto the vendor's account — positive raises what we owe, negative pays it down."
              : "Money paid out against an open invoice. The ledger picks it up as a payment line."}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-3">
          {save.error ? (
            <Alert variant="danger">
              <AlertDescription>{save.error}</AlertDescription>
            </Alert>
          ) : null}

          <Field label="Invoice" htmlFor="payment-invoice">
            <Select
              value={draft.invoiceId || "__adjustment"}
              onValueChange={(value) =>
                set("invoiceId", value === "__adjustment" ? "" : value)
              }
            >
              <SelectTrigger id="payment-invoice">
                <SelectValue placeholder="Choose an open invoice" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__adjustment">
                  No invoice (adjustment)
                </SelectItem>
                {invoices.map((invoice) => (
                  <SelectItem key={invoice.id} value={invoice.id}>
                    {invoice.reference} · {invoice.amount.toLocaleString()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {selected ? (
            <p className="text-[11.5px] text-muted-foreground">
              Invoice total {selected.amount.toLocaleString()}. Partial payments
              accumulate until the invoice is covered.
            </p>
          ) : null}

          <Field
            label={isAdjustment ? "Signed amount" : "Amount paid"}
            htmlFor="payment-amount"
            error={errorFor("amount")}
            required
          >
            <Input
              id="payment-amount"
              type="number"
              min={isAdjustment ? -VENDOR_INVOICE_AMOUNT_MAX : 1}
              max={VENDOR_INVOICE_AMOUNT_MAX}
              step={1}
              inputMode="numeric"
              value={draft.amount === 0 ? "" : String(draft.amount)}
              onChange={(event) => {
                const raw = event.target.value.trim()

                const parsed = raw === "" ? 0 : Math.trunc(Number(raw))

                set("amount", Number.isFinite(parsed) ? parsed : 0)
              }}
            />
          </Field>

          <Field
            label="Date"
            htmlFor="payment-occurred"
            error={errorFor("occurredAt")}
            required
          >
            <Input
              id="payment-occurred"
              type="date"
              value={draft.occurredAt.slice(0, 10)}
              onChange={(event) => set("occurredAt", event.target.value)}
            />
          </Field>

          <Field label="Note" htmlFor="payment-note" error={errorFor("note")}>
            <Textarea
              id="payment-note"
              rows={3}
              value={draft.note}
              onChange={(event) => set("note", event.target.value)}
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
              : isAdjustment
                ? "Record"
                : "Record payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
