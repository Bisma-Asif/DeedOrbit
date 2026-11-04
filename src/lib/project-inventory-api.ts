/**
 * Typed client for the project inventory endpoints.
 *
 * Split out from `projects-api.ts` for the same reason the structure client is: the
 * unit vocabulary, its bounds and its attribute bag are their own subject, and
 * folding them into the project client would bury them.
 *
 * Two shapes here are worth knowing before using them.
 *
 * `UnitTotals` arrives from the server rather than being summed by the panel. The
 * counts sit above a table that is filtered client-side, so a panel that counted
 * its own visible rows would show a different total every time a filter was
 * applied — and a number that changes when you search is a number nobody trusts.
 *
 * `currency` arrives for the same reason. The tenant reference the app already
 * holds does not carry it, and a price labelled with the wrong symbol is worse than
 * an unlabelled one, so the list response states the currency the figures are in
 * and `formatMoney` is always given this value rather than a client-side default.
 *
 * The third shape is the status. It is not a union of literals any more: a tenant can
 * define its own, so `UnitView.status` is a key and the list response carries the
 * vocabulary beside it. A unit's `statusLabel` and `statusTone` are resolved by the
 * server, which is what lets a badge, a table row and a history entry agree on what a
 * status looks like without the client owning a copy of the rules.
 */

import type {
  UnitAttribute,
  UnitPriceBreakdown,
  UnitPricingConfig,
  UnitStatusTone,
  UnitType,
} from "@shared/inventory"

import type {
  UnitDetailFieldSet,
  UnitMediaKind,
} from "@shared/inventory-categories"

import { OPEN_UNIT_STATUS_KEYS } from "@shared/inventory"

import { api } from "./api"

import { customersApi, leadsApi } from "./leads-api"

import type { InventoryCategoryGroup } from "./inventory-categories-api"

/**
 * One unit's classification, resolved server-side against this tenant's own vocabulary.
 *
 * Mirrors the server's private `UnitCategoryView`. Every label arrives already named
 * rather than as a key the client would have to look up, because the lists are per
 * workspace: a unit sitting on a retired or renamed option still has to print the word
 * this company uses, in a table row, a grid card and a printed quotation alike.
 */
export interface UnitCategoryView {
  propertyTypeKey: string | null
  propertyTypeLabel: string | null
  usageKey: string | null
  usageLabel: string | null
  subtypeKey: string | null
  subtypeLabel: string | null
  furnishingKey: string | null
  furnishingLabel: string | null
  saleModeKey: string | null
  saleModeLabel: string | null
  /** Whether a booking of this unit needs a payment plan at all. */
  allowsInstallments: boolean
  possessionKey: string | null
  possessionLabel: string | null
  ownershipKey: string | null
  ownershipLabel: string | null
  ownershipNotes: string | null
  /** Bare land, which is what hides bedrooms and kitchens on the form. */
  isLand: boolean
  sizeValue: number | null
  sizeUnitKey: string | null
  sizeUnitLabel: string | null
  /** `4.5 Marla`, as typed rather than as converted. */
  sizeDisplay: string | null
  bedrooms: number | null
  bathrooms: number | null
  kitchens: number | null
  lounges: number | null
  floorsCount: number | null
  floorNumber: number | null
  parking: number | null
  facing: string | null
  facingLabel: string | null
  view: string | null
  ageYears: number | null
  /** The variants offered under this unit's property type, already narrowed. */
  subtypeOptions: UnitSubtypeOption[]
  /** Which detail fields this classification makes relevant; the form renders off it. */
  visibleFields: UnitDetailFieldSet
  /** The set fields turned into a one-line string, for a table cell or a document. */
  detailSummary: string[]
  address: string | null
  areaCity: string | null
  latitude: number | null
  longitude: number | null
  description: string | null
  amenityKeys: string[]
  amenities: string[]
  media: UnitMediaView[]
  mainPhoto: string | null
}

interface UnitSubtypeOption {
  key: string
  label: string
}

export interface UnitMediaView {
  id: string
  kind: UnitMediaKind
  href: string
  label: string | null
  isMain: boolean
  sortOrder: number
}

/** What a write sends for one photo, floor plan or video link. */
export interface UnitMediaInput {
  kind: UnitMediaKind
  href: string
  label?: string | null
  isMain?: boolean
}

export interface UnitView {
  id: string
  /** The structure node this unit sits under. Always present — see the server note. */
  structureNodeId: string
  unitCode: string
  /**
   * Null only if a stored row fails its own CHECK constraint, which the server
   * reports rather than renders: a blank type in the table would read as "unknown",
   * which is a claim the data is not making.
   */
  unitType: UnitType | null
  location: string | null
  sizeSqft: number
  basePrice: number
  pricing: UnitPricingConfig
  priceBreakdown: UnitPriceBreakdown
  /**
   * A key into the tenant's status vocabulary, never null.
   *
   * A key rather than a label because a label can be edited: storing it would make a
   * rename a data migration. It can also be a key the workspace no longer offers, since
   * a unit keeps the status it was given even after that status is retired — which is
   * why `statusLabel` is resolved separately.
   */
  status: string
  statusLabel: string
  statusTone: UnitStatusTone
  /** Resolved server-side so a row can be placed without a second request. */
  structurePath: string[]
  attributes: UnitAttribute[]
  /** Migration 0054: the property category block. Never absent, never blank-labelled. */
  category: UnitCategoryView
  createdAt: string
  updatedAt: string
}

export interface UnitTotals {
  total: number
  /**
   * Counts per status key, zero-filled across the whole vocabulary.
   *
   * Zero-filled so the tiles can show a status nobody is using yet — an empty count is
   * information, an absent one reads as a bug.
   */
  byStatus: Record<string, number>
  /** Base price across units not yet sold. */
  openValue: number
  /** Base price across every unit, drafts included. */
  totalValue: number
}

export interface UnitListResponse {
  units: UnitView[]
  totals: UnitTotals
  /**
   * Category-wise counts for the summary cards, computed over this project's units — the
   * same rows the table is showing, so a card beside the table cannot disagree with it.
   */
  categories: InventoryCategoryGroup[]
  currency: string
  canEdit: boolean
  /**
   * Whether this role may move a unit between statuses.
   *
   * Separate from `canEdit` because they are different rights: retyping a price is not
   * the same decision as declaring that a sale fell through.
   */
  canChangeStatus: boolean
}

/** One status in the tenant's vocabulary. */
export interface UnitStatusView {
  id: string
  /** The stored key. Compared and stored; never shown to a user. */
  key: string
  label: string
  tone: UnitStatusTone
  /**
   * True for the statuses this product defines. They cannot be renamed, recoloured or
   * retired — see the server route for why that matters to every dashboard.
   */
  isBuiltin: boolean
  isArchived: boolean
  sortOrder: number
}

export interface UnitStatusListResponse {
  /** Live statuses only, in the order they should be offered. */
  statuses: UnitStatusView[]
  /**
   * The retired statuses, kept apart from `statuses` so that nothing which offers a
   * status can accidentally offer one the server would refuse. The manager reads both.
   */
  archived: UnitStatusView[]
  /** How many statuses are retired, for a client that only wants the number. */
  archivedCount: number
  /** Tenant-wide units per status key, so a retire warning can be specific. */
  unitCounts: Record<string, number>
  /** Whether this role may change the vocabulary. */
  canManage: boolean
}

/** One entry in a unit's status trail. */
export interface StatusHistoryEntry {
  id: string
  unitId: string
  /** Null on the entry that records the unit being created. */
  fromStatus: string | null
  fromStatusLabel: string | null
  fromStatusTone: UnitStatusTone | null
  toStatus: string
  toStatusLabel: string
  toStatusTone: UnitStatusTone
  /** Null when a workflow moved the unit rather than a person. */
  changedByUserId: string | null
  changedByName: string | null
  source: "manual" | "system"
  note: string | null
  changedAt: string
}

/** The same entry in the project-wide feed, which also names the unit. */
export interface ProjectStatusChangeEntry extends StatusHistoryEntry {
  unitCode: string
}

export interface StatusHistoryResponse {
  entries: StatusHistoryEntry[]
  /** True when the trail is longer than the endpoint will return. */
  truncated: boolean
}

export interface ProjectStatusChangesResponse {
  entries: ProjectStatusChangeEntry[]
  truncated: boolean
}

export interface QuotationPaymentItem {
  label: string
  amount: number
}

export interface UnitQuotation {
  id: string
  quoteNumber: string
  projectId: string
  unitId: string
  leadId: string | null
  customerId: string | null
  unitCode: string
  leadName: string | null
  customerName: string | null
  recipientName: string
  recipientType: "lead" | "customer"
  issuedByName: string
  issuedAt: string
  basePrice: number
  discountType: "percent" | "fixed"
  discountValue: number
  discountAmount: number
  extraCharges: number
  total: number
  downPaymentPercent: number
  installmentCount: number
  paymentPlan: QuotationPaymentItem[]
  notes: string | null
}

export interface UnitQuotationsResponse {
  quotations: UnitQuotation[]
  truncated: boolean
}

export interface CreateUnitQuotationInput {
  leadId?: string
  customerId?: string
  discountType: "percent" | "fixed"
  discountValue: number
  extraCharges: number
  downPaymentPercent: number
  installmentCount: number
  notes: string
}

interface UnitQuotationPayload {
  quote: UnitQuotation
  currency: string
}

/** One choice in the "where does this unit sit" select. */
export interface UnitStructureOption {
  id: string
  name: string
  /** Root first, so the option reads "Tower A / Level 12". */
  path: string[]
}

export interface UnitStructureResponse {
  options: UnitStructureOption[]
}

/**
 * The category block a write may send.
 *
 * Every field optional, because a PATCH says what changed and a create fills the rest
 * from the tenant's defaults. A dropdown field accepts the stored key or the label —
 * "Corner Shop" and `corner_shop` are the same answer to the server, which is what lets
 * the CSV importer pass a spreadsheet cell straight through.
 *
 * `sizeValue` and `sizeUnit` together rewrite `sizeSqft`; sending only `sizeSqft` keeps
 * working, and the size is then shown back in whatever unit the row already stored.
 */
export interface UnitClassificationInput {
  propertyType?: string | null
  subtype?: string | null
  usageCategory?: string | null
  furnishing?: string | null
  saleMode?: string | null
  possession?: string | null
  ownership?: string | null
  ownershipNotes?: string | null
  sizeValue?: number | null
  sizeUnit?: string | null
  bedrooms?: number | null
  bathrooms?: number | null
  kitchens?: number | null
  lounges?: number | null
  floorsCount?: number | null
  floorNumber?: number | null
  parking?: number | null
  facing?: string | null
  view?: string | null
  ageYears?: number | null
  address?: string | null
  areaCity?: string | null
  latitude?: number | null
  longitude?: number | null
  description?: string | null
  /** Replaced whole, as `attributes` are, so removing an amenity is expressible. */
  amenities?: string[]
  /** Replaced whole. At most one item may be marked main. */
  media?: UnitMediaInput[]
}

export interface CreateUnitInput
  extends UnitClassificationInput {
  /** Required: a unit with no location on the site cannot be found or priced. */
  /**
   * Omitted to list the unit as Available.
   *
   * Any other status needs `inventory.change_status`, even here — creating a unit
   * directly as Sold is a status decision, and allowing it would make the permission
   * a one-request affair.
   */
  unitCode: string
  unitType: UnitType
  structureNodeId: string
  sizeSqft: number
  basePrice: number
  pricing?: Partial<UnitPricingConfig>
  status?: string
  location?: string
  attributes?: UnitAttribute[]
}

/**
 * Every field optional, because a PATCH says what changes.
 *
 * `structureNodeId` and `attributes` need a comment each. Moving a unit to another
 * node is allowed — it happens when a floor plan is renumbered — but the target is
 * validated against the same project, so a unit cannot be moved into a rival
 * workspace. Sending `attributes` replaces the whole set rather than merging, which
 * is what makes removing a tag expressible.
 *
 * `status` is the one field that carries its own permission: a change from the stored
 * status needs `inventory.change_status`, and re-sending the same status is not a
 * change at all. `statusNote` rides with a change and is ignored without one.
 */
export interface UpdateUnitInput
  extends UnitClassificationInput {
  /** Why the status moved. Recorded on the trail; ignored when status does not. */
  /** Sent as an empty string to clear it. */
  unitCode?: string
  unitType?: UnitType
  structureNodeId?: string
  sizeSqft?: number
  basePrice?: number
  pricing?: Partial<UnitPricingConfig>
  status?: string
  statusNote?: string
  location?: string
  attributes?: UnitAttribute[]
}

/** What the manage-statuses dialog sends when adding one. */
export interface CreateUnitStatusInput {
  label: string
  tone: UnitStatusTone
}

/** What it sends when changing one. Built-ins are refused by the server. */
export interface UpdateUnitStatusInput {
  label?: string
  tone?: UnitStatusTone
  isArchived?: boolean
}

/**
 * One parsed spreadsheet row, sent to the importer.
 *
 * `row` is the number the user sees in the sheet, because a report that says "row 14"
 * when the file's own numbering says 14 is a report people act on. `values` are keyed by
 * the importer's field names — see `unit-import.ts`, which turns headers into them.
 */
export interface UnitImportRowInput {
  row: number
  values: Record<string, unknown>
}

/** A row the importer refused, with the reasons keyed by field. */
export interface UnitImportFailure {
  row: number
  unitCode: string | null
  errors: Record<string, string>
}

export interface UnitImportResponse {
  created: number
  failed: number
  failures: UnitImportFailure[]
  /** The rows that did land, already resolved, so the table can show the result. */
  units: UnitView[]
}

interface UnitPayload {
  unit: UnitView
}

interface StatusPayload {
  status: UnitStatusView
}

interface DeletedPayload {
  deleted: { id: string }
}

/**
 * Filters the panel applies to a list it already holds.
 *
 * Optional, and all three combine with AND: a list narrowed to Available in Tower B
 * is the query a salesperson types before a viewing. Search is not here — the table
 * owns its search box, so the rule for what a search matches lives once, in
 * `unitSearchText`.
 */
export interface UnitFilters {
  unitType?: UnitType | null
  /** A status key. A string rather than a union, since the vocabulary is data. */
  status?: string | null
  structureNodeId?: string | null
  /**
   * The category chips compare stored keys, not labels, for the same reason a status
   * does: a saved view has to keep meaning "Shops" after somebody renames the option.
   */
  propertyTypeKey?: string | null
  subtypeKey?: string | null
  usageKey?: string | null
  furnishingKey?: string | null
  saleModeKey?: string | null
  possessionKey?: string | null
  /** Whole currency units, inclusive. `null` means the chip is not filtering. */
  minPrice?: number | null
  maxPrice?: number | null
}

/**
 * The text a search box matches a unit against.
 *
 * Covers the unit code, the location text, the category labels, the area and address and
 * the attribute VALUES, but not the attribute NAMES. Searching "Bedrooms" would otherwise
 * match every apartment on the project, which is the behaviour that teaches a user the
 * search box is broken. Searching a value like "sea view" still finds exactly the units
 * that have it — and so does searching "Shop", which is why the category block is in here.
 */
export function unitSearchText(unit: UnitView): string {
  const category = unit.category

  return [
    unit.unitCode,
    unit.location ?? "",
    category.propertyTypeLabel ?? "",
    category.subtypeLabel ?? "",
    category.usageLabel ?? "",
    category.furnishingLabel ?? "",
    category.saleModeLabel ?? "",
    category.possessionLabel ?? "",
    category.areaCity ?? "",
    category.address ?? "",
    ...category.amenities,
    ...unit.attributes.map((attribute) => attribute.value),
  ].join(" ")
}

/**
 * Applies the panel's filters to a unit list.
 *
 * Exported so the filtering itself can be reasoned about — and changed — without
 * reading it out of a component.
 *
 * The structure filter matches the chosen node and everything under it, by prefix on
 * the path rather than by id equality: a unit on "Tower A / Level 12 / Unit 3" has to
 * appear when the panel is filtered to "Tower A", because a filter that appears to
 * work and then hides most of what was asked for is worse than no filter.
 *
 * Paths are unique per project — the structure route refuses a duplicate sibling name
 * — so a prefix match cannot pull in a same-named branch of a different tower.
 */
export function filterUnits(
  units: readonly UnitView[],
  filters: UnitFilters,
  pathOf: (nodeId: string) => readonly string[],
): UnitView[] {
  return units.filter((unit) => {
    if (filters.unitType && unit.unitType !== filters.unitType) return false
    if (filters.status && unit.status !== filters.status) return false

    const category = unit.category

    if (
      filters.propertyTypeKey &&
      category.propertyTypeKey !== filters.propertyTypeKey
    ) {
      return false
    }

    if (filters.subtypeKey && category.subtypeKey !== filters.subtypeKey) {
      return false
    }

    if (filters.usageKey && category.usageKey !== filters.usageKey) return false

    if (
      filters.furnishingKey &&
      category.furnishingKey !== filters.furnishingKey
    ) {
      return false
    }

    if (filters.saleModeKey && category.saleModeKey !== filters.saleModeKey) {
      return false
    }

    if (
      filters.possessionKey &&
      category.possessionKey !== filters.possessionKey
    ) {
      return false
    }

    if (
      typeof filters.minPrice === "number" &&
      unit.basePrice < filters.minPrice
    ) {
      return false
    }

    if (
      typeof filters.maxPrice === "number" &&
      unit.basePrice > filters.maxPrice
    ) {
      return false
    }

    if (filters.structureNodeId) {
      const prefix = pathOf(filters.structureNodeId)

      const isUnder = prefix.every(
        (segment, index) => unit.structurePath[index] === segment,
      )

      if (!isUnder) return false
    }

    return true
  })
}

/**
 * How many of the panel's filters are actually doing something.
 *
 * A list rather than a chain of `||` so that adding a chip means adding one entry here,
 * and a "Clear filters (3)" control cannot quietly start lying about the count.
 */
export function countActiveFilters(filters: UnitFilters): number {
  const values: Array<string | number | null | undefined> = [
    filters.unitType,
    filters.status,
    filters.structureNodeId,
    filters.propertyTypeKey,
    filters.subtypeKey,
    filters.usageKey,
    filters.furnishingKey,
    filters.saleModeKey,
    filters.possessionKey,
    filters.minPrice,
    filters.maxPrice,
  ]

  return values.filter(
    (value) => value !== null && value !== undefined && value !== "",
  ).length
}

/**
 * Picks the statuses worth a tile, and in what order.
 *
 * Open statuses lead — Available and Reserved — then everything else by count, then by
 * the vocabulary's own order. Leading with the open statuses is the judgement call
 * here: in a healthy project they would sort to the top on count anyway, and in a month
 * where everything is sold or reserved they are exactly the two tiles that still tell
 * the reader anything. The vocabulary's order breaks the final tie so the row does not
 * reshuffle between refreshes when two statuses hold the same count.
 *
 * The caller renders its own value tiles beside these, since those need the currency.
 */
export function statusTiles(
  statuses: readonly UnitStatusView[],
  totals: UnitTotals,
  limit = 5,
): UnitStatusView[] {
  const ranked = [...statuses].sort((left, right) => {
    const leftOpen = OPEN_UNIT_STATUS_KEYS.includes(left.key)
    const rightOpen = OPEN_UNIT_STATUS_KEYS.includes(right.key)

    if (leftOpen !== rightOpen) return leftOpen ? -1 : 1

    const leftCount = totals.byStatus[left.key] ?? 0
    const rightCount = totals.byStatus[right.key] ?? 0

    if (leftCount !== rightCount) return rightCount - leftCount

    return left.sortOrder - right.sortOrder
  })

  return ranked.slice(0, limit)
}

export const projectInventoryApi = {
  list: (projectId: string, signal?: AbortSignal) =>
    api.get<UnitListResponse>(`/api/projects/${projectId}/units`, signal),

  /** The nodes a unit may be attached to. Needed before a unit can be created. */
  structure: (projectId: string, signal?: AbortSignal) =>
    api.get<UnitStructureResponse>(
      `/api/projects/${projectId}/units/structure`,
      signal,
    ),

  create: (projectId: string, input: CreateUnitInput) =>
    api.post<UnitPayload>(`/api/projects/${projectId}/units`, input),

  update: (projectId: string, unitId: string, input: UpdateUnitInput) =>
    api.patch<UnitPayload>(`/api/projects/${projectId}/units/${unitId}`, input),

  remove: (projectId: string, unitId: string) =>
    api.delete<DeletedPayload>(`/api/projects/${projectId}/units/${unitId}`),

  /** One unit's status trail, newest first. */
  unitStatusHistory: (
    projectId: string,
    unitId: string,
    signal?: AbortSignal,
  ) =>
    api.get<StatusHistoryResponse>(
      `/api/projects/${projectId}/units/${unitId}/status-history`,
      signal,
    ),

  /** Every status change in the project, newest first. */
  projectStatusChanges: (projectId: string, signal?: AbortSignal) =>
    api.get<ProjectStatusChangesResponse>(
      `/api/projects/${projectId}/units/status-changes`,
      signal,
    ),

  quotations: (projectId: string, unitId: string, signal?: AbortSignal) =>
    api.get<UnitQuotationsResponse>(
      `/api/projects/${projectId}/units/${unitId}/quotations`,
      signal,
    ),

  createQuotation: (
    projectId: string,
    unitId: string,
    input: CreateUnitQuotationInput,
  ) =>
    api.post<UnitQuotationPayload>(
      `/api/projects/${projectId}/units/${unitId}/quotations`,
      input,
    ),

  quotationRecipients: {
    leads: (signal?: AbortSignal) => leadsApi.list(signal),
    customers: (signal?: AbortSignal) => customersApi.list(signal),
  },

  /**
   * Bulk import. Valid rows land and bad ones come back in a report rather than the
   * whole file being refused, because a sheet with three typos in two hundred rows is
   * normal and re-typing the good ones is not why anyone uses an importer.
   */
  importUnits: (projectId: string, rows: UnitImportRowInput[]) =>
    api.post<UnitImportResponse>(`/api/projects/${projectId}/units/import`, {
      rows,
    }),
}

/**
 * The status vocabulary, which lives at the workspace level rather than under a
 * project — it is the same list for every project, and a status added for one project
 * is immediately valid in all the others.
 *
 * Separate from `projectInventoryApi` because it is not project-scoped and it is
 * configured under Settings, not edited per unit.
 */
export const unitStatusApi = {
  list: (signal?: AbortSignal) =>
    api.get<UnitStatusListResponse>("/api/unit-statuses", signal),

  create: (input: CreateUnitStatusInput) =>
    api.post<StatusPayload>("/api/unit-statuses", input),

  update: (statusId: string, input: UpdateUnitStatusInput) =>
    api.patch<StatusPayload>(`/api/unit-statuses/${statusId}`, input),
}
