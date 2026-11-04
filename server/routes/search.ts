/**
 * Global search — one box across projects, units, customers, and bookings.
 *
 * The top bar's search is deliberately permission-scoped: each group is only
 * returned when the caller holds the matching module's `view` grant, so a sales
 * agent's dropdown never offers a record they could not open. Every group is capped
 * at eight hits, ordered by the most identifying field, and each hit carries the
 * in-app hash route it links to.
 *
 * The query is treated as a literal: `%` and `_` are escaped so a stray wildcard in
 * a typed term cannot widen the match.
 */

import { all, type SqlValue } from "../db.ts"

import type { RequestContext } from "../http.ts"

import { requireAuth } from "../middleware.ts"

import type { SearchHit, SearchResults } from "../../shared/reports.ts"

const GROUP_LIMIT = 8

const MIN_QUERY = 2

/** Escapes LIKE wildcards and backslashes so a typed term matches literally. */

function likeTerm(raw: string): string {
  const trimmed = raw.trim()

  if (trimmed.length < MIN_QUERY) return ""

  return `%${trimmed.replace(/[\\%_]/g, (char) => `\\${char}`)}%`
}

function num(value: SqlValue): string {
  return value === null || value === undefined ? "" : String(value)
}

export async function globalSearch(
  ctx: RequestContext,
): Promise<SearchResults> {
  const guarded = requireAuth(ctx)

  const tenantId = guarded.tenantId

  const term = likeTerm(ctx.query.get("q") ?? "")

  const empty: SearchHit[] = []

  if (!term) {
    return { query: "", projects: [], units: [], customers: [], bookings: [] }
  }

  const projects: SearchHit[] = guarded.can("projects", "view")
    ? all<Record<string, SqlValue>>(
        `SELECT id, name, COALESCE(code, developer) AS sub
          FROM projects
          WHERE tenant_id = ? AND (name LIKE ? ESCAPE '\\' OR code LIKE ? ESCAPE '\\')
          ORDER BY name COLLATE NOCASE
          LIMIT ${GROUP_LIMIT}`,

        tenantId,

        term,

        term,
      ).map((row) => ({
        id: num(row.id),

        label: num(row.name),

        sublabel: num(row.sub),

        path: `/projects/${num(row.id)}`,
      }))
    : empty

  const units: SearchHit[] = guarded.can("inventory", "view")
    ? all<Record<string, SqlValue>>(
        `SELECT u.id, u.unit_code, u.project_id, p.name AS project
          FROM inventory_units u
          JOIN projects p ON p.id = u.project_id AND p.tenant_id = u.tenant_id
          WHERE u.tenant_id = ? AND u.unit_code LIKE ? ESCAPE '\\'
          ORDER BY p.name, u.unit_code COLLATE NOCASE
          LIMIT ${GROUP_LIMIT}`,

        tenantId,

        term,
      ).map((row) => ({
        id: num(row.id),

        label: num(row.unit_code),

        sublabel: num(row.project),

        path: `/projects/${num(row.project_id)}`,
      }))
    : empty

  const customers: SearchHit[] = guarded.can("customers", "view")
    ? all<Record<string, SqlValue>>(
        `SELECT id, full_name, COALESCE(phone, email, '') AS sub
          FROM customers
          WHERE tenant_id = ?
            AND (full_name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\')
          ORDER BY full_name COLLATE NOCASE
          LIMIT ${GROUP_LIMIT}`,

        tenantId,

        term,

        term,
      ).map((row) => ({
        id: num(row.id),

        label: num(row.full_name),

        sublabel: num(row.sub),

        path: `/customers/${num(row.id)}`,
      }))
    : empty

  const bookings: SearchHit[] = guarded.can("bookings", "view")
    ? all<Record<string, SqlValue>>(
        `SELECT b.id, b.reference,
                COALESCE(b.customer_name, '') || ' · ' || COALESCE(b.unit_code, '') AS sub
          FROM bookings b
          WHERE b.tenant_id = ?
            AND (b.reference LIKE ? ESCAPE '\\' OR b.customer_name LIKE ? ESCAPE '\\'
              OR b.unit_code LIKE ? ESCAPE '\\')
          ORDER BY b.booking_date DESC
          LIMIT ${GROUP_LIMIT}`,

        tenantId,

        term,

        term,

        term,
      ).map((row) => ({
        id: num(row.id),

        label: num(row.reference),

        sublabel: num(row.sub),

        path: `/bookings/${num(row.id)}`,
      }))
    : empty

  return {
    query: term,

    projects,

    units,

    customers,

    bookings,
  }
}
