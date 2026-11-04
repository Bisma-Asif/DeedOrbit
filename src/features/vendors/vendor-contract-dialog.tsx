/**
 * Add or edit a vendor contract.
 *
 * A contract is a reference the tenant uses to group invoices and payments
 * against a supplier engagement. It carries a value, an optional date window,
 * and a status. Editing after creation only changes title/notes/status; the
 * reference is stable because it appears on downstream rows.
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

import { vendorsApi, type VendorContractInput } from "@/lib/vendors-api"

import {
  VENDOR_CONTRACT_REFERENCE_MAX,
  VENDOR_CONTRACT_STATUSES,
  VENDOR_CONTRACT_STATUS_LABELS,
  VENDOR_CONTRACT_TITLE_MAX,
  VENDOR_INVOICE_AMOUNT_MAX,
  type VendorContract,
  type VendorContractStatus,
} from "@shared/vendors"

interface VendorContractDialogProps {
  open: boolean

  onOpenChange: (open: boolean) => void

  vendorId: string

  contract: VendorContract | null

  onSaved: () => void
}

function emptyDraft(): VendorContractInput {
  return {
    reference: "",

    title: "",

    value: 0,

    startDate: null,

    endDate: null,

    notes: null,

    status: "active",
  }
}

function fromContract(contract: VendorContract): VendorContractInput {
  return {
    reference: contract.reference,

    title: contract.title,

    value: contract.value,

    startDate: contract.startDate?.slice(0, 10) ?? null,

    endDate: contract.endDate?.slice(0, 10) ?? null,

    notes: contract.notes ?? null,

    status: contract.status,
  }
}

export function VendorContractDialog({
  open,

  onOpenChange,

  vendorId,

  contract,

  onSaved,
}: VendorContractDialogProps) {
  const [draft, setDraft] = useState<VendorContractInput>(() => emptyDraft())

  const save = useSave()

  useEffect(() => {
    if (!open) return

    setDraft(contract ? fromContract(contract) : emptyDraft())

    save.clear()

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, contract])

  function set<K extends keyof VendorContractInput>(
    key: K,

    value: VendorContractInput[K],
  ) {
    setDraft((current) => ({ ...current, [key]: value }))

    save.clear()
  }

  async function submit() {
    const trimmed: VendorContractInput = {
      ...draft,

      reference: draft.reference.trim(),

      title: draft.title.trim(),

      notes: draft.notes?.toString().trim() || null,

      startDate: draft.startDate
        ? `${draft.startDate.slice(0, 10)}T00:00:00.000Z`
        : null,

      endDate: draft.endDate
        ? `${draft.endDate.slice(0, 10)}T00:00:00.000Z`
        : null,
    }

    const done = await save.run(async () => {
      if (contract) {
        await vendorsApi.updateContract(vendorId, contract.id, {
          title: trimmed.title,

          notes: trimmed.notes,

          status: trimmed.status,
        })
      } else {
        await vendorsApi.createContract(vendorId, trimmed)
      }

      onSaved()
    })

    if (done) onOpenChange(false)
  }

  const errorFor = (key: string) => save.fields[key]

  const editingExisting = contract !== null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[32rem]">
        <DialogHeader>
          <DialogTitle>
            {editingExisting ? "Edit contract" : "New contract"}
          </DialogTitle>
          <DialogDescription>
            A contract groups invoices and payments on one supplier engagement.
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
            htmlFor="contract-reference"
            error={errorFor("reference")}
            required
          >
            <Input
              id="contract-reference"
              value={draft.reference}
              maxLength={VENDOR_CONTRACT_REFERENCE_MAX}
              disabled={editingExisting}
              onChange={(event) => set("reference", event.target.value)}
            />
          </Field>

          <Field
            label="Title"
            htmlFor="contract-title"
            error={errorFor("title")}
            required
          >
            <Input
              id="contract-title"
              value={draft.title}
              maxLength={VENDOR_CONTRACT_TITLE_MAX}
              onChange={(event) => set("title", event.target.value)}
            />
          </Field>

          {!editingExisting ? (
            <>
              <Field
                label="Value"
                htmlFor="contract-value"
                error={errorFor("value")}
              >
                <Input
                  id="contract-value"
                  type="number"
                  min={0}
                  max={VENDOR_INVOICE_AMOUNT_MAX}
                  step={1}
                  inputMode="numeric"
                  value={draft.value === 0 ? "" : String(draft.value)}
                  onChange={(event) => {
                    const raw = event.target.value.trim()

                    const parsed = raw === "" ? 0 : Math.trunc(Number(raw))

                    set(
                      "value",

                      Number.isFinite(parsed) && parsed >= 0 ? parsed : 0,
                    )
                  }}
                />
              </Field>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field
                  label="Start date"
                  htmlFor="contract-start"
                  error={errorFor("startDate")}
                >
                  <Input
                    id="contract-start"
                    type="date"
                    value={draft.startDate?.slice(0, 10) ?? ""}
                    onChange={(event) =>
                      set("startDate", event.target.value || null)
                    }
                  />
                </Field>
                <Field
                  label="End date"
                  htmlFor="contract-end"
                  error={errorFor("endDate")}
                >
                  <Input
                    id="contract-end"
                    type="date"
                    value={draft.endDate?.slice(0, 10) ?? ""}
                    onChange={(event) =>
                      set("endDate", event.target.value || null)
                    }
                  />
                </Field>
              </div>
            </>
          ) : null}

          <Field label="Status" htmlFor="contract-status">
            <Select
              value={draft.status ?? "active"}
              onValueChange={(value) =>
                set("status", value as VendorContractStatus)
              }
            >
              <SelectTrigger id="contract-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VENDOR_CONTRACT_STATUSES.map((status) => (
                  <SelectItem key={status} value={status}>
                    {VENDOR_CONTRACT_STATUS_LABELS[status]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field
            label="Notes"
            htmlFor="contract-notes"
            error={errorFor("notes")}
          >
            <Textarea
              id="contract-notes"
              rows={3}
              value={draft.notes ?? ""}
              onChange={(event) => set("notes", event.target.value)}
            />
          </Field>
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={save.saving}>
            {save.saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
