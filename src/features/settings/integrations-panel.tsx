/**
 * Settings > Integrations: API keys, webhooks, the delivery log, and the honest
 * list of connections that are not wired.
 *
 * Reads need `settings.view`; every write here needs `settings.edit`. The panel
 * loads once (`load`) and re-reads after each mutation, so what you see is the
 * server's own view — a key shows its prefix and never its plaintext, an endpoint
 * shows no secret after creation, and the delivery log rows are the record of
 * requests that actually happened.
 *
 * The placeholder cards are the point of honesty for this screen: a payment
 * gateway, WhatsApp/SMS, and email all report `connected: false` with a plain
 * note, rather than a silent zero or an invented health light.
 */

import { useState, type ReactNode } from "react"

import {
  Ban,
  KeyRound,
  Pause,
  Play,
  PlugZap,
  Plus,
  Send,
  ShieldOff,
  Webhook,
} from "lucide-react"

import { Alert, AlertDescription } from "@/components/ui/alert"

import { Badge } from "@/components/ui/badge"

import type { BadgeVariant } from "@/components/ui/badge"

import { Button } from "@/components/ui/button"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

import {
  DataTable,
  TableFilter,
  type DataTableColumn,
} from "@/components/data-table"

import { EmptyState } from "@/components/empty-state"

import { Skeleton } from "@/components/ui/skeleton"

import {
  CreateApiKeyDialog,
  EndpointFormDialog,
  RevokeApiKeyDialog,
} from "@/features/settings/integrations-dialogs"

import { formatDate, formatDateTime, orDash } from "@/lib/format"

import { integrationsApi } from "@/lib/integrations-api"

import { useSession } from "@/lib/session-context"

import { useAsyncResource } from "@/lib/use-async-resource"

import {
  DELIVERY_STATUS_LABELS,
  DELIVERY_STATUSES,
  WEBHOOK_AUTO_PAUSE_AFTER,
  WEBHOOK_EVENTS,
  WEBHOOK_EVENT_LABELS,
  type ApiKeyView,
  type WebhookDeliveryView,
  type WebhookEndpointView,
} from "@shared/integrations"

/** A status pill: its label and the badge tone to render it with. */
interface StatusBadge {
  label: string

  tone: BadgeVariant
}

function apiKeyStatus(row: ApiKeyView): StatusBadge {
  if (row.revokedAt) return { label: "Revoked", tone: "danger" }

  if (!row.active) return { label: "Expired", tone: "neutral" }

  return { label: "Active", tone: "success" }
}

function endpointStatus(row: WebhookEndpointView): StatusBadge {
  if (row.status === "active") return { label: "Active", tone: "success" }

  if (row.status === "paused") return { label: "Paused", tone: "pending" }

  return { label: row.status, tone: "neutral" }
}

const DELIVERY_TONES: Record<string, BadgeVariant> = {
  pending: "pending",

  success: "success",

  failed: "danger",

  timeout: "danger",
}

function deliveryTone(status: string): BadgeVariant {
  return DELIVERY_TONES[status] ?? "neutral"
}

function eventLabel(event: string): string {
  return (WEBHOOK_EVENTS as readonly string[]).includes(event)
    ? WEBHOOK_EVENT_LABELS[(event as typeof WEBHOOK_EVENTS[number])]
    : event === "test"
      ? "Test"
      : event
}

export function IntegrationsPanel() {
  const session = useSession()

  const canView = session.can("settings", "view")

  const canEdit = session.can("settings", "edit")

  const resource = useAsyncResource(
    (signal) => integrationsApi.load(signal),

    canView,
  )

  const [creatingKey, setCreatingKey] = useState(false)

  const [revokeTarget, setRevokeTarget] = useState<ApiKeyView | null>(null)

  const [endpointDialogOpen, setEndpointDialogOpen] = useState(false)

  const [editEndpoint, setEditEndpoint] = useState<WebhookEndpointView | null>(
    null,
  )

  const [actionError, setActionError] = useState<string | null>(null)

  const [testingId, setTestingId] = useState<string | null>(null)

  // Bumped after any event that should refresh the delivery log — a test, a

  // mutation — so the child remounts and re-reads. The log filters its own query.

  const [deliveryTick, setDeliveryTick] = useState(0)

  const data = resource.data

  async function runAction(mutate: () => Promise<unknown>) {
    setActionError(null)

    try {
      await mutate()

      await resource.reload()

      setDeliveryTick((current) => current + 1)
    } catch (cause) {
      setActionError(
        cause instanceof Error ? cause.message : "That action failed.",
      )
    }
  }

  async function sendTest(endpoint: WebhookEndpointView) {
    setTestingId(endpoint.id)

    await runAction(() => integrationsApi.testEndpoint(endpoint.id))

    setTestingId(null)
  }

  function togglePause(endpoint: WebhookEndpointView) {
    const next = endpoint.status === "active" ? "paused" : "active"

    void runAction(() =>
      integrationsApi.updateEndpoint(endpoint.id, { status: next }),
    )
  }

  if (!canView) {
    return (
      <EmptyState
        icon={PlugZap}
        title="Integrations is not available to your role"
        description="Ask a workspace administrator for the settings grant to view this section."
        tone="pending"
      />
    )
  }

  const loading = resource.loading && !data

  return (
    <div className="flex flex-col gap-4">
      {actionError ? (
        <Alert variant="danger">
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      ) : null}

      {loading ? (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : resource.error ? (
        <Alert variant="danger">
          <AlertDescription>{resource.error}</AlertDescription>
        </Alert>
      ) : data ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Connected services</CardTitle>
              <CardDescription>
                These connections are not wired in this build. They are listed
                so the surface is honest about what does and does not leave the
                workspace — nothing here contacts a gateway or provider.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-3 py-2 sm:grid-cols-3">
              {data.placeholders.map((placeholder) => (
                <div
                  key={placeholder.key}
                  className="rounded-md border border-border p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[13px] font-medium text-foreground">
                      {placeholder.label}
                    </p>
                    <Badge variant="neutral">
                      <ShieldOff size={11} />
                      Not connected
                    </Badge>
                  </div>
                  <p className="mt-1.5 text-[11.5px] leading-5 text-muted-foreground">
                    {placeholder.note}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-start justify-between gap-3">
              <div className="flex flex-col gap-1">
                <CardTitle>API keys</CardTitle>
                <CardDescription>
                  Bearer keys for the read-only open surface. A key is shown in
                  full once, at creation; the list keeps only its prefix.
                </CardDescription>
              </div>
              {canEdit ? (
                <Button size="sm" onClick={() => setCreatingKey(true)}>
                  <Plus size={14} />
                  New key
                </Button>
              ) : null}
            </CardHeader>
            <CardContent className="flex flex-col py-1">
              {data.apiKeys.length === 0 ? (
                <EmptyState
                  icon={KeyRound}
                  size="sm"
                  title="No API keys"
                  description="Issue a key to let an external system read this workspace's leads."
                />
              ) : (
                data.apiKeys.map((row) => {
                  const status = apiKeyStatus(row)

                  return (
                    <div
                      key={row.id}
                      className="flex items-center justify-between gap-3 border-b border-border py-2.5 last:border-b-0"
                    >
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 truncate text-[13px] font-medium text-foreground">
                          {row.label}
                          <Badge variant={status.tone}>{status.label}</Badge>
                        </p>
                        <p className="truncate text-[11.5px] text-muted-foreground">
                          <span className="font-mono">{row.prefix}…</span> · by{" "}
                          {row.createdBy} · created {formatDate(row.createdAt)}{" "}
                          ·{" "}
                          {row.lastUsedAt
                            ? `last used ${formatDate(row.lastUsedAt)}`
                            : "never used"}
                          {row.expiresAt
                            ? ` · expires ${formatDate(row.expiresAt)}`
                            : ""}
                        </p>
                      </div>
                      {canEdit && row.active ? (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => setRevokeTarget(row)}
                          aria-label={`Revoke ${row.label}`}
                        >
                          <Ban size={13} />
                        </Button>
                      ) : null}
                    </div>
                  )
                })
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-start justify-between gap-3">
              <div className="flex flex-col gap-1">
                <CardTitle>Webhook endpoints</CardTitle>
                <CardDescription>
                  Real HTTP POSTs on each subscribed event. An endpoint pauses
                  itself after {WEBHOOK_AUTO_PAUSE_AFTER} consecutive failures;
                  a manual pause/resume clears the streak.
                </CardDescription>
              </div>
              {canEdit ? (
                <Button
                  size="sm"
                  onClick={() => {
                    setEditEndpoint(null)

                    setEndpointDialogOpen(true)
                  }}
                >
                  <Plus size={14} />
                  New endpoint
                </Button>
              ) : null}
            </CardHeader>
            <CardContent className="flex flex-col py-1">
              {data.endpoints.length === 0 ? (
                <EmptyState
                  icon={Webhook}
                  size="sm"
                  title="No webhook endpoints"
                  description="Add a URL to receive events as they happen."
                />
              ) : (
                data.endpoints.map((row) => {
                  const status = endpointStatus(row)

                  return (
                    <div
                      key={row.id}
                      className="flex flex-col gap-2 border-b border-border py-2.5 last:border-b-0 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 truncate text-[13px] font-medium text-foreground">
                          {row.url}
                          <Badge variant={status.tone}>{status.label}</Badge>
                        </p>
                        <p className="truncate text-[11.5px] text-muted-foreground">
                          {row.events.length === 0
                            ? "No events"
                            : row.events.map(eventLabel).join(", ")}{" "}
                          ·{" "}
                          {row.consecutiveFailures > 0
                            ? `${row.consecutiveFailures} consecutive failures`
                            : "no failure streak"}{" "}
                          · {row.failureCount} total
                          {row.pauseReason ? ` · ${row.pauseReason}` : ""}
                        </p>
                      </div>
                      {canEdit ? (
                        <div className="flex shrink-0 items-center gap-1.5">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={testingId === row.id}
                            onClick={() => void sendTest(row)}
                          >
                            <Send size={13} />
                            {testingId === row.id ? "Testing…" : "Send test"}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setEditEndpoint(row)

                              setEndpointDialogOpen(true)
                            }}
                          >
                            Edit
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => togglePause(row)}
                            aria-label={
                              row.status === "active"
                                ? `Pause ${row.url}`
                                : `Resume ${row.url}`
                            }
                          >
                            {row.status === "active" ? (
                              <Pause size={13} />
                            ) : (
                              <Play size={13} />
                            )}
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  )
                })
              )}
            </CardContent>
          </Card>

          <DeliveryLog tick={deliveryTick} />
        </>
      ) : null}

      <CreateApiKeyDialog
        open={creatingKey}
        onOpenChange={setCreatingKey}
        onCreated={() => {
          void resource.reload()

          setDeliveryTick((current) => current + 1)
        }}
      />

      {revokeTarget ? (
        <RevokeApiKeyDialog
          apiKey={revokeTarget}
          onClose={() => setRevokeTarget(null)}
          onRevoked={() => {
            void resource.reload()
          }}
        />
      ) : null}

      <EndpointFormDialog
        open={endpointDialogOpen}
        onOpenChange={setEndpointDialogOpen}
        endpoint={editEndpoint}
        onSaved={() => {
          void resource.reload()
        }}
      />
    </div>
  )
}

// --- Delivery log ----------------------------------------------------------

interface DeliveryLogProps {
  tick: number
}

const EVENT_FILTER_OPTIONS = WEBHOOK_EVENTS.map((value) => ({
  value,

  label: WEBHOOK_EVENT_LABELS[value],
}))

const STATUS_FILTER_OPTIONS = DELIVERY_STATUSES.map((value) => ({
  value,

  label: DELIVERY_STATUS_LABELS[value],
}))

function deliveryColumns(): Array<DataTableColumn<WebhookDeliveryView>> {
  return [
    {
      key: "createdAt",

      header: "When",

      sortValue: (row) => row.createdAt,

      cell: (row) => (
        <span className="whitespace-nowrap text-muted-foreground">
          {formatDateTime(row.createdAt)}
        </span>
      ),
    },

    {
      key: "event",

      header: "Event",

      cell: (row) => (
        <span className="flex items-center gap-1.5">
          <Badge variant={row.isTest ? "info" : "outline"}>
            {eventLabel(row.event)}
          </Badge>
        </span>
      ),
    },

    {
      key: "endpoint",

      header: "Endpoint",

      cell: (row) => (
        <span className="block max-w-[16rem] truncate text-foreground">
          {row.endpointUrl}
        </span>
      ),
    },

    {
      key: "status",

      header: "Result",

      sortValue: (row) => row.status,

      cell: (row) => (
        <Badge variant={deliveryTone(row.status)}>{row.statusLabel}</Badge>
      ),
    },

    {
      key: "http",

      header: "HTTP",

      align: "right",

      sortValue: (row) => row.httpStatus ?? -1,

      cell: (row) => <span>{orDash(row.httpStatus)}</span>,
    },

    {
      key: "duration",

      header: "Duration",

      align: "right",

      sortValue: (row) => row.durationMs ?? -1,

      cell: (row) => (
        <span>{row.durationMs === null ? "—" : `${row.durationMs} ms`}</span>
      ),
    },

    {
      key: "response",

      header: "Response",

      cell: (row) => (
        <span
          className="block max-w-[18rem] truncate text-muted-foreground"
          title={row.responseSnippet ?? undefined}
        >
          {orDash(row.responseSnippet)}
        </span>
      ),
    },
  ]
}

function DeliveryLog({ tick }: DeliveryLogProps) {
  const [event, setEvent] = useState("")

  const [status, setStatus] = useState("")

  return (
    <Card className="py-0">
      <div className="border-b border-border px-4 pt-3.5 pb-2">
        <p className="text-[13px] font-semibold text-foreground">
          Delivery log
        </p>
        <p className="mt-0.5 text-[11.5px] text-muted-foreground">
          Every attempt is a real request: the status, duration, and response
          are what the endpoint actually returned. The most recent 200 are kept.
        </p>
      </div>
      <DeliveryRows
        key={`${event}|${status}|${tick}`}
        event={event}
        status={status}
      >
        {(resource) => (
          <DataTable<WebhookDeliveryView>
            columns={deliveryColumns()}
            rows={resource.rows}
            rowKey={(row) => row.id}
            getRowSearchText={(row) => `${row.endpointUrl} ${row.event}`}
            initialSort={{ key: "createdAt", direction: "desc" }}
            filters={{ event, status }}
            onFilterChange={(key, value) => {
              if (key === "event") setEvent(value)

              if (key === "status") setStatus(value)
            }}
            loading={resource.loading}
            maxHeight="max(16rem, calc(100dvh - 30rem))"
            caption="Webhook deliveries"
            filterBar={
              <>
                <TableFilter
                  label="Event"
                  value={event || "__all"}
                  placeholder="All"
                  options={EVENT_FILTER_OPTIONS}
                  onValueChange={(value) =>
                    setEvent(value === "__all" ? "" : value)
                  }
                />
                <TableFilter
                  label="Result"
                  value={status || "__all"}
                  placeholder="All"
                  options={STATUS_FILTER_OPTIONS}
                  onValueChange={(value) =>
                    setStatus(value === "__all" ? "" : value)
                  }
                />
              </>
            }
            emptyState={
              resource.error ? (
                <EmptyState
                  icon={Send}
                  tone="danger"
                  title="Could not load the delivery log"
                  description={resource.error}
                />
              ) : (
                <EmptyState
                  icon={Send}
                  size="sm"
                  title="No deliveries yet"
                  description="Events fired here will appear as real requests, with what came back."
                />
              )
            }
          />
        )}
      </DeliveryRows>
    </Card>
  )
}

/** Fetches one filtered page of deliveries; the parent remounts it via `key`. */

function DeliveryRows({
  event,

  status,

  children,
}: {
  event: string

  status: string

  children: (resource: {
    rows: WebhookDeliveryView[]

    loading: boolean

    error: string | null
  }) => ReactNode
}) {
  const resource = useAsyncResource(
    (signal) =>
      integrationsApi.listDeliveries(
        event || undefined,
        status || undefined,
        signal,
      ),

    true,
  )

  return (
    <>
      {children({
        rows: resource.data?.deliveries ?? [],

        loading: resource.loading && !resource.data,

        error: resource.error,
      })}
    </>
  )
}
