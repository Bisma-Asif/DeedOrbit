/**
 * Typed client for the journal export.
 *
 * Mirrors `server/routes/journal.ts`. A single read composes the flat, one-line
 * per event statement for a date range and returns it alongside the totals per
 * account, so the panel can render a preview and drive CSV/Excel/PDF exports
 * from the same payload.
 */

import type { JournalResponse } from "@shared/journal"

import { api } from "./api"

export interface JournalRangeFilters {
  from: string

  to: string
}

export const journalApi = {
  read: (filters: JournalRangeFilters, signal?: AbortSignal) => {
    const params = new URLSearchParams()

    params.set("from", filters.from)

    params.set("to", filters.to)

    return api.get<JournalResponse>(`/api/journal?${params.toString()}`, signal)
  },
}
