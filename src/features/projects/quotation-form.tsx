/**
 * The issue-quotation form.
 *
 * Everything the quote needs lives on one screen: who it is addressed to, the
 * discount, the extra charges, and the shape of the proposed plan. The preview
 * under the fields is not decoration — a quotation is a figure you are about to
 * put in front of a client, and a form that only showed the total after saving
 * would make the paper an IOU for a number you have not seen yet.
 *
 * The preview runs the server's own arithmetic (`src/lib/quotation-calc.ts`), and
 * validation mirrors its bounds, so what the preview shows is what the stored
 * quote will say. The create call still runs through `useSave`, because the
 * server is the one that decides: its field errors land beside their controls and
 * override the client's mirror wherever the two disagree.
 *
 * The recipient list is a plain select of the workspace's leads or customers:
 * the server checks the chosen id belongs to this tenant, and a picker built on
 * the same lists the Leads and Customers modules use cannot offer a name that
 * does not exist.
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

import { Input } from "@/components/ui/input"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

import { Textarea } from "@/components/ui/textarea"

import { Field, FieldGrid } from "@/components/field"

import { formatCurrency } from "@/lib/format"

import { useSave } from "@/features/organization/use-save"

import {
  buildQuotationPreview,
  emptyQuotationForm,
  QUOTATION_BOUNDS,
  type QuotationFormState,
} from "@/lib/quotation-calc"

import {
  projectInventoryApi,
  type UnitQuotation,
  type UnitView,
} from "@/lib/project-inventory-api"

import {
  customersApi,
  leadsApi,
  type CustomerListItem,
  type Lead,
} from "@/lib/leads-api"

import { useAsyncResource } from "@/lib/use-async-resource"

import { UNIT_PRICE_MAX } from "@shared/inventory"

interface QuotationFormDialogProps {
  /** Null closes the dialog; the unit being quoted otherwise. */

  unit: UnitView | null

  projectId: string

  currency: string

  /** Whether the recipient lists may be fetched at all — the server gates them too. */

  canReadLeads: boolean

  canReadCustomers: boolean

  onClose: () => void

  /**
   * Called with the quote the server actually stored, once the create lands. The
   * caller reloads the history and opens the print preview on this record rather
   * than on the form's draft, so the paper a client is handed matches the row in
   * the trail.
   */

  onIssued: (quote: UnitQuotation) => void
}

export function QuotationFormDialog({
  unit,

  projectId,

  currency,

  canReadLeads,

  canReadCustomers,

  onClose,

  onIssued,
}: QuotationFormDialogProps) {
  const [form, setForm] = useState<QuotationFormState>(() =>
    emptyQuotationForm(),
  )

  const save = useSave()

  // A fresh form for a different unit: nobody should be able to carry a draft

  // addressed to one buyer onto another unit's quote by clicking through the

  // table fast.

  useEffect(() => {
    if (unit) setForm(emptyQuotationForm())
  }, [unit])

  const open = unit !== null

  const leads = useAsyncResource(
    (signal) => leadsApi.list(signal),

    open && canReadLeads,
  )

  const customers = useAsyncResource(
    (signal) => customersApi.list(signal),

    open && canReadCustomers,
  )

  const basePrice = unit?.basePrice ?? 0

  // A lump-sum listing is sold for one settlement, and the booking refuses a schedule for
  // it. The plan fields stay open — a quote may still record when the single payment is
  // due — but the form says up front that this shape will not survive into the booking.
  const lumpSumOnly = unit !== null && !unit.category.allowsInstallments

  const preview = useMemo(
    () => buildQuotationPreview(form, basePrice),

    [form, basePrice],
  )

  const recipientOptions =
    form.recipientType === "lead"
      ? (leads.data?.leads ?? []).map((lead: Lead) => ({
          id: lead.id,

          primary: lead.name,

          secondary: lead.phone,
        }))
      : (customers.data?.customers ?? []).map((customer: CustomerListItem) => ({
          id: customer.id,

          primary: customer.name,

          secondary: customer.phone,
        }))

  function patch(next: Partial<QuotationFormState>) {
    setForm((current) => ({ ...current, ...next }))
  }

  // The client's mirror first, with the server's message for the same key

  // taking precedence when both exist: the two should not disagree, and if they

  // ever do it is because a bound moved on the server, which is the authority.

  function errorFor(key: string): string | undefined {
    return save.fields[key] ?? preview.errors[key]
  }

  async function submit() {
    // A local copy so the narrowed type survives into the deferred `save.run`

    // callback: TypeScript keeps a `const` narrow but not a property access.

    const recipientId = preview.recipientId

    if (preview.quote === null || recipientId === null) return

    const created = await save.run(async () => {
      const result = await projectInventoryApi.createQuotation(
        projectId,

        unit?.id ?? "",

        {
          leadId: form.recipientType === "lead" ? recipientId : undefined,

          customerId:
            form.recipientType === "customer" ? recipientId : undefined,

          discountType: form.discountType,

          discountValue: Number(form.discountValue || 0),

          extraCharges: Number(form.extraCharges || 0),

          downPaymentPercent: Number(form.downPaymentPercent || 20),

          installmentCount: Number(form.installmentCount || 1),

          notes: form.notes,
        },
      )

      // Hand the stored record over before closing: the caller opens the print

      // preview on it, so the document is the quote as saved, not as typed.

      onIssued(result.quote)
    })

    // A refusal keeps the dialog and the draft open beside the message; only a

    // stored quote closes it.

    if (created) {
      save.clear()

      setForm(emptyQuotationForm())

      onClose()
    }
  }

  const money = (value: number) =>
    formatCurrency(value, currency, { maximumFractionDigits: 0 })

  const recipientResource = form.recipientType === "lead" ? leads : customers

  const recipientGrantMissing =
    form.recipientType === "lead" ? !canReadLeads : !canReadCustomers

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {unit ? `Issue quotation — ${unit.unitCode}` : "Issue quotation"}
          </DialogTitle>

          <DialogDescription>
            Price the offer, choose the buyer, and shape the plan. The preview
            is the arithmetic the quotation will be stored with.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="scrollbar-slim flex flex-col gap-4">
          {save.error && (
            <Alert variant="danger">
              <AlertDescription>{save.error}</AlertDescription>
            </Alert>
          )}

          {/* Recipient ---------------------------------------------------- */}
          <fieldset className="flex flex-col gap-2.5">
            <legend className="mb-1.5 text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
              Addressed to
            </legend>

            <div className="flex items-center gap-1.5 self-start rounded-md border border-border bg-muted/20 p-0.5">
              <Button
                size="sm"
                variant={form.recipientType === "lead" ? "default" : "ghost"}
                className="h-6"
                onClick={() => patch({ recipientType: "lead" })}
              >
                Lead
              </Button>

              <Button
                size="sm"
                variant={
                  form.recipientType === "customer" ? "default" : "ghost"
                }
                className="h-6"
                onClick={() => patch({ recipientType: "customer" })}
              >
                Customer
              </Button>
            </div>

            <Field
              label={form.recipientType === "lead" ? "Lead" : "Customer"}
              htmlFor="quotation-recipient"
              required
              error={errorFor("recipient")}
              hint={
                recipientGrantMissing
                  ? "Your role cannot read the lead records, so this quote cannot be addressed to one."
                  : undefined
              }
            >
              <Select
                value={
                  form.recipientType === "lead" ? form.leadId : form.customerId
                }
                onValueChange={(value) =>
                  patch(
                    form.recipientType === "lead"
                      ? { leadId: value }
                      : { customerId: value },
                  )
                }
                disabled={
                  recipientGrantMissing ||
                  recipientResource.loading ||
                  recipientOptions.length === 0
                }
              >
                <SelectTrigger id="quotation-recipient">
                  <SelectValue
                    placeholder={
                      recipientGrantMissing
                        ? "No access to this list"
                        : recipientResource.loading
                          ? "Loading…"
                          : recipientOptions.length === 0
                            ? "No one to choose yet"
                            : "Choose a recipient"
                    }
                  />
                </SelectTrigger>

                <SelectContent>
                  {recipientOptions.map((option) => (
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

            {recipientResource.error && (
              <Alert variant="danger">
                <AlertDescription>
                  The recipient list could not be loaded:{" "}
                  {recipientResource.error}
                </AlertDescription>
              </Alert>
            )}
          </fieldset>

          {/* Pricing ------------------------------------------------------ */}
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-1.5 text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
              Price and charges
            </legend>

            <p className="text-[12px] text-muted-foreground">
              Unit base price:{" "}
              <span className="font-medium text-foreground tabular-nums">
                {money(basePrice)}
              </span>
            </p>

            <FieldGrid>
              <Field
                label="Discount type"
                htmlFor="quotation-discount-type"
                hint="A percentage of the base price, or a fixed amount off it."
              >
                <Select
                  value={form.discountType}
                  onValueChange={(value) =>
                    patch({
                      discountType: value === "fixed" ? "fixed" : "percent",
                    })
                  }
                >
                  <SelectTrigger id="quotation-discount-type">
                    <SelectValue />
                  </SelectTrigger>

                  <SelectContent>
                    <SelectItem value="percent">Percentage</SelectItem>

                    <SelectItem value="fixed">Fixed amount</SelectItem>
                  </SelectContent>
                </Select>
              </Field>

              <Field
                label={
                  form.discountType === "percent"
                    ? "Discount (%)"
                    : "Discount amount"
                }
                htmlFor="quotation-discount-value"
                error={errorFor("discountValue")}
              >
                <Input
                  id="quotation-discount-value"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={
                    form.discountType === "percent"
                      ? QUOTATION_BOUNDS.discountPercentMax
                      : UNIT_PRICE_MAX
                  }
                  step={1}
                  value={form.discountValue}
                  onChange={(event) =>
                    patch({ discountValue: event.target.value })
                  }
                  placeholder="0"
                />
              </Field>

              <Field
                label="Extra charges"
                htmlFor="quotation-extra-charges"
                error={errorFor("extraCharges")}
                hint="Fees added on top, in the listing currency."
                className="sm:col-span-2"
              >
                <Input
                  id="quotation-extra-charges"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={UNIT_PRICE_MAX}
                  step={1}
                  value={form.extraCharges}
                  onChange={(event) =>
                    patch({ extraCharges: event.target.value })
                  }
                  placeholder="0"
                />
              </Field>
            </FieldGrid>
          </fieldset>

          {/* Plan --------------------------------------------------------- */}
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-1.5 text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
              Proposed payment plan
            </legend>

            {lumpSumOnly && (
              <p className="-mt-1 text-[11.5px] leading-4 text-muted-foreground">
                This unit is listed {unit?.category.saleModeLabel ?? "lump sum"}
                , so a booking of it is taken without an installment plan.
                Whatever is shaped here will not carry over as a schedule.
              </p>
            )}

            <FieldGrid>
              <Field
                label="Down payment (%)"
                htmlFor="quotation-down-payment"
                error={errorFor("downPaymentPercent")}
              >
                <Input
                  id="quotation-down-payment"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={QUOTATION_BOUNDS.downPaymentPercentMax}
                  step={1}
                  value={form.downPaymentPercent}
                  onChange={(event) =>
                    patch({ downPaymentPercent: event.target.value })
                  }
                />
              </Field>

              <Field
                label="Number of installments"
                htmlFor="quotation-installments"
                error={errorFor("installmentCount")}
                hint={`Between ${QUOTATION_BOUNDS.installmentMin} and ${QUOTATION_BOUNDS.installmentMax}. The balance splits evenly, remainder first.`}
              >
                <Input
                  id="quotation-installments"
                  type="number"
                  inputMode="numeric"
                  min={QUOTATION_BOUNDS.installmentMin}
                  max={QUOTATION_BOUNDS.installmentMax}
                  step={1}
                  value={form.installmentCount}
                  onChange={(event) =>
                    patch({ installmentCount: event.target.value })
                  }
                />
              </Field>
            </FieldGrid>
          </fieldset>

          {/* Notes -------------------------------------------------------- */}
          <Field
            label="Notes on the quotation"
            htmlFor="quotation-notes"
            error={errorFor("notes")}
            hint={`Shown on the printed document. ${QUOTATION_BOUNDS.notesMax.toLocaleString("en-US")} characters or fewer.`}
          >
            <Textarea
              id="quotation-notes"
              rows={3}
              value={form.notes}
              onChange={(event) => patch({ notes: event.target.value })}
            />
          </Field>

          {/* Preview ------------------------------------------------------ */}
          <div className="rounded-md border border-border bg-muted/20 p-3">
            <p className="text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
              Preview
            </p>

            {preview.quote ? (
              <>
                <div className="mt-2 flex flex-col gap-1 text-[12px]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">Base price</span>

                    <span className="tabular-nums">{money(basePrice)}</span>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">Discount</span>

                    <span className="tabular-nums text-muted-foreground">
                      −{money(preview.quote.discountAmount)}
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">Extra charges</span>

                    <span className="tabular-nums">
                      {money(preview.quote.extraCharges)}
                    </span>
                  </div>

                  <div className="mt-1 flex items-center justify-between gap-2 border-t border-border-strong pt-2 text-[13px] font-semibold">
                    <span>Total quoted</span>

                    <span className="tabular-nums">
                      {money(preview.quote.total)}
                    </span>
                  </div>
                </div>

                <div className="mt-3 border-t border-border pt-2 text-[12px]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">
                      {preview.quote.paymentPlan[0]?.label ?? "Down payment"}
                    </span>

                    <span className="tabular-nums">
                      {money(preview.quote.downPayment)}
                    </span>
                  </div>

                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">
                      Balance over{" "}
                      <span className="tabular-nums">
                        {Number(form.installmentCount || 12)}
                      </span>{" "}
                      {Number(form.installmentCount || 12) === 1
                        ? "installment"
                        : "installments"}
                    </span>

                    <span className="tabular-nums">
                      {money(preview.quote.balance)}
                    </span>
                  </div>

                  <p className="mt-1 text-[11.5px] leading-4 text-muted-foreground">
                    {(() => {
                      // Read the split back off the plan rather than restating

                      // the division: the plan is what the quote will carry, and

                      // when a remainder exists the installments are not all

                      // the same figure and the note has to say which are which.

                      const first = preview.quote?.paymentPlan[1]?.amount ?? 0

                      const second =
                        preview.quote?.paymentPlan[2]?.amount ?? first

                      if (preview.quote === null) return null

                      return second === first
                        ? `${money(first)} each.`
                        : `${money(second)} each, the first ${preview.quote.remainder} at ${money(first)}.`
                    })()}
                  </p>
                </div>
              </>
            ) : (
              <p className="mt-2 text-[12px] text-muted-foreground">
                Complete the fields above — a whole number in each — to see the
                total and the plan.
              </p>
            )}
          </div>
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={save.saving}>
            Cancel
          </Button>

          <Button
            onClick={submit}
            disabled={preview.quote === null || save.saving}
          >
            {save.saving ? "Issuing…" : "Issue quotation"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
