/**
 * Rebrand migration: Innovista Estate -> DeedOrbit, for the values stored in
 * the database (default tenant name/slug, demo user emails, message-template
 * text, demo project name, webhook URL, billing email, and the opaque default
 * tenant id).
 *
 * This is a DATA migration, not a code migration — the code side is already on
 * the new brand. It exists for an already-installed database that must be
 * rebranded in place without wiping it.
 *
 * Safety:
 *   - It rewrites a cell only when that cell literally contains one of the
 *     shipped-default brand tokens below. Tenant-entered text that does not
 *     contain an old brand string is left byte-for-byte untouched.
 *   - Dry run by default. Nothing is written unless you pass --apply.
 *   - Runs in one transaction with foreign keys relaxed (the default tenant id
 *     is renamed consistently across parent and child rows), then verifies with
 *     foreign_key_check before committing.
 *
 * IMPORTANT — after --apply, credentials derived with the OLD HMAC salt are no
 * longer valid, because `server/crypto.ts` rotated its domain-separation salt
 * (innovista.*.v1 -> deedorbit.*.v1). This migration cannot re-hash one-way
 * digests, so the operator must:
 *   - have all users sign in again (existing session rows stop verifying), and
 *   - re-issue any API keys, and treat outstanding password-reset links as dead.
 * Passwords themselves are unaffected (scrypt uses a per-password random salt,
 * not the HMAC domain salt).
 *
 * Usage:
 *   node scripts/rebrand-deedorbit.mjs [path-to-db]           # dry run
 *   node scripts/rebrand-deedorbit.mjs [path-to-db] --apply   # write
 */

import { DatabaseSync } from "node:sqlite"
import { existsSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, "..")

const args = process.argv.slice(2)
const apply = args.includes("--apply")
const pathArg = args.find((a) => !a.startsWith("--"))
const dbPath = resolve(pathArg ?? join(root, "data", "deedorbit.db"))

// Ordered longest-first so a compound literal is replaced before a substring of
// it. All pairs are brand tokens, so unrelated tenant text never matches.
const PAIRS = [
  ["Innovista Estate", "DeedOrbit"],
  ["Innovista Holdings", "DeedOrbit Holdings"],
  ["Innovista Development", "DeedOrbit Development"],
  ["Innovista Estates", "DeedOrbit Estates"],
  ["Innovista Platform", "DeedOrbit Platform"],
  ["Innovista ERP", "DeedOrbit ERP"],
  ["@innovista.com", "@deedorbit.com"],
  ["@innovista.demo", "@deedorbit.demo"],
  ["webhooks/innovista", "webhooks/deedorbit"],
  ["hooks/innovista", "hooks/deedorbit"],
  ["tn_innovista_holdings", "tn_deedorbit_holdings"],
  ["INNOVISTA", "DEEDORBIT"],
  ["Innovista", "DeedOrbit"],
  ["innovista", "deedorbit"],
]

if (!existsSync(dbPath)) {
  console.error(`[rebrand] no such database: ${dbPath}`)
  console.error("[rebrand] pass a path, or boot the API once to create it.")
  process.exit(1)
}

const db = new DatabaseSync(dbPath)
db.exec("PRAGMA foreign_keys = OFF")

const tables = db
  .prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  )
  .all()
  .map((r) => r.name)

// A TEXT-affinity column holding the old brand.
function textColumns(table) {
  return db
    .prepare(`PRAGMA table_info(${JSON.stringify(table)})`)
    .all()
    .filter((c) => /text|char|clob/i.test(c.type || "") || c.type === "")
    .map((c) => c.name)
}

// Build nested REPLACE() so all pairs apply in one statement per column.
function replaceChain(column) {
  let expr = column
  for (const [from, to] of PAIRS) {
    expr = `REPLACE(${expr}, '${from}', '${to}')`
  }
  const test = PAIRS.map(([from]) => `${column} LIKE '%${from}%'`).join(" OR ")
  return { expr, test }
}

let touched = 0
let cells = 0

if (apply) db.exec("BEGIN")

for (const table of tables) {
  for (const column of textColumns(table)) {
    const { expr, test } = replaceChain(column)
    const quotedTable = JSON.stringify(table)
    const quotedColumn = JSON.stringify(column)

    const matches = db
      .prepare(`SELECT COUNT(*) AS n FROM ${quotedTable} WHERE ${test}`)
      .get().n

    if (!matches) continue
    cells += matches
    touched++

    console.log(
      `[rebrand] ${table}.${column}: ${matches} cell(s)${apply ? " -> updating" : " (dry run)"}`,
    )

    if (apply) {
      db.exec(`UPDATE ${quotedTable} SET ${quotedColumn} = ${expr} WHERE ${test}`)
    }
  }
}

// Two default-demo-tenant fields carry initials-derived codes that are NOT the
// literal string "innovista" (so the generic pass above cannot see them) yet
// still encode the old brand: the logo monogram "IH" (Innovista Holdings) and
// the registration-number prefix "IHD". Rebrand them ONLY on the shipped demo
// tenant row, keyed by its id (old or already-renamed), and only where the cell
// still holds the exact default — never touching any real tenant's own codes.
const DEFAULT_IDS = "'tn_deedorbit_holdings', 'tn_innovista_holdings'"
const TARGETED = [
  ["logo_initials", "IH", "DH"],
  ["registration_number", "IHD-1002345", "DOH-1002345"],
]
for (const [column, from, to] of TARGETED) {
  const quoted = JSON.stringify(column)
  const where = `id IN (${DEFAULT_IDS}) AND ${quoted} = '${from}'`
  const n = db.prepare(`SELECT COUNT(*) AS n FROM tenants WHERE ${where}`).get()
    .n
  if (!n) continue
  cells += n
  touched++
  const suffix = apply ? " -> updating" : " (dry run)"
  console.log(
    "[rebrand] tenants." +
      column +
      ": " +
      n +
      " default-demo cell(s) '" +
      from +
      "' -> '" +
      to +
      "'" +
      suffix,
  )
  if (apply) {
    db.exec(`UPDATE tenants SET ${quoted} = '${to}' WHERE ${where}`)
  }
}

if (apply) {
  const violations = db.prepare("PRAGMA foreign_key_check").all()
  if (violations.length > 0) {
    db.exec("ROLLBACK")
    db.exec("PRAGMA foreign_keys = ON")
    console.error(
      `[rebrand] foreign-key violations after rename (${violations.length}); rolled back. Nothing written.`,
    )
    process.exit(1)
  }
  db.exec("COMMIT")
}

db.exec("PRAGMA foreign_keys = ON")
db.close()

console.log(
  apply
    ? `[rebrand] applied: ${cells} cell(s) across ${touched} column(s) rebranded to DeedOrbit.`
    : `[rebrand] dry run: ${cells} cell(s) across ${touched} column(s) WOULD change. Re-run with --apply.`,
)
