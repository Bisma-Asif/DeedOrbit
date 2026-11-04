/**
 * Typed client for the Reports section.
 *
 * Mirrors `server/routes/reports.ts`. The catalog lists the eleven report types and
 * the filters each one honours; running a report sends the active filter set as a
 * query string and returns a generic `{ columns, rows, totals, meta }` result the
 * page renders in a `DataTable` and exports verbatim.
 *
 * Only the filters a report actually supports are ever sent — a filter the server
 * would ignore (or a branch on a report with no user attribution) is dropped here so
 * the request and the on-screen controls stay honest about what narrows the rows.
 */

import type {
  ReportFilter,
  ReportId,
  ReportResult,
  ReportSummary,
} from "@shared/reports"

import { api } from "./api"

/** A branch option for the picker, carried on the catalog so it needs no `settings` grant. */

export interface ReportBranchOption {
  id: string

  name: string
}

export interface ReportCatalogResponse {
  reports: ReportSummary[]

  branches: ReportBranchOption[]
}

export interface ReportQuery {
  from?: string | null

  to?: string | null

  projectId?: string | null

  branchId?: string | null
}

/** Builds `?from=…&to=…&projectId=…&branchId=…`, skipping blanks and unsupported keys. */

export function reportQuery(
  query: ReportQuery,

  supported: ReportFilter[],
): string {
  const params = new URLSearchParams()

  const date = supported.includes("date")

  const project = supported.includes("project")

  const branch = supported.includes("branch")

  if (date && query.from) params.set("from", query.from)

  if (date && query.to) params.set("to", query.to)

  if (project && query.projectId) params.set("projectId", query.projectId)

  if (branch && query.branchId) params.set("branchId", query.branchId)

  const search = params.toString()

  return search ? `?${search}` : ""
}

export const reportsApi = {
  catalog: (signal?: AbortSignal) =>
    api.get<ReportCatalogResponse>("/api/reports", signal),

  run: (
    id: ReportId,

    query: ReportQuery,

    supported: ReportFilter[],

    signal?: AbortSignal,
  ) =>
    api.get<ReportResult>(
      `/api/reports/${id}${reportQuery(query, supported)}`,

      signal,
    ),
}
