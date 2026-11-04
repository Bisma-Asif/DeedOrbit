/**
 * Notification routes — the personal inbox and its per-user switches.
 *
 * Everything here is scoped by authentication alone, because a notification is one
 * person's own: the server reads and writes only the caller's `user_id` under their
 * own `tenant_id`, so there is no module grant to check and no way to reach another
 * member's inbox. The rows themselves are produced by the fan-out in
 * `server/notify.ts`; this file only reads them back and manages read state.
 *
 * `GET /api/notifications` returns the newest rows first and caps them rather than
 * cursor-paging, mirroring the audit log: the shared `DataTable` sorts and pages
 * what it is handed, and `truncated` says honestly when the cap was hit. The unread
 * count is taken across the whole inbox, independent of any active filter, so the
 * bell badge never disagrees with what the page happens to be showing.
 *
 * The settings pair resolves each event type against the shared default, so a user
 * who has never opened the screen still reads back a complete, sensible set.
 */

import { all, get, run } from "../db.ts"

import {
  badRequest,
  notFound,
  readJsonBody,
  type RequestContext,
} from "../http.ts"

import { requireAuth } from "../middleware.ts"

import {
  DEFAULT_NOTIFICATION_CHANNEL,
  NOTIFICATION_TYPES,
  NOTIFICATION_TYPE_DESCRIPTIONS,
  NOTIFICATION_TYPE_LABELS,
  isNotificationChannel,
  isNotificationType,
  type NotificationChannel,
  type NotificationListResponse,
  type NotificationSettingView,
  type NotificationSettingsResponse,
  type NotificationType,
  type NotificationView,
} from "../../shared/notifications.ts"

const DEFAULT_LIMIT = 50

const MAX_LIMIT = 200

const nowISO = () => new Date().toISOString()

interface RawNotificationRow {
  id: string

  type: string

  title: string

  body: string | null

  link_path: string | null

  channel: string

  actor_name: string | null

  read_at: string | null

  created_at: string
}

function safeType(value: string): NotificationType {
  return isNotificationType(value) ? value : "document_uploaded"
}

function safeChannel(value: string): NotificationChannel {
  return isNotificationChannel(value) ? value : DEFAULT_NOTIFICATION_CHANNEL
}

function toView(row: RawNotificationRow): NotificationView {
  const type = safeType(row.type)

  return {
    id: row.id,

    type,

    typeLabel: NOTIFICATION_TYPE_LABELS[type],

    title: row.title,

    body: row.body,

    linkPath: row.link_path,

    channel: safeChannel(row.channel),

    actorName: row.actor_name,

    readAt: row.read_at,

    createdAt: row.created_at,
  }
}

// --- GET /api/notifications ------------------------------------------------

export async function listNotifications(
  ctx: RequestContext,
): Promise<NotificationListResponse> {
  const guarded = requireAuth(ctx)

  const limitRaw = Number(ctx.query.get("limit"))

  const limit =
    Number.isFinite(limitRaw) && limitRaw > 0
      ? Math.min(Math.floor(limitRaw), MAX_LIMIT)
      : DEFAULT_LIMIT

  const readRaw = ctx.query.get("read")

  const typeRaw = ctx.query.get("type")

  const where: string[] = ["tenant_id = ?", "user_id = ?"]

  const params = [guarded.tenantId, guarded.userId]

  if (readRaw === "unread") where.push("read_at IS NULL")
  else if (readRaw === "read") where.push("read_at IS NOT NULL")

  if (typeRaw) {
    if (!isNotificationType(typeRaw)) {
      throw badRequest("That notification type is not recognised")
    }

    where.push("type = ?")

    params.push(typeRaw)
  }

  const whereSql = `WHERE ${where.join(" AND ")}`

  const rows = all<RawNotificationRow>(
    `SELECT id, type, title, body, link_path, channel, actor_name, read_at, created_at
       FROM notifications
       ${whereSql}
      ORDER BY created_at DESC
      LIMIT ?`,

    ...params,

    limit,
  )

  // The badge count is always the whole unread inbox, never the filtered subset.

  const unread = get<{ total: number }>(
    `SELECT COUNT(*) AS total FROM notifications
      WHERE tenant_id = ? AND user_id = ? AND read_at IS NULL`,

    guarded.tenantId,

    guarded.userId,
  )

  return {
    notifications: rows.map(toView),

    unreadCount: Number(unread?.total ?? 0),

    limit,

    truncated: rows.length >= limit,
  }
}

// --- POST /api/notifications/:id/read --------------------------------------

export async function markNotificationRead(ctx: RequestContext) {
  const guarded = requireAuth(ctx)

  const id = ctx.params.id ?? ""

  const existing = get<{ id: string }>(
    `SELECT id FROM notifications
      WHERE tenant_id = ? AND user_id = ? AND id = ?`,

    guarded.tenantId,

    guarded.userId,

    id,
  )

  if (!existing) throw notFound("That notification does not exist")

  // Idempotent: re-reading an already-read row leaves its original timestamp, so a

  // double-click cannot rewrite history or make an item jump to a new "read at".

  run(
    `UPDATE notifications SET read_at = ?
      WHERE tenant_id = ? AND user_id = ? AND id = ? AND read_at IS NULL`,

    nowISO(),

    guarded.tenantId,

    guarded.userId,

    id,
  )

  const updated = get<{ read_at: string | null }>(
    `SELECT read_at FROM notifications WHERE tenant_id = ? AND user_id = ? AND id = ?`,

    guarded.tenantId,

    guarded.userId,

    id,
  )

  return { ok: true, readAt: updated?.read_at ?? null }
}

// --- POST /api/notifications/read-all --------------------------------------

export async function markAllNotificationsRead(ctx: RequestContext) {
  const guarded = requireAuth(ctx)

  const pending = get<{ total: number }>(
    `SELECT COUNT(*) AS total FROM notifications
      WHERE tenant_id = ? AND user_id = ? AND read_at IS NULL`,

    guarded.tenantId,

    guarded.userId,
  )

  run(
    `UPDATE notifications SET read_at = ?
      WHERE tenant_id = ? AND user_id = ? AND read_at IS NULL`,

    nowISO(),

    guarded.tenantId,

    guarded.userId,
  )

  return { ok: true, updated: Number(pending?.total ?? 0) }
}

// --- Settings --------------------------------------------------------------

/** A stored per-type channel row read back for the settings screen. */

interface StoredSettingRow {
  type: string

  channel: string
}

/** Every type, default-filled and overridden by whatever the user has stored. */

function resolveSettings(
  tenantId: string,

  userId: string,
): NotificationSettingView[] {
  const stored = new Map<string, string>(
    all<StoredSettingRow>(
      `SELECT type, channel FROM user_notification_settings
        WHERE tenant_id = ? AND user_id = ?`,

      tenantId,

      userId,
    ).map((row) => [row.type, row.channel]),
  )

  return NOTIFICATION_TYPES.map((type) => ({
    type,

    label: NOTIFICATION_TYPE_LABELS[type],

    description: NOTIFICATION_TYPE_DESCRIPTIONS[type],

    channel: safeChannel(stored.get(type) ?? DEFAULT_NOTIFICATION_CHANNEL),
  }))
}

export async function getNotificationSettings(
  ctx: RequestContext,
): Promise<NotificationSettingsResponse> {
  const guarded = requireAuth(ctx)

  return {
    settings: resolveSettings(guarded.tenantId, guarded.userId),

    // No mail gateway is wired in this environment (see

    // server/jobs/due-payment-reminders.ts). Email is a stored preference, never a

    // delivered message, so the client can label it honestly instead of implying a

    // send that does not happen.

    emailConnected: false,
  }
}

export async function saveNotificationSettings(
  ctx: RequestContext,
): Promise<NotificationSettingsResponse> {
  const guarded = requireAuth(ctx)

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const raw = body.settings

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw badRequest("No notification settings were provided", {
      settings: "Expected a map of event type to channel.",
    })
  }

  const entries = Object.entries(raw as Record<string, unknown>)

  if (entries.length === 0) {
    throw badRequest("There was nothing to save")
  }

  const errors: Record<string, string> = {}

  for (const [type, channel] of entries) {
    if (!isNotificationType(type)) {
      errors[type] = "That event type is not recognised."

      continue
    }

    if (typeof channel !== "string" || !isNotificationChannel(channel)) {
      errors[type] = "Choose a valid channel for this event."
    }
  }

  if (Object.keys(errors).length > 0) {
    throw badRequest("Check the highlighted settings", errors)
  }

  const stamp = nowISO()

  for (const [type, channel] of entries) {
    if (!isNotificationType(type) || typeof channel !== "string") continue

    run(
      `INSERT INTO user_notification_settings (
          tenant_id, user_id, type, channel, updated_at
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (tenant_id, user_id, type)
        DO UPDATE SET channel = excluded.channel, updated_at = excluded.updated_at`,

      guarded.tenantId,

      guarded.userId,

      type,

      channel,

      stamp,
    )
  }

  return {
    settings: resolveSettings(guarded.tenantId, guarded.userId),

    emailConnected: false,
  }
}
