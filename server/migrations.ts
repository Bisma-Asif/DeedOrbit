/**
 * The `ALTER TABLE` half of migrations 0002 and 0003.
 *
 * These columns are applied from code rather than from the `.sql` file for one
 * reason: SQLite has no `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`. A migration
 * that hard-codes the statement fails on any database where the column already
 * exists, and a migration that swallows the "duplicate column" error hides real
 * failures. Reading `PRAGMA table_info` first is explicit and safe to re-run.
 *
 * Adding a nullable column with a constant default is a metadata-only change in
 * SQLite, so this is cheap even on a large table.
 */

import type { DatabaseSync } from "node:sqlite"

import {
  backfillUnitCategories,
  seedAllTenantsInventoryCategories,
} from "./inventory-seed.ts"

export interface ColumnSpec {
  name: string
  definition: string
}

/** ISO weekday numbers, Monday = 1 … Sunday = 7. */
export const DEFAULT_WORKING_DAYS = [1, 2, 3, 4, 5]

const TENANT_COLUMNS: ColumnSpec[] = [
  { name: "registration_number", definition: "TEXT" },
  { name: "tax_id", definition: "TEXT" },
  { name: "address_line1", definition: "TEXT" },
  { name: "address_line2", definition: "TEXT" },
  { name: "city", definition: "TEXT" },
  { name: "state_region", definition: "TEXT" },
  { name: "postal_code", definition: "TEXT" },
  { name: "country_code", definition: "TEXT" },
  { name: "phone", definition: "TEXT" },
  { name: "collections_email", definition: "TEXT" },
  // 1 = January. Any month is valid; the UI offers all twelve.
  { name: "fiscal_year_start_month", definition: "INTEGER NOT NULL DEFAULT 1" },
  // JSON array of ISO weekday numbers, e.g. "[1,2,3,4,5]".
  {
    name: "working_days",
    definition: `TEXT NOT NULL DEFAULT '${JSON.stringify(DEFAULT_WORKING_DAYS)}'`,
  },
  // The logo is stored as a data URL with its real media type, never a
  // client-supplied one — see validateLogoUpload in routes/tenants.ts.
  { name: "logo_mime", definition: "TEXT" },
  { name: "logo_data", definition: "TEXT" },
  { name: "logo_updated_at", definition: "TEXT" },
]

function existingColumns(db: DatabaseSync, table: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as {
    name: string
  }[]
  return new Set(rows.map((row) => row.name))
}

export function addOrganizationSettingsColumns(db: DatabaseSync): void {
  const present = existingColumns(db, "tenants")

  for (const column of TENANT_COLUMNS) {
    if (present.has(column.name)) continue
    db.exec(
      `ALTER TABLE tenants ADD COLUMN ${column.name} ${column.definition}`,
    )
  }
}

/** Exported for the test suite, which asserts the migration is re-runnable. */
export const organizationSettingsColumns = TENANT_COLUMNS

const USER_COLUMNS: ColumnSpec[] = [
  // 1 = an administrator has forced a reset and the member must set a new
  // password before the app opens for them. Cleared by the reset endpoint
  // itself, so there is no second place that can forget to do it.
  { name: "must_reset_password", definition: "INTEGER NOT NULL DEFAULT 0" },
  // When the flag was last set, shown in the member list next to the badge.
  { name: "password_reset_required_at", definition: "TEXT" },
]

export function addUserAccessControlColumns(db: DatabaseSync): void {
  const present = existingColumns(db, "users")

  for (const column of USER_COLUMNS) {
    if (present.has(column.name)) continue
    db.exec(`ALTER TABLE users ADD COLUMN ${column.name} ${column.definition}`)
  }
}

export const userAccessControlColumns = USER_COLUMNS

export function addUnitPricingColumn(db: DatabaseSync): void {
  const present = existingColumns(db, "inventory_units")

  if (!present.has("pricing_config")) {
    db.exec(
      "ALTER TABLE inventory_units ADD COLUMN pricing_config TEXT NOT NULL DEFAULT '{}'",
    )
  }
}

/**
 * Spend attribution for construction (migration 0043). Expense and invoice
 * rows gain nullable tags; the phase's actuals are the SUM of the rows that
 * carry them. Task-level wins over phase-level — a row tagged to a task is
 * that task's spend *is* the phase's spend, never both — so the rollup
 * counts a tagged row once.
 */
export function addConstructionAttributionColumns(db: DatabaseSync): void {
  const expenseColumns: ColumnSpec[] = [
    {
      name: "construction_phase_id",
      definition: "TEXT REFERENCES construction_phases (id) ON DELETE SET NULL",
    },
    {
      name: "construction_task_id",
      definition: "TEXT REFERENCES construction_tasks (id) ON DELETE SET NULL",
    },
  ]

  const present = existingColumns(db, "expenses")
  for (const column of expenseColumns) {
    if (present.has(column.name)) continue
    db.exec(
      `ALTER TABLE expenses ADD COLUMN ${column.name} ${column.definition}`,
    )
  }

  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_expenses_construction ON expenses (tenant_id, construction_phase_id)",
  )

  const invoiceColumns: ColumnSpec[] = [
    {
      name: "construction_phase_id",
      definition: "TEXT REFERENCES construction_phases (id) ON DELETE SET NULL",
    },
    {
      name: "construction_task_id",
      definition: "TEXT REFERENCES construction_tasks (id) ON DELETE SET NULL",
    },
  ]

  const invoicePresent = existingColumns(db, "vendor_invoices")
  for (const column of invoiceColumns) {
    if (invoicePresent.has(column.name)) continue
    db.exec(
      `ALTER TABLE vendor_invoices ADD COLUMN ${column.name} ${column.definition}`,
    )
  }

  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_vendor_invoices_construction ON vendor_invoices (tenant_id, construction_phase_id)",
  )
}

/**
 * The purchase side of a vendor invoice (migration 0046). A GRN may raise
 * an ordinary vendor invoice; this tag is what lets the three-way match
 * point at the invoices that belong to a PO without inventing a second
 * payable table.
 */
export function addProcurementAttributionColumns(db: DatabaseSync): void {
  const present = existingColumns(db, "vendor_invoices")

  if (!present.has("purchase_order_id")) {
    db.exec(
      "ALTER TABLE vendor_invoices ADD COLUMN purchase_order_id TEXT REFERENCES purchase_orders (id) ON DELETE SET NULL",
    )
  }

  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_vendor_invoices_po ON vendor_invoices (tenant_id, purchase_order_id)",
  )
}

/**
 * The property category system (migration 0054).
 *
 * `inventory_units` gains the classification columns, every one of them nullable.
 * Nullability is what makes an `ADD COLUMN` safe on a populated table: SQLite treats a
 * nullable column with no default as a metadata change, so a company's entire stock is
 * never copied through a temporary table or re-validated. A `NOT NULL DEFAULT` would
 * have forced the rebuild this feature specifically cannot take.
 *
 * The three steps after the columns are the reason this half lives in code rather than
 * in the `.sql`: seeding reads the shared option list, the backfill is only correct
 * once the columns exist, and the category index names a column that does not exist
 * until the `ALTER TABLE` has run.
 */
const UNIT_CATEGORY_COLUMNS: ColumnSpec[] = [
  // The nine dropdown classifications, stored as option keys rather than labels, so a
  // rename in Settings does not rewrite every unit.
  { name: "property_type", definition: "TEXT" },
  { name: "usage_category", definition: "TEXT" },
  { name: "property_subtype", definition: "TEXT" },
  { name: "furnishing", definition: "TEXT" },
  { name: "sale_mode", definition: "TEXT" },
  { name: "possession", definition: "TEXT" },
  { name: "ownership", definition: "TEXT" },
  { name: "ownership_notes", definition: "TEXT" },
  // A size typed in the unit the buyer shops in, next to the square feet every existing
  // screen already reads. `size_value` is REAL because five and a half marla is normal.
  { name: "size_value", definition: "REAL" },
  { name: "size_unit", definition: "TEXT" },
  // The detail fields. Nullable, because "nobody recorded the bedrooms" is a different
  // fact from "this shop has zero bedrooms", and a 0 would be printed as a number.
  { name: "bedrooms", definition: "INTEGER" },
  { name: "bathrooms", definition: "INTEGER" },
  { name: "kitchens", definition: "INTEGER" },
  { name: "lounges", definition: "INTEGER" },
  { name: "floors_count", definition: "INTEGER" },
  { name: "floor_number", definition: "INTEGER" },
  { name: "parking", definition: "INTEGER" },
  { name: "facing", definition: "TEXT" },
  { name: "property_view", definition: "TEXT" },
  { name: "age_years", definition: "INTEGER" },
  // Location and free text.
  { name: "address", definition: "TEXT" },
  { name: "area_city", definition: "TEXT" },
  { name: "latitude", definition: "REAL" },
  { name: "longitude", definition: "REAL" },
  { name: "description", definition: "TEXT" },
]

export function addUnitCategoryColumns(db: DatabaseSync): void {
  const present = existingColumns(db, "inventory_units")

  for (const column of UNIT_CATEGORY_COLUMNS) {
    if (present.has(column.name)) continue
    db.exec(
      `ALTER TABLE inventory_units ADD COLUMN ${column.name} ${column.definition}`,
    )
  }

  // Existing tenants get the default vocabulary here; a workspace created from now on
  // gets it at signup, from the same function.
  seedAllTenantsInventoryCategories(db, new Date().toISOString())

  backfillUnitCategories(db)

  // The read behind the category summary cards and the dashboard breakdown.
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_inventory_units_category ON inventory_units (tenant_id, property_type)",
  )
}

/** Exported for the test suite, which asserts the migration is re-runnable. */
export const unitCategoryColumns = UNIT_CATEGORY_COLUMNS
