/**
 * The support-ticket queue.
 *
 * Every service request raised through the portal or logged by staff, filterable
 * by status, priority, owner, and whether it has blown its SLA. Nothing here
 * resolves a ticket — that is the detail screen's job — but a manager can pick up
 * a ticket straight from the queue by assigning it to themselves or a colleague.
 *
 * The assignee control is inline because "whose is this" is the first question a
 * queue answers, and forcing a click-through to answer it makes triage slow.
 */

import { useMemo, useState } from "react"

import { LifeBuoy, Plus } from "lucide-react"

import { Alert, AlertDescription } from "@/components/ui/alert"

import { Badge } from "@/components/ui/badge"

import { Button } from "@/components/ui/button"

import { Card } from "@/components/ui/card"

import {
  DataTable,
  TableFilter,
  type DataTableColumn,
  type FilterOption,
} from "@/components/data-table"

import { EmptyState } from "@/components/empty-state"

import { PageHeader } from "@/components/page-header"

import { SavedViewControls } from "@/components/saved-view-controls"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

import { Skeleton } from "@/components/ui/skeleton"

import { formatRelative } from "@/lib/format"

import { navigate } from "@/lib/router"

import { useSession } from "@/lib/session-context"

import { ticketsApi, type TicketFilters } from "@/lib/tickets-api"

import { useAsyncResource } from "@/lib/use-async-resource"

import { TicketCreateDialog } from "./ticket-create-dialog"

import {
  TICKET_PRIORITIES,
  TICKET_PRIORITY_LABELS,
  TICKET_PRIORITY_TONES,
  TICKET_STATUSES,
  TICKET_STATUS_LABELS,
  TICKET_STATUS_TONES,
  type SupportTicket,
  type TicketPriority,
  type TicketStatus,
} from "@shared/tickets"

const STATUS_OPTIONS: FilterOption[] = TICKET_STATUSES.map(
  (status: TicketStatus) => ({
    value: status,

    label: TICKET_STATUS_LABELS[status],
  }),
)

const PRIORITY_OPTIONS: FilterOption[] = TICKET_PRIORITIES.map(
  (priority: TicketPriority) => ({
    value: priority,

    label: TICKET_PRIORITY_LABELS[priority],
  }),
)

/** The SLA cell: overdue reads as danger, otherwise a plain relative deadline. */

function SlaCell({ ticket }: { ticket: SupportTicket }) {
  if (ticket.isResolved || ticket.status === "closed") {
    return <span className="text-muted-foreground">—</span>
  }

  return (
    <span
      className={
        ticket.isOverdue
          ? "whitespace-nowrap font-medium text-red-600"
          : "whitespace-nowrap tabular-nums text-muted-foreground"
      }
    >
      {ticket.isOverdue ? "Overdue · " : "Due "}
      {formatRelative(ticket.slaDueBy)}
    </span>
  )
}

export function TicketsPage() {
  const session = useSession()

  const canView = session.can("tickets", "view")

  const [filters, setFilters] = useState<TicketFilters>({})

  const [resetToken, setResetToken] = useState(0)

  function applySavedView(state: string) {
    const parsed = JSON.parse(state) as TicketFilters

    setFilters(parsed)

    setResetToken((token) => token + 1)
  }

  const [creating, setCreating] = useState(false)

  const resource = useAsyncResource(
    (signal) => ticketsApi.list(filters, signal),

    canView,
  )

  const tickets = resource.data?.tickets ?? []

  const canEdit = resource.data?.canEdit ?? false

  const summary = resource.data?.summary

  const assigneeOptions: FilterOption[] = useMemo(
    () => [
      { value: "me", label: "Assigned to me" },

      { value: "unassigned", label: "Unassigned" },

      ...(resource.data?.assignees ?? []).map((assignee) => ({
        value: assignee.id,

        label: assignee.fullName,
      })),
    ],

    [resource.data],
  )

  async function assign(ticketId: string, assigneeUserId: string | null) {
    await ticketsApi.update(ticketId, { assigneeUserId })

    void resource.reload()
  }

  const columns = useMemo<Array<DataTableColumn<SupportTicket>>>(
    () => [
      {
        key: "subject",

        header: "Subject",

        cell: (row) => (
          <button
            type="button"
            onClick={() => navigate(`/tickets/${row.id}`)}
            className="block max-w-full truncate text-left font-medium text-foreground hover:underline"
          >
            {row.subject}
          </button>
        ),
      },

      {
        key: "customer",

        header: "Customer",

        width: "10rem",

        sortValue: (row) => row.customerName,

        cell: (row) => <span className="truncate">{row.customerName}</span>,
      },

      {
        key: "status",

        header: "Status",

        width: "8rem",

        sortValue: (row) => row.status,

        cell: (row) => (
          <Badge variant={TICKET_STATUS_TONES[row.status]}>
            {TICKET_STATUS_LABELS[row.status]}
          </Badge>
        ),
      },

      {
        key: "priority",

        header: "Priority",

        width: "7rem",

        sortValue: (row) => row.priority,

        cell: (row) => (
          <Badge variant={TICKET_PRIORITY_TONES[row.priority]}>
            {TICKET_PRIORITY_LABELS[row.priority]}
          </Badge>
        ),
      },

      {
        key: "assignee",

        header: "Assignee",

        width: "12rem",

        sortValue: (row) => row.assigneeName ?? "",

        cell: (row) =>
          canEdit ? (
            <Select
              value={row.assigneeUserId ?? "unassigned"}
              onValueChange={(value) =>
                void assign(
                  row.id,

                  value === "unassigned" ? null : value,
                )
              }
            >
              <SelectTrigger
                size="sm"
                aria-label={`Assign ${row.subject}`}
                className="w-full"
              >
                <SelectValue placeholder="Unassigned" />
              </SelectTrigger>

              <SelectContent>
                <SelectItem value="unassigned">Unassigned</SelectItem>

                {(resource.data?.assignees ?? []).map((assignee) => (
                  <SelectItem key={assignee.id} value={assignee.id}>
                    {assignee.fullName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <span className="truncate">
              {row.assigneeName ?? (
                <span className="text-muted-foreground">Unassigned</span>
              )}
            </span>
          ),
      },

      {
        key: "sla",

        header: "Response due",

        width: "11rem",

        sortValue: (row) => row.slaDueBy,

        cell: (row) => <SlaCell ticket={row} />,
      },
    ],

    [canEdit, resource.data],
  )

  const filtersActive = Boolean(
    filters.status || filters.priority || filters.assignee || filters.sla,
  )

  if (!canView) {
    return (
      <EmptyState
        icon={LifeBuoy}
        title="Support tickets are not available to your role"
        description="Ask a workspace administrator for the tickets grant to view this page."
        tone="pending"
      />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Support tickets"
        description="Service requests raised from the customer portal and by staff, with assignment and response deadlines."
        actions={
          resource.data?.canCreate ? (
            <Button onClick={() => setCreating(true)}>
              <Plus size={14} />
              New ticket
            </Button>
          ) : null
        }
      />

      {summary ? (
        <div className="flex flex-wrap gap-2 text-[12.5px] text-muted-foreground">
          <Badge variant="outline">{summary.total} total</Badge>

          <Badge variant="pending">{summary.open} open</Badge>

          <Badge variant={summary.overdue > 0 ? "danger" : "outline"}>
            {summary.overdue} overdue
          </Badge>
        </div>
      ) : null}

      <Card className="p-0">
        <div className="flex flex-wrap items-end gap-2 border-b border-border px-3 py-3">
          <TableFilter
            label="Status"
            value={filters.status ?? ""}
            placeholder="All statuses"
            options={STATUS_OPTIONS}
            onValueChange={(value) =>
              setFilters((current) => ({
                ...current,

                status: value as TicketStatus | "",
              }))
            }
          />

          <TableFilter
            label="Priority"
            value={filters.priority ?? ""}
            placeholder="All priorities"
            options={PRIORITY_OPTIONS}
            onValueChange={(value) =>
              setFilters((current) => ({
                ...current,

                priority: value as TicketPriority | "",
              }))
            }
          />

          <TableFilter
            label="Assignee"
            value={filters.assignee ?? ""}
            placeholder="Anyone"
            options={assigneeOptions}
            onValueChange={(value) =>
              setFilters((current) => ({ ...current, assignee: value }))
            }
          />

          <TableFilter
            label="SLA"
            value={filters.sla ?? ""}
            placeholder="Any deadline"
            options={[{ value: "overdue", label: "Overdue only" }]}
            onValueChange={(value) =>
              setFilters((current) => ({
                ...current,

                sla: value as "overdue" | "",
              }))
            }
          />

          <SavedViewControls
            scope="tickets"
            serialize={() => JSON.stringify(filters)}
            onApply={applySavedView}
          />

          {filtersActive ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() => setFilters({})}
            >
              Clear
            </Button>
          ) : null}
        </div>

        {resource.error ? (
          <Alert variant="danger" className="m-3">
            <AlertDescription>{resource.error}</AlertDescription>
          </Alert>
        ) : resource.loading && !resource.data ? (
          <Skeleton className="m-3 h-40 w-auto" />
        ) : tickets.length === 0 ? (
          <EmptyState
            icon={LifeBuoy}
            title="No tickets yet"
            description={
              filtersActive
                ? "No ticket matches these filters. Widen them or clear them."
                : "Requests raised from the portal or logged here will appear in the queue."
            }
          />
        ) : (
          <DataTable<SupportTicket>
            columns={columns}
            rows={tickets}
            rowKey={(row) => row.id}
            initialSort={{ key: "sla", direction: "asc" }}
            resetToken={resetToken}
            showFilterBar={false}
            caption="Support tickets"
          />
        )}
      </Card>

      <TicketCreateDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={(ticketId) => navigate(`/tickets/${ticketId}`)}
      />
    </div>
  )
}
