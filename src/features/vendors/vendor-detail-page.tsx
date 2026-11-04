/**
 * The vendor's whole account: profile, contracts, invoices, and the running
 * ledger, each on its own tab.
 *
 * The chrome follows `customer-detail-page.tsx` exactly — a back-scope header, a
 * `Tabs` spine, and one card per concern. Every money mutation (a raised invoice,
 * a recorded payment, a void) bumps a single `reloadToken` that both the invoice
 * list and the embedded `VendorLedger` listen to, so the two never disagree while
 * the user is looking at them. Editing the profile reuses the new/edit dialog so
 * there is one source of truth for the field caps.
 */

import { useMemo, useState } from "react"

import {
  ArrowLeft,
  Ban,
  FileText,
  Pencil,
  Plus,
  Receipt,
  Truck,
  Wallet,
} from "lucide-react"

import { Alert, AlertDescription } from "@/components/ui/alert"

import { Badge } from "@/components/ui/badge"

import { Button } from "@/components/ui/button"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

import { DataTable, type DataTableColumn } from "@/components/data-table"

import { EmptyState } from "@/components/empty-state"

import { PageHeader } from "@/components/page-header"

import { Skeleton } from "@/components/ui/skeleton"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

import { VendorContractDialog } from "@/features/vendors/vendor-contract-dialog"

import { VendorFormDialog } from "@/features/vendors/vendor-form-dialog"

import { VendorInvoiceDialog } from "@/features/vendors/vendor-invoice-dialog"

import { VendorLedger } from "@/features/vendors/vendor-ledger"

import { VendorPaymentDialog } from "@/features/vendors/vendor-payment-dialog"

import { formatCurrency, formatDate, orDash } from "@/lib/format"

import { navigate } from "@/lib/router"

import { useSession } from "@/lib/session-context"

import { useAsyncResource } from "@/lib/use-async-resource"

import { vendorsApi } from "@/lib/vendors-api"

import {
  VENDOR_CONTRACT_STATUS_LABELS,
  VENDOR_CONTRACT_STATUS_TONES,
  VENDOR_INVOICE_STATUS_LABELS,
  VENDOR_INVOICE_STATUS_TONES,
  VENDOR_STATUS_LABELS,
  VENDOR_STATUS_TONES,
  type VendorContract,
  type VendorInvoice,
} from "@shared/vendors"

interface VendorDetailPageProps {
  vendorId: string
}

type DialogState = { open: boolean }

export function VendorDetailPage({ vendorId }: VendorDetailPageProps) {
  const { can } = useSession()

  const vendor = useAsyncResource(
    (signal) => vendorsApi.read(vendorId, signal),

    true,
  )

  const contracts = useAsyncResource(
    (signal) => vendorsApi.listContracts(vendorId, signal),

    can("vendors", "view"),
  )

  const invoices = useAsyncResource(
    (signal) => vendorsApi.listInvoices(vendorId, "", signal),

    can("vendors", "view"),
  )

  // A money mutation (invoice, void, payment) bumps this so the ledger and the

  // invoice table refetch together and never show a half-applied state.

  const [reloadToken, setReloadToken] = useState(0)

  const [formOpen, setFormOpen] = useState<DialogState>({ open: false })

  const [contractDialog, setContractDialog] = useState<DialogState & {
    contract: VendorContract | null
  }>({ open: false, contract: null })

  const [invoiceOpen, setInvoiceOpen] = useState<DialogState>({ open: false })

  const [paymentDialog, setPaymentDialog] = useState<DialogState & {
    invoiceId: string | null
  }>({ open: false, invoiceId: null })

  const data = vendor.data

  const currency = data?.vendor.currency ?? "AED"

  const money = useMemo(
    () => (value: number) =>
      formatCurrency(value, currency, { maximumFractionDigits: 0 }),

    [currency],
  )

  function refreshMoney() {
    setReloadToken((current) => current + 1)

    void invoices.reload()

    void contracts.reload()
  }

  async function voidInvoice(invoiceId: string) {
    await vendorsApi.voidInvoice(vendorId, invoiceId)

    refreshMoney()
  }

  const contractColumns = useMemo<Array<DataTableColumn<VendorContract>>>(
    () => [
      {
        key: "reference",

        header: "Reference",

        width: "12rem",

        cell: (row) => (
          <span className="font-mono text-[11.5px]">{row.reference}</span>
        ),
      },

      {
        key: "title",

        header: "Title",

        cell: (row) => <span className="truncate">{row.title}</span>,
      },

      {
        key: "value",

        header: "Value",

        align: "right",

        width: "10rem",

        sortValue: (row) => row.value,

        cell: (row) => <span className="tabular-nums">{money(row.value)}</span>,
      },

      {
        key: "window",

        header: "Period",

        width: "13rem",

        cell: (row) => (
          <span className="whitespace-nowrap tabular-nums text-muted-foreground">
            {row.startDate ? formatDate(row.startDate) : "—"}
            {" → "}
            {row.endDate ? formatDate(row.endDate) : "open"}
          </span>
        ),
      },

      {
        key: "status",

        header: "Status",

        width: "7.5rem",

        sortValue: (row) => row.status,

        cell: (row) => (
          <Badge variant={VENDOR_CONTRACT_STATUS_TONES[row.status]}>
            {VENDOR_CONTRACT_STATUS_LABELS[row.status]}
          </Badge>
        ),
      },

      {
        key: "edit",

        header: "",

        width: "3rem",

        cell: (row) => (
          <Button
            variant="ghost"
            size="sm"
            aria-label="Edit contract"
            disabled={!contracts.data?.canEdit}
            onClick={() => setContractDialog({ open: true, contract: row })}
          >
            <Pencil size={13} />
          </Button>
        ),
      },
    ],

    [contracts.data?.canEdit, money],
  )

  const invoiceColumns = useMemo<Array<DataTableColumn<VendorInvoice>>>(
    () => [
      {
        key: "reference",

        header: "Reference",

        width: "12rem",

        cell: (row) => (
          <span className="font-mono text-[11.5px]">{row.reference}</span>
        ),
      },

      {
        key: "amount",

        header: "Amount",

        align: "right",

        width: "10rem",

        sortValue: (row) => row.amount,

        cell: (row) => (
          <span className="tabular-nums">{money(row.amount)}</span>
        ),
      },

      {
        key: "issued",

        header: "Issued",

        width: "9rem",

        sortValue: (row) => row.issuedAt,

        cell: (row) => (
          <span className="whitespace-nowrap tabular-nums text-muted-foreground">
            {formatDate(row.issuedAt)}
          </span>
        ),
      },

      {
        key: "due",

        header: "Due",

        width: "9rem",

        cell: (row) => (
          <span className="whitespace-nowrap tabular-nums text-muted-foreground">
            {row.dueAt ? formatDate(row.dueAt) : "—"}
          </span>
        ),
      },

      {
        key: "status",

        header: "Status",

        width: "7rem",

        sortValue: (row) => row.status,

        cell: (row) => (
          <Badge variant={VENDOR_INVOICE_STATUS_TONES[row.status]}>
            {VENDOR_INVOICE_STATUS_LABELS[row.status]}
          </Badge>
        ),
      },

      {
        key: "actions",

        header: "",

        align: "right",

        width: "9rem",

        cell: (row) => (
          <div className="flex justify-end gap-1">
            {row.status === "open" ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!invoices.data?.canEdit}
                  onClick={() =>
                    setPaymentDialog({ open: true, invoiceId: row.id })
                  }
                >
                  Pay
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="Void invoice"
                  disabled={!invoices.data?.canEdit}
                  onClick={() => void voidInvoice(row.id)}
                >
                  <Ban size={13} />
                </Button>
              </>
            ) : null}
          </div>
        ),
      },
    ],

    // eslint-disable-next-line react-hooks/exhaustive-deps

    [invoices.data?.canEdit, money],
  )

  const header = (
    <PageHeader
      scope={
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2 h-6 px-2 text-[11.5px]"
          onClick={() => navigate("/vendors")}
        >
          <ArrowLeft size={12} />
          Vendors
        </Button>
      }
      title={data?.vendor.name ?? "Vendor"}
      description={
        data?.vendor
          ? `${orDash(data.vendor.contactName)}${
              data.vendor.email ? ` · ${data.vendor.email}` : ""
            }`
          : undefined
      }
      actions={
        data?.vendor && data.canEdit ? (
          <Button variant="outline" onClick={() => setFormOpen({ open: true })}>
            <Pencil size={13} />
            Edit profile
          </Button>
        ) : undefined
      }
    />
  )

  if (vendor.error && !data) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <Alert variant="danger">
          <AlertDescription>{vendor.error}</AlertDescription>
        </Alert>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <Card>
          <CardContent className="py-8">
            <EmptyState
              icon={Truck}
              title={vendor.loading ? "Loading vendor…" : "Vendor not found"}
              description={
                vendor.loading
                  ? undefined
                  : "The record may have been removed or belongs to another workspace."
              }
              action={
                !vendor.loading ? (
                  <Button
                    variant="outline"
                    onClick={() => navigate("/vendors")}
                  >
                    Back to vendors
                  </Button>
                ) : undefined
              }
            />
          </CardContent>
        </Card>
      </div>
    )
  }

  const profile = data.vendor

  return (
    <div className="flex flex-col gap-4">
      {header}

      <Tabs defaultValue="profile" className="flex flex-col gap-4">
        <TabsList>
          <TabsTrigger value="profile">
            <Truck size={13} />
            Profile
          </TabsTrigger>
          <TabsTrigger value="contracts">
            <FileText size={13} />
            Contracts
          </TabsTrigger>
          <TabsTrigger value="invoices">
            <Receipt size={13} />
            Invoices
          </TabsTrigger>
          <TabsTrigger value="ledger">
            <Wallet size={13} />
            Ledger
          </TabsTrigger>
        </TabsList>

        <TabsContent value="profile">
          <Card>
            <CardHeader>
              <CardTitle>Vendor profile</CardTitle>
            </CardHeader>
            <CardContent className="px-4 py-3.5">
              <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-[13px] sm:grid-cols-2">
                <div className="flex justify-between gap-3 border-b border-border py-1.5">
                  <dt className="text-muted-foreground">Status</dt>
                  <dd>
                    <Badge variant={VENDOR_STATUS_TONES[profile.status]}>
                      {VENDOR_STATUS_LABELS[profile.status]}
                    </Badge>
                  </dd>
                </div>
                <div className="flex justify-between gap-3 border-b border-border py-1.5">
                  <dt className="text-muted-foreground">Balance owed</dt>
                  <dd
                    className={
                      profile.balance > 0
                        ? "tabular-nums text-danger"
                        : profile.balance < 0
                          ? "tabular-nums text-success"
                          : "tabular-nums"
                    }
                  >
                    {money(profile.balance)}
                  </dd>
                </div>
                <div className="flex justify-between gap-3 border-b border-border py-1.5">
                  <dt className="text-muted-foreground">Contact</dt>
                  <dd className="text-right">{orDash(profile.contactName)}</dd>
                </div>
                <div className="flex justify-between gap-3 border-b border-border py-1.5">
                  <dt className="text-muted-foreground">Email</dt>
                  <dd className="text-right">{orDash(profile.email)}</dd>
                </div>
                <div className="flex justify-between gap-3 border-b border-border py-1.5">
                  <dt className="text-muted-foreground">Phone</dt>
                  <dd className="text-right">{orDash(profile.phone)}</dd>
                </div>
                <div className="flex justify-between gap-3 border-b border-border py-1.5">
                  <dt className="text-muted-foreground">Tax ID</dt>
                  <dd className="text-right">{orDash(profile.taxId)}</dd>
                </div>
                <div className="flex justify-between gap-3 border-b border-border py-1.5">
                  <dt className="text-muted-foreground">City</dt>
                  <dd className="text-right">{orDash(profile.city)}</dd>
                </div>
                <div className="flex justify-between gap-3 border-b border-border py-1.5">
                  <dt className="text-muted-foreground">Country</dt>
                  <dd className="text-right">{orDash(profile.countryCode)}</dd>
                </div>
              </dl>
              {profile.addressLine1 || profile.addressLine2 ? (
                <p className="mt-3 text-[12.5px] text-muted-foreground">
                  {orDash(profile.addressLine1)}
                  {profile.addressLine2 ? `, ${profile.addressLine2}` : ""}
                </p>
              ) : null}
              {profile.notes ? (
                <p className="mt-3 border-t border-border pt-3 text-[12.5px] text-muted-foreground">
                  {profile.notes}
                </p>
              ) : null}
              <div className="mt-4 grid gap-3 border-t border-border pt-3 text-[11.5px] text-muted-foreground sm:grid-cols-2">
                <p>Added {formatDate(profile.createdAt)}</p>
                <p>Updated {formatDate(profile.updatedAt)}</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="contracts">
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Contracts</CardTitle>
              {contracts.data?.canEdit ? (
                <Button
                  size="sm"
                  onClick={() =>
                    setContractDialog({ open: true, contract: null })
                  }
                >
                  <Plus size={13} />
                  New contract
                </Button>
              ) : null}
            </CardHeader>
            <CardContent className="px-4 py-4">
              {contracts.error && !contracts.data ? (
                <Alert variant="danger">
                  <AlertDescription>{contracts.error}</AlertDescription>
                </Alert>
              ) : contracts.loading && !contracts.data ? (
                <Skeleton className="h-32 w-full" />
              ) : (contracts.data?.contracts.length ?? 0) === 0 ? (
                <EmptyState
                  icon={FileText}
                  size="sm"
                  title="No contracts yet"
                  description="Group this vendor's invoices and payments under a contract."
                />
              ) : (
                <div className="rounded-md border border-border">
                  <DataTable<VendorContract>
                    columns={contractColumns}
                    rows={contracts.data?.contracts ?? []}
                    rowKey={(row) => row.id}
                    initialSort={{ key: "reference", direction: "asc" }}
                    showFilterBar={false}
                    caption="Vendor contracts"
                  />
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="invoices">
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Invoices</CardTitle>
              <div className="flex gap-2">
                {invoices.data?.canEdit ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setPaymentDialog({ open: true, invoiceId: null })
                    }
                  >
                    <Wallet size={13} />
                    Adjustment
                  </Button>
                ) : null}
                {invoices.data?.canEdit ? (
                  <Button
                    size="sm"
                    onClick={() => setInvoiceOpen({ open: true })}
                  >
                    <Plus size={13} />
                    New invoice
                  </Button>
                ) : null}
              </div>
            </CardHeader>
            <CardContent className="px-4 py-4">
              {invoices.error && !invoices.data ? (
                <Alert variant="danger">
                  <AlertDescription>{invoices.error}</AlertDescription>
                </Alert>
              ) : invoices.loading && !invoices.data ? (
                <Skeleton className="h-32 w-full" />
              ) : (invoices.data?.invoices.length ?? 0) === 0 ? (
                <EmptyState
                  icon={Receipt}
                  size="sm"
                  title="No invoices yet"
                  description="Raise the first payable against this vendor."
                />
              ) : (
                <div className="rounded-md border border-border">
                  <DataTable<VendorInvoice>
                    columns={invoiceColumns}
                    rows={invoices.data?.invoices ?? []}
                    rowKey={(row) => row.id}
                    initialSort={{ key: "issued", direction: "desc" }}
                    showFilterBar={false}
                    caption="Vendor invoices"
                  />
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ledger" className="flex flex-col gap-4">
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Account ledger</CardTitle>
              {invoices.data?.canEdit ? (
                <Button
                  size="sm"
                  onClick={() =>
                    setPaymentDialog({ open: true, invoiceId: null })
                  }
                >
                  <Plus size={13} />
                  Record payment
                </Button>
              ) : null}
            </CardHeader>
            <CardContent className="px-4 py-4">
              <VendorLedger
                vendorId={vendorId}
                vendorName={profile.name}
                reloadToken={reloadToken}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <VendorFormDialog
        open={formOpen.open}
        vendor={profile}
        onOpenChange={(open) => setFormOpen({ open })}
        onSaved={() => {
          void vendor.reload()
        }}
      />

      <VendorContractDialog
        open={contractDialog.open}
        vendorId={vendorId}
        contract={contractDialog.contract}
        onOpenChange={(open) =>
          setContractDialog((current) => ({
            open,

            contract: open ? current.contract : null,
          }))
        }
        onSaved={() => {
          void contracts.reload()
        }}
      />

      <VendorInvoiceDialog
        open={invoiceOpen.open}
        vendorId={vendorId}
        onOpenChange={(open) => setInvoiceOpen({ open })}
        onSaved={refreshMoney}
      />

      <VendorPaymentDialog
        open={paymentDialog.open}
        vendorId={vendorId}
        invoiceId={paymentDialog.invoiceId}
        onOpenChange={(open) =>
          setPaymentDialog((current) => ({
            open,

            invoiceId: open ? current.invoiceId : null,
          }))
        }
        onSaved={refreshMoney}
      />
    </div>
  )
}
