/**
 * The payments module hub.
 *
 * Finance lives in one place with two faces: the receipts the office has recorded,
 * and the recovery picture the schedule paints. They are tabs of a single module —
 * collections deliberately has no `MODULES` entry of its own, so it rides the same
 * `payments.*` grants and the existing `recovery_officer` role.
 *
 * The Payments tab lists recent receipts and opens the two things a money desk
 * actually does: record a payment (which mints a numbered receipt) and print one
 * back out. The Collections tab hands off to the dashboard.
 */

import { useMemo, useState } from "react"

import { Plus, Printer, Wallet } from "lucide-react"

import { Alert, AlertDescription } from "@/components/ui/alert"

import { Badge } from "@/components/ui/badge"

import { Button } from "@/components/ui/button"

import { Card } from "@/components/ui/card"

import { DataTable, type DataTableColumn } from "@/components/data-table"

import { EmptyState } from "@/components/empty-state"

import { PageHeader } from "@/components/page-header"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

import { Skeleton } from "@/components/ui/skeleton"

import { useSession } from "@/lib/session-context"

import { useAsyncResource } from "@/lib/use-async-resource"

import { formatCurrency, formatDate } from "@/lib/format"

import {
  paymentsApi,
  type PaymentListItem,
  type ReceiptView,
} from "@/lib/payments-api"

import { PAYMENT_METHOD_LABELS, PAYMENT_METHOD_TONES } from "@shared/payments"

import { CollectionsDashboard } from "@/features/payments/collections-dashboard"

import { PrintReceiptDialog } from "@/features/payments/receipt-document"

import { RecordAllocationDialog } from "@/features/payments/record-payment-dialog"

import type { NavItem } from "@/lib/navigation"

import { readQueryParam } from "@/lib/router"

function paymentSearchText(row: PaymentListItem): string {
  return [
    row.receiptNumber ?? "",

    row.customerName ?? "",

    PAYMENT_METHOD_LABELS[row.method] ?? row.method,

    row.note ?? "",
  ].join(" ")
}

export default function PaymentsPage({ module }: { module: NavItem }) {
  const { can } = useSession()

  const canCreate = can("payments", "create")

  const resource = useAsyncResource((signal) => paymentsApi.list(null, signal))

  // The dashboard's "Record Payment" quick action arrives as ?tab=payments&new=1.
  const [recording, setRecording] = useState(
    () => readQueryParam("new") === "1",
  )

  const [printing, setPrinting] = useState<ReceiptView | null>(null)

  // A dashboard KPI tile deep-links the tab it belongs to: overdue and
  // receivables land on the recovery board, collections on the receipt list.
  // An unknown value falls back to the receipts list rather than a blank panel.
  const initialTab = (() => {
    const requested = readQueryParam("tab")

    return requested === "collections" || requested === "payments"
      ? requested
      : "payments"
  })()

  const [loadingReceipt, setLoadingReceipt] = useState<string | null>(null)

  const currency = resource.data?.currency ?? "AED"

  const rows = resource.data?.payments ?? []

  async function openReceipt(id: string) {
    setLoadingReceipt(id)

    try {
      setPrinting(await paymentsApi.receipt(id))
    } finally {
      setLoadingReceipt(null)
    }
  }

  const columns = useMemo<Array<DataTableColumn<PaymentListItem>>>(
    () => [
      {
        key: "receipt",

        header: "Receipt",

        width: "10rem",

        sortValue: (row) => row.receiptNumber ?? "",

        cell: (row) => (
          <span className="font-mono text-[11.5px] text-foreground">
            {row.receiptNumber ?? "—"}
          </span>
        ),
      },

      {
        key: "customer",

        header: "Customer",

        width: "14rem",

        sortValue: (row) => row.customerName ?? "",

        cell: (row) => (
          <span className="truncate font-medium text-foreground">
            {row.customerName ?? "—"}
          </span>
        ),
      },

      {
        key: "method",

        header: "Method",

        width: "8rem",

        sortValue: (row) => row.method,

        cell: (row) => (
          <Badge variant={PAYMENT_METHOD_TONES[row.method]}>
            {PAYMENT_METHOD_LABELS[row.method] ?? row.method}
          </Badge>
        ),
      },

      {
        key: "amount",

        header: "Amount",

        align: "right",

        width: "9rem",

        sortValue: (row) => row.amount,

        cell: (row) => (
          <span className="tabular-nums">
            {formatCurrency(row.amount, currency, { maximumFractionDigits: 0 })}
          </span>
        ),
      },

      {
        key: "received",

        header: "Received",

        width: "8rem",

        sortValue: (row) => row.receivedAt,

        cell: (row) => (
          <span className="whitespace-nowrap tabular-nums text-muted-foreground">
            {formatDate(row.receivedAt)}
          </span>
        ),
      },

      {
        key: "actions",

        header: "",

        align: "right",

        width: "6rem",

        cell: (row) => (
          <Button
            variant="ghost"
            size="sm"
            className="-mr-2 h-6 text-muted-foreground"
            disabled={loadingReceipt === row.id}
            onClick={(event) => {
              event.stopPropagation()

              void openReceipt(row.id)
            }}
          >
            <Printer size={13} />
            Receipt
          </Button>
        ),
      },
    ],

    [currency, loadingReceipt],
  )

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={module.label} description={module.description} />

      <Tabs defaultValue={initialTab} className="flex flex-col gap-4">
        <TabsList>
          <TabsTrigger value="payments">
            <Wallet size={13} />
            Payments
          </TabsTrigger>
          <TabsTrigger value="collections">Collections</TabsTrigger>
        </TabsList>

        <TabsContent value="payments" className="flex flex-col gap-4">
          <div className="flex items-center justify-end">
            {canCreate ? (
              <Button onClick={() => setRecording(true)}>
                <Plus size={13} />
                Record payment
              </Button>
            ) : null}
          </div>

          {resource.error ? (
            <Alert variant="danger">
              <AlertDescription>{resource.error}</AlertDescription>
            </Alert>
          ) : null}

          <Card className="py-0">
            {resource.loading && !resource.data ? (
              <div className="p-4">
                <Skeleton className="h-64 w-full" />
              </div>
            ) : (
              <DataTable<PaymentListItem>
                columns={columns}
                rows={rows}
                rowKey={(row) => row.id}
                getRowSearchText={paymentSearchText}
                initialSort={{ key: "received", direction: "desc" }}
                loading={resource.loading && !resource.data}
                maxHeight="max(18rem, calc(100dvh - 25rem))"
                caption="Receipts"
                emptyState={
                  <EmptyState
                    icon={Wallet}
                    title="No payments recorded yet"
                    description="Record a payment to mint its first numbered receipt."
                    action={
                      canCreate ? (
                        <Button onClick={() => setRecording(true)}>
                          <Plus size={13} />
                          Record payment
                        </Button>
                      ) : undefined
                    }
                  />
                }
              />
            )}
          </Card>
        </TabsContent>

        <TabsContent value="collections">
          <CollectionsDashboard />
        </TabsContent>
      </Tabs>

      <RecordAllocationDialog
        open={recording}
        currency={currency}
        onClose={() => setRecording(false)}
        onRecorded={() => void resource.reload()}
      />

      <PrintReceiptDialog
        receipt={printing}
        onClose={() => setPrinting(null)}
      />
    </div>
  )
}
