/**
 * Platform Super Admin vocabulary — the contract between the platform billing
 * routes, the platform screens, and the plan catalogue the whole product cites.
 *
 * This is the *platform's* view of its tenants, not a tenant's view of itself:
 * which plan each workspace is on, whether its subscription is paid, how much
 * of the plan's limits it is using, and the ledger of what the platform billed
 * and collected from it. Nothing here fabricates a payment: an invoice or a
 * receipt only exists because a platform operator recorded it.
 *
 * `billing_status` is what is *stored* — one of current, due, or grace. The
 * time-relative reading (is the grace still running or has it lapsed) is
 * *derived* at read time into a `derived` status, exactly like installment
 * due dates, so it cannot go stale between days and no cron job is required.
 * A workspace-level suspension is not a billing status: `status` on the tenant
 * stays a separate, visible fact.
 */

export const PLATFORM_PLANS = ["starter", "standard", "enterprise"] as const

export type PlatformPlan = typeof PLATFORM_PLANS[number]

export interface PlanLimits {
  users: number

  projects: number

  storageBytes: number
}

export interface PlanDefinition {
  id: PlatformPlan

  label: string

  description: string

  /** Whole major currency units per month, the same integer-money convention as every other amount. */

  monthlyAmount: number

  limits: PlanLimits
}

/**
 * The shipped catalogue. Limits are enforced by the platform area's usage bars
 * and reported to the operator; the tenant-side hard blocks are a separate
 * product decision and are deliberately not claimed here.
 */

export const PLAN_DEFINITIONS: Record<PlatformPlan, PlanDefinition> = {
  starter: {
    id: "starter",

    label: "Starter",

    description: "Small brokerages getting the desk online.",

    monthlyAmount: 1500,

    limits: { users: 15, projects: 10, storageBytes: 2 * 1024 * 1024 * 1024 },
  },

  standard: {
    id: "standard",

    label: "Standard",

    description: "Multi-team developers running the full sales cycle.",

    monthlyAmount: 4500,

    limits: { users: 50, projects: 50, storageBytes: 10 * 1024 * 1024 * 1024 },
  },

  enterprise: {
    id: "enterprise",

    label: "Enterprise",

    description: "Holdings groups with portfolios and dedicated support.",

    monthlyAmount: 12000,

    limits: {
      users: 250,

      projects: 500,

      storageBytes: 100 * 1024 * 1024 * 1024,
    },
  },
}

export const DEFAULT_PLATFORM_PLAN: PlatformPlan = "standard"

export function isPlatformPlan(value: string): value is PlatformPlan {
  return (PLATFORM_PLANS as readonly string[]).includes(value)
}

/** Unknown plan strings can exist in the free-text column; the UI shows a dash rather than inventing limits. */

export function planDefinition(plan: string): PlanDefinition | null {
  return isPlatformPlan(plan) ? PLAN_DEFINITIONS[plan] : null
}

// --- Billing status ----------------------------------------------------------

/** What is stored on `tenant_subscriptions`. Grace is a grant, not a state you can sit in forever. */

export const BILLING_STATUSES = ["current", "due", "grace"] as const

export type BillingStatus = typeof BILLING_STATUSES[number]

/** The read-time view: `grace` splits on whether the window is still open, and a suspended workspace reads through its own status column. */

export const DERIVED_BILLING_STATUSES = [
  "current",

  "due",

  "grace_active",

  "grace_expired",
] as const

export type DerivedBillingStatus = typeof DERIVED_BILLING_STATUSES[number]

export const DERIVED_BILLING_LABELS: Record<DerivedBillingStatus, string> = {
  current: "Current",

  due: "Payment due",

  grace_active: "In grace period",

  grace_expired: "Grace expired",
}

// --- Billing ledger ----------------------------------------------------------

/** Every entry in the platform's billing timeline for one workspace. */

export const BILLING_EVENT_KINDS = [
  "invoice",

  "payment",

  "billing_due",

  "grace_granted",

  "grace_expired",

  "suspension",

  "reactivation",

  "plan_change",
] as const

export type BillingEventKind = typeof BILLING_EVENT_KINDS[number]

export const BILLING_EVENT_LABELS: Record<BillingEventKind, string> = {
  invoice: "Invoice issued",

  payment: "Payment received",

  billing_due: "Marked due",

  grace_granted: "Grace granted",

  grace_expired: "Grace expired",

  suspension: "Workspace suspended",

  reactivation: "Workspace reactivated",

  plan_change: "Plan changed",
}

/** Tone each event renders in: emerald for money received, amber for pending/due, red only where something lapsed or was cut off. */

export const BILLING_EVENT_TONES = [
  "success",

  "pending",

  "danger",

  "neutral",
] as const

export type BillingEventTone = typeof BILLING_EVENT_TONES[number]

export const BILLING_EVENT_KIND_TONE: Record<BillingEventKind, BillingEventTone> =
  {
    invoice: "neutral",

    payment: "success",

    billing_due: "pending",

    grace_granted: "pending",

    grace_expired: "danger",

    suspension: "danger",

    reactivation: "success",

    plan_change: "neutral",
  }

export const GRACE_DAYS_MIN = 1

export const GRACE_DAYS_MAX = 90

// --- View contracts ----------------------------------------------------------

/** One measured usage dimension against its plan limit. A null limit means the plan is unknown, never unlimited. */

export interface PlatformUsage {
  used: number

  limit: number | null
}

export interface PlatformTenantUsage {
  users: PlatformUsage

  projects: PlatformUsage

  storageBytes: PlatformUsage
}

export interface PlatformTenantView {
  id: string

  name: string

  legalName: string | null

  slug: string

  /** The workspace lifecycle: active, suspended, or closed. Separate from billing. */

  status: string

  plan: string

  planLabel: string | null

  currency: string

  createdAt: string

  billingStatus: DerivedBillingStatus

  graceEndsAt: string | null

  graceReason: string | null

  usage: PlatformTenantUsage

  /** The plan's list price; null when the workspace sits on an unknown plan. */

  monthlyAmount: number | null

  /** Sum of recorded payments — what the platform has actually collected. */

  revenueCollected: number

  /** Sum of recorded invoices — what the platform has actually billed. */

  amountInvoiced: number

  /** invoiced minus collected; can only ever be computed from recorded rows. */

  outstanding: number

  lastBilledAt: string | null
}

/** Collected money per currency; totals are never silently added across currencies. */

export interface PlatformCurrencyTotal {
  currency: string

  amount: number
}

export interface PlatformTotals {
  workspaces: number

  active: number

  suspended: number

  /** Active workspaces whose billing reads as due or grace-expired right now. */

  needingAttention: number

  collectedByCurrency: PlatformCurrencyTotal[]
}

export interface PlatformTenantListResponse {
  tenants: PlatformTenantView[]

  totals: PlatformTotals
}

export interface PlatformBillingEventView {
  id: string

  kind: BillingEventKind

  kindLabel: string

  tone: BillingEventTone

  amount: number | null

  currency: string | null

  note: string | null

  actorEmail: string | null

  createdAt: string
}

export interface PlatformTenantDetailResponse {
  tenant: PlatformTenantView

  events: PlatformBillingEventView[]
}

/** Every state-changing platform action returns the refreshed tenant, plus the timeline event it produced. */

export interface PlatformMutationResponse {
  ok: true

  tenant: PlatformTenantView

  event: PlatformBillingEventView | null
}
