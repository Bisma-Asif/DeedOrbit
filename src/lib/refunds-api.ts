/**
 * Typed client for the refund endpoints.
 *
 * Mirrors `server/routes/refunds.ts`. A refund is always approval-gated: requesting one
 * returns the `pending` row plus the held flag, and nothing settles until a sign-off. The
 * amount is bounded on the server against the referenced payment's un-refunded remainder.
 */

import type { RefundStatus } from "@shared/refunds"

import { api } from "./api"

/** One refund, as the server returns it. */

export interface Refund {
  id: string

  customerId: string

  bookingId: string | null

  installmentId: string | null

  paymentId: string | null

  amount: number

  reason: string

  status: RefundStatus

  creditNumber: string | null

  approvalId: string | null

  requestedByUserId: string

  requestedByName: string

  requestedAt: string

  paidAt: string | null

  recordedByUserId: string | null

  recordedByName: string | null

  updatedAt: string
}

export interface RequestRefundInput {
  customerId: string

  paymentId: string

  amount: number

  reason: string

  bookingId?: string | null

  installmentId?: string | null
}

export interface RequestRefundResponse {
  refund: Refund | null

  pending: true
}

export interface ListRefundsResponse {
  refunds: Refund[]

  currency: string

  canRequest: boolean
}

export const refundsApi = {
  request: (input: RequestRefundInput) =>
    api.post<RequestRefundResponse>("/api/refunds", input),

  listForCustomer: (customerId: string, signal?: AbortSignal) =>
    api.get<ListRefundsResponse>(
      `/api/customers/${customerId}/refunds`,
      signal,
    ),
}
