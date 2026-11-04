/**
 * Manage construction contractors.
 *
 * A contractor is who does the work; where they also bill, they link to a
 * vendor so the ledger and the supplier book stay one source. The list opens
 * on the workspace's contractors; Add / Edit swaps the body to a form, and
 * Archive is a status change rather than a deletion — tasks name contractors,
 * so the platform refuses to archive one that still has open work and the
 * server's reason surfaces on the row.
 */

import { useEffect, useMemo, useState } from "react"

import { ArrowLeft, Archive, Pencil, Plus } from "lucide-react"

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

import { EmptyState } from "@/components/empty-state"

import { Field, FieldGrid } from "@/components/field"

import { Input } from "@/components/ui/input"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

import { Skeleton } from "@/components/ui/skeleton"

import { Textarea } from "@/components/ui/textarea"

import { useSave } from "@/features/organization/use-save"

import { constructionApi, type ContractorInput } from "@/lib/construction-api"

import { vendorsApi } from "@/lib/vendors-api"

import { useAsyncResource } from "@/lib/use-async-resource"

import {
  CONTRACTOR_TRADE_LABELS,
  CONTRACTOR_TRADES,
  NOTE_MAX,
  type ConstructionContractorView,
  type ContractorTrade,
} from "@shared/construction"

interface ContractorsDialogProps {
  open: boolean

  onOpenChange: (open: boolean) => void
}

interface ContractorDraft {
  name: string

  trade: ContractorTrade

  vendorId: string

  contactName: string

  email: string

  phone: string

  notes: string
}

function emptyDraft(): ContractorDraft {
  return {
    name: "",

    trade: "general",

    vendorId: "",

    contactName: "",

    email: "",

    phone: "",

    notes: "",
  }
}

function fromContractor(
  contractor: ConstructionContractorView,
): ContractorDraft {
  return {
    name: contractor.name,

    trade: contractor.trade as ContractorTrade ?? "general",

    vendorId: contractor.vendorId ?? "",

    contactName: contractor.contactName ?? "",

    email: contractor.email ?? "",

    phone: contractor.phone ?? "",

    notes: contractor.notes ?? "",
  }
}

function toInput(draft: ContractorDraft): ContractorInput {
  return {
    name: draft.name.trim(),

    trade: draft.trade,

    vendorId: draft.vendorId === "" ? null : draft.vendorId,

    contactName: draft.contactName.trim() || null,

    email: draft.email.trim() || null,

    phone: draft.phone.trim() || null,

    notes: draft.notes.trim() || null,
  }
}

export function ContractorsDialog({
  open,

  onOpenChange,
}: ContractorsDialogProps) {
  const resource = useAsyncResource(
    (signal) => constructionApi.listContractors(signal),

    open,
  )

  const [draft, setDraft] = useState<ContractorDraft | null>(null)

  const [editing, setEditing] = useState<ConstructionContractorView | null>(
    null,
  )

  const [invalid, setInvalid] = useState<Record<string, string>>({})

  const [archiveError, setArchiveError] = useState<string | null>(null)

  const save = useSave()

  const canManage = resource.data?.canManage ?? false

  const contractors = resource.data?.contractors ?? []

  const vendors = useAsyncResource(
    (signal) => vendorsApi.list({}, signal),

    open && draft !== null,
  )

  const vendorOptions = useMemo(
    () => vendors.data?.vendors ?? [],

    [vendors.data],
  )

  useEffect(() => {
    if (!open) {
      setDraft(null)

      setEditing(null)

      setInvalid({})

      setArchiveError(null)
    }
  }, [open])

  function startCreate() {
    setEditing(null)

    setInvalid({})

    setDraft(emptyDraft())
  }

  function startEdit(contractor: ConstructionContractorView) {
    setEditing(contractor)

    setInvalid({})

    setDraft(fromContractor(contractor))
  }

  function set<K extends keyof ContractorDraft>(
    key: K,
    value: ContractorDraft[K],
  ) {
    setDraft((current) => (current ? { ...current, [key]: value } : current))

    setInvalid((current) => {
      if (!(key in current)) return current

      const next = { ...current }

      delete next[key]

      return next
    })

    save.clear()
  }

  async function saveContractor() {
    if (!draft) return

    const errors: Record<string, string> = {}

    if (draft.name.trim() === "") errors.name = "Name this contractor."
    else if (draft.name.length > 120)
      errors.name = "Use 120 characters or fewer."

    if (Object.keys(errors).length > 0) {
      setInvalid(errors)

      return
    }

    setInvalid({})

    const body = toInput(draft)

    const done = await save.run(async () => {
      if (editing) {
        await constructionApi.updateContractor(editing.id, body)
      } else {
        await constructionApi.createContractor(body)
      }
    })

    if (done) {
      setDraft(null)

      setEditing(null)

      await resource.reload()
    }
  }

  async function archive(contractor: ConstructionContractorView) {
    setArchiveError(null)

    const done = await save.run(async () => {
      await constructionApi.updateContractor(contractor.id, {
        status: "archived",
      })
    })

    if (done) {
      await resource.reload()
    } else {
      setArchiveError(
        save.fields.status ??
          save.error ??
          `Could not archive ${contractor.name}.`,
      )
    }
  }

  const errorFor = (key: string) => invalid[key] ?? save.fields[key]

  const inForm = draft !== null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[42rem]">
        <DialogHeader>
          <DialogTitle>Contractors</DialogTitle>
          <DialogDescription>
            Who does the work. Link a vendor where the contractor also bills, so
            spend and the supplier book stay one record.
          </DialogDescription>
        </DialogHeader>

        {inForm && draft ? (
          <DialogBody className="flex flex-col gap-3">
            {save.error ? (
              <Alert variant="danger">
                <AlertDescription>{save.error}</AlertDescription>
              </Alert>
            ) : null}

            <FieldGrid>
              <Field
                label="Name"
                htmlFor="contractor-name"
                required
                error={errorFor("name")}
              >
                <Input
                  id="contractor-name"
                  maxLength={120}
                  value={draft.name}
                  onChange={(event) => set("name", event.target.value)}
                />
              </Field>

              <Field label="Trade" htmlFor="contractor-trade">
                <Select
                  value={draft.trade}
                  onValueChange={(value) =>
                    set("trade", value as ContractorTrade)
                  }
                >
                  <SelectTrigger id="contractor-trade">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CONTRACTOR_TRADES.map((trade) => (
                      <SelectItem key={trade} value={trade}>
                        {CONTRACTOR_TRADE_LABELS[trade]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </FieldGrid>

            <Field
              label="Vendor (optional)"
              htmlFor="contractor-vendor"
              hint="The supplier that bills for this contractor."
              error={errorFor("vendorId")}
            >
              <Select
                value={draft.vendorId || "__none"}
                onValueChange={(value) =>
                  set("vendorId", value === "__none" ? "" : value)
                }
              >
                <SelectTrigger id="contractor-vendor">
                  <SelectValue placeholder="Not a billing vendor" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">Not a billing vendor</SelectItem>
                  {vendorOptions.map((vendor) => (
                    <SelectItem key={vendor.id} value={vendor.id}>
                      {vendor.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <FieldGrid>
              <Field
                label="Contact"
                htmlFor="contractor-contact"
                error={errorFor("contactName")}
              >
                <Input
                  id="contractor-contact"
                  maxLength={NOTE_MAX}
                  value={draft.contactName}
                  onChange={(event) => set("contactName", event.target.value)}
                />
              </Field>

              <Field
                label="Phone"
                htmlFor="contractor-phone"
                error={errorFor("phone")}
              >
                <Input
                  id="contractor-phone"
                  maxLength={NOTE_MAX}
                  value={draft.phone}
                  onChange={(event) => set("phone", event.target.value)}
                />
              </Field>
            </FieldGrid>

            <Field
              label="Email"
              htmlFor="contractor-email"
              error={errorFor("email")}
            >
              <Input
                id="contractor-email"
                type="email"
                maxLength={NOTE_MAX}
                value={draft.email}
                onChange={(event) => set("email", event.target.value)}
              />
            </Field>

            <Field
              label="Notes"
              htmlFor="contractor-notes"
              error={errorFor("notes")}
            >
              <Textarea
                id="contractor-notes"
                rows={2}
                maxLength={NOTE_MAX}
                value={draft.notes}
                onChange={(event) => set("notes", event.target.value)}
              />
            </Field>
          </DialogBody>
        ) : (
          <DialogBody className="flex flex-col gap-2">
            {archiveError ? (
              <Alert variant="danger">
                <AlertDescription>{archiveError}</AlertDescription>
              </Alert>
            ) : null}

            {save.error && !archiveError ? (
              <Alert variant="danger">
                <AlertDescription>{save.error}</AlertDescription>
              </Alert>
            ) : null}

            {resource.loading && !resource.data ? (
              <Skeleton className="h-40 w-full" />
            ) : resource.error ? (
              <Alert variant="danger">
                <AlertDescription>{resource.error}</AlertDescription>
              </Alert>
            ) : contractors.length === 0 ? (
              <EmptyState
                icon={Archive}
                title="No contractors yet"
                description="Add the firms and trades working on your builds."
              />
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {contractors.map((contractor) => (
                  <li
                    key={contractor.id}
                    className="flex items-center justify-between gap-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 truncate text-[13.5px] font-medium text-foreground">
                        {contractor.name}
                        {contractor.status === "archived" ? (
                          <Badge variant="neutral">Archived</Badge>
                        ) : null}
                      </p>
                      <p className="truncate text-[11.5px] text-muted-foreground">
                        {contractor.tradeLabel}
                        {contractor.status !== "archived"
                          ? ` · ${contractor.openTaskCount} open task${
                              contractor.openTaskCount === 1 ? "" : "s"
                            }`
                          : ""}
                      </p>
                    </div>
                    {canManage ? (
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => startEdit(contractor)}
                          aria-label={`Edit ${contractor.name}`}
                        >
                          <Pencil size={13} />
                        </Button>
                        {contractor.status === "active" ? (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => void archive(contractor)}
                            disabled={save.saving}
                            aria-label={`Archive ${contractor.name}`}
                          >
                            <Archive size={13} />
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </DialogBody>
        )}

        <DialogFooter>
          {inForm ? (
            <>
              <Button
                variant="ghost"
                onClick={() => {
                  setDraft(null)

                  setEditing(null)

                  setInvalid({})
                }}
              >
                <ArrowLeft size={13} />
                Back
              </Button>
              <Button
                onClick={() => void saveContractor()}
                disabled={save.saving}
              >
                {save.saving
                  ? "Saving…"
                  : editing
                    ? "Save contractor"
                    : "Add contractor"}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
              {canManage ? (
                <Button onClick={startCreate}>
                  <Plus size={14} />
                  New contractor
                </Button>
              ) : null}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
