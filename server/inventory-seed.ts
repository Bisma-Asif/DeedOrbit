/**
 * Seeding the property category lists.
 *
 * The nine dropdown lists a tenant configures under Settings > Inventory Setup start
 * full, not empty: a workspace whose Property Type picker has nothing in it cannot
 * classify a unit at all, and the first thing an administrator does with a new
 * inventory is add units. So the defaults in `shared/inventory-categories.ts` are
 * written into `inventory_category_options` for every tenant — here for the tenants
 * that already exist, and at signup for each new one.
 *
 * This module is the only place the seeds turn into rows. Migration 0007 kept a second
 * copy of the status list in SQL and paid for it: adding a status means editing both,
 * and nothing fails when they drift — a tenant simply gets a different vocabulary than
 * the client renders. Driving the insert off the shared list means the seed, the picker
 * and the importer cannot disagree, which is also why this file takes a database handle
 * rather than importing one. `server/db.ts` imports `server/migrations.ts`, which calls
 * in here; reaching back for `all`/`run` would close that cycle.
 *
 * Every insert is `INSERT OR IGNORE` against the deterministic id
 * (`cat_<tenant>_<kind>_<key>`, the same shape as a built-in status id) and against the
 * unique key and label indexes, so re-running the seed is a no-op. A tenant that renamed
 * "Apartment" to "Flat" therefore keeps its own word: the seed does not overwrite labels,
 * it only fills gaps.
 */

import type { DatabaseSync } from "node:sqlite"

import {
  INVENTORY_OPTION_KINDS,
  INVENTORY_OPTION_SEEDS,
  type InventoryOptionKind,
} from "../shared/inventory-categories.ts"

/** What one option row needs, in column order. */

interface OptionRow {
  id: string

  tenant_id: string

  kind: string

  key: string

  label: string

  parent_key: string | null

  legacy_type: string | null

  usage_key: string | null

  value_num: number | null

  is_land: number

  is_builtin: number

  is_archived: number

  sort_order: number

  created_at: string

  updated_at: string
}

const INSERT_SQL = `INSERT OR IGNORE INTO inventory_category_options (
    id, tenant_id, kind, key, label, parent_key, legacy_type, usage_key, value_num,
    is_land, is_builtin, is_archived, sort_order, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`

/** The rows for one seed list, in the order they should be offered. */

function optionRows(
  kind: InventoryOptionKind,

  tenantId: string,

  now: string,
): OptionRow[] {
  return INVENTORY_OPTION_SEEDS[kind].map((seed, index) => ({
    id: `cat_${tenantId}_${kind}_${seed.key}`,

    tenant_id: tenantId,

    kind,

    key: seed.key,

    label: seed.label,

    parent_key: seed.parent ?? null,

    legacy_type: seed.legacy ?? null,

    usage_key: seed.usage ?? null,

    value_num: seed.factor ?? null,

    is_land: seed.land === true ? 1 : 0,

    is_builtin: 1,

    is_archived: 0,

    sort_order: index,

    created_at: now,

    updated_at: now,
  }))
}

/**
 * Fills one tenant's option lists.
 *
 * Exported for `routes/auth.ts`, which has always had to seed the built-in statuses for
 * a brand-new workspace in the same transaction as creating it; the category lists are
 * the same problem one migration later.
 */

export function seedInventoryCategoryOptions(
  db: DatabaseSync,

  tenantId: string,

  now: string,
): void {
  const insert = db.prepare(INSERT_SQL)

  for (const kind of INVENTORY_OPTION_KINDS) {
    for (const row of optionRows(kind, tenantId, now)) {
      insert.run(
        row.id,

        row.tenant_id,

        row.kind,

        row.key,

        row.label,

        row.parent_key,

        row.legacy_type,

        row.usage_key,

        row.value_num,

        row.is_land,

        row.is_builtin,

        row.is_archived,

        row.sort_order,

        row.created_at,

        row.updated_at,
      )
    }
  }
}

/** Every tenant that exists right now, for the migration's backfill. */

export function seedAllTenantsInventoryCategories(
  db: DatabaseSync,

  now: string,
): void {
  const tenants = db.prepare("SELECT id FROM tenants").all() as { id: string }[]

  for (const tenant of tenants) {
    seedInventoryCategoryOptions(db, tenant.id, now)
  }
}

/**
 * Gives units recorded before categories existed a classification.
 *
 * Only rows whose `property_type` is still null are touched, so this is safe to re-run
 * and never overwrites a value an administrator or a later save did set. The mapping is
 * the coarse family the unit already carried, which is the least inventive answer
 * available: a row whose `unit_type` says `shop` becomes Shop, and an office becomes an
 * Office in a Commercial usage. Sizes are copied into the typed-value columns in square
 * feet, because that is the unit the single existing figure is already in.
 *
 * What is *not* invented here is the detail: bedrooms, floor numbers and amenities stay
 * null and render as a dash. A default that reads as a recorded fact — every legacy
 * apartment suddenly having three bedrooms — is worse than a visible gap, and this
 * product's own rule is to show the dash and say so.
 */

export function backfillUnitCategories(db: DatabaseSync): void {
  db.exec(`
    UPDATE inventory_units
       SET property_type = CASE unit_type
             WHEN 'plot' THEN 'plot'
             WHEN 'apartment' THEN 'apartment'
             WHEN 'shop' THEN 'shop'
             WHEN 'office' THEN 'office'
             WHEN 'villa' THEN 'house'
             ELSE 'plot'
           END,

           usage_category = CASE unit_type
             WHEN 'shop' THEN 'commercial'
             WHEN 'office' THEN 'commercial'
             ELSE 'residential'
           END,

           furnishing = 'unfurnished',

           -- Either mode, because nothing about an old row says which one the seller
           -- intended, and refusing to quote an installment plan would be a decision
           -- made on the row's behalf. An admin narrows it per unit.
           sale_mode = 'both',

           -- A unit that reached a closed or committed state was handed over; anything
           -- still on the market is treated as not yet delivered.
           possession = CASE
             WHEN status IN ('sold','booked','transferred') THEN 'ready'
             ELSE 'under_construction'
           END,

           ownership = 'freehold',

           size_unit = 'square_feet',

           size_value = CAST(size_sqft AS REAL)
     WHERE property_type IS NULL
  `)
}
