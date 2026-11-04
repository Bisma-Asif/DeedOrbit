import { useEffect, useState } from "react"

import {
  ArrowLeft,
  Check,
  FileText,
  History,
  KeyRound,
  Pencil,
  Receipt,
  ShieldCheck,
  UserRound,
  Wallet,
} from "lucide-react"

import { Alert, AlertDescription } from "@/components/ui/alert"

import { Badge } from "@/components/ui/badge"

import { Button } from "@/components/ui/button"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

import { EmptyState } from "@/components/empty-state"

import { PageHeader } from "@/components/page-header"

import { Skeleton } from "@/components/ui/skeleton"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

import { UnsavedGuard } from "@/components/unsaved-guard"

import { useSave } from "@/features/organization/use-save"

import { CustomerProfileForm } from "@/features/customers/customer-profile-form"

import { CustomerMoneySection } from "@/features/customers/customer-money-section"

import { CustomerSaveResultNotice } from "@/features/customers/customer-save-result"

import { DocumentSection } from "@/features/documents/document-section"

import { DocumentChecklistSection } from "@/features/customers/document-checklist-section"

import { PortalAccessCard } from "@/features/portal/portal-access-card"

import {
  InstallmentScheduleTable,
  type ScheduleRow,
} from "@/features/bookings/installment-schedule-table"

import { customerDraftStamp, useCustomerDraft } from "@/lib/customer-draft"

import { useSession } from "@/lib/session-context"

import { bookingsApi } from "@/lib/bookings-api"

import { paymentsApi } from "@/lib/payments-api"

import {
  customerInputFromCustomer,
  customersApi,
  type CustomerInput,
  type CustomerListItem,
  type CustomerSaveResult,
} from "@/lib/leads-api"

import { organizationApi } from "@/lib/organization-api"

import { formatDateTime, orDash } from "@/lib/format"

import { navigate } from "@/lib/router"

import { useAsyncResource } from "@/lib/use-async-resource"

function toInput(customer: CustomerListItem): CustomerInput {
  return customerInputFromCustomer(customer)
}

/**
 * Who typed what in this record, newest first.
 *
 * The trail is written by the save, not by a viewer: it says which desk put the person in
 * the workspace and which one changed the address afterwards. Reading it needs
 * `customers.view`, not `customers.edit`, because "when did this change" is a question
 * anyone with the file should be allowed to ask. CNIC values reach it already masked, so
 * the tab cannot hand a whole number to someone who could not have read it.
 */

function CustomerEditHistoryCard({ customerId }: { customerId: string }) {
  const resource = useAsyncResource((signal) =>
    customersApi.editHistory(customerId, signal),
  )

  if (resource.error && !resource.data) {
    return (
      <Alert variant="danger">
        <AlertDescription>{resource.error}</AlertDescription>
      </Alert>
    )
  }

  if (!resource.data) return <Skeleton className="h-16 w-full" />

  if (resource.data.events.length === 0) {
    return (
      <EmptyState
        icon={History}
        size="sm"
        title="No edits recorded"
        description="Every change to a record is written here, with who typed it. This one has not been changed since it was entered."
      />
    )
  }

  return (
    <ul className="flex flex-col gap-3">
      {resource.data.events.map((event) => (
        <li
          key={event.id}
          className="border-b border-border pb-3 last:border-b-0"
        >
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{event.actionLabel}</Badge>
            <span className="text-[12.5px] font-medium text-foreground">
              {event.userName}
            </span>
            <span className="text-[11.5px] text-muted-foreground">
              {formatDateTime(event.recordedAt)}
            </span>
            <span className="text-[11.5px] text-muted-foreground">
              from {event.source}
            </span>
          </div>
          {event.changes.length > 0 && (
            <ul className="mt-1.5 flex flex-col gap-1 pl-0.5">
              {event.changes.map((change) => (
                <li
                  key={change.field}
                  className="text-[12px] leading-4.5 text-secondary-foreground"
                >
                  <span className="font-medium">{change.label}</span>
                  {": "}
                  <span className="text-muted-foreground">
                    {orDash(change.from)}
                  </span>
                  {" → "}
                  {orDash(change.to)}
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  )
}

/**
 * The customer's installments, gathered across every confirmed booking they hold.
 *
 * Read-only and shown only to a role that can see both bookings and payments: it lists
 * one booking's list then reads that booking's plan, and stitches the lines into one
 * schedule dated by due date. Because the same rollup spans several bookings, each row
 * carries its booking reference — the column `InstallmentScheduleTable` adds only when
 * asked. Recording a receipt stays a booking-detail concern, so no record action is
 * offered here.
 */

function CustomerPaymentScheduleCard({ customerId }: { customerId: string }) {
  const { can } = useSession()

  const canView = can("bookings", "view") && can("payments", "view")

  const resource = useAsyncResource(async (signal) => {
    const list = await bookingsApi.list(null, signal)

    const bookings = list.bookings.filter(
      (booking) =>
        booking.customerId === customerId && booking.status === "confirmed",
    )

    const plans = await Promise.all(
      bookings.map((booking) =>
        paymentsApi.readPlan(booking.id, signal).catch(() => null),
      ),
    )

    const rows: ScheduleRow[] = []

    bookings.forEach((booking, index) => {
      const plan = plans[index]

      if (!plan?.plan) return

      for (const installment of plan.installments) {
        rows.push({ ...installment, bookingReference: booking.reference })
      }
    })

    rows.sort((a, b) =>
      a.dueDate === b.dueDate
        ? a.number - b.number
        : a.dueDate < b.dueDate
          ? -1
          : 1,
    )

    return { installments: rows, currency: list.currency }
  }, canView)

  if (!canView) {
    return (
      <EmptyState
        icon={Wallet}
        size="sm"
        title="Payment schedule not available"
        description="Your role cannot read booking payments, so the schedule is hidden."
      />
    )
  }

  if (resource.error && !resource.data) {
    return (
      <Alert variant="danger">
        <AlertDescription>{resource.error}</AlertDescription>
      </Alert>
    )
  }

  if (!resource.data) {
    return <Skeleton className="h-16 w-full" />
  }

  if (resource.data.installments.length === 0) {
    return (
      <EmptyState
        icon={Wallet}
        size="sm"
        title="No installments yet"
        description="Confirmed payment plans on this customer's bookings will appear here."
      />
    )
  }

  return (
    <InstallmentScheduleTable
      installments={resource.data.installments}
      currency={resource.data.currency}
      showReference
      maxHeight="24rem"
    />
  )
}

interface CustomerDetailPageProps {
  customerId: string
}

export function CustomerDetailPage({ customerId }: CustomerDetailPageProps) {
  const session = useSession()

  const resource = useAsyncResource((signal) =>
    customersApi.read(customerId, signal),
  )

  const save = useSave()

  const [editing, setEditing] = useState(false)

  const [values, setValues] = useState<CustomerInput | null>(null)

  /**
   * What the record said when the form loaded it.
   *
   * "Dirty" is a comparison against this, so it has to be held rather than re-derived from
   * the record — after a save reloads the page, the record and the form agree by definition
   * and the question "did anybody type something that did not land" needs the older half.
   */
  const [baseline, setBaseline] = useState<CustomerInput | null>(null)

  const [result, setResult] = useState<CustomerSaveResult | null>(null)

  const customer = resource.data?.customer ?? null

  const canEdit = resource.data?.canEdit ?? false

  useEffect(() => {
    if (!customer) return

    const loaded = toInput(customer)

    setValues(loaded)

    setBaseline(loaded)
  }, [customer])

  const draft = useCustomerDraft({
    tenantId: session.data?.tenant.id ?? null,

    recordId: customerId,

    values,

    baseline,

    onRestore: (stored) => {
      setValues(stored)

      setEditing(true)
    },
  })

  // The scan control is offered only where a tenant turned it on, and reading that setting
  // needs `settings.view`: a role that cannot read it sees no control at all.
  const settings = useAsyncResource(
    (signal) => organizationApi.read(signal),

    session.can("settings", "view"),
  )

  const dirty = editing && draft.dirty

  function releaseTyping() {
    if (customer) {
      const loaded = toInput(customer)

      setValues(loaded)

      setBaseline(loaded)
    }

    setResult(null)

    save.clear()

    setEditing(false)

    draft.discard()
  }

  const header = (
    <PageHeader
      scope={
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2 h-6 px-2 text-[11.5px]"
          onClick={() => navigate("/customers")}
        >
          <ArrowLeft size={12} />
          Customers
        </Button>
      }
      title={customer?.name ?? "Customer"}
      description={
        customer
          ? `${customer.phone}${customer.email ? ` · ${customer.email}` : ""}`
          : undefined
      }
      actions={
        customer && canEdit ? (
          <Button
            variant={editing ? "outline" : "default"}
            onClick={() => {
              if (editing) {
                if (customer) {
                  const loaded = toInput(customer)

                  setValues(loaded)

                  setBaseline(loaded)
                }

                setResult(null)

                save.clear()

                draft.discard()
              }

              setEditing((current) => !current)
            }}
          >
            {editing ? (
              "Discard"
            ) : (
              <>
                <Pencil size={13} />
                Edit profile
              </>
            )}
          </Button>
        ) : undefined
      }
    />
  )

  if (resource.error)
    return (
      <div className="flex flex-col gap-4">
        {header}
        <Alert variant="danger">
          <AlertDescription>{resource.error}</AlertDescription>
        </Alert>
      </div>
    )

  if (!customer || !values)
    return (
      <div className="flex flex-col gap-4">
        {header}
        <Card>
          <CardContent className="py-8">
            <EmptyState
              icon={UserRound}
              title={
                resource.loading ? "Loading customer…" : "Customer not found"
              }
              description={
                resource.loading
                  ? undefined
                  : "The record may have been removed or belongs to another workspace."
              }
              action={
                !resource.loading ? (
                  <Button
                    variant="outline"
                    onClick={() => navigate("/customers")}
                  >
                    Back to customers
                  </Button>
                ) : undefined
              }
            />
          </CardContent>
        </Card>
      </div>
    )

  async function submit() {
    let saveResult: CustomerSaveResult | null = null

    const ok = await save.run(async () => {
      saveResult = await customersApi.update(customerId, values!)

      await resource.reload()
    })

    if (ok && saveResult) {
      setResult(saveResult)

      draft.saved()

      setEditing(false)
    }
  }

  function patch(next: Partial<CustomerInput>) {
    setValues((current) => (current ? { ...current, ...next } : current))

    setResult(null)

    save.clear()
  }

  return (
    <div className="flex flex-col gap-4">
      {header}
      <Tabs defaultValue="profile" className="flex flex-col gap-4">
        <TabsList>
          <TabsTrigger value="profile">
            <UserRound size={13} />
            Profile
          </TabsTrigger>
          <TabsTrigger value="purchases">
            <Receipt size={13} />
            Purchase History
          </TabsTrigger>
          <TabsTrigger value="payments">
            <Wallet size={13} />
            Payments
          </TabsTrigger>
          <TabsTrigger value="documents">
            <FileText size={13} />
            Documents
          </TabsTrigger>
          <TabsTrigger value="verification">
            <ShieldCheck size={13} />
            Verification
          </TabsTrigger>
          <TabsTrigger value="portal">
            <KeyRound size={13} />
            Portal access
          </TabsTrigger>
          <TabsTrigger value="history">
            <History size={13} />
            History
          </TabsTrigger>
        </TabsList>

        <TabsContent value="profile">
          <Card>
            <CardHeader>
              <CardTitle>Customer profile</CardTitle>
            </CardHeader>
            <CardContent className="px-4 py-3.5">
              {draft.draft && !editing && (
                <Alert variant="pending" className="mb-3">
                  <AlertDescription>
                    Draft from {customerDraftStamp(draft.draft.savedAt)} —{" "}
                    <button
                      type="button"
                      className="underline underline-offset-2"
                      onClick={draft.restore}
                    >
                      Continue
                    </button>
                    {" · "}
                    <button
                      type="button"
                      className="underline underline-offset-2"
                      onClick={draft.discard}
                    >
                      Discard
                    </button>
                  </AlertDescription>
                </Alert>
              )}
              {save.error && (
                <Alert variant="danger" className="mb-3">
                  <AlertDescription>{save.error}</AlertDescription>
                </Alert>
              )}
              {result && !editing && (
                <div className="mb-3">
                  <CustomerSaveResultNotice result={result} />
                </div>
              )}
              <CustomerProfileForm
                values={values}
                errors={save.fields}
                onChange={patch}
                disabled={!editing}
                idPrefix="customer-profile"
                ocrCaptureEnabled={
                  settings.data?.settings.ocrCaptureEnabled === true
                }
              />
              <div className="mt-4 grid gap-3 border-t border-border pt-3 text-[11.5px] text-muted-foreground sm:grid-cols-3">
                <p>Added {formatDateTime(customer.createdAt)}</p>
                <p>Updated {formatDateTime(customer.updatedAt)}</p>
                <p>Source {customer.source ?? "Manual record"}</p>
              </div>
              {editing && (
                <div className="mt-4 flex justify-end">
                  <Button onClick={submit} disabled={save.saving}>
                    {save.saving ? (
                      "Saving…"
                    ) : (
                      <>
                        <Check size={13} />
                        Save profile
                      </>
                    )}
                  </Button>
                </div>
              )}
              {!canEdit && (
                <p className="mt-3 text-[11.5px] text-muted-foreground">
                  Your role can view this profile but cannot edit it.
                </p>
              )}
            </CardContent>
          </Card>
          <UnsavedGuard
            dirty={dirty}
            onRelease={releaseTyping}
            subject="this customer's profile"
          />
        </TabsContent>

        <TabsContent value="purchases">
          <Card>
            <CardHeader>
              <CardTitle>Purchase history</CardTitle>
            </CardHeader>
            <CardContent className="px-4 py-6">
              <EmptyState
                icon={Receipt}
                size="sm"
                title="No purchases linked"
                description="Bookings connected to this customer will appear here."
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="payments" className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Payment schedule</CardTitle>
            </CardHeader>
            <CardContent className="px-4 py-4">
              <CustomerPaymentScheduleCard customerId={customerId} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Ledger &amp; receipts</CardTitle>
            </CardHeader>
            <CardContent className="px-4 py-4">
              <CustomerMoneySection
                customerId={customerId}
                customerName={customer.name}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="documents">
          <Card>
            <CardHeader>
              <CardTitle>Documents</CardTitle>
            </CardHeader>
            <CardContent className="px-4 py-4">
              <DocumentSection entityType="customer" entityId={customerId} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="verification">
          <Card>
            <CardHeader>
              <CardTitle>Document checklist</CardTitle>
            </CardHeader>
            <CardContent className="px-4 py-4">
              <DocumentChecklistSection customerId={customerId} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="portal">
          <Card>
            <CardHeader>
              <CardTitle>Portal access</CardTitle>
            </CardHeader>
            <CardContent className="px-4 py-4">
              <PortalAccessCard customerId={customerId} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history">
          <Card>
            <CardHeader>
              <CardTitle>Edit history</CardTitle>
            </CardHeader>
            <CardContent className="px-4 py-4">
              <CustomerEditHistoryCard customerId={customerId} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
