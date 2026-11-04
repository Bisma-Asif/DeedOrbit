/**
 * In-app notification vocabulary — the single source of truth shared by the
 * server fan-out, the notification routes, and the client screens.
 *
 * A notification is *personal*: it belongs to one user in one workspace, and it
 * records that a specific thing happened. Only four real events produce rows
 * today — a booking confirmed, a payment recorded, an approval requested, and a
 * document uploaded — and this file names exactly those, so the settings screen
 * only ever offers switches for events that genuinely fire. Nothing is listed
 * here that the platform does not actually emit.
 *
 * The `channel` is a *delivery preference*, recorded honestly. The workspace has
 * no email gateway (see `server/jobs/due-payment-reminders.ts`), so "email" is
 * stored and surfaced as a preference the user chose — it is never a claim that
 * a message was sent. A type switched to "off" suppresses the row entirely.
 */

export const NOTIFICATION_TYPES = [
  "booking_confirmed",

  "payment_recorded",

  "approval_requested",

  "document_uploaded",

  "requisition_decided",

  "purchase_order_received",

  "envelope_completed",

  "payment_escalation",
] as const

export type NotificationType = typeof NOTIFICATION_TYPES[number]

export const NOTIFICATION_TYPE_LABELS: Record<NotificationType, string> = {
  booking_confirmed: "Booking confirmed",

  payment_recorded: "Payment recorded",

  approval_requested: "Approval requested",

  document_uploaded: "Document uploaded",

  requisition_decided: "Requisition decided",

  purchase_order_received: "Purchase order received",

  envelope_completed: "Envelope completed",

  payment_escalation: "Payment escalation",
}

/** One-line description of each event, shown beside its switch on the settings page. */

export const NOTIFICATION_TYPE_DESCRIPTIONS: Record<NotificationType, string> =
  {
    booking_confirmed: "A sale was confirmed and its unit moved to booked.",

    payment_recorded: "A payment was received and a receipt was issued.",

    approval_requested: "A request is waiting for you in the approvals queue.",

    document_uploaded: "A file was added to a record you own or work on.",

    requisition_decided:
      "A purchase requisition you raised was approved or rejected.",

    purchase_order_received: "Goods were received against a purchase order.",

    envelope_completed: "Every signer completed a document envelope.",

    payment_escalation:
      "An overdue instalment crossed the escalation threshold and the recovery desk was alerted.",
  }

export const NOTIFICATION_CHANNELS = [
  "in_app",

  "email",

  "both",

  "off",
] as const

export type NotificationChannel = typeof NOTIFICATION_CHANNELS[number]

export const NOTIFICATION_CHANNEL_LABELS: Record<NotificationChannel, string> =
  {
    in_app: "In-app",

    email: "Email",

    both: "Both",

    off: "Off",
  }

/**
 * The channel a type takes when a user has not chosen one. In-app by default:
 * it is the one surface this workspace can actually deliver on.
 */

export const DEFAULT_NOTIFICATION_CHANNEL: NotificationChannel = "in_app"

export function isNotificationType(value: string): value is NotificationType {
  return (NOTIFICATION_TYPES as readonly string[]).includes(value)
}

export function isNotificationChannel(
  value: string,
): value is NotificationChannel {
  return (NOTIFICATION_CHANNELS as readonly string[]).includes(value)
}

/** The channels that make a row worth surfacing in the bell and the list. */

export const NOTIFICATION_ACTIVE_CHANNELS: NotificationChannel[] = [
  "in_app",

  "email",

  "both",
]

// --- View contracts --------------------------------------------------------

/** One notification as the client renders it. */

export interface NotificationView {
  id: string

  type: NotificationType

  typeLabel: string

  title: string

  body: string | null

  linkPath: string | null

  channel: NotificationChannel

  actorName: string | null

  readAt: string | null

  createdAt: string
}

export interface NotificationListResponse {
  notifications: NotificationView[]

  /** Unread across the whole inbox, independent of the current filter. */

  unreadCount: number

  limit: number

  truncated: boolean
}

/** A resolved per-type channel for the settings screen (defaults filled in). */

export interface NotificationSettingView {
  type: NotificationType

  label: string

  description: string

  channel: NotificationChannel
}

export interface NotificationSettingsResponse {
  settings: NotificationSettingView[]

  /** Always false here: there is no mail gateway wired, so email is a recorded
   *  preference rather than a promise. The client surfaces this honestly. */

  emailConnected: boolean
}

export interface NotificationSettingsUpdateResponse {
  settings: NotificationSettingView[]

  emailConnected: boolean
}
