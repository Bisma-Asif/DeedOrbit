/**
 * Saved views — the personal, per-table "keep this filter combination" store.
 *
 * A saved view is scoped to the user who created it and to one table (`scope`). The
 * configuration is an opaque JSON `state` string the owning page produced; the server
 * checks only that it parses and stays within size limits, never its contents, so a
 * table can persist whatever shape it needs. Uniqueness is (user, scope, name): a
 * duplicate name for the same table returns a 422 rather than silently overwriting,
 * so a name like "Q3 overdue" cannot quietly replace a view someone relies on.
 *
 * This is gated by authentication alone. It holds no workspace data — only one
 * person's filter preferences — so no module grant applies.
 */

import { all, get, run } from "../db.ts"

import {
  badRequest,
  conflict,
  notFound,
  readJsonBody,
  type RequestContext,
} from "../http.ts"

import { requireAuth, writeAudit } from "../middleware.ts"

import { newId } from "../crypto.ts"

import {
  SAVED_VIEW_STATE_MAX,
  isSavedViewScope,
  type SavedView,
} from "../../shared/saved-views.ts"

const NAME_MIN = 1

const NAME_MAX = 60

const nowISO = () => new Date().toISOString()

function toView(row: Record<string, unknown>): SavedView {
  return {
    id: String(row.id),

    scope: String(row.scope),

    name: String(row.name),

    state: String(row.state),

    createdAt: String(row.created_at),
  }
}

export async function listSavedViews(ctx: RequestContext) {
  const guarded = requireAuth(ctx)

  const scope = ctx.query.get("scope") ?? ""

  if (!isSavedViewScope(scope)) {
    throw badRequest("That saved-view scope is not recognised")
  }

  const rows = all<Record<string, unknown>>(
    `SELECT id, scope, name, state, created_at
      FROM saved_views
      WHERE tenant_id = ? AND user_id = ? AND scope = ?
      ORDER BY created_at DESC`,

    guarded.tenantId,

    guarded.userId,

    scope,
  )

  return { views: rows.map(toView) }
}

export async function createSavedView(ctx: RequestContext) {
  const guarded = requireAuth(ctx)

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const scope = typeof body.scope === "string" ? body.scope : ""

  if (!isSavedViewScope(scope)) {
    throw badRequest("That saved-view scope is not recognised", {
      scope: "Choose a valid table.",
    })
  }

  const name = typeof body.name === "string" ? body.name.trim() : ""

  if (name.length < NAME_MIN || name.length > NAME_MAX) {
    throw badRequest("Give the view a name", {
      name: `Use between ${NAME_MIN} and ${NAME_MAX} characters.`,
    })
  }

  const state = typeof body.state === "string" ? body.state : ""

  if (state.length === 0 || state.length > SAVED_VIEW_STATE_MAX) {
    throw badRequest("There is nothing to save for this view", {
      state: "The saved state is empty or too large.",
    })
  }

  try {
    JSON.parse(state)
  } catch {
    throw badRequest("The saved state is not valid", {
      state: "Could not read the filter settings.",
    })
  }

  const existing = get<{ id: string }>(
    `SELECT id FROM saved_views
      WHERE tenant_id = ? AND user_id = ? AND scope = ? AND name = ? COLLATE NOCASE`,

    guarded.tenantId,

    guarded.userId,

    scope,

    name,
  )

  if (existing) {
    throw conflict("You already have a saved view with that name", {
      name: "Pick a different name for this view.",
    })
  }

  const id = newId("view")

  run(
    `INSERT INTO saved_views (id, tenant_id, user_id, scope, name, state, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,

    id,

    guarded.tenantId,

    guarded.userId,

    scope,

    name,

    state,

    nowISO(),
  )

  writeAudit(guarded, "saved_views.create", "saved_view", id, { scope, name })

  return { ok: true, view: { id, scope, name, state, createdAt: nowISO() } }
}

export async function deleteSavedView(ctx: RequestContext) {
  const guarded = requireAuth(ctx)

  const id = ctx.params.id ?? ""

  const existing = get<{ id: string }>(
    `SELECT id FROM saved_views
      WHERE tenant_id = ? AND user_id = ? AND id = ?`,

    guarded.tenantId,

    guarded.userId,

    id,
  )

  if (!existing) throw notFound("That saved view does not exist")

  run(
    "DELETE FROM saved_views WHERE tenant_id = ? AND user_id = ? AND id = ?",

    guarded.tenantId,

    guarded.userId,

    id,
  )

  writeAudit(guarded, "saved_views.delete", "saved_view", id)

  return { ok: true }
}
