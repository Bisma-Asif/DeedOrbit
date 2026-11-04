/**
 * Server-internal writes and reads for the customer ledger.
 *
 * Every money flow in the finance features records one signed row per event, so the
 * trail a customer was shown is the trail that is stored. This module owns that row so
 * payments, late fees, refunds, cancellations, and transfers all describe the same shape
 * and cannot drift apart. Rows are only ever appended; balance is never stored, it is the
 * running sum of the signed `amount` computed at read.
 *
 * These helpers run against the caller's open transaction; none of them open one, so a
 * route can fold a ledger row into its own atomic write.
 */

import { all, get, run } from "./db.ts"

import type { LedgerEntry, LedgerKind } from "../shared/ledger.ts"

export interface LedgerEntryInput {
  tenantId: string

  customerId: string

  kind: LedgerKind

  /** Signed delta: positive adds what the customer owes, negative reduces it. */

  amount: number

  currency: string

  occurredAt: string

  recordedByUserId: string

  recordedByName: string

  bookingId?: string | null

  reference?: string | null

  sourceType?: string | null

  sourceId?: string | null

  note?: string | null
}

interface LedgerRow {
  id: string

  kind: string

  amount: number

  currency: string

  reference: string | null

  booking_id: string | null

  source_type: string | null

  source_id: string | null

  occurred_at: string

  note: string | null

  recorded_by_name: string
}

function ledgerId(): string {
  return `led_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`
}

/** Append one ledger row inside the caller's transaction and return its id. */

export function appendLedgerEntry(input: LedgerEntryInput): string {
  const id = ledgerId()

  run(
    `INSERT INTO customer_ledger_entries (
        id, tenant_id, customer_id, booking_id, kind, amount, currency, reference,
        source_type, source_id, occurred_at, note, recorded_by_user_id,
        recorded_by_name, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,

    id,

    input.tenantId,

    input.customerId,

    input.bookingId ?? null,

    input.kind,

    input.amount,

    input.currency,

    input.reference ?? null,

    input.sourceType ?? null,

    input.sourceId ?? null,

    input.occurredAt,

    input.note ?? null,

    input.recordedByUserId,

    input.recordedByName,

    input.occurredAt,
  )

  return id
}

/**
 * The whole ledger for a customer, oldest first, with the running balance folded in.
 *
 * Balance is a signed running sum: it grows with what the customer owes and shrinks with
 * money received. Rows are read in the stored time order (occurred_at, then rowid so ties
 * keep their insertion sequence) and the sum is accumulated in JavaScript, which keeps the
 * reading honest even when events were recorded out of order.
 */

export function readCustomerLedger(
  tenantId: string,

  customerId: string,

  bookingReferences: Map<string, string>,
): LedgerEntry[] {
  const rows = all<LedgerRow>(
    `SELECT id, kind, amount, currency, reference, booking_id, source_type,
            source_id, occurred_at, note, recorded_by_name
      FROM customer_ledger_entries
      WHERE tenant_id = ? AND customer_id = ?
      ORDER BY occurred_at ASC, rowid ASC`,

    tenantId,

    customerId,
  )

  let balance = 0

  return rows.map((row) => {
    balance += row.amount

    return {
      id: row.id,

      kind: row.kind as LedgerKind,

      amount: row.amount,

      currency: row.currency,

      reference: row.reference,

      bookingId: row.booking_id,

      bookingReference: row.booking_id
        ? (bookingReferences.get(row.booking_id) ?? null)
        : null,

      sourceType: row.source_type,

      sourceId: row.source_id,

      occurredAt: row.occurred_at,

      note: row.note,

      recordedByName: row.recorded_by_name,

      balanceAfter: balance,
    }
  })
}

/** The booking reference for each booking id a customer holds, for labeling rows. */

interface BookingRefRow {
  id: string

  reference: string
}

export function bookingReferenceMap(
  tenantId: string,

  customerId: string,
): Map<string, string> {
  const rows = all<BookingRefRow>(
    `SELECT id, reference FROM bookings WHERE tenant_id = ? AND customer_id = ?`,

    tenantId,

    customerId,
  )

  return new Map(rows.map((row) => [row.id, row.reference]))
}

/** Resolve a tenant's currency for a ledger row's stamp. */

export function ledgerCurrency(tenantId: string): string {
  return (
    get<{ currency: string }>(
      "SELECT currency FROM tenants WHERE id = ?",

      tenantId,
    )?.currency ?? "AED"
  )
}
