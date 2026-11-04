/**
 * The recovery picture, read live off the payment schedule.
 *
 * Collections is not a separate module — it is a tab of Payments and rides the same
 * `payments.*` grants. The dashboard asks three questions and answers all of them from
 * the server's summary and overdue reads (each of which runs the late-fee sweep on the
 * way, so a fee owed the moment a line turns overdue is already charged and shown):
 * what falls due next, how deep the delinquency runs, and who is carrying it against
 * their target.
 *
 * An officer can be reassigned and an accrued fee can be held for a waiver inline, both
 * gated on `payments.edit`. Assigning needs the roster of recovery officers, so the
 * candidate list is only offered to a role that can also read members.
 */

import { useEffect, useMemo, useState } from "react"

import {
  AlertTriangle,
  CircleDollarSign,
  Target,
  TrendingDown,
  Wallet,
} from "lucide-react"

import { Alert, AlertDescription } from "@/components/ui/alert"

import { Badge } from "@/components/ui/badge"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

import {
  DataTable,
  TableFilter,
  type DataTableColumn,
  type FilterOption,
} from "@/components/data-table"

import { EmptyState } from "@/components/empty-state"

import { Skeleton } from "@/components/ui/skeleton"

import { SavedViewControls } from "@/components/saved-view-controls"

import { StatCard } from "@/components/stat-card"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

import { useSession } from "@/lib/session-context"

import { useAsyncResource } from "@/lib/use-async-resource"

import { usersApi } from "@/lib/api"

import { collectionsApi } from "@/lib/collections-api"

import { formatCurrency, formatDate, formatPercent } from "@/lib/format"

import {
  AGING_BUCKETS,
  AGING_BUCKET_LABELS,
  type AgingBucket,
  type OverdueRow,
} from "@shared/collections"

import { WaiveFeeDialog } from "@/features/payments/waive-fee-dialog"

interface WaiveTarget {
  assessmentId: string

  amount: number

  context: string
}

function bucketTone(bucket: AgingBucket): "pending" | "danger" {
  return bucket === "61-90" || bucket === "90+" ? "danger" : "pending"
}

export function CollectionsDashboard() {
  const { can } = useSession()

  const canView = can("payments", "view")

  const canEdit = can("payments", "edit")

  const canReadUsers = can("users", "view")

  const [filters, setFilters] = useState<Record<string, string>>({})

  const [savedViewReset, setSavedViewReset] = useState(0)

  function applySavedView(state: string) {
    const parsed = JSON.parse(state) as Record<string, string>

    setFilters(parsed)

    setSavedViewReset((token) => token + 1)
  }

  const [waiving, setWaiving] = useState<WaiveTarget | null>(null)

  const [assigning, setAssigning] = useState<string | null>(null)

  const summary = useAsyncResource(
    (signal) => collectionsApi.summary(signal),

    canView,
  )

  const overdue = useAsyncResource(
    (signal) =>
      collectionsApi.overdue(
        {
          bucket: filters.bucket as AgingBucket || null,

          officerUserId: filters.officer || null,

          projectId: filters.project || null,
        },

        signal,
      ),

    canView,
  )

  const roster = useAsyncResource(
    (signal) => usersApi.list(signal),

    canView && canReadUsers,
  )

  // Refetch the table whenever a filter changes; the load closure reads the latest

  // filters, so a plain reload is enough.

  useEffect(() => {
    if (canView) void overdue.reload()

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.bucket, filters.officer, filters.project])

  const data = summary.data

  const currency = data?.currency ?? "AED"

  const money = (value: number) =>
    formatCurrency(value, currency, { maximumFractionDigits: 0 })

  const officerOptions = useMemo<FilterOption[]>(() => {
    const users = roster.data?.users ?? []

    return users

      .filter(
        (user) =>
          user.roleId === "recovery_officer" && user.status === "active",
      )

      .map((user) => ({ value: user.id, label: user.fullName }))
  }, [roster.data])

  const officerFilterOptions = useMemo<FilterOption[]>(() => {
    const seen = new Map<string, string>()

    for (const officer of data?.officers ?? [])
      seen.set(officer.officerUserId, officer.officerName)

    return [...seen].map(([value, label]) => ({ value, label }))
  }, [data])

  const projectFilterOptions = useMemo<FilterOption[]>(() => {
    const seen = new Map<string, string>()

    for (const row of overdue.data?.rows ?? [])
      seen.set(row.projectId, row.projectName)

    return [...seen].map(([value, label]) => ({ value, label }))
  }, [overdue.data])

  async function assign(installmentId: string, officerUserId: string | null) {
    setAssigning(installmentId)

    try {
      await collectionsApi.assign(installmentId, officerUserId)

      await Promise.all([overdue.reload(), summary.reload()])
    } finally {
      setAssigning(null)
    }
  }

  const kpis = data?.kpis

  const attainment =
    kpis && kpis.targetPeriodAmount > 0
      ? (kpis.collectedPeriodAmount / kpis.targetPeriodAmount) * 100
      : null

  const overdueColumns = useMemo<Array<DataTableColumn<OverdueRow>>>(
    () => [
      {
        key: "booking",

        header: "Booking",

        width: "9rem",

        sortValue: (row) => row.bookingReference,

        cell: (row) => (
          <span className="font-mono text-[11.5px] text-foreground">
            {row.bookingReference}
          </span>
        ),
      },

      {
        key: "customer",

        header: "Customer",

        width: "13rem",

        sortValue: (row) => row.customerName,

        cell: (row) => (
          <div className="min-w-0">
            <p className="truncate font-medium text-foreground">
              {row.customerName}
            </p>
            <p className="truncate font-mono text-[11px] text-muted-foreground">
              {row.unitCode}
            </p>
          </div>
        ),
      },

      {
        key: "due",

        header: "Due",

        width: "7.5rem",

        sortValue: (row) => row.dueDate,

        cell: (row) => (
          <span className="whitespace-nowrap tabular-nums text-muted-foreground">
            {formatDate(row.dueDate)}
          </span>
        ),
      },

      {
        key: "days",

        header: "Days over",

        align: "right",

        width: "6.5rem",

        sortValue: (row) => row.daysOverdue,

        cell: (row) => <span className="tabular-nums">{row.daysOverdue}</span>,
      },

      {
        key: "bucket",

        header: "Bucket",

        width: "7rem",

        sortValue: (row) => row.daysOverdue,

        cell: (row) => (
          <Badge variant={bucketTone(row.bucket)}>
            {AGING_BUCKET_LABELS[row.bucket]}
          </Badge>
        ),
      },

      {
        key: "outstanding",

        header: "Outstanding",

        align: "right",

        width: "8.5rem",

        sortValue: (row) => row.outstanding,

        cell: (row) => (
          <span className="tabular-nums">{money(row.outstanding)}</span>
        ),
      },

      {
        key: "fee",

        header: "Fee",

        align: "right",

        width: "7rem",

        sortValue: (row) => row.feeAccrued,

        cell: (row) =>
          row.feeAccrued > 0 ? (
            <span className="tabular-nums text-danger">
              {money(row.feeAccrued)}
            </span>
          ) : (
            <span className="text-muted-foreground/50">—</span>
          ),
      },

      {
        key: "officer",

        header: "Officer",

        width: "12rem",

        sortValue: (row) => row.officerName ?? "",

        cell: (row) =>
          canEdit ? (
            <Select
              value={row.officerUserId ?? "__none"}
              disabled={assigning === row.installmentId || !canReadUsers}
              onValueChange={(value) =>
                void assign(
                  row.installmentId,

                  value === "__none" ? null : value,
                )
              }
            >
              <SelectTrigger className="h-7 text-[12px]">
                <SelectValue placeholder="Unassigned" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">Unassigned</SelectItem>
                {officerOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <span className="truncate text-muted-foreground">
              {row.officerName ?? "—"}
            </span>
          ),
      },

      {
        key: "actions",

        header: "",

        align: "right",

        width: "6.5rem",

        cell: (row) =>
          canEdit && row.feeAccrued > 0 && row.lateFeeAssessmentId ? (
            <button
              type="button"
              className="text-[11.5px] font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              onClick={(event) => {
                event.stopPropagation()

                setWaiving({
                  assessmentId: row.lateFeeAssessmentId as string,

                  amount: row.feeAccrued,

                  context: `${row.customerName} · ${row.bookingReference}`,
                })
              }}
            >
              Waive fee
            </button>
          ) : null,
      },
    ],

    // eslint-disable-next-line react-hooks/exhaustive-deps

    [canEdit, canReadUsers, officerOptions, assigning, currency],
  )

  if (!canView) {
    return (
      <EmptyState
        icon={Wallet}
        title="Collections not available"
        description="Your role cannot read payment collections."
      />
    )
  }

  const rows = overdue.data?.rows ?? []

  return (
    <div className="flex flex-col gap-4">
      {/* Headline KPIs */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <StatCard
          label="Due next 7 days"
          icon={Wallet}
          value={kpis ? money(kpis.dueNext7Amount) : undefined}
          hint={kpis ? `${kpis.dueNext7Count} lines` : undefined}
          loading={summary.loading && !data}
        />
        <StatCard
          label="Due next 30 days"
          icon={Wallet}
          value={kpis ? money(kpis.dueNext30Amount) : undefined}
          hint={kpis ? `${kpis.dueNext30Count} lines` : undefined}
          loading={summary.loading && !data}
        />
        <StatCard
          label="Total overdue"
          icon={TrendingDown}
          value={kpis ? money(kpis.overdueAmount) : undefined}
          hint={kpis ? `${kpis.overdueCount} lines past due` : undefined}
          loading={summary.loading && !data}
        />
        <StatCard
          label="Collected this period"
          icon={CircleDollarSign}
          value={kpis ? money(kpis.collectedPeriodAmount) : undefined}
          hint={data ? `Period ${data.period}` : undefined}
          loading={summary.loading && !data}
        />
        <StatCard
          label="Target this period"
          icon={Target}
          value={kpis ? money(kpis.targetPeriodAmount) : undefined}
          hint="Sum of officer goals"
          loading={summary.loading && !data}
        />
        <StatCard
          label="Attainment"
          icon={Target}
          value={attainment === null ? "—" : formatPercent(attainment)}
          hint={
            attainment === null
              ? "No target set"
              : attainment >= 100
                ? "Target met"
                : "Short of target"
          }
          loading={summary.loading && !data}
        />
      </div>

      {/* Aging strip */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {(data?.aging ?? []).map((band) => (
          <StatCard
            key={band.bucket}
            label={AGING_BUCKET_LABELS[band.bucket]}
            icon={AlertTriangle}
            value={money(band.amount)}
            hint={`${band.count} ${band.count === 1 ? "line" : "lines"}`}
            loading={summary.loading && !data}
            className={
              band.bucket === "90+"
                ? "border-danger/40"
                : band.bucket === "61-90"
                  ? "border-danger/25"
                  : undefined
            }
          />
        ))}
      </div>

      {/* Officer workload */}
      <Card className="py-0">
        <CardHeader className="border-b border-border">
          <CardTitle>Officer workload</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {summary.error ? (
            <div className="p-4">
              <Alert variant="danger">
                <AlertDescription>{summary.error}</AlertDescription>
              </Alert>
            </div>
          ) : summary.loading && !data ? (
            <div className="p-4">
              <Skeleton className="h-32 w-full" />
            </div>
          ) : (data?.officers ?? []).length === 0 ? (
            <EmptyState
              icon={Wallet}
              size="sm"
              title="No officers carrying lines"
              description="Assign overdue lines or set a target to see workload roll up here."
            />
          ) : (
            <DataTable
              columns={
                [
                  {
                    key: "officer",

                    header: "Officer",

                    width: "14rem",

                    sortValue: (row) => row.officerName,

                    cell: (row) => (
                      <span className="truncate font-medium text-foreground">
                        {row.officerName}
                      </span>
                    ),
                  },

                  {
                    key: "open",

                    header: "Assigned open",

                    align: "right",

                    width: "8rem",

                    sortValue: (row) => row.openCount,

                    cell: (row) => (
                      <span className="tabular-nums">{row.openCount}</span>
                    ),
                  },

                  {
                    key: "overdue",

                    header: "Overdue",

                    align: "right",

                    width: "7rem",

                    sortValue: (row) => row.overdueCount,

                    cell: (row) => (
                      <span className="tabular-nums">{row.overdueCount}</span>
                    ),
                  },

                  {
                    key: "overdueAmount",

                    header: "Overdue value",

                    align: "right",

                    width: "9rem",

                    sortValue: (row) => row.overdueAmount,

                    cell: (row) => (
                      <span className="tabular-nums">
                        {money(row.overdueAmount)}
                      </span>
                    ),
                  },

                  {
                    key: "achieved",

                    header: "Achieved",

                    align: "right",

                    width: "9rem",

                    sortValue: (row) => row.achievedAmount,

                    cell: (row) => (
                      <span className="tabular-nums">
                        {money(row.achievedAmount)}
                      </span>
                    ),
                  },

                  {
                    key: "target",

                    header: "Target",

                    align: "right",

                    width: "9rem",

                    sortValue: (row) => row.targetAmount,

                    cell: (row) => (
                      <span className="tabular-nums text-muted-foreground">
                        {money(row.targetAmount)}
                      </span>
                    ),
                  },
                ] as Array<DataTableColumn<NonNullable<typeof data>["officers"][number]>>
              }
              rows={data?.officers ?? []}
              rowKey={(row) => row.officerUserId}
              maxHeight="18rem"
              showFilterBar={false}
            />
          )}
        </CardContent>
      </Card>

      {/* Overdue table */}
      <Card className="py-0">
        <DataTable<OverdueRow>
          columns={overdueColumns}
          rows={rows}
          rowKey={(row) => row.installmentId}
          getRowSearchText={(row) =>
            [
              row.bookingReference,
              row.customerName,
              row.unitCode,
              row.projectName,
            ].join(" ")
          }
          initialSort={{ key: "days", direction: "desc" }}
          filters={filters}
          resetToken={savedViewReset}
          onFilterChange={(key, value) =>
            setFilters((current) => ({
              ...current,

              [key]: value === "__all" ? "" : value,
            }))
          }
          toolbar={
            <SavedViewControls
              scope="collections-overdue"
              serialize={() => JSON.stringify(filters)}
              onApply={applySavedView}
            />
          }
          loading={overdue.loading && !overdue.data}
          maxHeight="max(18rem, calc(100dvh - 24rem))"
          caption="Overdue lines"
          emptyState={
            <EmptyState
              icon={Wallet}
              title="Nothing overdue"
              description="Every due line in view is settled or not yet past due."
            />
          }
          filterBar={
            <>
              <TableFilter
                label="Bucket"
                value={filters.bucket || "__all"}
                placeholder="All"
                options={AGING_BUCKETS.map((bucket) => ({
                  value: bucket,

                  label: AGING_BUCKET_LABELS[bucket],
                }))}
                onValueChange={(value) =>
                  setFilters((current) => ({
                    ...current,

                    bucket: value === "__all" ? "" : value,
                  }))
                }
              />
              {canReadUsers ? (
                <TableFilter
                  label="Officer"
                  value={filters.officer || "__all"}
                  placeholder="All"
                  options={officerFilterOptions}
                  onValueChange={(value) =>
                    setFilters((current) => ({
                      ...current,

                      officer: value === "__all" ? "" : value,
                    }))
                  }
                />
              ) : null}
              <TableFilter
                label="Project"
                value={filters.project || "__all"}
                placeholder="All"
                options={projectFilterOptions}
                onValueChange={(value) =>
                  setFilters((current) => ({
                    ...current,

                    project: value === "__all" ? "" : value,
                  }))
                }
              />
            </>
          }
        />
      </Card>

      <WaiveFeeDialog
        open={waiving !== null}
        assessmentId={waiving?.assessmentId ?? null}
        amount={waiving?.amount ?? 0}
        currency={currency}
        context={waiving?.context}
        onClose={() => setWaiving(null)}
        onDone={() => {
          void overdue.reload()

          void summary.reload()
        }}
      />
    </div>
  )
}
