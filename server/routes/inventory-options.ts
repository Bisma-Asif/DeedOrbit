/**
 * The tenant's property category vocabulary.
 *
 * Migration 0054 turned "what kind of thing is this unit" from five checked literals
 * into nine dropdown lists a workspace owns — property type, usage, sub-type,
 * furnishing, sale mode, possession, ownership, size unit and amenities — stored in
 * `inventory_category_options`. This route owns that table: reading it, adding to it,
 * renaming and retiring entries, and the category counts the Inventory page and the
 * dashboard render. The helpers the inventory route needs to validate a category it
 * was handed live here too, so "a property type this workspace has" has one meaning.
 *
 * The shape deliberately copies `server/routes/unit-statuses.ts`, which solved the same
 * problem one migration earlier, with two differences that matter:
 *
 *  * A category row may be renamed and retired even when it is built-in. A status is a
 *    state the product counts and colours, so "Blocked / Hold" losing its amber would
 *    change what every dashboard means. A category is a word a sales desk uses: the
 *    whole point of the feature is that one company says "Flat" and the next says
 *    "Apartment". The stored `key` is what units and reports use, and it never changes
 *    while a unit holds it, so renaming is cosmetic by construction.
 *
 *  * One table holds nine lists, so every read and write carries a `kind`, and the
 *    sub-type list carries a `parent_key` — which is what stops "Park Facing" appearing
 *    under a Penthouse. Uniqueness is therefore per (tenant, kind, parent), and the
 *    indexes wrap `parent_key` in `IFNULL` because SQLite counts two NULLs as distinct.
 *
 * Reads need `inventory.view`, because anybody who can see a unit has to be able to name
 * its type. Writes need `settings.edit`: the vocabulary is workspace configuration that
 * outlives any one project, exactly as the status list does.
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
  OPEN_UNIT_STATUS_KEYS,
  isUnitType,
  type UnitType,
} from "../../shared/inventory.ts"

import {
  INVENTORY_OPTION_KINDS,
  INVENTORY_OPTION_LABEL_MAX,
  INVENTORY_OPTION_MAX_PER_KIND,
  INVENTORY_OPTION_SEEDS,
  LEGACY_UNIT_TYPES,
  UNIT_SIZE_VALUE_MAX,
  UNIT_SIZE_VALUE_MIN,
  inventoryOptionKeyFromLabel,
  isInventoryOptionKind,
  type InventoryOptionKind,
} from "../../shared/inventory-categories.ts"

const now = () => new Date().toISOString()

// --- Rows and views ---------------------------------------------------------

type OptionRow = {
  id: string

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
}

/** One option as the wire carries it. */

export interface InventoryOptionView {
  id: string

  kind: InventoryOptionKind

  key: string

  label: string

  parentKey: string | null

  /** Property types only: the coarse family `inventory_units.unit_type` keeps. */

  legacyType: UnitType | null

  /** Property types only: the usage category picked alongside it. */

  usageKey: string | null

  /** Size units only: square feet per one of this unit. */

  valueNum: number | null

  /** Property types only: bare land, which is what hides bedrooms on the form. */

  isLand: boolean

  isBuiltin: boolean

  isArchived: boolean

  sortOrder: number
}

/** Every list, indexed by the key a unit row stores. */

export type InventoryCategoryMaps = Record<InventoryOptionKind, Map<string, InventoryOptionView>>

const SELECT = `SELECT id, kind, key, label, parent_key, legacy_type, usage_key, value_num,
       is_land, is_builtin, is_archived, sort_order
  FROM inventory_category_options`

function toLegacyType(value: string | null): UnitType | null {
  return value !== null && isUnitType(value) ? value : null
}

function toView(row: OptionRow): InventoryOptionView {
  return {
    id: row.id,

    kind: isInventoryOptionKind(row.kind) ? row.kind : "property_type",

    key: row.key,

    label: row.label,

    parentKey: row.parent_key,

    legacyType: toLegacyType(row.legacy_type),

    usageKey: row.usage_key,

    valueNum: row.value_num,

    isLand: row.is_land === 1,

    isBuiltin: row.is_builtin === 1,

    isArchived: row.is_archived === 1,

    sortOrder: row.sort_order,
  }
}

// --- Reading ----------------------------------------------------------------

/** One list, retired entries included, in picker order. */

export function readOptions(
  tenantId: string,

  kind: InventoryOptionKind,
): InventoryOptionView[] {
  return all<OptionRow>(
    `${SELECT}
      WHERE tenant_id = ? AND kind = ?
      ORDER BY sort_order, label COLLATE NOCASE`,

    tenantId,

    kind,
  ).map(toView)
}

/**
 * All nine lists at once, keyed case-insensitively.
 *
 * A single read rather than one per kind because a unit payload resolves eight of them
 * per row: nine queries per listing would be the N+1 this codebase avoids everywhere
 * else, and the whole vocabulary is a few hundred rows for a tenant.
 */

export function readCategoryMaps(tenantId: string): InventoryCategoryMaps {
  const maps = {} as InventoryCategoryMaps

  for (const kind of INVENTORY_OPTION_KINDS) maps[kind] = new Map()

  for (const row of all<OptionRow>(
    `${SELECT} WHERE tenant_id = ? ORDER BY sort_order, label COLLATE NOCASE`,

    tenantId,
  )) {
    const view = toView(row)

    maps[view.kind].set(view.key.toLowerCase(), view)
  }

  return maps
}

/** The live entries of one list — what a picker or an importer may offer. */

export function liveOptions(
  maps: InventoryCategoryMaps,

  kind: InventoryOptionKind,

  parentKey: string | null = null,
): InventoryOptionView[] {
  return [...maps[kind].values()].filter(
    (option) =>
      !option.isArchived &&
      (parentKey === null || option.parentKey === parentKey),
  )
}

/**
 * Names a stored key for the wire.
 *
 * Same fallback chain as `describeStatus`: the tenant's own row first, then the shipped
 * seed label, then the raw key. A unit whose category row was lost must still print a
 * word, because a blank classification is indistinguishable from an unclassified unit,
 * and a raw `corner_shop` in a quotation is worse than either.
 */

export function describeOption(
  kind: InventoryOptionKind,

  key: string | null,

  maps: InventoryCategoryMaps,
): string | null {
  if (key === null || key === "") return null

  const found = maps[kind].get(key.toLowerCase())

  if (found) return found.label

  const seed = INVENTORY_OPTION_SEEDS[kind].find((option) => option.key === key)

  return seed?.label ?? key
}

/** The option row behind a key, if the tenant has one. */

export function findOption(
  maps: InventoryCategoryMaps,

  kind: InventoryOptionKind,

  key: string | null,
): InventoryOptionView | undefined {
  if (key === null || key === "") return undefined

  return maps[kind].get(key.toLowerCase())
}

/**
 * Reads one category field off a request body against the tenant's own lists.
 *
 * An absent field is `fallback` (the stored value on a PATCH, the default on a create).
 * `null` clears it. A label is accepted as well as a key, because the CSV importer and
 * anyone pasting from a brochure type "Corner Shop" rather than `corner_shop`; the
 * match is case- and punctuation-insensitive for the same reason.
 */

export function readOptionKey(
  raw: unknown,

  kind: InventoryOptionKind,

  maps: InventoryCategoryMaps,

  fallback: string | null,

  parentKey: string | null = null,
): {
  value: string | null

  invalid: boolean
} {
  if (raw === undefined) return { value: fallback, invalid: false }

  if (raw === null) return { value: null, invalid: false }

  if (typeof raw !== "string" || raw.trim() === "") {
    return { value: fallback, invalid: true }
  }

  const needle = normalizeChoice(raw)

  const candidates =
    parentKey === null
      ? [...maps[kind].values()]
      : [...maps[kind].values()].filter(
          (option) => option.parentKey === parentKey,
        )

  const found = candidates.find(
    (option) =>
      option.key.toLowerCase() === needle ||
      normalizeChoice(option.label) === needle,
  )

  if (!found || found.isArchived) return { value: fallback, invalid: true }

  return { value: found.key, invalid: false }
}

/** The names a user can pick from, for a rejection that tells them what to type. */

export function optionChoices(
  maps: InventoryCategoryMaps,

  kind: InventoryOptionKind,

  parentKey: string | null = null,
): string {
  return liveOptions(maps, kind, parentKey)

    .map((option) => option.label)

    .join(", ")
}

/** Loose match for a typed label: case, spacing and punctuation are all noise. */

function normalizeChoice(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "")
}

// --- Rules ------------------------------------------------------------------

const LABEL_RULES: readonly TextRule[] = [
  {
    key: "label",

    max: INVENTORY_OPTION_LABEL_MAX,

    min: 1,

    required: true,

    requiredError: "Give the option a name.",

    minError: "Give the option a name.",
  },
]

// --- Routes -----------------------------------------------------------------

/**
 * GET /api/inventory-options
 *
 * The whole vocabulary plus how many units hold each entry, so the Settings tab can
 * warn "4 units still say Shop" before retiring one, and every picker in the app can be
 * filled from one request.
 */

export async function listOptions(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "inventory", "view")

  const maps = readCategoryMaps(guarded.tenantId)

  const options = {} as Record<InventoryOptionKind, InventoryOptionView[]>

  const archived = {} as Record<InventoryOptionKind, InventoryOptionView[]>

  for (const kind of INVENTORY_OPTION_KINDS) {
    const rows = [...maps[kind].values()]

    options[kind] = rows.filter((row) => !row.isArchived)

    archived[kind] = rows.filter((row) => row.isArchived)
  }

  return {
    options,

    archived,

    // Counted once across every unit in the workspace: a category belongs to the tenant,

    // so the number that matters when you retire one is how many units anywhere hold it.

    unitCounts: countUnitsByOption(guarded.tenantId),

    canManage: guarded.can("settings", "edit"),
  }
}

/**
 * One grouped count against the option key it belongs to.
 *
 * Named rather than inline because `oxfmt` strips the separators out of a single-line
 * object type literal, and `key` is nullable here so the union needs one.
 */
interface KeyCount {
  key: string | null

  count: number
}

/** How many units hold each option, keyed `kind:key`. */

function countUnitsByOption(tenantId: string): Record<string, number> {
  const counts: Record<string, number> = {}

  const columnFor: Partial<Record<InventoryOptionKind, string>> = {
    property_type: "property_type",

    usage_category: "usage_category",

    property_subtype: "property_subtype",

    furnishing: "furnishing",

    sale_mode: "sale_mode",

    possession_status: "possession",

    ownership_type: "ownership",

    size_unit: "size_unit",
  }

  for (const kind of INVENTORY_OPTION_KINDS) {
    const column = columnFor[kind]

    if (column === undefined) continue

    for (const row of all<KeyCount>(
      `SELECT ${column} AS key, count(*) AS count FROM inventory_units
        WHERE tenant_id = ? AND ${column} IS NOT NULL
        GROUP BY ${column}`,

      tenantId,
    )) {
      if (row.key === null) continue

      counts[`${kind}:${row.key}`] = row.count
    }
  }

  for (const row of all<KeyCount>(
    `SELECT a.amenity_key AS key, count(*) AS count
       FROM inventory_unit_amenities a
       JOIN inventory_units u ON u.id = a.unit_id
      WHERE u.tenant_id = ?
      GROUP BY a.amenity_key`,

    tenantId,
  )) {
    if (row.key === null) continue

    counts[`amenity:${row.key}`] = row.count
  }

  return counts
}

/**
 * How many units hold one option.
 *
 * Amenities live in their own table, so they are the one kind the unit row does not
 * name directly; asking `inventory_units` about them would always answer zero and let a
 * rename move a key out from under the rows that store it.
 */

export function countUnitsHolding(
  tenantId: string,

  kind: InventoryOptionKind,

  key: string,
): number {
  if (kind === "amenity") {
    return (
      get<{ count: number }>(
        `SELECT count(*) AS count
           FROM inventory_unit_amenities a
           JOIN inventory_units u ON u.id = a.unit_id
          WHERE u.tenant_id = ? AND a.amenity_key = ?`,

        tenantId,

        key,
      )?.count ?? 0
    )
  }

  const column: Partial<Record<InventoryOptionKind, string>> = {
    property_type: "property_type",

    usage_category: "usage_category",

    property_subtype: "property_subtype",

    furnishing: "furnishing",

    sale_mode: "sale_mode",

    possession_status: "possession",

    ownership_type: "ownership",

    size_unit: "size_unit",
  }

  const name = column[kind]

  if (name === undefined) return 0

  return (
    get<{ count: number }>(
      `SELECT count(*) AS count FROM inventory_units
        WHERE tenant_id = ? AND ${name} = ?`,

      tenantId,

      key,
    )?.count ?? 0
  )
}

/** POST /api/inventory-options */

export async function createOption(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "settings", "edit")

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  if (!isInventoryOptionKind(body.kind)) {
    throw badRequest("Check the highlighted fields", {
      kind: "Choose which list to add to.",
    })
  }

  const kind = body.kind

  const errors: Record<string, string> = {}

  const { values, errors: labelErrors } = validateTextFields(body, LABEL_RULES)

  Object.assign(errors, labelErrors)

  const label = values.label ?? ""

  const key = inventoryOptionKeyFromLabel(label)

  // A label of pure punctuation normalises to an empty key, which is an unusable stored

  // value even though the label itself is long enough.

  if (label !== "" && key === "") {
    errors.label = "Use at least one letter or digit in the name."
  }

  const maps = readCategoryMaps(guarded.tenantId)

  const existing = [...maps[kind].values()]

  if (existing.length >= INVENTORY_OPTION_MAX_PER_KIND) {
    throw conflict(
      `This list already has the maximum of ${INVENTORY_OPTION_MAX_PER_KIND} entries`,
    )
  }

  // Sub-types are the one list that needs a parent, and the only reason a key can mean

  // two things: "Normal" under Plot and "Normal" under House are different answers.

  const parentKey =
    kind === "property_subtype" ? readParentKey(body, maps, errors) : null

  if (key !== "") {
    const clash = existing.find(
      (option) =>
        option.key.toLowerCase() === key.toLowerCase() &&
        option.parentKey === parentKey,
    )

    if (clash)
      errors.label = `An option called "${clash.label}" already exists.`
  }

  const valueNum = kind === "size_unit" ? readFactor(body, errors) : null

  if (Object.keys(errors).length > 0) {
    throw badRequest("Check the highlighted fields", errors)
  }

  const id = `cat_${guarded.tenantId}_${kind}_${key}_${Math.random().toString(36).slice(2, 8)}`

  const usage = maps.usage_category.get(
    String(body.usageKey ?? "").toLowerCase(),
  )

  const legacyType = readLegacyType(body, kind)

  const sortOrder =
    Math.max(0, ...existing.map((option) => option.sortOrder)) + 1

  const stamp = now()

  try {
    run(
      `INSERT INTO inventory_category_options (
          id, tenant_id, kind, key, label, parent_key, legacy_type, usage_key, value_num,
          is_land, is_builtin, is_archived, sort_order, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?)`,

      id,

      guarded.tenantId,

      kind,

      key,

      label,

      parentKey,

      legacyType,

      kind === "property_type" ? (usage?.key ?? null) : null,

      valueNum,

      body.isLand === true ? 1 : 0,

      sortOrder,

      stamp,

      stamp,
    )
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw conflict("An option with that name already exists", {
        label: "An option with that name already exists",
      })
    }

    throw error
  }

  writeAudit(
    guarded,

    "inventory.category.created",

    "inventory_category_option",

    id,

    { kind, key, label, parentKey },

    ctx.ip,
  )

  const row = get<OptionRow>(
    `${SELECT} WHERE tenant_id = ? AND id = ?`,
    guarded.tenantId,
    id,
  )

  if (!row) throw notFound("That option does not exist")

  return { option: toView(row) }
}

/** PATCH /api/inventory-options/:id */

export async function updateOption(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "settings", "edit")

  const optionId = ctx.params.id

  if (!optionId) throw notFound("That option does not exist")

  // Tenant-scoped, so another workspace's option id is a miss rather than a forbidden.

  const row = get<OptionRow>(
    `${SELECT} WHERE tenant_id = ? AND id = ?`,

    guarded.tenantId,

    optionId,
  )

  if (!row) throw notFound("That option does not exist")

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const errors: Record<string, string> = {}

  const maps = readCategoryMaps(guarded.tenantId)

  const kind = isInventoryOptionKind(row.kind) ? row.kind : "property_type"

  const siblings = [...maps[kind].values()].filter(
    (option) => option.id !== optionId,
  )

  let label = row.label

  if (body.label !== undefined) {
    const { values, errors: labelErrors } = validateTextFields(
      body,
      LABEL_RULES,
    )

    Object.assign(errors, labelErrors)

    label = values.label ?? row.label

    // Checked against the other rows in this same list and parent, because two options

    // that read identically in one picker are one option with a typo.

    if (normalizeChoice(label) !== normalizeChoice(row.label)) {
      const clash = siblings.find(
        (option) =>
          option.parentKey === row.parent_key &&
          normalizeChoice(option.label) === normalizeChoice(label),
      )

      if (clash)
        errors.label = `An option called "${clash.label}" already exists.`
    }
  }

  let isArchived = row.is_archived === 1

  if (body.isArchived !== undefined) {
    if (typeof body.isArchived !== "boolean") {
      errors.isArchived = "Say whether to hide this option."
    } else {
      isArchived = body.isArchived
    }
  }

  let valueNum = row.value_num

  if (body.valueNum !== undefined) {
    const factor = readFactor(body, errors, "valueNum")

    if (factor !== null) valueNum = factor
  }

  let isLand = row.is_land === 1

  if (body.isLand !== undefined) {
    if (typeof body.isLand !== "boolean") {
      errors.isLand = "Say whether this is bare land."
    } else {
      isLand = body.isLand
    }
  }

  const usageKey =
    kind === "property_type" && body.usageKey !== undefined
      ? readOptionKey(body.usageKey, "usage_category", maps, row.usage_key)
      : { value: row.usage_key, invalid: false }

  if (usageKey.invalid) {
    errors.usageKey = `Choose one of: ${optionChoices(maps, "usage_category")}.`
  }

  const legacyType = readLegacyType(body, kind, row.legacy_type)

  if (Object.keys(errors).length > 0) {
    throw badRequest("Check the highlighted fields", errors)
  }

  // The key follows the label only while no unit holds it, exactly as a status does: a

  // unit storing `corner_shop` must keep resolving to this row after a rename, so the

  // stored key stays put and only the word changes.

  const held = countUnitsHolding(guarded.tenantId, kind, row.key) > 0

  const key = held ? row.key : inventoryOptionKeyFromLabel(label)

  try {
    run(
      `UPDATE inventory_category_options
          SET key = ?, label = ?, legacy_type = ?, usage_key = ?, value_num = ?,
              is_land = ?, is_archived = ?, updated_at = ?
        WHERE tenant_id = ? AND id = ?`,

      key,

      label,

      kind === "property_type" ? legacyType : row.legacy_type,

      kind === "property_type" ? (usageKey.value ?? null) : row.usage_key,

      valueNum,

      isLand ? 1 : 0,

      isArchived ? 1 : 0,

      now(),

      guarded.tenantId,

      optionId,
    )
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw conflict("An option with that name already exists", {
        label: "An option with that name already exists",
      })
    }

    throw error
  }

  writeAudit(
    guarded,

    "inventory.category.updated",

    "inventory_category_option",

    optionId,

    {
      from: { label: row.label, isArchived: row.is_archived === 1 },

      to: { label, isArchived },
    },

    ctx.ip,
  )

  const updated = get<OptionRow>(
    `${SELECT} WHERE tenant_id = ? AND id = ?`,

    guarded.tenantId,

    optionId,
  )

  if (!updated) throw notFound("That option does not exist")

  return { option: toView(updated) }
}

/** One variant's share inside a property type. Named so `oxfmt` cannot collapse it. */

interface SummarySubtype {
  key: string | null

  label: string

  count: number
}

/** One property type's share of the stock, with the variants folded into it. */

interface SummaryGroup {
  key: string | null

  label: string

  usageKey: string | null

  usageLabel: string | null

  total: number

  available: number

  value: number

  subtypes: SummarySubtype[]
}

/**
 * GET /api/inventory-categories
 *
 * Category-wise counts for the summary cards and the dashboard breakdown, for one
 * project (`?project=`) or for the whole workspace. `available` is counted against the
 * open status keys rather than a literal, because a workspace that renamed its states
 * still has to be able to answer "how many of these can I sell today".
 *
 * Each group carries its own `subtypes`, because the Shop card is the one that has to
 * say "Corner Shop 4 · Mezzanine 2" — a tenant-wide list beside a per-type card is a
 * caption that belongs to no card on the screen.
 */

export async function categorySummary(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "inventory", "view")

  const projectId = ctx.query.get("project")

  const maps = readCategoryMaps(guarded.tenantId)

  const scope = projectId ? "AND project_id = ?" : ""

  const scopeParams = projectId
    ? [guarded.tenantId, projectId]
    : [guarded.tenantId]

  const rows = all<{
    property_type: string | null

    usage_category: string | null

    status: string

    count: number

    value: number

    open: number
  }>(
    `SELECT property_type, usage_category, status,
            count(*) AS count,
            SUM(base_price) AS value,
            SUM(CASE WHEN status IN (${OPEN_UNIT_STATUS_KEYS.map(() => "?").join(",")})
                     THEN 1 ELSE 0 END) AS open
       FROM inventory_units
      WHERE tenant_id = ? ${scope}
      GROUP BY property_type, usage_category, status`,

    ...OPEN_UNIT_STATUS_KEYS,

    guarded.tenantId,

    ...(projectId ? [projectId] : []),
  )

  const groups = new Map<string, SummaryGroup>()

  for (const row of rows) {
    const key = row.property_type ?? ""

    const fresh: SummaryGroup = {
      key: row.property_type,

      label:
        describeOption("property_type", row.property_type, maps) ??
        "Unclassified",

      usageKey: row.usage_category,

      usageLabel: describeOption("usage_category", row.usage_category, maps),

      total: 0,

      available: 0,

      value: 0,

      subtypes: [],
    }

    const group = groups.get(key) ?? fresh

    group.total += row.count

    group.available += row.open

    group.value += row.value

    groups.set(key, group)
  }

  // Counted with the same scope as the cards above: a breakdown filtered to one project

  // must not caption its cards with variants counted across the whole workspace. Ordered

  // by count once, so each card's own line reads largest first without a second sort.

  const subtypeRows = all<{
    property_type: string | null

    property_subtype: string | null

    count: number
  }>(
    `SELECT property_type, property_subtype, count(*) AS count FROM inventory_units
      WHERE tenant_id = ? ${scope} AND property_subtype IS NOT NULL AND property_subtype <> ''
      GROUP BY property_type, property_subtype
      ORDER BY count DESC`,

    ...scopeParams,
  )

  const named: SummarySubtype[] = subtypeRows.map((row) => ({
    key: row.property_subtype,

    label:
      describeOption("property_subtype", row.property_subtype, maps) ??
      row.property_subtype ??
      "",

    count: row.count,
  }))

  subtypeRows.forEach((row, index) => {
    const group = groups.get(row.property_type ?? "")

    const subtype = named[index]

    if (group !== undefined && subtype !== undefined) {
      group.subtypes.push(subtype)
    }
  })

  return {
    groups: [...groups.values()].sort(
      (a, b) =>
        b.total - a.total ||
        a.label.localeCompare(b.label, undefined, { sensitivity: "base" }),
    ),

    // The variant list on its own too, because the filter chips read it when no card is

    // on screen.

    subtypes: named,

    total: rows.reduce((sum, row) => sum + row.count, 0),
  }
}

// --- Field helpers ----------------------------------------------------------

function readParentKey(
  body: Record<string, unknown>,

  maps: InventoryCategoryMaps,

  errors: Record<string, string>,
): string | null {
  const parent = readOptionKey(
    body.parentKey ?? body.propertyType,

    "property_type",

    maps,

    null,
  )

  if (parent.invalid) {
    errors.parentKey = `Choose which property type this variant belongs to: ${optionChoices(maps, "property_type")}.`

    return null
  }

  if (parent.value === null) {
    errors.parentKey = "Choose which property type this variant belongs to."

    return null
  }

  return parent.value
}

/** A size unit's square-foot value: required, positive, and sane. */

function readFactor(
  body: Record<string, unknown>,

  errors: Record<string, string>,

  field = "valueNum",
): number | null {
  const raw = body[field]

  if (raw === undefined || raw === null || raw === "") {
    errors[field] = "Enter how many square feet one of this unit is."

    return null
  }

  const value = typeof raw === "number" ? raw : Number(String(raw).trim())

  if (
    !Number.isFinite(value) ||
    value < UNIT_SIZE_VALUE_MIN ||
    value > UNIT_SIZE_VALUE_MAX
  ) {
    errors[field] = "Enter a square-foot value between 0.01 and 10,000,000."

    return null
  }

  return value
}

/**
 * Which of the five coarse families a property type counts as.
 *
 * Required for a property type, because the rest of the product still groups by
 * `unit_type` — dealer scopes, reports, the sold/available tiles. Left null on the
 * other eight lists, where the column is meaningless.
 */

function readLegacyType(
  body: Record<string, unknown>,

  kind: InventoryOptionKind,

  current: string | null = null,
): string | null {
  if (kind !== "property_type") return current

  const raw = body.unitType ?? body.legacyType

  if (raw === undefined) return current ?? "plot"

  return typeof raw === "string" &&
    (LEGACY_UNIT_TYPES as readonly string[]).includes(raw)
    ? raw
    : "plot"
}
