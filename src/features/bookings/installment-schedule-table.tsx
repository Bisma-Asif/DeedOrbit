/**
 * The installment schedule, rendered the same way on the booking and the customer.
 *
 * Each line shows its kind, due date, the amount and amortized charges that make its
 * total, what has been recorded against it, and the derived display status — the one
 * reading that folds in the passage of time. On the booking the table is live: an
 * unpaid line carries a record-payment action. On the customer it is read-only and
 * gains a booking-reference column, because the same schedule is being seen across
 * several bookings rather than within one.
 *
 * `useSave`-free by design: recording is a dialog's concern, and this component only
 * draws rows and raises a callback.
 */

import { Badge } from "@/components/ui/badge"

import { Button } from "@/components/ui/button"

import { DataTable, type DataTableColumn } from "@/components/data-table"

import {
  INSTALLMENT_DISPLAY_STATUS_LABELS,
  INSTALLMENT_DISPLAY_STATUS_TONES,
  INSTALLMENT_KIND_LABELS,
} from "@shared/payment-plans"

import { formatCurrency, formatDate } from "@/lib/format"

import type { Installment } from "@/lib/payments-api"

/** A schedule line, optionally tagged with the booking it belongs to (customer view). */

export interface ScheduleRow extends Installment {
  bookingReference?: string
}

export interface InstallmentScheduleTableProps {
  installments: ScheduleRow[]

  currency: string

  /** Shows the booking-reference column — the customer rollup spans several bookings. */

  showReference?: boolean

  /** Offers a per-row record action for a line that is not yet fully paid. */

  canRecord?: boolean

  onRecord?: (installment: Installment) => void

  maxHeight?: string
}

export function InstallmentScheduleTable({
  installments,

  currency,

  showReference = false,

  canRecord = false,

  onRecord,

  maxHeight,
}: InstallmentScheduleTableProps) {
  const money = (value: number) =>
    formatCurrency(value, currency, { maximumFractionDigits: 0 })

  const columns: Array<DataTableColumn<ScheduleRow>> = [
    {
      key: "number",

      header: "#",

      width: "3rem",

      align: "right",

      sortValue: (row) => row.number,

      cell: (row) => (
        <span className="tabular-nums text-muted-foreground">{row.number}</span>
      ),
    },

    {
      key: "kind",

      header: "Line",

      width: "9rem",

      sortValue: (row) => INSTALLMENT_KIND_LABELS[row.kind],

      cell: (row) => (
        <span className="text-foreground">
          {INSTALLMENT_KIND_LABELS[row.kind]}
        </span>
      ),
    },
  ]

  if (showReference) {
    columns.splice(2, 0, {
      key: "reference",

      header: "Booking",

      width: "11rem",

      sortValue: (row) => row.bookingReference ?? "",

      cell: (row) => (
        <span className="font-mono text-[11.5px] text-foreground">
          {row.bookingReference ?? "—"}
        </span>
      ),
    })
  }

  columns.push(
    {
      key: "due",

      header: "Due",

      width: "8.5rem",

      sortValue: (row) => row.dueDate,

      cell: (row) => (
        <span className="whitespace-nowrap tabular-nums text-muted-foreground">
          {formatDate(row.dueDate)}
        </span>
      ),
    },

    {
      key: "amount",

      header: "Amount",

      width: "8rem",

      align: "right",

      sortValue: (row) => row.amount,

      cell: (row) => <span className="tabular-nums">{money(row.amount)}</span>,
    },

    {
      key: "charges",

      header: "Charges",

      width: "7.5rem",

      align: "right",

      sortValue: (row) => row.charges,

      cell: (row) => (
        <span className="tabular-nums text-muted-foreground">
          {money(row.charges)}
        </span>
      ),
    },

    {
      key: "total",

      header: "Total",

      width: "8rem",

      align: "right",

      sortValue: (row) => row.total,

      cell: (row) => (
        <span className="font-medium tabular-nums">{money(row.total)}</span>
      ),
    },

    {
      key: "paid",

      header: "Paid",

      width: "8rem",

      align: "right",

      sortValue: (row) => row.paidAmount,

      cell: (row) => (
        <span className="tabular-nums text-muted-foreground">
          {money(row.paidAmount)}
        </span>
      ),
    },

    {
      key: "status",

      header: "Status",

      width: "8rem",

      sortValue: (row) => row.displayStatus,

      cell: (row) => (
        <Badge variant={INSTALLMENT_DISPLAY_STATUS_TONES[row.displayStatus]}>
          {INSTALLMENT_DISPLAY_STATUS_LABELS[row.displayStatus]}
        </Badge>
      ),
    },
  )

  if (canRecord && onRecord) {
    columns.push({
      key: "actions",

      header: "",

      align: "right",

      width: "7rem",

      cell: (row) =>
        row.paidAmount < row.total ? (
          <Button
            variant="ghost"
            size="sm"
            className="-mr-2 h-6"
            onClick={(event) => {
              event.stopPropagation()

              onRecord(row)
            }}
          >
            Record
          </Button>
        ) : null,
    })
  }

  return (
    <DataTable<ScheduleRow>
      columns={columns}
      rows={installments}
      rowKey={(row) => row.id}
      initialSort={{ key: "number", direction: "asc" }}
      showFilterBar={false}
      maxHeight={maxHeight}
      caption="Installment schedule"
    />
  )
}
