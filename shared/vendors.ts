/**
 * Vendor vocabulary: the supplier profile and the two records attached to it.
 *
 * A vendor is any supplier the tenant pays — a contractor, a marketing agency, an
 * office supply house. Every spend against a vendor is either an expense (recorded
 * in the Expenses module) or a vendor invoice (raised here when the vendor bills
 * us). Money out is a payment recorded against an open invoice or an adjustment.
 *
 * The vendor ledger mirrors the customer ledger's shape exactly: signed amounts,
 * running balance folded in at read, append-only. Sign convention flips because a
 * vendor account is a payable rather than a receivable — a positive amount is what
 * we now owe them (an invoice), a negative amount is money we've paid out.
 */

import {
  LEDGER_AMOUNT_MAX,
  LEDGER_NOTE_MAX,
  LEDGER_REFERENCE_MAX,
} from "./ledger.ts"

export const VENDOR_STATUSES = ["active", "archived"] as const

export type VendorStatus = typeof VENDOR_STATUSES[number]

export const VENDOR_STATUS_LABELS: Record<VendorStatus, string> = {
  active: "Active",

  archived: "Archived",
}

export const VENDOR_STATUS_TONES: Record<VendorStatus, "success" | "outline"> =
  {
    active: "success",

    archived: "outline",
  }

export function isVendorStatus(value: unknown): value is VendorStatus {
  return (
    typeof value === "string" &&
    (VENDOR_STATUSES as readonly string[]).includes(value)
  )
}

export const VENDOR_NAME_MAX = 200

export const VENDOR_CONTACT_MAX = 200

export const VENDOR_EMAIL_MAX = 200

export const VENDOR_PHONE_MAX = 40

export const VENDOR_TAX_ID_MAX = 60

export const VENDOR_ADDRESS_MAX = 200

export const VENDOR_CITY_MAX = 100

export const VENDOR_COUNTRY_MAX = 2

export const VENDOR_NOTES_MAX = 1000

export interface Vendor {
  id: string

  name: string

  contactName: string | null

  email: string | null

  phone: string | null

  taxId: string | null

  addressLine1: string | null

  addressLine2: string | null

  city: string | null

  countryCode: string | null

  notes: string | null

  status: VendorStatus

  createdAt: string

  updatedAt: string

  /** Outstanding balance carried by the vendor's ledger, positive means we owe them. */

  balance: number

  currency: string

  contractCount: number

  openInvoiceCount: number
}

export const VENDOR_CONTRACT_STATUSES = [
  "active",
  "completed",
  "cancelled",
] as const

export type VendorContractStatus = typeof VENDOR_CONTRACT_STATUSES[number]

export const VENDOR_CONTRACT_STATUS_LABELS: Record<VendorContractStatus, string> =
  {
    active: "Active",

    completed: "Completed",

    cancelled: "Cancelled",
  }

export const VENDOR_CONTRACT_STATUS_TONES: Record<VendorContractStatus, "success" | "info" | "danger"> =
  {
    active: "success",

    completed: "info",

    cancelled: "danger",
  }

export function isVendorContractStatus(
  value: unknown,
): value is VendorContractStatus {
  return (
    typeof value === "string" &&
    (VENDOR_CONTRACT_STATUSES as readonly string[]).includes(value)
  )
}

export const VENDOR_CONTRACT_REFERENCE_MAX = LEDGER_REFERENCE_MAX

export const VENDOR_CONTRACT_TITLE_MAX = 200

export const VENDOR_CONTRACT_NOTES_MAX = 1000

export interface VendorContract {
  id: string

  vendorId: string

  reference: string

  title: string

  value: number

  currency: string

  startDate: string | null

  endDate: string | null

  notes: string | null

  status: VendorContractStatus

  createdAt: string
}

export const VENDOR_INVOICE_STATUSES = ["open", "paid", "void"] as const

export type VendorInvoiceStatus = typeof VENDOR_INVOICE_STATUSES[number]

export const VENDOR_INVOICE_STATUS_LABELS: Record<VendorInvoiceStatus, string> =
  {
    open: "Open",

    paid: "Paid",

    void: "Void",
  }

export const VENDOR_INVOICE_STATUS_TONES: Record<VendorInvoiceStatus, "pending" | "success" | "danger"> =
  {
    open: "pending",

    paid: "success",

    void: "danger",
  }

export function isVendorInvoiceStatus(
  value: unknown,
): value is VendorInvoiceStatus {
  return (
    typeof value === "string" &&
    (VENDOR_INVOICE_STATUSES as readonly string[]).includes(value)
  )
}

export const VENDOR_INVOICE_REFERENCE_MAX = LEDGER_REFERENCE_MAX

export const VENDOR_INVOICE_AMOUNT_MAX = LEDGER_AMOUNT_MAX

export interface VendorInvoice {
  id: string

  vendorId: string

  contractId: string | null

  reference: string

  amount: number

  currency: string

  issuedAt: string

  dueAt: string | null

  status: VendorInvoiceStatus

  paidAt: string | null

  note: string | null
}

/** The three kinds of event that touch a vendor's account. */

export const VENDOR_LEDGER_KINDS = [
  "invoice",

  "payment",

  "adjustment",
] as const

export type VendorLedgerKind = typeof VENDOR_LEDGER_KINDS[number]

export const VENDOR_LEDGER_KIND_LABELS: Record<VendorLedgerKind, string> = {
  invoice: "Invoice raised",

  payment: "Payment made",

  adjustment: "Adjustment",
}

/**
 * Badge tones for the vendor ledger, following the same rule the customer ledger uses:
 * money that increases what we owe is danger (an invoice), money we've paid out is
 * success, and a neutral movement (an adjustment) is the quiet info tone.
 */

export const VENDOR_LEDGER_KIND_TONES: Record<VendorLedgerKind, "danger" | "success" | "outline"> =
  {
    invoice: "danger",

    payment: "success",

    adjustment: "outline",
  }

export function isVendorLedgerKind(value: unknown): value is VendorLedgerKind {
  return (
    typeof value === "string" &&
    (VENDOR_LEDGER_KINDS as readonly string[]).includes(value)
  )
}

/** A vendor ledger row as it reaches the client, with the running balance folded in. */

export interface VendorLedgerEntry {
  id: string

  kind: VendorLedgerKind

  /** Signed delta to what we owe: positive raises the payable, negative pays it down. */

  amount: number

  currency: string

  reference: string | null

  invoiceId: string | null

  invoiceReference: string | null

  contractId: string | null

  expenseId: string | null

  sourceType: string | null

  sourceId: string | null

  occurredAt: string

  note: string | null

  recordedByName: string

  /** The running balance after this entry, computed at read time. */

  balanceAfter: number
}

export const VENDOR_LEDGER_NOTE_MAX = LEDGER_NOTE_MAX
