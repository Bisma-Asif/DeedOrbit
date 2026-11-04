/**
 * Database access. Uses the SQLite build bundled with Node 24 (`node:sqlite`),
 * so the platform has no native module to compile and no database service to
 * provision — it runs the same way on a locked-down intranet host.
 *
 * Every migration is idempotent and recorded in `schema_migrations`, so booting
 * against an existing file is safe.
 */

import { DatabaseSync } from "node:sqlite"
import { mkdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import {
  addConstructionAttributionColumns,
  addOrganizationSettingsColumns,
  addProcurementAttributionColumns,
  addUnitCategoryColumns,
  addUnitPricingColumn,
  addUserAccessControlColumns,
} from "./migrations.ts"

const here = dirname(fileURLToPath(import.meta.url))
const schemaPath = join(here, "schema.sql")

export type SqlValue = string | number | bigint | Uint8Array | null

let database: DatabaseSync | null = null

export function dbFilePath(): string {
  return process.env.DEEDORBIT_DB ?? join(here, "..", "data", "deedorbit.db")
}

export function getDb(): DatabaseSync {
  if (database) return database

  const path = dbFilePath()
  mkdirSync(dirname(path), { recursive: true })

  database = new DatabaseSync(path)

  // WAL keeps reads from blocking the write that follows a form submission.
  // Foreign keys are off by default in SQLite and must be enabled per
  // connection — without this, tenant_id constraints would not be enforced.
  database.exec("PRAGMA journal_mode = WAL")
  database.exec("PRAGMA foreign_keys = ON")
  database.exec("PRAGMA busy_timeout = 5000")

  migrate(database)
  return database
}

export function closeDb(): void {
  database?.close()
  database = null
}

function migrate(db: DatabaseSync): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name       TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`)

  const applied = new Set(
    (db.prepare("SELECT name FROM schema_migrations").all() as {
      name: string
    }[]).map((row) => row.name),
  )

  // Manual-first data entry. Each of these runs exactly once, on a new database and an
  // old one alike, which is why the new tenant column and the two rebuilt tables are
  // written as SQL here instead of through the idempotent column lists above.
  for (const migration of [
    { name: "0001_platform", sql: readFileSync(schemaPath, "utf8") },
    {
      name: "0002_organization_settings",
      sql: readFileSync(
        join(here, "migrations", "002_organization_settings.sql"),
        "utf8",
      ),
      up: addOrganizationSettingsColumns,
    },
    {
      name: "0003_user_access_controls",
      sql: readFileSync(
        join(here, "migrations", "003_user_access_controls.sql"),
        "utf8",
      ),
      up: addUserAccessControlColumns,
    },
    {
      name: "0004_projects",
      sql: readFileSync(join(here, "migrations", "004_projects.sql"), "utf8"),
    },
    {
      name: "0005_project_structure",
      sql: readFileSync(
        join(here, "migrations", "005_project_structure.sql"),
        "utf8",
      ),
    },
    {
      name: "0006_project_inventory",
      sql: readFileSync(
        join(here, "migrations", "006_project_inventory.sql"),
        "utf8",
      ),
    },
    {
      name: "0007_unit_statuses",
      sql: readFileSync(
        join(here, "migrations", "007_unit_statuses.sql"),
        "utf8",
      ),
    },
    {
      name: "0008_unit_pricing",
      sql: readFileSync(
        join(here, "migrations", "008_unit_pricing.sql"),
        "utf8",
      ),
      up: addUnitPricingColumn,
    },
    {
      name: "0009_leads",
      sql: readFileSync(join(here, "migrations", "009_leads.sql"), "utf8"),
    },
    {
      name: "0010_lead_pipeline",
      sql: readFileSync(
        join(here, "migrations", "010_lead_pipeline.sql"),
        "utf8",
      ),
    },
    {
      name: "0011_customer_profiles",
      sql: readFileSync(
        join(here, "migrations", "011_customer_profiles.sql"),
        "utf8",
      ),
    },
    {
      name: "0012_sales_agents",
      sql: readFileSync(
        join(here, "migrations", "012_sales_agents.sql"),
        "utf8",
      ),
    },
    {
      name: "0013_dealers",
      sql: readFileSync(join(here, "migrations", "013_dealers.sql"), "utf8"),
    },
    {
      name: "0014_quotations",
      sql: readFileSync(join(here, "migrations", "014_quotations.sql"), "utf8"),
    },
    {
      name: "0015_bookings",
      sql: readFileSync(join(here, "migrations", "015_bookings.sql"), "utf8"),
    },
    {
      name: "0016_approvals",
      sql: readFileSync(join(here, "migrations", "016_approvals.sql"), "utf8"),
    },
    {
      name: "0017_payment_plans",
      sql: readFileSync(
        join(here, "migrations", "017_payment_plans.sql"),
        "utf8",
      ),
    },
    {
      name: "0018_approvals_widen",
      sql: readFileSync(
        join(here, "migrations", "018_approvals_widen.sql"),
        "utf8",
      ),
    },
    {
      name: "0019_customer_ledger",
      sql: readFileSync(
        join(here, "migrations", "019_customer_ledger.sql"),
        "utf8",
      ),
    },
    {
      name: "0020_payments_receipts",
      sql: readFileSync(
        join(here, "migrations", "020_payments_receipts.sql"),
        "utf8",
      ),
    },
    {
      name: "0021_late_fees",
      sql: readFileSync(join(here, "migrations", "021_late_fees.sql"), "utf8"),
    },
    {
      name: "0022_refunds",
      sql: readFileSync(join(here, "migrations", "022_refunds.sql"), "utf8"),
    },
    {
      name: "0023_cancellation_rules",
      sql: readFileSync(
        join(here, "migrations", "023_cancellation_rules.sql"),
        "utf8",
      ),
    },
    {
      name: "0024_transfers",
      sql: readFileSync(join(here, "migrations", "024_transfers.sql"), "utf8"),
    },
    {
      name: "0025_collections",
      sql: readFileSync(
        join(here, "migrations", "025_collections.sql"),
        "utf8",
      ),
    },
    {
      name: "0026_chart_of_accounts",
      sql: readFileSync(
        join(here, "migrations", "026_chart_of_accounts.sql"),
        "utf8",
      ),
    },
    {
      name: "0027_expenses",
      sql: readFileSync(join(here, "migrations", "027_expenses.sql"), "utf8"),
    },
    {
      name: "0028_expense_attachments",
      sql: readFileSync(
        join(here, "migrations", "028_expense_attachments.sql"),
        "utf8",
      ),
    },
    {
      name: "0029_approvals_widen_expense",
      sql: readFileSync(
        join(here, "migrations", "029_approvals_widen_expense.sql"),
        "utf8",
      ),
    },
    {
      name: "0030_vendors",
      sql: readFileSync(join(here, "migrations", "030_vendors.sql"), "utf8"),
    },
    {
      name: "0031_vendor_contracts_invoices",
      sql: readFileSync(
        join(here, "migrations", "031_vendor_contracts_invoices.sql"),
        "utf8",
      ),
    },
    {
      name: "0032_vendor_ledger",
      sql: readFileSync(
        join(here, "migrations", "032_vendor_ledger.sql"),
        "utf8",
      ),
    },
    {
      name: "0033_customer_portal_links",
      sql: readFileSync(
        join(here, "migrations", "033_customer_portal_links.sql"),
        "utf8",
      ),
    },
    {
      name: "0034_documents",
      sql: readFileSync(join(here, "migrations", "034_documents.sql"), "utf8"),
    },
    {
      name: "0035_support_tickets",
      sql: readFileSync(
        join(here, "migrations", "035_support_tickets.sql"),
        "utf8",
      ),
    },
    {
      name: "0036_message_templates",
      sql: readFileSync(
        join(here, "migrations", "036_message_templates.sql"),
        "utf8",
      ),
    },
    {
      name: "0037_campaigns",
      sql: readFileSync(join(here, "migrations", "037_campaigns.sql"), "utf8"),
    },
    {
      name: "0038_saved_views",
      sql: readFileSync(
        join(here, "migrations", "038_saved_views.sql"),
        "utf8",
      ),
    },
    {
      name: "0039_notifications",
      sql: readFileSync(
        join(here, "migrations", "039_notifications.sql"),
        "utf8",
      ),
    },
    {
      name: "0040_platform_billing",
      sql: readFileSync(
        join(here, "migrations", "040_platform_billing.sql"),
        "utf8",
      ),
    },
    {
      name: "0041_construction_contractors_phases",
      sql: readFileSync(
        join(here, "migrations", "041_construction_contractors_phases.sql"),
        "utf8",
      ),
    },
    {
      name: "0042_construction_tasks",
      sql: readFileSync(
        join(here, "migrations", "042_construction_tasks.sql"),
        "utf8",
      ),
    },
    {
      name: "0043_construction_progress_logs",
      sql: readFileSync(
        join(here, "migrations", "043_construction_progress_logs.sql"),
        "utf8",
      ),
      up: addConstructionAttributionColumns,
    },
    {
      name: "0044_procurement_materials_requisitions",
      sql: readFileSync(
        join(here, "migrations", "044_procurement_materials_requisitions.sql"),
        "utf8",
      ),
    },
    {
      name: "0045_purchase_orders",
      sql: readFileSync(
        join(here, "migrations", "045_purchase_orders.sql"),
        "utf8",
      ),
    },
    {
      name: "0046_goods_receipts_stock",
      sql: readFileSync(
        join(here, "migrations", "046_goods_receipts_stock.sql"),
        "utf8",
      ),
      up: addProcurementAttributionColumns,
    },
    {
      name: "0047_doc_signatures",
      sql: readFileSync(
        join(here, "migrations", "047_doc_signatures.sql"),
        "utf8",
      ),
    },
    {
      name: "0048_api_keys",
      sql: readFileSync(join(here, "migrations", "048_api_keys.sql"), "utf8"),
    },
    {
      name: "0049_webhooks",
      sql: readFileSync(join(here, "migrations", "049_webhooks.sql"), "utf8"),
    },
    {
      name: "0050_approvals_widen_procurement",
      sql: readFileSync(
        join(here, "migrations", "050_approvals_widen_procurement.sql"),
        "utf8",
      ),
    },
    {
      name: "0051_notifications_widen",
      sql: readFileSync(
        join(here, "migrations", "051_notifications_widen.sql"),
        "utf8",
      ),
    },
    {
      name: "0052_number_sequences_widen",
      sql: readFileSync(
        join(here, "migrations", "052_number_sequences_widen.sql"),
        "utf8",
      ),
    },
    {
      name: "0053_dashboard_overview",
      sql: readFileSync(
        join(here, "migrations", "053_dashboard_overview.sql"),
        "utf8",
      ),
    },
    {
      name: "0054_property_categories",
      sql: readFileSync(
        join(here, "migrations", "054_property_categories.sql"),
        "utf8",
      ),
      up: addUnitCategoryColumns,
    },
    {
      name: "0055_customer_manual_entry",
      sql: readFileSync(
        join(here, "migrations", "055_customer_manual_entry.sql"),
        "utf8",
      ),
    },
    {
      name: "0056_document_manual_verification",
      sql: readFileSync(
        join(here, "migrations", "056_document_manual_verification.sql"),
        "utf8",
      ),
    },
    {
      name: "0057_payment_manual_entry",
      sql: readFileSync(
        join(here, "migrations", "057_payment_manual_entry.sql"),
        "utf8",
      ),
    },
    {
      name: "0058_schedule_manual_control",
      sql: readFileSync(
        join(here, "migrations", "058_schedule_manual_control.sql"),
        "utf8",
      ),
    },
    {
      name: "0059_month_closing",
      sql: readFileSync(
        join(here, "migrations", "059_month_closing.sql"),
        "utf8",
      ),
    },
    {
      name: "0060_permissions_verify",
      sql: readFileSync(
        join(here, "migrations", "060_permissions_verify.sql"),
        "utf8",
      ),
    },
    {
      name: "0061_reminder_settings",
      sql: readFileSync(
        join(here, "migrations", "061_reminder_settings.sql"),
        "utf8",
      ),
    },
    {
      name: "0062_message_templates_language",
      sql: readFileSync(
        join(here, "migrations", "062_message_templates_language.sql"),
        "utf8",
      ),
    },
    {
      name: "0063_outbound_messages",
      sql: readFileSync(
        join(here, "migrations", "063_outbound_messages.sql"),
        "utf8",
      ),
    },
    {
      name: "0064_customer_message_consent",
      sql: readFileSync(
        join(here, "migrations", "064_customer_message_consent.sql"),
        "utf8",
      ),
    },
    {
      name: "0065_installment_promises",
      sql: readFileSync(
        join(here, "migrations", "065_installment_promises.sql"),
        "utf8",
      ),
    },
    {
      name: "0066_reminder_pay_instructions",
      sql: readFileSync(
        join(here, "migrations", "066_reminder_pay_instructions.sql"),
        "utf8",
      ),
    },
    {
      name: "0067_reminders_widen",
      sql: readFileSync(
        join(here, "migrations", "067_reminders_widen.sql"),
        "utf8",
      ),
    },
    {
      name: "0068_document_verification_core",
      sql: readFileSync(
        join(here, "migrations", "068_document_verification_core.sql"),
        "utf8",
      ),
    },
    {
      name: "0069_document_type_catalog",
      sql: readFileSync(
        join(here, "migrations", "069_document_type_catalog.sql"),
        "utf8",
      ),
    },
    {
      name: "0070_document_verification_settings",
      sql: readFileSync(
        join(here, "migrations", "070_document_verification_settings.sql"),
        "utf8",
      ),
    },
    {
      name: "0071_identity_provider_config",
      sql: readFileSync(
        join(here, "migrations", "071_identity_provider_config.sql"),
        "utf8",
      ),
    },
    {
      name: "0072_approvals_widen_documents",
      sql: readFileSync(
        join(here, "migrations", "072_approvals_widen_documents.sql"),
        "utf8",
      ),
    },
    {
      name: "0073_outbound_widen_documents",
      sql: readFileSync(
        join(here, "migrations", "073_outbound_widen_documents.sql"),
        "utf8",
      ),
    },
    {
      name: "0074_doc_reveal_audit_index",
      sql: readFileSync(
        join(here, "migrations", "074_doc_reveal_audit_index.sql"),
        "utf8",
      ),
    },
  ]) {
    if (applied.has(migration.name)) continue
    db.exec("BEGIN")
    try {
      db.exec(migration.sql)
      migration.up?.(db)
      db.prepare(
        "INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)",
      ).run(migration.name, new Date().toISOString())
      db.exec("COMMIT")
    } catch (error) {
      db.exec("ROLLBACK")
      throw error
    }
  }
}

export type Row = Record<string, SqlValue>

/** Read rows, returning plain objects. */
export function all<T = Row>(sql: string, ...params: SqlValue[]): T[] {
  return getDb()
    .prepare(sql)
    .all(...params) as T[]
}

export function get<T = Row>(
  sql: string,
  ...params: SqlValue[]
): T | undefined {
  return getDb()
    .prepare(sql)
    .get(...params) as T | undefined
}

export function run(sql: string, ...params: SqlValue[]): void {
  getDb()
    .prepare(sql)
    .run(...params)
}

/** Runs `fn` inside a transaction, rolling back on any throw. */
export function transaction<T>(fn: () => T): T {
  const db = getDb()
  db.exec("BEGIN")
  try {
    const result = fn()
    db.exec("COMMIT")
    return result
  } catch (error) {
    db.exec("ROLLBACK")
    throw error
  }
}

export function isUniqueViolation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /UNIQUE constraint failed/i.test(message)
}
