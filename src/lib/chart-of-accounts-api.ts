/**
 * Typed client for the chart-of-accounts mapping.
 *
 * Mirrors `server/routes/chart-of-accounts.ts`. Every read returns the full
 * closed list of sources — an unmapped source arrives as an empty code, so the
 * panel never has to reconcile a partial set. A write takes the whole map back,
 * and the server upserts every row in one transaction so a half-saved chart
 * cannot leave the journal export with gaps.
 */

import type { CoaMapping, CoaSource } from "@shared/chart-of-accounts"

import { api } from "./api"

export interface ChartOfAccountsRow {
  source: CoaSource

  accountCode: string

  label: string
}

export interface ChartOfAccountsResponse {
  mappings: ChartOfAccountsRow[]
}

export const chartOfAccountsApi = {
  read: (signal?: AbortSignal) =>
    api.get<ChartOfAccountsResponse>("/api/settings/chart-of-accounts", signal),

  save: (mappings: CoaMapping[]) =>
    api.patch<ChartOfAccountsResponse>("/api/settings/chart-of-accounts", {
      mappings,
    }),
}
