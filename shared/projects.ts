/**
 * Project vocabulary shared by the API and the Projects screen.
 *
 * Statuses, types, and the validation bounds live here rather than in either
 * half so the two cannot drift: the server is the authority that rejects a bad
 * value, and the client calls the same guards to keep a known-invalid value out
 * of the form. That is a convenience, not a guarantee — a client calling these
 * proves nothing, which is exactly why the route re-checks everything.
 *
 * Everything the API returns for a project is one of these closed sets, so the
 * database `CHECK` constraints, the route validation, and the UI badge tone all
 * derive from one declaration.
 */

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/**
 * A project moves through these in order. `on_hold` deliberately sits outside the
 * progression rather than after it, because a project can leave any state for it
 * and come back to where it was.
 */
export const PROJECT_STATUSES = [
  "planning",
  "pre_launch",
  "on_sale",
  "handed_over",
  "on_hold",
] as const

export type ProjectStatus = typeof PROJECT_STATUSES[number]

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  planning: "Planning",

  pre_launch: "Pre-launch",

  on_sale: "On sale",

  handed_over: "Handed over",

  on_hold: "On hold",
}

/**
 * A project's status is the one place in this module where colour carries
 * meaning, so it is declared here rather than derived from the label. The tones
 * are the platform's: emerald for live trading, amber for something waiting on
 * a date, muted red only for genuinely stuck work.
 */
export type ProjectStatusTone = "neutral" | "success" | "pending" | "danger" | "info"

export const PROJECT_STATUS_TONES: Record<ProjectStatus, ProjectStatusTone> = {
  planning: "neutral",

  pre_launch: "pending",

  on_sale: "success",

  handed_over: "info",

  on_hold: "danger",
}

/** Statuses in which units are actually being offered to buyers. */
export const LIVE_STATUSES: readonly ProjectStatus[] = ["on_sale"]

/**
 * The window used by the "launching soon" figure on the list. A pre-launch
 * project with a date inside it is the actionable set; anything further out is
 * not something the number should count.
 */
export const LAUNCH_SOON_DAYS = 90

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

export const PROJECT_TYPES = [
  "residential",
  "commercial",
  "mixed_use",
  "industrial",
  "land",
] as const

export type ProjectType = typeof PROJECT_TYPES[number]

export const PROJECT_TYPE_LABELS: Record<ProjectType, string> = {
  residential: "Residential",

  commercial: "Commercial",

  mixed_use: "Mixed use",

  industrial: "Industrial",

  land: "Land",
}

export const OWNERSHIP_TYPES = ["freehold", "leasehold"] as const

export type OwnershipType = typeof OWNERSHIP_TYPES[number]

export const OWNERSHIP_LABELS: Record<OwnershipType, string> = {
  freehold: "Freehold",

  leasehold: "Leasehold",
}

// ---------------------------------------------------------------------------
// Structure
// ---------------------------------------------------------------------------

/**
 * The kinds of node a project's hierarchy is built from.
 *
 * One closed set rather than three: a block, a sector, and a floor differ only in
 * what they are called, and they nest inside one another in the same way. Giving
 * them separate tables would mean three near-identical schemas, three sets of
 * routes, and a union type in every query that touched more than one level — for
 * no gain in integrity, because nothing about a floor row is checked differently
 * from a tower row.
 *
 * `block` is labelled "Block / tower" because the two words are used
 * interchangeably for the same thing across the markets this serves.
 */
export const STRUCTURE_NODE_KINDS = ["block", "sector", "floor"] as const

export type StructureNodeKind = typeof STRUCTURE_NODE_KINDS[number]

export const STRUCTURE_NODE_KIND_LABELS: Record<StructureNodeKind, string> = {
  block: "Block / tower",

  sector: "Sector",

  floor: "Floor",
}

/**
 * How deep the hierarchy may go, counted from the project's direct children.
 *
 * A real development is three or four levels — tower, sector, floor — and the cap
 * exists to bound the work rather than to model reality: every write has to walk
 * the ancestor chain to prove a new node is not being placed inside its own
 * subtree, and an uncapped walk over a hand-edited database is how that check
 * turns into a hang. Six levels is far past any real layout, so hitting it means
 * the data is wrong rather than the project being unusual.
 */
export const STRUCTURE_MAX_DEPTH = 6

/**
 * A node name may be a single character — "A", "1" — which is exactly how towers
 * and floors are written in practice, so the minimum only rules out the empty
 * string. The maximum is generous for the same reason: a descriptive name like
 * "Level 12 — Podium and amenity" must not be refused.
 */
export const STRUCTURE_NODE_NAME_MIN = 1
export const STRUCTURE_NODE_NAME_MAX = 80

// ---------------------------------------------------------------------------
// Validation bounds
// ---------------------------------------------------------------------------

export const NAME_MIN = 2
export const NAME_MAX = 120
export const DEVELOPER_MIN = 2
export const DEVELOPER_MAX = 120
export const LOCATION_MIN = 2
export const LOCATION_MAX = 200
export const CODE_MAX = 32
export const DESCRIPTION_MAX = 2000
export const TERMS_MAX = 500
export const UNITS_MIN = 0
export const UNITS_MAX = 100000

/**
 * A short internal reference, not a document number. Letters, digits, dot,
 * underscore, and dash only — it appears in filenames and URLs.
 */
export const CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

export function isProjectStatus(value: unknown): value is ProjectStatus {
  return (
    typeof value === "string" &&
    (PROJECT_STATUSES as readonly string[]).includes(value)
  )
}

export function isProjectType(value: unknown): value is ProjectType {
  return (
    typeof value === "string" &&
    (PROJECT_TYPES as readonly string[]).includes(value)
  )
}

export function isOwnershipType(value: unknown): value is OwnershipType {
  return (
    typeof value === "string" &&
    (OWNERSHIP_TYPES as readonly string[]).includes(value)
  )
}

export function isStructureNodeKind(
  value: unknown,
): value is StructureNodeKind {
  return (
    typeof value === "string" &&
    (STRUCTURE_NODE_KINDS as readonly string[]).includes(value)
  )
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Accepts only a real `YYYY-MM-DD` calendar date.
 *
 * The regex alone is not enough: it is happy with `2026-02-30`, which
 * `new Date()` would silently roll forward into March. A launch date that drifts
 * by a month is worse than one that is rejected, so the parsed components are
 * compared back against the input.
 */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false

  const [year, month, day] = value
    .split("-")
    .map(Number) as [number, number, number]

  const parsed = new Date(Date.UTC(year, month - 1, day))

  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  )
}

/** Whole units only — a planned unit count is never 12.5. */
export function isUnitCount(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= UNITS_MIN &&
    value <= UNITS_MAX
  )
}

/** The `YYYY-MM-DD` string a `date` input produces, or null when unset. */
export function toIsoDate(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null
  return isIsoDate(value) ? value : null
}
