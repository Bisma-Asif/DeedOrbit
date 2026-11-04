/**
 * The portal landing page.
 *
 * A buyer opens here to answer two questions — what do I own, and what do I
 * owe — before deciding where to go. So this is a short money summary over a
 * card per property, each of which links straight to the payments and documents
 * that concern it. Everything is scoped server-side to the customer profiles
 * linked to this login; an unlinked login never reaches this page (the API
 * returns `portal_not_linked` and the shell shows the notice).
 */

import { Building2, FileText, LifeBuoy, Wallet } from "lucide-react"

import { Alert, AlertDescription } from "@/components/ui/alert"

import { Badge } from "@/components/ui/badge"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

import { EmptyState } from "@/components/empty-state"

import { Skeleton } from "@/components/ui/skeleton"

import { formatCurrency, formatDate } from "@/lib/format"

import { href } from "@/lib/router"

import { portalApi } from "@/lib/portal-api"

import { useAsyncResource } from "@/lib/use-async-resource"

import type { PortalOverview } from "@shared/portal"

interface StatTileProps {
  label: string

  value: string

  hint?: string

  tone?: "default" | "danger" | "pending"
}

function StatTile({ label, value, hint, tone = "default" }: StatTileProps) {
  const valueTone =
    tone === "danger"
      ? "text-red-600"
      : tone === "pending"
        ? "text-amber-600"
        : "text-foreground"

  return (
    <Card>
      <CardContent className="py-5">
        <p className="text-[11.5px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
          {label}
        </p>
        <p
          className={`mt-1 text-[22px] font-semibold tabular-nums ${valueTone}`}
        >
          {value}
        </p>
        {hint ? (
          <p className="mt-0.5 text-[11.5px] text-muted-foreground">{hint}</p>
        ) : null}
      </CardContent>
    </Card>
  )
}

/** One owned property: what it is, what's paid, and where the next payment is. */

function PropertyCard({
  property,
}: {
  property: PortalOverview["properties"][number]
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div className="min-w-0">
          <CardTitle className="truncate">{property.projectName}</CardTitle>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">
            {property.unitCode}
            {property.unitType ? ` · ${property.unitType}` : ""}
            {property.unitLocation ? ` · ${property.unitLocation}` : ""}
          </p>
        </div>
        {property.status !== "confirmed" ? (
          <Badge variant="outline">{property.status}</Badge>
        ) : null}
      </CardHeader>

      <CardContent className="flex flex-col gap-3 py-2">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[12.5px] sm:grid-cols-3">
          <div>
            <dt className="text-muted-foreground">Booking ref</dt>
            <dd className="font-medium tabular-nums text-foreground">
              {property.bookingReference}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Total due</dt>
            <dd className="font-medium tabular-nums text-foreground">
              {formatCurrency(property.totalDue, property.currency)}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Paid</dt>
            <dd className="font-medium tabular-nums text-foreground">
              {formatCurrency(property.totalPaid, property.currency)}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Outstanding</dt>
            <dd
              className={`font-medium tabular-nums ${
                property.outstanding > 0 ? "text-amber-600" : "text-foreground"
              }`}
            >
              {formatCurrency(property.outstanding, property.currency)}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Next due</dt>
            <dd className="font-medium text-foreground">
              {property.nextDueDate ? formatDate(property.nextDueDate) : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Next amount</dt>
            <dd className="font-medium tabular-nums text-foreground">
              {property.nextInstallmentAmount === null
                ? "—"
                : formatCurrency(
                    property.nextInstallmentAmount,
                    property.currency,
                  )}
            </dd>
          </div>
        </dl>

        <div className="flex flex-wrap gap-2 border-t border-border pt-3 text-[11.5px]">
          <a
            href={href("/portal/payments")}
            className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline"
          >
            <Wallet size={12} />
            Payment schedule
          </a>
          {property.documentCount > 0 ? (
            <a
              href={href("/portal/documents")}
              className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline"
            >
              <FileText size={12} />
              {property.documentCount} document
              {property.documentCount === 1 ? "" : "s"}
            </a>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}

export function PortalOverviewPage() {
  const resource = useAsyncResource((signal) => portalApi.overview(signal))

  if (resource.loading && !resource.data) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-10 w-64" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
        <Skeleton className="h-40 w-full" />
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

  const overview = resource.data

  if (!overview) return null

  const buyerName = overview.profiles[0]?.fullName ?? ""

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight text-foreground">
          Welcome{buyerName ? `, ${buyerName}` : ""}
        </h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Your purchases, payment schedule, documents, and service requests —
          everything on your account, in one place.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Total value"
          value={formatCurrency(overview.totalBookingValue, overview.currency)}
        />
        <StatTile
          label="Paid to date"
          value={formatCurrency(overview.totalPaid, overview.currency)}
        />
        <StatTile
          label="Outstanding"
          value={formatCurrency(overview.totalOutstanding, overview.currency)}
          tone={overview.totalOutstanding > 0 ? "pending" : "default"}
        />
        <StatTile
          label="Overdue"
          value={formatCurrency(overview.overdueAmount, overview.currency)}
          hint={
            overview.overdueCount > 0
              ? `${overview.overdueCount} instalment${
                  overview.overdueCount === 1 ? "" : "s"
                } past due`
              : overview.dueSoonCount > 0
                ? `${overview.dueSoonCount} due within 30 days`
                : "Nothing past due"
          }
          tone={overview.overdueAmount > 0 ? "danger" : "default"}
        />
      </div>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold text-foreground">
            <Building2 size={16} />
            Your properties
          </h2>
          {overview.openRequests > 0 ? (
            <Badge variant="pending">
              <LifeBuoy size={11} />
              {overview.openRequests} open request
              {overview.openRequests === 1 ? "" : "s"}
            </Badge>
          ) : null}
        </div>

        {overview.properties.length === 0 ? (
          <Card>
            <CardContent className="py-6">
              <EmptyState
                icon={Building2}
                size="sm"
                title="No properties yet"
                description="Once a purchase is recorded against your account it will appear here."
              />
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {overview.properties.map((property) => (
              <PropertyCard key={property.bookingId} property={property} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
