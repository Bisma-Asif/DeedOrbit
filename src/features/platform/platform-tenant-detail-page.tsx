/**
 * One workspace through the platform's eyes: its plan, its billing state, the
 * money the platform has billed and collected from it, usage against the plan
 * limits, and the ledger of every billing decision made about it.
 *
 * The action buttons follow the codebase rule that a control which cannot work
 * is absent rather than disabled: Suspend only appears once the money story
 * allows it (due, or grace expired), Grant grace only appears when something
 * is outstanding, Reactivate only appears when the workspace is actually
 * suspended. The server refuses the same combinations again — hiding is
 * convenience, the refusal is the rule.
 *
 * Nothing on this page is estimated. Revenue is the sum of recorded payments,
 * outstanding is recorded invoices minus recorded payments, and a workspace on
 * a plan the catalogue doesn't know shows dashes instead of invented limits.
 */

import { useState, type ReactNode } from "react"

import {
  ArrowLeft,
  ArrowRightLeft,
  Banknote,
  CalendarClock,
  CalendarX,
  FileText,
  Hourglass,
  RotateCcw,
  ShieldOff,
} from "lucide-react"

import type { LucideIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

import { Badge } from "@/components/ui/badge"

import { Button } from "@/components/ui/button"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

import { EmptyState } from "@/components/empty-state"

import { PageHeader } from "@/components/page-header"

import { Skeleton } from "@/components/ui/skeleton"

import { StatCard } from "@/components/stat-card"

import {
  BillingStatusBadge,
  EVENT_TONE_BADGE,
  StorageMeter,
  UsageMeter,
  WorkspaceStatusBadge,
} from "@/features/platform/platform-bits"

import {
  PlatformActionDialog,
  type PlatformTenantAction,
} from "@/features/platform/platform-action-dialog"

import {
  formatCurrency,
  formatDate,
  formatDateTime,
  formatRelative,
  orDash,
} from "@/lib/format"

import { href, navigate } from "@/lib/router"

import {
  platformApi,
  type PlatformBillingEventView,
  type PlatformTenantView,
} from "@/lib/platform-api"

import { useAsyncResource } from "@/lib/use-async-resource"

import { planDefinition } from "@shared/platform"

import type { BillingEventKind, PlatformUsage } from "@shared/platform"

interface PlatformTenantDetailPageProps {
  tenantId: string
}

const EVENT_ICONS: Record<BillingEventKind, LucideIcon> = {
  invoice: FileText,

  payment: Banknote,

  billing_due: CalendarClock,

  grace_granted: Hourglass,

  grace_expired: CalendarX,

  suspension: ShieldOff,

  reactivation: RotateCcw,

  plan_change: ArrowRightLeft,
}

export function PlatformTenantDetailPage({
  tenantId,
}: PlatformTenantDetailPageProps) {
  const resource = useAsyncResource((signal) =>
    platformApi.tenant(tenantId, signal),
  )

  const [dialog, setDialog] = useState<PlatformTenantAction | null>(null)

  if (resource.loading && !resource.data) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (resource.error) {
    return (
      <EmptyState
        icon={ShieldOff}
        tone="danger"
        title="Could not open this workspace"
        description={resource.error}
        action={
          <Button
            variant="outline"
            onClick={() => navigate("/platform/tenants")}
          >
            Back to workspaces
          </Button>
        }
      />
    )
  }

  const tenant = resource.data?.tenant ?? null

  if (!tenant) return null

  const events = resource.data?.events ?? []

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        scope={
          <a
            href={href("/platform/tenants")}
            className="inline-flex items-center gap-1 rounded-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <ArrowLeft size={12} />
            Workspaces
          </a>
        }
        title={tenant.name}
        description={tenant.legalName ?? tenant.slug}
        actions={
          <>
            <Button variant="outline" onClick={() => setDialog("invoice")}>
              <FileText size={13} />
              Record invoice
            </Button>
            <Button variant="outline" onClick={() => setDialog("payment")}>
              <Banknote size={13} />
              Record payment
            </Button>
            <Button variant="outline" onClick={() => setDialog("plan")}>
              <ArrowRightLeft size={13} />
              Change plan
            </Button>
            <DueAndGraceActions tenant={tenant} onAction={setDialog} />
          </>
        }
      />

      <GracePanel tenant={tenant} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard
          label="Billing"
          value={<BillingStatusBadge status={tenant.billingStatus} />}
          hint={
            tenant.billingStatus === "grace_active" && tenant.graceEndsAt
              ? `Runs until ${formatDate(tenant.graceEndsAt)}`
              : tenant.billingStatus === "grace_expired"
                ? `Expired ${formatRelative(tenant.graceEndsAt)}`
                : tenant.billingStatus === "due"
                  ? "No grace period granted"
                  : "Payments recorded up to date"
          }
        />
        <StatCard
          label="Invoiced"
          value={formatCurrency(tenant.amountInvoiced, tenant.currency)}
          hint={
            tenant.lastBilledAt
              ? `Last invoice ${formatDate(tenant.lastBilledAt)}`
              : "Nothing billed yet"
          }
        />
        <StatCard
          label="Collected"
          value={formatCurrency(tenant.revenueCollected, tenant.currency)}
          hint="Sum of recorded payments"
        />
        <StatCard
          label="Outstanding"
          value={
            tenant.outstanding > 0 ? (
              <span className="text-warning">
                {formatCurrency(tenant.outstanding, tenant.currency)}
              </span>
            ) : (
              formatCurrency(0, tenant.currency)
            )
          }
          hint="Invoiced minus collected"
        />
        <StatCard
          label="Plan price"
          value={
            tenant.monthlyAmount === null
              ? undefined
              : formatCurrency(tenant.monthlyAmount, tenant.currency)
          }
          hint={
            tenant.monthlyAmount === null
              ? "Plan not in the catalogue"
              : `${tenant.planLabel} per month`
          }
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Usage against plan limits</CardTitle>
            <CardDescription>
              {tenant.planLabel
                ? `${tenant.planLabel} allows ${planLimitSummary(tenant)}`
                : "This workspace sits on a plan the catalogue does not know; limits show a dash."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <UsageRow label="Team members" usage={tenant.usage.users}>
              <UsageMeter usage={tenant.usage.users} />
            </UsageRow>
            <UsageRow label="Projects" usage={tenant.usage.projects}>
              <UsageMeter usage={tenant.usage.projects} />
            </UsageRow>
            <UsageRow
              label="Document storage"
              usage={tenant.usage.storageBytes}
            >
              <StorageMeter usage={tenant.usage.storageBytes} />
            </UsageRow>
          </CardContent>
        </Card>

        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Workspace</CardTitle>
            <CardDescription>Identity and lifecycle facts.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="flex flex-col gap-2.5 text-[12.5px]">
              <Fact label="Status">
                <WorkspaceStatusBadge status={tenant.status} />
              </Fact>
              <Fact label="Plan">{orDash(tenant.planLabel)}</Fact>
              <Fact label="Slug">
                <span className="font-mono text-[11.5px]">{tenant.slug}</span>
              </Fact>
              <Fact label="Currency">{tenant.currency}</Fact>
              <Fact label="Created">{formatDate(tenant.createdAt)}</Fact>
              {tenant.graceReason && (
                <Fact label="Grace reason">{tenant.graceReason}</Fact>
              )}
            </dl>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Billing timeline</CardTitle>
            <CardDescription>
              Every invoice, payment, and platform decision recorded for this
              workspace, newest first.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {events.length === 0 ? (
              <EmptyState
                icon={CalendarClock}
                size="sm"
                title="No billing history yet"
                description="Invoices, payments, and status decisions for this workspace will appear here."
              />
            ) : (
              <ul className="divide-y divide-border">
                {events.map((event) => (
                  <TimelineRow
                    key={event.id}
                    event={event}
                    currency={tenant.currency}
                  />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <PlatformActionDialog
        action={dialog}
        tenant={tenant}
        onClose={() => setDialog(null)}
        onDone={() => void resource.reload()}
      />
    </div>
  )
}

/**
 * The state-dependent actions. A workspace already due is not offered "Mark
 * due"; nothing outstanding is not offered grace; suspension only appears
 * when the derived billing state allows it, so the operator never has to
 * discover the refusal by clicking.
 */

function DueAndGraceActions({
  tenant,

  onAction,
}: {
  tenant: PlatformTenantView

  onAction: (action: PlatformTenantAction) => void
}) {
  const canSuspend =
    tenant.status === "active" &&
    (tenant.billingStatus === "due" || tenant.billingStatus === "grace_expired")

  return (
    <>
      {tenant.status === "active" &&
        tenant.billingStatus !== "due" &&
        tenant.billingStatus !== "grace_active" && (
          <Button variant="outline" onClick={() => onAction("due")}>
            <CalendarClock size={13} />
            Mark due
          </Button>
        )}
      {tenant.status === "active" && tenant.billingStatus !== "current" && (
        <Button variant="outline" onClick={() => onAction("grace")}>
          <Hourglass size={13} />
          Grant grace
        </Button>
      )}
      {tenant.status === "active" && canSuspend && (
        <Button variant="danger" onClick={() => onAction("suspend")}>
          <ShieldOff size={13} />
          Suspend
        </Button>
      )}
      {tenant.status !== "active" && (
        <Button variant="default" onClick={() => onAction("reactivate")}>
          <RotateCcw size={13} />
          Reactivate
        </Button>
      )}
    </>
  )
}

/** The urgency panel above the stats: what the current billing state means. */

function GracePanel({ tenant }: { tenant: PlatformTenantView }) {
  if (tenant.billingStatus === "current") return null

  if (tenant.billingStatus === "grace_active") {
    return (
      <Alert variant="pending">
        <Hourglass />
        <AlertTitle>
          Grace period runs until{" "}
          {tenant.graceEndsAt ? formatDate(tenant.graceEndsAt) : "—"}
        </AlertTitle>
        <AlertDescription>
          {tenant.graceReason ? `Granted because: ${tenant.graceReason}. ` : ""}
          Suspension is not available while the window is open. A further grant
          extends it from its own end, not from today.
        </AlertDescription>
      </Alert>
    )
  }

  if (tenant.billingStatus === "grace_expired") {
    return (
      <Alert variant="danger">
        <CalendarX />
        <AlertTitle>
          Grace period expired {formatRelative(tenant.graceEndsAt)}
        </AlertTitle>
        <AlertDescription>
          {tenant.graceReason
            ? `It was granted because: ${tenant.graceReason}. `
            : ""}
          {tenant.status === "active"
            ? "Record a payment to settle it, grant more time, or suspend the workspace."
            : "The workspace is not active; reactivate it to return it to the platform with its balance still due."}
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <Alert variant="pending">
      <CalendarClock />
      <AlertTitle>Payment due</AlertTitle>
      <AlertDescription>
        {tenant.outstanding > 0
          ? `${formatCurrency(tenant.outstanding, tenant.currency)} outstanding on recorded invoices. `
          : ""}
        Record a payment when money arrives, or grant a grace period with a
        stated reason if the workspace bought time.
      </AlertDescription>
    </Alert>
  )
}

function UsageRow({
  label,

  usage,

  children,
}: {
  label: string

  usage: PlatformUsage

  children: ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <p className="text-[12.5px] font-medium text-foreground">
        {label}
        {usage.limit !== null && usage.used >= usage.limit && (
          <Badge variant="danger" className="ml-2">
            At limit
          </Badge>
        )}
      </p>
      {children}
    </div>
  )
}

function Fact({
  label,

  children,
}: {
  label: string

  children: ReactNode
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right text-foreground">{children}</dd>
    </div>
  )
}

function TimelineRow({
  event,

  currency,
}: {
  event: PlatformBillingEventView

  currency: string
}) {
  const Icon = EVENT_ICONS[event.kind]

  return (
    <li className="flex items-start gap-2.5 px-4 py-2.5">
      <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-[5px] border border-border bg-muted text-muted-foreground">
        <Icon size={13} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[12.5px] font-medium text-foreground">
            {event.kindLabel}
          </span>
          <Badge variant={EVENT_TONE_BADGE[event.tone]}>{event.tone}</Badge>
          {event.amount !== null && (
            <span className="text-[12.5px] font-medium tabular-nums text-foreground">
              {formatCurrency(event.amount, event.currency ?? currency)}
            </span>
          )}
        </p>
        {event.note && (
          <p className="mt-0.5 text-[11.5px] leading-4 text-muted-foreground">
            {event.note}
          </p>
        )}
        <p className="mt-0.5 text-[10.5px] text-muted-foreground/80">
          {formatDateTime(event.createdAt)}
          {event.actorEmail ? ` · ${event.actorEmail}` : ""}
        </p>
      </div>
    </li>
  )
}

function planLimitSummary(tenant: PlatformTenantView): string {
  const definition = planDefinition(tenant.plan)

  if (!definition) return "no catalogue limits"

  return `${definition.limits.users} users, ${definition.limits.projects} projects, ${formatCurrency(definition.monthlyAmount, tenant.currency)}/mo`
}
