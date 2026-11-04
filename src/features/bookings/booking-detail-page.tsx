/**
 * A single booking, read in full.
 *
 * This is the record a commitment left behind: who bought, what they bought, who
 * (if anyone) brought them, the money and date taken, and the terms agreed. The
 * names are the ones snapshotted when the booking was made, so the page still reads
 * truthfully after a customer is renamed or a dealer relationship ends — which is
 * exactly why they were copied onto the row instead of only referenced.
 *
 * A cancel is offered here for a role that may approve, and only while the booking
 * stands. It is the one action this page can take; everything else is read-only,
 * because changing a booking's substance means cancelling and making a fresh one, so
 * the history stays honest.
 */

import { useState } from "react"

import { ArrowLeft, CalendarClock, XCircle } from "lucide-react"

import { Alert, AlertDescription } from "@/components/ui/alert"

import { Badge } from "@/components/ui/badge"

import { Button } from "@/components/ui/button"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

import { EmptyState } from "@/components/empty-state"

import { PageHeader } from "@/components/page-header"

import { Skeleton } from "@/components/ui/skeleton"

import { CancelBookingDialog } from "@/features/bookings/cancel-booking-dialog"

import { DocumentSection } from "@/features/documents/document-section"

import { InstallmentScheduleTable } from "./installment-schedule-table"

import { PaymentPlanBuilderDialog } from "./payment-plan-builder-dialog"

import { RecordPaymentDialog } from "./record-payment-dialog"

import { useSession } from "@/lib/session-context"

import { BOOKING_STATUS_LABELS, BOOKING_STATUS_TONES } from "@shared/bookings"

import { formatCurrency, formatDate, formatDateTime } from "@/lib/format"

import { href, navigate } from "@/lib/router"

import { bookingsApi } from "@/lib/bookings-api"

import { paymentsApi, type Installment } from "@/lib/payments-api"

import { useAsyncResource } from "@/lib/use-async-resource"

interface BookingDetailPageProps {
  bookingId: string
}

/** One label/value line. An absent value renders a dash, never a blank or a zero. */

function Detail({
  label,

  value,
}: {
  label: string

  value: React.ReactNode
}) {
  return (
    <div className="grid grid-cols-3 items-baseline gap-x-3 py-1.5">
      <dt className="col-span-1 text-[11.5px] text-muted-foreground">
        {label}
      </dt>
      <dd className="col-span-2 min-w-0 text-[12.5px] text-foreground">
        {value === null || value === undefined || value === "" ? "—" : value}
      </dd>
    </div>
  )
}

/**
 * The payment plan this booking is financed on.
 *
 * Hidden entirely for a role without the payments read grant. Otherwise it reads the
 * confirmed plan and its dated schedule from the payments endpoint, whose own
 * `canCreate` / `canRecord` flags decide whether the build button and the per-line
 * record action appear. A confirmed booking with no plan yet offers the builder; a
 * stored plan draws the schedule and, for the money role, a receipt action per line.
 *
 * A unit sold lump sum only gets no builder at all: the server already answers
 * `canCreate: false` for it, and the card says so in the unit's own sale-mode words
 * instead of leaving a blank that reads like a missing step.
 */

function PaymentPlanCard({
  bookingId,

  netAmount,

  currency,

  startDate,

  confirmed,
}: {
  bookingId: string

  netAmount: number

  currency: string

  startDate: string

  confirmed: boolean
}) {
  const { can } = useSession()

  const canView = can("payments", "view")

  const resource = useAsyncResource(
    (signal) => paymentsApi.readPlan(bookingId, signal),

    canView,
  )

  const [building, setBuilding] = useState(false)

  const [recording, setRecording] = useState<Installment | null>(null)

  if (!canView) return null

  const data = resource.data

  const canCreate = (data?.canCreate ?? false) && confirmed

  const canRecord = data?.canRecord ?? false

  const hasPlan = Boolean(data?.plan)

  // Read from the unit's own sale mode, so the words on the page are the words the
  // inventory was set up with. A missing flag means an older response and says nothing.
  const lumpSumOnly = data ? !data.allowsInstallments : false

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3">
        <CardTitle className="flex items-center gap-2">
          <CalendarClock size={15} className="text-primary" />
          Payment plan
        </CardTitle>
        {canCreate && !hasPlan && !resource.loading ? (
          <Button size="sm" onClick={() => setBuilding(true)}>
            Build payment plan
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="py-2">
        {resource.error && !data ? (
          <Alert variant="danger">
            <AlertDescription>{resource.error}</AlertDescription>
          </Alert>
        ) : !data ? (
          <Skeleton className="h-10 w-full" />
        ) : data.plan ? (
          <InstallmentScheduleTable
            installments={data.installments}
            currency={data.currency}
            canRecord={canRecord}
            onRecord={(installment) => setRecording(installment)}
          />
        ) : lumpSumOnly ? (
          <p className="text-[12.5px] text-muted-foreground">
            This unit is sold {data.saleMode ?? "lump sum"}, so the balance is
            paid in one go and no installment schedule is built for the booking.
          </p>
        ) : (
          <p className="text-[12.5px] text-muted-foreground">
            No payment plan has been confirmed for this booking
            {confirmed
              ? ". Build one to generate its installment schedule."
              : "."}
          </p>
        )}
      </CardContent>

      <PaymentPlanBuilderDialog
        open={building}
        bookingId={bookingId}
        netAmount={netAmount}
        currency={currency}
        defaultStartDate={startDate}
        onClose={() => setBuilding(false)}
        onConfirmed={() => void resource.reload()}
      />

      <RecordPaymentDialog
        open={recording !== null}
        installment={recording}
        currency={data?.currency ?? currency}
        onClose={() => setRecording(null)}
        onRecorded={() => void resource.reload()}
      />
    </Card>
  )
}

export default function BookingDetailPage({
  bookingId,
}: BookingDetailPageProps) {
  const { data, loading, error, reload } = useAsyncResource((signal) =>
    bookingsApi.read(bookingId, signal),
  )

  const [cancelling, setCancelling] = useState(false)

  const booking = data?.booking ?? null

  const currency = data?.currency ?? "AED"

  const canApprove = data?.canApprove ?? false

  const header = (
    <PageHeader
      scope={
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2 h-6 px-2 text-[11.5px]"
          onClick={() => navigate("/bookings")}
        >
          <ArrowLeft size={12} />
          Bookings
        </Button>
      }
      title={booking?.reference ?? "Booking"}
      description={
        booking
          ? `${booking.customerName} · unit ${booking.unitCode} · ${booking.projectName}`
          : undefined
      }
      actions={
        booking ? (
          <>
            <Badge variant={BOOKING_STATUS_TONES[booking.status]}>
              {BOOKING_STATUS_LABELS[booking.status]}
            </Badge>
            {canApprove && booking.status === "confirmed" ? (
              <Button variant="danger" onClick={() => setCancelling(true)}>
                <XCircle size={13} />
                Cancel booking
              </Button>
            ) : null}
          </>
        ) : null
      }
    />
  )

  if (error)
    return (
      <div className="flex flex-col gap-4">
        {header}
        <Alert variant="danger">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    )

  if (!booking)
    return (
      <div className="flex flex-col gap-4">
        {header}
        <Card>
          <CardContent className="py-8">
            <EmptyState
              icon={XCircle}
              title={loading ? "Loading booking…" : "Booking not found"}
              description={
                loading
                  ? undefined
                  : "The record may have been removed or belongs to another workspace."
              }
              action={
                !loading ? (
                  <Button
                    variant="outline"
                    onClick={() => navigate("/bookings")}
                  >
                    Back to bookings
                  </Button>
                ) : undefined
              }
            />
          </CardContent>
        </Card>
      </div>
    )

  const channelValue = booking.dealerName ? (
    <>
      Dealer · {booking.dealerName}
      {booking.agentName ? ` (agent ${booking.agentName})` : ""}
    </>
  ) : booking.agentName ? (
    `Agent · ${booking.agentName}`
  ) : (
    "Direct sale"
  )

  // What the committed property actually is, resolved by the server from the unit. Null
  // only when the unit row has gone, in which case the card stays as it always was
  // rather than printing six dashes over a code that still identifies the sale.
  const facts = booking.unitFacts

  return (
    <div className="flex flex-col gap-4">
      {header}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Customer</CardTitle>
          </CardHeader>
          <CardContent className="py-2">
            <dl>
              <Detail
                label="Name"
                value={
                  <a
                    href={href(`/customers/${booking.customerId}`)}
                    className="text-primary underline-offset-2 hover:underline"
                  >
                    {booking.customerName}
                  </a>
                }
              />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Unit</CardTitle>
          </CardHeader>
          <CardContent className="py-2">
            <dl>
              <Detail
                label="Code"
                value={
                  <a
                    href={href(`/projects/${booking.projectId}`)}
                    className="font-mono text-[12px] text-primary underline-offset-2 hover:underline"
                  >
                    {booking.unitCode}
                  </a>
                }
              />
              <Detail label="Project" value={booking.projectName} />
              {facts ? (
                <>
                  <Detail
                    label="Property type"
                    value={
                      facts.propertyType === null
                        ? null
                        : [facts.propertyType, facts.subtype]
                            .filter((part) => part !== null && part !== "")
                            .join(" · ")
                    }
                  />

                  <Detail label="Usage" value={facts.usage} />

                  <Detail label="Size" value={facts.sizeDisplay} />

                  <Detail
                    label="Key details"
                    value={
                      facts.detailSummary.length > 0
                        ? facts.detailSummary.join(" · ")
                        : null
                    }
                  />

                  <Detail label="Sale mode" value={facts.saleMode} />

                  <Detail
                    label="Address"
                    value={
                      [facts.address, facts.areaCity]
                        .filter((part) => part !== null && part !== "")
                        .join(", ") || null
                    }
                  />
                </>
              ) : null}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Sales channel</CardTitle>
          </CardHeader>
          <CardContent className="py-2">
            <dl>
              <Detail label="Brought by" value={channelValue} />
              {booking.createdByName ? (
                <Detail label="Recorded by" value={booking.createdByName} />
              ) : null}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Financials</CardTitle>
          </CardHeader>
          <CardContent className="py-2">
            <dl>
              <Detail
                label="Booking amount"
                value={formatCurrency(booking.bookingAmount, currency, {
                  maximumFractionDigits: 0,
                })}
              />
              <Detail
                label="Booking date"
                value={formatDate(booking.bookingDate)}
              />
              {booking.quoteNumber ? (
                <Detail
                  label="From quotation"
                  value={
                    <>
                      {booking.quoteNumber}
                      {booking.quoteTotal !== null
                        ? ` · ${formatCurrency(booking.quoteTotal, currency, {
                            maximumFractionDigits: 0,
                          })}`
                        : ""}
                    </>
                  }
                />
              ) : null}
            </dl>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Terms</CardTitle>
        </CardHeader>
        <CardContent className="py-2.5">
          <p className="text-[12.5px] leading-6 whitespace-pre-wrap text-foreground">
            {booking.terms || "—"}
          </p>
          {booking.notes ? (
            <>
              <p className="mt-3 text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
                Notes
              </p>
              <p className="mt-1 text-[12.5px] leading-6 whitespace-pre-wrap text-muted-foreground">
                {booking.notes}
              </p>
            </>
          ) : null}
        </CardContent>
      </Card>

      <PaymentPlanCard
        bookingId={bookingId}
        netAmount={booking.bookingAmount}
        currency={currency}
        startDate={booking.bookingDate}
        confirmed={booking.status === "confirmed"}
      />

      <Card>
        <CardHeader>
          <CardTitle>Documents</CardTitle>
        </CardHeader>
        <CardContent className="py-3">
          <DocumentSection entityType="booking" entityId={bookingId} />
        </CardContent>
      </Card>

      <p className="text-[11.5px] text-muted-foreground">
        Created {formatDateTime(booking.createdAt)}
        {booking.status === "cancelled" && booking.cancelledAt
          ? ` · Cancelled by ${booking.cancelledByName ?? "—"} ${formatDateTime(
              booking.cancelledAt,
            )}`
          : ""}
      </p>

      <CancelBookingDialog
        open={cancelling}
        booking={{ id: bookingId, reference: booking.reference }}
        currency={currency}
        onClose={() => setCancelling(false)}
        onDone={() => void reload()}
      />
    </div>
  )
}
