/**
 * Collections dashboard vocabulary, shared by the server and the client.
 *
 * Recovery is read off the schedule rather than stored: which installments fall due in
 * the next window, and which are overdue and how deep into delinquency. Aging buckets
 * are closed-left / open-right day ranges measured from the installment's due date
 * against the tenant's own day, so a line is classified the same way for everyone in the
 * workspace. The summary and the overdue table shapes live here so the dashboard and its
 * endpoint cannot drift apart.
 */

/** The four delinquency bands, by days past due. */

export const AGING_BUCKETS = ["0-30", "31-60", "61-90", "90+"] as const

export type AgingBucket = typeof AGING_BUCKETS[number]

export const AGING_BUCKET_LABELS: Record<AgingBucket, string> = {
  "0-30": "1–30 days",

  "31-60": "31–60 days",

  "61-90": "61–90 days",

  "90+": "90+ days",
}

/**
 * The lower bound, in days past due, that puts a line in each bucket. A line exactly 30
 * days over is still `0-30`; one at 31 has crossed into `31-60`. The bounds ascend, so a
 * bucket is `[this, next)`.
 */

export const AGING_BUCKET_FLOORS: Record<AgingBucket, number> = {
  "0-30": 1,

  "31-60": 31,

  "61-90": 61,

  "90+": 91,
}

export function isAgingBucket(value: unknown): value is AgingBucket {
  return (
    typeof value === "string" &&
    (AGING_BUCKETS as readonly string[]).includes(value)
  )
}

/** Buckets a line falls into for a given days-past-due (negative or zero is not overdue). */

export function bucketForDaysOverdue(days: number): AgingBucket | null {
  if (days < 1) return null

  if (days <= 30) return "0-30"

  if (days <= 60) return "31-60"

  if (days <= 90) return "61-90"

  return "90+"
}

/** The two forward windows the KPI cards read. */

export const UPCOMING_WINDOWS = [7, 30] as const

/** One aging-band KPI: how many lines and how much value sits in it. */

export interface AgingBandSummary {
  bucket: AgingBucket

  count: number

  amount: number
}

/** A collection officer's workload and attainment for the current period. */

export interface OfficerWorkload {
  officerUserId: string

  officerName: string

  openCount: number

  overdueCount: number

  overdueAmount: number

  targetAmount: number

  achievedAmount: number
}

/** The head-line figures the top KPI cards show. */

export interface CollectionsKpis {
  dueNext7Count: number

  dueNext7Amount: number

  dueNext30Count: number

  dueNext30Amount: number

  overdueCount: number

  overdueAmount: number

  collectedPeriodAmount: number

  targetPeriodAmount: number
}

/** The whole collections summary response. */

export interface CollectionsSummary {
  kpis: CollectionsKpis

  aging: AgingBandSummary[]

  officers: OfficerWorkload[]

  period: string

  currency: string

  canEdit: boolean
}

/** One row of the filterable overdue table. */

export interface OverdueRow {
  installmentId: string

  bookingId: string

  bookingReference: string

  unitCode: string

  projectId: string

  projectName: string

  customerId: string

  customerName: string

  officerUserId: string | null

  officerName: string | null

  dueDate: string

  daysOverdue: number

  bucket: AgingBucket

  outstanding: number

  feeAccrued: number

  /** The latest un-waived assessment backing `feeAccrued`, or null when none. */

  lateFeeAssessmentId: string | null

  displayStatus: string
}

/** The overdue-table response. */

export interface OverdueList {
  rows: OverdueRow[]

  currency: string

  canEdit: boolean
}
