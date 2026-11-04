/**
 * Typed client for the read-only Audit Log.
 *
 * Mirrors `server/routes/audit.ts`. The page hands over the active module, actor,
 * and date filters; the server returns the matching most-recent entries plus the
 * per-facet counts that keep its own dropdowns honest. Blanks are dropped so an
 * unset filter sends nothing rather than an empty value the server would ignore
 * anyway.
 */

import type { AuditListResponse, AuditModuleId } from "@shared/audit"

import { api } from "./api"

export interface AuditQuery {
  module?: AuditModuleId | null

  actorEmail?: string | null

  from?: string | null

  to?: string | null

  limit?: number
}

/** Builds `?module=…&actorEmail=…&from=…&to=…&limit=…`, skipping blanks. */

export function auditQueryString(query: AuditQuery): string {
  const params = new URLSearchParams()

  if (query.module) params.set("module", query.module)

  if (query.actorEmail) params.set("actorEmail", query.actorEmail)

  if (query.from) params.set("from", query.from)

  if (query.to) params.set("to", query.to)

  if (query.limit) params.set("limit", String(query.limit))

  const search = params.toString()

  return search ? `?${search}` : ""
}

export const auditApi = {
  list: (query: AuditQuery, signal?: AbortSignal) =>
    api.get<AuditListResponse>(
      `/api/audit-log${auditQueryString(query)}`,

      signal,
    ),
}
