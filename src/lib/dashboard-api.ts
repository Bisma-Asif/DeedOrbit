/**
 * Typed client for the post-login command center.
 *
 * `overview` answers every widget in one call; `widget` re-answers a single
 * widget through the server's cached pipeline for the per-card retry button.
 * The sample-data pair is the labelled demo loader the get-started state
 * offers — both are refused by the server unless the role holds
 * `settings.edit`.
 */

import type { DashboardPeriod, DashboardSummary } from "@shared/reports"

import type {
  DashboardOverview,
  DashboardRange,
  DashboardWidgetKey,
  WidgetEnvelope,
} from "@shared/dashboard"

import { api } from "./api"

export interface DashboardFilters {
  range: DashboardRange

  from?: string

  to?: string

  projectId?: string | null
}

/** Reply from either sample-data route: how many rows the operation touched. */
interface SampleMutationResult {
  ok: boolean

  rows: number
}

/** One table's share of the dataset that is currently loaded. */
export interface SampleTableCount {
  table: string

  rows: number
}

/** A seeded demo login, named only to somebody who can load or remove the set. */
export interface SampleLogin {
  email: string

  name: string

  role: string
}

/** Reply from `GET /api/dashboard/sample-data`. */
export interface SampleDataStatus {
  active: boolean

  rows: number

  tables: SampleTableCount[]

  canManage: boolean

  demoWorkspace: boolean

  password: string | null

  logins: SampleLogin[]
}

export function filtersQuery(filters: DashboardFilters): string {
  const params = new URLSearchParams({ range: filters.range })

  if (filters.range === "custom" && filters.from && filters.to) {
    params.set("from", filters.from)

    params.set("to", filters.to)
  }

  if (filters.projectId) params.set("projectId", filters.projectId)

  return params.toString()
}

export interface WidgetResult {
  key: string

  meta: DashboardOverview["meta"]

  visible: DashboardOverview["visible"]

  kpiKeys: DashboardOverview["kpiKeys"]

  envelope: WidgetEnvelope<unknown>
}

export const dashboardApi = {
  summary: (period: DashboardPeriod, signal?: AbortSignal) =>
    api.get<DashboardSummary>(
      `/api/dashboard/summary?period=${period}`,

      signal,
    ),

  overview: (filters: DashboardFilters, signal?: AbortSignal) =>
    api.get<DashboardOverview>(
      `/api/dashboard/overview?${filtersQuery(filters)}`,

      signal,
    ),

  widget: (
    key: DashboardWidgetKey | "checklist" | "documentVerification",

    filters: DashboardFilters,

    signal?: AbortSignal,
  ) =>
    api.get<WidgetResult>(
      `/api/dashboard/widget?key=${key}&${filtersQuery(filters)}`,

      signal,
    ),

  sampleStatus: (signal?: AbortSignal) =>
    api.get<SampleDataStatus>("/api/dashboard/sample-data", signal),

  loadSample: () =>
    api.post<SampleMutationResult>("/api/dashboard/sample-data/load"),

  removeSample: () =>
    api.post<SampleMutationResult>("/api/dashboard/sample-data/remove"),
}
