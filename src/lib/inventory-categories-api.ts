/**
 * Typed client for the property category vocabulary.
 *
 * Migration 0054 turned "what kind of thing is this unit" from five literals into nine
 * dropdown lists a workspace owns, stored per tenant in `inventory_category_options`.
 * The server sends a unit's own resolved labels inside `unit.category` — see
 * `project-inventory-api.ts` — so this client exists for the two things a unit payload
 * cannot carry: the full vocabulary that fills every picker, and the counts.
 *
 * `unitCounts` is keyed `kind:key` rather than nested, because the Settings tab needs
 * "4 units still say Shop" beside the row it is about to retire, and the amenity counts
 * come from a different table on the server. `countUnitsHolding` is the one lookup a
 * caller does with it, so the key format stays a server detail.
 */

import type { InventoryOptionKind } from "@shared/inventory-categories"

import type { UnitType } from "@shared/inventory"

import { api } from "./api"

/** One option as the wire carries it, mirroring the server's `InventoryOptionView`. */

export interface InventoryOptionView {
  id: string

  kind: InventoryOptionKind

  /** The stored key a unit row holds. Renaming an option never changes it. */

  key: string

  label: string

  /** Sub-types only: the property type this variant belongs to. */

  parentKey: string | null

  /** Property types only: the coarse family `unit_type` still records. */

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

export interface InventoryOptionsResponse {
  /** Live entries per list, in picker order. */

  options: InventoryOptionLists

  /** Retired entries per list; only the manager reads these. */

  archived: InventoryOptionLists

  /** How many units hold each option, keyed `kind:key`. */

  unitCounts: Record<string, number>

  /** Whether this role may change the vocabulary — `settings.edit`, not `inventory.edit`. */

  canManage: boolean
}

/**
 * All nine lists at once, keyed by kind.
 *
 * A `Record` rather than a hand-written shape so that adding a list to the shared
 * vocabulary makes it appear here, and the Settings tab cannot quietly forget a column.
 */

export type InventoryOptionLists = Record<InventoryOptionKind, InventoryOptionView[]>

export interface CreateInventoryOptionInput {
  kind: InventoryOptionKind

  label: string

  /** Required for a sub-type: which property type the variant hangs off. */

  parentKey?: string

  /** Property types only: which of the five coarse families this counts as. */

  unitType?: UnitType

  /** Property types only: the usage category picked alongside it. */

  usageKey?: string

  /** Size units only: the square-foot value of one unit of this size. */

  valueNum?: number

  /** Property types only: whether this is a bare piece of land. */

  isLand?: boolean
}

/**
 * Every field optional, because a PATCH says what changes.
 *
 * `key` is never sent: the server moves the stored key with the label only while no unit
 * holds it, so a rename that would strand rows is a rename of the word alone.
 */

export interface UpdateInventoryOptionInput {
  label?: string

  isArchived?: boolean

  valueNum?: number

  isLand?: boolean

  usageKey?: string

  unitType?: UnitType
}

/** One property type's share of the stock, for the summary cards and the chart. */

export interface InventoryCategoryGroup {
  key: string | null

  label: string

  usageKey: string | null

  usageLabel: string | null

  total: number

  /** Units still in an open status — the ones a desk can actually sell today. */

  available: number

  value: number

  /**
   * The variants inside this property type, largest first. The Shop card is where
   * "Corner Shop | Mezzanine | Inside Mall" earns its place on the screen.
   */

  subtypes: InventoryCategorySubtypeGroup[]
}

export interface InventoryCategorySubtypeGroup {
  key: string | null

  label: string

  count: number
}

export interface InventoryCategorySummaryResponse {
  groups: InventoryCategoryGroup[]

  subtypes: InventoryCategorySubtypeGroup[]

  total: number
}

interface OptionPayload {
  option: InventoryOptionView
}

/** The `unitCounts` key for one option. */

export function optionCountKey(
  kind: InventoryOptionKind,

  key: string,
): string {
  return `${kind}:${key}`
}

/** How many units hold one option. Zero when nothing does, which is the whole point. */

export function unitsHoldingOption(
  counts: Record<string, number>,

  kind: InventoryOptionKind,

  key: string,
): number {
  return counts[optionCountKey(kind, key)] ?? 0
}

/** One list, live entries only, in the order the server set. */

export function optionsOf(
  response: InventoryOptionsResponse | null,

  kind: InventoryOptionKind,
): InventoryOptionView[] {
  if (response === null) return []

  return response.options[kind] ?? []
}

/** The sub-types offered under a property type — empty for types with no variants. */

export function subtypeOptionsFor(
  response: InventoryOptionsResponse | null,

  propertyTypeKey: string | null,
): InventoryOptionView[] {
  if (response === null) return []

  if (propertyTypeKey === null || propertyTypeKey === "") return []

  return optionsOf(response, "property_subtype").filter(
    (option) => option.parentKey === propertyTypeKey,
  )
}

/**
 * The `value`/`label` pair a select needs.
 *
 * Built here rather than inline in eight components so that "an option this workspace
 * offers" is decided once — including the case where a stored key has no row behind it,
 * which must still be selectable and legible rather than silently dropped.
 */

export function optionChoices(
  options: readonly InventoryOptionView[],
): FilterChoice[] {
  return options.map((option) => ({ value: option.key, label: option.label }))
}

/** One option as a picker sees it. A named type: `oxfmt` strips inline separators. */

export interface FilterChoice {
  value: string

  label: string
}

/** A stored key named from a list, falling back to the raw key so a cell is never blank. */

export function labelForKey(
  options: readonly InventoryOptionView[],

  key: string | null,
): string | null {
  if (key === null || key === "") return null

  const found = options.find((option) => option.key === key)

  return found?.label ?? key
}

export const inventoryCategoriesApi = {
  /** The whole vocabulary, with counts. One request fills every picker in the app. */

  list: (signal?: AbortSignal) =>
    api.get<InventoryOptionsResponse>("/api/inventory-options", signal),

  create: (input: CreateInventoryOptionInput) =>
    api.post<OptionPayload>("/api/inventory-options", input),

  update: (optionId: string, input: UpdateInventoryOptionInput) =>
    api.patch<OptionPayload>(`/api/inventory-options/${optionId}`, input),

  /** Category-wise counts, for one project or for the whole workspace. */

  summary: (projectId?: string, signal?: AbortSignal) =>
    api.get<InventoryCategorySummaryResponse>(
      projectId
        ? `/api/inventory-categories?project=${encodeURIComponent(projectId)}`
        : "/api/inventory-categories",

      signal,
    ),
}
