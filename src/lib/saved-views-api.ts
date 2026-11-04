/**
 * Typed client for saved views.
 *
 * Mirrors `server/routes/saved-views.ts`. A view is personal, per-user, and scoped
 * to one table; its `state` is an opaque JSON string the owning page produced. The
 * server only checks it parses and stays within size limits, so a page persists
 * whatever filter/sort/column shape it needs without a server change.
 */

import type { SavedView, SavedViewPayload } from "@shared/saved-views"

import { api } from "./api"

/** The server's create envelope: the stored view echoed back. */

interface SavedViewCreateResponse {
  ok: true

  view: SavedView
}

export const savedViewsApi = {
  list: (scope: string, signal?: AbortSignal) =>
    api.get<{ views: SavedView[] }>(
      `/api/saved-views?scope=${encodeURIComponent(scope)}`,

      signal,
    ),

  create: (payload: SavedViewPayload) =>
    api.post<SavedViewCreateResponse>("/api/saved-views", payload),

  remove: (id: string) => api.delete<{ ok: true }>(`/api/saved-views/${id}`),
}
