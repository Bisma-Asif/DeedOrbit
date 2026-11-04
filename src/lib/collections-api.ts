/**
 * Typed client for the collections dashboard endpoints.
 *
 * Mirrors `server/routes/collections.ts`. The summary and the overdue table are pure
 * reads that run the late-fee sweep before answering, so a fee owed on a line that just
 * turned overdue is charged and shown the same moment it is looked at. Officer assignment
 * needs `payments.edit`; the monthly targets live under the settings routes.
 */

import type {
  AgingBucket,
  CollectionsSummary,
  OverdueList,
} from "@shared/collections"

import { api } from "./api"

export interface OverdueFilters {
  bucket?: AgingBucket | null

  officerUserId?: string | null

  projectId?: string | null
}

export interface AssignResponse {
  installmentId: string

  officerUserId: string | null
}

/** One officer's monthly goal, as the settings editor lists and saves them. */

export interface CollectionTarget {
  officerUserId: string

  officerName: string

  period: string

  targetAmount: number
}

export interface CollectionTargetsResponse {
  targets: CollectionTarget[]
}

export interface CollectionTargetInput {
  officerUserId: string

  period: string

  targetAmount: number
}

function overdueQuery(filters: OverdueFilters): string {
  const params = new URLSearchParams()

  if (filters.bucket) params.set("bucket", filters.bucket)

  if (filters.officerUserId) params.set("officer", filters.officerUserId)

  if (filters.projectId) params.set("projectId", filters.projectId)

  const qs = params.toString()

  return qs ? `?${qs}` : ""
}

export const collectionsApi = {
  summary: (signal?: AbortSignal) =>
    api.get<CollectionsSummary>("/api/collections/summary", signal),

  overdue: (filters: OverdueFilters = {}, signal?: AbortSignal) =>
    api.get<OverdueList>(
      `/api/collections/overdue${overdueQuery(filters)}`,

      signal,
    ),

  assign: (installmentId: string, officerUserId: string | null) =>
    api.post<AssignResponse>(
      `/api/payment-installments/${installmentId}/assign`,

      { officerUserId: officerUserId ?? "" },
    ),

  getTargets: (signal?: AbortSignal) =>
    api.get<CollectionTargetsResponse>(
      "/api/settings/collection-targets",

      signal,
    ),

  saveTargets: (targets: CollectionTargetInput[]) =>
    api.patch<CollectionTargetsResponse>(
      "/api/settings/collection-targets",

      { targets },
    ),
}
