/**
 * The payment receipt — the second document allowed to look like paper.
 *
 * It mirrors `quotation-document.tsx` deliberately: the same letterhead, the same
 * label-over-value meta grid, the same tabular-numeral table with an exact totals
 * rule, and the same print behaviour. The `@media print` block in `src/index.css`
 * isolates whatever carries `data-document-print`, so the dialog below prints this
 * receipt alone with no dependency and no export step.
 *
 * Everything printed is what the server recorded — the receipt number, the method,
 * the date, the tenant block, and the per-line allocation with its total. A dash
 * stands wherever the tenant profile has no value; nothing here is invented.
 */

import { Printer } from "lucide-react"

import { Button } from "@/components/ui/button"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

import { formatCurrency, formatDate, orDash } from "@/lib/format"

import { PAYMENT_METHOD_LABELS, type PaymentMethod } from "@shared/payments"

import { INSTALLMENT_KIND_LABELS } from "@shared/payment-plans"

import type { ReceiptCustomerBlock, ReceiptView } from "@/lib/payments-api"

/** One row of the meta grid: a small-caps label over its value. */

interface DocMetaProps {
  label: string

  children: string
}

function DocMeta({ label, children }: DocMetaProps) {
  return (
    <div className="min-w-0">
      <p className="text-[9.5px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
        {label}
      </p>

      <p className="mt-0.5 text-[12.5px] leading-5 text-foreground">
        {children}
      </p>
    </div>
  )
}

/** Flatten the customer block to one address line, dashes dropped, or a bare dash. */

function customerAddress(customer: ReceiptCustomerBlock | null): string {
  if (!customer) return "—"

  const line = [
    customer.addressLine1,

    customer.addressLine2,

    customer.city,

    customer.stateRegion,

    customer.postalCode,

    customer.country,
  ]

    .filter((part): part is string => Boolean(part))

    .join(", ")

  return line || "—"
}

interface ReceiptDocumentProps {
  receipt: ReceiptView

  /** The heading printed top-right: a receipt, or a credit note reusing the layout. */

  documentLabel?: string
}

export function ReceiptDocument({
  receipt,

  documentLabel = "Receipt",
}: ReceiptDocumentProps) {
  const { payment, tenant, customer, lines, currency } = receipt

  const money = (value: number) =>
    formatCurrency(value, currency, { maximumFractionDigits: 0 })

  const allocatedTotal = lines.reduce((sum, line) => sum + line.allocated, 0)

  return (
    <article
      className="bg-card text-foreground"
      style={{ fontFamily: "var(--font-sans)" }}
    >
      {/* Letterhead */}
      <header className="flex items-start justify-between gap-6 border-b border-border-strong pb-4">
        <div className="min-w-0">
          <p className="text-[15px] leading-5 font-semibold tracking-tight">
            {orDash(tenant.legalName ?? tenant.name)}
          </p>

          <div className="mt-1.5 flex flex-col gap-0.5 text-[10.5px] leading-4 text-muted-foreground">
            <p>
              {[tenant.addressLine1, tenant.addressLine2]

                .filter(Boolean)

                .join(", ") || "—"}
            </p>
            <p>
              {[tenant.city, tenant.stateRegion, tenant.postalCode]

                .filter(Boolean)

                .join(" ") || "—"}
            </p>
            <p>
              {[tenant.phone, tenant.email].filter(Boolean).join(" · ") || "—"}
            </p>
            <p>
              {tenant.registrationNumber
                ? `Reg. ${tenant.registrationNumber}`
                : "—"}
            </p>
          </div>
        </div>

        <div className="shrink-0 text-right">
          <p className="text-[13px] font-semibold tracking-[0.14em] uppercase">
            {documentLabel}
          </p>

          <p className="mt-1 text-[11px] tabular-nums text-muted-foreground">
            {orDash(payment.receiptNumber)}
          </p>

          <p className="text-[11px] tabular-nums text-muted-foreground">
            {formatDate(payment.receivedAt)}
          </p>
        </div>
      </header>

      {/* Addressed to / for */}
      <section className="grid grid-cols-2 gap-6 border-b border-border py-4">
        <DocMeta label="Received from">
          {customer ? orDash(customer.name) : "—"}
        </DocMeta>

        <DocMeta label="Method">
          {PAYMENT_METHOD_LABELS[(payment.method as PaymentMethod)] ??
            payment.method}
        </DocMeta>

        <DocMeta label="Receipt number">
          {orDash(payment.receiptNumber)}
        </DocMeta>

        <DocMeta label="Received by">{orDash(payment.recordedByName)}</DocMeta>

        <DocMeta label="Address">{customerAddress(customer)}</DocMeta>

        <DocMeta label="Date received">
          {formatDate(payment.receivedAt)}
        </DocMeta>
      </section>

      {/* Allocated lines */}
      <section className="py-4">
        <p className="text-[9.5px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
          Applied to
        </p>

        <table className="mt-2 w-full border-collapse text-[12px]">
          <thead>
            <tr>
              <td className="border-b border-border-strong py-1.5 pr-3 text-[9.5px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                Booking
              </td>
              <td className="border-b border-border-strong py-1.5 pr-3 text-[9.5px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                Installment
              </td>
              <td className="border-b border-border-strong py-1.5 pr-3 text-[9.5px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                Due
              </td>
              <td className="border-b border-border-strong py-1.5 text-right text-[9.5px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                Amount
              </td>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.installmentId} className="avoid-break-inside">
                <td className="border-b border-border py-1.5 pr-3 font-mono text-[11px] text-muted-foreground">
                  {line.bookingReference}
                </td>
                <td className="border-b border-border py-1.5 pr-3">
                  {INSTALLMENT_KIND_LABELS[line.kind]} #{line.number}
                </td>
                <td className="border-b border-border py-1.5 pr-3 tabular-nums text-muted-foreground">
                  {formatDate(line.dueDate)}
                </td>
                <td className="border-b border-border py-1.5 text-right tabular-nums">
                  {money(line.allocated)}
                </td>
              </tr>
            ))}

            <tr className="avoid-break-inside">
              <td
                colSpan={3}
                className="border-b-2 border-border-strong py-2 pr-3 text-[12.5px] font-semibold"
              >
                Total received
              </td>
              <td className="border-b-2 border-border-strong py-2 text-right text-[13px] font-semibold tabular-nums">
                {money(payment.amount)}
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      {/* Note */}
      {payment.note ? (
        <section className="border-t border-border py-4">
          <p className="text-[9.5px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
            Note
          </p>

          <p className="mt-1 text-[11.5px] leading-5 whitespace-pre-wrap">
            {payment.note}
          </p>
        </section>
      ) : null}

      <footer className="border-t border-border-strong pt-3 pb-1 text-[10px] leading-4 text-muted-foreground">
        This receipt acknowledges {money(allocatedTotal)} received on{" "}
        {formatDate(payment.receivedAt)} and applied to the lines above. Figures
        are in {currency}.
      </footer>
    </article>
  )
}

// --- Print dialog -------------------------------------------------------------

interface PrintReceiptDialogProps {
  receipt: ReceiptView | null

  onClose: () => void

  documentLabel?: string
}

/**
 * The receipt inside a dialog with the one button that matters.
 *
 * "Print / Save as PDF" calls the browser print; the stylesheet reduces the page to
 * `[data-document-print]` alone. The header and footer carry `print-hidden` /
 * `data-no-print` so they are chrome on screen and absent on paper.
 */

export function PrintReceiptDialog({
  receipt,

  onClose,

  documentLabel,
}: PrintReceiptDialogProps) {
  return (
    <Dialog
      open={receipt !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent
        data-document-print=""
        className="flex w-[calc(100%-2rem)] max-w-[46rem] flex-col"
      >
        <DialogHeader className="print-hidden">
          <DialogTitle>
            {receipt
              ? `${documentLabel ?? "Receipt"} ${receipt.payment.receiptNumber ?? ""}`.trim()
              : (documentLabel ?? "Receipt")}
          </DialogTitle>

          <DialogDescription>
            Review the document, then print or save it as a PDF.
          </DialogDescription>
        </DialogHeader>

        {receipt && (
          <div className="scrollbar-slim min-h-0 flex-1 overflow-y-auto border border-border bg-muted/20 p-3 sm:p-5">
            <div className="mx-auto max-w-[38rem] border border-border bg-card p-6 shadow-card sm:p-8">
              <ReceiptDocument
                receipt={receipt}
                documentLabel={documentLabel}
              />
            </div>
          </div>
        )}

        <DialogFooter className="print-hidden">
          <Button variant="outline" data-no-print="" onClick={onClose}>
            Close
          </Button>

          <Button onClick={() => window.print()} disabled={receipt === null}>
            <Printer size={13} />
            Print / Save as PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
