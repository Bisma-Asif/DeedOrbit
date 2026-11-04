/**
 * Typed client for the staff support-ticket queue.
 *
 * Mirrors `server/routes/tickets.ts`. The queue is filtered by `status`,
 * `priority`, `assignee`, and an `sla` bucket; the response always ships the
 * assignable-member list so the detail screen can render an assignee picker
 * without a second round-trip to the directory.
 *
 * Status changes go through `update`, which validates the transition against the
 * shared state machine server-side — a `409` here means the move was illegal, not
 * that the request was malformed. Attachment upload takes a pre-encoded
 * `dataUrl`, exactly as the documents store does.
 */

import type {
  SupportTicket,
  TicketAttachmentMeta,
  TicketComment,
  TicketPriority,
  TicketStatus,
} from "@shared/tickets"

import { api } from "./api"

/** A member the queue can hand a ticket to. */

export interface TicketAssignee {
  id: string

  fullName: string

  email: string

  roleLabel: string
}

export interface TicketFilters {
  status?: TicketStatus | ""

  priority?: TicketPriority | ""

  assignee?: string

  /** `overdue` narrows to tickets past their promised first response. */

  sla?: "overdue" | ""
}

export interface TicketListResponse {
  tickets: SupportTicket[]

  canCreate: boolean

  canEdit: boolean

  assignees: TicketAssignee[]

  statuses: TicketStatus[]

  priorities: TicketPriority[]

  summary: {
    total: number
    open: number
    overdue: number
  }
}

export interface TicketDetailResponse {
  ticket: SupportTicket

  comments: TicketComment[]

  attachments: TicketAttachmentMeta[]

  assignees: TicketAssignee[]

  canComment: boolean

  canEdit: boolean

  canAttach: boolean

  canDeleteAttachment: boolean
}

export interface TicketCreateInput {
  customerId: string

  subject: string

  description?: string

  priority?: TicketPriority

  bookingId?: string | null
}

export interface TicketUpdateInput {
  status?: TicketStatus

  priority?: TicketPriority

  /** `null` unassigns deliberately; an omitted field is left alone. */

  assigneeUserId?: string | null
}

export interface TicketMutationResponse {
  ok: true

  ticket: SupportTicket
}

export interface TicketCommentResponse {
  ok: true

  commentId: string
}

export interface TicketAttachmentResponse {
  ok: true

  attachmentId: string
}

export interface TicketAttachmentBody {
  filename: string

  dataUrl: string
}

function query(filters: TicketFilters): string {
  const params = new URLSearchParams()

  if (filters.status) params.set("status", filters.status)

  if (filters.priority) params.set("priority", filters.priority)

  if (filters.assignee) params.set("assignee", filters.assignee)

  // The server buckets overdue on a single `overdue=1` flag rather than a named

  // value, because it is a live reading against the clock, not a column.

  if (filters.sla === "overdue") params.set("overdue", "1")

  const qs = params.toString()

  return qs ? `?${qs}` : ""
}

/** Streams a stored ticket attachment back; previews and downloads share it. */

export function ticketAttachmentUrl(
  ticketId: string,

  attachmentId: string,
): string {
  return `/api/tickets/${ticketId}/attachments/${attachmentId}`
}

export const ticketsApi = {
  list: (filters: TicketFilters = {}, signal?: AbortSignal) =>
    api.get<TicketListResponse>(`/api/tickets${query(filters)}`, signal),

  read: (id: string, signal?: AbortSignal) =>
    api.get<TicketDetailResponse>(`/api/tickets/${id}`, signal),

  create: (input: TicketCreateInput) =>
    api.post<TicketMutationResponse>("/api/tickets", input),

  update: (id: string, input: TicketUpdateInput) =>
    api.patch<TicketMutationResponse>(`/api/tickets/${id}`, input),

  comment: (id: string, body: string) =>
    api.post<TicketCommentResponse>(`/api/tickets/${id}/comments`, { body }),

  uploadAttachment: (id: string, body: TicketAttachmentBody) =>
    api.post<TicketAttachmentResponse>(`/api/tickets/${id}/attachments`, body),

  deleteAttachment: (id: string, attachmentId: string) =>
    api.delete<{ ok: true }>(`/api/tickets/${id}/attachments/${attachmentId}`),
}
