/**
 * Communications settings: the editable templates behind email / SMS / WhatsApp.
 *
 * This is a *composition* surface, not a delivery one. It stores the body a
 * message would carry, offers a live preview with the platform's own tokens
 * substituted, and runs the due-payment reminder as a read-only dry run. It sends
 * nothing and opens no socket to any provider — that scope line is deliberate and
 * repeated in `shared/communications.ts` and `server/jobs/due-payment-reminders.ts`.
 *
 * Templates live under `/api/settings/*` because that is where a workspace
 * configures itself, and they are gated on `settings.view` / `settings.edit` for
 * the same reason. Each (channel, purpose) is stored per language — English and
 * Urdu side by side — and the reminder engine picks the row per customer. The
 * subject is stored but may be left blank, which means "use the shipped default",
 * so an office that never typed a subject keeps the subject it renders today.
 */

import {
  defaultTemplate,
  isMessageChannel,
  isMessageLanguage,
  isTemplateKey,
  MESSAGE_BODY_MAX,
  MESSAGE_CHANNELS,
  MESSAGE_LANGUAGES,
  MESSAGE_SUBJECT_MAX,
  PLACEHOLDER_TOKENS,
  PLACEHOLDER_TOKEN_LABELS,
  TEMPLATE_KEYS,
  TEMPLATE_KEY_HINTS,
  TEMPLATE_KEY_LABELS,
  renderTemplate,
  type CommunicationsView,
  type MessageChannel,
  type MessageLanguage,
  type MessageTemplate,
  type RenderContext,
} from "../../shared/communications.ts"

import { all, run } from "../db.ts"

import { badRequest, readJsonBody, type RequestContext } from "../http.ts"

import { requireAuth, requirePermission, writeAudit } from "../middleware.ts"

import type { GuardedContext } from "../middleware.ts"

import { runDuePaymentReminders } from "../jobs/due-payment-reminders.ts"

const now = () => new Date().toISOString()

interface TemplateRow {
  channel: string

  template_key: string

  language: string

  subject: string

  body: string

  enabled: number

  updated_at: string
}

function loadStoredTemplates(ctx: GuardedContext): Map<string, TemplateRow> {
  const rows = all<TemplateRow>(
    `SELECT channel, template_key, language, subject, body, enabled, updated_at
       FROM message_templates
      WHERE tenant_id = ?`,

    ctx.tenantId,
  )

  return new Map(
    rows.map((row) => [
      `${row.channel}|${row.template_key}|${row.language}`,
      row,
    ]),
  )
}

/**
 * Every (channel, purpose, language) triple, DB body where it exists and the
 * shipped default where it does not. Reading the catalogue rather than only
 * stored rows means a preview is always complete, and a fresh workspace with no
 * template writes still sees exactly what its reminders would say — in either
 * language. A blank stored subject falls back to the shipped one.
 */

function buildTemplates(ctx: GuardedContext): MessageTemplate[] {
  const stored = loadStoredTemplates(ctx)

  const templates: MessageTemplate[] = []

  for (const channel of MESSAGE_CHANNELS) {
    for (const key of TEMPLATE_KEYS) {
      for (const language of MESSAGE_LANGUAGES) {
        const row = stored.get(`${channel}|${key}|${language}`)

        const fallback = defaultTemplate(language, channel, key)

        templates.push({
          channel,

          templateKey: key,

          language,

          subject: row?.subject?.trim() ? row.subject : fallback.subject,

          body: row?.body ?? fallback.body,

          enabled: row ? row.enabled === 1 : true,

          updatedAt: row?.updated_at ?? "",
        })
      }
    }
  }

  return templates
}

/**
 * GET /api/settings/communications
 *
 * The full editable catalogue plus the token list the editor renders as clickable
 * inserts. Nothing is created on read; a workspace with no stored rows simply
 * gets the defaults, and `canEdit` decides whether the panel shows a Save button.
 */

export function getCommunications(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "settings", "view")

  const view: CommunicationsView = {
    templates: buildTemplates(guarded),

    channels: [...MESSAGE_CHANNELS],

    keys: [...TEMPLATE_KEYS],

    languages: [...MESSAGE_LANGUAGES],

    tokens: [...PLACEHOLDER_TOKENS],

    canEdit: guarded.can("settings", "edit"),
  }

  return {
    ...view,

    channelLabels: {
      email: "Email",

      sms: "SMS",

      whatsapp: "WhatsApp",
    } satisfies Record<MessageChannel, string>,

    keyLabels: TEMPLATE_KEY_LABELS,

    keyHints: TEMPLATE_KEY_HINTS,

    tokenLabels: PLACEHOLDER_TOKEN_LABELS,

    bodyMax: MESSAGE_BODY_MAX,
  }
}

/**
 * PUT /api/settings/communications/template
 *
 * Upserts one (channel, purpose, language). An edited body is stored verbatim;
 * the substitution is checked at preview time, not here, so a template can be
 * saved mid-draft with a token the sample data has not filled. A blank subject
 * means "use the shipped default". Only `settings.edit` reaches this — the same
 * grant that edits numbering and approval policy.
 */

export async function saveTemplate(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "settings", "edit")

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  if (!isMessageChannel(body.channel)) {
    throw badRequest("Unknown channel.", {
      channel: "Choose email, sms, or whatsapp.",
    })
  }

  if (!isTemplateKey(body.key)) {
    throw badRequest("Unknown template.", {
      key: "Choose one of the seven message purposes.",
    })
  }

  // Absent language means English, the one language every workspace already had.

  const language: MessageLanguage =
    body.language === undefined
      ? "en"
      : isMessageLanguage(body.language)
        ? body.language
        : rejectLanguage()

  const channel = body.channel

  const key = body.key

  const text = typeof body.body === "string" ? body.body : ""

  if (text.trim() === "") {
    throw badRequest("The message body cannot be empty.", {
      body: "Write something before saving.",
    })
  }

  if (text.length > MESSAGE_BODY_MAX) {
    throw badRequest("That message body is too long.", {
      body: `Use ${MESSAGE_BODY_MAX} characters or fewer.`,
    })
  }

  const subject =
    typeof body.subject === "string"
      ? body.subject.trim().slice(0, MESSAGE_SUBJECT_MAX)
      : ""

  const enabled = body.enabled === undefined ? true : Boolean(body.enabled)

  const stamp = now()

  run(
    `INSERT INTO message_templates (tenant_id, channel, template_key, language, subject, body, enabled, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (tenant_id, channel, template_key, language) DO UPDATE SET
       subject = excluded.subject,
       body = excluded.body,
       enabled = excluded.enabled,
       updated_at = excluded.updated_at`,

    guarded.tenantId,

    channel,

    key,

    language,

    subject,

    text,

    enabled ? 1 : 0,

    stamp,
  )

  writeAudit(
    guarded,

    "settings.communication_template_updated",

    "message_template",

    `${channel}:${key}:${language}`,

    { channel, key, language, enabled, length: text.length },

    ctx.ip,
  )

  const stored = loadStoredTemplates(guarded).get(
    `${channel}|${key}|${language}`,
  )!

  const fallback = defaultTemplate(language, channel, key)

  return {
    ok: true,

    template: {
      channel,

      templateKey: key,

      language,

      subject: stored.subject.trim() ? stored.subject : fallback.subject,

      body: stored.body,

      enabled: stored.enabled === 1,

      updatedAt: stored.updated_at,
    } satisfies MessageTemplate,
  }
}

/**
 * POST /api/settings/communications/preview
 *
 * Renders the *stored* body (falling back to the default) against a sample
 * context and reports which tokens had nothing to fill. This never writes and
 * never reads money — the context comes from the request, so an operator can see
 * an unsubstituted `{due_amount}` in red before a customer ever does.
 */

export async function previewTemplate(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "settings", "view")

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  if (!isMessageChannel(body.channel)) {
    throw badRequest("Unknown channel.", { channel: "Not a channel." })
  }

  if (!isTemplateKey(body.key)) {
    throw badRequest("Unknown template.", { key: "Not a template." })
  }

  const language: MessageLanguage =
    body.language === undefined
      ? "en"
      : isMessageLanguage(body.language)
        ? body.language
        : rejectLanguage()

  const channel = body.channel

  const key = body.key

  const stored = loadStoredTemplates(guarded).get(
    `${channel}|${key}|${language}`,
  )

  const fallback = defaultTemplate(language, channel, key)

  const templateBody = stored?.body ?? fallback.body

  const context = (
    body.context && typeof body.context === "object" ? body.context : {}
  ) as RenderContext

  const rendered = renderTemplate(templateBody, context)

  const subject = renderTemplate(
    stored?.subject?.trim() ? stored.subject : fallback.subject,

    context,
  )

  return {
    channel,

    key,

    language,

    subject: subject.text,

    text: rendered.text,

    missingTokens: [
      ...new Set([...subject.missingTokens, ...rendered.missingTokens]),
    ],
  }
}

/** One shared rejection for a language the catalogue does not ship. */

function rejectLanguage(): never {
  throw badRequest("Unknown language.", {
    language: "Choose English or Urdu.",
  })
}

/**
 * GET /api/settings/communications/upcoming-reminders?days=&channel=
 *
 * The dry run. Lists the reminders the placeholder job would render for this
 * workspace — instalments due (or already overdue) within `days` — with no send
 * and no write. A workspace can read its own outgoing prose without anyone
 * building a gateway first.
 */

export function upcomingReminders(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "settings", "view")

  const rawDays = Number(guarded.query.get("days") ?? "3")

  const days =
    Number.isFinite(rawDays) && rawDays >= 0 ? Math.floor(rawDays) : 3

  const requested = guarded.query.get("channel") ?? "email"

  if (!isMessageChannel(requested)) {
    throw badRequest("Unknown channel.", { channel: "Not a channel." })
  }

  const reminders = runDuePaymentReminders(
    guarded.tenantId,

    now(),

    days,

    requested as MessageChannel,
  )

  return {
    days,

    channel: requested as MessageChannel,

    count: reminders.length,

    sent: false,

    reminders,
  }
}
