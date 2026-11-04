/**
 * Command-line runner for the demo dataset.
 *
 *   node server/sample/cli.ts --status
 *   node server/sample/cli.ts --load
 *   node server/sample/cli.ts --remove
 *
 * It targets the one workspace the dataset was written for and refuses to run
 * against any other, because the seeded logins, branches and schemes are named
 * for that business. The same functions back the two Settings buttons, so what
 * this prints is what the product does.
 */

import { closeDb } from "../db.ts"

import {
  DEMO_TENANT_SLUG,
  findDemoTenant,
  loadDemoDataset,
  removeDemoDataset,
} from "./dataset.ts"

import { sampleRowCounts } from "./remove.ts"

function usage(): never {
  console.log(
    [
      "usage: node server/sample/cli.ts --load | --remove | --status",

      "",

      `The dataset belongs to the "${DEMO_TENANT_SLUG}" workspace only.`,
    ].join("\n"),
  )

  process.exit(1)
}

const flags = process.argv.slice(2)

const kind = flags.find((arg) =>
  ["--load", "--remove", "--status"].includes(arg),
)

if (!kind || flags.length !== 1) usage()

const tenant = findDemoTenant()

if (!tenant) {
  console.error(`No workspace with slug "${DEMO_TENANT_SLUG}".`)

  closeDb()

  process.exit(1)
}

if (kind === "--status") {
  const tables = sampleRowCounts(tenant.id)

  const rows = tables.reduce((total, table) => total + table.rows, 0)

  console.log(`${tenant.name} (${tenant.id}) — ${rows} registered sample rows`)

  for (const table of tables) console.log(`  ${table.table}: ${table.rows}`)
} else if (kind === "--load") {
  const report = loadDemoDataset(tenant.id)

  console.log(`Loaded ${report.rows} sample rows for ${tenant.name}`)

  for (const table of report.tables) {
    console.log(`  ${table.table}: ${table.rows}`)
  }

  console.log(`Demo password for every seeded login: ${report.password}`)
} else {
  const report = removeDemoDataset(tenant.id)

  console.log(`Removed ${report.rows} sample rows for ${tenant.name}`)

  const left = report.tables.reduce((total, table) => total + table.rows, 0)

  console.log(`  registry rows remaining: ${left}`)
}

closeDb()
