import type { UnitType } from "@shared/inventory"

import { api } from "./api"

export type DealerStatus = "active" | "suspended"

export type CommissionType = "percentage" | "fixed"

export type CommissionScope = "project" | "unit_type"

export type DealerBookingStatus = "pending" | "confirmed" | "cancelled"

export interface DealerSummary {
  id: string

  portalUserId: string | null

  companyName: string

  contactName: string

  email: string | null

  phone: string

  businessRegistration: string | null

  taxId: string | null

  address: string | null

  notes: string | null

  status: DealerStatus

  leadCount: number

  bookingCount: number

  commissionTotal: number

  commissionPaid: number

  commissionPayable: number

  createdAt: string

  updatedAt: string
}

export interface DealerLead {
  id: string

  name: string

  phone: string

  email: string | null

  projectInterest: string | null

  status: string

  statusLabel: string

  assignedAgentName: string | null

  createdAt: string
}

export interface DealerCommissionRule {
  id: string

  scope: CommissionScope

  projectId: string | null

  projectName: string | null

  unitType: UnitType | null

  commissionType: CommissionType

  commissionValue: number
}

export interface DealerBooking {
  id: string

  bookingReference: string

  customerName: string

  projectId: string

  projectName: string

  unitType: UnitType

  bookingAmount: number

  bookingDate: string

  status: DealerBookingStatus

  commissionType: CommissionType | null

  commissionValue: number | null

  commissionAmount: number | null

  paidAmount: number
}

export interface DealerStatementEntry {
  bookingId: string

  reference: string

  customerName: string

  projectName: string

  bookingDate: string

  commissionType: CommissionType | null

  commissionValue: number | null

  commissionAmount: number | null

  paidAmount: number

  payable: number
}

export interface DealerSummaryResponse {
  dealers: DealerSummary[]

  canManage: boolean

  canCreate: boolean
}

export interface DealerProjectOption {
  id: string
  name: string
  currency: string
}

export interface DealerPortalUserOption {
  id: string
  name: string
  type: string
}

export interface DealerBookingCreateResponse {
  bookingId: string
  status: string
}

export interface DealerBookingReviewResponse {
  status: string
  commissionAmount: number | null
}

export interface DealerPayoutResponse {
  id: string
  amount: number
  paidOn: string
}

export interface DealerDetailResponse {
  dealer: DealerSummary & { portalUserName: string | null }

  leads: DealerLead[]

  unassignedLeads: DealerLead[]

  bookings: DealerBooking[]

  rules: DealerCommissionRule[]

  projects: DealerProjectOption[]

  portalUsers: DealerPortalUserOption[]

  statement: {
    entries: DealerStatementEntry[]

    totalCommission: number

    totalPaid: number

    totalPayable: number
  }

  canManage: boolean

  canManageBookings: boolean

  canCreateBookings: boolean
}

export interface DealerInput {
  portalUserId: string

  companyName: string

  contactName: string

  email: string

  phone: string

  businessRegistration: string

  taxId: string

  address: string

  notes: string

  status: DealerStatus
}

export interface CommissionRuleInput {
  scope: CommissionScope

  projectId: string | null

  unitType: UnitType | null

  commissionType: CommissionType

  commissionValue: number
}

export interface DealerBookingInput {
  bookingReference: string

  customerName: string

  projectId: string

  unitType: UnitType

  bookingAmount: number

  bookingDate: string

  leadId: string | null
}

export interface CommissionPayoutInput {
  amount: number

  paidOn: string

  note: string
}

export const dealersApi = {
  list: (signal?: AbortSignal) =>
    api.get<DealerSummaryResponse>("/api/dealers", signal),

  create: (input: DealerInput) =>
    api.post<{ dealer: DealerSummary }>("/api/dealers", input),

  read: (id: string, signal?: AbortSignal) =>
    api.get<DealerDetailResponse>(`/api/dealers/${id}`, signal),

  update: (id: string, input: DealerInput) =>
    api.patch<{ dealer: DealerSummary }>(`/api/dealers/${id}`, input),

  assignLead: (id: string, leadId: string) =>
    api.post<{ ok: true }>(`/api/dealers/${id}/leads/${leadId}`),

  unassignLead: (id: string, leadId: string) =>
    api.delete<{ ok: true }>(`/api/dealers/${id}/leads/${leadId}`),

  createRule: (id: string, input: CommissionRuleInput) =>
    api.post<{ id: string }>(`/api/dealers/${id}/commission-rules`, input),

  updateRule: (id: string, ruleId: string, input: CommissionRuleInput) =>
    api.patch<{ id: string }>(
      `/api/dealers/${id}/commission-rules/${ruleId}`,
      input,
    ),

  deleteRule: (id: string, ruleId: string) =>
    api.delete<{ ok: true }>(`/api/dealers/${id}/commission-rules/${ruleId}`),

  createBooking: (id: string, input: DealerBookingInput) =>
    api.post<DealerBookingCreateResponse>(`/api/dealers/${id}/bookings`, input),

  reviewBooking: (
    id: string,
    bookingId: string,
    status: "confirmed" | "cancelled",
  ) =>
    api.patch<DealerBookingReviewResponse>(
      `/api/dealers/${id}/bookings/${bookingId}`,
      { status },
    ),

  payCommission: (
    id: string,
    bookingId: string,
    input: CommissionPayoutInput,
  ) =>
    api.post<DealerPayoutResponse>(
      `/api/dealers/${id}/bookings/${bookingId}/payments`,
      input,
    ),
}
