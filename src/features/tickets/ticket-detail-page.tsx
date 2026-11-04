/**
 * One support ticket, worked.
 *
 * The thread (customer and staff replies interleaved in time order), the triage
 * controls (status, priority, assignee), and the attachments. Status moves are
 * offered only from the transitions the server will accept, so a click here can
 * never invent an edge the state machine does not have.
 *
 * Changing priority deliberately does not move the deadline: `sla_due_by` is the
 * promise made at intake. The page shows that promise alongside the current
 * priority so a re-triage is visible rather than silently extending the clock.
 */

import { useMemo, useRef, useState } from "react"

import {
  ArrowLeft,
  Download,
  LifeBuoy,
  Paperclip,
  Send,
  Trash2,
  Upload,
} from "lucide-react"

import { Alert, AlertDescription } from "@/components/ui/alert"

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

import { Field } from "@/components/field"

import { PageHeader } from "@/components/page-header"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

import { Skeleton } from "@/components/ui/skeleton"

import { Textarea } from "@/components/ui/textarea"

import {
  formatBytes,
  readFileAsDataUrl,
} from "@/features/documents/document-utils"

import { useSave } from "@/features/organization/use-save"

import { formatDateTime, formatRelative } from "@/lib/format"

import { navigate } from "@/lib/router"

import { useSession } from "@/lib/session-context"

import { ticketAttachmentUrl, ticketsApi } from "@/lib/tickets-api"

import { useAsyncResource } from "@/lib/use-async-resource"

import {
  TICKET_ATTACHMENT_ALLOWED_MIMES,
  TICKET_ATTACHMENT_MAX_BYTES,
  TICKET_ATTACHMENT_MAX_COUNT,
  TICKET_COMMENT_MAX,
  TICKET_PRIORITY_LABELS,
  TICKET_PRIORITY_TONES,
  TICKET_STATUS_LABELS,
  TICKET_STATUS_TONES,
  type TicketPriority,
  type TicketStatus,
} from "@shared/tickets"

interface TicketDetailPageProps {
  ticketId: string
}

const ACCEPT_ATTR = TICKET_ATTACHMENT_ALLOWED_MIMES.join(",")

export function TicketDetailPage({ ticketId }: TicketDetailPageProps) {
  const session = useSession()

  const canView = session.can("tickets", "view")

  const resource = useAsyncResource(
    (signal) => ticketsApi.read(ticketId, signal),

    canView,
  )

  const save = useSave()

  const [comment, setComment] = useState("")

  const [attachmentError, setAttachmentError] = useState<string | null>(null)

  const fileRef = useRef<HTMLInputElement | null>(null)

  const ticket = resource.data?.ticket ?? null

  const comments = resource.data?.comments ?? []

  const attachments = resource.data?.attachments ?? []

  const statusChoices = useMemo<TicketStatus[]>(() => {
    if (!ticket) return []

    // The current status is always offered so the select never sits on a value

    // the row is not in; the rest come from the transition table the server uses.

    return [ticket.status, ...ticket.nextStatuses]
  }, [ticket])

  if (!canView) {
    return (
      <EmptyState
        icon={LifeBuoy}
        title="Ticket not available"
        description="Your role cannot read the support-ticket queue."
        tone="pending"
      />
    )
  }

  if (resource.loading && !ticket) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-52 w-full" />
      </div>
    )
  }

  if (!ticket) {
    return (
      <EmptyState
        icon={LifeBuoy}
        title="That ticket does not exist"
        description="It may have been removed, or the link is wrong."
      />
    )
  }

  async function patch(input: {
    status?: TicketStatus

    priority?: TicketPriority

    assigneeUserId?: string | null
  }) {
    const done = await save.run(async () => {
      await ticketsApi.update(ticket!.id, input)
    })

    if (done) await resource.reload()
  }

  async function postComment() {
    if (comment.trim() === "") return

    const done = await save.run(async () => {
      await ticketsApi.comment(ticket!.id, comment.trim())
    })

    if (done) {
      setComment("")

      await resource.reload()
    }
  }

  async function uploadAttachment(file: File) {
    if (file.size > TICKET_ATTACHMENT_MAX_BYTES) {
      setAttachmentError(
        `That file is too large. The limit is ${formatBytes(
          TICKET_ATTACHMENT_MAX_BYTES,
        )}.`,
      )

      return
    }

    setAttachmentError(null)

    const dataUrl = await readFileAsDataUrl(file)

    const done = await save.run(async () => {
      await ticketsApi.uploadAttachment(ticket!.id, {
        filename: file.name,

        dataUrl,
      })
    })

    if (done) await resource.reload()
  }

  async function removeAttachment(attachmentId: string) {
    const done = await save.run(async () => {
      await ticketsApi.deleteAttachment(ticket!.id, attachmentId)
    })

    if (done) await resource.reload()
  }

  const canEdit = resource.data?.canEdit ?? false

  const actions = (
    <Button variant="ghost" size="sm" onClick={() => navigate("/tickets")}>
      <ArrowLeft size={13} />
      Back to queue
    </Button>
  )

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={ticket.subject}
        description={`Raised by ${
          ticket.raisedBy === "customer"
            ? ticket.customerName
            : ticket.createdByName
        } · ${formatDateTime(ticket.createdAt)}`}
        actions={actions}
      />

      {save.error ? (
        <Alert variant="danger">
          <AlertDescription>{save.error}</AlertDescription>
        </Alert>
      ) : null}

      {attachmentError ? (
        <Alert variant="danger">
          <AlertDescription>{attachmentError}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Conversation</CardTitle>
            <CardDescription>
              The customer's words and the team's replies, in time order.
            </CardDescription>
          </CardHeader>

          <CardContent className="flex flex-col gap-3 py-2">
            {ticket.description ? (
              <div className="rounded-md border border-border bg-muted/20 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  {ticket.customerName} · original request
                </p>

                <p className="mt-1 text-[13px] whitespace-pre-wrap text-foreground">
                  {ticket.description}
                </p>
              </div>
            ) : null}

            {comments.length === 0 ? (
              <p className="text-[12.5px] text-muted-foreground">
                No replies yet.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {comments.map((entry) => (
                  <li
                    key={entry.id}
                    className={
                      entry.authorKind === "staff"
                        ? "rounded-md border border-border bg-card p-3"
                        : "rounded-md border border-border bg-muted/20 p-3"
                    }
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[12.5px] font-medium text-foreground">
                        {entry.authorName}
                      </p>

                      <p className="text-[11px] text-muted-foreground">
                        {formatRelative(entry.createdAt)}
                      </p>
                    </div>

                    <p className="mt-1 text-[13px] whitespace-pre-wrap text-foreground">
                      {entry.body}
                    </p>
                  </li>
                ))}
              </ul>
            )}

            {resource.data?.canComment ? (
              <div className="mt-1 flex flex-col gap-2 border-t border-border pt-3">
                <Textarea
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  placeholder="Write a reply…"
                  maxLength={TICKET_COMMENT_MAX}
                  rows={3}
                />

                <div className="flex justify-end">
                  <Button
                    size="sm"
                    onClick={() => void postComment()}
                    disabled={save.saving || comment.trim() === ""}
                  >
                    <Send size={13} />
                    {save.saving ? "Sending…" : "Reply"}
                  </Button>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Triage</CardTitle>
            </CardHeader>

            <CardContent className="flex flex-col gap-3 py-2">
              <div className="flex flex-wrap gap-2">
                <Badge variant={TICKET_STATUS_TONES[ticket.status]}>
                  {TICKET_STATUS_LABELS[ticket.status]}
                </Badge>

                <Badge variant={TICKET_PRIORITY_TONES[ticket.priority]}>
                  {TICKET_PRIORITY_LABELS[ticket.priority]}
                </Badge>

                {!ticket.isResolved && ticket.status !== "closed" ? (
                  <Badge variant={ticket.isOverdue ? "danger" : "outline"}>
                    {ticket.isOverdue ? "Overdue" : "Due"}{" "}
                    {formatRelative(ticket.slaDueBy)}
                  </Badge>
                ) : null}
              </div>

              {canEdit ? (
                <>
                  <Field label="Status" htmlFor="ticket-status">
                    <Select
                      value={ticket.status}
                      onValueChange={(value) =>
                        void patch({ status: value as TicketStatus })
                      }
                    >
                      <SelectTrigger id="ticket-status">
                        <SelectValue />
                      </SelectTrigger>

                      <SelectContent>
                        {statusChoices.map((status) => (
                          <SelectItem key={status} value={status}>
                            {TICKET_STATUS_LABELS[status]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>

                  <Field
                    label="Priority"
                    htmlFor="ticket-priority"
                    hint="Re-prioritising does not move the response deadline."
                  >
                    <Select
                      value={ticket.priority}
                      onValueChange={(value) =>
                        void patch({ priority: value as TicketPriority })
                      }
                    >
                      <SelectTrigger id="ticket-priority">
                        <SelectValue />
                      </SelectTrigger>

                      <SelectContent>
                        {(Object.keys(
                          TICKET_PRIORITY_LABELS,
                        ) as TicketPriority[]).map((priority) => (
                          <SelectItem key={priority} value={priority}>
                            {TICKET_PRIORITY_LABELS[priority]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>

                  <Field label="Assignee" htmlFor="ticket-assignee">
                    <Select
                      value={ticket.assigneeUserId ?? "unassigned"}
                      onValueChange={(value) =>
                        void patch({
                          assigneeUserId: value === "unassigned" ? null : value,
                        })
                      }
                    >
                      <SelectTrigger id="ticket-assignee">
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
                  </Field>
                </>
              ) : null}

              <dl className="mt-1 grid grid-cols-1 gap-2 border-t border-border pt-3 text-[12.5px]">
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-muted-foreground">Customer</dt>

                  <dd className="text-foreground">{ticket.customerName}</dd>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <dt className="text-muted-foreground">Booking</dt>

                  <dd className="text-foreground">
                    {ticket.bookingId ? (
                      <button
                        type="button"
                        onClick={() =>
                          navigate(`/bookings/${ticket.bookingId}`)
                        }
                        className="text-foreground underline-offset-2 hover:underline"
                      >
                        {ticket.bookingReference ?? ticket.bookingId}
                      </button>
                    ) : (
                      "—"
                    )}
                  </dd>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <dt className="text-muted-foreground">Raised</dt>

                  <dd className="text-foreground">
                    {formatDateTime(ticket.createdAt)}
                  </dd>
                </div>

                {ticket.resolvedAt ? (
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-muted-foreground">Resolved</dt>

                    <dd className="text-foreground">
                      {formatDateTime(ticket.resolvedAt)}
                    </dd>
                  </div>
                ) : null}
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Paperclip size={14} />
                Attachments
              </CardTitle>

              <CardDescription>
                Up to {TICKET_ATTACHMENT_MAX_COUNT} PNG, JPEG, or PDF files.
              </CardDescription>
            </CardHeader>

            <CardContent className="flex flex-col gap-2 py-2">
              {attachments.length === 0 ? (
                <p className="text-[12.5px] text-muted-foreground">
                  No files attached.
                </p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {attachments.map((attachment) => (
                    <li
                      key={attachment.id}
                      className="flex items-center justify-between gap-2 rounded-md border border-border bg-card px-2.5 py-1.5"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-[12.5px] text-foreground">
                          {attachment.filename}
                        </p>

                        <p className="text-[11px] text-muted-foreground">
                          {formatBytes(attachment.sizeBytes)} ·{" "}
                          {attachment.uploadedByName}
                        </p>
                      </div>

                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          asChild
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Download ${attachment.filename}`}
                        >
                          <a
                            href={ticketAttachmentUrl(ticket.id, attachment.id)}
                          >
                            <Download size={14} />
                          </a>
                        </Button>

                        {resource.data?.canDeleteAttachment ? (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Delete ${attachment.filename}`}
                            onClick={() => void removeAttachment(attachment.id)}
                          >
                            <Trash2 size={14} />
                          </Button>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              {resource.data?.canAttach &&
              attachments.length < TICKET_ATTACHMENT_MAX_COUNT ? (
                <>
                  <input
                    ref={fileRef}
                    type="file"
                    accept={ACCEPT_ATTR}
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0]

                      event.target.value = ""

                      if (file) void uploadAttachment(file)
                    }}
                  />

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => fileRef.current?.click()}
                    disabled={save.saving}
                  >
                    <Upload size={13} />
                    {save.saving ? "Uploading…" : "Attach file"}
                  </Button>
                </>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
