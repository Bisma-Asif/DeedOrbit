/**
 * Typed client for the maker-checker approval endpoints.
 *
 * Mirrors `server/routes/approvals.ts` and the policy section of
 * `server/routes/organization.ts`. The queue is generic — one row shape, one list —
 * so a single read/decide surface serves every action; only the decoded `payload`
 * differs by `actionKey`, which the detail page narrows with the shared payload
 * interfaces rather than a client-side guess.
 *
 * A decision is a POST with an optional (approval) or required (rejection) note; the
 * server enforces maker-checker and the pending-only rule, so a stale or self-raised
 * attempt fails on the way back rather than silently doing nothing.
 */

import type {
  ApprovalAction,
  ApprovalStatus,
  BookingApprovalPayload,
  CancellationApprovalPayload,
  LateFeeWaiverApprovalPayload,
  RefundApprovalPayload,
  TransferApprovalPayload,
} from "@shared/approvals"

import { api } from "./api"

/** One request in the queue, as the server stores it with its payload decoded. */

/** The decoded body of any approval action; narrowed by `actionKey` at display. */

export type ApprovalPayload = BookingApprovalPayload | CancellationApprovalPayload | RefundApprovalPayload | LateFeeWaiverApprovalPayload | TransferApprovalPayload

export interface ApprovalItem {
  id: string

  actionKey: ApprovalAction

  status: ApprovalStatus

  summary: string | null

  entityType: string | null

  resultEntityId: string | null

  requestedByUserId: string

  requestedByName: string

  requestedAt: string

  decidedByUserId: string | null

  decidedByName: string | null

  decisionNote: string | null

  decidedAt: string | null

  updatedAt: string

  /** The validated body the action replays; narrowed by `actionKey` at display. */

  payload: ApprovalPayload | null
}

export interface ApprovalListResponse {
  approvals: ApprovalItem[]

  canApprove: boolean

  currency: string

  truncated: boolean
}

export interface ApprovalDetailResponse {
  approval: ApprovalItem

  currency: string
}

/** One policy row: whether the action is held, and above what amount when it carries one. */

export interface ApprovalPolicy {
  actionKey: ApprovalAction

  label: string

  enabled: boolean

  thresholdAmount: number

  hasThreshold: boolean
}

export interface ApprovalPoliciesResponse {
  policies: ApprovalPolicy[]

  canEdit: boolean
}

export const approvalsApi = {
  list: (status: ApprovalStatus | null, signal?: AbortSignal) =>
    api.get<ApprovalListResponse>(
      status
        ? `/api/approvals?status=${encodeURIComponent(status)}`
        : "/api/approvals",

      signal,
    ),

  read: (id: string, signal?: AbortSignal) =>
    api.get<ApprovalDetailResponse>(`/api/approvals/${id}`, signal),

  approve: (id: string, decisionNote?: string) =>
    api.post<ApprovalDetailResponse>(`/api/approvals/${id}/approve`, {
      ...(decisionNote && decisionNote.trim() !== "" ? { decisionNote } : {}),
    }),

  reject: (id: string, decisionNote: string) =>
    api.post<ApprovalDetailResponse>(`/api/approvals/${id}/reject`, {
      decisionNote,
    }),
}

export const approvalsPoliciesApi = {
  read: (signal?: AbortSignal) =>
    api.get<ApprovalPoliciesResponse>(
      "/api/settings/approval-policies",
      signal,
    ),

  update: (policies: ApprovalPolicyInput[]) =>
    api.patch<ApprovalPoliciesResponse>("/api/settings/approval-policies", {
      policies,
    }),
}

/** One policy submitted by the settings card. Named so oxfmt cannot collapse it. */

export interface ApprovalPolicyInput {
  actionKey: ApprovalAction

  enabled: boolean

  thresholdAmount: number
}
