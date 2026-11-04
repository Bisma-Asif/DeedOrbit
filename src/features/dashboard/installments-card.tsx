import { useState } from "react"

import { CalendarClock, CircleDollarSign } from "lucide-react"

import { Button } from "@/components/ui/button"

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

import { EmptyState } from "@/components/empty-state"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

import type { DashboardInstallmentRow } from "@shared/dashboard"

import { formatDate } from "@/lib/format"

import { navigate } from "@/lib/router"

import { useSession } from "@/lib/session-context"

import { RecordAllocationDialog } from "@/features/payments/record-payment-dialog"

import { MoneyExact } from "./money-text"

import { isEmptyRows, WidgetShell } from "./widget-shell"

import type { DashboardWidgetState } from "./use-dashboard"

/**
 * Upcoming and overdue installments, eight rows deep.
 *
 * Urgency is carried by text and icon as well as colour — "4 d overdue" next to
 * the muted red, "Due in 3 d" next to the amber — so the table reads correctly
 * without relying on the hue alone. Recording a payment opens the same
 * allocation dialog the Payments hub uses, prefilled with that customer, and
 * the widget re-answers itself on success rather than the whole page refetching.
 */

export function InstallmentsCard({
  state,

  currency,

  today,

  /** The tenant's local today, so "due in 3 d" agrees with the server. */
}: {
  state: DashboardWidgetState

  currency: string

  today: string
}) {
  const { can } = useSession()

  const canRecord = can("payments", "create")

  const [recording, setRecording] = useState<DashboardInstallmentRow | null>(
    null,
  )

  return (
    <Card className="min-w-0">
      <CardHeader>
        <div>
          <CardTitle>Upcoming &amp; Overdue Installments</CardTitle>

          <CardDescription>
            Lines due within seven days or already past due, soonest first.
          </CardDescription>
        </div>

        <CardAction>
          <button
            type="button"
            onClick={() => navigate("/payments?tab=collections")}
            className="text-[12px] font-medium text-primary underline-offset-4 hover:underline"
          >
            View all
          </button>
        </CardAction>
      </CardHeader>

      <CardContent className="px-0 pb-0">
        <WidgetShell<Array<DashboardInstallmentRow>>
          state={state}
          isEmpty={isEmptyRows}
          skeletonHeight="h-56"
          empty={
            <EmptyState
              icon={CalendarClock}
              size="sm"
              title="Nothing due or overdue"
              description="Installment lines that fall due in the next week, or have slipped past their date, appear here."
            />
          }
        >
          {(rows) => (
            <div className="max-h-80 overflow-x-auto overflow-y-auto">
              <Table className="min-w-[46rem]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Customer</TableHead>

                    <TableHead>Unit</TableHead>

                    <TableHead>Due date</TableHead>

                    <TableHead className="text-right">Outstanding</TableHead>

                    <TableHead>Status</TableHead>

                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {rows.slice(0, 8).map((row) => (
                    <TableRow key={row.installmentId}>
                      <TableCell>
                        <p className="truncate text-[12.5px] font-medium text-foreground">
                          {row.customerName}
                        </p>

                        <p className="truncate text-[11.5px] text-muted-foreground">
                          {row.projectName}
                        </p>
                      </TableCell>

                      <TableCell className="text-[12.5px] tabular-nums">
                        {row.unitCode}
                      </TableCell>

                      <TableCell className="text-[12.5px] whitespace-nowrap">
                        {formatDate(row.dueDate)}
                      </TableCell>

                      <TableCell className="text-right text-[12.5px] tabular-nums whitespace-nowrap">
                        <MoneyExact
                          value={row.outstanding}
                          currency={currency}
                        />
                      </TableCell>

                      <TableCell className="text-[11.5px] whitespace-nowrap">
                        {row.overdue ? (
                          <span className="inline-flex items-center gap-1 font-medium text-danger">
                            <CircleDollarSign size={12} aria-hidden />
                            {row.daysOverdue} d overdue
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 font-medium text-warning">
                            <CalendarClock size={12} aria-hidden />
                            {dueInLabel(row.dueDate, today)}
                          </span>
                        )}
                      </TableCell>

                      <TableCell className="text-right">
                        {canRecord ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setRecording(row)}
                          >
                            Record payment
                          </Button>
                        ) : (
                          <span className="text-[11.5px] text-muted-foreground">
                            —
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </WidgetShell>
      </CardContent>

      <RecordAllocationDialog
        open={recording !== null}
        currency={currency}
        initialCustomerId={recording?.customerId ?? null}
        onClose={() => setRecording(null)}
        onRecorded={() => state.retry()}
      />
    </Card>
  )
}

/** Days from the tenant's today until the due date, in plain words. */

function dueInLabel(dueDate: string, today: string): string {
  if (dueDate === today) return "Due today"

  const days = Math.round(
    (new Date(`${dueDate}T00:00:00`).getTime() -
      new Date(`${today}T00:00:00`).getTime()) /
      86_400_000,
  )

  if (days === 1) return "Due tomorrow"

  return days > 1 ? `Due in ${days} d` : "Due now"
}
