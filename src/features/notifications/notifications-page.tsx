/**
 * The Notifications page — the full personal inbox.
 *
 * Where the bell shows the newest 20 and polls, this is the whole recent set,
 * filterable by read state and event type, built on the shared `DataTable`. It
 * reads only the signed-in user's own rows (the server scopes by `user_id`), and
 * every action here is honest: marking read writes a real timestamp, opening a row
 * jumps to the record it points at, and nothing is invented where there is no data
 * — an actor or body that was not recorded renders as a dash, not a guess.
 */

import { useEffect, useMemo, useState } from "react"

import { Bell, CheckCheck, ExternalLink, Settings2 } from "lucide-react"

import { Alert, AlertDescription } from "@/components/ui/alert"

import { Badge } from "@/components/ui/badge"

import { Button } from "@/components/ui/button"

import {
  DataTable,
  type DataTableColumn,
  type FilterOption,
} from "@/components/data-table"

import { EmptyState } from "@/components/empty-state"

import { Field } from "@/components/field"

import { PageHeader } from "@/components/page-header"

import { Skeleton } from "@/components/ui/skeleton"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

import { navigate } from "@/lib/router"

import { formatDateTime, formatRelative, orDash } from "@/lib/format"

import { useAsyncResource } from "@/lib/use-async-resource"

import {
  notificationApi,
  type NotificationQuery,
} from "@/lib/notifications-api"

import {
  NOTIFICATION_TYPES,
  NOTIFICATION_TYPE_LABELS,
  type NotificationType,
  type NotificationView,
} from "@shared/notifications"

const PAGE_LIMIT = 200

interface FilterState {
  read: string

  type: string
}

const EMPTY_FILTERS: FilterState = { read: "", type: "" }

function rowSearchText(row: NotificationView): string {
  return [
    row.title,

    row.body ?? "",

    row.typeLabel,

    row.actorName ?? "",
  ].join(" ")
}

// --- Results (remounts when the filter set changes so it reloads once) ------

interface NotificationsResultsProps {
  query: NotificationQuery

  onUnread: (count: number) => void
}

function NotificationsResults({
  query,

  onUnread,
}: NotificationsResultsProps) {
  const resource = useAsyncResource((signal) =>
    notificationApi.list(query, signal),
  )

  const data = resource.data

  const [items, setItems] = useState<NotificationView[]>([])

  const [unread, setUnread] = useState(0)

  useEffect(() => {
    if (!data) return

    setItems(data.notifications)

    setUnread(data.unreadCount)

    onUnread(data.unreadCount)
  }, [data, onUnread])

  function markOne(id: string) {
    const target = items.find((item) => item.id === id)

    if (!target || target.readAt) return

    const readAt = new Date().toISOString()

    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, readAt } : item)),
    )

    setUnread((count) => Math.max(0, count - 1))

    notificationApi.markRead(id).catch(() => {
      // A failure here is corrected on the next reload rather than left to drift

      // — undo the optimistic mark so the row does not lie about being read.

      setItems((prev) =>
        prev.map((item) => (item.id === id ? { ...item, readAt: null } : item)),
      )

      setUnread((count) => count + 1)
    })
  }

  function openRow(row: NotificationView) {
    markOne(row.id)

    if (row.linkPath) navigate(row.linkPath)
  }

  function markAll() {
    if (unread === 0) return

    const readAt = new Date().toISOString()

    setItems((prev) => prev.map((item) => ({ ...item, readAt })))

    setUnread(0)

    onUnread(0)

    notificationApi.markAllRead().catch(() => void resource.reload())
  }

  const columns = useMemo<Array<DataTableColumn<NotificationView>>>(
    () => [
      {
        key: "status",

        header: "",

        width: "2.5rem",

        sortValue: (row) => (row.readAt ? 1 : 0),

        cell: (row) =>
          row.readAt ? (
            <span className="ml-1 block size-1.5 rounded-full bg-transparent" />
          ) : (
            <span
              aria-label="Unread"
              className="ml-1 block size-1.5 rounded-full bg-primary"
            />
          ),
      },

      {
        key: "event",

        header: "Event",

        width: "10rem",

        sortValue: (row) => row.typeLabel,

        cell: (row) => <Badge variant="neutral">{row.typeLabel}</Badge>,
      },

      {
        key: "title",

        header: "Notification",

        cell: (row) => (
          <div className="flex min-w-0 flex-col">
            <span
              className={
                row.readAt
                  ? "truncate text-[13px] text-muted-foreground"
                  : "truncate text-[13px] font-semibold text-foreground"
              }
            >
              {row.title}
            </span>

            {row.body && (
              <span className="truncate text-[11.5px] text-muted-foreground">
                {row.body}
              </span>
            )}
          </div>
        ),
      },

      {
        key: "actor",

        header: "From",

        width: "10rem",

        sortValue: (row) => row.actorName ?? "",

        cell: (row) => (
          <span className="truncate text-muted-foreground">
            {orDash(row.actorName)}
          </span>
        ),
      },

      {
        key: "when",

        header: "When",

        width: "11rem",

        sortValue: (row) => row.createdAt,

        cell: (row) => (
          <span
            className="whitespace-nowrap tabular-nums text-muted-foreground"
            title={formatDateTime(row.createdAt)}
          >
            {formatRelative(row.createdAt)}
          </span>
        ),
      },

      {
        key: "open",

        header: "",

        width: "6rem",

        align: "right",

        cell: (row) =>
          row.linkPath ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={(event) => {
                event.stopPropagation()

                openRow(row)
              }}
            >
              <ExternalLink size={13} />
              Open
            </Button>
          ) : null,
      },
    ],

    // `openRow` reads the latest `items` through the state updater, so a stable

    // column set is safe; recreating columns every keystroke would thrash sorts.

    // eslint-disable-next-line react-hooks/exhaustive-deps

    [],
  )

  if (resource.error) {
    return (
      <Alert variant="danger">
        <AlertDescription>{resource.error}</AlertDescription>
      </Alert>
    )
  }

  if (resource.loading && !data) {
    return <Skeleton className="h-64 w-full" />
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11.5px] text-muted-foreground tabular-nums">
          {unread > 0
            ? `${unread} unread · ${items.length} shown`
            : `${items.length} shown`}
          {data?.truncated ? " · most recent 200" : null}
        </span>

        <Button
          variant="outline"
          size="sm"
          onClick={markAll}
          disabled={unread === 0}
        >
          <CheckCheck size={13} />
          Mark all read
        </Button>
      </div>

      <div className="rounded-md border border-border">
        <DataTable<NotificationView>
          columns={columns}
          rows={items}
          rowKey={(row) => row.id}
          getRowSearchText={rowSearchText}
          loading={resource.loading && !data}
          initialSort={{ key: "when", direction: "desc" }}
          maxHeight="calc(100vh - 24rem)"
          caption="Notifications"
          onRowClick={openRow}
          emptyState={
            <EmptyState
              icon={Bell}
              size="sm"
              title="No notifications"
              description="Confirmed bookings, recorded payments, approval requests, and uploaded documents will appear here."
            />
          }
        />
      </div>
    </div>
  )
}

// --- Page ------------------------------------------------------------------

export function NotificationsPage() {
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS)

  const [unread, setUnread] = useState(0)

  const query = useMemo<NotificationQuery>(
    () => ({
      read: (filters.read || null) as "unread" | "read" | null,

      type: (filters.type || null) as NotificationType | null,

      limit: PAGE_LIMIT,
    }),

    [filters],
  )

  const panelKey = `${filters.read}|${filters.type}`

  const typeOptions = useMemo<FilterOption[]>(
    () =>
      NOTIFICATION_TYPES.map((type) => ({
        value: type,

        label: NOTIFICATION_TYPE_LABELS[type],
      })),

    [],
  )

  function patchFilters(next: Partial<FilterState>) {
    setFilters((current) => ({ ...current, ...next }))
  }

  const filtersActive = filters.read !== "" || filters.type !== ""

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Notifications"
        description="Your own recent activity — approvals waiting on you, bookings and payments on records you own, and documents filed against them."
        actions={
          <>
            {unread > 0 ? (
              <Badge variant="pending">{unread} unread</Badge>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate("/settings/notifications")}
            >
              <Settings2 size={13} />
              Notification settings
            </Button>
          </>
        }
      />

      <div className="rounded-md border border-border bg-card p-3">
        <div className="flex flex-wrap items-end gap-2.5">
          <Field label="Status" htmlFor="notif-read" className="w-[11rem]">
            <Select
              value={filters.read || "__all"}
              onValueChange={(value) =>
                patchFilters({ read: value === "__all" ? "" : value })
              }
            >
              <SelectTrigger id="notif-read" size="sm">
                <SelectValue placeholder="All" />
              </SelectTrigger>

              <SelectContent>
                <SelectItem value="__all">All</SelectItem>

                <SelectItem value="unread">Unread</SelectItem>

                <SelectItem value="read">Read</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Field label="Event" htmlFor="notif-type" className="w-[13rem]">
            <Select
              value={filters.type || "__all"}
              onValueChange={(value) =>
                patchFilters({ type: value === "__all" ? "" : value })
              }
            >
              <SelectTrigger id="notif-type" size="sm">
                <SelectValue placeholder="All events" />
              </SelectTrigger>

              <SelectContent>
                <SelectItem value="__all">All events</SelectItem>

                {typeOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {filtersActive ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() => setFilters(EMPTY_FILTERS)}
            >
              Clear
            </Button>
          ) : null}
        </div>
      </div>

      <NotificationsResults key={panelKey} query={query} onUnread={setUnread} />
    </div>
  )
}

export default NotificationsPage
