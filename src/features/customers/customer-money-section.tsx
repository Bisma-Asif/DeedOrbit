/**
 * The customer's money section: their account ledger, their receipts, and the three
 * actions a finance desk takes on an account.
 *
 * The ledger is read-only and honest and now lives in its own filterable, exportable
 * view (`CustomerLedger`); every money event ever recorded, oldest first, with the
 * running balance the server folds in at read. Below it, the receipts they have paid,
 * each reprintable and each refundable.
 *
 * The actions are grant-gated the same way the server is: recording and refunding need
 * the payments create right, transferring a booking needs the bookings edit right, and a
 * role without the money view grant sees nothing but a note that it is hidden.
 */

import { useMemo, useState } from "react"

import { ArrowRightLeft, Printer, RotateCcw, Wallet } from "lucide-react"

import { Badge } from "@/components/ui/badge"

import { Button } from "@/components/ui/button"

import { DataTable, type DataTableColumn } from "@/components/data-table"

import { EmptyState } from "@/components/empty-state"

import { Skeleton } from "@/components/ui/skeleton"

import { useSession } from "@/lib/session-context"

import { useAsyncResource } from "@/lib/use-async-resource"

import { formatCurrency, formatDate, orDash } from "@/lib/format"

import { bookingsApi } from "@/lib/bookings-api"

import {
  paymentsApi,
  type PaymentListItem,
  type ReceiptView,
} from "@/lib/payments-api"

import { PAYMENT_METHOD_LABELS, PAYMENT_METHOD_TONES } from "@shared/payments"

import { PrintReceiptDialog } from "@/features/payments/receipt-document"

import { RecordAllocationDialog } from "@/features/payments/record-payment-dialog"

import { CustomerLedger } from "@/features/customers/customer-ledger"

import { RefundRequestDialog } from "@/features/customers/refund-request-dialog"

import { TransferRequestDialog } from "@/features/customers/transfer-request-dialog"

interface CustomerMoneySectionProps {
  customerId: string

  /** The account name, carried to the ledger's statement header and file title. */
  customerName: string
}

function moneyFor(currency: string) {
  return (value: number) =>
    formatCurrency(value, currency, { maximumFractionDigits: 0 })
}

export function CustomerMoneySection({
  customerId,
  customerName,
}: CustomerMoneySectionProps) {
  const { can } = useSession()

  const canViewMoney = can("payments", "view")

  const canCreate = can("payments", "create")

  const canEditBooking = can("bookings", "edit")

  const receipts = useAsyncResource(
    (signal) => paymentsApi.list(customerId, signal),

    canViewMoney,
  )

  const bookings = useAsyncResource(
    (signal) => bookingsApi.list(null, signal),

    canViewMoney && canEditBooking,
  )

  const [recording, setRecording] = useState(false)

  const [printing, setPrinting] = useState<ReceiptView | null>(null)

  const [loadingReceipt, setLoadingReceipt] = useState<string | null>(null)

  const [refunding, setRefunding] = useState<PaymentListItem | null>(null)

  // Bumped after a money mutation so the ledger view refetches its own rows.

  const [ledgerToken, setLedgerToken] = useState(0)

  function refreshLedger() {
    setLedgerToken((token) => token + 1)
  }

  const [transferring, setTransferring] = useState<{
    bookingId: string

    reference: string

    customerId: string
  } | null>(null)

  const currency = receipts.data?.currency ?? "AED"

  const money = moneyFor(currency)

  const confirmedBookings = useMemo(() => {
    const list = bookings.data?.bookings ?? []

    return list.filter(
      (booking) =>
        booking.customerId === customerId && booking.status === "confirmed",
    )
  }, [bookings.data, customerId])

  async function openReceipt(id: string) {
    setLoadingReceipt(id)

    try {
      setPrinting(await paymentsApi.receipt(id))
    } finally {
      setLoadingReceipt(null)
    }
  }

  const receiptColumns = useMemo<Array<DataTableColumn<PaymentListItem>>>(
    () => [
      {
        key: "receipt",

        header: "Receipt",

        width: "9rem",

        sortValue: (row) => row.receiptNumber ?? "",

        cell: (row) => (
          <span className="font-mono text-[11.5px] text-foreground">
            {orDash(row.receiptNumber)}
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

        width: "8rem",

        sortValue: (row) => row.amount,

        cell: (row) => (
          <span className="tabular-nums">{money(row.amount)}</span>
        ),
      },

      {
        key: "actions",

        header: "",

        align: "right",

        width: "12rem",

        cell: (row) => (
          <div className="flex items-center justify-end gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-muted-foreground"
              disabled={loadingReceipt === row.id}
              onClick={(event) => {
                event.stopPropagation()

                void openReceipt(row.id)
              }}
            >
              <Printer size={13} />
              Receipt
            </Button>
            {canCreate ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-muted-foreground"
                onClick={(event) => {
                  event.stopPropagation()

                  setRefunding(row)
                }}
              >
                <RotateCcw size={13} />
                Refund
              </Button>
            ) : null}
          </div>
        ),
      },
    ],

    [canCreate, loadingReceipt, money],
  )

  if (!canViewMoney) {
    return (
      <EmptyState
        icon={Wallet}
        size="sm"
        title="Account history not available"
        description="Your role cannot read the customer ledger or receipts."
      />
    )
  }

  const payments: PaymentListItem[] = receipts.data?.payments ?? []

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-semibold tracking-[0.07em] text-muted-foreground uppercase">
          Account
        </p>
        {canCreate ? (
          <Button size="sm" onClick={() => setRecording(true)}>
            <Wallet size={13} />
            Record payment
          </Button>
        ) : null}
      </div>

      {/* Ledger --------------------------------------------------------------- */}
      <CustomerLedger
        customerId={customerId}
        customerName={customerName}
        reloadToken={ledgerToken}
      />

      {/* Receipts ------------------------------------------------------------- */}
      <section className="flex flex-col gap-2">
        <p className="text-[13px] font-semibold text-foreground">Receipts</p>

        {receipts.loading && !receipts.data ? (
          <Skeleton className="h-40 w-full" />
        ) : payments.length === 0 ? (
          <EmptyState
            icon={Wallet}
            size="sm"
            title="No receipts yet"
            description="Record a payment to mint this customer's first receipt."
          />
        ) : (
          <div className="rounded-md border border-border">
            <DataTable<PaymentListItem>
              columns={receiptColumns}
              rows={payments}
              rowKey={(row) => row.id}
              initialSort={{ key: "received", direction: "desc" }}
              maxHeight="20rem"
              showFilterBar={false}
              caption="Receipts"
            />
          </div>
        )}
      </section>

      {/* Transfers ------------------------------------------------------------ */}
      {canEditBooking && confirmedBookings.length > 0 ? (
        <section className="flex flex-col gap-2">
          <p className="text-[13px] font-semibold text-foreground">
            Move a booking
          </p>
          <div className="flex flex-col divide-y divide-border rounded-md border border-border">
            {confirmedBookings.map((booking) => (
              <div
                key={booking.id}
                className="flex items-center justify-between gap-3 px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate font-mono text-[12px] text-foreground">
                    {booking.reference}
                  </p>
                  <p className="truncate text-[11.5px] text-muted-foreground">
                    {booking.unitCode} · {booking.projectName}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setTransferring({
                      bookingId: booking.id,

                      reference: booking.reference,

                      customerId: booking.customerId,
                    })
                  }
                >
                  <ArrowRightLeft size={13} />
                  Transfer
                </Button>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <RecordAllocationDialog
        open={recording}
        currency={currency}
        initialCustomerId={customerId}
        onClose={() => setRecording(false)}
        onRecorded={() => {
          refreshLedger()

          void receipts.reload()
        }}
      />

      <PrintReceiptDialog
        receipt={printing}
        onClose={() => setPrinting(null)}
      />

      <RefundRequestDialog
        open={refunding !== null}
        customerId={customerId}
        currency={currency}
        prefillPaymentId={refunding?.id ?? null}
        onClose={() => setRefunding(null)}
        onDone={refreshLedger}
      />

      <TransferRequestDialog
        open={transferring !== null}
        bookingId={transferring?.bookingId ?? ""}
        bookingReference={transferring?.reference ?? ""}
        fromCustomerId={transferring?.customerId ?? ""}
        currency={currency}
        onClose={() => setTransferring(null)}
        onDone={() => {
          refreshLedger()

          void receipts.reload()

          void bookings.reload()
        }}
      />
    </div>
  )
}
