/**
 * The quotation document — the one screen in the product that is allowed to look
 * like paper.
 *
 * This renders the stored quote exactly as the server recorded it: the snapshot
 * fields (price, discount, extras, plan) are read from the quotation rather than
 * recomputed from the unit, because a quotation is an offer made on a date and the
 * unit's price may have moved since. Re-deriving the figures would silently rewrite
 * history a client may already have in hand.
 *
 * It is built to be printed to PDF rather than to export one. A browser's "Print →
 * Save as PDF" is what a locked-down intranet workstation actually has, no
 * dependency ships a font or a PDF encoder here, and the stylesheet in
 * `src/index.css` reduces the page to this document alone when the print dialog
 * opens. On screen it sits inside a dialog at A4-ish proportions so what you review
 * is what comes out.
 *
 * The design rules hold here as everywhere: tokens rather than hex, tabular
 * numerals on money, emerald kept to the single total rule, and a dash wherever the
 * record has no value — never an invented address, tax id, or figure.
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

import { discountLabel, type QuotePlanItem } from "@/lib/quotation-calc"

import { formatCurrency, formatDate, formatNumber, orDash } from "@/lib/format"

import type {
  UnitCategoryView,
  UnitQuotation,
} from "@/lib/project-inventory-api"

/** The workspace block printed above the document. Absent fields print a dash. */

export interface QuotationTenant {
  name: string

  legalName: string | null

  address: string | null

  phone: string | null

  email: string | null

  registrationNumber: string | null
}

interface QuotationDocumentProps {
  quote: UnitQuotation

  currency: string

  tenant: QuotationTenant | null

  projectName: string

  /**
   * The unit's classification, resolved against this tenant's own lists. Present whenever
   * the document is opened from the unit it belongs to, which is the only place a quote is
   * ever issued from; absent means the paper prints without it rather than inventing a
   * property type the record cannot support.
   */
  category?: UnitCategoryView | null
}

/**
 * Collapse a run of equal installments into one line.
 *
 * A sixty-installment plan printed at sixty rows makes the document four pages of
 * the same number. The fold keeps the arithmetic exact — the run's amount is the
 * per-installment figure times the count — and never touches the down payment,
 * because it is a different promise from the installments. A run of one prints
 * under its original label, so nothing is renamed unless it is actually a run.
 */

export function groupPlanItems(
  items: readonly QuotePlanItem[],
): QuotePlanItem[] {
  const grouped: QuotePlanItem[] = []

  let index = 0

  while (index < items.length) {
    const item = items[index]!

    const isInstallment = item.label.startsWith("Installment ")

    let runEnd = index

    while (
      isInstallment &&
      runEnd + 1 < items.length &&
      items[runEnd + 1]!.amount === item.amount
    ) {
      runEnd += 1
    }

    if (isInstallment && runEnd > index) {
      const first = Number(item.label.slice("Installment ".length))

      const last = Number(items[runEnd]!.label.slice("Installment ".length))

      grouped.push({
        label: `Installments ${first}–${last}`,

        amount: item.amount * (runEnd - index + 1),
      })
    } else {
      grouped.push(item)
    }

    index = runEnd + 1
  }

  return grouped
}

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

function QuotationDocument({
  quote,

  currency,

  tenant,

  projectName,

  category = null,
}: QuotationDocumentProps) {
  const money = (value: number) =>
    formatCurrency(value, currency, { maximumFractionDigits: 0 })

  const recipientLine = [
    quote.recipientName,

    quote.recipientType === "customer" ? "Customer" : "Lead",
  ].join(" · ")

  const unitLine = quote.unitCode

  // What the buyer is being quoted, in the words this workspace uses for it. Built from
  // the resolved labels rather than the keys, so a paper offer still reads correctly after
  // an admin renames or retires the option the unit sits on. Each line joins what is set
  // and prints a dash for what is not: a quotation must not look like the seller chose a
  // property type they never recorded.
  const propertyLine = category
    ? orDash(
        [
          category.propertyTypeLabel,
          category.subtypeLabel,
          category.furnishingLabel,
        ]
          .filter((part) => part !== null && part !== "")
          .join(" · "),
      )
    : ""

  const usageLine = category
    ? orDash(
        [category.usageLabel, category.ownershipLabel]
          .filter((part) => part !== null && part !== "")
          .join(" · "),
      )
    : ""

  const sizeLine = category ? orDash(category.sizeDisplay) : ""

  const detailsLine = category ? orDash(category.detailSummary.join(" · ")) : ""

  const possessionLine = category ? orDash(category.possessionLabel) : ""

  const saleModeLine = category ? orDash(category.saleModeLabel) : ""

  const addressLine = category
    ? [category.address, category.areaCity]
        .filter((part) => part !== null && part !== "")
        .join(", ")
    : ""

  const amenitiesLine = category
    ? category.amenities.slice(0, 8).join(", ")
    : ""

  // The stored plan is the only source for the down payment: the server keeps the

  // percentage and the count, but the amount itself lives in the plan's first

  // item, so the document reads it back rather than re-deriving it.

  const downPayment = quote.paymentPlan[0]?.amount ?? 0

  const planItems = groupPlanItems(quote.paymentPlan)

  return (
    <article
      className="bg-card text-foreground"
      style={{ fontFamily: "var(--font-sans)" }}
    >
      {/* Letterhead */}
      <header className="flex items-start justify-between gap-6 border-b border-border-strong pb-4">
        <div className="min-w-0">
          <p className="text-[15px] leading-5 font-semibold tracking-tight">
            {tenant ? orDash(tenant.legalName ?? tenant.name) : "—"}
          </p>

          <div className="mt-1.5 flex flex-col gap-0.5 text-[10.5px] leading-4 text-muted-foreground">
            <p>{tenant ? orDash(tenant.address) : "—"}</p>
            <p>
              {tenant
                ? [tenant.phone, tenant.email].filter(Boolean).join(" · ") ||
                  "—"
                : "—"}
            </p>
            <p>
              {tenant?.registrationNumber
                ? `Reg. ${tenant.registrationNumber}`
                : "—"}
            </p>
          </div>
        </div>

        <div className="shrink-0 text-right">
          <p className="text-[13px] font-semibold tracking-[0.14em] uppercase">
            Quotation
          </p>

          <p className="mt-1 text-[11px] tabular-nums text-muted-foreground">
            {quote.quoteNumber}
          </p>

          <p className="text-[11px] tabular-nums text-muted-foreground">
            {formatDate(quote.issuedAt)}
          </p>
        </div>
      </header>

      {/* Addressed to / for */}
      <section className="grid grid-cols-2 gap-6 border-b border-border py-4">
        <DocMeta label="Addressed to">{recipientLine}</DocMeta>

        <DocMeta label="Project">{orDash(projectName)}</DocMeta>

        <DocMeta label="Quotation number">{quote.quoteNumber}</DocMeta>

        <DocMeta label="Issued by">{orDash(quote.issuedByName)}</DocMeta>
      </section>

      {/* What is being sold */}
      {category !== null ? (
        <section className="grid grid-cols-2 gap-6 border-b border-border py-4">
          <DocMeta label="Property">{propertyLine}</DocMeta>

          <DocMeta label="Usage">{usageLine}</DocMeta>

          <DocMeta label="Size">{sizeLine}</DocMeta>

          <DocMeta label="Key details">{detailsLine}</DocMeta>

          <DocMeta label="Possession">{possessionLine}</DocMeta>

          <DocMeta label="Payment mode">{saleModeLine}</DocMeta>

          {addressLine !== "" && (
            <div className="col-span-2">
              <DocMeta label="Address">{addressLine}</DocMeta>
            </div>
          )}

          {amenitiesLine !== "" && (
            <div className="col-span-2">
              <DocMeta label="Amenities">{amenitiesLine}</DocMeta>
            </div>
          )}
        </section>
      ) : null}

      {/* Price build-up */}
      <section className="py-4">
        <p className="text-[9.5px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
          Unit and pricing
        </p>

        <table className="mt-2 w-full border-collapse text-[12px]">
          <tbody>
            <tr>
              <td className="border-b border-border py-1.5 pr-3 text-muted-foreground">
                Unit {unitLine}
                <span className="block text-[10.5px]">
                  Offered at the recorded base price
                </span>
              </td>

              <td className="border-b border-border py-1.5 text-right tabular-nums">
                {money(quote.basePrice)}
              </td>
            </tr>

            <tr>
              <td className="border-b border-border py-1.5 pr-3">
                Discount
                <span className="block text-[10.5px] text-muted-foreground">
                  {discountLabel(
                    quote.discountType,
                    quote.discountValue,
                    currency,
                  )}
                </span>
              </td>

              <td className="border-b border-border py-1.5 text-right tabular-nums">
                {quote.discountAmount > 0
                  ? `−${money(quote.discountAmount)}`
                  : money(0)}
              </td>
            </tr>

            <tr>
              <td className="border-b border-border py-1.5 pr-3">
                Extra charges
                <span className="block text-[10.5px] text-muted-foreground">
                  Fees and charges added to this offer
                </span>
              </td>

              <td className="border-b border-border py-1.5 text-right tabular-foreground tabular-nums">
                {quote.extraCharges > 0
                  ? `+${money(quote.extraCharges)}`
                  : money(0)}
              </td>
            </tr>

            <tr>
              <td className="border-b-2 border-border-strong py-2 pr-3 text-[12.5px] font-semibold">
                Total quoted price
              </td>

              <td className="border-b-2 border-border-strong py-2 text-right text-[13px] font-semibold tabular-nums">
                {money(quote.total)}
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      {/* Payment plan */}
      <section className="border-t border-border py-4">
        <p className="text-[9.5px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
          Proposed payment plan
        </p>

        <p className="mt-1 text-[11px] text-muted-foreground">
          {quote.downPaymentPercent}% down ·{" "}
          {formatNumber(quote.installmentCount)}{" "}
          {quote.installmentCount === 1 ? "installment" : "installments"} ·{" "}
          Balance {money(quote.total - downPayment)}
        </p>

        <table className="mt-2 w-full border-collapse text-[12px]">
          <tbody>
            {planItems.map((item) => (
              <tr key={item.label} className="avoid-break-inside">
                <td className="border-b border-border py-1.5 pr-3 text-muted-foreground">
                  {item.label}
                </td>

                <td className="border-b border-border py-1.5 text-right tabular-nums">
                  {money(item.amount)}
                </td>
              </tr>
            ))}

            <tr className="avoid-break-inside">
              <td className="border-b-2 border-border-strong py-1.5 pr-3 font-semibold">
                Plan total
              </td>

              <td className="border-b-2 border-border-strong py-1.5 text-right font-semibold tabular-nums">
                {money(quote.total)}
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      {/* Notes and terms */}
      {quote.notes !== null && (
        <section className="border-t border-border py-4">
          <p className="text-[9.5px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
            Notes
          </p>

          <p className="mt-1 text-[11.5px] leading-5 whitespace-pre-wrap">
            {quote.notes}
          </p>
        </section>
      )}

      <footer className="border-t border-border-strong pt-3 pb-1 text-[10px] leading-4 text-muted-foreground">
        This quotation states the price offered on {formatDate(quote.issuedAt)}{" "}
        and is subject to the seller's contract and the applicable payment
        schedule. Figures are in {currency}.
      </footer>
    </article>
  )
}

// --- Print dialog -------------------------------------------------------------

interface PrintQuotationDialogProps {
  quote: UnitQuotation | null

  currency: string

  tenant: QuotationTenant | null

  projectName: string

  /** The unit's classification, forwarded to the document. See above. */
  category?: UnitCategoryView | null

  onClose: () => void
}

/**
 * The document inside a dialog, with the one button that matters.
 *
 * "Print / Save as PDF" calls the browser's own print: the stylesheet in
 * `src/index.css` then strips the application away to `[data-document-print]`
 * alone. The toolbar lives in the footer and carries `data-no-print` so it is
 * chrome on screen and nothing on paper.
 */

export function PrintQuotationDialog({
  quote,

  currency,

  tenant,

  projectName,

  category = null,

  onClose,
}: PrintQuotationDialogProps) {
  return (
    <Dialog
      open={quote !== null}
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
            {quote ? `Quotation ${quote.quoteNumber}` : "Quotation"}
          </DialogTitle>

          <DialogDescription>
            Review the document, then print or save it as a PDF.
          </DialogDescription>
        </DialogHeader>

        {quote && (
          <div className="scrollbar-slim min-h-0 flex-1 overflow-y-auto border border-border bg-muted/20 p-3 sm:p-5">
            <div className="mx-auto max-w-[38rem] border border-border bg-card p-6 shadow-card sm:p-8">
              <QuotationDocument
                quote={quote}
                currency={currency}
                tenant={tenant}
                projectName={projectName}
                category={category}
              />
            </div>
          </div>
        )}

        <DialogFooter className="print-hidden">
          <Button variant="outline" data-no-print="" onClick={onClose}>
            Close
          </Button>

          <Button onClick={() => window.print()} disabled={quote === null}>
            <Printer size={13} />
            Print / Save as PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
