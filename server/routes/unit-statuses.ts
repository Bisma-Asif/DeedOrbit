/**
 * The tenant's unit status vocabulary.
 *
 * Migration 0006 held a unit's status as one of four literals checked by the database.
 * That is now data: one row per status per tenant, in `inventory_unit_statuses`. This
 * route owns that table — reading it, adding to it, and retiring from it — and
 * exports the two helpers the inventory route needs to validate a status it was
 * handed, so the definition of "a status this workspace has" lives in one place.
 *
 * Two decisions worth stating, because both look like arbitrary restrictions:
 *
 *  * Built-in statuses cannot be renamed, recoloured or archived. They are the states
 *    this product knows how to count and colour, and "Blocked / Hold" quietly losing
 *    its amber the first time somebody tidied up would change what every dashboard in
 *    the workspace meant. A tenant that genuinely needs a different lifecycle adds a
 *    status rather than redefining one.
 *
 *  * A status is retired, never deleted. Units currently hold it, and it is a true
 *    record of what happened to them; deleting it would either refuse while units are
 *    attached or strip those units of a status that really occurred. Archiving hides
 *    it from the picker and leaves history intact.
 *
 * Reads need `inventory.view`, because anybody who can see a unit has to be able to
 * read the name and colour of its status. Writes need `settings.edit`, not an
 * inventory grant: the vocabulary is workspace-wide configuration that outlives any
 * one project, so it belongs with the other configuration rather than with the stock.
 */

import { all, get, isUniqueViolation, run } from "../db.ts"

import {
  badRequest,
  conflict,
  notFound,
  readJsonBody,
  type RequestContext,
} from "../http.ts"

import { requireAuth, requirePermission, writeAudit } from "../middleware.ts"

import { validateTextFields, type TextRule } from "../validate.ts"

import {
  BUILT_IN_UNIT_STATUS_LABELS,
  BUILT_IN_UNIT_STATUS_TONES,
  UNIT_STATUS_LABEL_MAX,
  UNIT_STATUS_MAX,
  isUnitStatusTone,
  unitStatusKeyFromLabel,
  type UnitStatusTone,
} from "../../shared/inventory.ts"

const now = () => new Date().toISOString()

// --- Rows -------------------------------------------------------------------

type StatusRow = {
  id: string

  key: string

  label: string

  tone: string

  is_builtin: number

  is_archived: number

  sort_order: number
}

/** One status as the wire carries it. */
export interface UnitStatusView {
  id: string

  key: string

  label: string

  tone: UnitStatusTone

  isBuiltin: boolean

  isArchived: boolean

  sortOrder: number
}

/**
 * Narrows the stored tone.
 *
 * The column is `CHECK`ed, so a value outside the set can only come from a
 * hand-edited row. It degrades to `neutral` rather than to null: a status whose
 * colour is unknown still has to render, and grey is the honest answer to "we do not
 * know what this means".
 */
function toTone(value: string): UnitStatusTone {
  return isUnitStatusTone(value) ? value : "neutral"
}

function toView(row: StatusRow): UnitStatusView {
  return {
    id: row.id,

    key: row.key,

    label: row.label,

    tone: toTone(row.tone),

    isBuiltin: row.is_builtin === 1,

    isArchived: row.is_archived === 1,

    sortOrder: row.sort_order,
  }
}

// --- Reading ----------------------------------------------------------------

/**
 * Every status the tenant has, archived ones included.
 *
 * Archived statuses stay in this map on purpose. A unit can still hold one, and the
 * table has to be able to say what that status was called when it was current rather
 * than printing a raw key at the reader.
 */
export function readStatusMap(tenantId: string): Map<string, UnitStatusView> {
  const map = new Map<string, UnitStatusView>()

  for (const row of all<StatusRow>(
    `SELECT id, key, label, tone, is_builtin, is_archived, sort_order
      FROM inventory_unit_statuses
      WHERE tenant_id = ?
      ORDER BY sort_order, label COLLATE NOCASE`,

    tenantId,
  )) {
    map.set(row.key.toLowerCase(), toView(row))
  }

  return map
}

/** The statuses a unit may be moved to: everything the tenant has that is live. */
export function readLiveStatuses(tenantId: string): UnitStatusView[] {
  return [...readStatusMap(tenantId).values()].filter(
    (status) => !status.isArchived,
  )
}

/**
 * Describes a stored status key for the wire.
 *
 * Falls back to the built-in tables and then to the key itself. The fallback chain is
 * what keeps a table cell from ever rendering `under_offer`: if this workspace has the
 * status, the first lookup answers; if the row was somehow lost, the built-in table
 * still names the common ones; and a genuinely unknown key is shown as itself rather
 * than hidden, because a unit with an unreadable status is a problem someone needs to
 * see.
 */
export function describeStatus(
  key: string,
  statuses: Map<string, UnitStatusView>,
): {
  statusLabel: string
  statusTone: UnitStatusTone
} {
  const found = statuses.get(key.toLowerCase())

  if (found) return { statusLabel: found.label, statusTone: found.tone }

  return {
    statusLabel: BUILT_IN_UNIT_STATUS_LABELS[key] ?? key,

    statusTone: BUILT_IN_UNIT_STATUS_TONES[key] ?? "neutral",
  }
}

/**
 * Reads a status key off a request body against the tenant's own vocabulary.
 *
 * `fallback` is the stored value for a PATCH and the default for a create, which is
 * the same contract `readEnum` has for the closed vocabularies. `invalid` means the
 * key was sent but is not one this workspace has — including a status that exists but
 * has been archived, because offering an archived status would be offering a status
 * the workspace has retired.
 */
export function readStatusKey(
  body: Record<string, unknown>,
  statuses: Map<string, UnitStatusView>,
  fallback: string,
): {
  value: string
  invalid: boolean
} {
  const raw = body.status

  if (raw === undefined) return { value: fallback, invalid: false }

  if (typeof raw !== "string" || raw.trim() === "") {
    return { value: fallback, invalid: true }
  }

  const key = raw.trim().toLowerCase()

  const found = statuses.get(key)

  if (!found || found.isArchived) return { value: fallback, invalid: true }

  return { value: key, invalid: false }
}

/**
 * The names a user can pick from, for an error message.
 *
 * Exported because the inventory route has to say the same thing in its own rejection
 * when a unit is sent a status this workspace does not have, and two lists that drift
 * apart would let a user retry with a value the server will refuse again.
 */
export function statusChoices(statuses: Map<string, UnitStatusView>): string {
  return [...statuses.values()]
    .filter((status) => !status.isArchived)
    .map((status) => status.label)
    .join(", ")
}

// --- Rules ------------------------------------------------------------------

const LABEL_RULES: readonly TextRule[] = [
  {
    key: "label",

    max: UNIT_STATUS_LABEL_MAX,

    min: 1,

    required: true,

    requiredError: "Give the status a name.",

    minError: "Give the status a name.",
  },
]

/**
 * Built-in statuses are part of the product, so the answer names that rather than
 * leaving a bare 409: "you cannot do that" reads as a bug until the caller knows the
 * vocabulary itself is immutable. The sentence also says what to do instead, because
 * the thing the admin wanted is available — just not under a name we chose for them.
 */
function refuseBuiltIn(label: string): never {
  throw conflict(
    `"${label}" is a built-in status, so it cannot be renamed, recoloured, or retired. Add a status of your own instead.`,
  )
}

// --- Routes -----------------------------------------------------------------

/** GET /api/unit-statuses */
export async function listStatuses(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "inventory", "view")

  // Read once rather than twice: the live and the retired lists are the same rows
  // partitioned by the archive flag, and two queries could disagree under a concurrent
  // change.

  const map = readStatusMap(guarded.tenantId)

  const statuses = [...map.values()].filter((status) => !status.isArchived)

  // One grouped query rather than a count per status, so the manage dialog can warn
  // "4 units still hold this" without an N+1. Tenant-wide rather than per project,
  // because a status belongs to the workspace: retiring one affects every project, so
  // the count that matters is every project.
  const unitCounts: Record<string, number> = {}

  for (const row of all<{
    status: string
    count: number
  }>(
    `SELECT status, count(*) AS count FROM inventory_units
      WHERE tenant_id = ?
      GROUP BY status`,

    guarded.tenantId,
  )) {
    unitCounts[row.status] = row.count
  }

  const retired = [...map.values()].filter((status) => status.isArchived)

  return {
    statuses,

    // Retired statuses are kept apart rather than dropped, so that the manager can offer
    // to put one back. Reported separately from `statuses` because every other consumer
    // — the pickers, the tiles, the filter — must never offer a status the server would
    // refuse, and a list that made them filter would be a trap. `archivedCount` is kept
    // as well so a client that only wants the number does not have to count.

    archived: retired,

    archivedCount: retired.length,

    unitCounts,

    // Managing the vocabulary is workspace configuration, so it rides on the same
    // grant as the rest of Settings rather than on an inventory permission.

    canManage: guarded.can("settings", "edit"),
  }
}

/** POST /api/unit-statuses */
export async function createStatus(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "settings", "edit")

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const { values, errors } = validateTextFields(body, LABEL_RULES)

  const label = values.label ?? ""

  const tone = typeof body.tone === "string" ? body.tone.trim() : ""

  if (!isUnitStatusTone(tone)) {
    errors.tone = "Choose a colour."
  }

  const key = unitStatusKeyFromLabel(label)

  // A label made entirely of punctuation — "///" — normalises to an empty key, which
  // would be an unusable stored value even though the label itself is long enough.
  if (label !== "" && key === "") {
    errors.label = "Use at least one letter or digit in the name."
  }

  const existing = [...readStatusMap(guarded.tenantId).values()]

  if (existing.length >= UNIT_STATUS_MAX) {
    throw conflict(
      `This workspace already has the maximum of ${UNIT_STATUS_MAX} statuses`,
    )
  }

  if (key !== "") {
    const clash = existing.find(
      (status) => status.key.toLowerCase() === key.toLowerCase(),
    )

    if (clash) {
      errors.label = `A status called "${clash.label}" already exists.`
    }
  }

  if (Object.keys(errors).length > 0) {
    throw badRequest("Check the highlighted fields", errors)
  }

  const id = `st_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`

  // A new status lands after everything already in place: the built-in set is ordered
  // by how far a unit travels, and a tenant's own addition should not appear in the
  // middle of that sequence.
  const sortOrder =
    Math.max(0, ...existing.map((status) => status.sortOrder)) + 1

  try {
    run(
      `INSERT INTO inventory_unit_statuses (
          id, tenant_id, key, label, tone, is_builtin, is_archived, sort_order,
          created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?, ?)`,

      id,

      guarded.tenantId,

      key,

      label,

      tone,

      sortOrder,

      now(),

      now(),
    )
  } catch (error) {
    // The unique indexes are the authority under concurrency; the checks above only
    // make the common case land on the field the user can fix.
    if (isUniqueViolation(error)) {
      throw conflict("A status with that name already exists", {
        label: "A status with that name already exists",
      })
    }

    throw error
  }

  writeAudit(
    guarded,

    "inventory.status.created",

    "inventory_unit_status",

    id,

    { key, label, tone },

    ctx.ip,
  )

  const row = get<StatusRow>(
    `SELECT id, key, label, tone, is_builtin, is_archived, sort_order
       FROM inventory_unit_statuses
      WHERE tenant_id = ? AND id = ?`,

    guarded.tenantId,

    id,
  )

  if (!row) throw notFound("That status does not exist")

  return { status: toView(row) }
}

/** PATCH /api/unit-statuses/:id */
export async function updateStatus(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "settings", "edit")

  const statusId = ctx.params.id

  if (!statusId) throw notFound("That status does not exist")

  const row = get<StatusRow>(
    `SELECT id, key, label, tone, is_builtin, is_archived, sort_order
       FROM inventory_unit_statuses
      WHERE tenant_id = ? AND id = ?`,

    guarded.tenantId,

    statusId,
  )

  // Tenant-scoped, so another workspace's status id is a miss rather than a
  // forbidden — the caller learns nothing about rows it cannot see.
  if (!row) throw notFound("That status does not exist")

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const errors: Record<string, string> = {}

  if (row.is_builtin === 1) {
    throw refuseBuiltIn(row.label)
  }

  const existing = [...readStatusMap(guarded.tenantId).values()].filter(
    (status) => status.id !== statusId,
  )

  let label = row.label

  if (body.label !== undefined) {
    const { values, errors: labelErrors } = validateTextFields(
      body,

      LABEL_RULES,
    )

    Object.assign(errors, labelErrors)

    label = values.label ?? row.label

    const key = unitStatusKeyFromLabel(label)

    if (label !== "" && key === "") {
      errors.label = "Use at least one letter or digit in the name."
    }

    if (key !== "") {
      const clash = existing.find(
        (status) => status.key.toLowerCase() === key.toLowerCase(),
      )

      if (clash)
        errors.label = `A status called "${clash.label}" already exists.`
    }
  }

  let tone = toTone(row.tone)

  if (body.tone !== undefined) {
    if (!isUnitStatusTone(body.tone)) {
      errors.tone = "Choose a colour."
    } else {
      tone = body.tone
    }
  }

  let isArchived = row.is_archived === 1

  if (body.isArchived !== undefined) {
    if (typeof body.isArchived !== "boolean") {
      errors.isArchived = "Say whether to retire this status."
    } else {
      isArchived = body.isArchived
    }
  }

  if (Object.keys(errors).length > 0) {
    throw badRequest("Check the highlighted fields", errors)
  }

  // Archiving is allowed while units still hold the status. Refusing would force an
  // admin to walk every attached unit out of it first, which is friction with no
  // benefit: the flag already stops new assignments, and the units that hold it keep
  // reading correctly because `describeStatus` looks at archived rows too. The counts
  // in the list response are what tell the admin which units those are.
  //
  // Renaming does have a data hazard, because a unit stores the key rather than the
  // label: a unit holding `under_offer` would be left pointing at a key this tenant no
  // longer has, and its table cell would fall back to printing the raw key. So the key
  // follows the label only while no unit holds it, and otherwise stays put — invisible
  // to every user, and the data intact.

  const inUse = get<{ count: number }>(
    `SELECT count(*) AS count FROM inventory_units
      WHERE tenant_id = ? AND status = ?`,

    guarded.tenantId,

    row.key,
  )

  const held = (inUse?.count ?? 0) > 0

  const key = held ? row.key : unitStatusKeyFromLabel(label)

  try {
    run(
      `UPDATE inventory_unit_statuses
          SET key = ?, label = ?, tone = ?, is_archived = ?, updated_at = ?
        WHERE tenant_id = ? AND id = ?`,

      key,

      label,

      tone,

      isArchived ? 1 : 0,

      now(),

      guarded.tenantId,

      statusId,
    )
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw conflict("A status with that name already exists", {
        label: "A status with that name already exists",
      })
    }

    throw error
  }

  writeAudit(
    guarded,

    "inventory.status.updated",

    "inventory_unit_status",

    statusId,

    {
      from: {
        label: row.label,
        tone: toTone(row.tone),
        isArchived: row.is_archived === 1,
      },

      to: { label, tone, isArchived },
    },

    ctx.ip,
  )

  const updated = get<StatusRow>(
    `SELECT id, key, label, tone, is_builtin, is_archived, sort_order
       FROM inventory_unit_statuses
      WHERE tenant_id = ? AND id = ?`,

    guarded.tenantId,

    statusId,
  )

  if (!updated) throw notFound("That status does not exist")

  return { status: toView(updated) }
}
