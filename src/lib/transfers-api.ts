/**
 * Typed client for the booking-transfer endpoints.
 *
 * Mirrors `server/routes/transfers.ts`. A transfer is always approval-gated: requesting
 * one snapshots what travels and returns the `pending` row; only a sign-off repoints the
 * booking and posts the paired ledger movements. The history read shows both directions,
 * so each party keeps its before/after trail.
 */

import type { TransferDocuments, TransferStatus } from "@shared/transfers"

import { api } from "./api"

/** One transfer request, as the server returns it. */

export interface Transfer {
  id: string

  bookingId: string

  fromCustomerId: string

  toCustomerId: string

  fee: number

  outstandingMoved: number

  reason: string | null

  status: TransferStatus

  approvalId: string | null

  documents: TransferDocuments | null

  requestedByUserId: string

  requestedByName: string

  requestedAt: string

  completedAt: string | null

  updatedAt: string
}

export interface RequestTransferInput {
  bookingId: string

  toCustomerId: string

  fee?: number

  reason?: string
}

export interface RequestTransferResponse {
  transfer: Transfer | null

  pending: true
}

export interface ListTransfersResponse {
  transfers: Transfer[]

  currency: string

  canRequest: boolean
}

export const transfersApi = {
  request: (input: RequestTransferInput) =>
    api.post<RequestTransferResponse>("/api/transfers", input),

  listForCustomer: (customerId: string, signal?: AbortSignal) =>
    api.get<ListTransfersResponse>(
      `/api/customers/${customerId}/transfers`,
      signal,
    ),
}
