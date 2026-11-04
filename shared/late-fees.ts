/**
 * Late-fee and penalty rules, shared by the server and the client.
 *
 * A rule is one tenant-wide configuration: whether a fee is charged at all, whether it
 * is a flat amount or a percentage of the outstanding balance, how many days past the
 * due date must elapse before it bites (the grace period), and how many times a single
 * installment may be assessed. The percentage is stored in basis points — hundredths of
 * a percent — so a 1.5% rate is the integer 150 and the whole money path stays in integers.
 *
 * Fees are never stored on the installment; they are separate assessment rows written by
 * a sweep, and a waiver (which must be approved) reverses one. Nothing here touches the
 * plan's generated schedule.
 */

import { UNIT_PRICE_MAX } from "./inventory.ts"

/** How a fee's size is computed. */

export const LATE_FEE_MODES = ["fixed", "percent"] as const

export type LateFeeMode = typeof LATE_FEE_MODES[number]

export const LATE_FEE_MODE_LABELS: Record<LateFeeMode, string> = {
  fixed: "Fixed amount",

  percent: "Percentage of balance",
}

export function isLateFeeMode(value: unknown): value is LateFeeMode {
  return (
    typeof value === "string" &&
    (LATE_FEE_MODES as readonly string[]).includes(value)
  )
}

/** The states an assessment can be in. `pending_waiver` means a waiver awaits approval. */

export const LATE_FEE_ASSESSMENT_STATUSES = [
  "applied",

  "pending_waiver",

  "waived",
] as const

export type LateFeeAssessmentStatus = typeof LATE_FEE_ASSESSMENT_STATUSES[number]

export const LATE_FEE_ASSESSMENT_STATUS_LABELS: Record<LateFeeAssessmentStatus, string> =
  {
    applied: "Applied",

    pending_waiver: "Waiver pending",

    waived: "Waived",
  }

export const LATE_FEE_ASSESSMENT_STATUS_TONES: Record<LateFeeAssessmentStatus, "danger" | "pending" | "success"> =
  {
    applied: "danger",

    pending_waiver: "pending",

    waived: "success",
  }

/** Bounds. A rate is 0–100% in basis points; a grace period caps at a year. */

export const PERCENT_BPS_MIN = 0

export const PERCENT_BPS_MAX = 10000

export const LATE_FEE_AMOUNT_MAX = UNIT_PRICE_MAX

export const GRACE_DAYS_MIN = 0

export const GRACE_DAYS_MAX = 365

export const MAX_ASSESSMENTS_MIN = 0

export const MAX_ASSESSMENTS_MAX = 12

export const WAIVER_REASON_MAX = 500
