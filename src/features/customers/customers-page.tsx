import { useMemo, useState } from "react"

import { Plus, UserRound } from "lucide-react"

import { Alert, AlertDescription } from "@/components/ui/alert"

import { Button } from "@/components/ui/button"

import { Card } from "@/components/ui/card"

import { DataTable, type DataTableColumn } from "@/components/data-table"

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

import { PageHeader } from "@/components/page-header"

import { UnsavedGuard } from "@/components/unsaved-guard"

import { CustomerProfileForm } from "@/features/customers/customer-profile-form"

import { CustomerSaveResultNotice } from "@/features/customers/customer-save-result"

import { useSave } from "@/features/organization/use-save"

import { customerDraftStamp, useCustomerDraft } from "@/lib/customer-draft"

import { formatDateTime, orDash } from "@/lib/format"

import {
  customersApi,
  type CustomerInput,
  type CustomerListItem,
  type CustomerSaveResult,
} from "@/lib/leads-api"

import { organizationApi } from "@/lib/organization-api"

import { navigate, readQueryParam } from "@/lib/router"

import { useSession } from "@/lib/session-context"

import { useAsyncResource } from "@/lib/use-async-resource"

import { emptyCustomerInput, formatPkPhone } from "@shared/customer-entry"

function customerSearchText(customer: CustomerListItem): string {
  return [
    customer.name,

    customer.phone,

    customer.whatsapp ?? "",

    customer.email ?? "",

    customer.cnicMasked ?? "",

    customer.addressLine1 ?? "",

    customer.city ?? "",

    customer.source ?? "",

    customer.projectInterest ?? "",
  ].join(" ")
}

export function CustomersPage() {
  const session = useSession()

  const resource = useAsyncResource((signal) => customersApi.list(signal))

  // The dashboard's "Add Customer" quick action arrives as ?new=1.
  const [creating, setCreating] = useState(() => readQueryParam("new") === "1")

  const customers = resource.data?.customers ?? []

  const columns = useMemo<Array<DataTableColumn<CustomerListItem>>>(
    () => [
      {
        key: "name",

        header: "Customer",

        width: "15rem",

        sortValue: (customer) => customer.name,

        cell: (customer) => (
          <span className="font-medium text-foreground">{customer.name}</span>
        ),
      },

      {
        key: "phone",
        header: "Phone",
        width: "11rem",
        sortValue: (customer) => customer.phone,
        // Printed the way a Pakistani desk reads a number, but never rewritten: the stored
        // value is what the duplicate check matches on.
        cell: (customer) => (
          <span className="tabular-nums">
            {formatPkPhone(customer.phone) ?? customer.phone}
          </span>
        ),
      },

      {
        key: "cnic",
        header: "CNIC",
        width: "11rem",
        sortValue: (customer) => customer.cnicMasked ?? "",
        // The mask, always, even for a reader who may see the whole number: a table of
        // identities is read over shoulders, and the full number is one field away on the
        // record itself.
        cell: (customer) => (
          <span className="tabular-nums">{orDash(customer.cnicMasked)}</span>
        ),
      },

      {
        key: "email",
        header: "Email",
        width: "15rem",
        sortValue: (customer) => customer.email ?? "",
        cell: (customer) => (
          <span className="truncate">{orDash(customer.email)}</span>
        ),
      },

      {
        key: "city",
        header: "City",
        width: "10rem",
        sortValue: (customer) => customer.city ?? "",
        cell: (customer) => <span>{orDash(customer.city)}</span>,
      },

      {
        key: "interest",
        header: "Project / interest",
        width: "14rem",
        sortValue: (customer) => customer.projectInterest ?? "",
        cell: (customer) => <span>{orDash(customer.projectInterest)}</span>,
      },

      {
        key: "source",
        header: "Source",
        width: "9rem",
        sortValue: (customer) => customer.source ?? "Manual",
        cell: (customer) => <span>{orDash(customer.source ?? "Manual")}</span>,
      },

      {
        key: "updatedAt",
        header: "Updated",
        width: "11rem",
        align: "right",
        sortValue: (customer) => customer.updatedAt,
        cell: (customer) => (
          <span className="whitespace-nowrap text-muted-foreground">
            {formatDateTime(customer.updatedAt)}
          </span>
        ),
      },
    ],

    [],
  )

  async function createCustomer(
    input: CustomerInput,
  ): Promise<CustomerSaveResult> {
    const result = await customersApi.create(input)

    await resource.reload()

    return result
  }

  if (resource.error)
    return (
      <Alert variant="danger">
        <AlertDescription>{resource.error}</AlertDescription>
      </Alert>
    )

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Customers"
        description="Customer profiles, contact details, and purchase relationships."
        actions={
          resource.data?.canCreate ? (
            <Button onClick={() => setCreating(true)}>
              <Plus size={13} />
              New customer
            </Button>
          ) : undefined
        }
      />
      <Card className="py-0">
        <DataTable
          columns={columns}
          rows={customers}
          rowKey={(customer) => customer.id}
          getRowSearchText={customerSearchText}
          initialSort={{ key: "updatedAt", direction: "desc" }}
          loading={resource.loading}
          maxHeight="max(18rem, calc(100dvh - 18rem))"
          caption="Customers"
          onRowClick={(customer) => navigate(`/customers/${customer.id}`)}
          emptyState={
            <EmptyState
              icon={UserRound}
              title="No customers yet"
              description="Create a customer profile or convert a Won lead from the Leads pipeline."
              action={
                resource.data?.canCreate ? (
                  <Button size="sm" onClick={() => setCreating(true)}>
                    <Plus size={13} />
                    Add first customer
                  </Button>
                ) : undefined
              }
            />
          }
        />
      </Card>
      {creating && (
        <CustomerCreateDialog
          tenantId={session.data?.tenant.id ?? null}
          onClose={() => setCreating(false)}
          onSubmit={createCustomer}
        />
      )}
    </div>
  )
}

interface CustomerCreateDialogProps {
  onClose: () => void

  onSubmit: (input: CustomerInput) => Promise<CustomerSaveResult>

  /** Whose browser this draft belongs to. Null while the session is still resolving. */
  tenantId: string | null
}

/**
 * The new-customer dialog.
 *
 * It stays open after a save that worked, because the answer carries things the officer has
 * to read before moving on — another record with the same CNIC, a birthday that makes the
 * buyer fifteen — and a dialog that closes on success throws the warning away with it.
 * Typing anything clears the notice, since the record on screen is no longer the one the
 * notice describes, and the next save answers again.
 */

function CustomerCreateDialog({
  onClose,
  onSubmit,
  tenantId,
}: CustomerCreateDialogProps) {
  const { can } = useSession()

  const save = useSave()

  const [values, setValues] = useState<CustomerInput>(() =>
    emptyCustomerInput(),
  )

  const [result, setResult] = useState<CustomerSaveResult | null>(null)

  // The dialog's own Cancel asks the same question the router asks, so it goes through the
  // guard rather than closing over the top of the typing.
  const [askClose, setAskClose] = useState(false)

  const baseline = useMemo<CustomerInput>(() => emptyCustomerInput(), [])

  const draft = useCustomerDraft({
    tenantId,

    recordId: "new",

    values,

    baseline,

    onRestore: (stored) => setValues(stored),
  })

  // The scan control only appears where a tenant turned it on, and the setting itself needs
  // `settings.view` — a role that cannot read it does not see a dead button.
  const settings = useAsyncResource(
    (signal) => organizationApi.read(signal),

    can("settings", "view"),
  )

  function patch(next: Partial<CustomerInput>) {
    setValues((current) => ({ ...current, ...next }))

    setResult(null)

    save.clear()
  }

  function releaseTyping() {
    setValues(emptyCustomerInput())

    setResult(null)

    save.clear()

    draft.discard()
  }

  async function submit() {
    await save.run(async () => {
      const response = await onSubmit(values)

      setResult(response)

      draft.saved()
    })
  }

  function requestClose() {
    if (draft.dirty) setAskClose(true)
    else onClose()
  }

  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) requestClose()
        }}
      >
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>New customer</DialogTitle>
            <DialogDescription>
              Type what the form in front of you says. A field nobody filled
              stays empty and is listed as missing rather than guessed at.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            {draft.draft && (
              <Alert variant="neutral" className="mb-3">
                <AlertDescription asChild>
                  <div className="flex flex-wrap items-center gap-2">
                    <span>
                      A draft from {customerDraftStamp(draft.draft.savedAt)} is
                      still on this browser.
                    </span>
                    <Button size="sm" variant="outline" onClick={draft.restore}>
                      Continue from it
                    </Button>
                    <Button size="sm" variant="ghost" onClick={draft.discard}>
                      Discard
                    </Button>
                  </div>
                </AlertDescription>
              </Alert>
            )}
            {save.error && (
              <Alert variant="danger" className="mb-3">
                <AlertDescription>{save.error}</AlertDescription>
              </Alert>
            )}
            {result && (
              <div className="mb-3">
                <CustomerSaveResultNotice
                  result={result}
                  onOpenRecord={() =>
                    navigate(`/customers/${result.customer.id}`)
                  }
                />
              </div>
            )}
            <CustomerProfileForm
              values={values}
              errors={save.fields}
              onChange={patch}
              idPrefix="new-customer"
              ocrCaptureEnabled={
                settings.data?.settings.ocrCaptureEnabled === true
              }
            />
          </DialogBody>
          <DialogFooter>
            {result ? (
              <Button onClick={onClose}>Done</Button>
            ) : (
              <>
                <Button
                  variant="outline"
                  onClick={requestClose}
                  disabled={save.saving}
                >
                  Cancel
                </Button>
                <Button onClick={() => void submit()} disabled={save.saving}>
                  {save.saving ? "Saving…" : "Create customer"}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <UnsavedGuard
        dirty={draft.dirty}
        onRelease={releaseTyping}
        closing={askClose}
        onStopClosing={() => setAskClose(false)}
        onProceedClose={onClose}
        subject="this new-customer form"
      />
    </>
  )
}
