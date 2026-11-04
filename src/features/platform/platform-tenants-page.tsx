import { useMemo, useState } from "react"

import { Building2, CircleAlert, ShieldCheck, Wallet } from "lucide-react"

import {
  formatDate,
  formatCurrency,
  formatCurrencyCompact,
  formatNumber,
  orDash,
} from "@/lib/format"

import { navigate } from "@/lib/router"

import { platformApi, type PlatformTenantView } from "@/lib/platform-api"

import { useAsyncResource } from "@/lib/use-async-resource"

import { Button } from "@/components/ui/button"

import { Card } from "@/components/ui/card"

import {
  DataTable,
  TableFilter,
  type DataTableColumn,
} from "@/components/data-table"

import { EmptyState } from "@/components/empty-state"

import { PageHeader } from "@/components/page-header"

import { StatCard } from "@/components/stat-card"

import {
  BillingStatusBadge,
  StorageMeter,
  UsageMeter,
  WorkspaceStatusBadge,
} from "@/features/platform/platform-bits"

import {
  DERIVED_BILLING_LABELS,
  DERIVED_BILLING_STATUSES,
  PLATFORM_PLANS,
  planDefinition,
} from "@shared/platform"

/**
 * The platform workspace directory.
 *
 * One row per tenant on the platform — plan, derived billing state, and usage
 * measured against the plan catalogue's limits. Money columns are sums of the
 * platform's own recorded ledger: a workspace nobody has billed yet reads as
 * zero, not as an estimate, and totals are never added across currencies.
 *
 * Everything here is read-through: the row shows the same derived status the
 * API computed at read time, so a grace window that closed overnight shows as
 * expired without any job having run.
 */

export function PlatformTenantsPage() {
  const { data, loading, error, reload } = useAsyncResource((signal) =>
    platformApi.tenants(signal),
  )

  const [filters, setFilters] = useState<Record<string, string>>({})

  const tenants = data?.tenants ?? []

  const status = filters.status ?? ""

  const billing = filters.billing ?? ""

  const plan = filters.plan ?? ""

  // The directory is every workspace the platform has — a few dozen at most —

  // so filtering client-side keeps the footer counts honest and avoids a

  // second request per keystroke.

  const rows = useMemo(
    () =>
      tenants.filter(
        (tenant) =>
          (!status || tenant.status === status) &&
          (!billing || tenant.billingStatus === billing) &&
          (!plan || tenant.plan === plan),
      ),

    [tenants, status, billing, plan],
  )

  const columns = useMemo<Array<DataTableColumn<PlatformTenantView>>>(
    () => [
      {
        key: "name",

        header: "Workspace",

        width: "16rem",

        sortValue: (row) => row.name,

        cell: (row) => (
          <div className="min-w-0">
            <p className="truncate font-medium text-foreground">{row.name}</p>
            <p className="truncate text-[11.5px] text-muted-foreground">
              {row.slug}
            </p>
          </div>
        ),
      },

      {
        key: "status",

        header: "Status",

        width: "7rem",

        sortValue: (row) => row.status,

        cell: (row) => <WorkspaceStatusBadge status={row.status} />,
      },

      {
        key: "plan",

        header: "Plan",

        width: "9rem",

        sortValue: (row) => row.plan,

        cell: (row) => (
          <div className="min-w-0">
            <p className="truncate">
              {orDash(row.planLabel ?? planDefinition(row.plan)?.label)}
            </p>
            {row.monthlyAmount !== null && (
              <p className="truncate text-[11.5px] text-muted-foreground tabular-nums">
                {formatCurrency(row.monthlyAmount, row.currency)}/mo
              </p>
            )}
          </div>
        ),
      },

      {
        key: "billing",

        header: "Billing",

        width: "10.5rem",

        sortValue: (row) => row.billingStatus,

        cell: (row) => (
          <div className="min-w-0">
            <BillingStatusBadge status={row.billingStatus} />
            {row.billingStatus === "grace_active" && row.graceEndsAt && (
              <p className="mt-1 truncate text-[11px] text-muted-foreground">
                until {formatDate(row.graceEndsAt)}
              </p>
            )}
          </div>
        ),
      },

      {
        key: "users",

        header: "Users",

        width: "6.5rem",

        sortValue: (row) => row.usage.users.used,

        cell: (row) => <UsageMeter usage={row.usage.users} />,
      },

      {
        key: "projects",

        header: "Projects",

        width: "6.5rem",

        sortValue: (row) => row.usage.projects.used,

        cell: (row) => <UsageMeter usage={row.usage.projects} />,
      },

      {
        key: "storage",

        header: "Storage",

        width: "8rem",

        sortValue: (row) => row.usage.storageBytes.used,

        cell: (row) => <StorageMeter usage={row.usage.storageBytes} />,
      },

      {
        key: "collected",

        header: "Collected",

        align: "right",

        width: "7.5rem",

        sortValue: (row) => row.revenueCollected,

        cell: (row) => (
          <span className="tabular-nums">
            {formatCurrency(row.revenueCollected, row.currency)}
          </span>
        ),
      },

      {
        key: "outstanding",

        header: "Outstanding",

        align: "right",

        width: "7.5rem",

        sortValue: (row) => row.outstanding,

        cell: (row) =>
          row.outstanding > 0 ? (
            <span className="font-medium text-warning tabular-nums">
              {formatCurrency(row.outstanding, row.currency)}
            </span>
          ) : (
            <span className="tabular-nums text-muted-foreground">
              {formatCurrency(0, row.currency)}
            </span>
          ),
      },
    ],

    [],
  )

  const totals = data?.totals

  const topCollection = totals?.collectedByCurrency[0]

  const extraCurrencies = (totals?.collectedByCurrency.length ?? 0) - 1

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Workspaces"
        description="Every tenant on the platform with its plan, billing state, and usage against plan limits."
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard
          label="Workspaces"
          icon={Building2}
          value={totals ? formatNumber(totals.workspaces) : undefined}
          loading={loading}
        />
        <StatCard
          label="Active"
          icon={ShieldCheck}
          value={totals ? formatNumber(totals.active) : undefined}
          loading={loading}
        />
        <StatCard
          label="Suspended"
          value={totals ? formatNumber(totals.suspended) : undefined}
          hint="Closed and suspended workspaces"
          loading={loading}
        />
        <StatCard
          label="Needs attention"
          icon={CircleAlert}
          value={totals ? formatNumber(totals.needingAttention) : undefined}
          hint="Active with payment due or grace expired"
          loading={loading}
        />
        <StatCard
          label="Collected"
          icon={Wallet}
          value={
            topCollection
              ? formatCurrencyCompact(
                  topCollection.amount,
                  topCollection.currency,
                )
              : totals
                ? formatCurrencyCompact(0, "AED")
                : undefined
          }
          hint={
            totals && topCollection
              ? extraCurrencies > 0
                ? `${topCollection.currency} ledger; ${extraCurrencies} other ledger${
                    extraCurrencies === 1 ? "" : "s"
                  } not added`
                : `${topCollection.currency} recorded payments`
              : "Recorded platform payments"
          }
          loading={loading}
        />
      </div>

      <Card>
        <DataTable<PlatformTenantView>
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          getRowSearchText={(row) =>
            [row.name, row.legalName ?? "", row.slug, row.plan].join(" ")
          }
          initialSort={{ key: "name", direction: "asc" }}
          filters={filters}
          onFilterChange={(key, value) =>
            setFilters((current) => ({ ...current, [key]: value }))
          }
          loading={loading && !data}
          filterBar={
            <>
              <TableFilter
                label="Status"
                value={status || "__all"}
                placeholder="All"
                options={[
                  { value: "active", label: "Active" },

                  { value: "suspended", label: "Suspended" },

                  { value: "closed", label: "Closed" },
                ]}
                onValueChange={(value) =>
                  setFilters((current) => ({
                    ...current,

                    status: value === "__all" ? "" : value,
                  }))
                }
              />
              <TableFilter
                label="Billing"
                value={billing || "__all"}
                placeholder="All"
                options={DERIVED_BILLING_STATUSES.map((value) => ({
                  value,

                  label: DERIVED_BILLING_LABELS[value],
                }))}
                onValueChange={(value) =>
                  setFilters((current) => ({
                    ...current,

                    billing: value === "__all" ? "" : value,
                  }))
                }
              />
              <TableFilter
                label="Plan"
                value={plan || "__all"}
                placeholder="All"
                options={PLATFORM_PLANS.map((value) => ({
                  value,

                  label: planDefinition(value)?.label ?? value,
                }))}
                onValueChange={(value) =>
                  setFilters((current) => ({
                    ...current,

                    plan: value === "__all" ? "" : value,
                  }))
                }
              />
            </>
          }
          onRowClick={(row) => navigate(`/platform/tenants/${row.id}`)}
          maxHeight="max(18rem, calc(100dvh - 27rem))"
          emptyState={
            error ? (
              <EmptyState
                icon={ShieldCheck}
                tone="danger"
                title="Could not load the directory"
                description={error}
                action={
                  <Button variant="outline" onClick={() => void reload()}>
                    Try again
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={ShieldCheck}
                title="No workspaces yet"
                description="Workspaces created through sign-up will appear here."
              />
            )
          }
        />
      </Card>
    </div>
  )
}
