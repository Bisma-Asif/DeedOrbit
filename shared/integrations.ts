/**
 * Integrations vocabulary — API keys, webhook endpoints, and the delivery
 * log that Settings > Integrations shows.
 *
 * The honesty rules this module inherits from the rest of the platform:
 *
 * - A plaintext API key exists for exactly one response. What the list
 *   shows afterwards is the display prefix and nothing else; the row
 *   itself only ever stores a hash, same as a session token.
 * - A webhook delivery is a *real* HTTP attempt. The log carries the
 *   status code, duration, and a snippet of the response that actually
 *   came back. Nothing is marked delivered that was not.
 * - Connections that are not wired (payment gateway, WhatsApp/SMS) are
 *   reported as placeholders with `connected: false` and a note, never
 *   as silent zeros or imaginary health.
 */

// --- API keys ------------------------------------------------------------------

export const API_KEY_PREFIX_LENGTH = 8

export const API_KEY_LABEL_MAX = 80

export const API_KEY_TTL_DAYS_MAX = 365

export interface ApiKeyView {
  id: string

  label: string

  /** First characters of the key, for recognition only. */

  prefix: string

  createdBy: string

  createdAt: string

  expiresAt: string | null

  revokedAt: string | null

  lastUsedAt: string | null

  /** Derived: past `expires_at` or revoked — the key no longer authenticates. */

  active: boolean
}

export interface ApiKeyListResponse {
  apiKeys: ApiKeyView[]
}

/** Returned exactly once, at creation. The plaintext never reappears. */

export interface ApiKeyCreateResponse {
  ok: true

  apiKey: ApiKeyView

  /** The full key shown one time; store it now or revoke and reissue. */

  token: string
}

// --- Webhooks ---------------------------------------------------------------------

export const WEBHOOK_EVENTS = [
  "lead_created",

  "booking_created",

  "payment_received",
] as const

export type WebhookEvent = typeof WEBHOOK_EVENTS[number]

export const WEBHOOK_EVENT_LABELS: Record<WebhookEvent, string> = {
  lead_created: "New lead",

  booking_created: "Booking created",

  payment_received: "Payment recorded",
}

export const WEBHOOK_EVENT_DESCRIPTIONS: Record<WebhookEvent, string> = {
  lead_created: "Fires when a lead is captured, including campaign intake.",

  booking_created: "Fires when a booking is recorded against a unit.",

  payment_received: "Fires when a payment is recorded on a plan.",
}

export function isWebhookEvent(value: string): value is WebhookEvent {
  return (WEBHOOK_EVENTS as readonly string[]).includes(value)
}

export const WEBHOOK_ENDPOINT_STATUSES = ["active", "paused"] as const

export type WebhookEndpointStatus = typeof WEBHOOK_ENDPOINT_STATUSES[number]

/** Consecutive failures before an endpoint pauses itself; logged, never silent. */

export const WEBHOOK_AUTO_PAUSE_AFTER = 5

export const WEBHOOK_URL_MAX = 500

export const WEBHOOK_TIMEOUT_MS = 5000

export interface WebhookEndpointView {
  id: string

  url: string

  events: WebhookEvent[]

  status: string

  /** Total failed deliveries since creation. */

  failureCount: number

  /** Live consecutive failures; reaching the pause threshold trips `paused`. */

  consecutiveFailures: number

  /** Why it paused — "auto: 5 consecutive failures" or a manual pause. */

  pauseReason: string | null

  createdAt: string

  /** The signing secret, only in the creation response; null everywhere else. */

  secret: string | null
}

export interface WebhookEndpointListResponse {
  endpoints: WebhookEndpointView[]
}

export interface WebhookEndpointMutationResponse {
  ok: true

  endpoint: WebhookEndpointView
}

// --- Delivery log ---------------------------------------------------------------------

export const DELIVERY_STATUSES = [
  "pending",

  "success",

  "failed",

  "timeout",
] as const

export type DeliveryStatus = typeof DELIVERY_STATUSES[number]

export const DELIVERY_STATUS_LABELS: Record<DeliveryStatus, string> = {
  pending: "Pending",

  success: "Delivered",

  failed: "Failed",

  timeout: "Timed out",
}

export const DELIVERY_RESPONSE_SNIPPET_MAX = 500

export interface WebhookDeliveryView {
  id: string

  endpointId: string

  endpointUrl: string

  event: string

  status: string

  statusLabel: string

  /** The HTTP status that came back; null when the request never completed. */

  httpStatus: number | null

  durationMs: number | null

  responseSnippet: string | null

  /** True for the panel's "Send test" button, so the log can say which is which. */

  isTest: boolean

  createdAt: string
}

export interface DeliveryListResponse {
  deliveries: WebhookDeliveryView[]
}

// --- Placeholders -----------------------------------------------------------------------

/**
 * A connection the platform does not actually have. The view carries no
 * fabricated health: `connected` is false, the note says so plainly.
 */

export interface IntegrationPlaceholderView {
  key: string

  label: string

  connected: false

  note: string
}

// --- The panel's single load -------------------------------------------------------------

export interface IntegrationsView {
  apiKeys: ApiKeyView[]

  endpoints: WebhookEndpointView[]

  deliveries: WebhookDeliveryView[]

  placeholders: IntegrationPlaceholderView[]

  canManage: boolean
}
