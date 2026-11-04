/**
 * Due-payment reminders — a documented DRY RUN, not the sending engine.
 *
 * The real chase lives in `server/jobs/payment-reminders.ts`, which queues and
 * dispatches through the ledger. This module keeps the older, narrower role: it
 * computes *what a before-due reminder would say* and hands those rows back to
 * the caller. The `GET /api/settings/communications/upcoming-reminders` endpoint
 * runs it in dry mode so a workspace can see, and reason about, the exact text
 * its templates would produce without a single message leaving the building.
 *
 * Keeping it honest means one rule: this function performs no writes. It reads
 * the schedule and the stored template, renders text, and returns.
 */

import {
  defaultTemplate,
  renderTemplate,
  type MessageChannel,
  type MessageLanguage,
  type RenderedReminder,
} from "../../shared/communications.ts"

import { all, get } from "../db.ts"

/** Whole-major-unit money rendered the way a body reads it: "12,500 AED". */

function formatMoney(amount: number, currency: string): string {
  const grouped = new Intl.NumberFormat("en-US").format(Math.round(amount))

  return currency ? `${grouped} ${currency}` : grouped
}

/** The `YYYY-MM-DD` a given number of days after an ISO instant falls on. */

function addDays(iso: string, days: number): string {
  const base = new Date(`${iso.slice(0, 10)}T00:00:00Z`).getTime()

  const shifted = Number.isNaN(base)
    ? Date.now()
    : base + days * 24 * 60 * 60 * 1000

  return new Date(shifted).toISOString().slice(0, 10)
}

/** Whole days from `today` to `dueDate`; negative when the due date has passed. */

function daysBetween(today: string, dueDate: string): number {
  const a = new Date(`${today.slice(0, 10)}T00:00:00Z`).getTime()

  const b = new Date(`${dueDate.slice(0, 10)}T00:00:00Z`).getTime()

  if (Number.isNaN(a) || Number.isNaN(b)) return 0

  return Math.round((b - a) / (24 * 60 * 60 * 1000))
}

interface ReminderRow {
  installment_id: string

  number: number

  due_date: string

  total: number

  paid_amount: number

  booking_id: string

  booking_reference: string

  unit_code: string

  customer_id: string

  customer_name: string

  project_name: string

  currency: string

  outstanding_balance: number
}

/**
 * The stored template body for a (tenant, channel, purpose, language), or the
 * shipped default when the workspace has not been seeded or has not touched it.
 * A disabled template still renders here, because the dry run reports what *would*
 * go out; whether it is enabled is shown by the settings panel, not hidden here.
 * A blank stored subject means "use the shipped default".
 */

function resolveTemplate(
  tenantId: string,

  channel: MessageChannel,

  key: "due_payment_reminder",

  language: MessageLanguage,
): {
  subject: string
  body: string
} {
  const row = get<{
    subject: string
    body: string
  }>(
    `SELECT subject, body FROM message_templates
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
  }
}

/**
 * Renders the reminders that *would* go out for one tenant.
 *
 * A line is a candidate when it is not fully paid and its due date has arrived
 * or falls within `windowDays`. Overdue lines are included on purpose: a reminder
 * that only fires before the due date misses exactly the accounts that most need
 * it. `daysUntilDue` is negative for those, so a caller can separate "chase" from
 * "courtesy".
 */

export function runDuePaymentReminders(
  tenantId: string,

  nowIso: string,

  windowDays = 3,

  channel: MessageChannel = "email",

  language: MessageLanguage = "en",
): RenderedReminder[] {
  const today = nowIso.slice(0, 10)

  const windowEnd = addDays(today, Math.max(0, windowDays))

  const template = resolveTemplate(
    tenantId,
    channel,
    "due_payment_reminder",
    language,
  )

  const tenantName =
    get<{ name: string }>(`SELECT name FROM tenants WHERE id = ?`, tenantId)
      ?.name ?? ""

  const rows = all<ReminderRow>(
    `SELECT i.id AS installment_id,
            i.number,
            i.due_date,
            i.total,
            i.paid_amount,
            b.id AS booking_id,
            b.reference AS booking_reference,
            b.unit_code,
            b.customer_id,
            b.customer_name,
            p.name AS project_name,
            pp.currency,
            (SELECT COALESCE(SUM(x.total - x.paid_amount), 0)
               FROM payment_installments x
              WHERE x.tenant_id = i.tenant_id
                AND x.booking_id = i.booking_id
                AND x.status <> 'paid') AS outstanding_balance
       FROM payment_installments i
       JOIN bookings       b  ON b.id  = i.booking_id AND b.tenant_id  = i.tenant_id
       JOIN payment_plans  pp ON pp.booking_id = b.id  AND pp.tenant_id = i.tenant_id
       JOIN projects       p  ON p.id  = b.project_id AND p.tenant_id  = i.tenant_id
      WHERE i.tenant_id = ?
        AND i.status <> 'paid'
        AND i.due_date <= ?
      ORDER BY i.due_date ASC, b.reference ASC, i.number ASC`,

    tenantId,

    windowEnd,
  )

  return rows.map((row) => {
    const dueAmount = Math.max(0, row.total - row.paid_amount)

    const context = {
      customer_name: row.customer_name,

      tenant_name: tenantName,

      due_amount: formatMoney(dueAmount, row.currency),

      due_date: row.due_date,

      amount_paid: formatMoney(row.paid_amount, row.currency),

      outstanding_balance: formatMoney(row.outstanding_balance, row.currency),

      booking_reference: row.booking_reference,

      unit: row.unit_code,

      project: row.project_name,
    }

    const rendered = renderTemplate(template.body, context)

    const renderedSubject = renderTemplate(template.subject, context)

    return {
      customerId: row.customer_id,

      customerName: row.customer_name,

      bookingId: row.booking_id,

      bookingReference: row.booking_reference,

      unitCode: row.unit_code,

      projectName: row.project_name,

      installmentId: row.installment_id,

      installmentNumber: row.number,

      dueDate: row.due_date,

      dueAmount,

      outstandingBalance: row.outstanding_balance,

      currency: row.currency,

      daysUntilDue: daysBetween(today, row.due_date),

      channel,

      subject: renderedSubject.text,

      body: rendered.text,

      missingTokens: [
        ...new Set([
          ...renderedSubject.missingTokens,
          ...rendered.missingTokens,
        ]),
      ],
    }
  })
}
