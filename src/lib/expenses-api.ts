/**
 * Typed client for the expenses module.
 *
 * Mirrors `server/routes/expenses.ts`. The lifecycle is `draft -> submitted ->
 * approved -> paid` (with a `rejected` terminal branch); nothing here mutates
 * money on the vendor ledger until `markPaid` fires, which is the moment the
 * finance desk has decided cash is out.
 *
 * Attachment upload takes a pre-encoded `dataUrl` because the server enforces
 * the same 5 MB cap on both sides — reading the file in the browser lets the
 * client reject an oversized pick before any bytes travel.
 */

import type {
  Expense,
  ExpenseAttachmentMeta,
  ExpenseCategory,
  ExpenseStatus,
} from "@shared/expenses"

import { api } from "./api"

export interface ExpenseFilters {
  project?: string

  vendor?: string

  category?: ExpenseCategory | ""

  status?: ExpenseStatus | ""

  from?: string

  to?: string
}

export interface ExpenseListResponse {
  expenses: Expense[]

  currency: string

  canCreate: boolean

  canEdit: boolean

  canApprove: boolean
}

export interface ExpenseDetailResponse {
  expense: Expense

  attachments: ExpenseAttachmentMeta[]
}

export interface ExpenseMutationResponse {
  expense: Expense
}

export interface ExpenseSubmitResponse {
  expense: Expense

  approvalId: string

  pending: true
}

export interface ExpenseInput {
  category: ExpenseCategory

  projectId: string | null

  vendorId: string | null

  description: string

  amount: number

  occurredAt: string
}

export interface AttachmentUploadResponse {
  ok: true

  attachmentId: string
}

export interface ExpenseAttachmentBody {
  filename: string
  dataUrl: string
}

function query(filters: ExpenseFilters): string {
  const params = new URLSearchParams()

  if (filters.project) params.set("project", filters.project)

  if (filters.vendor) params.set("vendor", filters.vendor)

  if (filters.category) params.set("category", filters.category)

  if (filters.status) params.set("status", filters.status)

  if (filters.from) params.set("from", filters.from)

  if (filters.to) params.set("to", filters.to)

  const qs = params.toString()

  return qs ? `?${qs}` : ""
}

/** The URL that streams a stored attachment back; used by both image previews and PDFs. */

export function expenseAttachmentUrl(
  expenseId: string,
  attachmentId: string,
): string {
  return `/api/expenses/${expenseId}/attachments/${attachmentId}`
}

export const expensesApi = {
  list: (filters: ExpenseFilters = {}, signal?: AbortSignal) =>
    api.get<ExpenseListResponse>(`/api/expenses${query(filters)}`, signal),

  read: (id: string, signal?: AbortSignal) =>
    api.get<ExpenseDetailResponse>(`/api/expenses/${id}`, signal),

  create: (input: ExpenseInput) =>
    api.post<ExpenseMutationResponse>("/api/expenses", input),

  update: (id: string, input: ExpenseInput) =>
    api.patch<ExpenseMutationResponse>(`/api/expenses/${id}`, input),

  submit: (id: string) =>
    api.post<ExpenseSubmitResponse>(`/api/expenses/${id}/submit`),

  markPaid: (id: string) =>
    api.post<ExpenseMutationResponse>(`/api/expenses/${id}/mark-paid`),

  uploadAttachment: (
    id: string,

    body: ExpenseAttachmentBody,
  ) =>
    api.post<AttachmentUploadResponse>(`/api/expenses/${id}/attachments`, body),

  deleteAttachment: (id: string, attachmentId: string) =>
    api.delete<{ ok: true }>(`/api/expenses/${id}/attachments/${attachmentId}`),
}
