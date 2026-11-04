/**
 * Typed client for the personal notification inbox and its switches.
 *
 * Mirrors `server/routes/notifications.ts`. Everything is scoped to the signed-in
 * user on the server, so the client sends no identity — only the optional read/type
 * filters and a row cap for the list. Blanks are dropped so an unset filter sends
 * nothing rather than an empty value the server would ignore anyway.
 */

import type {
  NotificationChannel,
  NotificationListResponse,
  NotificationSettingsResponse,
  NotificationType,
} from "@shared/notifications"

import { api } from "./api"

/** `POST /api/notifications/:id/read` echoes the read timestamp it stamped. */
interface MarkReadResponse {
  ok: boolean

  readAt: string | null
}

/** `POST /api/notifications/read-all` reports how many rows it swept. */
interface MarkAllReadResponse {
  ok: boolean

  updated: number
}

export interface NotificationQuery {
  read?: "unread" | "read" | null

  type?: NotificationType | null

  limit?: number
}

/** Builds `?read=…&type=…&limit=…`, skipping blanks. */

export function notificationQueryString(query: NotificationQuery): string {
  const params = new URLSearchParams()

  if (query.read) params.set("read", query.read)

  if (query.type) params.set("type", query.type)

  if (query.limit) params.set("limit", String(query.limit))

  const search = params.toString()

  return search ? `?${search}` : ""
}

export const notificationApi = {
  list: (query: NotificationQuery, signal?: AbortSignal) =>
    api.get<NotificationListResponse>(
      `/api/notifications${notificationQueryString(query)}`,

      signal,
    ),

  markRead: (id: string) =>
    api.post<MarkReadResponse>(
      `/api/notifications/${encodeURIComponent(id)}/read`,
    ),

  markAllRead: () =>
    api.post<MarkAllReadResponse>("/api/notifications/read-all"),

  getSettings: (signal?: AbortSignal) =>
    api.get<NotificationSettingsResponse>(
      "/api/notifications/settings",
      signal,
    ),

  saveSettings: (
    settings: Partial<Record<NotificationType, NotificationChannel>>,
  ) =>
    api.put<NotificationSettingsResponse>("/api/notifications/settings", {
      settings,
    }),
}
