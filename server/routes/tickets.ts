/**
 * Support tickets, the staff side.
 *
 * The queue is the whole module: every request a customer raised, filterable by
 * status, priority, owner, and whether it has blown its SLA. Staff may also
 * raise a ticket on a customer's behalf, because a call that arrives at the
 * front desk is the same piece of work as one typed into the portal.
 *
 * Two rules are enforced here rather than left to the interface:
 *
 *   - a status move must follow `TICKET_STATUS_TRANSITIONS`, so "closed" cannot
 *     be typed back into "open" by a PATCH that skips the UI;
 *   - `resolved_at` is stamped when a ticket enters `resolved` and cleared when
 *     it leaves, so the queue's latency figures describe real resolutions.
 *
 * `sla_due_by` is never recomputed. Changing a ticket's priority later is
 * allowed and does not move the deadline, because the deadline is the promise
 * made at intake, not a value derived from today's configuration.
 */

import {
  TICKET_ATTACHMENT_ALLOWED_MIMES,
  TICKET_ATTACHMENT_FILENAME_MAX,
  TICKET_ATTACHMENT_MAX_BYTES,
  TICKET_ATTACHMENT_MAX_COUNT,
  TICKET_COMMENT_MAX,
  TICKET_DESCRIPTION_MAX,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  TICKET_SUBJECT_MAX,
  isAllowedTicketAttachmentMime,
  isTicketPriority,
  isTicketStatus,
  slaDueBy,
  type TicketComment,
  type TicketStatus,
} from "../../shared/tickets.ts"

import { all, get, run } from "../db.ts"

import {
  badRequest,
  conflict,
  notFound,
  readJsonBody,
  type RequestContext,
} from "../http.ts"

import {
  requireAuth,
  requirePermission,
  writeAudit,
  type GuardedContext,
} from "../middleware.ts"

import {
  SELECT_TICKETS_WITH_JOINS,
  ticketNextStatuses,
  ticketReference,
  toSupportTicket,
} from "../tickets-shared.ts"

const now = () => new Date().toISOString()

interface TicketRow {
  id: string

  tenant_id: string

  customer_id: string

  booking_id: string | null

  subject: string

  description: string

  status: string

  priority: string

  assignee_user_id: string | null

  sla_due_by: string

  raised_by: string

  created_by_user_id: string | null

  created_by_name: string

  created_at: string

  updated_at: string

  resolved_at: string | null
}

interface TicketCommentRow {
  id: string

  ticket_id: string

  author_kind: string

  author_name: string

  body: string

  created_at: string
}

interface TicketAttachmentRow {
  id: string

  ticket_id: string

  filename: string

  mime: string

  size_bytes: number

  data: string

  uploaded_by_name: string

  uploaded_at: string
}

function loadTicket(ctx: GuardedContext, id: string): TicketRow {
  const row = get<TicketRow>(
    `SELECT * FROM support_tickets WHERE tenant_id = ? AND id = ?`,

    ctx.tenantId,

    id,
  )

  if (!row) throw notFound("That service request does not exist")

  return row
}

function ticketJoinRow(ctx: GuardedContext, id: string) {
  const row = get<Record<string, never>>(
    `${SELECT_TICKETS_WITH_JOINS}
      WHERE t.tenant_id = ? AND t.id = ?`,

    ctx.tenantId,

    id,
  )

  if (!row) throw notFound("That service request does not exist")

  return toSupportTicket(
    row as unknown as Parameters<typeof toSupportTicket>[0],

    ctx,
  )
}

function listComments(ctx: GuardedContext, ticketId: string): TicketComment[] {
  return all<TicketCommentRow>(
    `SELECT id, ticket_id, author_kind, author_name, body, created_at
       FROM ticket_comments
      WHERE tenant_id = ? AND ticket_id = ?
      ORDER BY created_at ASC`,

    ctx.tenantId,

    ticketId,
  ).map((row) => ({
    id: row.id,

    ticketId: row.ticket_id,

    authorKind: row.author_kind as TicketComment["authorKind"],

    authorName: row.author_name,

    body: row.body,

    createdAt: row.created_at,
  }))
}

function listAttachments(
  ctx: GuardedContext,

  ticketId: string,
) {
  return all<TicketAttachmentRow>(
    `SELECT id, ticket_id, filename, mime, size_bytes, uploaded_by_name, uploaded_at
       FROM ticket_attachments
      WHERE tenant_id = ? AND ticket_id = ?
      ORDER BY uploaded_at ASC`,

    ctx.tenantId,

    ticketId,
  ).map((row) => ({
    id: row.id,

    ticketId: row.ticket_id,

    filename: row.filename,

    mime: row.mime,

    sizeBytes: row.size_bytes,

    uploadedByName: row.uploaded_by_name,

    uploadedAt: row.uploaded_at,
  }))
}

/** The staff who can be handed a ticket: active tenant members, any role. */

function assignableUsers(ctx: GuardedContext) {
  return all<{
    id: string
    full_name: string
    email: string
    role_label: string
  }>(
    `SELECT u.id, u.full_name, u.email, r.label AS role_label
       FROM users u
       JOIN tenant_memberships m ON m.user_id = u.id AND m.tenant_id = u.tenant_id
       JOIN roles r ON r.role_id = m.role_id
      WHERE u.tenant_id = ? AND u.status = 'active'
      ORDER BY u.full_name COLLATE NOCASE`,

    ctx.tenantId,
  )
}

/**
 * GET /api/tickets?status=&priority=&assignee=&overdue=
 *
 * The queue. `assignee` accepts `me`, `unassigned`, or a user id — the two named
 * values exist because "what is on my plate" and "what nobody has taken" are the
 * first two questions anybody asks of a queue, and making a UI send a sentinel
 * string for each is friendlier than a second endpoint.
 */

export function listTickets(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "tickets", "view")

  const status = guarded.query.get("status") ?? ""

  const priority = guarded.query.get("priority") ?? ""

  const assignee = guarded.query.get("assignee") ?? ""

  const overdue = guarded.query.get("overdue") === "1"

  const clauses: string[] = ["t.tenant_id = ?"]

  const params: (string | number)[] = [guarded.tenantId]

  if (status !== "") {
    if (!isTicketStatus(status))
      throw badRequest("Unknown status filter", { status: "Not a status." })

    clauses.push("t.status = ?")

    params.push(status)
  }

  if (priority !== "") {
    if (!isTicketPriority(priority))
      throw badRequest("Unknown priority filter", {
        priority: "Not a priority.",
      })

    clauses.push("t.priority = ?")

    params.push(priority)
  }

  if (assignee === "me") {
    clauses.push("t.assignee_user_id = ?")

    params.push(guarded.userId)
  } else if (assignee === "unassigned") {
    clauses.push("t.assignee_user_id IS NULL")
  } else if (assignee !== "") {
    clauses.push("t.assignee_user_id = ?")

    params.push(assignee)
  }

  // Overdue is a live reading, not a column: an `open` ticket whose stored

  // deadline has passed. Filtered on the deadline itself, never recomputed.

  if (overdue) {
    clauses.push("t.status IN ('open', 'in_progress')")

    clauses.push("t.sla_due_by < ?")

    params.push(now())
  }

  const rows = all<Record<string, never>>(
    `${SELECT_TICKETS_WITH_JOINS}
      WHERE ${clauses.join(" AND ")}
      ORDER BY CASE t.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END,
               t.sla_due_by ASC`,

    ...params,
  )

  const tickets = rows.map((row) =>
    toSupportTicket(
      row as unknown as Parameters<typeof toSupportTicket>[0],
      guarded,
    ),
  )

  return {
    tickets,

    canCreate: guarded.can("tickets", "create"),

    canEdit: guarded.can("tickets", "edit"),

    assignees: assignableUsers(guarded).map((user) => ({
      id: user.id,

      fullName: user.full_name,

      email: user.email,

      roleLabel: user.role_label,
    })),

    statuses: TICKET_STATUSES,

    priorities: TICKET_PRIORITIES,

    summary: {
      total: tickets.length,

      open: tickets.filter((ticket) => ticket.status === "open").length,

      overdue: tickets.filter((ticket) => ticket.isOverdue).length,
    },
  }
}

/** GET /api/tickets/:id — the thread, with its comments and attachments. */

export function getTicket(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "tickets", "view")

  const ticket = loadTicket(guarded, ctx.params.id!)

  return {
    ticket: ticketJoinRow(guarded, ticket.id),

    comments: listComments(guarded, ticket.id),

    attachments: listAttachments(guarded, ticket.id),

    assignees: assignableUsers(guarded).map((user) => ({
      id: user.id,

      fullName: user.full_name,

      email: user.email,

      roleLabel: user.role_label,
    })),

    canComment: true,

    canEdit: guarded.can("tickets", "edit"),

    canAttach:
      guarded.can("tickets", "edit") || guarded.can("tickets", "create"),

    canDeleteAttachment: guarded.can("tickets", "edit"),
  }
}

function cleanString(value: unknown, max: number, label: string): string {
  const text = typeof value === "string" ? value.trim() : ""

  if (text === "")
    throw badRequest(`The ${label} is required.`, { [label]: "Required." })

  if (text.length > max) {
    throw badRequest(`That ${label} is too long.`, {
      [label]: `Use ${max} characters or fewer.`,
    })
  }

  return text
}

/** POST /api/tickets — a ticket raised by staff, on a customer's behalf. */

export async function createTicket(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "tickets", "create")

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const customerId = cleanString(body.customerId, 80, "customer id")

  const customer = get<{
    id: string
    full_name: string
  }>(
    `SELECT id, full_name FROM customers WHERE tenant_id = ? AND id = ?`,

    guarded.tenantId,

    customerId,
  )

  if (!customer) throw notFound("That customer does not exist")

  const subject = cleanString(body.subject, TICKET_SUBJECT_MAX, "subject")

  // A description is optional: a one-line "front desk called about the handover"

  // is a real ticket, and forcing filler text teaches staff to type nonsense.

  const description =
    typeof body.description === "string" ? body.description.trim() : ""

  if (description.length > TICKET_DESCRIPTION_MAX) {
    throw badRequest("That description is too long.", {
      description: `Use ${TICKET_DESCRIPTION_MAX} characters or fewer.`,
    })
  }

  const priority =
    body.priority === undefined ? "normal" : String(body.priority)

  if (!isTicketPriority(priority))
    throw badRequest("Unknown priority.", { priority: "Not a priority." })

  const bookingId =
    typeof body.bookingId === "string" && body.bookingId !== ""
      ? body.bookingId
      : null

  if (bookingId !== null) {
    const booking = get<{
      id: string
      customer_id: string
    }>(
      `SELECT id, customer_id FROM bookings WHERE tenant_id = ? AND id = ?`,

      guarded.tenantId,

      bookingId,
    )

    if (!booking) throw notFound("That booking does not exist")

    // A ticket may only reference a booking belonging to the customer it is

    // raised against, or the queue would show two people the same property.

    if (booking.customer_id !== customer.id) {
      throw badRequest("That booking does not belong to this customer.", {
        bookingId: "Choose one of this customer's bookings.",
      })
    }
  }

  const raisedAt = now()

  const id = `tkt_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`

  run(
    `INSERT INTO support_tickets (
        id, tenant_id, customer_id, booking_id, subject, description, status,
        priority, assignee_user_id, sla_due_by, raised_by, created_by_user_id,
        created_by_name, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'open', ?, NULL, ?, 'staff', ?, ?, ?, ?)`,

    id,

    guarded.tenantId,

    customer.id,

    bookingId,

    subject,

    description,

    priority,

    slaDueBy(raisedAt, priority),

    guarded.userId,

    guarded.session.user.fullName,

    raisedAt,

    raisedAt,
  )

  writeAudit(
    guarded,

    "tickets.created",

    "support_ticket",

    id,

    { customerId: customer.id, priority, reference: ticketReference(id) },

    ctx.ip,
  )

  return { ok: true, ticket: ticketJoinRow(guarded, id) }
}

/**
 * PATCH /api/tickets/:id — status, assignee, and priority.
 *
 * An omitted field is left alone; `assignee: null` unassigns deliberately. The
 * status is checked against the transition table, so the state machine holds
 * whatever route the client took to get here.
 */

export async function updateTicket(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "tickets", "edit")

  const ticket = loadTicket(guarded, ctx.params.id!)

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  let status = ticket.status as TicketStatus

  let priority = ticket.priority

  let assigneeUserId = ticket.assignee_user_id

  let resolvedAt = ticket.resolved_at

  const changes: string[] = []

  if (body.status !== undefined) {
    const next = String(body.status)

    if (!isTicketStatus(next))
      throw badRequest("Unknown status.", { status: "Not a status." })

    if (next !== status) {
      // Reuse the same transition rule the queue UI reads, so a PATCH that skips

      // the interface cannot invent an edge the state machine does not have.

      const allowed = ticketNextStatuses({ status }, guarded)

      if (!allowed.includes(next as TicketStatus)) {
        throw conflict(
          `A ${status.replace(/_/g, " ")} ticket cannot move directly to ${next.replace(/_/g, " ")}.`,

          { status: "That transition is not allowed." },
        )
      }

      status = (next as TicketStatus)

      resolvedAt = status === "resolved" ? now() : null

      changes.push("status")
    }
  }

  if (body.priority !== undefined) {
    const next = String(body.priority)

    if (!isTicketPriority(next))
      throw badRequest("Unknown priority.", { priority: "Not a priority." })

    if (next !== priority) {
      // The deadline stays where it was set. Re-prioritising a ticket must not

      // quietly buy the team more time on a promise already made.

      priority = next

      changes.push("priority")
    }
  }

  if (body.assigneeUserId !== undefined) {
    const next =
      body.assigneeUserId === null ? null : String(body.assigneeUserId)

    if (next !== null) {
      const assignee = get<{ id: string }>(
        `SELECT id FROM users WHERE tenant_id = ? AND id = ? AND status = 'active'`,

        guarded.tenantId,

        next,
      )

      if (!assignee)
        throw badRequest("That assignee is not an active member.", {
          assigneeUserId: "Choose a member of this workspace.",
        })
    }

    if (next !== assigneeUserId) {
      assigneeUserId = next

      changes.push("assignee")
    }
  }

  if (changes.length === 0)
    throw badRequest("Nothing to change.", {
      ticket: "Send a field to update.",
    })

  run(
    `UPDATE support_tickets
        SET status = ?, priority = ?, assignee_user_id = ?, resolved_at = ?, updated_at = ?
      WHERE tenant_id = ? AND id = ?`,

    status,

    priority,

    assigneeUserId,

    resolvedAt,

    now(),

    guarded.tenantId,

    ticket.id,
  )

  // Taking a ticket is itself a move out of the untouched pile, so the queue's

  // first reading of "in progress" is when somebody's name goes on it.

  if (changes.includes("assignee") && assigneeUserId && status === "open") {
    run(
      `UPDATE support_tickets SET status = 'in_progress', updated_at = ?
        WHERE tenant_id = ? AND id = ? AND status = 'open'`,

      now(),

      guarded.tenantId,

      ticket.id,
    )
  }

  writeAudit(
    guarded,

    "tickets.updated",

    "support_ticket",

    ticket.id,

    { changes, status, priority },

    ctx.ip,
  )

  return { ok: true, ticket: ticketJoinRow(guarded, ticket.id) }
}

/** POST /api/tickets/:id/comments — a staff reply on the thread. */

export async function addTicketComment(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "tickets", "view")

  const ticket = loadTicket(guarded, ctx.params.id!)

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const commentBody = cleanString(body.body, TICKET_COMMENT_MAX, "comment")

  const id = `tcm_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`

  const stamp = now()

  run(
    `INSERT INTO ticket_comments (
        id, tenant_id, ticket_id, author_kind, author_user_id, author_name, body, created_at
      ) VALUES (?, ?, ?, 'staff', ?, ?, ?, ?)`,

    id,

    guarded.tenantId,

    ticket.id,

    guarded.userId,

    guarded.session.user.fullName,

    commentBody,

    stamp,
  )

  run(
    `UPDATE support_tickets SET updated_at = ? WHERE tenant_id = ? AND id = ?`,

    stamp,

    guarded.tenantId,

    ticket.id,
  )

  writeAudit(
    guarded,

    "tickets.commented",

    "support_ticket",

    ticket.id,

    { commentId: id },

    ctx.ip,
  )

  return { ok: true, commentId: id }
}

/**
 * Parse a base64 data URL against the ticket attachment rules: the same mime
 * allow list and byte cap the document store uses, but with its own limits so a
 * ticket thread cannot quietly inherit a different feature's ceiling.
 */

interface ParsedTicketDataUrlOk {
  ok: true

  mime: string

  dataUrl: string

  bytes: number
}

interface ParsedTicketDataUrlError {
  ok: false

  error: string
}

function parseTicketDataUrl(
  value: unknown,
): ParsedTicketDataUrlOk | ParsedTicketDataUrlError {
  if (typeof value !== "string")
    return { ok: false, error: "The file data is required." }

  const matched = /^data:([a-z0-9/\-.+]+);base64,(.+)$/i.exec(value)

  if (!matched)
    return { ok: false, error: "The file must be a base64 data URL." }

  const mime = matched[1]!.toLowerCase()

  if (!isAllowedTicketAttachmentMime(mime)) {
    return {
      ok: false,

      error: `Allowed types: ${TICKET_ATTACHMENT_ALLOWED_MIMES.join(", ")}.`,
    }
  }

  let bytes: number

  try {
    bytes = Buffer.from(matched[2]!, "base64").length
  } catch {
    return { ok: false, error: "The file data is not valid base64." }
  }

  if (bytes === 0) return { ok: false, error: "That file appears to be empty." }

  if (bytes > TICKET_ATTACHMENT_MAX_BYTES) {
    return {
      ok: false,

      error: `That file is too large. The limit is ${Math.floor(
        TICKET_ATTACHMENT_MAX_BYTES / (1024 * 1024),
      )} MB.`,
    }
  }

  return { ok: true, mime, dataUrl: value, bytes }
}

/** POST /api/tickets/:id/attachments */

export async function uploadTicketAttachment(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "tickets", "view")

  const ticket = loadTicket(guarded, ctx.params.id!)

  const count =
    get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM ticket_attachments WHERE tenant_id = ? AND ticket_id = ?`,

      guarded.tenantId,

      ticket.id,
    )?.n ?? 0

  if (count >= TICKET_ATTACHMENT_MAX_COUNT) {
    throw badRequest(
      `A ticket carries at most ${TICKET_ATTACHMENT_MAX_COUNT} attachments.`,

      { file: `The limit is ${TICKET_ATTACHMENT_MAX_COUNT} files.` },
    )
  }

  const body = await readJsonBody<Record<string, unknown>>(
    ctx.req,

    Math.ceil(TICKET_ATTACHMENT_MAX_BYTES * 1.4) + 64 * 1024,
  )

  const parsed = parseTicketDataUrl(body.dataUrl)

  if (!parsed.ok) throw badRequest(parsed.error, { dataUrl: parsed.error })

  const filename = cleanString(
    body.filename,
    TICKET_ATTACHMENT_FILENAME_MAX,
    "filename",
  )

  const id = `tta_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`

  const stamp = now()

  run(
    `INSERT INTO ticket_attachments (
        id, tenant_id, ticket_id, filename, mime, size_bytes, data,
        uploaded_by_user_id, uploaded_by_name, uploaded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,

    id,

    guarded.tenantId,

    ticket.id,

    filename,

    parsed.mime,

    parsed.bytes,

    parsed.dataUrl,

    guarded.userId,

    guarded.session.user.fullName,

    stamp,
  )

  run(
    `UPDATE support_tickets SET updated_at = ? WHERE tenant_id = ? AND id = ?`,

    stamp,

    guarded.tenantId,

    ticket.id,
  )

  writeAudit(
    guarded,

    "tickets.attachment_uploaded",

    "support_ticket",

    ticket.id,

    { attachmentId: id, mime: parsed.mime, bytes: parsed.bytes },

    ctx.ip,
  )

  return { ok: true, attachmentId: id }
}

/**
 * GET /api/tickets/:id/attachments/:attachmentId — the bytes, inline unless a
 * download is asked for. Reading an attachment needs `tickets.view`, which is
 * what already let the caller read the thread it is attached to.
 */

export function downloadTicketAttachment(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "tickets", "view")

  const ticket = loadTicket(guarded, ctx.params.id!)

  const row = get<TicketAttachmentRow>(
    `SELECT * FROM ticket_attachments WHERE tenant_id = ? AND ticket_id = ? AND id = ?`,

    guarded.tenantId,

    ticket.id,

    ctx.params.attachmentId!,
  )

  if (!row) throw notFound("That attachment does not exist")

  const commaIndex = row.data.indexOf(",")

  const buffer = Buffer.from(
    commaIndex >= 0 ? row.data.slice(commaIndex + 1) : row.data,

    "base64",
  )

  const disposition =
    ctx.query.get("download") === "1" ? "attachment" : "inline"

  const safeName = row.filename.replace(/["\r\n]/g, "")

  ctx.res.writeHead(200, {
    "Content-Type": row.mime,

    "Content-Length": buffer.byteLength,

    "Content-Disposition": `${disposition}; filename="${safeName}"`,

    "Cache-Control": "private, max-age=60",

    "X-Content-Type-Options": "nosniff",
  })

  ctx.res.end(buffer)
}

/** DELETE /api/tickets/:id/attachments/:attachmentId */

export function deleteTicketAttachment(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "tickets", "edit")

  const ticket = loadTicket(guarded, ctx.params.id!)

  const row = get<{
    id: string
    filename: string
  }>(
    `SELECT id, filename FROM ticket_attachments
      WHERE tenant_id = ? AND ticket_id = ? AND id = ?`,

    guarded.tenantId,

    ticket.id,

    ctx.params.attachmentId!,
  )

  if (!row) throw notFound("That attachment does not exist")

  run(
    `DELETE FROM ticket_attachments WHERE tenant_id = ? AND id = ?`,

    guarded.tenantId,

    row.id,
  )

  writeAudit(
    guarded,

    "tickets.attachment_deleted",

    "support_ticket",

    ticket.id,

    { attachmentId: row.id, filename: row.filename },

    ctx.ip,
  )
}
