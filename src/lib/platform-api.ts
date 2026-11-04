/**
 * Typed client for the Platform Super Admin API.
 *
 * Every response shape is the shared view contract itself — the platform
 * screens render exactly what the server derived, so a status can never read
 * differently in the directory than on the detail page. Request bodies are
 * named interfaces because `oxfmt` collapses single-line object type literals.
 */

import { api } from "./api.ts"

import type {
  PlatformMutationResponse,
  PlatformTenantDetailResponse,
  PlatformTenantListResponse,
} from "@shared/platform"

export type {
  PlatformBillingEventView,
  PlatformMutationResponse,
  PlatformTenantDetailResponse,
  PlatformTenantListResponse,
  PlatformTenantView,
  PlatformTotals,
  PlatformUsage,
} from "@shared/platform"

export interface PlatformMoneyInput {
  amount?: number

  note?: string
}

export interface PlatformGraceInput {
  days: number

  reason: string
}

export interface PlatformSuspensionInput {
  reason?: string
}

export interface PlatformReactivationInput {
  note?: string
}

export interface PlatformPlanInput {
  plan: string
}

export const platformApi = {
  tenants: (signal?: AbortSignal) =>
    api.get<PlatformTenantListResponse>("/api/platform/tenants", signal),

  tenant: (id: string, signal?: AbortSignal) =>
    api.get<PlatformTenantDetailResponse>(
      `/api/platform/tenants/${encodeURIComponent(id)}`,

      signal,
    ),

  invoice: (id: string, input: PlatformMoneyInput = {}) =>
    api.post<PlatformMutationResponse>(
      `/api/platform/tenants/${encodeURIComponent(id)}/invoice`,

      input,
    ),

  payment: (id: string, input: PlatformMoneyInput = {}) =>
    api.post<PlatformMutationResponse>(
      `/api/platform/tenants/${encodeURIComponent(id)}/payment`,

      input,
    ),

  markDue: (id: string, input: { note?: string } = {}) =>
    api.post<PlatformMutationResponse>(
      `/api/platform/tenants/${encodeURIComponent(id)}/due`,

      input,
    ),

  grace: (id: string, input: PlatformGraceInput) =>
    api.post<PlatformMutationResponse>(
      `/api/platform/tenants/${encodeURIComponent(id)}/grace`,

      input,
    ),

  suspend: (id: string, input: PlatformSuspensionInput = {}) =>
    api.post<PlatformMutationResponse>(
      `/api/platform/tenants/${encodeURIComponent(id)}/suspend`,

      input,
    ),

  reactivate: (id: string, input: PlatformReactivationInput = {}) =>
    api.post<PlatformMutationResponse>(
      `/api/platform/tenants/${encodeURIComponent(id)}/reactivate`,

      input,
    ),

  setPlan: (id: string, input: PlatformPlanInput) =>
    api.post<PlatformMutationResponse>(
      `/api/platform/tenants/${encodeURIComponent(id)}/plan`,

      input,
    ),
}
