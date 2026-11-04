/**
 * Construction vocabulary — the contract between the construction routes,
 * the client screens, and every other module that cites a phase or a task.
 *
 * The money rule this module lives by: a phase's *actual* spend is never
 * stored here. It is derived by summing the approved-and-paid expenses and
 * the non-void vendor invoices that were tagged against the phase or one of
 * its tasks. A budget is a plan (a stored, deliberate number); actuals are
 * evidence (recorded rows only). Where the two disagree, the screen shows
 * both and lets the variance speak.
 *
 * Amounts group by currency and are never silently added across currencies
 * — the same rule the platform billing totals follow. A phase budget in AED
 * and a tagged invoice in SAR read as two lines, not one number.
 *
 * Site progress is likewise two facts, not one: `derivedProgress` is the
 * rollup of its tasks' progress (milestones weighted double), and
 * `manualProgress` is the latest site log the manager entered. The view
 * carries which one is *in play* so the UI can say so rather than average
 * two different truths into a lie.
 */

// --- Contractors -------------------------------------------------------------

export const CONTRACTOR_TRADES = [
  "general",

  "substructure",

  "superstructure",

  "mep",

  "finishes",

  "landscape",

  "other",
] as const

export type ContractorTrade = typeof CONTRACTOR_TRADES[number]

export const CONTRACTOR_TRADE_LABELS: Record<ContractorTrade, string> = {
  general: "General contractor",

  substructure: "Substructure",

  superstructure: "Superstructure",

  mep: "MEP",

  finishes: "Finishes",

  landscape: "Landscape",

  other: "Other",
}

export const CONTRACTOR_STATUSES = ["active", "archived"] as const

export type ContractorStatus = typeof CONTRACTOR_STATUSES[number]

export interface ConstructionContractorView {
  id: string

  name: string

  trade: string

  tradeLabel: string

  vendorId: string | null

  contactName: string | null

  email: string | null

  phone: string | null

  notes: string | null

  status: string

  createdAt: string

  /** Tasks currently assigned to this contractor; the archive guard reads it. */

  openTaskCount: number
}

export interface ContractorListResponse {
  contractors: ConstructionContractorView[]
}

// --- Phases -------------------------------------------------------------------

export const PHASE_STATUSES = [
  "pending",

  "active",

  "completed",

  "on_hold",
] as const

export type PhaseStatus = typeof PHASE_STATUSES[number]

export const PHASE_STATUS_LABELS: Record<PhaseStatus, string> = {
  pending: "Pending",

  active: "Active",

  completed: "Completed",

  on_hold: "On hold",
}

/** One currency's slice of derived spend. Never a cross-currency sum. */

export interface CurrencyAmount {
  currency: string

  amount: number
}

/**
 * How the phase's progress figure is being decided, so the screen can label
 * it: derived from tasks, taken from the manager's latest site log, or there
 * is nothing to read yet and the view says so with a null.
 */

export const PROGRESS_MODES = ["derived", "manual", "none"] as const

export type ProgressMode = typeof PROGRESS_MODES[number]

export interface ConstructionPhaseView {
  id: string

  projectId: string

  projectName: string

  name: string

  sequence: number

  status: string

  plannedStart: string | null

  plannedEnd: string | null

  /** The stored plan; null when nobody has set a budget yet — a dash, not zero. */

  budgetAmount: number | null

  budgetCurrency: string | null

  /** Derived from tagged expense/invoice rows, one entry per currency. */

  actualByCurrency: CurrencyAmount[]

  /** Actuals in any currency other than the budget's, kept visibly separate. */

  foreignActuals: CurrencyAmount[]

  variance: number | null

  taskCount: number

  milestoneCount: number

  milestoneDoneCount: number

  derivedProgress: number | null

  manualProgress: number | null

  /** Which of the two the displayed progress is; "none" renders a dash. */

  progressMode: ProgressMode

  progress: number | null

  contractorNames: string[]

  createdAt: string
}

export interface PhaseListResponse {
  phases: ConstructionPhaseView[]
}

// --- Tasks ---------------------------------------------------------------------

export const TASK_STATUSES = [
  "pending",

  "in_progress",

  "completed",

  "blocked",
] as const

export type TaskStatus = typeof TASK_STATUSES[number]

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  pending: "Pending",

  in_progress: "In progress",

  completed: "Completed",

  blocked: "Blocked",
}

export interface ConstructionTaskView {
  id: string

  phaseId: string

  name: string

  description: string | null

  sequence: number

  status: string

  milestone: boolean

  plannedStart: string | null

  plannedEnd: string | null

  actualStart: string | null

  actualEnd: string | null

  contractorId: string | null

  contractorName: string | null

  assigneeName: string | null

  budgetAmount: number | null

  progress: number

  /** Derived from expense/invoice rows tagged to this task specifically. */

  actualByCurrency: CurrencyAmount[]
}

// --- Progress logs ---------------------------------------------------------------

export interface ConstructionProgressLogView {
  id: string

  phaseId: string

  taskId: string | null

  percent: number

  note: string | null

  actorName: string

  createdAt: string
}

export interface ConstructionPhaseDetail {
  phase: ConstructionPhaseView

  tasks: ConstructionTaskView[]

  progressLog: ConstructionProgressLogView[]

  canEdit: boolean
}

export interface PhaseMutationResponse {
  ok: true

  phase: ConstructionPhaseView
}

export interface TaskMutationResponse {
  ok: true

  task: ConstructionTaskView
}

// --- Validation bounds -------------------------------------------------------------

export const PROGRESS_MIN = 0

export const PROGRESS_MAX = 100

export const PHASE_NAME_MAX = 120

export const TASK_NAME_MAX = 160

export const NOTE_MAX = 500

export const MONEY_MAX = 1_000_000_000_000

/**
 * Progress is a whole percent between 0 and 100, or nothing. A value outside
 * the bounds is refused at the gate rather than clamped, so a typo never
 * quietly rewrites a site report.
 */

export function isValidProgress(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= PROGRESS_MIN &&
    value <= PROGRESS_MAX
  )
}

export function isPhaseStatus(value: string): value is PhaseStatus {
  return (PHASE_STATUSES as readonly string[]).includes(value)
}

export function isTaskStatus(value: string): value is TaskStatus {
  return (TASK_STATUSES as readonly string[]).includes(value)
}

export function isContractorTrade(value: string): value is ContractorTrade {
  return (CONTRACTOR_TRADES as readonly string[]).includes(value)
}
