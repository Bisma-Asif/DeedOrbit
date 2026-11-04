/**
 * Typed client for the late-fee endpoints.
 *
 * Mirrors `server/routes/late-fees.ts`. The rule is one tenant-wide configuration read
 * and written through the settings routes; the waiver raises a mandatory approval and
 * returns the held request rather than reversing anything on the spot. The rule object
 * reads `configured: false` with sensible defaults when the workspace has never saved one.
 */

import type { LateFeeMode } from "@shared/late-fees"

import { api } from "./api"

/** One late-fee rule, as stored and as the settings panel edits it. */

export interface LateFeeRules {
  enabled: boolean

  mode: LateFeeMode

  amount: number

  percentBps: number

  graceDays: number

  maxAssessments: number
}

export interface LateFeeRulesResponse {
  rules: LateFeeRules

  configured: boolean
}

export interface WaiverResponse {
  assessmentId: string

  approvalId: string

  pending: true
}

export const lateFeesApi = {
  getRules: (signal?: AbortSignal) =>
    api.get<LateFeeRulesResponse>("/api/settings/late-fees", signal),

  saveRules: (rules: LateFeeRules) =>
    api.patch<LateFeeRulesResponse>("/api/settings/late-fees", rules),

  /** Hold an applied fee for a waiver sign-off; nothing reverses until it is approved. */

  requestWaiver: (assessmentId: string, reason: string) =>
    api.post<WaiverResponse>(
      `/api/late-fee-assessments/${assessmentId}/waive`,

      { reason },
    ),
}
