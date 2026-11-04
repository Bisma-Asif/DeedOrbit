/**
 * Audit log — the read-only, tenant-wide event trail.
 *
 * Nothing is written here: every booking, payment, price change, cancellation,
 * transfer, document action, and access attempt already lands in `audit_log` via
 * `writeAudit`. This route only reads that trail back and shapes it for review —
 * filtered by module, actor, and date, with per-facet counts so the page's
 * dropdowns can show what is actually in range.
 *
 * A row's module is *derived*, not stored: the same `CASE` the client categoriser
 * uses is compiled from `shared/audit.ts` and pushed into SQL, so `module` filters
 * and facet counts agree with the label the browser renders, and a row written
 * months ago is bucketed exactly like today's. Dates narrow `created_at` by its
 * `YYYY-MM-DD` prefix; the actor narrows by `actor_email`, which is the human
 * identity carried on every entry even when a session id has since been purged.
 *
 * The result is capped (most-recent-first) rather than cursor-paged, because the
 * shared `DataTable` sorts, searches, and pages what it is handed. `truncated`
 * says honestly when the cap was hit — a large window is never silently mistaken
 * for the whole trail.
 */

import { all, type SqlValue } from "../db.ts"

import { badRequest, type RequestContext } from "../http.ts"

import { requireAuth, requirePermission } from "../middleware.ts"

import {
  AUDIT_MODULE_IDS,
  AUDIT_MODULE_LABELS,
  AUDIT_MODULE_RULES,
  type AuditEntryView,
  type AuditFacet,
  type AuditListResponse,
  type AuditModuleId,
} from "../../shared/audit.ts"

const DEFAULT_LIMIT = 500

const MAX_LIMIT = 1000

const FACET_ACTOR_LIMIT = 100

function isIsoDay(value: string | null): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

/**
 * The `CASE` that maps a raw `action` string to a module id, compiled from the
 * shared rules. `substr(action,1,length(?)) = ?` is an exact prefix test (not a
 * `LIKE`, whose `_` would misread the prefixes that contain underscores), and the
 * branches are ordered so the same first-match wins as `categorizeAuditAction`.
 */

interface ModuleCase {
  sql: string

  params: SqlValue[]
}

function moduleCase(): ModuleCase {
  const branches: string[] = []

  const params: SqlValue[] = []

  for (const [module, prefix] of AUDIT_MODULE_RULES) {
    branches.push("WHEN substr(action,1,length(?))=? THEN ?")

    params.push(prefix, prefix, module)
  }

  return { sql: `CASE ${branches.join(" ")} ELSE 'other' END`, params }
}

function parseModule(
  raw: string | null,

  allowed: readonly string[],
): string | null {
  if (raw === null || raw === "") return null

  if (allowed.includes(raw)) return raw

  throw badRequest("That audit module is not recognised")
}

/** Reads and validates the incoming query into the pieces each SQL needs. */

interface AuditQuery {
  tenantId: string

  from: string | null

  to: string | null

  module: string | null

  actorEmail: string | null

  limit: number
}

function readQuery(
  ctx: RequestContext,

  tenantId: string,
): AuditQuery {
  const fromRaw = ctx.query.get("from")

  const toRaw = ctx.query.get("to")

  const limitRaw = Number(ctx.query.get("limit"))

  const actorRaw = ctx.query.get("actorEmail")

  return {
    tenantId,

    from: isIsoDay(fromRaw) ? fromRaw : null,

    to: isIsoDay(toRaw) ? toRaw : null,

    module: parseModule(ctx.query.get("module"), AUDIT_MODULE_IDS),

    actorEmail: actorRaw && actorRaw.trim() ? actorRaw.trim() : null,

    limit:
      Number.isFinite(limitRaw) && limitRaw > 0
        ? Math.min(Math.floor(limitRaw), MAX_LIMIT)
        : DEFAULT_LIMIT,
  }
}

/** `substr(created_at,1,10)` bounds, shared by the entries and facet queries. */

interface DateClause {
  sql: string

  params: SqlValue[]
}

function dateClause(q: AuditQuery): DateClause {
  const parts: string[] = ["tenant_id = ?"]

  const params: SqlValue[] = [q.tenantId]

  if (q.from) {
    parts.push("substr(created_at,1,10) >= ?")

    params.push(q.from)
  }

  if (q.to) {
    parts.push("substr(created_at,1,10) <= ?")

    params.push(q.to)
  }

  return { sql: `WHERE ${parts.join(" AND ")}`, params }
}

interface RawAuditRow {
  id: string

  action: string

  module: string

  actor_user_id: string | null

  actor_email: string | null

  target_type: string | null

  target_id: string | null

  detail: string | null

  ip_address: string | null

  created_at: string
}

interface ModuleCountRow {
  value: string

  count: number
}

interface ActorCountRow {
  value: string | null

  count: number
}

function parseDetail(value: string | null): Record<string, unknown> | null {
  if (!value) return null

  try {
    const parsed = JSON.parse(value) as unknown

    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function toEntry(row: RawAuditRow): AuditEntryView {
  const module = (AUDIT_MODULE_IDS as readonly string[]).includes(row.module)
    ? row.module as AuditModuleId
    : "other"

  return {
    id: row.id,

    action: row.action,

    module,

    moduleLabel: AUDIT_MODULE_LABELS[module],

    actorEmail: row.actor_email,

    actorUserId: row.actor_user_id,

    targetType: row.target_type,

    targetId: row.target_id,

    detail: parseDetail(row.detail),

    ip: row.ip_address,

    createdAt: row.created_at,
  }
}

// --- GET /api/audit-log ----------------------------------------------------

export async function listAuditLog(
  ctx: RequestContext,
): Promise<AuditListResponse> {
  const guarded = requirePermission(requireAuth(ctx), "audit", "view")

  const q = readQuery(ctx, guarded.tenantId)

  const mc = moduleCase()

  const dated = dateClause(q)

  // A single `tagged` projection reused by the entries query and both facet

  // queries, so a row is bucketed identically everywhere and the params for the

  // CTE (CASE branches, then the date predicate) are assembled once.

  const cteSql =
    `WITH tagged AS (SELECT id, action, ${mc.sql} AS module, actor_user_id, ` +
    `actor_email, target_type, target_id, detail, ip_address, created_at ` +
    `FROM audit_log ${dated.sql})`

  const cteParams: SqlValue[] = [...mc.params, ...dated.params]

  const narrow: string[] = []

  const narrowParams: SqlValue[] = []

  if (q.module) {
    narrow.push("module = ?")

    narrowParams.push(q.module)
  }

  if (q.actorEmail) {
    narrow.push("actor_email = ?")

    narrowParams.push(q.actorEmail)
  }

  const narrowSql = narrow.length ? `WHERE ${narrow.join(" AND ")}` : ""

  const entryRows = all<RawAuditRow>(
    `${cteSql} SELECT id, action, module, actor_user_id, actor_email, target_type, ` +
      `target_id, detail, ip_address, created_at FROM tagged ${narrowSql} ` +
      `ORDER BY created_at DESC LIMIT ?`,

    ...cteParams,

    ...narrowParams,

    q.limit,
  )

  const moduleRows = all<ModuleCountRow>(
    `${cteSql} SELECT module AS value, COUNT(*) AS count FROM tagged GROUP BY module`,

    ...cteParams,
  )

  const actorRows = all<ActorCountRow>(
    `${cteSql} SELECT actor_email AS value, COUNT(*) AS count FROM tagged ` +
      `WHERE actor_email IS NOT NULL GROUP BY actor_email ` +
      `ORDER BY count DESC LIMIT ?`,

    ...cteParams,

    FACET_ACTOR_LIMIT,
  )

  const countsByModule = new Map<string, number>()

  for (const row of moduleRows) countsByModule.set(row.value, Number(row.count))

  // Facets list every module with a match in range, in the canonical filter order

  // (so the dropdown never reshuffles as data changes), then `other` last.

  const moduleFacets: AuditFacet[] = AUDIT_MODULE_IDS.filter(
    (module) => (countsByModule.get(module) ?? 0) > 0,
  ).map((module) => ({
    value: module,

    label: AUDIT_MODULE_LABELS[module],

    count: countsByModule.get(module) ?? 0,
  }))

  const actorFacets: AuditFacet[] = actorRows

    .filter((row) => row.value)

    .map((row) => ({
      value: String(row.value),

      label: String(row.value),

      count: Number(row.count),
    }))

  return {
    entries: entryRows.map(toEntry),

    moduleFacets,

    actorFacets,

    limit: q.limit,

    truncated: entryRows.length >= q.limit,
  }
}
