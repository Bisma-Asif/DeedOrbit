/**
 * Chart-of-accounts mapping vocabulary, shared between the server and the client.
 *
 * The platform does not run its own double-entry ledger. Instead, it lets the tenant
 * name one external account code for each money-flow source the platform can produce,
 * so a journal export handed to an outside accounting system carries a stable,
 * tenant-authored mapping rather than an invented one. Every row that has no mapping
 * exports with an empty code and an `unmapped` flag — never a fabricated account.
 *
 * A source is a closed enum: adding a new flow means adding a source key here, wiring
 * the mapping UI, and letting `journal.ts` read the code. The list is deliberately
 * small: only the flows the platform actually produces today.
 */

export const COA_SOURCES = [
  "booking_income",

  "receivables",

  "discounts",

  "late_fee_income",

  "cancellation_charge",

  "expense_project",

  "expense_office",

  "expense_marketing",

  "expense_construction",

  "vendor_payable",

  "vendor_payment",
] as const

export type CoaSource = typeof COA_SOURCES[number]

export const COA_SOURCE_LABELS: Record<CoaSource, string> = {
  booking_income: "Booking income",

  receivables: "Customer receivables",

  discounts: "Discounts granted",

  late_fee_income: "Late-fee income",

  cancellation_charge: "Cancellation charges",

  expense_project: "Project expense",

  expense_office: "Office expense",

  expense_marketing: "Marketing expense",

  expense_construction: "Construction expense",

  vendor_payable: "Vendor payable",

  vendor_payment: "Vendor payment",
}

export const COA_SOURCE_HINTS: Partial<Record<CoaSource, string>> = {
  booking_income:
    "Principal recognised when a customer pays against a booking.",

  receivables: "The outstanding balance the customer owes.",

  discounts: "A negotiated price reduction recorded against a booking.",

  late_fee_income: "A late-fee charge applied to an overdue instalment.",

  cancellation_charge: "The penalty a cancelled booking is charged.",

  expense_project: "A cost booked against a development.",

  expense_office: "General overhead spend outside any project.",

  expense_marketing: "Campaign and lead-generation spend.",

  expense_construction: "Build-site cost carried by the tenant.",

  vendor_payable: "What we owe a supplier.",

  vendor_payment: "Money paid out to a supplier.",
}

export const COA_ACCOUNT_CODE_MAX = 20

/** An account code is a short ASCII slug — free enough for any real chart. */

export function isValidAccountCode(value: string): boolean {
  if (value.length === 0) return true

  if (value.length > COA_ACCOUNT_CODE_MAX) return false

  return /^[A-Za-z0-9.\-]+$/.test(value)
}

export interface CoaMapping {
  source: CoaSource

  accountCode: string
}

export function isCoaSource(value: unknown): value is CoaSource {
  return (
    typeof value === "string" &&
    (COA_SOURCES as readonly string[]).includes(value)
  )
}
