/**
 * The reminder engine's vocabulary — shared by the job, the routes, and the screens.
 *
 * This file owns the ladder: which moment of a schedule earns which message, how a
 * firing is named so the ledger can refuse its duplicate, and when a workspace's
 * sending window says day or night. It decides nothing about money — an instalment
 * is unpaid because the payment trail says so, and only a recorded payment stops the
 * chase. It also decides nothing about truth of delivery: a row is `sent` only when
 * a provider accepted the message, and a provider that is not connected says so in
 * the ledger rather than leaving it blank.
 *
 * Every guard the engine honours — opt-out, promise pause, quiet hours, switched-off
 * channel — produces an honest `skipped` row with its reason, never silence. "Why
 * was nobody told?" is a question the desk asks as often as "was my customer chased?"
 * and both deserve a readable answer.
 */

import {
  isMessageChannel,
  isMessageLanguage,
  MESSAGE_CHANNEL_LABELS,
  type MessageChannel,
  type MessageLanguage,
} from "./communications.ts"

// --- Purposes ---------------------------------------------------------------

/**
 * Everything the ledger can hold a row for. The first four are template purposes
 * with editable wording; `recovery_escalation` is the internal alert to the chasing
 * desk, and `manual` is an officer's deliberate "Send now", which belongs to no
 * ladder rung and never blocks one.
 */

export const REMINDER_PURPOSES = [
  "due_payment_reminder",

  "payment_due_today",

  "payment_overdue",

  "payment_received",

  "recovery_escalation",

  "document_upload_reminder",

  "document_rejected",

  "document_expiring",

  "document_verified",

  "manual",
] as const

export type ReminderPurpose = typeof REMINDER_PURPOSES[number]

export const REMINDER_PURPOSE_LABELS: Record<ReminderPurpose, string> = {
  due_payment_reminder: "Due reminder",

  payment_due_today: "Due today",

  payment_overdue: "Overdue notice",

  payment_received: "Payment received",

  recovery_escalation: "Recovery escalation",

  document_upload_reminder: "Documents outstanding",

  document_rejected: "Document returned",

  document_expiring: "Document expiring",

  document_verified: "Document verified",

  manual: "Manual send",
}

export function isReminderPurpose(value: unknown): value is ReminderPurpose {
  return (
    typeof value === "string" &&
    (REMINDER_PURPOSES as readonly string[]).includes(value)
  )
}

// --- Channels ---------------------------------------------------------------

/**
 * The channels the engine can queue onto. `in_app` is a staff notification (it never
 * carries a customer template); the three customer channels are exactly the
 * `MessageChannel` the template catalogue knows.
 */

export const REMINDER_CHANNELS = [
  "email",

  "sms",

  "whatsapp",

  "in_app",
] as const

export type ReminderChannel = typeof REMINDER_CHANNELS[number]

export const REMINDER_CHANNEL_LABELS: Record<ReminderChannel, string> = {
  email: MESSAGE_CHANNEL_LABELS.email,

  sms: MESSAGE_CHANNEL_LABELS.sms,

  whatsapp: MESSAGE_CHANNEL_LABELS.whatsapp,

  in_app: "In-app",
}

export function isReminderChannel(value: unknown): value is ReminderChannel {
  return (
    typeof value === "string" &&
    (REMINDER_CHANNELS as readonly string[]).includes(value)
  )
}

export function isCustomerChannel(
  value: ReminderChannel,
): value is MessageChannel {
  return isMessageChannel(value)
}

// --- Ledger status ----------------------------------------------------------

export const OUTBOUND_STATUSES = [
  "queued",

  "sent",

  "failed",

  "skipped",
] as const

export type OutboundStatus = typeof OUTBOUND_STATUSES[number]

export const OUTBOUND_STATUS_LABELS: Record<OutboundStatus, string> = {
  queued: "Scheduled",

  sent: "Sent",

  failed: "Failed",

  skipped: "Skipped",
}

export function isOutboundStatus(value: unknown): value is OutboundStatus {
  return (
    typeof value === "string" &&
    (OUTBOUND_STATUSES as readonly string[]).includes(value)
  )
}

/** Every reason a decided message was withheld, each one readable on the ledger. */

export const SKIP_REASONS = [
  "opt_out",

  "quiet_hours",

  "promise_paused",

  "channel_disabled",

  "no_address",

  "template_disabled",

  "booking_cancelled",
] as const

export type SkipReason = typeof SKIP_REASONS[number]

export const SKIP_REASON_LABELS: Record<SkipReason, string> = {
  opt_out: "Customer opted out",

  quiet_hours: "Outside sending hours",

  promise_paused: "Paused for a promise to pay",

  channel_disabled: "Channel switched off",

  no_address: "No address on file",

  template_disabled: "Template disabled",

  booking_cancelled: "Booking cancelled",
}

export function isSkipReason(value: unknown): value is SkipReason {
  return (
    typeof value === "string" &&
    (SKIP_REASONS as readonly string[]).includes(value)
  )
}

// --- Per-tenant settings ----------------------------------------------------

export const OFFSET_LIST_MIN = 1

export const OFFSET_LIST_MAX = 365

export const REPEAT_EVERY_MIN = 1

export const REPEAT_EVERY_MAX = 60

export const ESCALATION_DAYS_MAX = 365

export const PAY_INSTRUCTIONS_MAX = 500

export const HOUR_MIN = 0

export const HOUR_MAX = 24

/** What the settings panel reads: the ladder as typed lists of whole days. */

export interface ReminderSettingsView {
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

  updatedAt: string | null

  canEdit: boolean
}

/** What the settings panel may send: every key optional, absent leaves the value. */

export interface ReminderSettingsInput {
  beforeOffsets?: number[]

  lateOffsets?: number[]

  lateRepeatEveryDays?: number

  escalationAfterDays?: number

  sendingWindowStartHour?: number

  sendingWindowEndHour?: number

  channelsEnabled?: ReminderChannel[]

  defaultLanguage?: MessageLanguage

  payInstructions?: string
}

/**
 * The shipped ladder: courtesy at 7, 3 and 1 days before, the day itself, the chase
 * at 1, 3 and 7 late days repeating weekly, and an officer alert from day 15 — the
 * shape the desk asked for, editable per workspace, never hard-coded into the engine.
 */

export const DEFAULT_REMINDER_SETTINGS: {
  beforeOffsets: number[]

  lateOffsets: number[]

  lateRepeatEveryDays: number

  escalationAfterDays: number

  sendingWindowStartHour: number

  sendingWindowEndHour: number

  channelsEnabled: ReminderChannel[]

  defaultLanguage: MessageLanguage

  payInstructions: string
} = {
  beforeOffsets: [7, 3, 1],

  lateOffsets: [1, 3, 7],

  lateRepeatEveryDays: 7,

  escalationAfterDays: 15,

  sendingWindowStartHour: 9,

  sendingWindowEndHour: 20,

  channelsEnabled: ["email", "sms", "whatsapp", "in_app"],

  defaultLanguage: "en",

  payInstructions: "",
}

/**
 * A typed day list, normalised or rejected.
 *
 * Values must be whole, within range, and unique; the sort direction is whatever
 * reads naturally for the list's role (descending for "days before", ascending for
 * "days late"). Anything else returns null and the route turns it into a field
 * error — a mistyped `7,,3` is the officer's to notice, not the engine's to guess.
 */

export function parseOffsetList(
  raw: unknown,

  order: "desc" | "asc",
): number[] | null {
  if (!Array.isArray(raw)) return null

  const seen = new Set<number>()

  for (const value of raw) {
    if (
      typeof value !== "number" ||
      !Number.isInteger(value) ||
      value < OFFSET_LIST_MIN ||
      value > OFFSET_LIST_MAX
    ) {
      return null
    }

    if (seen.has(value)) return null

    seen.add(value)
  }

  return order === "desc"
    ? raw.sort((a, b) => b - a)
    : raw.sort((a, b) => a - b)
}

// --- The ladder itself ------------------------------------------------------

/**
 * One firing of the ladder for one instalment line.
 *
 * `tag` names the rung within the schedule (`b7` = 7 days before, `due`, `l3` = 3
 * days late, `esc`): it is part of the dedupe key, so the same rung of the same
 * line can be queued exactly once, and a re-run or a retry can never send it twice.
 */

export interface LadderFiring {
  purpose: ReminderPurpose

  tag: string

  daysBeforeDue: number | null

  daysLate: number | null
}

/** Whole days from `a` to `b` on `YYYY-MM-DD` dates; negative when `b` has passed. */

export function daysBetweenDates(a: string, b: string): number {
  const from = new Date(`${a.slice(0, 10)}T00:00:00Z`).getTime()

  const to = new Date(`${b.slice(0, 10)}T00:00:00Z`).getTime()

  if (Number.isNaN(from) || Number.isNaN(to)) return 0

  return Math.round((to - from) / 86400000)
}

/** The `YYYY-MM-DD` a given number of days from an ISO date instant. */

export function shiftDate(iso: string, days: number): string {
  const base = new Date(`${iso.slice(0, 10)}T00:00:00Z`).getTime()

  const shifted = Number.isNaN(base) ? Date.now() : base + days * 86400000

  return new Date(shifted).toISOString().slice(0, 10)
}

/**
 * Which rungs of the ladder fall on `today` for one unpaid instalment due `dueDate`.
 *
 * Pure and parameterised by the date: simulating "what fires on the 14th" is calling
 * this, and the tests do exactly that. The late ladder repeats every configured
 * interval past the last explicit mark — including forever, because "until paid" is
 * what the desk asked for and stopping the chase is a recorded payment or a
 * cancellation, never the calendar. A ladder the admin emptied simply stops firing;
 * escalation at day N is independent of it and still fires once.
 */

export function ladderFiringsOn(
  dueDate: string,

  today: string,

  settings: {
    beforeOffsets: number[]

    lateOffsets: number[]

    lateRepeatEveryDays: number

    escalationAfterDays: number
  },
): LadderFiring[] {
  const firings: LadderFiring[] = []

  for (const offset of settings.beforeOffsets) {
    if (shiftDate(dueDate, -offset) === today) {
      firings.push({
        purpose: "due_payment_reminder",

        tag: `b${offset}`,

        daysBeforeDue: offset,

        daysLate: null,
      })
    }
  }

  if (dueDate === today) {
    firings.push({
      purpose: "payment_due_today",

      tag: "due",

      daysBeforeDue: 0,

      daysLate: 0,
    })
  }

  const lateDays = -daysBetweenDates(today, dueDate)

  if (lateDays <= 0) return firings

  const explicit = settings.lateOffsets.includes(lateDays)

  const lastMark = settings.lateOffsets.reduce(
    (max, offset) => (offset > max ? offset : max),

    0,
  )

  const inRepeat =
    lastMark > 0 &&
    lateDays > lastMark &&
    settings.lateRepeatEveryDays > 0 &&
    (lateDays - lastMark) % settings.lateRepeatEveryDays === 0

  if (explicit || inRepeat) {
    firings.push({
      purpose: "payment_overdue",

      tag: `l${lateDays}`,

      daysBeforeDue: null,

      daysLate: lateDays,
    })
  }

  if (
    settings.escalationAfterDays > 0 &&
    lateDays === settings.escalationAfterDays
  ) {
    firings.push({
      purpose: "recovery_escalation",

      tag: "esc",

      daysBeforeDue: null,

      daysLate: lateDays,
    })
  }

  return firings
}

// --- Dedupe keys --------------------------------------------------------------

/**
 * The ledger's uniqueness material. Every shape carries the instalment id so one
 * line's messages can never swallow another's, the channel so a workspace that
 * runs three of them gets one row per rung per channel, and the due date so a
 * schedule rebuilt with the same numbers still reads as fresh events.
 */

export function ladderDedupeKey(
  installmentId: string,

  purpose: ReminderPurpose,

  channel: ReminderChannel,

  tag: string,

  dueDate: string,
): string {
  return `auto|${installmentId}|${purpose}|${channel}|${tag}|${dueDate}`
}

/** One confirmation per recorded payment and channel, minted from the payment's own id. */

export function paymentReceivedDedupeKey(
  paymentId: string,

  channel: ReminderChannel,
): string {
  return `received|${paymentId}|${channel}`
}

/** A deliberate manual send carries its own row id — it is never a duplicate of an auto row. */

export function manualDedupeKey(messageId: string): string {
  return `manual|${messageId}`
}

// --- Document lifecycle dedupe keys ------------------------------------------

/**
 * One expiry nudge per (document, threshold, channel).
 *
 * The threshold is baked into the key so the 60-day, 30-day, and 7-day rungs are
 * three distinct events, and a re-run of the daily scan on the same day cannot
 * duplicate the rung already written.
 */

export function documentExpiringDedupeKey(
  documentId: string,

  threshold: number,

  channel: ReminderChannel,
): string {
  return `docexp|${documentId}|${threshold}|${channel}`
}

/**
 * One courtesy per decision per channel, minted from the document's own id and
 * the purpose, so a re-verification of the same file on a later day (a renewed
 * CNIC) reads as a fresh event rather than being swallowed by the earlier row.
 */

export function documentDecisionDedupeKey(
  documentId: string,

  purpose: ReminderPurpose,

  channel: ReminderChannel,
): string {
  return `docdec|${documentId}|${purpose}|${channel}`
}

/**
 * The outstanding-documents nudge, keyed by customer and channel.
 *
 * `batch` lets an officer's explicit bulk trigger write a fresh row each time
 * (pass a run token), while a scheduled pass leaves it blank so it stays
 * idempotent day to day and only speaks once per channel.
 */

export function documentUploadReminderDedupeKey(
  customerId: string,

  channel: ReminderChannel,

  batch: string,
): string {
  return batch === ""
    ? `docupload|${customerId}|${channel}`
    : `docupload|${customerId}|${channel}|${batch}`
}

// --- Language, consent, window -----------------------------------------------

/** The customer's chosen language, or the tenant default when they never chose. */

export function resolveReminderLanguage(
  customerLanguage: string | null | undefined,

  tenantDefault: MessageLanguage,
): MessageLanguage {
  return isMessageLanguage(customerLanguage) ? customerLanguage : tenantDefault
}

/**
 * Pakistan runs a fixed UTC+5 year-round — no DST anywhere to model — so the
 * sending window is arithmetic, not a timezone database.
 */

const KARACHI_OFFSET_MS = 5 * 60 * 60 * 1000

export interface KarachiParts {
  date: string

  hour: number
}

export function karachiParts(nowIso: string): KarachiParts {
  const ms = new Date(nowIso).getTime()

  const shifted = new Date(
    Number.isNaN(ms) ? Date.now() + KARACHI_OFFSET_MS : ms + KARACHI_OFFSET_MS,
  )

  return {
    date: shifted.toISOString().slice(0, 10),

    hour: shifted.getUTCHours(),
  }
}

/** At or after the start hour, strictly before the end hour (end 24 = all day). */

export function withinSendingWindow(
  nowIso: string,

  startHour: number,

  endHour: number,
): boolean {
  const { hour } = karachiParts(nowIso)

  return hour >= startHour && hour < endHour
}

/** The consent row the engine reads before queuing anything to a customer. */

export interface CustomerConsent {
  emailOptIn: boolean

  smsOptIn: boolean

  whatsappOptIn: boolean

  reminderLanguage: string | null
}

export function channelOptedIn(
  consent: CustomerConsent,

  channel: MessageChannel,
): boolean {
  if (channel === "email") return consent.emailOptIn

  return channel === "sms" ? consent.smsOptIn : consent.whatsappOptIn
}

// --- Ledger and control views --------------------------------------------------

export interface OutboundMessageView {
  id: string

  customerId: string

  customerName: string

  bookingId: string | null

  bookingReference: string | null

  installmentId: string | null

  installmentNumber: number | null

  purpose: ReminderPurpose

  purposeLabel: string

  channel: MessageChannel

  channelLabel: string

  language: MessageLanguage

  languageLabel: string

  toAddress: string

  subject: string

  body: string

  status: OutboundStatus

  statusLabel: string

  skipReason: SkipReason | null

  skipReasonLabel: string | null

  provider: string

  error: string | null

  attempts: number

  scheduledFor: string | null

  sentAt: string | null

  createdAt: string

  recordedByName: string
}

export interface OutboundMessageListResponse {
  messages: OutboundMessageView[]

  total: number

  limit: number

  truncated: boolean
}

/** What the reminders page and the dashboard card answer in one read. */

export interface ReminderDashboardSummary {
  /** Ladder rungs already queued for future days — the schedule seen as counts. */

  scheduled: number

  sentToday: number

  failedToday: number

  /** Failed rows still awaiting a retry; failures older than today keep counting here. */

  failedOpen: number

  skippedToday: number

  /** Overdue lines currently held by a promise to pay that has not yet come due. */

  promisesPending: number
}

/** A rendered message the officer looks at before choosing to send it. */

export interface ReminderPreviewResponse {
  purpose: ReminderPurpose

  channel: MessageChannel

  language: MessageLanguage

  toAddress: string

  subject: string

  body: string

  missingTokens: string[]

  /** False when a guard (opt-out, no address, channel off) would withhold it. */

  deliverable: boolean

  blockReason: string | null
}

export interface SendReminderInput {
  customerId: string

  installmentId?: string

  purpose: ReminderPurpose

  channel: MessageChannel

  language?: MessageLanguage
}

/** Body an officer types in the send-now dialog instead of the template's words. */

export const MANUAL_MESSAGE_MAX = 2000

/**
 * The line every customer-facing message ends with, appended at queue time so
 * the ledger stores exactly the text that goes out. An internal alert to the
 * recovery desk carries no such line — it is not a subscription the desk
 * opted into. Consent to *receive* is the opt-in switches; this line is how a
 * customer acts on it from their side of the conversation.
 */

export const OPT_OUT_LINE = "To stop these reminders, reply STOP."

export function withOptOutLine(body: string, purpose: ReminderPurpose): string {
  if (purpose === "recovery_escalation") return body

  return `${body}\n\n${OPT_OUT_LINE}`
}

// --- Statement ------------------------------------------------------------------

/**
 * The schedule as the statement prints it: the numbers the ledger already holds,
 * read line by line with the time-relative marks folded in. Nothing here invents a
 * total — each line's balance is its own total minus what was recorded against it,
 * and the summary's paid figure is the sum of the same recorded amounts, so the
 * statement reconciles with the customer ledger by construction rather than by hope.
 */

export interface StatementLine {
  number: number

  kind: string

  kindLabel: string

  month: string

  dueDate: string

  amount: number

  paidAmount: number

  balance: number

  paidDate: string | null

  method: string | null

  receiptNumber: string | null

  lateDays: number

  lateCharge: number

  status: string

  statusLabel: string
}

export interface StatementView {
  bookingReference: string

  unitCode: string

  projectName: string

  customerName: string

  currency: string

  lines: StatementLine[]

  totalAmount: number

  totalPaid: number

  totalOutstanding: number

  installmentsCompleted: number

  installmentCount: number

  nextDueDate: string | null

  nextDueAmount: number | null

  generatedAt: string
}
