/**
 * The buyer's service requests.
 *
 * The portal's ticket list, newest activity first, each row carrying the
 * customer's own latest message so it reads like a thread rather than a bare
 * status column. Raising opens the intake dialog; opening a row goes to the
 * thread where they can reply or close it. Status triage itself is staff work —
 * the portal only lets a buyer open and follow up.
 */

import { useState } from "react"

import { LifeBuoy, Plus } from "lucide-react"

import { Alert, AlertDescription } from "@/components/ui/alert"

import { Badge } from "@/components/ui/badge"

import { Button } from "@/components/ui/button"

import { Card, CardContent } from "@/components/ui/card"

import { EmptyState } from "@/components/empty-state"

import { Skeleton } from "@/components/ui/skeleton"

import { formatDate, formatRelative } from "@/lib/format"

import { navigate } from "@/lib/router"

import { portalApi } from "@/lib/portal-api"

import { useAsyncResource } from "@/lib/use-async-resource"

import { PortalRequestCreateDialog } from "./portal-request-create-dialog"

import {
  TICKET_PRIORITY_LABELS,
  TICKET_PRIORITY_TONES,
  TICKET_STATUS_LABELS,
  TICKET_STATUS_TONES,
  type TicketPriority,
  type TicketStatus,
} from "@shared/tickets"

import type { PortalRequestSummary } from "@shared/portal"

function statusLabel(status: string): string {
  return TICKET_STATUS_LABELS[(status as TicketStatus)] ?? status
}

function statusTone(status: string) {
  return TICKET_STATUS_TONES[(status as TicketStatus)] ?? "outline"
}

function priorityLabel(priority: string): string {
  return TICKET_PRIORITY_LABELS[(priority as TicketPriority)] ?? priority
}

function priorityTone(priority: string) {
  return TICKET_PRIORITY_TONES[(priority as TicketPriority)] ?? "outline"
}

export function PortalRequestsPage() {
  const resource = useAsyncResource((signal) => portalApi.requests(signal))

  const [raising, setRaising] = useState(false)

  const requests = resource.data?.requests ?? []

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-foreground">
            My requests
          </h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Ask the office for help and follow the conversation here.
          </p>
        </div>
        <Button onClick={() => setRaising(true)}>
          <Plus size={14} />
          New request
        </Button>
      </div>

      {resource.error ? (
        <Alert variant="danger">
          <AlertDescription>{resource.error}</AlertDescription>
        </Alert>
      ) : resource.loading && !resource.data ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : requests.length === 0 ? (
        <Card>
          <CardContent className="py-6">
            <EmptyState
              icon={LifeBuoy}
              size="sm"
              title="No requests yet"
              description="Raise a request and the office will reply to it here."
            />
          </CardContent>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {requests.map((request: PortalRequestSummary) => (
            <li key={request.id}>
              <Card className="transition-colors hover:bg-muted/30">
                <CardContent className="py-4">
                  <button
                    type="button"
                    onClick={() => navigate(`/portal/requests/${request.id}`)}
                    className="flex w-full flex-col gap-2 text-left"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[14px] font-medium text-foreground">
                        {request.subject}
                      </span>
                      <span className="flex items-center gap-1.5">
                        <Badge variant={statusTone(request.status)}>
                          {statusLabel(request.status)}
                        </Badge>
                        <Badge variant={priorityTone(request.priority)}>
                          {priorityLabel(request.priority)}
                        </Badge>
                      </span>
                    </div>

                    <p className="truncate text-[12.5px] text-muted-foreground">
                      {request.lastMessage ?? "No replies yet."}
                    </p>

                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-muted-foreground">
                      <span>Raised {formatDate(request.createdAt)}</span>
                      <span>·</span>
                      <span>Updated {formatRelative(request.updatedAt)}</span>
                      {request.bookingReference ? (
                        <>
                          <span>·</span>
                          <span className="tabular-nums">
                            {request.bookingReference}
                          </span>
                        </>
                      ) : null}
                      {!request.isOverdue &&
                      request.status !== "resolved" &&
                      request.status !== "closed" ? (
                        <>
                          <span>·</span>
                          <span>
                            Reply by {formatRelative(request.slaDueBy)}
                          </span>
                        </>
                      ) : null}
                      {request.isOverdue ? (
                        <>
                          <span>·</span>
                          <span className="font-medium text-red-600">
                            Overdue
                          </span>
                        </>
                      ) : null}
                    </div>
                  </button>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <PortalRequestCreateDialog
        open={raising}
        onOpenChange={setRaising}
        onCreated={(requestId) => navigate(`/portal/requests/${requestId}`)}
      />
    </div>
  )
}
