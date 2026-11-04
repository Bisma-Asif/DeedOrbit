/**
 * Settings > Integrations: API keys, webhook endpoints, and the delivery log.
 *
 * The panel reads on `settings.view` and writes on `settings.edit` — these are
 * workspace configuration, not a business module. Three honesty rules hold the
 * whole surface together:
 *
 * - An API key's plaintext and a webhook's signing secret appear in exactly one
 *   response each. What the list shows afterwards is the display prefix (keys)
 *   and no secret at all (endpoints); the rows store a hash and a usable secret,
 *   never a re-shown plaintext.
 * - A delivery row is the record of a *real* POST that already happened, with
 *   the status, duration, and response snippet the remote end actually returned.
 *   "Send test" fires one for a single endpoint and flags it as a test.
 * - Connections that are not wired (payment gateway, WhatsApp/SMS, email) are
 *   reported as placeholders that say so plainly — never silent zeros or
 *   invented health.
 */

import { all, get, run } from "../db.ts"

import {
  badRequest,
  notFound,
  readJsonBody,
  type RequestContext,
} from "../http.ts"

import { requireAuth, requirePermission, writeAudit } from "../middleware.ts"

import { mintApiKey } from "../api-keys.ts"

import { requireApiKey } from "../api-keys.ts"

import { generateToken } from "../crypto.ts"

import { deliverToEndpoint, loadEndpointRow } from "../webhooks.ts"

import {
  API_KEY_LABEL_MAX,
  API_KEY_TTL_DAYS_MAX,
  DELIVERY_STATUS_LABELS,
  WEBHOOK_URL_MAX,
  isWebhookEvent,
  type ApiKeyCreateResponse,
  type ApiKeyView,
  type DeliveryListResponse,
  type IntegrationPlaceholderView,
  type IntegrationsView,
  type WebhookDeliveryView,
  type WebhookEndpointListResponse,
  type WebhookEndpointMutationResponse,
  type WebhookEndpointView,
  type WebhookEvent,
} from "../../shared/integrations.ts"

/** `{ id, revoked_at, label }` projection for the revoke guard. */
interface ApiKeyRevokeRow {
  id: string

  revoked_at: string | null

  label: string
}

/** Filter pair for the delivery-log query. */
interface DeliveryFilters {
  event?: string

  status?: string
}

const now = () => new Date().toISOString()

function idFor(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`
}

// --- API keys --------------------------------------------------------------

type ApiKeyRow = {
  id: string

  tenant_id: string

  label: string

  prefix: string

  created_by_name: string

  expires_at: string | null

  revoked_at: string | null

  last_used_at: string | null

  created_at: string
}

function apiKeyActive(row: ApiKeyRow): boolean {
  if (row.revoked_at) return false

  if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now())
    return false

  return true
}

function toApiKeyView(row: ApiKeyRow): ApiKeyView {
  return {
    id: row.id,

    label: row.label,

    prefix: row.prefix,

    createdBy: row.created_by_name,

    createdAt: row.created_at,

    expiresAt: row.expires_at,

    revokedAt: row.revoked_at,

    lastUsedAt: row.last_used_at,

    active: apiKeyActive(row),
  }
}

function listApiKeyRows(tenantId: string): ApiKeyRow[] {
  return all<ApiKeyRow>(
    `SELECT id, tenant_id, label, prefix, created_by_name, expires_at,
            revoked_at, last_used_at, created_at
       FROM api_keys WHERE tenant_id = ?
      ORDER BY created_at DESC, rowid DESC`,

    tenantId,
  )
}

/** POST /api/settings/integrations/api-keys — the plaintext is returned once. */

export async function createApiKey(
  ctx: RequestContext,
): Promise<ApiKeyCreateResponse> {
  const guarded = requirePermission(requireAuth(ctx), "settings", "edit")

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const errors: Record<string, string> = {}

  const label = typeof body.label === "string" ? body.label.trim() : ""

  if (label === "")
    errors.label = "Give the key a label so you can recognise it."
  else if (label.length > API_KEY_LABEL_MAX)
    errors.label = `Use ${API_KEY_LABEL_MAX} characters or fewer.`

  let expiresAt: string | null = null

  if (
    body.ttlDays !== undefined &&
    body.ttlDays !== null &&
    body.ttlDays !== ""
  ) {
    const days = Number(body.ttlDays)

    if (
      !Number.isSafeInteger(days) ||
      days < 1 ||
      days > API_KEY_TTL_DAYS_MAX
    ) {
      errors.ttlDays = `Use a lifetime between 1 and ${API_KEY_TTL_DAYS_MAX} days.`
    } else {
      const date = new Date()

      date.setDate(date.getDate() + days)

      expiresAt = date.toISOString()
    }
  }

  if (Object.keys(errors).length > 0) {
    throw badRequest("Check the highlighted fields", errors)
  }

  const minted = mintApiKey()

  const id = idFor("apk")

  run(
    `INSERT INTO api_keys (
        id, tenant_id, label, token_hash, prefix, created_by_user_id,
        created_by_name, expires_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,

    id,

    guarded.tenantId,

    label,

    minted.tokenHash,

    minted.prefix,

    guarded.userId,

    guarded.session.user.fullName,

    expiresAt,

    now(),
  )

  writeAudit(
    guarded,
    "settings.api_key.create",
    "settings",
    id,
    { label, prefix: minted.prefix },
    ctx.ip,
  )

  const row = get<ApiKeyRow>(
    `SELECT id, tenant_id, label, prefix, created_by_name, expires_at,
            revoked_at, last_used_at, created_at
       FROM api_keys WHERE tenant_id = ? AND id = ?`,

    guarded.tenantId,

    id,
  )!

  return { ok: true, apiKey: toApiKeyView(row), token: minted.token }
}

/** POST /api/settings/integrations/api-keys/:id/revoke — a dead credential, kept for the trail. */

export async function revokeApiKey(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "settings", "edit")

  const row = get<ApiKeyRevokeRow>(
    "SELECT id, revoked_at, label FROM api_keys WHERE tenant_id = ? AND id = ?",

    guarded.tenantId,

    ctx.params.apiKeyId!,
  )

  if (!row) throw notFound("That API key does not exist")

  if (!row.revoked_at) {
    run("UPDATE api_keys SET revoked_at = ? WHERE id = ?", now(), row.id)
  }

  writeAudit(
    guarded,
    "settings.api_key.revoke",
    "settings",
    row.id,
    { label: row.label },
    ctx.ip,
  )

  return { ok: true }
}

// --- Webhook endpoints -----------------------------------------------------

type EndpointRow = {
  id: string

  tenant_id: string

  url: string

  events: string

  status: string

  failure_count: number

  consecutive_failures: number

  pause_reason: string | null

  created_at: string
}

function eventsOf(row: EndpointRow): WebhookEvent[] {
  try {
    const parsed = JSON.parse(row.events)

    if (!Array.isArray(parsed)) return []

    return parsed.filter(
      (value): value is WebhookEvent =>
        typeof value === "string" && isWebhookEvent(value),
    )
  } catch {
    return []
  }
}

function toEndpointView(
  row: EndpointRow,
  secret: string | null = null,
): WebhookEndpointView {
  return {
    id: row.id,

    url: row.url,

    events: eventsOf(row),

    status: row.status,

    failureCount: Number(row.failure_count ?? 0),

    consecutiveFailures: Number(row.consecutive_failures ?? 0),

    pauseReason: row.pause_reason,

    createdAt: row.created_at,

    secret,
  }
}

function loadEndpoint(tenantId: string, id: string): EndpointRow | undefined {
  return get<EndpointRow>(
    `SELECT id, tenant_id, url, events, status, failure_count,
            consecutive_failures, pause_reason, created_at
       FROM webhook_endpoints WHERE tenant_id = ? AND id = ?`,

    tenantId,

    id,
  )
}

function parseEvents(
  raw: unknown,
  errors: Record<string, string>,
): WebhookEvent[] {
  const list = Array.isArray(raw) ? raw : []

  const events: WebhookEvent[] = []

  for (const entry of list) {
    if (typeof entry === "string" && isWebhookEvent(entry)) {
      if (!events.includes(entry)) events.push(entry)
    } else {
      errors.events = "Each event must be one the platform actually emits."

      break
    }
  }

  return events
}

/** POST /api/settings/integrations/webhooks — the signing secret is returned once. */

export async function createEndpoint(
  ctx: RequestContext,
): Promise<WebhookEndpointMutationResponse> {
  const guarded = requirePermission(requireAuth(ctx), "settings", "edit")

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const errors: Record<string, string> = {}

  const url = typeof body.url === "string" ? body.url.trim() : ""

  if (url === "") errors.url = "Where should we POST these events?"
  else if (url.length > WEBHOOK_URL_MAX)
    errors.url = `Use ${WEBHOOK_URL_MAX} characters or fewer.`
  else if (!/^https?:\/\//i.test(url))
    errors.url = "The URL must start with http:// or https://."

  const events = parseEvents(body.events, errors)

  if (events.length === 0 && !errors.events) {
    errors.events = "Pick at least one event."
  }

  if (Object.keys(errors).length > 0) {
    throw badRequest("Check the highlighted fields", errors)
  }

  const id = idFor("whe")

  const secret = generateToken(24)

  run(
    `INSERT INTO webhook_endpoints (
        id, tenant_id, url, secret, events, status, failure_count,
        consecutive_failures, created_by_user_id, created_by_name, created_at
      ) VALUES (?, ?, ?, ?, ?, 'active', 0, 0, ?, ?, ?)`,

    id,

    guarded.tenantId,

    url,

    secret,

    JSON.stringify(events),

    guarded.userId,

    guarded.session.user.fullName,

    now(),
  )

  writeAudit(
    guarded,
    "settings.webhook.create",
    "settings",
    id,
    { url, events },
    ctx.ip,
  )

  const row = loadEndpoint(guarded.tenantId, id)!

  return { ok: true, endpoint: toEndpointView(row, secret) }
}

/**
 * PATCH /api/settings/integrations/webhooks/:id — edit the target or the
 * subscription, or resume/pause. Resuming clears the auto-pause counters so a
 * deliberate restart is distinguishable from a streak that has not ended.
 */

export async function updateEndpoint(
  ctx: RequestContext,
): Promise<WebhookEndpointMutationResponse> {
  const guarded = requirePermission(requireAuth(ctx), "settings", "edit")

  const existing = loadEndpoint(guarded.tenantId, ctx.params.endpointId!)

  if (!existing) throw notFound("That endpoint does not exist")

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const errors: Record<string, string> = {}

  const url =
    typeof body.url === "string" && body.url.trim() !== ""
      ? body.url.trim()
      : existing.url

  if (url.length > WEBHOOK_URL_MAX)
    errors.url = `Use ${WEBHOOK_URL_MAX} characters or fewer.`
  else if (!/^https?:\/\//i.test(url))
    errors.url = "The URL must start with http:// or https://."

  const events =
    body.events !== undefined
      ? parseEvents(body.events, errors)
      : eventsOf(existing)

  if (events.length === 0 && !errors.events)
    errors.events = "Pick at least one event."

  const wantsPaused = body.status === "paused"

  const wantsActive = body.status === "active"

  if (Object.keys(errors).length > 0) {
    throw badRequest("Check the highlighted fields", errors)
  }

  const status = wantsPaused
    ? "paused"
    : wantsActive
      ? "active"
      : existing.status

  const resumed = wantsActive && existing.status === "paused"

  const pauseReason = wantsPaused
    ? "manual: paused from Settings"
    : wantsActive
      ? null
      : existing.pause_reason

  run(
    `UPDATE webhook_endpoints
        SET url = ?, events = ?, status = ?, pause_reason = ?,
            consecutive_failures = CASE WHEN ? = 1 THEN 0 ELSE consecutive_failures END
      WHERE tenant_id = ? AND id = ?`,

    url,

    JSON.stringify(events),

    status,

    pauseReason,

    resumed ? 1 : 0,

    guarded.tenantId,

    existing.id,
  )

  writeAudit(
    guarded,

    "settings.webhook.update",

    "settings",

    existing.id,

    { url, events, status },

    ctx.ip,
  )

  return {
    ok: true,
    endpoint: toEndpointView(loadEndpoint(guarded.tenantId, existing.id)!),
  }
}

/**
 * POST /api/settings/integrations/webhooks/:id/test — a real POST to the
 * endpoint now, flagged as a test so it never counts toward the failure streak.
 */

export async function testEndpoint(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "settings", "edit")

  const endpoint = loadEndpointRow(guarded.tenantId, ctx.params.endpointId!)

  if (!endpoint) throw notFound("That endpoint does not exist")

  const deliveryId = await deliverToEndpoint(
    endpoint,

    "test",

    {
      event: "test",
      message: "DeedOrbit test delivery",
      endpointId: endpoint.id,
      sentAt: now(),
    },

    true,
  )

  writeAudit(
    guarded,
    "settings.webhook.test",
    "settings",
    endpoint.id,
    { deliveryId },
    ctx.ip,
  )

  const delivery = get<DeliveryRow>(
    `${DELIVERY_SELECT} WHERE d.tenant_id = ? AND d.id = ?`,

    guarded.tenantId,

    deliveryId,
  )!

  return { ok: true, delivery: toDeliveryView(delivery) }
}

function listEndpoints(tenantId: string): EndpointRow[] {
  return all<EndpointRow>(
    `SELECT id, tenant_id, url, events, status, failure_count,
            consecutive_failures, pause_reason, created_at
       FROM webhook_endpoints WHERE tenant_id = ?
      ORDER BY created_at DESC, rowid DESC`,

    tenantId,
  )
}

// --- Delivery log ----------------------------------------------------------

type DeliveryRow = {
  id: string

  endpoint_id: string

  endpoint_url: string

  event: string

  status: string

  http_status: number | null

  duration_ms: number | null

  response_snippet: string | null

  is_test: number

  created_at: string
}

const DELIVERY_SELECT = `
  SELECT d.id, d.endpoint_id, e.url AS endpoint_url, d.event, d.status,
         d.http_status, d.duration_ms, d.response_snippet, d.is_test, d.created_at
    FROM webhook_deliveries d
    JOIN webhook_endpoints e ON e.id = d.endpoint_id
`

function toDeliveryView(row: DeliveryRow): WebhookDeliveryView {
  return {
    id: row.id,

    endpointId: row.endpoint_id,

    endpointUrl: row.endpoint_url,

    event: row.event,

    status: row.status,

    statusLabel:
      DELIVERY_STATUS_LABELS[
        ((row.status in DELIVERY_STATUS_LABELS
          ? row.status
          : "pending") as keyof typeof DELIVERY_STATUS_LABELS)
      ],

    httpStatus: row.http_status === null ? null : Number(row.http_status),

    durationMs: row.duration_ms === null ? null : Number(row.duration_ms),

    responseSnippet: row.response_snippet,

    isTest: Number(row.is_test) === 1,

    createdAt: row.created_at,
  }
}

function queryDeliveries(
  tenantId: string,

  filters: DeliveryFilters,

  limit: number,
): DeliveryRow[] {
  const clauses = ["d.tenant_id = ?"]

  const params: Array<string | number> = [tenantId]

  if (filters.event && isWebhookEvent(filters.event)) {
    clauses.push("d.event = ?")

    params.push(filters.event)
  }

  if (
    filters.status === "pending" ||
    filters.status === "success" ||
    filters.status === "failed" ||
    filters.status === "timeout"
  ) {
    clauses.push("d.status = ?")

    params.push(filters.status)
  }

  return all<DeliveryRow>(
    `${DELIVERY_SELECT} WHERE ${clauses.join(" AND ")}
      ORDER BY d.created_at DESC, d.rowid DESC LIMIT ?`,

    ...params,

    limit,
  )
}

/** GET /api/settings/integrations/deliveries */

export async function listDeliveries(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "settings", "view")

  const deliveries = queryDeliveries(
    guarded.tenantId,

    {
      event: ctx.query.get("event") ?? undefined,

      status: ctx.query.get("status") ?? undefined,
    },

    200,
  ).map(toDeliveryView)

  return { deliveries } satisfies DeliveryListResponse
}

// --- The single panel load -------------------------------------------------

const PLACEHOLDERS: IntegrationPlaceholderView[] = [
  {
    key: "payment_gateway",

    label: "Payment gateway",

    connected: false,

    note: "No gateway is wired. Payments are recorded by hand; nothing here contacts a card processor.",
  },

  {
    key: "whatsapp_sms",

    label: "WhatsApp / SMS",

    connected: false,

    note: "No messaging provider is connected. Campaign and notification channels are recorded as preferences, never sent.",
  },

  {
    key: "email",

    label: "Email",

    connected: false,

    note: "No mail gateway is configured. Email preferences are stored and surfaced, but no message leaves the workspace.",
  },
]

/** GET /api/settings/integrations */

export async function getIntegrations(
  ctx: RequestContext,
): Promise<IntegrationsView> {
  const guarded = requirePermission(requireAuth(ctx), "settings", "view")

  return {
    apiKeys: listApiKeyRows(guarded.tenantId).map(toApiKeyView),

    endpoints: listEndpoints(guarded.tenantId).map((row) =>
      toEndpointView(row),
    ),

    deliveries: queryDeliveries(guarded.tenantId, {}, 50).map(toDeliveryView),

    placeholders: PLACEHOLDERS,

    canManage: guarded.can("settings", "edit"),
  }
}

/** GET /api/settings/integrations/webhooks — endpoint list on its own. */

export async function listEndpointsHandler(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "settings", "view")

  return {
    endpoints: listEndpoints(guarded.tenantId).map((row) =>
      toEndpointView(row),
    ),
  } satisfies WebhookEndpointListResponse
}

// --- The open, key-authenticated surface -----------------------------------

interface OpenLeadRow {
  id: string

  full_name: string

  phone: string

  email: string | null

  source: string

  status: string

  created_at: string
}

/**
 * GET /api/open/leads — the first read-only surface an API key unlocks.
 * The tenant comes from the key, never the request, so one caller cannot read
 * another workspace by naming its id. This is deliberately narrow: reads, not
 * writes; leads, not the whole database.
 */

export async function openListLeads(ctx: RequestContext) {
  const key = requireApiKey(ctx)

  const search = (ctx.query.get("search") ?? "").trim().toLowerCase()

  const clauses = ["tenant_id = ?"]

  const params: Array<string | number> = [key.tenantId]

  if (search) {
    clauses.push("LOWER(full_name) LIKE ?")

    params.push(`%${search}%`)
  }

  const rows = all<OpenLeadRow>(
    `SELECT id, full_name, phone, email, source, status, created_at
       FROM leads WHERE ${clauses.join(" AND ")}
      ORDER BY updated_at DESC, rowid DESC LIMIT 200`,

    ...params,
  )

  return {
    leads: rows.map((row) => ({
      id: row.id,

      fullName: row.full_name,

      phone: row.phone,

      email: row.email,

      source: row.source,

      status: row.status,

      createdAt: row.created_at,
    })),

    key: { label: key.label },
  }
}
