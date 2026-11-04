/**
 * Support ticket vocabulary: how a service request is triaged and worked.
 *
 * A ticket is raised by a customer through the portal, or by staff on their
 * behalf, and then walked `open -> in_progress -> resolved -> closed`. The
 * priority is decided once, at intake, and it fixes the promise: `sla_due_by` is
 * a stored timestamp derived from `TICKET_SLA_HOURS`, not something recomputed at
 * read time. Recomputing would quietly un-overdue an old ticket every time the
 * SLA table was re-tuned, and a promise already made to a customer is not
 * renegotiable by a configuration change.
 *
 * `resolved_at` is stamped only on the transition into `resolved`, so the queue
 * can report real resolution latency rather than the time a row was last
 * touched.
 */

export const TICKET_STATUSES = [
  "open",

  "in_progress",

  "resolved",

  "closed",
] as const

export type TicketStatus = typeof TICKET_STATUSES[number]

export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  open: "Open",

  in_progress: "In progress",

  resolved: "Resolved",

  closed: "Closed",
}

export const TICKET_STATUS_TONES: Record<TicketStatus, "pending" | "info" | "success" | "outline"> =
  {
    open: "pending",

    in_progress: "info",

    resolved: "success",

    closed: "outline",
  }

export function isTicketStatus(value: unknown): value is TicketStatus {
  return (
    typeof value === "string" &&
    (TICKET_STATUSES as readonly string[]).includes(value)
  )
}

/** The statuses a ticket may be moved to from each status. */

export const TICKET_STATUS_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  open: ["in_progress", "resolved", "closed"],

  in_progress: ["resolved", "closed", "open"],

  resolved: ["closed", "in_progress"],

  closed: [],
}

export const TICKET_PRIORITIES = ["low", "normal", "high", "urgent"] as const

export type TicketPriority = typeof TICKET_PRIORITIES[number]

export const TICKET_PRIORITY_LABELS: Record<TicketPriority, string> = {
  low: "Low",

  normal: "Normal",

  high: "High",

  urgent: "Urgent",
}

export const TICKET_PRIORITY_TONES: Record<TicketPriority, "outline" | "info" | "pending" | "danger"> =
  {
    low: "outline",

    normal: "info",

    high: "pending",

    urgent: "danger",
  }

export function isTicketPriority(value: unknown): value is TicketPriority {
  return (
    typeof value === "string" &&
    (TICKET_PRIORITIES as readonly string[]).includes(value)
  )
}

/**
 * Hours from intake to the promised first response, per priority.
 *
 * Deliberately generous at the low end and tight at the top: a queue where every
 * ticket is urgent is a queue where nothing is, so the hours are spread widely
 * enough that choosing `urgent` means something.
 */

export const TICKET_SLA_HOURS: Record<TicketPriority, number> = {
  low: 72,

  normal: 48,

  high: 24,

  urgent: 8,
}

/** Adds the SLA window to an ISO instant and returns a stored timestamp. */

export function slaDueBy(
  raisedAtIso: string,
  priority: TicketPriority,
): string {
  const base = new Date(raisedAtIso).getTime()

  const stamp = Number.isNaN(base)
    ? Date.now()
    : base + TICKET_SLA_HOURS[priority] * 60 * 60 * 1000

  return new Date(stamp).toISOString()
}

export const TICKET_SUBJECT_MAX = 160

export const TICKET_DESCRIPTION_MAX = 2000

export const TICKET_COMMENT_MAX = 2000

export const TICKET_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024

export const TICKET_ATTACHMENT_MAX_COUNT = 5

export const TICKET_ATTACHMENT_FILENAME_MAX = 180

export const TICKET_ATTACHMENT_ALLOWED_MIMES = [
  "image/png",

  "image/jpeg",

  "application/pdf",
] as const

export function isAllowedTicketAttachmentMime(value: unknown): boolean {
  return (
    typeof value === "string" &&
    (TICKET_ATTACHMENT_ALLOWED_MIMES as readonly string[]).includes(value)
  )
}

export const TICKET_RAISED_BY = ["customer", "staff"] as const

export type TicketRaisedBy = typeof TICKET_RAISED_BY[number]

/** A ticket as the staff queue and the portal both list it. */

export interface SupportTicket {
  id: string

  customerId: string

  customerName: string

  bookingId: string | null

  bookingReference: string | null

  subject: string

  description: string

  status: TicketStatus

  priority: TicketPriority

  assigneeUserId: string | null

  assigneeName: string | null

  slaDueBy: string

  raisedBy: TicketRaisedBy

  createdByName: string

  createdAt: string

  updatedAt: string

  resolvedAt: string | null

  commentCount: number

  attachmentCount: number

  /** Derived at read against the clock, never stored. */

  isOverdue: boolean

  isResolved: boolean

  /** Statuses this caller may move the ticket to; empty when read-only. */

  nextStatuses: TicketStatus[]
}

export interface TicketComment {
  id: string

  ticketId: string

  authorKind: TicketRaisedBy

  authorName: string

  body: string

  createdAt: string
}

export interface TicketAttachmentMeta {
  id: string

  ticketId: string

  filename: string

  mime: string

  sizeBytes: number

  uploadedByName: string

  uploadedAt: string
}
