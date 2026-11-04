/**
 * The payment-plan builder, previewed before it is confirmed.
 *
 * A plan is financed off the booking amount — a down payment as a percent, a run of
 * installments at a chosen frequency, an optional closing balloon, and flat charges
 * amortized across the lines. Every field is free to set, but the table underneath is
 * computed by the *same* schedule the server writes (`buildPaymentPlanPreview` →
 * `shared/payment-plan-schedule`), so the dated lines shown here are exactly the rows
 * a confirm will store. That is the whole point of the dialog: no figure is promised
 * that the stored plan could contradict.
 *
 * The net amount comes from the booking rather than a field, so it is a prop and never
 * editable. Confirming calls the server, which re-checks the grant and refuses to
 * replace a plan that already exists; on success the caller reloads the schedule.
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

import { useSave } from "@/features/organization/use-save"

import {
  buildPaymentPlanPreview,
  emptyPaymentPlanForm,
  formatPlanMoney,
  type PaymentPlanFormState,
} from "@/lib/payment-plan-calc"

import { paymentsApi, type ConfirmPlanInput } from "@/lib/payments-api"

import {
  FREQUENCIES,
  FREQUENCY_LABELS,
  INSTALLMENT_KIND_LABELS,
  PLAN_NOTES_MAX,
  type Frequency,
} from "@shared/payment-plans"

interface PaymentPlanBuilderDialogProps {
  open: boolean

  bookingId: string

  /** The booking amount the plan is financed off; never editable here. */

  netAmount: number

  currency: string

  /** First due date the form opens on — usually the booking date. */

  defaultStartDate: string

  onClose: () => void

  onConfirmed: () => void
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

export function PaymentPlanBuilderDialog({
  open,

  bookingId,

  netAmount,

  currency,

  defaultStartDate,

  onClose,

  onConfirmed,
}: PaymentPlanBuilderDialogProps) {
  const save = useSave()

  const [form, setForm] = useState<PaymentPlanFormState>(() =>
    emptyPaymentPlanForm(defaultStartDate || todayIso()),
  )

  // Re-arm a fresh plan each time the dialog opens, so a half-built draft on one

  // booking cannot leak onto another.

  useEffect(() => {
    if (open) {
      setForm(emptyPaymentPlanForm(defaultStartDate || todayIso()))

      save.clear()
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, bookingId, defaultStartDate])

  function patch(next: Partial<PaymentPlanFormState>) {
    setForm((current) => ({ ...current, ...next }))

    save.clear()
  }

  // One pass validates every field and computes the dated lines, so the preview and

  // the readiness of the confirm button can never disagree.

  const preview = useMemo(
    () => buildPaymentPlanPreview(form, netAmount),

    [form, netAmount],
  )

  const errorFor = (key: string): string | undefined =>
    preview.errors[key] ?? save.fields[key]

  const money = (value: number) => formatPlanMoney(value, currency)

  const totals = preview.totals

  const lineTotals = useMemo(() => {
    let amount = 0

    let charges = 0

    let total = 0

    for (const line of preview.lines) {
      amount += line.amount

      charges += line.charges

      total += line.total
    }

    return { amount, charges, total }
  }, [preview.lines])

  async function submit() {
    if (!preview.config) return

    const config: ConfirmPlanInput = {
      ...preview.config,

      ...(form.notes.trim() !== "" ? { notes: form.notes.trim() } : {}),
    }

    const done = await save.run(async () => {
      await paymentsApi.confirmPlan(bookingId, config)

      onConfirmed()
    })

    if (done) {
      save.clear()

      onClose()
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Build payment plan</DialogTitle>
          <DialogDescription>
            Finance a net of {money(netAmount)} across a down payment, a run of
            installments, and an optional balloon. The schedule below is what
            will be stored once confirmed.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="scrollbar-slim flex flex-col gap-4">
          {save.error ? (
            <Alert variant="danger">
              <AlertDescription>{save.error}</AlertDescription>
            </Alert>
          ) : null}

          <FieldGrid>
            <Field
              label="Down payment"
              htmlFor="plan-down-percent"
              error={errorFor("downPaymentPercent")}
              hint={
                totals
                  ? `${money(totals.downPayment)} on ${form.startDate || "the start date"}.`
                  : "Percent of the net amount, 0 to 100."
              }
            >
              <Input
                id="plan-down-percent"
                type="number"
                min={0}
                max={100}
                step={1}
                inputMode="numeric"
                value={form.downPaymentPercent}
                onChange={(event) =>
                  patch({ downPaymentPercent: event.target.value })
                }
              />
            </Field>

            <Field
              label="First due date"
              htmlFor="plan-start-date"
              required
              error={errorFor("startDate")}
            >
              <Input
                id="plan-start-date"
                type="date"
                value={form.startDate}
                onChange={(event) => patch({ startDate: event.target.value })}
              />
            </Field>

            <Field
              label="Frequency"
              htmlFor="plan-frequency"
              required
              error={errorFor("frequency")}
            >
              <Select
                value={form.frequency}
                onValueChange={(value) =>
                  patch({ frequency: value as Frequency })
                }
              >
                <SelectTrigger id="plan-frequency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FREQUENCIES.map((frequency) => (
                    <SelectItem key={frequency} value={frequency}>
                      {FREQUENCY_LABELS[frequency]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            {form.frequency === "custom" ? (
              <Field
                label="Interval (days)"
                htmlFor="plan-custom-interval"
                required
                error={errorFor("customIntervalDays")}
                hint="Days between installments, 1 to 365."
              >
                <Input
                  id="plan-custom-interval"
                  type="number"
                  min={1}
                  max={365}
                  step={1}
                  inputMode="numeric"
                  value={form.customIntervalDays}
                  onChange={(event) =>
                    patch({ customIntervalDays: event.target.value })
                  }
                />
              </Field>
            ) : null}

            <Field
              label="Installments"
              htmlFor="plan-installment-count"
              required
              error={errorFor("installmentCount")}
              hint="Whole number of installment lines, 1 to 360."
            >
              <Input
                id="plan-installment-count"
                type="number"
                min={1}
                max={360}
                step={1}
                inputMode="numeric"
                value={form.installmentCount}
                onChange={(event) =>
                  patch({ installmentCount: event.target.value })
                }
              />
            </Field>

            <Field
              label="Balloon"
              htmlFor="plan-balloon"
              error={errorFor("balloonAmount")}
              hint="Optional lump sum at the very end. Blank means none."
            >
              <Input
                id="plan-balloon"
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                value={form.balloonAmount}
                onChange={(event) =>
                  patch({ balloonAmount: event.target.value })
                }
              />
            </Field>

            <Field
              label="Charges"
              htmlFor="plan-charges"
              error={errorFor("charges")}
              hint="Flat total, amortized evenly across the installments."
            >
              <Input
                id="plan-charges"
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                value={form.charges}
                onChange={(event) => patch({ charges: event.target.value })}
              />
            </Field>
          </FieldGrid>

          <Field
            label="Notes"
            htmlFor="plan-notes"
            error={errorFor("notes")}
            hint={`${form.notes.length}/${PLAN_NOTES_MAX} characters.`}
          >
            <Textarea
              id="plan-notes"
              rows={2}
              maxLength={PLAN_NOTES_MAX}
              value={form.notes}
              onChange={(event) => patch({ notes: event.target.value })}
              placeholder="Optional note on how this plan was agreed."
            />
          </Field>

          {/* Live schedule: the exact lines a confirm will store. */}
          <div className="flex flex-col gap-2">
            <p className="text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
              Schedule preview
            </p>

            {preview.config ? (
              <div className="overflow-hidden rounded-md border border-border">
                <table className="w-full border-collapse text-[12px]">
                  <thead>
                    <tr className="bg-muted/40 text-[11px] tracking-[0.04em] text-muted-foreground uppercase">
                      <th className="px-3 py-1.5 text-right font-semibold">
                        #
                      </th>
                      <th className="px-3 py-1.5 text-left font-semibold">
                        Line
                      </th>
                      <th className="px-3 py-1.5 text-left font-semibold">
                        Due
                      </th>
                      <th className="px-3 py-1.5 text-right font-semibold">
                        Amount
                      </th>
                      <th className="px-3 py-1.5 text-right font-semibold">
                        Charges
                      </th>
                      <th className="px-3 py-1.5 text-right font-semibold">
                        Total
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.lines.map((line) => (
                      <tr key={line.number} className="border-t border-border">
                        <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                          {line.number}
                        </td>
                        <td className="px-3 py-1.5 text-foreground">
                          {INSTALLMENT_KIND_LABELS[line.kind]}
                        </td>
                        <td className="px-3 py-1.5 whitespace-nowrap tabular-nums text-muted-foreground">
                          {line.dueDate}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums">
                          {money(line.amount)}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                          {money(line.charges)}
                        </td>
                        <td className="px-3 py-1.5 text-right font-medium tabular-nums">
                          {money(line.total)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-border-strong font-semibold">
                      <td className="px-3 py-2 text-right" colSpan={3}>
                        {preview.endDate ? `Ends ${preview.endDate}` : "Total"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {money(lineTotals.amount)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {money(lineTotals.charges)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {money(lineTotals.total)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            ) : (
              <p className="rounded-md border border-dashed border-border px-3 py-4 text-[12px] text-muted-foreground">
                {Object.keys(preview.errors).length > 0
                  ? "Fix the fields above to see the dated schedule."
                  : "Fill in the plan to see its schedule."}
              </p>
            )}
          </div>
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={save.saving}>
            Cancel
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={!preview.config || save.saving}
          >
            {save.saving ? "Confirming…" : "Confirm plan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
