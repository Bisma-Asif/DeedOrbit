/**
 * New / edit a vendor profile.
 *
 * The form keeps every field plain-text with a length cap mirrored from the
 * server. Nothing here touches money: the balance shown on the list is folded
 * from the vendor ledger, and an edit to a profile must never move it.
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

import { vendorsApi, type VendorInput } from "@/lib/vendors-api"

import {
  VENDOR_ADDRESS_MAX,
  VENDOR_CITY_MAX,
  VENDOR_CONTACT_MAX,
  VENDOR_COUNTRY_MAX,
  VENDOR_EMAIL_MAX,
  VENDOR_NAME_MAX,
  VENDOR_NOTES_MAX,
  VENDOR_PHONE_MAX,
  VENDOR_STATUSES,
  VENDOR_STATUS_LABELS,
  VENDOR_TAX_ID_MAX,
  type Vendor,
  type VendorStatus,
} from "@shared/vendors"

interface VendorFormDialogProps {
  open: boolean

  onOpenChange: (open: boolean) => void

  vendor: Vendor | null

  onSaved: (vendor: Vendor) => void
}

function emptyDraft(): VendorInput {
  return {
    name: "",

    contactName: "",

    email: "",

    phone: "",

    taxId: "",

    addressLine1: "",

    addressLine2: "",

    city: "",

    countryCode: "",

    notes: "",

    status: "active",
  }
}

function fromVendor(vendor: Vendor): VendorInput {
  return {
    name: vendor.name,

    contactName: vendor.contactName ?? "",

    email: vendor.email ?? "",

    phone: vendor.phone ?? "",

    taxId: vendor.taxId ?? "",

    addressLine1: vendor.addressLine1 ?? "",

    addressLine2: vendor.addressLine2 ?? "",

    city: vendor.city ?? "",

    countryCode: vendor.countryCode ?? "",

    notes: vendor.notes ?? "",

    status: vendor.status,
  }
}

export function VendorFormDialog({
  open,

  onOpenChange,

  vendor,

  onSaved,
}: VendorFormDialogProps) {
  const [draft, setDraft] = useState<VendorInput>(() => emptyDraft())

  const save = useSave()

  useEffect(() => {
    if (!open) return

    setDraft(vendor ? fromVendor(vendor) : emptyDraft())

    save.clear()

    // `save` is stable; listing it in the deps would loop the reset.

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, vendor])

  function set<K extends keyof VendorInput>(key: K, value: VendorInput[K]) {
    setDraft((current) => ({ ...current, [key]: value }))

    save.clear()
  }

  async function submit() {
    const name = draft.name.trim()

    if (name === "") {
      save.clear()

      // Surface via the field-error path so the copy sits under the input.

      save.run(async () => {
        throw new Error("unreachable")
      })

      // Reset the transient save state and set a manual field error below.

      save.clear()

      setDraft((current) => ({ ...current, name: "" }))

      return
    }

    const body: VendorInput = {
      ...draft,

      name,

      contactName: draft.contactName?.toString().trim() || null,

      email: draft.email?.toString().trim() || null,

      phone: draft.phone?.toString().trim() || null,

      taxId: draft.taxId?.toString().trim() || null,

      addressLine1: draft.addressLine1?.toString().trim() || null,

      addressLine2: draft.addressLine2?.toString().trim() || null,

      city: draft.city?.toString().trim() || null,

      countryCode: draft.countryCode?.toString().trim().toUpperCase() || null,

      notes: draft.notes?.toString().trim() || null,
    }

    const done = await save.run(async () => {
      const result = vendor
        ? await vendorsApi.update(vendor.id, body)
        : await vendorsApi.create(body)

      onSaved(result.vendor)
    })

    if (done) onOpenChange(false)
  }

  const errorFor = (key: string) => save.fields[key]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[38rem]">
        <DialogHeader>
          <DialogTitle>{vendor ? "Edit vendor" : "New vendor"}</DialogTitle>
          <DialogDescription>
            The supplier profile. Contracts, invoices, and payments hang off
            this record on the next page.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-3">
          {save.error ? (
            <Alert variant="danger">
              <AlertDescription>{save.error}</AlertDescription>
            </Alert>
          ) : null}

          <Field
            label="Name"
            htmlFor="vendor-name"
            error={errorFor("name")}
            required
          >
            <Input
              id="vendor-name"
              value={draft.name}
              maxLength={VENDOR_NAME_MAX}
              onChange={(event) => set("name", event.target.value)}
            />
          </Field>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field
              label="Contact name"
              htmlFor="vendor-contact"
              error={errorFor("contactName")}
            >
              <Input
                id="vendor-contact"
                value={draft.contactName ?? ""}
                maxLength={VENDOR_CONTACT_MAX}
                onChange={(event) => set("contactName", event.target.value)}
              />
            </Field>
            <Field
              label="Email"
              htmlFor="vendor-email"
              error={errorFor("email")}
            >
              <Input
                id="vendor-email"
                type="email"
                value={draft.email ?? ""}
                maxLength={VENDOR_EMAIL_MAX}
                onChange={(event) => set("email", event.target.value)}
              />
            </Field>
            <Field
              label="Phone"
              htmlFor="vendor-phone"
              error={errorFor("phone")}
            >
              <Input
                id="vendor-phone"
                value={draft.phone ?? ""}
                maxLength={VENDOR_PHONE_MAX}
                onChange={(event) => set("phone", event.target.value)}
              />
            </Field>
            <Field
              label="Tax ID"
              htmlFor="vendor-tax"
              error={errorFor("taxId")}
            >
              <Input
                id="vendor-tax"
                value={draft.taxId ?? ""}
                maxLength={VENDOR_TAX_ID_MAX}
                onChange={(event) => set("taxId", event.target.value)}
              />
            </Field>
          </div>

          <Field
            label="Address line 1"
            htmlFor="vendor-addr-1"
            error={errorFor("addressLine1")}
          >
            <Input
              id="vendor-addr-1"
              value={draft.addressLine1 ?? ""}
              maxLength={VENDOR_ADDRESS_MAX}
              onChange={(event) => set("addressLine1", event.target.value)}
            />
          </Field>

          <Field
            label="Address line 2"
            htmlFor="vendor-addr-2"
            error={errorFor("addressLine2")}
          >
            <Input
              id="vendor-addr-2"
              value={draft.addressLine2 ?? ""}
              maxLength={VENDOR_ADDRESS_MAX}
              onChange={(event) => set("addressLine2", event.target.value)}
            />
          </Field>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_8rem_8rem]">
            <Field label="City" htmlFor="vendor-city" error={errorFor("city")}>
              <Input
                id="vendor-city"
                value={draft.city ?? ""}
                maxLength={VENDOR_CITY_MAX}
                onChange={(event) => set("city", event.target.value)}
              />
            </Field>
            <Field
              label="Country"
              htmlFor="vendor-country"
              error={errorFor("countryCode")}
              hint="ISO alpha-2"
            >
              <Input
                id="vendor-country"
                value={draft.countryCode ?? ""}
                maxLength={VENDOR_COUNTRY_MAX}
                placeholder="AE"
                onChange={(event) =>
                  set("countryCode", event.target.value.toUpperCase())
                }
              />
            </Field>
            <Field label="Status" htmlFor="vendor-status">
              <Select
                value={draft.status ?? "active"}
                onValueChange={(value) => set("status", value as VendorStatus)}
              >
                <SelectTrigger id="vendor-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {VENDOR_STATUSES.map((status) => (
                    <SelectItem key={status} value={status}>
                      {VENDOR_STATUS_LABELS[status]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <Field label="Notes" htmlFor="vendor-notes" error={errorFor("notes")}>
            <Textarea
              id="vendor-notes"
              rows={3}
              maxLength={VENDOR_NOTES_MAX}
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
            {save.saving ? "Saving…" : vendor ? "Save vendor" : "Create vendor"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
