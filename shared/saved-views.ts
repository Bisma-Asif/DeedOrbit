/**
 * Saved views — the vocabulary behind "keep this filter combination for reuse".
 *
 * A saved view is personal, per-user, and scoped to one data table. The server
 * stores an opaque JSON `state` string the owning page defines (its filters, the
 * search text, the sort, and any column visibility); it never interprets that
 * state, so a table can persist whatever shape it needs without a server change.
 *
 * Scopes are stable string ids named after the module or the specific table, so a
 * view saved against the overdue table is not offered on the bookings list.
 */

/** The tables that offer saved views. Keep in step with the pages that mount them. */

export const SAVED_VIEW_SCOPES = [
  "bookings",

  "expenses",

  "vendors",

  "campaigns",

  "tickets",

  "inventory",

  "collections-overdue",
] as const

export type SavedViewScope = typeof SAVED_VIEW_SCOPES[number]

export function isSavedViewScope(value: unknown): value is SavedViewScope {
  return (
    typeof value === "string" &&
    (SAVED_VIEW_SCOPES as readonly string[]).includes(value)
  )
}

/** A name is a short human label; 60 characters is generous for one. */

export const SAVED_VIEW_NAME_MIN = 1

export const SAVED_VIEW_NAME_MAX = 60

/** The whole persisted state must stay small — it is a filter set, not a dataset. */

export const SAVED_VIEW_STATE_MAX = 4000

/** What the client sends to create a view. */

export interface SavedViewPayload {
  scope: string

  name: string

  /** A JSON string the owning page produced and will re-read. */

  state: string
}

/** A stored view as returned to the client. */

export interface SavedView {
  id: string

  scope: string

  name: string

  state: string

  createdAt: string
}
