/**
 * Raise a vendor invoice.
 *
 * Creating an invoice is the payable-side of the ledger: it writes an
 * `invoice` row (positive) so the vendor's running balance goes up by the same
 * figure inside the same server transaction. The dialog only offers the
 * fields a raise needs: reference, amount, issue/due dates, and an optional
 * link to a contract that belongs to the same vendor.
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

import { vendorsApi, type VendorInvoiceInput } from "@/lib/vendors-api"

import {
  VENDOR_INVOICE_AMOUNT_MAX,
  VENDOR_INVOICE_REFERENCE_MAX,
} from "@shared/vendors"

interface VendorInvoiceDialogProps {
  open: boolean

  onOpenChange: (open: boolean) => void

  vendorId: string

  onSaved: () => void
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function emptyDraft(): VendorInvoiceInput {
  return {
    reference: "",

    amount: 0,

    issuedAt: today(),

    dueAt: null,

    contractId: null,

    note: null,
  }
}

export function VendorInvoiceDialog({
  open,

  onOpenChange,

  vendorId,

  onSaved,
}: VendorInvoiceDialogProps) {
  const [draft, setDraft] = useState<VendorInvoiceInput>(() => emptyDraft())

  const save = useSave()

  const contracts = vendorsApi.listContracts

  const [contractOptions, setContractOptions] = useState<Array<{
    id: string
    reference: string
    title: string
  }>>([])

  useEffect(() => {
    if (!open) return

    setDraft(emptyDraft())

    save.clear()

    void contracts(vendorId)

      .then((result) =>
        setContractOptions(
          result.contracts.map((contract) => ({
            id: contract.id,

            reference: contract.reference,

            title: contract.title,
          })),
        ),
      )

      .catch(() => setContractOptions([]))

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, vendorId])

  function set<K extends keyof VendorInvoiceInput>(
    key: K,

    value: VendorInvoiceInput[K],
  ) {
    setDraft((current) => ({ ...current, [key]: value }))

    save.clear()
  }

  async function submit() {
    const body: VendorInvoiceInput = {
      ...draft,

      reference: draft.reference.trim(),

      issuedAt: `${draft.issuedAt.slice(0, 10)}T00:00:00.000Z`,

      dueAt: draft.dueAt ? `${draft.dueAt.slice(0, 10)}T00:00:00.000Z` : null,

      note: draft.note?.toString().trim() || null,
    }

    const done = await save.run(async () => {
      await vendorsApi.createInvoice(vendorId, body)

      onSaved()
    })

    if (done) onOpenChange(false)
  }

  const errorFor = (key: string) => save.fields[key]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[32rem]">
        <DialogHeader>
          <DialogTitle>New invoice</DialogTitle>
          <DialogDescription>
            A payable raised against this vendor. The ledger picks it up
            immediately as an invoice line.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-3">
          {save.error ? (
            <Alert variant="danger">
              <AlertDescription>{save.error}</AlertDescription>
            </Alert>
          ) : null}

          <Field
            label="Reference"
            htmlFor="invoice-reference"
            error={errorFor("reference")}
            required
          >
            <Input
              id="invoice-reference"
              value={draft.reference}
              maxLength={VENDOR_INVOICE_REFERENCE_MAX}
              onChange={(event) => set("reference", event.target.value)}
            />
          </Field>

          <Field
            label="Amount"
            htmlFor="invoice-amount"
            error={errorFor("amount")}
            required
          >
            <Input
              id="invoice-amount"
              type="number"
              min={1}
              max={VENDOR_INVOICE_AMOUNT_MAX}
              step={1}
              inputMode="numeric"
              value={draft.amount === 0 ? "" : String(draft.amount)}
              onChange={(event) => {
                const raw = event.target.value.trim()

                const parsed = raw === "" ? 0 : Math.trunc(Number(raw))

                set(
                  "amount",
                  Number.isFinite(parsed) && parsed >= 0 ? parsed : 0,
                )
              }}
            />
          </Field>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field
              label="Issued"
              htmlFor="invoice-issued"
              error={errorFor("issuedAt")}
              required
            >
              <Input
                id="invoice-issued"
                type="date"
                value={draft.issuedAt.slice(0, 10)}
                onChange={(event) => set("issuedAt", event.target.value)}
              />
            </Field>
            <Field
              label="Due (optional)"
              htmlFor="invoice-due"
              error={errorFor("dueAt")}
            >
              <Input
                id="invoice-due"
                type="date"
                value={draft.dueAt?.slice(0, 10) ?? ""}
                onChange={(event) => set("dueAt", event.target.value || null)}
              />
            </Field>
          </div>

          <Field label="Contract (optional)" htmlFor="invoice-contract">
            <Select
              value={draft.contractId ?? "__none"}
              onValueChange={(value) =>
                set("contractId", value === "__none" ? null : value)
              }
            >
              <SelectTrigger id="invoice-contract">
                <SelectValue placeholder="Not tied to a contract" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">Not tied to a contract</SelectItem>
                {contractOptions.map((contract) => (
                  <SelectItem key={contract.id} value={contract.id}>
                    {contract.reference} · {contract.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Note" htmlFor="invoice-note" error={errorFor("note")}>
            <Textarea
              id="invoice-note"
              rows={3}
              value={draft.note ?? ""}
              onChange={(event) => set("note", event.target.value)}
            />
          </Field>
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={save.saving}>
            {save.saving ? "Raising…" : "Raise invoice"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
