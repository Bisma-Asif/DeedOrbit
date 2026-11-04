/**
 * Machinery shared by the staff ticket queue and the customer portal.
 *
 * Both surfaces read the same rows and must agree about what a ticket *means*:
 * whether it is overdue, who may move it next, what its short reference reads as.
 * Computing those answers twice is how a portal and a queue drift apart and a
 * customer is told "resolved" while staff see "open", so the derivation lives
 * here and each route only decides what its reader is allowed to see.
 */

import {
  TICKET_STATUS_TRANSITIONS,
  type TicketPriority,
  type TicketStatus,
} from "../shared/tickets.ts"

import { all } from "./db.ts"

import type { GuardedContext } from "./middleware.ts"

interface TicketBaseRow {
  id: string

  tenant_id: string

  customer_id: string

  customer_name: string

  booking_id: string | null

  booking_reference: string | null

  subject: string

  description: string

  status: string

  priority: string

  assignee_user_id: string | null

  assignee_name: string | null

  sla_due_by: string

  raised_by: string

  created_by_name: string

  created_at: string

  updated_at: string

  resolved_at: string | null

  comment_count: number

  attachment_count: number
}

/**
 * The short code a thread is talked about by. The id is the key; this is the
 * human handle, taken from the id's random tail so it is stable, unique enough
 * for one workspace's queue, and never a countable sequence an outsider could
 * walk.
 */

export function ticketReference(id: string): string {
  const tail = id
    .replace(/[^a-z0-9]/gi, "")
    .slice(-6)
    .toUpperCase()

  return `REQ-${tail}`
}

/** Overdue is an unfiled ticket whose promise has passed. */

export function ticketIsOverdue(
  status: string,

  slaDueBy: string,

  at: string = new Date().toISOString(),
): boolean {
  return (status === "open" || status === "in_progress") && slaDueBy < at
}

/**
 * The statuses this caller may move the ticket to.
 *
 * A read-only holder gets nothing. Reopening a resolved or closed ticket needs
 * the delete-equivalent seriousness of `tickets.delete`, because it rewrites a
 * conclusion the customer has already been given.
 */

export function ticketNextStatuses(
  row: { status: string },

  ctx: GuardedContext,
): TicketStatus[] {
  if (!ctx.can("tickets", "edit")) return []

  const status = row.status as TicketStatus

  const options = TICKET_STATUS_TRANSITIONS[status] ?? []

  if (status === "resolved" || status === "closed") {
    return ctx.can("tickets", "delete")
      ? options
      : options.filter((next) => next !== "in_progress" && next !== "open")
  }

  return options
}

/** Projects the stored row into the shape both surfaces return. */

export function toSupportTicket(
  row: TicketBaseRow,

  ctx: GuardedContext,
) {
  const status = row.status as TicketStatus

  return {
    id: row.id,

    reference: ticketReference(row.id),

    customerId: row.customer_id,

    customerName: row.customer_name,

    bookingId: row.booking_id,

    bookingReference: row.booking_reference,

    subject: row.subject,

    description: row.description,

    status,

    priority: row.priority as TicketPriority,

    assigneeUserId: row.assignee_user_id,

    assigneeName: row.assignee_name,

    slaDueBy: row.sla_due_by,

    raisedBy: row.raised_by as "customer" | "staff",

    createdByName: row.created_by_name,

    createdAt: row.created_at,

    updatedAt: row.updated_at,

    resolvedAt: row.resolved_at,

    commentCount: row.comment_count,

    attachmentCount: row.attachment_count,

    isOverdue: ticketIsOverdue(row.status, row.sla_due_by),

    isResolved: row.status === "resolved" || row.status === "closed",

    nextStatuses: ticketNextStatuses(row, ctx),
  }
}

/**
 * The SELECT both surfaces share. Comments and attachments are counted in
 * subqueries rather than fetched, because a list page needs to know a thread has
 * three replies, not what they say.
 */

export const SELECT_TICKETS_WITH_JOINS = `
  SELECT t.*,
         c.full_name AS customer_name,
         b.reference AS booking_reference,
         u.full_name AS assignee_name,
         (SELECT COUNT(*) FROM ticket_comments m
            WHERE m.tenant_id = t.tenant_id AND m.ticket_id = t.id) AS comment_count,
         (SELECT COUNT(*) FROM ticket_attachments a
            WHERE a.tenant_id = t.tenant_id AND a.ticket_id = t.id) AS attachment_count
    FROM support_tickets t
    LEFT JOIN customers c ON c.id = t.customer_id AND c.tenant_id = t.tenant_id
    LEFT JOIN bookings  b ON b.id = t.booking_id  AND b.tenant_id = t.tenant_id
    LEFT JOIN users     u ON u.id = t.assignee_user_id AND u.tenant_id = t.tenant_id
`

/**
 * The customer profiles a portal login may read.
 *
 * This is the whole of the portal's authorization: a session with no link rows
 * sees nothing, and a link to one profile can never widen into another. Staff
 * grants are not consulted here, which is deliberate — the leak this closes was
 * a `customer` role holding tenant-wide `bookings.view`.
 */

export function linkedCustomerIds(tenantId: string, userId: string): string[] {
  return [
    ...new Set(
      all<{ customer_id: string }>(
        `SELECT customer_id FROM customer_portal_links
          WHERE tenant_id = ? AND user_id = ?`,

        tenantId,

        userId,
      ).map((row) => row.customer_id),
    ),
  ]
}

/** Placeholders so a scoped `IN (...)` can be built without string interpolation
 * of anything a caller supplied. */

export function inPlaceholders(values: readonly string[]): string {
  return values.map(() => "?").join(", ")
}
