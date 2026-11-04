/**
 * Typed client for the booking endpoints.
 *
 * Mirrors `server/routes/bookings.ts`. The names snapshotted on the booking
 * (customer, agent, dealer, unit code) come back from the server rather than being
 * re-resolved here, so a booking reads the same after any of those records is
 * renamed or removed — which is the whole reason they are stored beside the ids.
 *
 * The list response carries `currency`, `canCreate` and `canApprove` for the same
 * reason the inventory list does: the figures are meaningless without the currency
 * they are in, and the buttons that trigger a create or a cancel must reflect the
 * server's own answer about what this role may do, not a client-side guess.
 */

import type { BookingStatus } from "@shared/bookings"

import type { CancellationMode, UnitOutcome } from "@shared/cancellation"

import type { UnitFacts } from "@shared/inventory-categories"

import { api } from "./api"
import type { ApprovalItem } from "./approvals-api"

export interface BookingListItem {
  id: string

  projectId: string

  projectName: string

  unitId: string

  unitCode: string

  customerId: string

  customerName: string

  quoteId: string | null

  agentUserId: string | null

  agentName: string | null

  dealerId: string | null

  dealerName: string | null

  reference: string

  bookingAmount: number

  bookingDate: string

  status: BookingStatus

  terms: string

  notes: string | null

  createdByName: string

  cancelledByName: string | null

  cancelledAt: string | null

  createdAt: string

  updatedAt: string
}

export interface BookingDetail
  extends BookingListItem {

  /** Present only when the booking was made from a quotation. */

  /**
   * What the unit this booking commits is — type, size, key details, and whether it is
   * sold in installments at all. Resolved server-side from the live unit, so the booking
   * page prints them without an `inventory.view` grant and a lump-sum-only unit can refuse
   * a payment plan it was never sold on. Null only when the unit row no longer exists.
   */
  quoteNumber: string | null

  quoteTotal: number | null
  unitFacts: UnitFacts | null
}

export interface BookingListResponse {
  bookings: BookingListItem[]

  currency: string

  canCreate: boolean

  canApprove: boolean

  truncated: boolean
}

export interface BookingDetailResponse {
  booking: BookingDetail

  currency: string

  canApprove: boolean
}

export interface CreateBookingInput {
  projectId: string

  unitId: string

  customerId: string

  bookingAmount: number

  bookingDate: string

  terms: string

  notes?: string

  agentUserId?: string

  dealerId?: string

  quoteId?: string
}

/**
 * A create either makes the booking now or holds it for approval, decided by the
 * tenant's policy on the server. Both arms are named interfaces so oxfmt cannot
 * collapse their separators, and the caller narrows on `pending` rather than guessing.
 */
export interface BookingCreated {
  booking: BookingListItem

  currency: string
}

export interface BookingHeld {
  approval: ApprovalItem

  currency: string

  pending: true
}

export type CreateBookingResponse = BookingCreated | BookingHeld

export interface BookingCancelled {
  booking: BookingListItem
}

export interface CancellationHeld {
  approval: ApprovalItem

  pending: true
}

export type CancelBookingResponse = BookingCancelled | CancellationHeld

/** What cancelling a booking will cost and return, read live before the canceller submits. */

export interface CancellationPreview {
  bookingId: string

  reference: string

  paidAmount: number

  hasRules: boolean

  enabled: boolean

  chargeAmount: number

  refundAmount: number

  unitOutcome: UnitOutcome

  requiresApproval: boolean

  currency: string
}

/** The tenant-wide cancellation rule the settings panel edits. */

export interface CancellationRules {
  enabled: boolean

  mode: CancellationMode

  amount: number

  percentBps: number

  capAmount: number

  unitOutcome: UnitOutcome
}

export interface CancellationRulesResponse {
  rules: CancellationRules

  configured: boolean
}

export const bookingsApi = {
  list: (projectId: string | null, signal?: AbortSignal) =>
    api.get<BookingListResponse>(
      projectId
        ? `/api/bookings?projectId=${encodeURIComponent(projectId)}`
        : "/api/bookings",

      signal,
    ),

  read: (id: string, signal?: AbortSignal) =>
    api.get<BookingDetailResponse>(`/api/bookings/${id}`, signal),

  create: (input: CreateBookingInput) =>
    api.post<CreateBookingResponse>("/api/bookings", input),

  cancel: (id: string, reason?: string) =>
    api.post<CancelBookingResponse>(`/api/bookings/${id}/cancel`, {
      ...(reason && reason.trim() !== "" ? { reason } : {}),
    }),

  /** The charge and refund the rules would apply, read before cancelling. */
  cancellationPreview: (id: string, signal?: AbortSignal) =>
    api.get<CancellationPreview>(
      `/api/bookings/${id}/cancellation-preview`,
      signal,
    ),
}

export const cancellationRulesApi = {
  read: (signal?: AbortSignal) =>
    api.get<CancellationRulesResponse>(
      "/api/settings/cancellation-rules",
      signal,
    ),

  save: (rules: CancellationRules) =>
    api.patch<CancellationRulesResponse>(
      "/api/settings/cancellation-rules",

      rules,
    ),
}
