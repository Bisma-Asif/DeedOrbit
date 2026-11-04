/**
 * One service request, read and answered by its owner.
 *
 * The thread — the original message and every reply, in time order — plus the
 * two things a buyer may do: post another message, and close a request they
 * consider settled. Triage, resolution, and reassignment are staff work and are
 * deliberately absent here; `nextStatuses` from the server tells this page the
 * one status move the buyer is allowed, so the control only appears when closing
 * is genuinely available.
 */

import { useRef, useState } from "react"

import {
  ArrowLeft,
  Check,
  Download,
  LifeBuoy,
  Paperclip,
  Send,
  Upload,
} from "lucide-react"

import { Alert, AlertDescription } from "@/components/ui/alert"

import { Badge } from "@/components/ui/badge"

import { Button } from "@/components/ui/button"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

import { EmptyState } from "@/components/empty-state"

import { Skeleton } from "@/components/ui/skeleton"

import { Textarea } from "@/components/ui/textarea"

import {
  formatBytes,
  readFileAsDataUrl,
} from "@/features/documents/document-utils"

import { useSave } from "@/features/organization/use-save"

import { formatDateTime, formatRelative } from "@/lib/format"

import { navigate } from "@/lib/router"

import { portalApi, portalAttachmentUrl } from "@/lib/portal-api"

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

const ACCEPT_ATTR = TICKET_ATTACHMENT_ALLOWED_MIMES.join(",")

interface PortalRequestDetailPageProps {
  requestId: string
}

export function PortalRequestDetailPage({
  requestId,
}: PortalRequestDetailPageProps) {
  const resource = useAsyncResource((signal) =>
    portalApi.readRequest(requestId, signal),
  )

  const save = useSave()

  const [comment, setComment] = useState("")

  const [attachmentError, setAttachmentError] = useState<string | null>(null)

  const fileRef = useRef<HTMLInputElement | null>(null)

  const detail = resource.data

  if (resource.loading && !detail) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-52 w-full" />
      </div>
    )
  }

  if (resource.error || !detail) {
    return (
      <div className="flex flex-col gap-4">
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2 self-start"
          onClick={() => navigate("/portal/requests")}
        >
          <ArrowLeft size={13} />
          Back to requests
        </Button>
        <Alert variant="danger">
          <AlertDescription>
            {resource.error ?? "That request could not be loaded."}
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  const { request } = detail

  const statusText =
    TICKET_STATUS_LABELS[(request.status as TicketStatus)] ?? request.status

  const statusTone =
    TICKET_STATUS_TONES[(request.status as TicketStatus)] ?? "outline"

  const priorityText =
    TICKET_PRIORITY_LABELS[(request.priority as TicketPriority)] ??
    request.priority

  const priorityTone =
    TICKET_PRIORITY_TONES[(request.priority as TicketPriority)] ?? "outline"

  const canClose = detail.nextStatuses.includes("closed")

  async function postComment() {
    if (comment.trim() === "") return

    const done = await save.run(async () => {
      await portalApi.comment(requestId, comment.trim())
    })

    if (done) {
      setComment("")

      await resource.reload()
    }
  }

  async function close() {
    const done = await save.run(async () => {
      await portalApi.closeRequest(requestId)
    })

    if (done) await resource.reload()
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
      await portalApi.uploadAttachment(requestId, {
        filename: file.name,

        dataUrl,
      })
    })

    if (done) await resource.reload()
  }

  return (
    <div className="flex flex-col gap-5">
      <Button
        variant="ghost"
        size="sm"
        className="-ml-2 self-start"
        onClick={() => navigate("/portal/requests")}
      >
        <ArrowLeft size={13} />
        Back to requests
      </Button>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[20px] font-semibold tracking-tight text-foreground">
            {request.subject}
          </h1>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            Reference {detail.reference}
            {request.bookingReference ? ` · ${request.bookingReference}` : ""}
            {" · raised "}
            {formatDateTime(request.createdAt)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant={statusTone}>{statusText}</Badge>
          <Badge variant={priorityTone}>{priorityText}</Badge>
          {request.isOverdue &&
          request.status !== "resolved" &&
          request.status !== "closed" ? (
            <Badge variant="danger">Overdue</Badge>
          ) : null}
        </div>
      </div>

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

      <Card>
        <CardHeader>
          <CardTitle>Conversation</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 py-2">
          {detail.description ? (
            <div className="rounded-md border border-border bg-muted/20 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                Your original request
              </p>
              <p className="mt-1 text-[13px] whitespace-pre-wrap text-foreground">
                {detail.description}
              </p>
            </div>
          ) : null}

          {detail.comments.length === 0 ? (
            <p className="text-[12.5px] text-muted-foreground">
              No replies yet.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {detail.comments.map((entry) => (
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
                      {entry.authorKind === "staff"
                        ? `${entry.authorName} (office)`
                        : entry.authorName}
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle className="flex items-center gap-2">
            <Paperclip size={14} />
            Attachments
          </CardTitle>
          <p className="text-[11.5px] text-muted-foreground">
            Up to {TICKET_ATTACHMENT_MAX_COUNT} PNG, JPEG, or PDF files.
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 py-2">
          {detail.attachments.length === 0 ? (
            <p className="text-[12.5px] text-muted-foreground">
              No files attached.
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {detail.attachments.map((attachment) => (
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
                  <Button
                    asChild
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Download ${attachment.filename}`}
                  >
                    <a href={portalAttachmentUrl(requestId, attachment.id)}>
                      <Download size={14} />
                    </a>
                  </Button>
                </li>
              ))}
            </ul>
          )}

          {detail.attachments.length < TICKET_ATTACHMENT_MAX_COUNT ? (
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
                className="self-start"
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

      {canClose ? (
        <div className="flex justify-end">
          <Button
            variant="outline"
            onClick={() => void close()}
            disabled={save.saving}
          >
            <Check size={13} />
            Close this request
          </Button>
        </div>
      ) : request.status === "closed" ? (
        <EmptyState
          icon={LifeBuoy}
          size="sm"
          title="This request is closed"
          description="Raise a new request if you still need help."
        />
      ) : null}
    </div>
  )
}
