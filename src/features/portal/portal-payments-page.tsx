/**
 * The buyer's payment schedule and receipt trail.
 *
 * The whole instalment plan across every property on the account, oldest line
 * first, each tagged with the phase the server derives at read time — `paid`,
 * `upcoming`, `due_today`, `overdue`. Below it, the receipts already issued.
 * This is a read of the ledger the office maintains; the portal never edits it,
 * so there are no controls here beyond a link to raise a request about a line.
 */

import { Receipt } from "lucide-react"

import { Alert, AlertDescription } from "@/components/ui/alert"

import { Badge } from "@/components/ui/badge"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

import { EmptyState } from "@/components/empty-state"

import { Skeleton } from "@/components/ui/skeleton"

import { formatCurrency, formatDate } from "@/lib/format"

import { href } from "@/lib/router"

import { portalApi } from "@/lib/portal-api"

import { useAsyncResource } from "@/lib/use-async-resource"

import {
  PORTAL_PAYMENT_PHASE_LABELS,
  type PortalPaymentPhase,
} from "@shared/portal"

const PHASE_TONES: Record<PortalPaymentPhase, "success" | "outline" | "pending" | "danger"> =
  {
    paid: "success",

    upcoming: "outline",

    due_today: "pending",

    overdue: "danger",
  }

export function PortalPaymentsPage() {
  const resource = useAsyncResource((signal) => portalApi.payments(signal))

  if (resource.loading && !resource.data) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (resource.error) {
    return (
      <Alert variant="danger">
        <AlertDescription>{resource.error}</AlertDescription>
      </Alert>
    )
  }

  const payments = resource.data

  if (!payments) return null

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight text-foreground">
          Payments
        </h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Your instalment schedule and the receipts issued against it.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="py-4">
            <p className="text-[11.5px] uppercase tracking-[0.08em] text-muted-foreground">
              Total due
            </p>
            <p className="mt-1 text-[18px] font-semibold tabular-nums text-foreground">
              {formatCurrency(payments.totalDue, payments.currency)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-[11.5px] uppercase tracking-[0.08em] text-muted-foreground">
              Paid
            </p>
            <p className="mt-1 text-[18px] font-semibold tabular-nums text-foreground">
              {formatCurrency(payments.totalPaid, payments.currency)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-[11.5px] uppercase tracking-[0.08em] text-muted-foreground">
              Outstanding
            </p>
            <p
              className={`mt-1 text-[18px] font-semibold tabular-nums ${
                payments.outstanding > 0 ? "text-amber-600" : "text-foreground"
              }`}
            >
              {formatCurrency(payments.outstanding, payments.currency)}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Instalment schedule</CardTitle>
        </CardHeader>
        <CardContent className="px-0 py-0">
          {payments.schedule.length === 0 ? (
            <EmptyState
              icon={Receipt}
              size="sm"
              title="No instalments yet"
              description="Your payment plan will appear here once it is set up."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="border-b border-border text-left text-[11.5px] uppercase tracking-[0.06em] text-muted-foreground">
                    <th className="px-4 py-2 font-medium">Due date</th>
                    <th className="px-4 py-2 font-medium">Property</th>
                    <th className="px-4 py-2 font-medium">Instalment</th>
                    <th className="px-4 py-2 text-right font-medium">Total</th>
                    <th className="px-4 py-2 text-right font-medium">
                      Balance
                    </th>
                    <th className="px-4 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {payments.schedule.map((line) => (
                    <tr key={line.installmentId}>
                      <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-foreground">
                        {formatDate(line.dueDate)}
                      </td>
                      <td className="px-4 py-2.5 text-foreground">
                        <span className="block">{line.unitCode}</span>
                        <span className="text-[11px] text-muted-foreground">
                          {line.bookingReference}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">
                        #{line.number} · {line.kind}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-foreground">
                        {formatCurrency(line.total, line.currency)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-foreground">
                        {line.balance > 0
                          ? formatCurrency(line.balance, line.currency)
                          : "—"}
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge variant={PHASE_TONES[line.phase]}>
                          {PORTAL_PAYMENT_PHASE_LABELS[line.phase]}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Receipts</CardTitle>
        </CardHeader>
        <CardContent className="px-0 py-0">
          {payments.receipts.length === 0 ? (
            <EmptyState
              icon={Receipt}
              size="sm"
              title="No receipts yet"
              description="Receipts for payments you have made will be listed here."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="border-b border-border text-left text-[11.5px] uppercase tracking-[0.06em] text-muted-foreground">
                    <th className="px-4 py-2 font-medium">Received</th>
                    <th className="px-4 py-2 font-medium">Receipt</th>
                    <th className="px-4 py-2 font-medium">Method</th>
                    <th className="px-4 py-2 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {payments.receipts.map((receipt) => (
                    <tr key={receipt.paymentId}>
                      <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-foreground">
                        {formatDate(receipt.receivedAt)}
                      </td>
                      <td className="px-4 py-2.5 text-foreground">
                        {receipt.receiptNumber ?? "—"}
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">
                        {receipt.method}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-foreground">
                        {formatCurrency(receipt.amount, receipt.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-[12px] text-muted-foreground">
        A payment is missing or looks wrong?{" "}
        <a
          href={href("/portal/requests")}
          className="text-primary underline-offset-2 hover:underline"
        >
          Raise a request
        </a>{" "}
        and the office will follow up.
      </p>
    </div>
  )
}
