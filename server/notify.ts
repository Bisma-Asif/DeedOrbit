/**
 * The notification fan-out — the only place a `notifications` row is written.
 *
 * A business route that has just done something a person should hear about calls
 * one of the `notify*` helpers here with the recipients already decided. The helper
 * owns the parts every caller would otherwise repeat: it looks up each recipient's
 * channel preference for that type, drops the event where they switched it "off",
 * clamps the text to the column limits, and writes one row per person. Keeping the
 * whole write in one file is what lets a channel preference be honoured everywhere
 * at once, and keeps the fan-out honest — there is no mail gateway in this
 * workspace, so an "email"/"both" choice records the preference and the row, and is
 * never a claim a message left the building.
 *
 * Recipient selection is deliberately the caller's job, because only the caller
 * knows who owns the record it just touched. This file supplies one convenience,
 * `notifyApprovers`, for the approval queue — the single case where the audience is
 * a permission rather than a person ("requests waiting on you").
 */

import { all, get, run } from "./db.ts"

import { can } from "./rbac.ts"

import { newId } from "./crypto.ts"

import {
  DEFAULT_NOTIFICATION_CHANNEL,
  isNotificationType,
  NOTIFICATION_TYPE_LABELS,
  type NotificationChannel,
  type NotificationType,
} from "../shared/notifications.ts"

const TITLE_MAX = 140

const BODY_MAX = 400

const LINK_MAX = 240

const nowISO = () => new Date().toISOString()

/** A tenant member row narrowed to the two columns the approver scan reads. */

interface MemberRow {
  user_id: string

  role_id: string
}

/** The owner columns read back from a booking when resolving recipients. */

interface BookingOwnerRow {
  agent_user_id: string | null

  created_by_user_id: string | null
}

/** What a caller hands the fan-out: the event, and how to word its row. */

export interface NotifyInput {
  type: NotificationType

  title: string

  body?: string | null

  linkPath?: string | null

  actorUserId?: string | null

  actorName?: string | null
}

function clamp(value: string | null | undefined, max: number): string | null {
  if (value === null || value === undefined) return null

  const trimmed = value.trim()

  if (trimmed === "") return null

  return trimmed.length > max ? trimmed.slice(0, max) : trimmed
}

/**
 * The channel this user chose for this type, or the shared default when they have
 * not chosen one. A stored value that is not a known channel falls back to the
 * default rather than throwing, so a hand-written row can never break a fan-out.
 */

export function resolveChannel(
  tenantId: string,

  userId: string,

  type: NotificationType,
): NotificationChannel {
  const row = get<{ channel: string }>(
    `SELECT channel FROM user_notification_settings
      WHERE tenant_id = ? AND user_id = ? AND type = ?`,

    tenantId,

    userId,

    type,
  )

  if (!row) return DEFAULT_NOTIFICATION_CHANNEL

  return row.channel === "in_app" ||
    row.channel === "email" ||
    row.channel === "both" ||
    row.channel === "off"
    ? row.channel
    : DEFAULT_NOTIFICATION_CHANNEL
}

/**
 * Writes one recipient's row, honouring their channel. Returns whether a row was
 * written — "off" and an unknown recipient both write nothing.
 */

export function notifyRecipient(
  tenantId: string,

  recipientUserId: string,

  input: NotifyInput,
): boolean {
  if (!recipientUserId) return false

  const channel = resolveChannel(tenantId, recipientUserId, input.type)

  if (channel === "off") return false

  // Only ever materialise a row for a real user, so a stale owner id on an old

  // record cannot hit the notifications.user_id foreign key and abort the caller's

  // surrounding transaction.

  const exists = get<{ id: string }>(
    `SELECT id FROM users WHERE tenant_id = ? AND id = ? AND status = 'active'`,

    tenantId,

    recipientUserId,
  )

  if (!exists) return false

  run(
    `INSERT INTO notifications (
        id, tenant_id, user_id, type, channel, title, body, link_path,
        actor_user_id, actor_name, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,

    newId("ntf"),

    tenantId,

    recipientUserId,

    input.type,

    // "off" returned above, so `channel` is narrowed to in_app/email/both — the

    // only values the notifications table CHECK permits.

    channel,

    clamp(input.title, TITLE_MAX) ?? NOTIFICATION_TYPE_LABELS[input.type],

    clamp(input.body, BODY_MAX),

    clamp(input.linkPath, LINK_MAX),

    input.actorUserId ?? null,

    clamp(input.actorName, 140),

    nowISO(),
  )

  return true
}

/**
 * Writes one row for each of several recipients, deduplicated and skipping the
 * actor so nobody is notified about an action they themselves performed.
 */

export function notifyRecipients(
  tenantId: string,

  recipientUserIds: Array<string | null | undefined>,

  input: NotifyInput,
): number {
  const seen = new Set<string>()

  let written = 0

  for (const recipient of recipientUserIds) {
    if (!recipient) continue

    if (input.actorUserId && recipient === input.actorUserId) continue

    if (seen.has(recipient)) continue

    seen.add(recipient)

    if (notifyRecipient(tenantId, recipient, input)) written += 1
  }

  return written
}

/**
 * Notifies every active workspace member whose role can sign off an approval —
 * the people a request is genuinely "waiting on" — excluding whoever raised it,
 * since maker-checker means the requester cannot be their own approver.
 */

export function notifyApprovers(
  tenantId: string,

  excludeUserId: string | null,

  input: NotifyInput,
): number {
  const members = all<MemberRow>(
    `SELECT tm.user_id, tm.role_id
       FROM tenant_memberships tm
       JOIN users u ON u.id = tm.user_id
      WHERE tm.tenant_id = ? AND u.status = 'active'`,

    tenantId,
  )

  const approvers = members

    .filter(
      (member) =>
        member.user_id !== excludeUserId &&
        can(tenantId, member.role_id, "approvals", "approve"),
    )

    .map((member) => member.user_id)

  return notifyRecipients(tenantId, approvers, input)
}

/** The booking's owning agent, falling back to whoever created it. Both may be null. */

export function bookingOwnerUserIds(
  tenantId: string,

  bookingId: string | null,
): string[] {
  if (!bookingId) return []

  const row = get<BookingOwnerRow>(
    `SELECT agent_user_id, created_by_user_id FROM bookings
      WHERE tenant_id = ? AND id = ?`,

    tenantId,

    bookingId,
  )

  if (!row) return []

  return [row.agent_user_id, row.created_by_user_id].filter(
    (id): id is string => Boolean(id),
  )
}

/** Guards an event key coming from a route body before it reaches a row's type. */

export function isKnownNotificationType(
  value: string,
): value is NotificationType {
  return isNotificationType(value)
}
