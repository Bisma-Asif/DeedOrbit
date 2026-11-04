/**
 * The tenant's chart-of-accounts mapping.
 *
 * Reads return every known source with its current account code (an empty string
 * when no mapping exists), so the client can render the whole list without a
 * second call. Writes take the full map, validate each code shape, and upsert all
 * rows in one transaction — a half-saved chart would produce a journal export
 * where some events land and others do not.
 *
 * Reading needs `settings.view`; writing needs `settings.edit`. Both checks come
 * from the workspace the session already implies, so there is no tenant id in the
 * URL to tamper with.
 */

import { all, run, transaction } from "../db.ts"

import { badRequest, readJsonBody, type RequestContext } from "../http.ts"

import { requireAuth, requirePermission, writeAudit } from "../middleware.ts"

import {
  COA_SOURCES,
  COA_SOURCE_LABELS,
  isValidAccountCode,
  isCoaSource,
  type CoaSource,
} from "../../shared/chart-of-accounts.ts"

const now = () => new Date().toISOString()

interface CoaRow {
  source: string

  account_code: string
}

/**
 * A mapping as the panel reads it: the source, its resolved code (empty when
 * unmapped), and the display label. A named interface rather than an inline
 * literal because `oxfmt` strips the separators from a multi-member literal that
 * fits on one line, turning it into invalid syntax.
 */

interface CoaMappingView {
  source: CoaSource
  accountCode: string
  label: string
}

/** A validated write from the PATCH payload, ready to upsert. */

interface CoaWriteEntry {
  source: CoaSource
  accountCode: string
}

/** The raw shape of one payload element before validation. */

interface CoaRawEntry {
  source?: unknown
  accountCode?: unknown
}

/** Every source key, resolved to its account code (or empty) for a tenant. */

function readMappings(tenantId: string): CoaMappingView[] {
  const rows = new Map<string, string>()

  for (const row of getRows(tenantId)) {
    rows.set(row.source, row.account_code)
  }

  return COA_SOURCES.map((source) => ({
    source,

    accountCode: rows.get(source) ?? "",

    label: COA_SOURCE_LABELS[source],
  }))
}

function getRows(tenantId: string): CoaRow[] {
  return all<CoaRow>(
    `SELECT source, account_code FROM chart_of_account_mappings WHERE tenant_id = ?`,

    tenantId,
  )
}

/** GET /api/settings/chart-of-accounts */

export async function getChartOfAccounts(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "settings", "view")

  return { mappings: readMappings(guarded.tenantId) }
}

/**
 * PATCH /api/settings/chart-of-accounts
 *
 * Accepts `{ mappings: [{ source, accountCode }, …] }`. Every source is validated
 * against the closed enum and its code against the ASCII slug rule. Unknown
 * sources and malformed codes both surface as a field-keyed 400 so the form can
 * put the error under the right input.
 */

export async function updateChartOfAccounts(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "settings", "edit")

  const body = await readJsonBody<{ mappings?: unknown }>(ctx.req)

  const raw = Array.isArray(body.mappings) ? body.mappings : null

  if (!raw) {
    throw badRequest("Check the highlighted fields", {
      mappings: "Expected an array of source/account-code pairs.",
    })
  }

  const errors: Record<string, string> = {}

  const seen = new Set<CoaSource>()

  const parsed: CoaWriteEntry[] = []

  for (const [index, item] of raw.entries()) {
    const entry = item as CoaRawEntry

    const source = typeof entry.source === "string" ? entry.source : ""

    if (!isCoaSource(source)) {
      errors[`mappings[${index}].source`] = "Unknown chart-of-accounts source."

      continue
    }

    if (seen.has(source)) {
      errors[`mappings[${index}].source`] = "Duplicate source in the payload."

      continue
    }

    seen.add(source)

    const accountCode =
      typeof entry.accountCode === "string" ? entry.accountCode.trim() : ""

    if (!isValidAccountCode(accountCode)) {
      errors[`mappings[${index}].accountCode`] =
        "Use up to 20 letters, digits, dot, or dash."

      continue
    }

    parsed.push({ source, accountCode })
  }

  if (Object.keys(errors).length > 0) {
    throw badRequest("Check the highlighted fields", errors)
  }

  const stamp = now()

  transaction(() => {
    for (const mapping of parsed) {
      // Upsert: `INSERT OR IGNORE` seeds the row if absent, then the UPDATE owns

      // the value. A plain `INSERT OR REPLACE` would drop and re-add the row and

      // reset `updated_at` even for an unchanged code; this keeps the trail quiet

      // when the mapping is the same as last save.

      run(
        `INSERT OR IGNORE INTO chart_of_account_mappings (
            tenant_id, source, account_code, updated_at
          ) VALUES (?, ?, '', ?)`,

        guarded.tenantId,

        mapping.source,

        stamp,
      )

      run(
        `UPDATE chart_of_account_mappings
            SET account_code = ?, updated_at = ?
          WHERE tenant_id = ? AND source = ?`,

        mapping.accountCode,

        stamp,

        guarded.tenantId,

        mapping.source,
      )
    }
  })

  writeAudit(
    guarded,

    "settings.chart_of_accounts_updated",

    "tenant",

    guarded.tenantId,

    { sources: parsed.map((entry) => entry.source) },

    ctx.ip,
  )

  return { mappings: readMappings(guarded.tenantId) }
}
