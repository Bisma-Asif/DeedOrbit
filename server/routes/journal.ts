/**
 * The journal export: one flat line per money event, mapped through the tenant's
 * chart-of-accounts to an external account code.
 *
 * The platform does not run its own double-entry ledger. This endpoint composes an
 * honest statement of what happened over a date range — a customer-ledger movement,
 * a paid expense, a vendor invoice or payment — as exactly one line each. Where the
 * tenant has mapped a source to an account code we emit that code; where they have
 * not we emit an empty account and set `unmapped: true` so the receiving system can
 * see the gap rather than a fabricated 0 or an invented account.
 *
 * Reading is `payments.view`: whoever watches the money flow watches the journal.
 * The tenant's currency comes from the row on `tenants`, so the payload is coherent
 * even when the range covers no events at all.
 */

import { all, get } from "../db.ts"

import { badRequest, type RequestContext } from "../http.ts"

import { requireAuth, requirePermission } from "../middleware.ts"

import { COA_SOURCES, type CoaSource } from "../../shared/chart-of-accounts.ts"

import { LEDGER_KIND_LABELS, type LedgerKind } from "../../shared/ledger.ts"

import {
  EXPENSE_CATEGORY_LABELS,
  type ExpenseCategory,
} from "../../shared/expenses.ts"

import {
  VENDOR_LEDGER_KIND_LABELS,
  type VendorLedgerKind,
} from "../../shared/vendors.ts"

import type {
  JournalLine,
  JournalResponse,
  JournalSourceType,
  JournalTotalsByAccount,
} from "../../shared/journal.ts"

/**
 * Each customer-ledger kind maps to one chart-of-accounts source: what kind of
 * income (or receivable movement) the event represents. The kind's sign in the
 * ledger already tells us whether the customer's balance went up or down, so the
 * journal reads that sign directly as debit/credit.
 */

const CUSTOMER_KIND_TO_SOURCE: Record<LedgerKind, CoaSource> = {
  payment: "booking_income",

  late_fee: "late_fee_income",

  waiver: "discounts",

  refund: "booking_income",

  cancellation_charge: "cancellation_charge",

  cancellation_refund: "booking_income",

  transfer_out: "receivables",

  transfer_in: "receivables",

  adjustment: "receivables",
}

const EXPENSE_CATEGORY_TO_SOURCE: Record<ExpenseCategory, CoaSource> = {
  project: "expense_project",

  office: "expense_office",

  marketing: "expense_marketing",

  construction: "expense_construction",
}

const VENDOR_KIND_TO_SOURCE: Record<VendorLedgerKind, CoaSource> = {
  invoice: "vendor_payable",

  payment: "vendor_payment",

  adjustment: "vendor_payable",
}

interface CoaRow {
  source: string

  account_code: string
}

/** The tenant's mapping, resolved eagerly so the composition loop never hits the DB. */

function readMappings(tenantId: string): Map<CoaSource, string> {
  const map = new Map<CoaSource, string>()

  for (const source of COA_SOURCES) map.set(source, "")

  for (const row of all<CoaRow>(
    `SELECT source, account_code FROM chart_of_account_mappings WHERE tenant_id = ?`,

    tenantId,
  )) {
    if ((COA_SOURCES as readonly string[]).includes(row.source)) {
      map.set(row.source as CoaSource, row.account_code)
    }
  }

  return map
}

function tenantCurrency(tenantId: string): string {
  return (
    get<{ currency: string }>(
      "SELECT currency FROM tenants WHERE id = ?",

      tenantId,
    )?.currency ?? "AED"
  )
}

/** Parse `YYYY-MM-DD` (from `?from=` / `?to=`) into an ISO instant. */

function parseDate(value: string, endOfDay: boolean): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null

  return `${value}${endOfDay ? "T23:59:59.999Z" : "T00:00:00.000Z"}`
}

/** The date part of an ISO timestamp, for the flat `date` field on a journal line. */

function asPlainDate(value: string): string {
  return value.slice(0, 10)
}

// --- Source rows -----------------------------------------------------------

interface CustomerLedgerJournalRow {
  id: string

  kind: string

  amount: number

  currency: string

  reference: string | null

  booking_reference: string | null

  customer_name: string | null

  note: string | null

  occurred_at: string
}

interface PaidExpenseJournalRow {
  id: string

  category: string

  description: string

  amount: number

  currency: string

  occurred_at: string

  vendor_name: string | null

  project_code: string | null
}

interface VendorLedgerJournalRow {
  id: string

  kind: string

  amount: number

  currency: string

  reference: string | null

  vendor_name: string | null

  note: string | null

  occurred_at: string
}

function buildCustomerLines(
  tenantId: string,

  from: string,

  to: string,

  mappings: Map<CoaSource, string>,
): JournalLine[] {
  const rows = all<CustomerLedgerJournalRow>(
    `SELECT l.id, l.kind, l.amount, l.currency, l.reference, l.note, l.occurred_at,
            b.reference AS booking_reference,
            cu.full_name AS customer_name
       FROM customer_ledger_entries l
       LEFT JOIN bookings  b  ON b.id  = l.booking_id AND b.tenant_id  = l.tenant_id
       LEFT JOIN customers cu ON cu.id = l.customer_id AND cu.tenant_id = l.tenant_id
      WHERE l.tenant_id = ? AND l.occurred_at >= ? AND l.occurred_at <= ?
      ORDER BY l.occurred_at ASC, l.rowid ASC`,

    tenantId,

    from,

    to,
  )

  return rows.map((row) => {
    const kind = row.kind as LedgerKind

    const source = CUSTOMER_KIND_TO_SOURCE[kind] ?? "receivables"

    const account = mappings.get(source) ?? ""

    const description = `${LEDGER_KIND_LABELS[kind] ?? kind}${
      row.customer_name ? ` — ${row.customer_name}` : ""
    }${row.note ? `: ${row.note}` : ""}`

    return makeLine({
      occurredAt: row.occurred_at,

      account,

      reference: row.reference ?? row.booking_reference ?? "",

      description,

      sourceType: "customer_ledger",

      sourceId: row.id,

      // Positive amount = the customer owes more = a debit. Negative = paid = credit.

      signedAmount: row.amount,

      currency: row.currency,
    })
  })
}

function buildExpenseLines(
  tenantId: string,

  from: string,

  to: string,

  mappings: Map<CoaSource, string>,
): JournalLine[] {
  const rows = all<PaidExpenseJournalRow>(
    `SELECT e.id, e.category, e.description, e.amount, e.currency, e.occurred_at,
            v.name AS vendor_name,
            p.code AS project_code
       FROM expenses e
       LEFT JOIN vendors  v ON v.id = e.vendor_id  AND v.tenant_id = e.tenant_id
       LEFT JOIN projects p ON p.id = e.project_id AND p.tenant_id = e.tenant_id
      WHERE e.tenant_id = ? AND e.status = 'paid'
        AND e.paid_at IS NOT NULL
        AND e.occurred_at >= ? AND e.occurred_at <= ?
      ORDER BY e.occurred_at ASC, e.rowid ASC`,

    tenantId,

    from,

    to,
  )

  return rows.map((row) => {
    const category = row.category as ExpenseCategory

    const source = EXPENSE_CATEGORY_TO_SOURCE[category] ?? "expense_office"

    const account = mappings.get(source) ?? ""

    const description = `${EXPENSE_CATEGORY_LABELS[category] ?? category} expense: ${
      row.description
    }${row.vendor_name ? ` — ${row.vendor_name}` : ""}`

    return makeLine({
      occurredAt: row.occurred_at,

      account,

      reference: row.project_code ? `${row.project_code}/${row.id}` : row.id,

      description,

      sourceType: "expense",

      sourceId: row.id,

      // An expense is always a debit against the category's account.

      signedAmount: row.amount,

      currency: row.currency,
    })
  })
}

function buildVendorLines(
  tenantId: string,

  from: string,

  to: string,

  mappings: Map<CoaSource, string>,
): JournalLine[] {
  const rows = all<VendorLedgerJournalRow>(
    `SELECT l.id, l.kind, l.amount, l.currency, l.reference, l.note, l.occurred_at,
            v.name AS vendor_name
       FROM vendor_ledger_entries l
       LEFT JOIN vendors v ON v.id = l.vendor_id AND v.tenant_id = l.tenant_id
      WHERE l.tenant_id = ? AND l.occurred_at >= ? AND l.occurred_at <= ?
      ORDER BY l.occurred_at ASC, l.rowid ASC`,

    tenantId,

    from,

    to,
  )

  return rows.map((row) => {
    const kind = row.kind as VendorLedgerKind

    // A signed adjustment reads as payable when it raises the balance and as a

    // payment when it reduces it; the two CoA sources cover both directions.

    const source: CoaSource =
      kind === "adjustment" && row.amount < 0
        ? "vendor_payment"
        : VENDOR_KIND_TO_SOURCE[kind]

    const account = mappings.get(source) ?? ""

    const description = `${VENDOR_LEDGER_KIND_LABELS[kind] ?? kind}${
      row.vendor_name ? ` — ${row.vendor_name}` : ""
    }${row.note ? `: ${row.note}` : ""}`

    return makeLine({
      occurredAt: row.occurred_at,

      account,

      reference: row.reference ?? row.id,

      description,

      sourceType: "vendor_ledger",

      sourceId: row.id,

      // A vendor invoice (positive) raises the payable: we treat that as a debit

      // against the mapped account. A payment (negative) is a credit.

      signedAmount: row.amount,

      currency: row.currency,
    })
  })
}

/**
 * Turn one signed amount into a debit/credit pair. The line always carries the
 * magnitude of the movement and its direction is the sign: positive → debit,
 * negative → credit. Exactly one side is non-zero, so a consumer can pivot on
 * either column without arithmetic.
 */

function makeLine(input: {
  occurredAt: string

  account: string

  reference: string

  description: string

  sourceType: JournalSourceType

  sourceId: string

  signedAmount: number

  currency: string
}): JournalLine {
  const magnitude = Math.abs(input.signedAmount)

  const debit = input.signedAmount >= 0 ? magnitude : 0

  const credit = input.signedAmount < 0 ? magnitude : 0

  return {
    occurredAt: input.occurredAt,

    date: asPlainDate(input.occurredAt),

    account: input.account,

    reference: input.reference,

    description: input.description,

    sourceType: input.sourceType,

    sourceId: input.sourceId,

    debit,

    credit,

    currency: input.currency,

    unmapped: input.account === "",
  }
}

/** Sum debits and credits by account. Blank accounts total under `""` and are still emitted. */

function foldTotals(lines: JournalLine[]): JournalTotalsByAccount[] {
  const totals = new Map<string, JournalTotalsByAccount>()

  for (const line of lines) {
    const key = line.account

    const current = totals.get(key) ?? { account: key, debit: 0, credit: 0 }

    current.debit += line.debit

    current.credit += line.credit

    totals.set(key, current)
  }

  return [...totals.values()].sort((a, b) => a.account.localeCompare(b.account))
}

/** GET /api/journal?from=YYYY-MM-DD&to=YYYY-MM-DD */

export async function getJournal(
  ctx: RequestContext,
): Promise<JournalResponse> {
  const guarded = requirePermission(requireAuth(ctx), "payments", "view")

  const fromRaw = ctx.query.get("from") ?? ""

  const toRaw = ctx.query.get("to") ?? ""

  const from = parseDate(fromRaw, false)

  const to = parseDate(toRaw, true)

  const errors: Record<string, string> = {}

  if (!from) errors.from = "Enter a start date as YYYY-MM-DD."

  if (!to) errors.to = "Enter an end date as YYYY-MM-DD."

  if (from && to && from > to)
    errors.to = "The end date is before the start date."

  if (Object.keys(errors).length > 0) {
    throw badRequest("Check the highlighted fields", errors)
  }

  const mappings = readMappings(guarded.tenantId)

  const lines: JournalLine[] = [
    ...buildCustomerLines(
      guarded.tenantId,
      from as string,
      to as string,
      mappings,
    ),

    ...buildExpenseLines(
      guarded.tenantId,
      from as string,
      to as string,
      mappings,
    ),

    ...buildVendorLines(
      guarded.tenantId,
      from as string,
      to as string,
      mappings,
    ),
  ].sort((a, b) => {
    if (a.occurredAt === b.occurredAt)
      return a.sourceId.localeCompare(b.sourceId)

    return a.occurredAt.localeCompare(b.occurredAt)
  })

  return {
    lines,

    totals: foldTotals(lines),

    currency: tenantCurrency(guarded.tenantId),

    from: fromRaw,

    to: toRaw,
  }
}
