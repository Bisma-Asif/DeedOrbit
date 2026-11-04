/**
 * The demo dataset as one callable unit.
 *
 * `loadDemoDataset` builds the whole workspace in a single transaction: people,
 * then what they sell, then the pipeline that sells it, then the money that
 * comes out of it, then the paperwork about all of it. The order matters in both
 * directions — each domain reads the rows the one before it published onto the
 * shared `Demo`, and the removal sweep walks the same graph child-first.
 *
 * Nothing here is a schema change and nothing here is feature behaviour: the
 * rows are ordinary business rows written with the same columns, vocabularies
 * and derived states the application's own routes write. The only difference is
 * that every one of them is registered in `dashboard_sample_rows`, which is what
 * makes "Remove sample data" exact.
 */

import { get, run, transaction } from "../db.ts"

import { createRng, type Demo, type SampleRow } from "./common.ts"

import { DEMO_PASSWORD, seedWorkspace } from "./people.ts"

import { seedInventory } from "./inventory.ts"

import { seedPipeline } from "./pipeline.ts"

import { seedMoney } from "./money.ts"

import { seedOperations } from "./operations.ts"

import { removeSampleRows, sampleRowCounts, type TableCount } from "./remove.ts"

/** The one workspace this dataset was written for. */

export const DEMO_TENANT_SLUG = "amna-traders"

/** Pakistan-scale money and Pakistan time: the demo is a Karachi business. */

export const DEMO_CURRENCY = "PKR"

export const DEMO_TIMEZONE = "Asia/Karachi"

/** The tenant row, as the loader needs it. */

interface TenantRow {
  id: string

  slug: string

  name: string

  currency: string

  timezone: string
}

/** The existing owner, used as the actor on rows the seeder cannot attribute. */

interface ActorRow {
  id: string

  full_name: string

  email: string
}

/** What a load or removal did, for the route and the CLI to report. */

export interface DatasetReport {
  tenantId: string

  tenantName: string

  rows: number

  tables: TableCount[]

  password: string
}

/** The workspace this dataset belongs to, if the database has one. */

export function findDemoTenant(): TenantRow | undefined {
  return get<TenantRow>(
    "SELECT id, slug, name, currency, timezone FROM tenants WHERE slug = ?",

    DEMO_TENANT_SLUG,
  )
}

/** The tenant-local calendar day, which is the day the dashboard charts group by. */

export function localDay(timezone: string, date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,

      year: "numeric",

      month: "2-digit",

      day: "2-digit",
    }).format(date)
  } catch {
    return date.toISOString().slice(0, 10)
  }
}

/** The actor for rows with no natural owner: the workspace's own first user. */

function demoActor(tenantId: string): ActorRow | undefined {
  return get<ActorRow>(
    `SELECT id, full_name, email FROM users
      WHERE tenant_id = ? AND status = 'active'
      ORDER BY created_at
      LIMIT 1`,

    tenantId,
  )
}

/** Fresh generator state for one workspace. */

export function createDemo(tenant: TenantRow): Demo {
  const actor = demoActor(tenant.id)

  return {
    tenantId: tenant.id,

    slug: tenant.slug,

    today: localDay(DEMO_TIMEZONE),

    currency: DEMO_CURRENCY,

    timezone: DEMO_TIMEZONE,

    actorUserId: actor?.id ?? tenant.id,

    actorName: actor?.full_name ?? actor?.email ?? tenant.name,

    rows: [],

    counts: new Map<string, number>(),

    rand: createRng(`deedorbit-demo:${tenant.id}`),

    agents: [],

    managers: [],

    officers: [],

    roleUsers: new Map<string, string[]>(),

    userNames: new Map<string, string>(),

    userHandles: new Map<string, string>(),

    dealers: [],

    campaigns: [],

    vendors: [],

    projects: [],

    units: [],

    available: [],

    customers: [],

    leads: [],

    bookings: [],

    wonLeads: [],

    lostReasons: new Map<string, string>(),

    receiptSeq: 0,

    ledgerRows: 0,
  }
}

/** Registers every row the run wrote, so removal can find it later. */

function writeRegistry(demo: Demo, rows: SampleRow[]): void {
  const at = `${demo.today}T00:00:00.000Z`

  for (const row of rows) {
    // `OR IGNORE` because a compound key is registered once per key, and a

    // re-registered pair of parts is the same row, not a second one.

    run(
      `INSERT OR IGNORE INTO dashboard_sample_rows (tenant_id, table_name, row_id, created_at)
       VALUES (?, ?, ?, ?)`,

      demo.tenantId,

      row.table,

      row.id,

      at,
    )
  }
}

/**
 * Writes the whole dataset for one workspace in a single transaction.
 *
 * Throws if the workspace already has registered demo rows: a partial second
 * load would mix two batches and the ids would collide anyway, so the caller is
 * told to remove first rather than being left with a half-written book.
 */

export function loadDemoDataset(tenantId: string): DatasetReport {
  const tenant = get<TenantRow>(
    "SELECT id, slug, name, currency, timezone FROM tenants WHERE id = ?",

    tenantId,
  )

  if (!tenant) throw new Error(`No workspace with id ${tenantId}`)

  const existing = sampleRowCounts(tenantId)

  if (existing.length > 0) {
    throw new Error(
      "This workspace already has sample data loaded. Remove it first.",
    )
  }

  const tables = transaction(() => {
    const demo = createDemo(tenant)

    seedWorkspace(demo)

    seedInventory(demo)

    seedPipeline(demo)

    seedMoney(demo)

    seedOperations(demo)

    writeRegistry(demo, demo.rows)

    return sampleRowCounts(demo.tenantId)
  })

  return {
    tenantId,

    tenantName: tenant.name,

    rows: tables.reduce((total, table) => total + table.rows, 0),

    tables,

    password: DEMO_PASSWORD,
  }
}

/** Deletes the registered demo rows for one workspace, child-first. */

export function removeDemoDataset(tenantId: string): DatasetReport {
  const tenant = get<{ name: string }>(
    "SELECT name FROM tenants WHERE id = ?",

    tenantId,
  )

  const removed = removeSampleRows(tenantId)

  return {
    tenantId,

    tenantName: tenant?.name ?? tenantId,

    rows: removed,

    tables: sampleRowCounts(tenantId),

    password: DEMO_PASSWORD,
  }
}
