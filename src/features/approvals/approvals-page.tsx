/**
 * The approvals queue.
 *
 * Every deferred action the workspace is holding, newest first, with the three
 * figures that give the list its meaning: how many wait, how many were signed off,
 * and how many were refused. The whole row opens the detail, where the actual
 * decision is made — nothing here changes state, because approving a request is a
 * considered act on one item rather than a bulk table action.
 *
 * The filter is a status read, so an approver can park on the pending set and clear
 * it without the completed history crowding the view. Filtering and search run on the
 * already-loaded rows, the same way the bookings list does, so the footer count never
 * lies about what is on screen.
 */

import { useMemo, useState } from "react"

import { BadgeCheck, ShieldCheck, XCircle, Clock } from "lucide-react"

import { Badge } from "@/components/ui/badge"

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
  APPROVAL_ACTION_LABELS,
  APPROVAL_STATUSES,
  APPROVAL_STATUS_LABELS,
  APPROVAL_STATUS_TONES,
} from "@shared/approvals"

import { formatDateTime } from "@/lib/format"

import { navigate } from "@/lib/router"

import { approvalsApi, type ApprovalItem } from "@/lib/approvals-api"

import type { NavItem } from "@/lib/navigation"

import { useAsyncResource } from "@/lib/use-async-resource"

function approvalSearchText(approval: ApprovalItem): string {
  return [
    approval.summary ?? "",

    approval.requestedByName,

    APPROVAL_ACTION_LABELS[approval.actionKey],
  ].join(" ")
}

export default function ApprovalsPage({ module }: { module: NavItem }) {
  const { data, loading, error, reload } = useAsyncResource((signal) =>
    approvalsApi.list(null, signal),
  )

  const [filters, setFilters] = useState<Record<string, string>>({})

  const approvals = data?.approvals ?? []

  const status = filters.status ?? ""

  const rows = useMemo(
    () =>
      status === ""
        ? approvals
        : approvals.filter((approval) => approval.status === status),

    [approvals, status],
  )

  const totals = useMemo(() => {
    let pending = 0

    let approved = 0

    let rejected = 0

    for (const approval of approvals) {
      if (approval.status === "pending") pending += 1
      else if (approval.status === "approved") approved += 1
      else rejected += 1
    }

    return { pending, approved, rejected }
  }, [approvals])

  const columns = useMemo<Array<DataTableColumn<ApprovalItem>>>(
    () => [
      {
        key: "summary",

        header: "Request",

        width: "1fr",

        sortValue: (row) => row.summary ?? "",

        cell: (row) => (
          <span className="line-clamp-2 text-[12.5px] text-foreground">
            {row.summary ?? "—"}
          </span>
        ),
      },

      {
        key: "type",

        header: "Type",

        width: "8.5rem",

        sortValue: (row) => APPROVAL_ACTION_LABELS[row.actionKey],

        cell: (row) => (
          <Badge variant="nav">{APPROVAL_ACTION_LABELS[row.actionKey]}</Badge>
        ),
      },

      {
        key: "requestedBy",

        header: "Requested by",

        width: "12rem",

        sortValue: (row) => row.requestedByName,

        cell: (row) => (
          <span className="truncate text-muted-foreground">
            {row.requestedByName}
          </span>
        ),
      },

      {
        key: "requestedAt",

        header: "Requested on",

        width: "11rem",

        sortValue: (row) => row.requestedAt,

        cell: (row) => (
          <span className="whitespace-nowrap tabular-nums text-muted-foreground">
            {formatDateTime(row.requestedAt)}
          </span>
        ),
      },

      {
        key: "status",

        header: "Status",

        width: "7.5rem",

        sortValue: (row) => row.status,

        cell: (row) => (
          <Badge variant={APPROVAL_STATUS_TONES[row.status]}>
            {APPROVAL_STATUS_LABELS[row.status]}
          </Badge>
        ),
      },
    ],

    [],
  )

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={module.label} description={module.description} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard
          label="Pending"
          icon={Clock}
          value={data ? totals.pending.toLocaleString("en-US") : undefined}
          hint="Awaiting sign-off"
          loading={loading && !data}
        />
        <StatCard
          label="Approved"
          icon={BadgeCheck}
          value={data ? totals.approved.toLocaleString("en-US") : undefined}
          hint="Applied by an approver"
          loading={loading && !data}
        />
        <StatCard
          label="Rejected"
          icon={XCircle}
          value={data ? totals.rejected.toLocaleString("en-US") : undefined}
          hint="Declined; nothing took effect"
          loading={loading && !data}
        />
      </div>

      <Card className="py-0">
        <DataTable<ApprovalItem>
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          getRowSearchText={approvalSearchText}
          initialSort={{ key: "requestedAt", direction: "desc" }}
          filters={filters}
          onFilterChange={(key, value) =>
            setFilters((current) => ({ ...current, [key]: value }))
          }
          loading={loading && !data}
          maxHeight="max(18rem, calc(100dvh - 25rem))"
          caption="Approvals"
          onRowClick={(row) => navigate(`/approvals/${row.id}`)}
          filterBar={
            <TableFilter
              label="Status"
              value={status || "__all"}
              placeholder="All"
              options={APPROVAL_STATUSES.map((value) => ({
                value,

                label: APPROVAL_STATUS_LABELS[value],
              }))}
              onValueChange={(value) =>
                setFilters((current) => ({
                  ...current,

                  status: value === "__all" ? "" : value,
                }))
              }
            />
          }
          emptyState={
            error ? (
              <EmptyState
                icon={ShieldCheck}
                tone="danger"
                title="Could not load approvals"
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
                title="No approval requests"
                description="Requests held for sign-off — bookings above the approval threshold, or cancellations — appear here until an approver decides them."
              />
            )
          }
        />
      </Card>

      {data?.truncated ? (
        <p className="text-[11.5px] text-muted-foreground">
          Showing the most recent {approvals.length.toLocaleString("en-US")}{" "}
          requests. Refine with a status filter to narrow the view.
        </p>
      ) : null}
    </div>
  )
}
