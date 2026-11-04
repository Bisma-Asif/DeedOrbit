/**
 * The "Ask DeedOrbit" endpoint: read one natural-language question, answer it
 * from the caller's own tenant data, and never show a row the caller could not
 * already open in its own module.
 *
 * There is no model in the loop. The question is normalised and matched to one
 * of the intents in `shared/assistant.ts` by a deterministic reader, and the
 * answer is derived live from the same payment-schedule reads the Collections
 * dashboard uses. Two gates stand in front of any data: `assistant.view` to
 * reach this handler at all, and the intent's underlying `payments.view` to see
 * its rows. A matched-but-forbidden read returns a plain refusal in the reply,
 * not a 403, so the chat can keep going; only a missing `assistant.view` throws.
 *
 * At launch the only intents read overdue payments. Nothing is fabricated: where
 * a figure has no rows behind it the summary says so and the table is empty.
 */

import { all, get } from "../db.ts"

import { badRequest, readJsonBody, type RequestContext } from "../http.ts"

import { requireAuth, requirePermission, writeAudit } from "../middleware.ts"

import { MODULE_LABELS, type PermissionModule } from "../../shared/access.ts"

import {
  AGING_BUCKETS,
  AGING_BUCKET_LABELS,
  bucketForDaysOverdue,
  type AgingBucket,
} from "../../shared/collections.ts"

import {
  ASSISTANT_INTENTS,
  MAX_ANSWER_ROWS,
  MAX_QUESTION_LENGTH,
  type AssistantColumn,
  type AssistantIntent,
  type AssistantReply,
  type AssistantRequest,
  type AssistantRow,
} from "../../shared/assistant.ts"

// --- Tenant helpers (mirrored from the collections read, kept local so this

// route owns its own scoped query rather than importing a mutable one). ------

function tenantCurrency(tenantId: string): string {
  return (
    get<{ currency: string }>(
      "SELECT currency FROM tenants WHERE id = ?",

      tenantId,
    )?.currency ?? "AED"
  )
}

function tenantToday(tenantId: string): string {
  const timezone =
    get<{ timezone: string }>(
      "SELECT timezone FROM tenants WHERE id = ?",

      tenantId,
    )?.timezone ?? "UTC"

  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,

      year: "numeric",

      month: "2-digit",

      day: "2-digit",
    }).format(new Date())
  } catch {
    return new Date().toISOString().slice(0, 10)
  }
}

function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      86_400_000,
  )
}

function formatMoney(value: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",

    currency,

    maximumFractionDigits: 0,
  }).format(value)
}

/** One installment still carrying a balance on a confirmed booking. */

interface OpenLine {
  unit_code: string

  booking_reference: string

  project_name: string

  customer_name: string

  due_date: string

  remaining: number
}

/**
 * The overdue lines for a tenant, oldest first. `b.status = 'confirmed'` keeps
 * the read identical to the collections table, and the `tenant_id = ?` predicate
 * is the whole of the tenant scope — a caller can never ask about another
 * workspace, because the id comes from the session, not the request.
 */

function readOverdueLines(tenantId: string, today: string): OpenLine[] {
  const rows = all<OpenLine>(
    `SELECT b.unit_code, b.reference AS booking_reference,
            p.name AS project_name, c.full_name AS customer_name,
            i.due_date, (i.total - i.paid_amount) AS remaining
      FROM payment_installments i
      JOIN bookings b ON b.id = i.booking_id AND b.tenant_id = i.tenant_id
      JOIN customers c ON c.id = b.customer_id AND c.tenant_id = b.tenant_id
      JOIN projects p ON p.id = b.project_id AND p.tenant_id = b.tenant_id
      WHERE i.tenant_id = ? AND b.status = 'confirmed'
        AND i.total - i.paid_amount > 0 AND i.due_date < ?
      ORDER BY i.due_date ASC`,

    tenantId,

    today,
  )

  return rows
}

// --- Deterministic question reader ----------------------------------------

/** Lower-case, drop punctuation, collapse runs of spaces. */

function normalize(question: string): string {
  return question

    .toLowerCase()

    .replace(/[^a-z0-9\s]/g, " ")

    .replace(/\s+/g, " ")

    .trim()
}

/** The first day count the question mentions, or null. */

function extractDayThreshold(text: string): number | null {
  const patterns = [
    /\b(?:over|more than|older than|older then|beyond|exceeding|greater than|at least|past due by|due by|by)\s+(\d{1,4})\b/,

    /\b(\d{1,4})\s*(?:\+|plus)\b/,

    /\b(\d{1,4})\s*days?\b/,
  ]

  for (const pattern of patterns) {
    const match = pattern.exec(text)

    if (match) {
      const value = Number.parseInt(match[1]!, 10)

      if (Number.isFinite(value) && value >= 0) return value
    }
  }

  return null
}

/**
 * Match a question to an intent. Ordered so a specific ask wins over a general
 * one: the "deepest / oldest" reading beats the total, and the total beats a
 * bare line list. Returns null when nothing reads as overdue at all.
 */

function matchIntent(text: string): AssistantIntent | null {
  const hasOverdue =
    /\b(overdue|over due|past due|late|delinquen|arrears|unpaid|outstanding|due)\b/.test(
      text,
    )

  const asksOldest =
    /\b(oldest|longest|worst|most overdue|deepest|furthest|further behind|biggest)\b/.test(
      text,
    )

  const asksTotal =
    /\b(how much|total|overall|sum|aggregate|breakdown|aging|ageing|position|summary|by bucket|by band)\b/.test(
      text,
    )

  if (asksOldest && hasOverdue)
    return ASSISTANT_INTENTS.find((i) => i.id === "oldest_overdue") ?? null

  if (asksTotal && hasOverdue)
    return ASSISTANT_INTENTS.find((i) => i.id === "overdue_summary") ?? null

  if (hasOverdue)
    return ASSISTANT_INTENTS.find((i) => i.id === "overdue_lines") ?? null

  return null
}

// --- Row shapes -----------------------------------------------------------

const LINE_COLUMNS: AssistantColumn[] = [
  { key: "unit", label: "Unit" },

  { key: "project", label: "Project" },

  { key: "customer", label: "Customer" },

  { key: "dueDate", label: "Due date" },

  { key: "daysOverdue", label: "Days overdue", numeric: true },

  { key: "outstanding", label: "Outstanding", numeric: true },
]

const BUCKET_COLUMNS: AssistantColumn[] = [
  { key: "bucket", label: "Aging band" },

  { key: "count", label: "Instalments", numeric: true },

  { key: "amount", label: "Outstanding", numeric: true },
]

/** One overdue line, computed against the tenant's day. */

interface LineDatum {
  unit: string

  project: string

  customer: string

  dueDate: string

  daysOverdue: number

  outstanding: number
}

function lineRow(
  line: OpenLine,

  today: string,
): LineDatum {
  return {
    unit: line.unit_code,

    project: line.project_name,

    customer: line.customer_name,

    dueDate: line.due_date,

    daysOverdue: daysBetween(line.due_date, today),

    outstanding: line.remaining,
  }
}

/** A running total per aging band. */

interface BucketAcc {
  count: number

  amount: number
}

/** Widen a computed line to the flat cell map the reply carries. */

function toRow(d: LineDatum): AssistantRow {
  return {
    unit: d.unit,

    project: d.project,

    customer: d.customer,

    dueDate: d.dueDate,

    daysOverdue: d.daysOverdue,

    outstanding: d.outstanding,
  }
}

// --- Intent answers -------------------------------------------------------

function answerOverdueLines(
  lines: OpenLine[],

  today: string,

  currency: string,

  minDays: number,
): Pick<AssistantReply, "answer" | "columns" | "rows" | "matchedCount" | "truncated"> {
  const rows = lines

    .map((line) => lineRow(line, today))

    .filter((row) => row.daysOverdue >= minDays)

  const total = rows.reduce((sum, row) => sum + row.outstanding, 0)

  const shown = rows.slice(0, MAX_ANSWER_ROWS)

  const threshold = minDays > 1 ? ` by ${minDays}+ days` : ""

  const answer =
    rows.length === 0
      ? `No instalments on confirmed bookings are overdue${
          minDays > 1 ? ` by more than ${minDays} days` : ""
        }.`
      : `${rows.length} instalment${
          rows.length === 1 ? "" : "s"
        } are overdue${threshold}, totalling ${formatMoney(total, currency)}. Showing the ${shown.length} deepest${
          rows.length > shown.length ? ` of ${rows.length}` : ""
        }.`

  return {
    answer,

    columns: LINE_COLUMNS,

    rows: shown.map(toRow),

    matchedCount: rows.length,

    truncated: rows.length > shown.length,
  }
}

function answerOldestOverdue(
  lines: OpenLine[],

  today: string,

  currency: string,
): Pick<AssistantReply, "answer" | "columns" | "rows" | "matchedCount" | "truncated"> {
  const rows = lines.map((line) => lineRow(line, today))

  const top = rows.slice(0, Math.min(5, MAX_ANSWER_ROWS))

  const answer =
    rows.length === 0
      ? "Nothing on a confirmed booking is overdue right now."
      : `The oldest overdue instalment is unit ${top[0]!.unit} at ${top[0]!.daysOverdue} days (${formatMoney(top[0]!.outstanding, currency)}). These are the ${top.length} longest-overdue lines of ${rows.length}.`

  return {
    answer,

    columns: LINE_COLUMNS,

    rows: top.map(toRow),

    matchedCount: rows.length,

    truncated: rows.length > top.length,
  }
}

function answerOverdueSummary(
  lines: OpenLine[],

  today: string,

  currency: string,
): Pick<AssistantReply, "answer" | "columns" | "rows" | "matchedCount" | "truncated"> {
  const perBucket = new Map<AgingBucket, BucketAcc>()

  let total = 0

  for (const line of lines) {
    const days = daysBetween(line.due_date, today)

    const bucket = bucketForDaysOverdue(days)

    if (!bucket) continue

    const acc = perBucket.get(bucket) ?? { count: 0, amount: 0 }

    acc.count += 1

    acc.amount += line.remaining

    perBucket.set(bucket, acc)

    total += line.remaining
  }

  const bucketRows: AssistantRow[] = AGING_BUCKETS.filter((bucket) =>
    perBucket.has(bucket),
  ).map((bucket) => {
    const acc = perBucket.get(bucket)!

    return {
      bucket: AGING_BUCKET_LABELS[bucket],

      count: acc.count,

      amount: acc.amount,
    }
  })

  const count = [...perBucket.values()].reduce((sum, acc) => sum + acc.count, 0)

  const split = AGING_BUCKETS.filter((bucket) => perBucket.has(bucket))

    .map(
      (bucket) =>
        `${AGING_BUCKET_LABELS[bucket]}: ${perBucket.get(bucket)!.count}`,
    )

    .join(", ")

  const answer =
    count === 0
      ? "No instalments on confirmed bookings are overdue."
      : `${count} instalment${
          count === 1 ? "" : "s"
        } are overdue, totalling ${formatMoney(total, currency)}${
          split ? ` (${split})` : ""
        }.`

  return {
    answer,

    columns: BUCKET_COLUMNS,

    rows: bucketRows,

    matchedCount: count,

    truncated: false,
  }
}

// --- Handler --------------------------------------------------------------

/**
 * POST /api/assistant/ask — one question in, one answer out.
 *
 * Gated on `assistant.view`. A matched intent additionally re-checks its own
 * module's `view` grant and, when that is missing, returns a refusal inside the
 * reply rather than throwing, so the conversation continues. The read is always
 * scoped to `guarded.tenantId`.
 */

export async function ask(ctx: RequestContext): Promise<AssistantReply> {
  const guarded = requirePermission(requireAuth(ctx), "assistant", "view")

  const body = await readJsonBody<Partial<AssistantRequest>>(ctx.req)

  const raw = typeof body.question === "string" ? body.question.trim() : ""

  if (raw.length === 0) throw badRequest("Ask a question first")

  if (raw.length > MAX_QUESTION_LENGTH) {
    throw badRequest(
      `Keep the question under ${MAX_QUESTION_LENGTH} characters`,
    )
  }

  const tenantId = guarded.tenantId

  const currency = tenantCurrency(tenantId)

  const today = tenantToday(tenantId)

  const text = normalize(raw)

  const intent = matchIntent(text)

  const examples = ASSISTANT_INTENTS.flatMap((entry) => entry.examples)

  const base = {
    currency,

    asOf: today,

    examples,
  } satisfies Pick<AssistantReply, "currency" | "asOf" | "examples">

  if (!intent) {
    writeAudit(guarded, "assistant.asked", "assistant", null, {
      intentId: null,

      permitted: true,

      chars: raw.length,
    })

    return {
      intentId: null,

      intentLabel: null,

      requiresModule: null,

      permitted: true,

      answer:
        "I can only answer about the overdue payments on your own workspace for now. Try one of the examples below.",

      columns: [],

      rows: [],

      matchedCount: 0,

      truncated: false,

      ...base,
    }
  }

  const requiresModule = intent.requiresModule as PermissionModule

  const permitted = guarded.can(requiresModule, "view")

  writeAudit(guarded, "assistant.asked", "assistant", null, {
    intentId: intent.id,

    requiresModule,

    permitted,

    chars: raw.length,
  })

  if (!permitted) {
    return {
      intentId: intent.id,

      intentLabel: intent.label,

      requiresModule,

      permitted: false,

      answer: `That answer comes from ${MODULE_LABELS[requiresModule]}, and your role cannot open it, so I will not show those figures here. Ask a tenant admin to grant ${requiresModule}.view.`,

      columns: [],

      rows: [],

      matchedCount: 0,

      truncated: false,

      ...base,
    }
  }

  const lines = readOverdueLines(tenantId, today)

  const minDays = extractDayThreshold(text) ?? 1

  const shaped =
    intent.id === "overdue_summary"
      ? answerOverdueSummary(lines, today, currency)
      : intent.id === "oldest_overdue"
        ? answerOldestOverdue(lines, today, currency)
        : answerOverdueLines(lines, today, currency, minDays)

  return {
    intentId: intent.id,

    intentLabel: intent.label,

    requiresModule,

    permitted: true,

    ...shaped,

    ...base,
  }
}
