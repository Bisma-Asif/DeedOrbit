/**
 * Shared plumbing for the labelled demo dataset ("sample data").
 *
 * Everything here exists so the writers can stay honest:
 *
 *  * Deterministic ids and a seeded PRNG, so the same workspace always gets the
 *    same demo rows. A second run cannot quietly duplicate: the ids collide with
 *    the primary keys and the transaction aborts before anything lands.
 *
 *  * One registry (`dashboard_sample_rows`) instead of an `is_sample` column on
 *    thirty business tables. The registry is the sample batch id, it is written
 *    as each row is created, and removal walks it child-first. A row that is not
 *    in the registry cannot be removed by it, which is what keeps a tenant's own
 *    entries out of reach.
 *
 *  * Fictional-only data: invented project names, `0300-555xxxx` phone numbers,
 *    all-zero CNIC bodies and `@example.com` mail. No real society, developer or
 *    person is referenced anywhere.
 */

/** One registered demo row: the table it lives in and its primary key. */

export interface SampleRow {
  table: string

  id: string
}

/** A weighted choice entry. Two members, so an interface, not a one-line type. */

export interface Weighted<T> {
  item: T

  weight: number
}

/**
 * Row shapes read back from SQLite. One interface per shape: oxfmt strips the
 * separators from single-line multi-member object *type* literals.
 */

export interface AgentSeed {
  userId: string

  fullName: string

  teamId: string
}

export interface UnitSeed {
  id: string

  projectId: string

  projectName: string

  projectCode: string

  code: string

  type: string

  /** Saleable price: base plus the unit's charges, minus any discount. */

  price: number

  status: string

  /** The day the unit was published, so a booking can never predate it. */

  created: string
}

export interface CustomerSeed {
  id: string

  fullName: string

  leadId: string | null
}

export interface DealerSeed {
  id: string

  name: string

  commissionPct: number
}

/** The seed vocabulary for a demo lead stage, mirroring `shared/leads.ts`. */

export interface StageSeed {
  key: string

  label: string

  tone: string

  sort: number
}

/** A marketing campaign row, kept for the leads that name it. */

export interface CampaignSeed {
  id: string

  name: string

  source: string
}

/** A vendor row for expenses and contracts. */

export interface VendorSeed {
  id: string

  name: string
}

/** A project row plus the short code its unit and receipt numbers carry. */

export interface ProjectSeed {
  id: string

  name: string

  code: string

  status: string
}

/** A lead once written, with whatever it converted into. */

export interface LeadSeed {
  id: string

  fullName: string

  status: string

  agentUserId: string

  customerId: string | null
}

/** A booking once written, in the shape the schedule builder needs. */

export interface BookingSeed {
  id: string

  reference: string

  customerId: string

  customerName: string

  unitId: string

  unitCode: string

  projectId: string

  amount: number

  date: string

  agentUserId: string

  agentName: string

  status: string

  /** True for a settled sale: one paid-off line, no running schedule. */

  legacy: boolean
}

/**
 * The generator's shared state. Every domain builder receives this, writes its
 * rows, and publishes what the next domain needs (units for bookings, bookings
 * for schedules, customers for the ledger).
 */

export interface Demo {
  tenantId: string

  slug: string

  today: string

  currency: string

  timezone: string

  actorUserId: string

  actorName: string

  rows: SampleRow[]

  counts: Map<string, number>

  rand: Rng

  /** Sales staff who can own a booking, in role order. */

  agents: AgentSeed[]

  managers: AgentSeed[]

  officers: AgentSeed[]

  /** Every seeded staff account by role, for approver and actor fields. */

  roleUsers: Map<string, string[]>

  /** Display name for each seeded user id, so rows can carry their actor. */

  userNames: Map<string, string>

  /** Mailbox handle for each seeded user id, so audit rows can carry the actor's email. */

  userHandles: Map<string, string>

  dealers: DealerSeed[]

  campaigns: CampaignSeed[]

  vendors: VendorSeed[]

  projects: ProjectSeed[]

  units: UnitSeed[]

  /** Units still free to sell, consumed as bookings are written. */

  available: UnitSeed[]

  customers: CustomerSeed[]

  leads: LeadSeed[]

  bookings: BookingSeed[]

  /** Leads that closed as won, so a quotation can name one without a lookup. */

  wonLeads: LeadSeed[]

  /** Lost leads and the reason each one gave, for the pipeline table. */

  lostReasons: Map<string, string>

  receiptSeq: number

  ledgerRows: number
}

/** A seeded generator. `Math.random` is never used, so runs are repeatable. */

export interface Rng {
  next: () => number

  int: (min: number, max: number) => number

  pick: <T>(items: readonly T[]) => T

  chance: (probability: number) => boolean

  weighted: <T>(items: readonly Weighted<T>[]) => T

  /** Whole PKR, rounded down to the nearest thousand so figures read cleanly. */

  money: (min: number, max: number) => number
}

/** FNV-1a over the seed string, then mulberry32. Small, stable, dependency-free. */

export function createRng(seedText: string): Rng {
  let hash = 0x811c9dc5

  for (let index = 0; index < seedText.length; index += 1) {
    hash ^= seedText.charCodeAt(index)

    hash = Math.imul(hash, 0x01000193) >>> 0
  }

  let state = hash >>> 0 || 0x9e3779b9

  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0

    let t = state

    t = Math.imul(t ^ (t >>> 15), t | 1)

    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  const int = (min: number, max: number) =>
    min + Math.floor(next() * (max - min + 1))

  return {
    next,

    int,

    pick: <T>(items: readonly T[]): T =>
      items[Math.floor(next() * items.length)] ?? items[0]!,

    chance: (probability: number) => next() < probability,

    weighted: <T>(items: readonly Weighted<T>[]): T => {
      let total = 0

      for (const item of items) total += item.weight

      let stop = next() * total

      for (const item of items) {
        stop -= item.weight

        if (stop <= 0) return item.item
      }

      return items[items.length - 1]!.item
    },

    money: (min: number, max: number) => {
      const raw = int(min, max)

      const snap = Math.round(raw / 1000) * 1000

      return Math.min(max, Math.max(min, snap))
    },
  }
}

/** ISO `YYYY-MM-DD` for the tenant-local day `days` before today (negative = after). */

export function dayMinus(today: string, days: number): string {
  const base = Date.parse(`${today}T00:00:00Z`)

  return new Date(base - days * 86_400_000).toISOString().slice(0, 10)
}

/** A timestamp on the tenant-local day `days` before today, at a stable hour. */

export function stamp(today: string, days: number, hour = 9): string {
  const minute = (Math.abs(days) * 7) % 60

  return `${dayMinus(today, days)}T${String(hour).padStart(2, "0")}:${String(
    minute,
  ).padStart(2, "0")}:00.000Z`
}

/** Whole days from `today` until `day`. Positive means the future. */

export function daysFromToday(today: string, day: string): number {
  return Math.round(
    (Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) /
      86_400_000,
  )
}

/** `YYYY-MM` for a day, used by the monthly target rows. */

export function monthOf(day: string): string {
  return day.slice(0, 7)
}

/** A stable id for a demo row. Re-running the seed collides instead of duplicating. */

export function demoId(demo: Demo, prefix: string, ordinal: number): string {
  return `${prefix}_${demo.slug}_${String(ordinal).padStart(3, "0")}`
}

/** Writes nothing but registers the id; the caller runs its own INSERT. */

export function track(demo: Demo, table: string, id: string): void {
  demo.rows.push({ table, id })

  demo.counts.set(table, (demo.counts.get(table) ?? 0) + 1)
}

/**
 * The next ordinal for an id prefix. Sequence state lives beside the row counts
 * under a `seq:` key so nothing else can allocate the same number, and the
 * sequence always replays the same way for the same workspace.
 */

export function nextOrdinal(demo: Demo, prefix: string): number {
  const key = `seq:${prefix}`

  const next = (demo.counts.get(key) ?? 0) + 1

  demo.counts.set(key, next)

  return next
}

/** `demoId` for the next value of a sequence. */

export function seqId(demo: Demo, prefix: string): string {
  return demoId(demo, prefix, nextOrdinal(demo, prefix))
}

/** Runs the write, then registers the row it created. */

export function write(
  demo: Demo,

  table: string,

  id: string,

  insert: () => void,
): void {
  insert()

  track(demo, table, id)
}

/**
 * The demo login handle for a seeded person. Every address is under
 * `example.com` and carries the workspace slug, so it cannot collide with a real
 * account in another tenant of the same database.
 */

export function demoEmail(demo: Demo, handle: string): string {
  return `${handle}.${demo.slug}@example.com`
}

/** A clearly fictional Pakistani mobile number. */

export function fakePhone(demo: Demo, index: number): string {
  const prefixes = ["0300", "0321", "0333", "0345", "0311", "0302"]

  return `${demo.rand.pick(prefixes)}-555${String(1000 + index).slice(-4)}`
}

/** A clearly fictional CNIC: the real 5-7-1 shape, an all-zero body. */

export function fakeCnic(index: number, region: string): string {
  return `${region}-000${String(1000 + index).slice(-4)}-${String(
    (index % 9) + 1,
  )}`
}

/** An obviously synthetic bank account number for vendor and customer records. */

export function fakeAccount(index: number): string {
  return `PK00BA000000${String(100000 + index).slice(-6)}`
}

/** The whole demo dataset is worth removing in this order: children first. */

export const REMOVAL_ORDER: readonly string[] = [
  "audit_log",

  "notifications",

  "ticket_comments",

  "ticket_attachments",

  "support_tickets",

  "documents",

  "approvals",

  "customer_ledger_entries",

  "late_fee_assessments",

  "refunds",

  "transfers",

  "installment_payments",

  "payment_allocations",

  "payments",

  "payment_installments",

  "payment_plans",

  "dealer_commission_payments",

  "dealer_bookings",

  "dealer_commission_rules",

  "dealers",

  "bookings",

  "unit_quotations",

  "lead_activities",

  "customers",

  "leads",

  "collection_targets",

  "sales_agent_targets",

  "sales_team_members",

  "sales_teams",

  "expense_attachments",

  "expenses",

  "vendor_contracts",

  "vendor_invoices",

  "vendor_ledger_entries",

  "vendors",

  "campaigns",

  "inventory_unit_status_history",

  "inventory_units",

  "project_structure_nodes",

  "projects",

  "user_branches",

  "branches",

  "tenant_memberships",

  "users",
]
