/**
 * Expense vocabulary: what a spend record is made of and how it moves to paid.
 *
 * An expense is a cost the tenant incurs — on a project, in the office, on marketing,
 * or on construction. It starts as a draft, is submitted into the maker-checker queue,
 * and only becomes `paid` when the finance desk marks it so after an approval lands.
 * A rejection returns it to a terminal `rejected` state — the trail is honest and the
 * row is never silently deleted.
 *
 * Money is a whole number of the tenant's major currency unit, matching the rest of
 * the platform, and the amount cap is the same as the ledger's, so no new numeric
 * surface is opened.
 */

import { LEDGER_AMOUNT_MAX } from "./ledger.ts"

export const EXPENSE_CATEGORIES = [
  "project",

  "office",

  "marketing",

  "construction",
] as const

export type ExpenseCategory = typeof EXPENSE_CATEGORIES[number]

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  project: "Project",

  office: "Office",

  marketing: "Marketing",

  construction: "Construction",
}

export const EXPENSE_CATEGORY_TONES: Record<ExpenseCategory, "info" | "outline" | "pending" | "success"> =
  {
    project: "info",

    office: "outline",

    marketing: "pending",

    construction: "success",
  }

export function isExpenseCategory(value: unknown): value is ExpenseCategory {
  return (
    typeof value === "string" &&
    (EXPENSE_CATEGORIES as readonly string[]).includes(value)
  )
}

export const EXPENSE_STATUSES = [
  "draft",

  "pending_approval",

  "approved",

  "paid",

  "rejected",
] as const

export type ExpenseStatus = typeof EXPENSE_STATUSES[number]

export const EXPENSE_STATUS_LABELS: Record<ExpenseStatus, string> = {
  draft: "Draft",

  pending_approval: "Pending approval",

  approved: "Approved",

  paid: "Paid",

  rejected: "Rejected",
}

export const EXPENSE_STATUS_TONES: Record<ExpenseStatus, "outline" | "pending" | "info" | "success" | "danger"> =
  {
    draft: "outline",

    pending_approval: "pending",

    approved: "info",

    paid: "success",

    rejected: "danger",
  }

export function isExpenseStatus(value: unknown): value is ExpenseStatus {
  return (
    typeof value === "string" &&
    (EXPENSE_STATUSES as readonly string[]).includes(value)
  )
}

export const EXPENSE_AMOUNT_MAX = LEDGER_AMOUNT_MAX

export const EXPENSE_DESCRIPTION_MAX = 400

/** Cap on receipt/invoice bytes per attachment, mirroring the tenant-logo size cap style. */

export const EXPENSE_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024

/** Cap on attachments a single expense may carry. */

export const EXPENSE_ATTACHMENT_MAX_COUNT = 2

export const EXPENSE_ATTACHMENT_ALLOWED_MIMES = [
  "image/png",

  "image/jpeg",

  "application/pdf",
] as const

export type ExpenseAttachmentMime = typeof EXPENSE_ATTACHMENT_ALLOWED_MIMES[number]

export function isAllowedExpenseAttachmentMime(
  value: unknown,
): value is ExpenseAttachmentMime {
  return (
    typeof value === "string" &&
    (EXPENSE_ATTACHMENT_ALLOWED_MIMES as readonly string[]).includes(value)
  )
}

export const EXPENSE_ATTACHMENT_FILENAME_MAX = 200

/** A single expense as it reaches the client. */

export interface Expense {
  id: string

  category: ExpenseCategory

  projectId: string | null

  projectCode: string | null

  projectName: string | null

  vendorId: string | null

  vendorName: string | null

  description: string

  amount: number

  currency: string

  occurredAt: string

  status: ExpenseStatus

  approvalId: string | null

  paidAt: string | null

  createdByUserId: string

  createdByName: string

  createdAt: string

  updatedAt: string

  attachmentCount: number

  canSubmit: boolean

  canMarkPaid: boolean
}

/** A stored receipt/invoice attachment minus its bytes. */

export interface ExpenseAttachmentMeta {
  id: string

  expenseId: string

  filename: string

  mime: string

  sizeBytes: number

  uploadedByName: string

  uploadedAt: string
}
