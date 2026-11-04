/**
 * One unit's quotation history, and the two dialogs that hang off it.
 *
 * A quotation is an offer that once stood in front of a client, so the trail is
 * append-only: this screen reads the stored snapshots and prints them again, and
 * the only write it offers is a new quote. Nothing here edits or deletes an old
 * one, the same reason the status trail works — a document a client may already
 * hold cannot be rewritten after the fact, and a history that can be quietly
 * amended is not evidence of anything.
 *
 * The list is per unit; the recipient's side of the same trail (per customer or
 * lead) is stored server-side and belongs to a customer view, not to this sheet.
 *
 * Two dialogs open out of this one, and the stacking is deliberate: Radix layers
 * portals in mount order, so the form and the print preview declared here always
 * sit above the history rather than underneath it. Issuing a quote closes the
 * form and opens the print preview of the quote the server actually stored —
 * the figures to hand to a client are the ones that survived validation, not the
 * draft that was typed.
 */

import { useState } from "react"

import { BookOpenCheck, Printer, Quote, RefreshCw } from "lucide-react"

import { Alert, AlertDescription } from "@/components/ui/alert"

import { Badge } from "@/components/ui/badge"

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

import {
  projectInventoryApi,
  type UnitQuotation,
  type UnitView,
} from "@/lib/project-inventory-api"

import { useAsyncResource } from "@/lib/use-async-resource"

import { discountLabel } from "@/lib/quotation-calc"

import { formatCurrency, formatDate } from "@/lib/format"

import { QuotationFormDialog } from "@/features/projects/quotation-form"

import {
  BookingFormDialog,
  type BookingPrefill,
} from "@/features/bookings/booking-form-dialog"

import { useSession } from "@/lib/session-context"

import { navigate } from "@/lib/router"

import {
  PrintQuotationDialog,
  type QuotationTenant,
} from "@/features/projects/quotation-document"

interface UnitQuotationsDialogProps {
  /** Null closes the dialog; the unit whose trail is open otherwise. */

  unit: UnitView | null

  projectId: string

  projectName: string

  currency: string

  /** `inventory.edit` — the right the server's create call also demands. */

  canEdit: boolean

  canReadLeads: boolean

  canReadCustomers: boolean

  tenant: QuotationTenant | null

  onClose: () => void
}

/** One row of the trail: what was offered, to whom, and the paper it is on. */

function QuotationRow({
  quote,

  currency,

  onPrint,

  onBook,

  /** Present only when the role may create a booking from this quote. */
}: {
  quote: UnitQuotation

  currency: string

  onPrint: (quote: UnitQuotation) => void
  onBook?: (quote: UnitQuotation) => void
}) {
  const money = (value: number) =>
    formatCurrency(value, currency, { maximumFractionDigits: 0 })

  return (
    <li className="flex items-start justify-between gap-3 border-b border-border py-2.5 last:border-b-0">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-[11.5px] text-foreground">
            {quote.quoteNumber}
          </span>

          <Badge
            variant={quote.recipientType === "customer" ? "success" : "neutral"}
          >
            {quote.recipientType === "customer" ? "Customer" : "Lead"}
          </Badge>
        </div>

        <p className="mt-0.5 truncate text-[12px] text-foreground">
          {quote.recipientName || "—"}
        </p>

        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {formatDate(quote.issuedAt)} ·{" "}
          {discountLabel(quote.discountType, quote.discountValue, currency)}
          {quote.extraCharges > 0
            ? ` · +${money(quote.extraCharges)} charges`
            : ""}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <span className="text-[12.5px] font-medium tabular-nums">
          {money(quote.total)}
        </span>

        <Button
          variant="outline"
          size="sm"
          onClick={() => onPrint(quote)}
          aria-label={`Print quotation ${quote.quoteNumber}`}
        >
          <Printer size={12} />
          PDF
        </Button>

        {onBook && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onBook(quote)}
            aria-label={`Create booking from quotation ${quote.quoteNumber}`}
          >
            <BookOpenCheck size={12} />
            Book
          </Button>
        )}
      </div>
    </li>
  )
}

export function UnitQuotationsDialog({
  unit,

  projectId,

  projectName,

  currency,

  canEdit,

  canReadLeads,

  canReadCustomers,

  tenant,

  onClose,
}: UnitQuotationsDialogProps) {
  const quotations = useAsyncResource(
    (signal) =>
      projectInventoryApi.quotations(projectId, unit?.id ?? "", signal),

    unit !== null,
  )

  const { can } = useSession()

  const canCreateBooking = can("bookings", "create")

  const [formOpen, setFormOpen] = useState(false)

  const [printQuote, setPrintQuote] = useState<UnitQuotation | null>(null)

  // The booking form is prefilled from whichever quote its "Book" button opened.
  const [bookingPrefill, setBookingPrefill] = useState<BookingPrefill | null>(
    null,
  )

  const entries = quotations.data?.quotations ?? []

  /**
   * A quote has been stored: refresh the trail and open the print preview on the
   * record the server returned.
   *
   * The form owns the create request (so its field errors land beside their
   * controls); this is the one thing the parent still needs to do on success —
   * pull the new row into the list and hand the saved quote to the document.
   */

  function handleIssued(quote: UnitQuotation) {
    setFormOpen(false)

    setPrintQuote(quote)

    void quotations.reload()
  }

  return (
    <>
      <Dialog
        open={unit !== null}
        onOpenChange={(open) => {
          if (!open) onClose()
        }}
      >
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {unit ? `Quotations — ${unit.unitCode}` : "Quotations"}
            </DialogTitle>

            <DialogDescription>
              Every quote issued for this unit, newest first. Quotations are
              stored as issued and are never edited after the fact.
            </DialogDescription>
          </DialogHeader>

          <DialogBody className="flex flex-col gap-2">
            {quotations.error && (
              <Alert variant="danger">
                <AlertDescription>{quotations.error}</AlertDescription>
              </Alert>
            )}

            {quotations.loading && (
              <p className="text-[12px] text-muted-foreground">Loading…</p>
            )}

            {!quotations.loading && !quotations.error && (
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11.5px] text-muted-foreground">
                  {entries.length === 0
                    ? "No quotations issued for this unit yet."
                    : `${entries.length} ${
                        entries.length === 1 ? "quotation" : "quotations"
                      } issued.`}
                </p>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void quotations.reload()}
                >
                  <RefreshCw size={12} />
                  Reload
                </Button>
              </div>
            )}

            {entries.length > 0 && (
              <ul className="list-none">
                {entries.map((quote) => (
                  <QuotationRow
                    key={quote.id}
                    quote={quote}
                    currency={currency}
                    onPrint={setPrintQuote}
                    onBook={
                      canCreateBooking && unit
                        ? (q) =>
                            setBookingPrefill({
                              projectId,
                              unitId: unit.id,
                              unitCode: unit.unitCode,
                              quoteId: q.id,
                              bookingAmount: q.total,
                              leadHint: q.recipientType === "lead",
                            })
                        : undefined
                    }
                  />
                ))}
              </ul>
            )}

            {quotations.data?.truncated && (
              <p className="text-[11.5px] text-muted-foreground">
                Older quotations exist and are not shown.
              </p>
            )}
          </DialogBody>

          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>

            {canEdit && unit && (
              <Button onClick={() => setFormOpen(true)}>
                <Quote size={13} />
                Issue quotation
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <QuotationFormDialog
        unit={formOpen ? unit : null}
        projectId={projectId}
        currency={currency}
        canReadLeads={canReadLeads}
        canReadCustomers={canReadCustomers}
        onClose={() => setFormOpen(false)}
        onIssued={handleIssued}
      />

      <PrintQuotationDialog
        quote={printQuote}
        currency={currency}
        tenant={tenant}
        projectName={projectName}
        category={unit?.category ?? null}
        onClose={() => setPrintQuote(null)}
      />

      <BookingFormDialog
        open={bookingPrefill !== null}
        currency={currency}
        prefill={bookingPrefill}
        onClose={() => setBookingPrefill(null)}
        onCreated={(result) => {
          setBookingPrefill(null)

          if ("booking" in result) {
            navigate(`/bookings/${result.booking.id}`)
          } else {
            navigate("/approvals")
          }
        }}
      />
    </>
  )
}
