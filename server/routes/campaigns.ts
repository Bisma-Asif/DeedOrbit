/**
 * Campaigns: an acquisition channel, its public intake door, and its funnel.
 *
 * Two very different readers share this file. The staff endpoints are ordinary
 * permissioned CRUD over the `campaigns` table plus a metrics join. The public
 * endpoint — `POST /api/public/campaigns/:token/leads` — has no session at all:
 * its only gate is the unguessable token in the URL, which is why that token is
 * generated from a cryptographic source, stored unique, and rotatable.
 *
 * The metrics answer one honest question: did this channel produce bookings? A
 * lead is *converted* once it has become a customer profile, and a *booking* is
 * counted when that converted lead's customer holds one. A cancelled booking is
 * tallied separately from active bookings rather than dropped, because a campaign
 * that sold-and-was-cancelled is not the same as one that never sold.
 *
 * Nothing here lets a caller set another tenant's campaign: the public handler
 * resolves the campaign *by token alone*, and the token is globally unique, so a
 * lead always lands in the workspace that minted it.
 */

import { randomBytes } from "node:crypto"

import {
  CAMPAIGN_CHANNELS,
  CAMPAIGN_NAME_MAX,
  CAMPAIGN_NOTES_MAX,
  CAMPAIGN_SOURCE_MAX,
  isCampaignChannel,
  type Campaign,
  type CampaignDetail,
  type CampaignIntegration,
  type CampaignMetrics,
  type CampaignsResponse,
  type CampaignWithMetrics,
} from "../../shared/campaigns.ts"

import {
  CAMPAIGN_CHANNEL_LABELS,
  formatCampaignToken,
} from "../../shared/campaigns.ts"

import { newId } from "../crypto.ts"

import { all, get, run } from "../db.ts"

import {
  badRequest,
  forbidden,
  notFound,
  readJsonBody,
  tooManyRequests,
  type RequestContext,
} from "../http.ts"

import { requireAuth, requirePermission, writeAudit } from "../middleware.ts"

import type { GuardedContext } from "../middleware.ts"

import { emitEvent } from "../webhooks.ts"

const now = () => new Date().toISOString()

interface CampaignRow {
  id: string

  tenant_id: string

  name: string

  source: string

  channel: string

  webhook_token: string

  active: number

  notes: string | null

  created_by_name: string

  created_at: string

  updated_at: string
}

/** A fresh, unique-in-practice token: `cap_` plus 24 hex characters. */

function newWebhookToken(): string {
  return formatCampaignToken(randomBytes(24).toString("hex"))
}

function toCampaign(row: CampaignRow): Campaign {
  return {
    id: row.id,

    name: row.name,

    source: row.source,

    channel: (CAMPAIGN_CHANNELS.includes(row.channel as never)
      ? row.channel
      : "other") as Campaign["channel"],

    active: row.active === 1,

    notes: row.notes,

    createdByName: row.created_by_name,

    createdAt: row.created_at,

    updatedAt: row.updated_at,
  }
}

/**
 * The funnel figures for every campaign in one pass.
 *
 * `leads` and `converted` come from a single grouped scan of the leads table;
 * `bookings` and `activeBookings` from joining converted leads to their
 * customers' bookings. Missing groups read as zero — an untested campaign has no
 * rows to group, and an absent group is exactly a zero, not an unknown.
 */

function metricsForTenant(tenantId: string): Map<string, CampaignMetrics> {
  const leadRows = all<{
    campaign_id: string

    leads: number

    converted: number
  }>(
    `SELECT campaign_id,
            COUNT(*) AS leads,
            SUM(CASE WHEN customer_id IS NOT NULL THEN 1 ELSE 0 END) AS converted
       FROM leads
      WHERE tenant_id = ? AND campaign_id IS NOT NULL
      GROUP BY campaign_id`,

    tenantId,
  )

  const bookingRows = all<{
    campaign_id: string

    bookings: number

    active_bookings: number
  }>(
    `SELECT l.campaign_id,
            COUNT(b.id) AS bookings,
            SUM(CASE WHEN b.status = 'confirmed' THEN 1 ELSE 0 END) AS active_bookings
       FROM leads l
       JOIN bookings b ON b.customer_id = l.customer_id AND b.tenant_id = l.tenant_id
      WHERE l.tenant_id = ? AND l.campaign_id IS NOT NULL AND l.customer_id IS NOT NULL
      GROUP BY l.campaign_id`,

    tenantId,
  )

  const map = new Map<string, CampaignMetrics>()

  for (const row of leadRows) {
    map.set(row.campaign_id, {
      leads: row.leads,

      converted: row.converted,

      bookings: 0,

      activeBookings: 0,

      leadToBookingRate: 0,
    })
  }

  for (const row of bookingRows) {
    const base = map.get(row.campaign_id) ?? {
      leads: 0,

      converted: 0,

      bookings: 0,

      activeBookings: 0,

      leadToBookingRate: 0,
    }

    base.bookings = row.bookings

    base.activeBookings = row.active_bookings

    map.set(row.campaign_id, base)
  }

  for (const metrics of map.values()) {
    metrics.leadToBookingRate =
      metrics.leads > 0
        ? Math.round((metrics.bookings / metrics.leads) * 100)
        : 0
  }

  return map
}

const EMPTY_METRICS: CampaignMetrics = {
  leads: 0,

  converted: 0,

  bookings: 0,

  activeBookings: 0,

  leadToBookingRate: 0,
}

function webhookPath(token: string): string {
  return `/api/public/campaigns/${token}/leads`
}

/** Loads a campaign in the caller's workspace, or reports it as absent. */

function loadCampaign(ctx: GuardedContext, id: string): CampaignRow {
  const row = get<CampaignRow>(
    `SELECT * FROM campaigns WHERE tenant_id = ? AND id = ?`,

    ctx.tenantId,

    id,
  )

  if (!row) throw notFound("That campaign does not exist")

  return row
}

function cleanText(
  value: unknown,

  max: number,

  label: string,

  required: boolean,
): string {
  const text = typeof value === "string" ? value.trim() : ""

  if (text === "" && required) {
    throw badRequest(`The ${label} is required.`, { [label]: "Required." })
  }

  if (text.length > max) {
    throw badRequest(`That ${label} is too long.`, {
      [label]: `Use ${max} characters or fewer.`,
    })
  }

  return text
}

/**
 * GET /api/campaigns
 *
 * The list with its funnel. The token is deliberately omitted here — it belongs
 * on the detail/integration screen where an operator copies it into a landing
 * page, not on a row that scrolls past on a wall monitor.
 */

export function listCampaigns(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "campaigns", "view")

  const rows = all<CampaignRow>(
    `SELECT * FROM campaigns WHERE tenant_id = ? ORDER BY created_at DESC`,

    guarded.tenantId,
  )

  const metrics = metricsForTenant(guarded.tenantId)

  const campaigns: CampaignWithMetrics[] = rows.map((row) => ({
    ...toCampaign(row),

    metrics: metrics.get(row.id) ?? EMPTY_METRICS,

    webhookPath: webhookPath(row.webhook_token),
  }))

  const response: CampaignsResponse = {
    campaigns,

    canCreate: guarded.can("campaigns", "create"),
  }

  return {
    ...response,

    channels: [...CAMPAIGN_CHANNELS],

    channelLabels: CAMPAIGN_CHANNEL_LABELS,
  }
}

/** Builds the copy-paste integration block shown on the detail screen. */

function integrationFor(
  ctx: RequestContext,
  path: string,
): CampaignIntegration {
  const forwarded = ctx.req.headers["x-forwarded-proto"]

  const proto =
    typeof forwarded === "string" && forwarded.length > 0
      ? forwarded.split(",")[0]!.trim()
      : "http"

  const host = ctx.req.headers.host ?? "localhost:8444"

  const endpoint = `${proto}://${host}${path}`

  return {
    endpoint,

    method: "POST",

    contentType: "application/json",

    fields: ["fullName", "phone", "email", "projectInterest", "source"],

    htmlSnippet: `<form method="POST" action="${endpoint}">
  <input name="fullName" placeholder="Full name" required />
  <input name="phone" placeholder="Phone" required />
  <input name="email" placeholder="Email" />
  <button type="submit">Enquire</button>
</form>`,

    curlSnippet: `curl -X POST '${endpoint}' \\
  -H 'Content-Type: application/json' \\
  -d '{"fullName":"Aisha Khan","phone":"+971500000000","email":"aisha@example.com"}'`,
  }
}

/**
 * GET /api/campaigns/:id
 *
 * The staff-facing view, which is the only place the token is returned: an
 * operator needs to see it to paste it, and rotation is right beside it.
 */

export function getCampaign(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "campaigns", "view")

  const row = loadCampaign(guarded, ctx.params.id!)

  const metrics =
    metricsForTenant(guarded.tenantId).get(row.id) ?? EMPTY_METRICS

  const campaign: CampaignDetail = {
    ...toCampaign(row),

    metrics,

    webhookPath: webhookPath(row.webhook_token),

    webhookToken: row.webhook_token,

    canManage:
      guarded.can("campaigns", "edit") || guarded.can("campaigns", "delete"),
  }

  return {
    campaign,

    integration: integrationFor(ctx, campaign.webhookPath),

    channelLabels: CAMPAIGN_CHANNEL_LABELS,
  }
}

/** POST /api/campaigns — creates the record and mints its one secret. */

export async function createCampaign(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "campaigns", "create")

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const name = cleanText(body.name, CAMPAIGN_NAME_MAX, "name", true)

  const channel =
    body.channel === undefined || !isCampaignChannel(body.channel)
      ? "other"
      : body.channel

  // The `source` stamped onto captured leads defaults to the campaign name so a

  // funnel reads consistently even when the operator leaves the field blank.

  const source =
    cleanText(body.source, CAMPAIGN_SOURCE_MAX, "source", false) || name

  const notes =
    typeof body.notes === "string" && body.notes.trim() !== ""
      ? cleanText(body.notes, CAMPAIGN_NOTES_MAX, "notes", false)
      : null

  const active = body.active === undefined ? true : Boolean(body.active)

  // Generate until the token is unused. The unique index is the real guard; this

  // just keeps a collision from surfacing as an error to the operator.

  let token = newWebhookToken()

  while (
    get<{ id: string }>(
      `SELECT id FROM campaigns WHERE webhook_token = ?`,
      token,
    )
  ) {
    token = newWebhookToken()
  }

  const id = newId("cmp")

  const stamp = now()

  run(
    `INSERT INTO campaigns (
        id, tenant_id, name, source, channel, webhook_token, active, notes,
        created_by_user_id, created_by_name, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,

    id,

    guarded.tenantId,

    name,

    source,

    channel,

    token,

    active ? 1 : 0,

    notes,

    guarded.userId,

    guarded.session.user.fullName,

    stamp,

    stamp,
  )

  writeAudit(
    guarded,

    "campaigns.created",

    "campaign",

    id,

    { name, channel, active },

    ctx.ip,
  )

  return { ok: true, campaignId: id, webhookToken: token }
}

/** PATCH /api/campaigns/:id — edit the record or flip it active/inactive. */

export async function updateCampaign(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "campaigns", "edit")

  const row = loadCampaign(guarded, ctx.params.id!)

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  let name = row.name

  if (body.name !== undefined)
    name = cleanText(body.name, CAMPAIGN_NAME_MAX, "name", true)

  let source = row.source

  if (body.source !== undefined) {
    source =
      cleanText(body.source, CAMPAIGN_SOURCE_MAX, "source", false) || name
  }

  let channel = row.channel

  if (body.channel !== undefined) {
    if (!isCampaignChannel(body.channel))
      throw badRequest("Unknown channel.", { channel: "Not a channel." })

    channel = body.channel
  }

  let notes = row.notes

  if (body.notes !== undefined) {
    notes =
      typeof body.notes === "string" && body.notes.trim() !== ""
        ? cleanText(body.notes, CAMPAIGN_NOTES_MAX, "notes", false)
        : null
  }

  let active = row.active

  if (body.active !== undefined) active = body.active ? 1 : 0

  run(
    `UPDATE campaigns
        SET name = ?, source = ?, channel = ?, notes = ?, active = ?, updated_at = ?
      WHERE tenant_id = ? AND id = ?`,

    name,

    source,

    channel,

    notes,

    active,

    now(),

    guarded.tenantId,

    row.id,
  )

  writeAudit(
    guarded,

    "campaigns.updated",

    "campaign",

    row.id,

    { name, channel, active: active === 1 },

    ctx.ip,
  )

  return { ok: true }
}

/**
 * POST /api/campaigns/:id/rotate-token
 *
 * Issues a new token and leaves the old one unreferenced. The unique index means
 * a rotation can never hand out a token that still resolves to another campaign,
 * and because rotation does not delete anything, the historical leads stay joined
 * to the campaign by `campaign_id`.
 */

export function rotateCampaignToken(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "campaigns", "edit")

  const row = loadCampaign(guarded, ctx.params.id!)

  let token = newWebhookToken()

  while (
    get<{ id: string }>(
      `SELECT id FROM campaigns WHERE webhook_token = ?`,
      token,
    )
  ) {
    token = newWebhookToken()
  }

  run(
    `UPDATE campaigns SET webhook_token = ?, updated_at = ? WHERE tenant_id = ? AND id = ?`,

    token,

    now(),

    guarded.tenantId,

    row.id,
  )

  writeAudit(
    guarded,

    "campaigns.token_rotated",

    "campaign",

    row.id,

    {},

    ctx.ip,
  )

  return { ok: true, webhookToken: token, webhookPath: webhookPath(token) }
}

/**
 * DELETE /api/campaigns/:id — a soft archive.
 *
 * Sets `active = 0` rather than removing the row: an ended campaign still needs
 * to report its funnel, and its token must stop accepting leads. Deleting the row
 * would orphan the leads and rewrite the campaign's history out from under the
 * very metrics it exists to be judged on.
 */

export function archiveCampaign(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "campaigns", "delete")

  const row = loadCampaign(guarded, ctx.params.id!)

  run(
    `UPDATE campaigns SET active = 0, updated_at = ? WHERE tenant_id = ? AND id = ?`,

    now(),

    guarded.tenantId,

    row.id,
  )

  writeAudit(
    guarded,

    "campaigns.archived",

    "campaign",

    row.id,

    { name: row.name },

    ctx.ip,
  )

  return { ok: true, archived: true }
}

// --- public lead intake -----------------------------------------------------

interface WebhookWindow {
  count: number

  resetAt: number
}

const WEBHOOK_LIMIT = 20

const WEBHOOK_WINDOW_MS = 10 * 60 * 1000

const webhookAttempts = new Map<string, WebhookWindow>()

/**
 * A coarse per-(token, ip) throttle. The token is the only credential on this
 * door, so a leaked landing-page URL must not turn into an unbounded lead-flood
 * from one script. This is an in-memory rate window — not a quota — and it exists
 * to blunt automated abuse, not to meter legitimate volume.
 */

function checkWebhookThrottle(key: string): void {
  const window = webhookAttempts.get(key)

  if (!window) return

  if (Date.now() > window.resetAt) {
    webhookAttempts.delete(key)

    return
  }

  if (window.count >= WEBHOOK_LIMIT) {
    throw tooManyRequests("Too many enquiries from this source right now.")
  }
}

function recordWebhookHit(key: string): void {
  const existing = webhookAttempts.get(key)

  if (!existing || Date.now() > existing.resetAt) {
    webhookAttempts.set(key, {
      count: 1,
      resetAt: Date.now() + WEBHOOK_WINDOW_MS,
    })

    return
  }

  existing.count += 1
}

/**
 * POST /api/public/campaigns/:token/leads — registered `public: true`.
 *
 * The whole authorization is the token: it must exist and its campaign must be
 * active, and there is no session and no permission check. A required-field
 * failure is a 400 with field messages, because this endpoint is meant to be
 * driven by an external form and needs to explain itself without a developer in
 * the loop. Leads land as `status = 'new'` stamped with the campaign's source.
 */

export async function publicCreateLead(ctx: RequestContext) {
  const token = ctx.params.token ?? ""

  const campaign = get<CampaignRow>(
    `SELECT * FROM campaigns WHERE webhook_token = ?`,

    token,
  )

  if (!campaign) throw notFound("That campaign link is not valid")

  if (campaign.active !== 1)
    throw forbidden(
      "That campaign is no longer accepting enquiries.",
      "campaign_inactive",
    )

  const key = `${campaign.id}|${ctx.ip}`

  checkWebhookThrottle(key)

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const fields: Record<string, string> = {}

  const fullName = typeof body.fullName === "string" ? body.fullName.trim() : ""

  const phone = typeof body.phone === "string" ? body.phone.trim() : ""

  if (fullName === "") fields.fullName = "Required."

  if (phone === "") fields.phone = "Required."

  if (Object.keys(fields).length > 0) {
    throw badRequest("Full name and phone are required.", fields)
  }

  const email =
    typeof body.email === "string" && body.email.trim() !== ""
      ? body.email.trim()
      : null

  const projectInterest =
    typeof body.projectInterest === "string" &&
    body.projectInterest.trim() !== ""
      ? body.projectInterest.trim().slice(0, 200)
      : null

  // An explicit `source` from the form is honoured (a portal may post several

  // campaigns through one form); otherwise the campaign's own source is stamped.

  const source =
    typeof body.source === "string" && body.source.trim() !== ""
      ? body.source.trim().slice(0, CAMPAIGN_SOURCE_MAX)
      : campaign.source

  const id = newId("lead")

  const stamp = now()

  run(
    `INSERT INTO leads (
        id, tenant_id, full_name, phone, email, source, campaign, project_interest,
        status, campaign_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?)`,

    id,

    campaign.tenant_id,

    fullName,

    phone,

    email,

    source,

    campaign.name,

    projectInterest,

    campaign.id,

    stamp,

    stamp,
  )

  recordWebhookHit(key)

  // Campaign intake is a lead just like a hand-typed one, so it fans out to the
  // same subscribed endpoints. Fire-and-forget; the webhook log owns the result.
  void emitEvent(campaign.tenant_id, "lead_created", {
    event: "lead_created",
    leadId: id,
    fullName,
    phone,
    email,
    source,
    campaign: campaign.name,
    status: "new",
    createdAt: stamp,
  })

  return { ok: true, leadId: id }
}
