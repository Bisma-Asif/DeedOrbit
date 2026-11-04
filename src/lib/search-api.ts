/**
 * Typed client for the top-bar global search.
 *
 * Mirrors `server/routes/search.ts`. The server returns each group already narrowed
 * to the modules the caller may view, so the dropdown simply renders whatever is
 * non-empty. A term shorter than two characters yields no groups, and the caller
 * debounces before firing so a keystroke does not hit the API.
 */

import type { SearchResults } from "@shared/reports"

import { api } from "./api"

export const searchApi = {
  run: (query: string, signal?: AbortSignal) =>
    api.get<SearchResults>(
      `/api/search?q=${encodeURIComponent(query)}`,

      signal,
    ),
}
