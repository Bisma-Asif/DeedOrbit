/**
 * The reminder engine — the real chase, written to the ledger before anything is sent.
 *
 * `runPaymentReminderCycle(nowIso, tenantId?)` is the whole product in one function:
 * it walks every unpaid instalment on a confirmed booking, asks the ladder which
 * rungs fall on today (Karachi), resolves the wording — stored template, shipped
 * default, the customer's own language — and queues a ledger row per purpose per
 * enabled channel. `INSERT OR IGNORE` on `UNIQUE (tenant_id, dedupe_key)` is the
 * entire no-duplicate guarantee: re-running yesterday's cycle, an hourly retry tick,
 * or a restarted server cannot produce a second message for the same rung, and a
 * schedule rebuilt with the same numbers still reads as fresh events because the
 * due date travels inside the key.
 *
 * Every guard writes a row rather than staying silent. A customer who opted out, a
 * line paused for a promise to pay, a channel switched off, an address that does not
 * exist — each produces an honest `skipped` row carrying its reason, once per dedupe
 * key, because "why was nobody told?" is a question the desk asks as often as "was
 * my customer chased?". Quiet hours are the one guard that waits instead of refusal:
 * a firing outside the sending window is queued with `scheduled_for` set to that
 * day's window-open instant and reads "Scheduled" on the ledger; if the window's
 * day passes untouched (the server was down), the hourly tick turns the row into
 * `skipped/quiet_hours` — the status flips when the window demonstrably passed, and
 * no duplicate can follow because the key is already spent.
 *
 * Dispatch is strictly after the queue committed and always fire-and-forget from
 * HTTP paths (`void sendPaymentReceivedConfirmation(...)`), mirroring the webhook
 * convention: a slow socket must never delay a payment response, and every error,
 * including one from the delivery plumbing itself, is captured into the row.
 *
 * The engine never composes a fact. Money comes from the instalment rows, the late
 * charge from the assessment ledger, the balance from the plan. `{pay_instructions}`
 * is substituted only when the workspace wrote its own words in settings; a token
 * with nothing honest behind it stays visibly unsubstituted, exactly as the
 * dry-run preview reports it.
 */

import {
  defaultTemplate,
  isMessageLanguage,
  isTemplateKey,
  renderTemplate,
  type MessageChannel,
  type MessageLanguage,
  type RenderContext,
  type TemplateKey,
} from "../../shared/communications.ts"

import {
  channelOptedIn,
  isReminderChannel,
  karachiParts,
  ladderDedupeKey,
  ladderFiringsOn,
  parseOffsetList,
  paymentReceivedDedupeKey,
  resolveReminderLanguage,
  withOptOutLine,
  type CustomerConsent,
  type ReminderChannel,
  type ReminderPurpose,
} from "../../shared/reminders.ts"

import { all, get, run } from "../db.ts"

import { newId } from "../crypto.ts"

import { notifyRecipients } from "../notify.ts"

import { deliverMessage } from "../messaging/dispatch.ts"

import { resolveRecipientAddress } from "../messaging/providers.ts"

/** Asia/Karachi is a fixed UTC+5 year-round — the window math needs no name lookup. */

const KARACHI_OFFSET_MS = 5 * 60 * 60 * 1000

/** The ledger's author. An automatic row says the engine sent it, not a person. */

const ENGINE_ACTOR_NAME = "Reminder engine"

// --- Public shapes ------------------------------------------------------------

export interface ReminderCandidate {
  tenant_id: string

  installment_id: string

  number: number

  due_date: string

  total: number

  paid_amount: number

  promise_to_pay_date: string | null

  collection_officer_user_id: string | null

  booking_id: string

  booking_reference: string

  unit_code: string

  customer_id: string

  customer_name: string

  email: string | null

  phone: string | null

  whatsapp: string | null

  email_opt_in: number

  sms_opt_in: number

  whatsapp_opt_in: number

  reminder_language: string | null

  project_name: string

  currency: string

  outstanding_balance: number
}

export interface CycleTenantReport {
  tenantId: string

  /** The Karachi date this pass served; null when the day was already done. */

  date: string | null

  queued: number

  dispatched: number

  sent: number

  failed: number

  skipped: number
}

export interface PendingDispatchReport {
  expired: number

  dispatched: number

  sent: number

  failed: number
}

/** A composed message waiting to be queued: wording resolved, guards evaluated. */

export interface ComposeResult {
  subject: string

  body: string

  language: MessageLanguage

  missingTokens: string[]

  deliverable: boolean

  blockReason: string | null
}

// --- Money and time helpers ----------------------------------------------------

/** Whole-major-unit money rendered the way a body reads it: "12,500 PKR". */

function formatMoney(amount: number, currency: string): string {
  const grouped = new Intl.NumberFormat("en-US").format(Math.round(amount))

  return currency ? `${grouped} ${currency}` : grouped
}

/** The instant a workspace's sending window opens on a Karachi date, as an ISO string. */

function windowOpenIso(date: string, hour: number): string {
  const midnightUtc = Date.parse(`${date.slice(0, 10)}T00:00:00Z`)

  const wallClock = hour * 60 * 60 * 1000 - KARACHI_OFFSET_MS

  return new Date(midnightUtc + wallClock).toISOString()
}

function truthyList(raw: string, order: "desc" | "asc"): number[] {
  const parsed = parseOffsetList(
    raw

      .split(",")

      .map((part) => Number(part.trim()))

      .filter((value) => Number.isFinite(value)),

    order,
  )

  return parsed ?? []
}

function channelList(raw: string): ReminderChannel[] {
  const seen = new Set<ReminderChannel>()

  const list: ReminderChannel[] = []

  for (const part of raw.split(",")) {
    const value = part.trim()

    if (isReminderChannel(value) && !seen.has(value)) {
      seen.add(value)

      list.push(value)
    }
  }

  return list
}

// --- Settings -------------------------------------------------------------------

export interface TenantIdentity {
  name: string

  currency: string
}

export interface ReminderSettingsRow {
  before_offsets: string

  late_offsets: string

  late_repeat_every_days: number

  escalation_after_days: number

  sending_window_start_hour: number

  sending_window_end_hour: number

  channels_enabled: string

  default_language: string

  pay_instructions: string

  last_run_date: string | null
}

export interface ResolvedSettings {
  beforeOffsets: number[]

  lateOffsets: number[]

  lateRepeatEveryDays: number

  escalationAfterDays: number

  sendingWindowStartHour: number

  sendingWindowEndHour: number

  channelsEnabled: ReminderChannel[]

  defaultLanguage: MessageLanguage

  payInstructions: string

  lastRunDate: string | null
}

export interface EngineContext {
  tenantId: string

  tenant: TenantIdentity

  settings: ResolvedSettings

  customerChannels: MessageChannel[]
}

function numberWithin(
  raw: number,
  min: number,
  max: number,
  fallback: number,
): number {
  return Number.isFinite(raw) && raw >= min && raw <= max ? raw : fallback
}

/**
 * The workspace's engine configuration, defaults filling any gap. A tenant with no
 * `reminder_settings` row simply runs the shipped ladder; nothing here writes.
 */

export function loadReminderSettings(tenantId: string): EngineContext {
  const tenant = get<TenantIdentity>(
    `SELECT name, currency FROM tenants WHERE id = ?`,

    tenantId,
  )

  const row = get<ReminderSettingsRow>(
    `SELECT before_offsets, late_offsets, late_repeat_every_days, escalation_after_days,
            sending_window_start_hour, sending_window_end_hour, channels_enabled,
            default_language, pay_instructions, last_run_date
       FROM reminder_settings WHERE tenant_id = ?`,

    tenantId,
  )

  const channelsEnabled = channelList(
    row?.channels_enabled ?? "email,sms,whatsapp,in_app",
  )

  const defaultLanguageRaw = row?.default_language

  const defaultLanguage: MessageLanguage = isMessageLanguage(defaultLanguageRaw)
    ? defaultLanguageRaw
    : "en"

  const payInstructionsRaw = row?.pay_instructions

  return {
    tenantId,

    tenant: {
      name: tenant?.name ?? "",

      currency: tenant?.currency ?? "PKR",
    },

    settings: {
      beforeOffsets: truthyList(row?.before_offsets ?? "7,3,1", "desc"),

      lateOffsets: truthyList(row?.late_offsets ?? "1,3,7", "asc"),

      lateRepeatEveryDays: numberWithin(
        row?.late_repeat_every_days ?? 7,
        1,
        60,
        7,
      ),

      escalationAfterDays: numberWithin(
        row?.escalation_after_days ?? 15,
        0,
        365,
        15,
      ),

      sendingWindowStartHour: numberWithin(
        row?.sending_window_start_hour ?? 9,

        0,

        23,

        9,
      ),

      sendingWindowEndHour: numberWithin(
        row?.sending_window_end_hour ?? 20,

        1,

        24,

        20,
      ),

      channelsEnabled,

      defaultLanguage,

      payInstructions: payInstructionsRaw?.trim() ?? "",

      lastRunDate: row?.last_run_date ?? null,
    },

    customerChannels: channelsEnabled.filter(
      (channel): channel is MessageChannel => channel !== "in_app",
    ),
  }
}

// --- Templates ---------------------------------------------------------------------

interface ResolvedTemplate {
  subject: string

  body: string

  disabled: boolean
}

/**
 * The wording for one (channel, purpose, language): stored subject/body with the
 * blank-subject fallback, the enabled switch, and the shipped default when the
 * workspace has no stored row at all.
 */

export function resolveEngineTemplate(
  tenantId: string,

  channel: MessageChannel,

  purpose: ReminderPurpose,

  language: MessageLanguage,
): ResolvedTemplate {
  const key: TemplateKey = isTemplateKey(purpose)
    ? purpose
    : "due_payment_reminder"

  const row = get<StoredTemplateRow>(
    `SELECT subject, body, enabled FROM message_templates
      WHERE tenant_id = ? AND channel = ? AND template_key = ? AND language = ?`,

    tenantId,

    channel,

    key,

    language,
  )

  const fallback = defaultTemplate(language, channel, key)

  return {
    subject: row?.subject?.trim() ? row.subject : fallback.subject,

    body: row?.body ?? fallback.body,

    disabled: row?.enabled === 0,
  }
}

/** A stored template row, exactly as `message_templates` holds it. */

interface StoredTemplateRow {
  subject: string

  body: string

  enabled: number
}

// --- Render context -----------------------------------------------------------------

/** The ladder position a render speaks from: how far before, or how many days late. */

interface DayOffsets {
  daysBeforeDue: number | null

  daysLate: number | null
}

/** Everything a ladder body can honestly speak from, straight off one candidate row. */

export function buildCandidateContext(
  candidate: ReminderCandidate,

  tenantName: string,

  payInstructions: string,

  firing: DayOffsets,
): RenderContext {
  const dueAmount = Math.max(0, candidate.total - candidate.paid_amount)

  const lateDays = firing.daysLate ?? 0

  const lateCharge =
    lateDays > 0
      ? Number(
          get<{ total: number }>(
            `SELECT COALESCE(SUM(amount), 0) AS total
               FROM late_fee_assessments
              WHERE tenant_id = ? AND installment_id = ? AND status <> 'waived'`,

            candidate.tenant_id,

            candidate.installment_id,
          )?.total ?? 0,
        )
      : 0

  const context: RenderContext = {
    customer_name: candidate.customer_name,

    tenant_name: tenantName,

    due_amount: formatMoney(dueAmount, candidate.currency),

    due_date: candidate.due_date,

    amount_paid: formatMoney(candidate.paid_amount, candidate.currency),

    outstanding_balance: formatMoney(
      candidate.outstanding_balance,
      candidate.currency,
    ),

    booking_reference: candidate.booking_reference,

    unit: candidate.unit_code,

    project: candidate.project_name,

    installment_no: String(candidate.number),
  }

  if (firing.daysBeforeDue !== null)
    context.days_before = String(firing.daysBeforeDue)

  if (lateDays > 0) {
    context.late_days = String(lateDays)

    context.late_charge = formatMoney(lateCharge, candidate.currency)
  }

  if (payInstructions !== "") context.pay_instructions = payInstructions

  return context
}

// --- Queue ---------------------------------------------------------------------------

/** The customer facts a guard must weigh before anything leaves the building. */

export interface GuardFacts {
  consent: CustomerConsent

  email: string | null

  phone: string | null

  whatsapp: string | null
}

export interface QueueMessageInput {
  tenantId: string

  customerId: string

  bookingId: string | null

  installmentId: string | null

  purpose: ReminderPurpose

  channel: MessageChannel

  language: MessageLanguage

  subject: string

  body: string

  dedupeKey: string

  scheduledFor: string | null

  /** Null when the ladder paused the line before this row was decided at all. */

  promisePaused: boolean

  templateDisabled: boolean

  guards: GuardFacts

  nowIso: string
}

export type QueueOutcome = "queued" | "existed" | "skipped"

function consentFor(candidate: ReminderCandidate): GuardFacts {
  return {
    consent: {
      emailOptIn: candidate.email_opt_in === 1,

      smsOptIn: candidate.sms_opt_in === 1,

      whatsappOptIn: candidate.whatsapp_opt_in === 1,

      reminderLanguage: candidate.reminder_language,
    },

    email: candidate.email,

    phone: candidate.phone,

    whatsapp: candidate.whatsapp,
  }
}

/**
 * Write the row the engine decided on. Guards run in the order the desk reads them:
 * the promise pause first (the officer took a call about this line), then the
 * template switch, then consent, then whether an address exists at all. A `queued`
 * row carries its body and, outside the window, the instant it is allowed to go; a
 * `skipped` row carries the reason and the same rendered body, because the preview
 * of a withheld message is what an officer weighs when they decide to send anyway.
 */

export function queueReminderMessage(input: QueueMessageInput): QueueOutcome {
  const existing = get<{ id: string }>(
    `SELECT id FROM outbound_messages WHERE tenant_id = ? AND dedupe_key = ?`,

    input.tenantId,

    input.dedupeKey,
  )

  if (existing) return "existed"

  let status: "queued" | "skipped" = "queued"

  let skipReason: string | null = null

  if (input.promisePaused) {
    status = "skipped"

    skipReason = "promise_paused"
  } else if (input.templateDisabled) {
    status = "skipped"

    skipReason = "template_disabled"
  } else if (!channelOptedIn(input.guards.consent, input.channel)) {
    status = "skipped"

    skipReason = "opt_out"
  } else if (
    resolveRecipientAddress(input.channel, {
      email: input.guards.email,

      phone: input.guards.phone,

      whatsapp: input.guards.whatsapp,
    }) === ""
  ) {
    status = "skipped"

    skipReason = "no_address"
  }

  run(
    `INSERT OR IGNORE INTO outbound_messages
       (id, tenant_id, customer_id, booking_id, installment_id, purpose, channel,
        language, to_address, subject, body, status, skip_reason, dedupe_key,
        provider, provider_message_id, error, attempts, scheduled_for, sent_at,
        created_at, recorded_by_user_id, recorded_by_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', '', NULL, 0, ?, NULL, ?, '', ?)`,

    newId("obm"),

    input.tenantId,

    input.customerId,

    input.bookingId,

    input.installmentId,

    input.purpose,

    input.channel,

    input.language,

    status === "skipped"
      ? ""
      : resolveRecipientAddress(input.channel, {
          email: input.guards.email,

          phone: input.guards.phone,

          whatsapp: input.guards.whatsapp,
        }),

    input.subject,

    withOptOutLine(input.body, input.purpose),

    status,

    skipReason,

    input.dedupeKey,

    input.scheduledFor ?? input.nowIso,

    input.nowIso,

    ENGINE_ACTOR_NAME,
  )

  if (status === "skipped") return "skipped"

  const stored = get<{ scheduled_for: string | null }>(
    `SELECT scheduled_for FROM outbound_messages
      WHERE tenant_id = ? AND dedupe_key = ?`,

    input.tenantId,

    input.dedupeKey,
  )

  if (!stored) return "existed"

  run(
    `UPDATE outbound_messages SET scheduled_for = ?
      WHERE tenant_id = ? AND dedupe_key = ?`,

    input.scheduledFor,

    input.tenantId,

    input.dedupeKey,
  )

  return "queued"
}

// --- The daily cycle ------------------------------------------------------------------

export function scanReminderCandidates(tenantId: string): ReminderCandidate[] {
  return all<ReminderCandidate>(
    `SELECT i.tenant_id AS tenant_id,
            i.id AS installment_id,
            i.number,
            i.due_date,
            i.total,
            i.paid_amount,
            i.promise_to_pay_date,
            i.collection_officer_user_id,
            b.id AS booking_id,
            b.reference AS booking_reference,
            b.unit_code,
            b.customer_id,
            c.full_name AS customer_name,
            c.email,
            c.phone,
            c.whatsapp,
            c.email_opt_in,
            c.sms_opt_in,
            c.whatsapp_opt_in,
            c.reminder_language,
            p.name AS project_name,
            pp.currency,
            (SELECT COALESCE(SUM(x.total - x.paid_amount), 0)
               FROM payment_installments x
              WHERE x.tenant_id = i.tenant_id
                AND x.booking_id = i.booking_id
                AND x.status <> 'paid') AS outstanding_balance
       FROM payment_installments i
       JOIN bookings      b  ON b.id  = i.booking_id  AND b.tenant_id  = i.tenant_id
       JOIN payment_plans pp ON pp.booking_id = b.id AND pp.tenant_id = i.tenant_id
       JOIN customers     c  ON c.id  = b.customer_id AND c.tenant_id  = i.tenant_id
       JOIN projects      p  ON p.id  = b.project_id  AND p.tenant_id  = i.tenant_id
      WHERE i.tenant_id = ?
        AND i.status <> 'paid'
        AND b.status = 'confirmed'
      ORDER BY i.due_date ASC, i.number ASC`,

    tenantId,
  )
}

interface EscalationInput {
  tenantId: string

  candidate: ReminderCandidate

  tenantName: string

  daysLate: number

  dueAmountText: string

  nowIso: string
}

/**
 * The internal alert: one `in_app` ledger row, then the fan-out. Recipients are the
 * officer assigned to the line, or every active recovery officer when nobody was
 * assigned — and when there is nobody to tell, the row says so as `failed` with
 * "no eligible recipients", because an escalation that died quietly is the one
 * outcome this ladder must not produce.
 */

function writeEscalation(
  input: EscalationInput,
): "sent" | "failed" | "skipped" {
  const dedupe = ladderDedupeKey(
    input.candidate.installment_id,

    "recovery_escalation",

    "in_app",

    "esc",

    input.candidate.due_date,
  )

  const existing = get<{ id: string }>(
    `SELECT id FROM outbound_messages WHERE tenant_id = ? AND dedupe_key = ?`,

    input.tenantId,

    dedupe,
  )

  if (existing) return "skipped"

  const messageId = newId("obm")

  const unit = input.candidate.unit_code || input.candidate.booking_reference

  const body = `Recovery escalation — ${input.candidate.customer_name} (${input.candidate.booking_reference}, ${unit}) is ${input.daysLate} days past the due date of ${input.candidate.due_date}. Outstanding on the instalment: ${input.dueAmountText}. Workspaces chase on a schedule; this one needs a call.`

  run(
    `INSERT OR IGNORE INTO outbound_messages
       (id, tenant_id, customer_id, booking_id, installment_id, purpose, channel,
        language, to_address, subject, body, status, dedupe_key,
        provider, provider_message_id, error, attempts, created_at,
        recorded_by_user_id, recorded_by_name)
     VALUES (?, ?, ?, ?, ?, 'recovery_escalation', 'in_app', 'en', '', '', ?, 'queued', ?, 'in_app', '', NULL, 0, ?, '', ?)`,

    messageId,

    input.tenantId,

    input.candidate.customer_id,

    input.candidate.booking_id,

    input.candidate.installment_id,

    body,

    dedupe,

    input.nowIso,

    ENGINE_ACTOR_NAME,
  )

  if (
    !get<{ id: string }>(
      `SELECT id FROM outbound_messages WHERE tenant_id = ? AND id = ?`,

      input.tenantId,

      messageId,
    )
  ) {
    return "skipped"
  }

  const assigned = input.candidate.collection_officer_user_id

  const recipients =
    assigned !== null && assigned !== ""
      ? [assigned]
      : all<{ id: string }>(
          `SELECT u.id
             FROM users u
             JOIN tenant_memberships m
               ON m.user_id = u.id AND m.tenant_id = u.tenant_id
            WHERE u.tenant_id = ? AND u.status = 'active' AND m.role_id = 'recovery_officer'
            ORDER BY u.full_name COLLATE NOCASE`,

          input.tenantId,
        ).map((row) => row.id)

  const written = notifyRecipients(input.tenantId, recipients, {
    type: "payment_escalation",

    title: `Escalation: ${input.candidate.customer_name} is ${input.daysLate} days overdue`,

    body: `Instalment ${input.candidate.number} of ${input.candidate.booking_reference} (${input.dueAmountText}) was due ${input.candidate.due_date}.`,

    linkPath: "/reminders",
  })

  const status = written > 0 ? "sent" : "failed"

  run(
    `UPDATE outbound_messages
        SET status = ?, error = ?, sent_at = ?
      WHERE tenant_id = ? AND id = ? AND status = 'queued'`,

    status,

    written > 0 ? null : "no eligible recipients",

    written > 0 ? input.nowIso : null,

    input.tenantId,

    messageId,
  )

  return status
}

/**
 * An escalation the promise pause held: one terminal `skipped` in-app row carrying
 * the reason, so the desk can read why nobody was alerted. Returns false when the
 * dedupe key was already spent (nothing to record twice).
 */

function writeSkippedEscalation(
  tenantId: string,

  candidate: ReminderCandidate,

  dedupeKey: string,

  body: string,

  nowIso: string,
): boolean {
  if (
    get<{ id: string }>(
      `SELECT id FROM outbound_messages WHERE tenant_id = ? AND dedupe_key = ?`,
      tenantId,

      dedupeKey,
    )
  ) {
    return false
  }

  run(
    `INSERT OR IGNORE INTO outbound_messages
       (id, tenant_id, customer_id, booking_id, installment_id, purpose, channel,
        language, to_address, subject, body, status, skip_reason, dedupe_key,
        provider, provider_message_id, error, attempts, created_at,
        recorded_by_user_id, recorded_by_name)
     VALUES (?, ?, ?, ?, ?, 'recovery_escalation', 'in_app', 'en', '', '', ?, 'skipped', 'promise_paused', ?, 'in_app', '', NULL, 0, ?, '', ?)`,
    newId("obm"),

    tenantId,

    candidate.customer_id,

    candidate.booking_id,

    candidate.installment_id,

    body,

    dedupeKey,

    nowIso,

    ENGINE_ACTOR_NAME,
  )

  return true
}

/**
 * One daily pass for one tenant: the ladder over every live instalment line.
 *
 * `nowIso` is a parameter, not a clock read — a test that wants to know what fires
 * on the 14th simply passes the 14th. The pass is idempotent: every queue goes
 * through the dedupe key, so running it twice a day, after a crash, or on a
 * restarted server adds nothing. Rows are scheduled at the day's window-open
 * instant and dispatched here directly only while the window is actually open.
 */

export async function runPaymentReminderCycleForTenant(
  nowIso: string,

  tenantId: string,
): Promise<CycleTenantReport> {
  const context = loadReminderSettings(tenantId)

  const today = karachiParts(nowIso).date

  const report: CycleTenantReport = {
    tenantId,

    date: today,

    queued: 0,

    dispatched: 0,

    sent: 0,

    failed: 0,

    skipped: 0,
  }

  const inWindow = withinWindow(nowIso, context)

  const candidates = scanReminderCandidates(tenantId)

  for (const candidate of candidates) {
    const firings = ladderFiringsOn(candidate.due_date, today, context.settings)

    if (firings.length === 0) continue

    const language = resolveReminderLanguage(
      candidate.reminder_language,

      context.settings.defaultLanguage,
    )

    const guards = consentFor(candidate)

    const promisePaused =
      candidate.promise_to_pay_date !== null &&
      candidate.promise_to_pay_date > today

    for (const firing of firings) {
      if (firing.purpose === "recovery_escalation") {
        if (!context.settings.channelsEnabled.includes("in_app")) continue

        if (promisePaused) {
          const dedupe = ladderDedupeKey(
            candidate.installment_id,

            "recovery_escalation",

            "in_app",

            firing.tag,

            candidate.due_date,
          )

          if (
            writeSkippedEscalation(
              tenantId,
              candidate,
              dedupe,
              `Escalation withheld: ${candidate.customer_name} promised to pay by ${candidate.promise_to_pay_date}.`,
              nowIso,
            )
          ) {
            report.skipped += 1
          }
        } else {
          const dueAmount = Math.max(0, candidate.total - candidate.paid_amount)

          const result = writeEscalation({
            tenantId,

            candidate,

            tenantName: context.tenant.name,

            daysLate: firing.daysLate ?? 0,

            dueAmountText: formatMoney(dueAmount, candidate.currency),

            nowIso,
          })

          if (result === "sent") report.sent += 1
          else if (result === "failed") report.failed += 1
          else report.skipped += 1
        }

        continue
      }

      const customerChannels = context.customerChannels

      if (customerChannels.length === 0) continue

      for (const channel of customerChannels) {
        const template = resolveEngineTemplate(
          tenantId,
          channel,
          firing.purpose,
          language,
        )

        const renderContext = buildCandidateContext(
          candidate,

          context.tenant.name,

          context.settings.payInstructions,

          firing,
        )

        const rendered = renderTemplate(template.body, renderContext)

        const renderedSubject = renderTemplate(template.subject, renderContext)

        const scheduledFor = inWindow
          ? null
          : windowOpenIso(today, context.settings.sendingWindowStartHour)

        const outcome = queueReminderMessage({
          tenantId,

          customerId: candidate.customer_id,

          bookingId: candidate.booking_id,

          installmentId: candidate.installment_id,

          purpose: firing.purpose,

          channel,

          language,

          subject: renderedSubject.text,

          body: rendered.text,

          dedupeKey: ladderDedupeKey(
            candidate.installment_id,

            firing.purpose,

            channel,

            firing.tag,

            candidate.due_date,
          ),

          scheduledFor,

          promisePaused,

          templateDisabled: template.disabled,

          guards,

          nowIso,
        })

        if (outcome === "existed") continue

        report.queued += 1

        if (outcome === "skipped") {
          report.skipped += 1

          continue
        }

        if (inWindow) {
          const dedupe = ladderDedupeKey(
            candidate.installment_id,

            firing.purpose,

            channel,

            firing.tag,

            candidate.due_date,
          )

          const delivered = await deliverMessage(
            tenantId,

            queuedId(tenantId, dedupe),

            nowIso,
          )

          report.dispatched += 1

          if (delivered === "sent") report.sent += 1
          else if (delivered === "failed") report.failed += 1
        }
      }
    }
  }

  run(
    `UPDATE reminder_settings SET last_run_date = ? WHERE tenant_id = ?`,

    today,

    tenantId,
  )

  return report
}

/** The row `queueReminderMessage` just wrote, read back by its spent key. */

function queuedId(tenantId: string, dedupeKey: string): string {
  return (
    get<{ id: string }>(
      `SELECT id FROM outbound_messages WHERE tenant_id = ? AND dedupe_key = ?`,

      tenantId,

      dedupeKey,
    )?.id ?? ""
  )
}

function withinWindow(nowIso: string, context: EngineContext): boolean {
  const { hour } = karachiParts(nowIso)

  return (
    hour >= context.settings.sendingWindowStartHour &&
    hour < context.settings.sendingWindowEndHour
  )
}

/**
 * The scheduler's entry point: the daily cycle for every live workspace, once per
 * tenant per Karachi day. The day gate belongs to the caller that stores
 * `last_run_date` semantics; the function itself always scans, because its writes
 * are idempotent and a test that re-runs a day must see nothing new rather than an
 * error.
 */

export async function runPaymentReminderCycle(
  nowIso: string,

  tenantId?: string,
): Promise<CycleTenantReport[]> {
  const tenantIds =
    tenantId !== undefined
      ? [tenantId]
      : all<{ id: string }>(
          `SELECT id FROM tenants WHERE status = 'active' ORDER BY id`,
        ).map((row) => row.id)

  const reports: CycleTenantReport[] = []

  for (const id of tenantIds) {
    reports.push(await runPaymentReminderCycleForTenant(nowIso, id))
  }

  return reports
}

/**
 * The hourly tick. Dispatches rows whose schedule has arrived while the window is
 * open, and expires rows whose scheduled day has passed — the window demonstrably
 * went by, so the honest record is `skipped/quiet_hours`, not a message that lands
 * at 3 a.m. the next day. Failed rows are deliberately not retried here: a retry
 * is an officer's explicit act on the Reminders page.
 */

export async function dispatchPendingReminders(
  nowIso: string,

  tenantId?: string,
): Promise<PendingDispatchReport> {
  const report: PendingDispatchReport = {
    expired: 0,

    dispatched: 0,

    sent: 0,

    failed: 0,
  }

  const today = karachiParts(nowIso).date

  const stale = all<OutboundRef>(
    `SELECT id, tenant_id FROM outbound_messages
      WHERE status = 'queued' AND scheduled_for IS NOT NULL
        AND substr(scheduled_for, 1, 10) < ?
        AND (? IS NULL OR tenant_id = ?)`,

    today,

    tenantId ?? null,

    tenantId ?? null,
  )

  for (const row of stale) {
    const flipped = flipStaleToSkipped(row, nowIso)

    if (flipped) report.expired += 1
  }

  const contexts = new Map<string, EngineContext>()

  const due = all<OutboundRef>(
    `SELECT id, tenant_id FROM outbound_messages
      WHERE status = 'queued' AND channel <> 'in_app'
        AND (scheduled_for IS NULL OR scheduled_for <= ?)
        AND (? IS NULL OR tenant_id = ?)
      ORDER BY created_at ASC, id ASC`,

    nowIso,

    tenantId ?? null,

    tenantId ?? null,
  )

  for (const row of due) {
    let context = contexts.get(row.tenant_id)

    if (!context) {
      context = loadReminderSettings(row.tenant_id)

      contexts.set(row.tenant_id, context)
    }

    if (!withinWindow(nowIso, context)) continue

    const delivered = await deliverMessage(row.tenant_id, row.id, nowIso)

    report.dispatched += 1

    if (delivered === "sent") report.sent += 1
    else if (delivered === "failed") report.failed += 1
  }

  return report
}

interface OutboundRef {
  id: string

  tenant_id: string
}

function flipStaleToSkipped(row: OutboundRef, nowIso: string): boolean {
  const before = get<{ status: string }>(
    `SELECT status FROM outbound_messages WHERE tenant_id = ? AND id = ?`,

    row.tenant_id,

    row.id,
  )

  if (before?.status !== "queued") return false

  run(
    `UPDATE outbound_messages
        SET status = 'skipped', skip_reason = 'quiet_hours', scheduled_for = ?
      WHERE tenant_id = ? AND id = ? AND status = 'queued'`,

    nowIso,

    row.tenant_id,

    row.id,
  )

  return true
}

// --- Payment received ------------------------------------------------------------

interface PaymentReminderRow {
  id: string

  customer_id: string

  booking_id: string | null

  amount: number

  receipt_number: string | null

  received_at: string
}

interface CustomerContactRow {
  full_name: string

  email: string | null

  phone: string | null

  whatsapp: string | null

  email_opt_in: number

  sms_opt_in: number

  whatsapp_opt_in: number

  reminder_language: string | null
}

/**
 * The thank-you that follows money, not the calendar: queued and dispatched right
 * after the payment commits, deliberately outside the sending window — a receipt
 * confirmation arriving moments after a payment is a courtesy at any hour, which
 * is what the webhook-style confirmation is for. One row per enabled customer
 * channel, keyed `received|{paymentId}|{channel}`, so a replayed request or a
 * restarted server can never double-announce a receipt. Every guard still writes
 * its honest skipped row, and nothing here may ever throw at the payment path —
 * callers use `void`, and the outer catch keeps a stray throw from escaping the
 * fire-and-forget promise itself.
 */

export async function sendPaymentReceivedConfirmation(
  tenantId: string,

  paymentId: string,
): Promise<void> {
  try {
    const context = loadReminderSettings(tenantId)

    const payment = get<PaymentReminderRow>(
      `SELECT id, customer_id, booking_id, amount, receipt_number, received_at
         FROM payments WHERE tenant_id = ? AND id = ?`,

      tenantId,

      paymentId,
    )

    if (!payment) return

    const customer = get<CustomerContactRow>(
      `SELECT full_name, email, phone, whatsapp, email_opt_in, sms_opt_in,
              whatsapp_opt_in, reminder_language
         FROM customers WHERE tenant_id = ? AND id = ?`,

      tenantId,

      payment.customer_id,
    )

    if (!customer) return

    const outstanding =
      get<{ total: number }>(
        `SELECT COALESCE(SUM(x.total - x.paid_amount), 0) AS total
           FROM payment_installments x
           JOIN bookings b ON b.id = x.booking_id AND b.tenant_id = x.tenant_id
          WHERE x.tenant_id = ? AND b.customer_id = ? AND b.status = 'confirmed'
            AND x.status <> 'paid'`,

        tenantId,

        payment.customer_id,
      )?.total ?? 0

    const booking =
      payment.booking_id === null
        ? undefined
        : get<{
            reference: string

            unit_code: string

            project_name: string

            plan_currency: string
          }>(
            `SELECT b.reference, b.unit_code, p.name AS project_name, pp.currency AS plan_currency
             FROM bookings b
             LEFT JOIN projects p ON p.id = b.project_id AND p.tenant_id = b.tenant_id
             LEFT JOIN payment_plans pp ON pp.booking_id = b.id AND pp.tenant_id = b.tenant_id
            WHERE b.tenant_id = ? AND b.id = ?`,

            tenantId,

            payment.booking_id,
          )

    const currency = booking?.plan_currency ?? context.tenant.currency

    const language = resolveReminderLanguage(
      customer.reminder_language,

      context.settings.defaultLanguage,
    )

    const guards: GuardFacts = {
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

    const base: RenderContext = {
      customer_name: customer.full_name,

      tenant_name: context.tenant.name,

      amount_paid: formatMoney(payment.amount, currency),

      outstanding_balance: formatMoney(outstanding, currency),

      booking_reference: booking?.reference ?? null,

      unit: booking?.unit_code ?? null,

      project: booking?.project_name ?? null,

      receipt_number: payment.receipt_number,
    }

    if (context.settings.payInstructions !== "") {
      base.pay_instructions = context.settings.payInstructions
    }

    const nowIso = new Date().toISOString()

    for (const channel of context.customerChannels) {
      const template = resolveEngineTemplate(
        tenantId,

        channel,

        "payment_received",

        language,
      )

      const rendered = renderTemplate(template.body, base)

      const renderedSubject = renderTemplate(template.subject, base)

      const outcome = queueReminderMessage({
        tenantId,

        customerId: payment.customer_id,

        bookingId: payment.booking_id,

        installmentId: null,

        purpose: "payment_received",

        channel,

        language,

        subject: renderedSubject.text,

        body: rendered.text,

        dedupeKey: paymentReceivedDedupeKey(paymentId, channel),

        scheduledFor: null,

        promisePaused: false,

        templateDisabled: template.disabled,

        guards,

        nowIso,
      })

      if (outcome !== "queued") continue

      const dedupe = paymentReceivedDedupeKey(paymentId, channel)

      await deliverMessage(tenantId, queuedId(tenantId, dedupe), nowIso)
    }
  } catch {
    // A confirmation that fails is already, or will be, an error row in the
    // ledger; the payment itself succeeded and the caller has moved on.
  }
}

// --- Scheduler --------------------------------------------------------------

interface SchedulerTenantRow {
  id: string

  last_run_date: string | null
}

/**
 * One scheduler tick. The daily ladder pass runs for a workspace only once its
 * Karachi date has advanced past `reminder_settings.last_run_date` — that gives
 * daily semantics — while an hourly tick still catches up a workspace whose
 * process was down when the day turned. Every tick then dispatches rows whose
 * schedule has arrived and expires those whose window demonstrably passed. The
 * whole thing is safe to call as often as you like: the dedupe keys make the scan
 * idempotent, and dispatch only ever moves a `queued` row forward.
 */

export async function runReminderTick(nowIso: string): Promise<void> {
  const today = karachiParts(nowIso).date

  const tenants = all<SchedulerTenantRow>(
    `SELECT t.id, rs.last_run_date
       FROM tenants t
       LEFT JOIN reminder_settings rs ON rs.tenant_id = t.id
      WHERE t.status = 'active'
      ORDER BY t.id`,
  )

  for (const tenant of tenants) {
    if (tenant.last_run_date === today) continue

    await runPaymentReminderCycleForTenant(nowIso, tenant.id)
  }

  await dispatchPendingReminders(nowIso)
}
