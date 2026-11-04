/**
 * Removal of a demo dataset: the mirror image of the registry.
 *
 * Every row the seeder wrote is registered in `dashboard_sample_rows`, and
 * nothing else is, so the sweep can only ever delete rows this generator
 * created. Two details make that safe rather than merely convenient:
 *
 *  * The order is child-first (`REMOVAL_ORDER`), so no foreign key is ever
 *    pointed at a row that has already gone. The database runs with
 *    `PRAGMA foreign_keys = ON`, which turns a wrong order into a hard error
 *    instead of an orphan row.
 *
 *  * Most tables key on `id`, but four key on a compound of columns. Those
 *    registrations store their key parts joined by `:`, and `KEY_COLUMNS` says
 *    how to spread them back into a `WHERE` clause. Deleting them by `id` would
 *    match nothing and silently leave membership rows behind.
 *
 * Anything the registry knows about but this list does not is swept last, inside
 * a `try`, because a cascade may already have taken the parent with it.
 */

import { all, run, transaction } from "../db.ts"

import { REMOVAL_ORDER } from "./common.ts"

/** The key columns a registry `row_id` decodes to, per table. */

const KEY_COLUMNS: Record<string, string[]> = {
  sales_agent_targets: ["user_id", "period_month"],

  sales_team_members: ["user_id"],

  user_branches: ["user_id"],

  tenant_memberships: ["user_id"],
}

/** One registered demo row, as read back from SQLite. */

interface RegistryRow {
  table_name: string

  row_id: string
}

/** How many registered rows a single table holds. */

export interface TableCount {
  table: string

  rows: number
}

/** The grouped count as SQLite returns it. */

interface TableCountRow {
  table_name: string

  n: number
}

/** A one-column count, as SQLite returns it. */

interface CountRow {
  n: number
}

/** Only these characters may reach a statement as a table name. */

const SAFE_TABLE = /^[a-z_]+$/

/**
 * Registry entries for one table, newest registration first.
 *
 * The generator writes a parent before its children — the structure tree is the
 * one table that references itself — so reversing the insert order takes the
 * leaves out first and leaves no node pointing at a deleted parent. Plain
 * `rowid` order made the sweep stop on the four nodes that had floors under
 * them, because a `DELETE` of a parent fails while a child row still exists.
 */

const ENTRIES_SQL = `SELECT table_name, row_id FROM dashboard_sample_rows
      WHERE tenant_id = ? AND table_name = ? ORDER BY rowid DESC`

/** Deletes one registered row, spreading a compound key back into the `WHERE`. */

function deleteRow(table: string, tenantId: string, rowId: string): void {
  const columns = KEY_COLUMNS[table] ?? ["id"]

  const parts = rowId.split(":")

  const where = columns.map((column) => `AND ${column} = ?`).join(" ")

  run(
    `DELETE FROM ${table} WHERE tenant_id = ? ${where}`,

    tenantId,

    ...columns.map((_, index) => parts[index] ?? ""),
  )
}

/**
 * Deletes every row registered as sample data for one workspace.
 *
 * Returns the number of registry entries swept. The registry itself is emptied,
 * so a later load starts from a clean slate and the dashboard's own "sample
 * active" banner goes away with it.
 */

export function removeSampleRows(tenantId: string): number {
  return transaction(() => {
    let count = 0

    for (const table of REMOVAL_ORDER) {
      if (!SAFE_TABLE.test(table)) continue

      const entries = all<RegistryRow>(
        ENTRIES_SQL,

        tenantId,

        table,
      )

      for (const entry of entries) {
        deleteRow(table, tenantId, entry.row_id)

        count += 1
      }
    }

    // Anything registered by a newer writer that the order does not name yet.
    // A parent deleted above may have cascaded these away already, so a failure
    // here means the row is already gone rather than that something is wrong.
    const leftovers = all<RegistryRow>(
      `SELECT table_name, row_id FROM dashboard_sample_rows
        WHERE tenant_id = ? ORDER BY rowid DESC`,

      tenantId,
    )

    for (const entry of leftovers) {
      const table = entry.table_name

      // Swept above already; counting it twice would overstate the removal.
      if (REMOVAL_ORDER.includes(table)) continue

      if (SAFE_TABLE.test(table)) {
        try {
          deleteRow(table, tenantId, entry.row_id)
        } catch {
          // Already removed by a cascade; the registry row goes below regardless.
        }
      }

      count += 1
    }

    run("DELETE FROM dashboard_sample_rows WHERE tenant_id = ?", tenantId)

    return count
  })
}

/** Rows currently registered for a workspace, per table. */

export function sampleRowCounts(tenantId: string): TableCount[] {
  return all<TableCountRow>(
    `SELECT table_name, COUNT(*) AS n FROM dashboard_sample_rows
      WHERE tenant_id = ? GROUP BY table_name ORDER BY table_name`,

    tenantId,
  ).map((row) => ({ table: row.table_name, rows: Number(row.n) }))
}

/** True when the workspace has a registered demo dataset. */

export function hasSampleRows(tenantId: string): boolean {
  const row = all<CountRow>(
    "SELECT COUNT(*) AS n FROM dashboard_sample_rows WHERE tenant_id = ?",

    tenantId,
  )[0]

  return Number(row?.n ?? 0) > 0
}
