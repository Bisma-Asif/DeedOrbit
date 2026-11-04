/**
 * Document expiry scan and outstanding-document reminders.
 *
 * Both reuse the payment reminder engine's ledger and guards, because the ledger
 * is the one place that already guarantees "write before send, and a UNIQUE
 * (tenant, dedupe_key) is the only no-duplicate guarantee". A second message table
 * would drift from it, so document nudges belong in the same `outbound_messages`
 * rows the desk already reads.
 *
 * Two honesty rules carried over from the payment engine:
 *   - every guard that withholds a message writes a readable `skipped` row with
 *     its reason (opt-out, no address, disabled template) — silence is never the
 *     answer to "was my customer told?";
 *   - an `expired` document is *derived* from its stored date by the checklist
 *     rollup, never stamped here, so the scan only ever queues the 60/30/7 rungs
 *     of a still-live file and cannot fake a state a date does not support.
 *
 * `runDocumentExpiryScan` only queues; the shared scheduler's dispatch pass (which
 * honours the tenant's sending window) delivers them. `sendMissingDocumentReminders`
 * is an officer's explicit action, so it dispatches straight away like a receipt
 * confirmation does.
 */

import {
  renderTemplate,
  type MessageChannel,
  type RenderContext,
} from "../../shared/communications.ts"

import {
  karachiParts,
  resolveReminderLanguage,
  documentExpiringDedupeKey,
  documentUploadReminderDedupeKey,
  type ReminderPurpose,
} from "../../shared/reminders.ts"

import { all, get } from "../db.ts"

import { deliverMessage } from "../messaging/dispatch.ts"

import {
  loadReminderSettings,
  queueReminderMessage,
  resolveEngineTemplate,
  type EngineContext,
  type GuardFacts,
} from "./payment-reminders.ts"

import {
  buildDocumentChecklist,
  documentExpiryAlert,
  getVerificationSettings,
} from "../document-verification-core.ts"

/** A customer's contact and consent, straight off the row. */

interface DocumentContactRow {
  id: string

  full_name: string

  email: string | null

  phone: string | null

  whatsapp: string | null

  email_opt_in: number

  sms_opt_in: number

  whatsapp_opt_in: number

  reminder_language: string | null
}

/** A tracked document with a live expiry, joined to its owning customer id. */

interface ExpiringDocRow {
  id: string

  entity_id: string

  title: string

  checklist_key: string | null

  expires_at: string
}

interface ContactLookupRow {
  full_name: string

  email: string | null

  phone: string | null

  whatsapp: string | null

  email_opt_in: number

  sms_opt_in: number

  whatsapp_opt_in: number

  reminder_language: string | null
}

function loadContact(
  tenantId: string,

  customerId: string,
): DocumentContactRow | null {
  const found = get<ContactLookupRow>(
    `SELECT full_name, email, phone, whatsapp, email_opt_in, sms_opt_in,
            whatsapp_opt_in, reminder_language
       FROM customers WHERE tenant_id = ? AND id = ?`,

    tenantId,

    customerId,
  )

  if (!found) return null

  return { id: customerId, ...found }
}

function guardsFor(customer: DocumentContactRow): GuardFacts {
  return {
    consent: {
      emailOptIn: customer.email_opt_in === 1,

      smsOptIn: customer.sms_opt_in === 1,

      whatsappOptIn: customer.whatsapp_opt_in === 1,

      reminderLanguage: customer.reminder_language,
    },

    email: customer.email,

    phone: customer.phone,

    whatsapp: customer.whatsapp,
  }
}

/** The row `queueReminderMessage` just wrote, read back by its spent key. */

function queuedId(tenantId: string, dedupeKey: string): string | null {
  return (
    get<{ id: string }>(
      `SELECT id FROM outbound_messages WHERE tenant_id = ? AND dedupe_key = ?`,

      tenantId,

      dedupeKey,
    )?.id ?? null
  )
}

/** Queues one document message across the tenant's live customer channels. */

async function queueDocumentMessage(
  context: EngineContext,

  tenantId: string,

  customer: DocumentContactRow,

  purpose: ReminderPurpose,

  dedupeKeyFor: (channel: MessageChannel) => string,

  base: RenderContext,

  nowIso: string,

  dispatch: boolean,
): Promise<number> {
  const language = resolveReminderLanguage(
    customer.reminder_language,

    context.settings.defaultLanguage,
  )

  const guards = guardsFor(customer)

  let queued = 0

  for (const channel of context.customerChannels) {
    const template = resolveEngineTemplate(
      tenantId,

      channel,

      purpose,

      language,
    )

    const dedupeKey = dedupeKeyFor(channel)

    const rendered = renderTemplate(template.body, base)

    const renderedSubject = renderTemplate(template.subject, base)

    const outcome = queueReminderMessage({
      tenantId,

      customerId: customer.id,

      bookingId: null,

      installmentId: null,

      purpose,

      channel,

      language,

      subject: renderedSubject.text,

      body: rendered.text,

      dedupeKey,

      scheduledFor: null,

      promisePaused: false,

      templateDisabled: template.disabled,

      guards,

      nowIso,
    })

    if (outcome !== "queued") continue

    queued += 1

    if (dispatch) {
      const id = queuedId(tenantId, dedupeKey)

      if (id) await deliverMessage(tenantId, id, nowIso)
    }
  }

  return queued
}

/**
 * The daily expiry pass for one tenant.
 *
 * Reads every customer document with a tracked expiry, and for each rung (60/30/7)
 * the file has just crossed, queues a `document_expiring` nudge once per channel.
 * Re-running the same day is a no-op: the dedupe key already has its row. A file
 * already past its date is left to the checklist's derived `expired` state — this
 * never stamps a status the expiry date does not support.
 */

export async function runDocumentExpiryScan(
  tenantId: string,

  nowIso: string,
): Promise<{ queued: number }> {
  const settings = getVerificationSettings(tenantId)

  const today = karachiParts(nowIso).date

  const docs = all<ExpiringDocRow>(
    `SELECT d.id, d.entity_id, d.title, d.checklist_key, d.expires_at
       FROM documents d
      WHERE d.tenant_id = ?
        AND d.entity_type = 'customer'
        AND d.expires_at IS NOT NULL
        AND substr(d.expires_at, 1, 10) >= ?`,

    tenantId,

    today,
  )

  const context = loadReminderSettings(tenantId)

  if (context.customerChannels.length === 0) return { queued: 0 }

  const contacts = new Map<string, DocumentContactRow | null>()

  let queued = 0

  for (const doc of docs) {
    const threshold = documentExpiryAlert(
      doc.expires_at,
      today,
      settings.expiryAlertDays,
    )

    if (threshold === null) continue

    let customer = contacts.get(doc.entity_id)

    if (customer === undefined) {
      customer = loadContact(tenantId, doc.entity_id)

      contacts.set(doc.entity_id, customer)
    }

    if (!customer) continue

    const base: RenderContext = {
      customer_name: customer.full_name,

      tenant_name: context.tenant.name,

      document_name: doc.title,

      expiry_date: doc.expires_at.slice(0, 10),
    }

    queued += await queueDocumentMessage(
      context,

      tenantId,

      customer,

      "document_expiring",

      (channel) => documentExpiringDedupeKey(doc.id, threshold, channel),

      base,

      nowIso,

      false,
    )
  }

  return { queued }
}

/** Scans every active tenant, each with its own policy and channels. */

export async function runDocumentExpiryScanAll(nowIso: string): Promise<void> {
  const tenants = all<{ id: string }>(
    `SELECT id FROM tenants WHERE status = 'active' ORDER BY id`,
  )

  for (const tenant of tenants) {
    await runDocumentExpiryScan(tenant.id, nowIso)
  }
}

export interface MissingReminderResult {
  customers: number

  queued: number
}

/**
 * Nudges a set of customers about the required papers they still owe.
 *
 * Only customers with at least one outstanding required slot are written to; a
 * customer already complete gets a quiet no-op rather than a "you're all done"
 * nag. The body lists the exact missing labels, so the customer learns *which*
 * paper, not just a count. Dispatched immediately — an officer asked for it.
 */

export async function sendMissingDocumentReminders(
  tenantId: string,

  customerIds: string[],

  nowIso: string = new Date().toISOString(),

  batch = "",
): Promise<MissingReminderResult> {
  const context = loadReminderSettings(tenantId)

  const today = karachiParts(nowIso).date

  let customers = 0

  let queued = 0

  for (const customerId of customerIds) {
    const checklist = buildDocumentChecklist(tenantId, customerId, today)

    if (!checklist) continue

    const missingLabels = checklist.entries

      .filter(
        (entry) =>
          entry.required && checklist.missingRequiredKeys.includes(entry.key),
      )

      .map((entry) => entry.label)

    if (missingLabels.length === 0) continue

    const customer = loadContact(tenantId, customerId)

    if (!customer) continue

    customers += 1

    const base: RenderContext = {
      customer_name: customer.full_name,

      tenant_name: context.tenant.name,

      missing_documents: `• ${missingLabels.join("\n• ")}`,
    }

    queued += await queueDocumentMessage(
      context,

      tenantId,

      customer,

      "document_upload_reminder",

      (channel) => documentUploadReminderDedupeKey(customerId, channel, batch),

      base,

      nowIso,

      true,
    )
  }

  return { customers, queued }
}

/**
 * Queues a single-document lifecycle notice (a rejection or a verification) to the
 * owning customer. Called from the verify / reject routes as a courtesy; `manual`
 * dispatches straight away, since a decision just happened in front of an officer.
 */

export async function sendDocumentDecisionMessage(
  tenantId: string,

  customerId: string,

  documentId: string,

  documentTitle: string,

  purpose: "document_rejected" | "document_verified",

  rejectReason: string | null,

  nowIso: string = new Date().toISOString(),
): Promise<void> {
  const context = loadReminderSettings(tenantId)

  const customer = loadContact(tenantId, customerId)

  if (!customer) return

  const base: RenderContext = {
    customer_name: customer.full_name,

    tenant_name: context.tenant.name,

    document_name: documentTitle,
  }

  if (purpose === "document_rejected" && rejectReason) {
    base.reject_reason = rejectReason
  }

  await queueDocumentMessage(
    context,

    tenantId,

    customer,

    purpose,

    (channel) => documentDecisionDedupe(documentId, purpose, channel),

    base,

    nowIso,

    true,
  )
}

function documentDecisionDedupe(
  documentId: string,

  purpose: "document_rejected" | "document_verified",

  channel: MessageChannel,
): string {
  return `docdec|${documentId}|${purpose}|${channel}`
}
