/**
 * The vendors list.
 *
 * Every supplier the tenant pays, filterable by name and status, each row
 * carrying the running payable so a finance desk sees what is outstanding at a
 * glance. Creating or editing a vendor profile lives in `vendor-form-dialog`;
 * contracts, invoices, payments, and the ledger are on the detail page.
 */

import { useMemo, useState } from "react"

import { Plus, Truck } from "lucide-react"

import { Alert, AlertDescription } from "@/components/ui/alert"

import { Badge } from "@/components/ui/badge"

import { Button } from "@/components/ui/button"

import { Card } from "@/components/ui/card"

import {
  DataTable,
  TableFilter,
  type DataTableColumn,
  type FilterOption,
} from "@/components/data-table"

import { EmptyState } from "@/components/empty-state"

import { Field } from "@/components/field"

import { SavedViewControls } from "@/components/saved-view-controls"

import { Input } from "@/components/ui/input"

import { PageHeader } from "@/components/page-header"

import { Skeleton } from "@/components/ui/skeleton"

import { VendorFormDialog } from "@/features/vendors/vendor-form-dialog"

import { formatCurrency, orDash } from "@/lib/format"

import { navigate } from "@/lib/router"

import { useSession } from "@/lib/session-context"

import { useAsyncResource } from "@/lib/use-async-resource"

import { vendorsApi, type VendorListFilters } from "@/lib/vendors-api"

import {
  VENDOR_STATUSES,
  VENDOR_STATUS_LABELS,
  VENDOR_STATUS_TONES,
  type Vendor,
  type VendorStatus,
} from "@shared/vendors"

const STATUS_OPTIONS: FilterOption[] = VENDOR_STATUSES.map(
  (status: VendorStatus) => ({
    value: status,

    label: VENDOR_STATUS_LABELS[status],
  }),
)

export function VendorsPage() {
  const session = useSession()

  const canView = session.can("vendors", "view")

  const canCreate = session.can("vendors", "create")

  const [filters, setFilters] = useState<VendorListFilters>({})

  const [resetToken, setResetToken] = useState(0)

  function applySavedView(state: string) {
    const parsed = JSON.parse(state) as VendorListFilters

    setFilters(parsed)

    setResetToken((token) => token + 1)
  }

  const [editing, setEditing] = useState<{
    open: boolean
    vendor: Vendor | null
  }>({ open: false, vendor: null })

  const resource = useAsyncResource(
    (signal) => vendorsApi.list(filters, signal),

    canView,
  )

  const vendors = resource.data?.vendors ?? []

  const currency = resource.data?.currency ?? "AED"

  const columns = useMemo<Array<DataTableColumn<Vendor>>>(
    () => [
      {
        key: "name",

        header: "Vendor",

        width: "18rem",

        sortValue: (row) => row.name,

        cell: (row) => (
          <button
            type="button"
            onClick={() => navigate(`/vendors/${row.id}`)}
            className="block max-w-full truncate text-left font-medium text-foreground hover:underline"
          >
            {row.name}
          </button>
        ),
      },

      {
        key: "contact",

        header: "Contact",

        width: "12rem",

        cell: (row) => (
          <span className="truncate">{orDash(row.contactName)}</span>
        ),
      },

      {
        key: "email",

        header: "Email",

        width: "15rem",

        cell: (row) => <span className="truncate">{orDash(row.email)}</span>,
      },

      {
        key: "status",

        header: "Status",

        width: "7rem",

        sortValue: (row) => row.status,

        cell: (row) => (
          <Badge variant={VENDOR_STATUS_TONES[row.status]}>
            {VENDOR_STATUS_LABELS[row.status]}
          </Badge>
        ),
      },

      {
        key: "contracts",

        header: "Contracts",

        align: "right",

        width: "6rem",

        sortValue: (row) => row.contractCount,

        cell: (row) => (
          <span className="tabular-nums">{row.contractCount || "—"}</span>
        ),
      },

      {
        key: "open",

        header: "Open invoices",

        align: "right",

        width: "7rem",

        sortValue: (row) => row.openInvoiceCount,

        cell: (row) => (
          <span className="tabular-nums">{row.openInvoiceCount || "—"}</span>
        ),
      },

      {
        key: "balance",

        header: "Balance owed",

        align: "right",

        width: "10rem",

        sortValue: (row) => row.balance,

        cell: (row) => (
          <span
            className={
              row.balance > 0
                ? "tabular-nums text-danger"
                : row.balance < 0
                  ? "tabular-nums text-success"
                  : "tabular-nums text-muted-foreground"
            }
          >
            {formatCurrency(row.balance, currency, {
              maximumFractionDigits: 0,
            })}
          </span>
        ),
      },
    ],

    [currency],
  )

  if (!canView) {
    return (
      <EmptyState
        icon={Truck}
        title="Vendors are not available to your role"
        description="Ask a workspace administrator for the vendors grant to view this page."
        tone="pending"
      />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Vendors"
        description="Supplier profiles, contracts, invoices, payments, and the running vendor ledger."
        actions={
          canCreate ? (
            <Button onClick={() => setEditing({ open: true, vendor: null })}>
              <Plus size={14} />
              New vendor
            </Button>
          ) : null
        }
      />

      <Card className="p-0">
        <div className="flex flex-wrap items-end gap-2 border-b border-border px-3 py-3">
          <Field label="Search" htmlFor="vendors-search" className="w-64">
            <Input
              id="vendors-search"
              type="search"
              placeholder="By name"
              value={filters.search ?? ""}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,

                  search: event.target.value,
                }))
              }
            />
          </Field>
          <TableFilter
            label="Status"
            value={filters.status ?? ""}
            placeholder="All statuses"
            options={STATUS_OPTIONS}
            onValueChange={(value) =>
              setFilters((current) => ({
                ...current,

                status: value as VendorStatus | "",
              }))
            }
          />
          <SavedViewControls
            scope="vendors"
            serialize={() => JSON.stringify(filters)}
            onApply={applySavedView}
          />

          {filters.search || filters.status ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() => setFilters({})}
            >
              Clear
            </Button>
          ) : null}
        </div>

        {resource.error ? (
          <Alert variant="danger" className="m-3">
            <AlertDescription>{resource.error}</AlertDescription>
          </Alert>
        ) : resource.loading && !resource.data ? (
          <Skeleton className="m-3 h-40 w-auto" />
        ) : vendors.length === 0 ? (
          <EmptyState
            icon={Truck}
            title="No vendors yet"
            description={
              filters.search || filters.status
                ? "No vendor matches these filters."
                : "Add the first supplier you pay."
            }
          />
        ) : (
          <DataTable<Vendor>
            columns={columns}
            rows={vendors}
            rowKey={(row) => row.id}
            initialSort={{ key: "name", direction: "asc" }}
            resetToken={resetToken}
            showFilterBar={false}
            caption="Vendors"
          />
        )}
      </Card>

      <VendorFormDialog
        open={editing.open}
        vendor={editing.vendor}
        onOpenChange={(open) =>
          setEditing((current) => ({
            open,
            vendor: open ? current.vendor : null,
          }))
        }
        onSaved={() => {
          void resource.reload()
        }}
      />
    </div>
  )
}
