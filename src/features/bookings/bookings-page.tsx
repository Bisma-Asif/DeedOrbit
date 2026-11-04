/**
 * The bookings list.
 *
 * Every booking the workspace has made, newest first, with the handful of figures
 * that give the list meaning: how many stand, how many were called off, and the sum
 * committed across the confirmed ones. The whole row opens the detail, so the only
 * action left inline is the one that changes state rather than merely reading it —
 * a cancel, offered only to a role that may approve and only while a booking stands.
 *
 * Filters and search run here on the already-loaded rows, the same way the projects
 * list does: the response is a capped, modest set, and keeping the match client-side
 * means the footer count never lies about what is on screen.
 */

import { useMemo, useState } from "react"

import {
  BadgeCheck,
  BookOpenCheck,
  CircleDollarSign,
  Plus,
  XCircle,
} from "lucide-react"

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

import { SavedViewControls } from "@/components/saved-view-controls"

import { StatCard } from "@/components/stat-card"

import { BookingFormDialog } from "@/features/bookings/booking-form-dialog"

import { CancelBookingDialog } from "@/features/bookings/cancel-booking-dialog"

import {
  BOOKING_STATUSES,
  BOOKING_STATUS_LABELS,
  BOOKING_STATUS_TONES,
} from "@shared/bookings"

import { formatCurrency, formatDate } from "@/lib/format"

import { navigate, readQueryParam } from "@/lib/router"

import { bookingsApi, type BookingListItem } from "@/lib/bookings-api"

import type { NavItem } from "@/lib/navigation"

import { useAsyncResource } from "@/lib/use-async-resource"

/** A booking's channel reads as whoever brought the buyer, or a direct sale. */

function channelLabel(booking: BookingListItem): string {
  if (booking.dealerName) return `Dealer · ${booking.dealerName}`

  if (booking.agentName) return `Agent · ${booking.agentName}`

  return "Direct"
}

function bookingSearchText(booking: BookingListItem): string {
  return [
    booking.reference,

    booking.customerName,

    booking.unitCode,

    booking.projectName,

    channelLabel(booking),
  ].join(" ")
}

export default function BookingsPage({ module }: { module: NavItem }) {
  const { data, loading, error, reload } = useAsyncResource((signal) =>
    bookingsApi.list(null, signal),
  )

  // A dashboard "New Booking" quick action arrives as ?new=1 and opens the
  // form straight away; the flag is read once on mount, never on re-render.
  const [creating, setCreating] = useState(() => readQueryParam("new") === "1")

  const [filters, setFilters] = useState<Record<string, string>>({})

  const [resetToken, setResetToken] = useState(0)

  function applySavedView(state: string) {
    const parsed = JSON.parse(state) as Record<string, string>

    setFilters(parsed)

    setResetToken((token) => token + 1)
  }

  const [cancelling, setCancelling] = useState<BookingListItem | null>(null)

  const bookings = data?.bookings ?? []

  const currency = data?.currency ?? "AED"

  const status = filters.status ?? ""

  const projectId = filters.project ?? ""

  // The project filter is built from the bookings in hand rather than the full

  // project list: only projects that actually have a booking are worth offering,

  // and it keeps the filter honest about what selecting it will return.

  const projectOptions = useMemo(() => {
    const seen = new Map<string, string>()

    for (const booking of bookings)
      if (!seen.has(booking.projectId))
        seen.set(booking.projectId, booking.projectName)

    return [...seen].map(([value, label]) => ({ value, label }))
  }, [bookings])

  const rows = useMemo(
    () =>
      bookings.filter(
        (booking) =>
          (status === "" || booking.status === status) &&
          (projectId === "" || booking.projectId === projectId),
      ),

    [bookings, status, projectId],
  )

  const totals = useMemo(() => {
    let confirmed = 0

    let cancelled = 0

    let committed = 0

    for (const booking of bookings) {
      if (booking.status === "confirmed") {
        confirmed += 1

        committed += booking.bookingAmount
      } else {
        cancelled += 1
      }
    }

    return { confirmed, cancelled, committed }
  }, [bookings])

  const columns = useMemo<Array<DataTableColumn<BookingListItem>>>(
    () => [
      {
        key: "reference",

        header: "Reference",

        width: "11rem",

        sortValue: (row) => row.reference,

        cell: (row) => (
          <span className="font-mono text-[11.5px] text-foreground">
            {row.reference}
          </span>
        ),
      },

      {
        key: "customer",

        header: "Customer",

        width: "14rem",

        sortValue: (row) => row.customerName,

        cell: (row) => (
          <span className="truncate font-medium text-foreground">
            {row.customerName}
          </span>
        ),
      },

      {
        key: "unit",

        header: "Unit",

        width: "13rem",

        sortValue: (row) => row.unitCode,

        cell: (row) => (
          <div className="min-w-0">
            <p className="truncate font-mono text-[12px] text-foreground">
              {row.unitCode}
            </p>
            <p className="truncate text-[11.5px] text-muted-foreground">
              {row.projectName}
            </p>
          </div>
        ),
      },

      {
        key: "channel",

        header: "Channel",

        width: "13rem",

        sortValue: (row) => channelLabel(row),

        cell: (row) => (
          <span className="truncate text-muted-foreground">
            {channelLabel(row)}
          </span>
        ),
      },

      {
        key: "amount",

        header: "Amount",

        align: "right",

        width: "9rem",

        sortValue: (row) => row.bookingAmount,

        cell: (row) => (
          <span className="tabular-nums">
            {formatCurrency(row.bookingAmount, currency, {
              maximumFractionDigits: 0,
            })}
          </span>
        ),
      },

      {
        key: "date",

        header: "Date",

        width: "8rem",

        sortValue: (row) => row.bookingDate,

        cell: (row) => (
          <span className="whitespace-nowrap tabular-nums text-muted-foreground">
            {formatDate(row.bookingDate)}
          </span>
        ),
      },

      {
        key: "status",

        header: "Status",

        width: "7.5rem",

        sortValue: (row) => row.status,

        cell: (row) => (
          <Badge variant={BOOKING_STATUS_TONES[row.status]}>
            {BOOKING_STATUS_LABELS[row.status]}
          </Badge>
        ),
      },

      {
        key: "actions",

        header: "",

        align: "right",

        width: "6rem",

        cell: (row) =>
          data?.canApprove && row.status === "confirmed" ? (
            <Button
              variant="ghost"
              size="sm"
              className="-mr-2 h-6 text-danger hover:bg-danger-subtle"
              onClick={(event) => {
                event.stopPropagation()

                setCancelling(row)
              }}
            >
              Cancel
            </Button>
          ) : null,
      },
    ],

    [currency, data?.canApprove],
  )

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={module.label}
        description={module.description}
        actions={
          data?.canCreate ? (
            <Button onClick={() => setCreating(true)}>
              <Plus size={13} />
              {module.primaryAction}
            </Button>
          ) : null
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total bookings"
          icon={BookOpenCheck}
          value={data ? bookings.length.toLocaleString("en-US") : undefined}
          loading={loading && !data}
        />
        <StatCard
          label="Confirmed"
          icon={BadgeCheck}
          value={data ? totals.confirmed.toLocaleString("en-US") : undefined}
          hint="Standing commitments"
          loading={loading && !data}
        />
        <StatCard
          label="Cancelled"
          icon={XCircle}
          value={data ? totals.cancelled.toLocaleString("en-US") : undefined}
          hint="Called off; the unit returned"
          loading={loading && !data}
        />
        <StatCard
          label="Committed on confirmed"
          icon={CircleDollarSign}
          value={
            data
              ? formatCurrency(totals.committed, currency, {
                  maximumFractionDigits: 0,
                })
              : undefined
          }
          hint="Sum of confirmed booking amounts"
          loading={loading && !data}
        />
      </div>

      <Card className="py-0">
        <DataTable<BookingListItem>
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          getRowSearchText={bookingSearchText}
          initialSort={{ key: "date", direction: "desc" }}
          filters={filters}
          resetToken={resetToken}
          onFilterChange={(key, value) =>
            setFilters((current) => ({ ...current, [key]: value }))
          }
          toolbar={
            <SavedViewControls
              scope="bookings"
              serialize={() => JSON.stringify(filters)}
              onApply={applySavedView}
            />
          }
          loading={loading && !data}
          maxHeight="max(18rem, calc(100dvh - 25rem))"
          caption="Bookings"
          onRowClick={(row) => navigate(`/bookings/${row.id}`)}
          filterBar={
            <>
              <TableFilter
                label="Project"
                value={projectId || "__all"}
                placeholder="All"
                options={projectOptions}
                onValueChange={(value) =>
                  setFilters((current) => ({
                    ...current,

                    project: value === "__all" ? "" : value,
                  }))
                }
              />
              <TableFilter
                label="Status"
                value={status || "__all"}
                placeholder="All"
                options={BOOKING_STATUSES.map((value) => ({
                  value,

                  label: BOOKING_STATUS_LABELS[value],
                }))}
                onValueChange={(value) =>
                  setFilters((current) => ({
                    ...current,

                    status: value === "__all" ? "" : value,
                  }))
                }
              />
            </>
          }
          emptyState={
            error ? (
              <EmptyState
                icon={BookOpenCheck}
                tone="danger"
                title="Could not load bookings"
                description={error}
                action={
                  <Button variant="outline" onClick={() => void reload()}>
                    Try again
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={BookOpenCheck}
                title="No bookings yet"
                description={
                  data?.canCreate
                    ? "Book a unit to a customer to record a formal commitment and move the unit to Booked."
                    : "No booking has been recorded in this workspace yet."
                }
                action={
                  data?.canCreate ? (
                    <Button onClick={() => setCreating(true)}>
                      <Plus size={13} />
                      {module.primaryAction}
                    </Button>
                  ) : null
                }
              />
            )
          }
        />
      </Card>

      {data?.truncated ? (
        <p className="text-[11.5px] text-muted-foreground">
          Showing the most recent {bookings.length.toLocaleString("en-US")}{" "}
          bookings. Refine with a project or status filter to narrow the view.
        </p>
      ) : null}

      {data && (
        <BookingFormDialog
          open={creating}
          currency={currency}
          onClose={() => setCreating(false)}
          onCreated={(result) => {
            setCreating(false)

            void reload()

            if ("booking" in result) {
              navigate(`/bookings/${result.booking.id}`)
            } else {
              navigate("/approvals")
            }
          }}
        />
      )}

      <CancelBookingDialog
        open={cancelling !== null}
        booking={
          cancelling
            ? { id: cancelling.id, reference: cancelling.reference }
            : null
        }
        currency={currency}
        onClose={() => setCancelling(null)}
        onDone={() => void reload()}
      />
    </div>
  )
}
