/**
 * The journal vocabulary — one line per money event, ready to hand to an outside
 * accounting system.
 *
 * The platform does not run its own double-entry ledger; instead the journal export
 * emits one flat line per event, mapped through the tenant's chart-of-accounts to a
 * single account code. The receiving system supplies the contra side; this file is
 * the honest, minimal statement of what happened here.
 *
 * A line is either a debit or a credit — never both, never neither — so a consumer
 * can pivot on `debit`/`credit` and total by account without arithmetic. `unmapped`
 * flags a row whose source had no configured account code, so a reader knows the
 * blank cell is an honest gap rather than a fabricated 0.
 */

export type JournalSourceType = "customer_ledger" | "expense" | "vendor_ledger"

export interface JournalLine {
  /** The ISO timestamp the underlying event was recorded at. */

  occurredAt: string

  /** The date of the event as `YYYY-MM-DD`, so an import can key on a plain date. */

  date: string

  /** The account code from the tenant's chart-of-accounts mapping. Empty if unmapped. */

  account: string

  /** The reference the source row carries (receipt, invoice, credit note, contract). */

  reference: string

  /** Free-text description the export builds from the event kind and any stored note. */

  description: string

  sourceType: JournalSourceType

  sourceId: string

  /** Whole-number debit amount, zero when this line is a credit. */

  debit: number

  /** Whole-number credit amount, zero when this line is a debit. */

  credit: number

  currency: string

  /** True when the mapped account code is empty; the value is honest but unattributed. */

  unmapped: boolean
}

export interface JournalTotalsByAccount {
  account: string

  debit: number

  credit: number
}

export interface JournalResponse {
  lines: JournalLine[]

  totals: JournalTotalsByAccount[]

  currency: string

  from: string

  to: string
}
