/**
 * Project inventory — the units that are actually sold.
 *
 * Where the structure route answers "what is this development made of", this one
 * answers "what is there to sell". A unit is a plot, an apartment, a shop, an
 * office or a villa, and it always hangs off a structure node, because a list of
 * units that does not say which tower or which floor they are on cannot be put in
 * front of a buyer.
 *
 * The rules that follow from that, and why each one is here:
 *
 *  * Every read is tenant-scoped, and so is the `structure_node_id` lookup.
 *    Resolving the node through a bare id would let one workspace attach its unit
 *    to another workspace's tower, so the node is fetched with the same
 *    `tenant_id` filter as everything else, and a miss reads "not found" rather
 *    than "forbidden" so the caller learns nothing about rows it cannot see.
 *
 *  * A unit code is unique per project and case-insensitively, checked here as
 *    well as by the index so the rejection lands on the code field where the user
 *    can fix it. A code is how this unit is named in a brochure; two units
 *    answering to the same code make every later conversation ambiguous.
 *
 *  * Price is an integer count of whole currency units. Not a float, which would
 *    eventually round a listed price by a fils and make the stored figure disagree
 *    with the typed one, and not minor units, which would store 185000000 for
 *    1.85 million and make the database unreadable for precision nobody quotes in.
 *
 *  * Attributes are replaced wholesale on write, not merged. An editor sends the
 *    full set it is showing, so "I removed the corner-unit tag" is expressible.
 *    Merging could never express a removal, and a diff protocol would be a second
 *    source of truth about what the client believes the row holds.
 *
 *  * Deleting a unit is safe and cascades to its attributes. A unit is a leaf: it
 *    holds nothing but its own custom fields, so unlike a structure node there is
 *    no subtree to destroy by accident.
 *
 * Reads require `inventory.view`. Writes — including creating a unit and
 * including deleting one — require `inventory.edit`, and deliberately not
 * `inventory.create` or `inventory.delete`. In the default grants a tenant admin
 * and a project manager hold `inventory.edit`, while only the two owner roles
 * hold `inventory.create` and `inventory.delete`; gating on those would mean the
 * roles that publish a project's stock cannot add a unit to it, or could add one
 * but never take one off sale. See `shared/access.ts` for how those grants are
 * shaped.
 */

import { all, get, isUniqueViolation, run, transaction } from "../db.ts"

import {
  badRequest,
  conflict,
  forbidden,
  notFound,
  readJsonBody,
  type RequestContext,
} from "../http.ts"

import { requireAuth, requirePermission, writeAudit } from "../middleware.ts"

import { readEnum, validateTextFields, type TextRule } from "../validate.ts"

import {
  OPEN_UNIT_STATUS_KEYS,
  UNIT_ATTRIBUTE_KEY_MAX,
  UNIT_ATTRIBUTE_MAX,
  UNIT_ATTRIBUTE_VALUE_MAX,
  UNIT_CODE_MAX,
  UNIT_CODE_MIN,
  UNIT_LOCATION_MAX,
  UNIT_PRICE_MAX,
  UNIT_PRICE_MIN,
  UNIT_SIZE_MAX,
  UNIT_SIZE_MIN,
  UNIT_STATUS_NOTE_MAX,
  UNIT_TYPES,
  calculateUnitPriceBreakdown,
  findAttributeKeyClash,
  isUnitPrice,
  isUnitSize,
  isUnitType,
  normalizeUnitPricingConfig,
  type UnitAttribute,
  type UnitPricingConfig,
  type UnitType,
} from "../../shared/inventory.ts"

import {
  describeStatus,
  readStatusKey,
  readStatusMap,
  statusChoices,
  type UnitStatusView,
} from "./unit-statuses.ts"

import {
  describeOption,
  findOption,
  liveOptions,
  optionChoices,
  readCategoryMaps,
  readOptionKey,
  type InventoryCategoryMaps,
} from "./inventory-options.ts"

import {
  AMENITY_KEYS_PER_UNIT_MAX,
  PROPERTY_TYPE_FOR_UNIT_TYPE,
  UNIT_ADDRESS_MAX,
  UNIT_AGE_MAX,
  UNIT_AREA_MAX,
  UNIT_DESCRIPTION_MAX,
  UNIT_FLOOR_COUNT_MAX,
  UNIT_IMPORT_MAX_BODY_BYTES,
  UNIT_IMPORT_MAX_ROWS,
  UNIT_MEDIA_HREF_MAX,
  UNIT_MEDIA_LABEL_MAX,
  UNIT_NOTES_MAX,
  UNIT_PHOTOS_MAX,
  UNIT_ROOM_COUNT_MAX,
  UNIT_SIZE_VALUE_MAX,
  UNIT_SIZE_VALUE_MIN,
  UNIT_VIEW_MAX,
  isUnitFacing,
  isUnitMediaKind,
  roundSizeValue,
  saleModeAllowsInstallments,
  sizeToSquareFeet,
  squareFeetToSize,
  unitDetailFieldsFor,
  unitDetailSummary,
  type InventoryOptionKind,
  type UnitDetailFieldSet,
  type UnitMediaKind,
} from "../../shared/inventory-categories.ts"

const now = () => new Date().toISOString()

// --- Rows -------------------------------------------------------------------

export type UnitRow = {
  id: string

  tenant_id: string

  project_id: string

  structure_node_id: string

  unit_code: string

  unit_type: string

  location: string | null

  size_sqft: number

  base_price: number

  pricing_config: string | null

  status: string

  created_at: string

  updated_at: string

  // Migration 0054. Every one is nullable, because a unit recorded before categories
  // existed genuinely has no recorded value, and a `0` or `""` there would be a claim.
  property_type: string | null

  usage_category: string | null

  property_subtype: string | null

  furnishing: string | null

  sale_mode: string | null

  possession: string | null

  ownership: string | null

  ownership_notes: string | null

  size_value: number | null

  size_unit: string | null

  bedrooms: number | null

  bathrooms: number | null

  kitchens: number | null

  lounges: number | null

  floors_count: number | null

  floor_number: number | null

  parking: number | null

  facing: string | null

  property_view: string | null

  age_years: number | null

  address: string | null

  area_city: string | null

  latitude: number | null

  longitude: number | null

  description: string | null
}

/** One media row as stored. */
type MediaRow = {
  id: string

  unit_id: string

  kind: string

  href: string

  label: string | null

  is_main: number

  sort_order: number
}

/** One amenity link as stored. */
type AmenityRow = {
  unit_id: string

  amenity_key: string
}

/** A photo, floor plan or video link on a unit. */
export interface UnitMediaView {
  id: string

  kind: UnitMediaKind

  href: string

  label: string | null

  isMain: boolean

  sortOrder: number
}

/** The child rows a unit carries alongside its own columns. */
interface UnitExtras {
  amenities: string[]

  amenityKeys: string[]

  media: UnitMediaView[]
}

type AttributeRow = {
  unit_id: string

  key: string

  value: string
}

/** Just enough of a structure node to name it and walk to its parent. */

type NodeRef = {
  id: string

  name: string

  parent_id: string | null
}

/** A node carrying its ordering, for the structure-options response. */

interface OrderedNode {
  id: string

  sort_order: number
}

/**
 * The status a unit is listed in when nothing says otherwise.
 *
 * Available is the answer because that is the state a freshly listed unit is in: a
 * create form that made the user pick would be asking a question with one right answer.
 */
const DEFAULT_UNIT_STATUS = "available"

/** A `unit_type` outside the closed set can only come from a hand-edited row — the
 * column is `CHECK`ed. Narrowed by union rather than cast so a corrupted row surfaces
 * as a validation failure at the boundary instead of an unstyled label in the table.
 *
 * `status` gets no such helper: the column is deliberately not constrained to the
 * built-in keys, because the vocabulary is data now. It is validated against the
 * tenant's own statuses by `readStatusKey`, which is the only check that can still be
 * right when an administrator adds a status this build has never heard of.
 */

function toUnitType(value: string): UnitType | null {
  return isUnitType(value) ? value : null
}

// --- Rules ------------------------------------------------------------------

const UNIT_RULES: readonly TextRule[] = [
  {
    key: "unitCode",

    max: UNIT_CODE_MAX,

    min: UNIT_CODE_MIN,

    required: true,

    requiredError: "Give the unit a code.",

    minError: "Give the unit a code.",
  },

  {
    key: "location",

    max: UNIT_LOCATION_MAX,

    required: false,
  },
]

/**
 * The optional reason a unit was moved to another status.
 *
 * Separate from `UNIT_RULES` because it only means something on a transition: a create
 * has no transition to explain, so an editor that sends one there has it ignored rather
 * than stored against a history row that records nothing having changed. Optional,
 * because "moved it, no reason worth typing" is a real thing — the trail's job is to
 * answer who and when, and the reason is there for the moves where it matters.
 */

const STATUS_NOTE_RULE: TextRule = {
  key: "statusNote",

  max: UNIT_STATUS_NOTE_MAX,

  required: false,
}

// --- Reads ------------------------------------------------------------------

/**
 * Confirms the project exists in this workspace, and returns its currency.
 *
 * Duplicated from the projects and structure routes on purpose: a unit must never
 * be reachable through a project id belonging to another tenant, and the cheapest
 * way to be sure is to resolve the project with the tenant filter applied before
 * touching any unit table. The currency comes back from the same join because the
 * tenant row is already in hand, and a client that guesses it will eventually
 * price a Dubai apartment in dollars.
 */

/** A project paired with the currency its units must be quoted in. */

interface ScopedProject {
  id: string

  currency: string
}

export function requireScopedProject(
  tenantId: string,
  projectId: string,
): string {
  const row = get<ScopedProject>(
    `SELECT projects.id, tenants.currency
       FROM projects
       JOIN tenants ON tenants.id = projects.tenant_id
      WHERE projects.tenant_id = ? AND projects.id = ?`,

    tenantId,

    projectId,
  )

  if (!row) throw notFound("That project does not exist")

  return row.currency
}

/**
 * Rejects a structure node that does not belong to this project in this workspace.
 *
 * The filter is what makes this safe: a node from another tenant, or from another
 * project inside this tenant, fails exactly as a nonexistent id does.
 */

function requireStructureNode(
  tenantId: string,

  projectId: string,

  nodeId: string,
): void {
  const row = get<{ id: string }>(
    `SELECT id FROM project_structure_nodes
      WHERE tenant_id = ? AND project_id = ? AND id = ?`,

    tenantId,

    projectId,

    nodeId,
  )

  if (!row) throw notFound("That structure node does not exist")
}

export function readUnit(
  tenantId: string,

  projectId: string,

  unitId: string,
): UnitRow {
  const row = get<UnitRow>(
    `SELECT * FROM inventory_units
      WHERE tenant_id = ? AND project_id = ? AND id = ?`,

    tenantId,

    projectId,

    unitId,
  )

  if (!row) throw notFound("That unit does not exist")

  return row
}

/**
 * The unit's attributes as stored, which is the only order worth returning.
 *
 * Read back rather than echoed from the request, because the write path stores a
 * set and a set has no order. Echoing the submitted array would make a create
 * response list attributes one way and the next GET list them alphabetically, so a
 * client rendering straight from the create response would re-sort its own table
 * the moment the page refreshed.
 */

function readAttributes(unitId: string): UnitAttribute[] {
  return all<AttributeRow>(
    `SELECT unit_id, key, value FROM inventory_unit_attributes
      WHERE unit_id = ? ORDER BY key COLLATE NOCASE`,

    unitId,
  ).map((row) => ({ key: row.key, value: row.value }))
}

/** Every structure node of a project, as the minimal ref needed to build a path. */

function readNodeRefs(
  tenantId: string,

  projectId: string,
): Map<string, NodeRef> {
  const nodes = new Map<string, NodeRef>()

  for (const node of all<NodeRef>(
    `SELECT id, name, parent_id FROM project_structure_nodes
      WHERE tenant_id = ? AND project_id = ?`,

    tenantId,

    projectId,
  )) {
    nodes.set(node.id, node)
  }

  return nodes
}

/**
 * The chain of node names a unit sits under, root first: "Tower A / Level 12".
 *
 * Prefers nodes already loaded by the caller and falls back to a single-row read
 * for an ancestor the listing did not carry. Both loops are bounded — `seen` stops
 * a cycle introduced by a hand-edited `parent_id` chain from spinning here, and
 * the length cap stops a pathological chain — so a corrupt row degrades to a
 * shorter path instead of hanging the request.
 */

function structurePath(
  tenantId: string,

  nodes: Map<string, NodeRef>,

  nodeId: string,
): string[] {
  const names: string[] = []

  const seen = new Set<string>()

  let cursor: string | null = nodeId

  while (cursor !== null && !seen.has(cursor) && names.length < 8) {
    seen.add(cursor)

    const node: NodeRef | undefined =
      nodes.get(cursor) ??
      get<NodeRef>(
        `SELECT id, name, parent_id FROM project_structure_nodes
          WHERE tenant_id = ? AND id = ?`,

        tenantId,

        cursor,
      )

    if (!node) break

    names.unshift(node.name)

    cursor = node.parent_id
  }

  return names
}

/**
 * Orders nodes so a parent always precedes its children, with siblings keeping the
 * structure tab's `sort_order` then name order.
 *
 * `sort_order` only ranks siblings, so ordering the project's nodes by it directly
 * interleaves unrelated branches: `Tower A`, its floors, `Tower B`, and the podium
 * all compete for the same sequence. The unit picker reads as a tree, so each parent
 * is emitted with its subtree directly beneath it.
 *
 * A node whose parent is outside `nodes` is treated as a root, which also keeps a
 * corrupt cycle from losing rows — anything a walk cannot reach is appended at the
 * end rather than dropped.
 */
function treeOrder(
  nodes: Map<string, NodeRef>,
  sortOrders: Map<string, number>,
): string[] {
  const children = new Map<string, string[]>()
  const roots: string[] = []

  for (const node of nodes.values()) {
    const parentId =
      node.parent_id !== null && nodes.has(node.parent_id)
        ? node.parent_id
        : null
    if (parentId === null) {
      roots.push(node.id)
      continue
    }
    const siblings = children.get(parentId)
    if (siblings) siblings.push(node.id)
    else children.set(parentId, [node.id])
  }

  const compare = (a: string, b: string): number => {
    const left = sortOrders.get(a)
    const right = sortOrders.get(b)
    if (left !== undefined && right !== undefined && left !== right) {
      return left - right
    }
    return (nodes.get(a)?.name ?? "").localeCompare(
      nodes.get(b)?.name ?? "",
      undefined,
      {
        sensitivity: "base",
      },
    )
  }

  const ordered: string[] = []
  const seen = new Set<string>()

  const walk = (ids: string[]): void => {
    for (const id of [...ids].sort(compare)) {
      if (seen.has(id)) continue
      seen.add(id)
      ordered.push(id)
      const nested = children.get(id)
      if (nested) walk(nested)
    }
  }

  walk(roots)

  for (const id of nodes.keys()) {
    if (seen.has(id)) continue
    seen.add(id)
    ordered.push(id)
  }

  return ordered
}

/**
 * One unit as the wire carries it.
 *
 * The status is sent three ways, and all three are load-bearing. `status` is the key,
 * because that is what a filter and a write compare. `statusLabel` and `statusTone`
 * are resolved here so that a table row, a history entry and a select option all colour
 * and name the same status identically — and so that a tenant's own status renders
 * correctly in a client that never heard of it, without shipping the vocabulary twice.
 */
function toUnit(
  row: UnitRow,
  path: string[],
  attributes: UnitAttribute[],
  statuses: Map<string, UnitStatusView>,
  categories: InventoryCategoryMaps,
  extras: UnitExtras,
) {
  const pricing = normalizeUnitPricingConfig(
    row.pricing_config ? JSON.parse(row.pricing_config) : undefined,
  )

  return {
    id: row.id,

    structureNodeId: row.structure_node_id,

    unitCode: row.unit_code,

    unitType: toUnitType(row.unit_type),

    location: row.location,

    sizeSqft: row.size_sqft,

    basePrice: row.base_price,

    pricing,

    priceBreakdown: calculateUnitPriceBreakdown({
      sizeSqft: row.size_sqft,
      basePrice: row.base_price,
      pricing,
    }),

    status: row.status,

    ...describeStatus(row.status, statuses),

    /** Precomputed so the table can place a unit without a second request. */

    structurePath: path,

    attributes,

    // Migration 0054: everything the buyer's question actually turns on. Resolved here
    // rather than in the client, because the vocabulary is per tenant and a unit held in
    // a retired or renamed option still has to print the word this workspace uses.
    category: unitCategoryView(row, categories, extras),

    createdAt: row.created_at,

    updatedAt: row.updated_at,
  }
}

/**
 * One variant offered by the unit's own property type.
 *
 * Named rather than inline because `oxfmt` collapses a single-line object type literal,
 * and this one is read by the form's picker and the sheet alike.
 */
interface SubtypeOptionView {
  key: string

  label: string
}

/** The category block of a unit payload. */
interface UnitCategoryView {
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
  allowsInstallments: boolean
  possessionKey: string | null
  possessionLabel: string | null
  ownershipKey: string | null
  ownershipLabel: string | null
  ownershipNotes: string | null
  isLand: boolean
  sizeValue: number | null
  sizeUnitKey: string | null
  sizeUnitLabel: string | null
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
  subtypeOptions: SubtypeOptionView[]
  visibleFields: UnitDetailFieldSet
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

/**
 * Resolves a unit's stored keys into the words and rules the screen needs.
 *
 * Sent with the unit rather than looked up from a separate options request because every
 * row of the table, every grid card and every document prints these labels, and a
 * client-side join across nine lists per row is the N+1 the route exists to avoid.
 */
function unitCategoryView(
  row: UnitRow,
  categories: InventoryCategoryMaps,
  extras: UnitExtras,
): UnitCategoryView {
  const propertyType = findOption(
    categories,
    "property_type",
    row.property_type,
  )

  const sizeUnit = findOption(categories, "size_unit", row.size_unit)

  // Variants only mean something under a type. A unit that has no property type yet must
  // offer none, rather than all fourteen: `liveOptions` reads a null parent as "do not
  // filter", and a picker full of Corner Shop and Park Facing under an unclassified row
  // is the opposite of showing only the fields the chosen type makes relevant.
  const subtypeOptions =
    row.property_type === null || row.property_type === ""
      ? []
      : liveOptions(categories, "property_subtype", row.property_type).map(
          (option) => ({ key: option.key, label: option.label }),
        )

  const visibleFields = unitDetailFieldsFor(
    row.usage_category ?? "",
    // A type this tenant retired still describes its unit as land or not; the stored
    // flag is the only answer, and `false` is the one that shows more fields rather than
    // hiding a real one behind a missing option row.
    propertyType?.isLand ?? false,
    subtypeOptions.length > 0,
  )

  const sizeValue =
    row.size_value ?? squareFeetToSize(row.size_sqft, sizeUnit?.valueNum ?? 1)

  const sizeUnitLabel = describeOption("size_unit", row.size_unit, categories)

  const facingLabel = isUnitFacing(row.facing)
    ? facingLabelOf(row.facing)
    : null

  return {
    propertyTypeKey: row.property_type,

    propertyTypeLabel:
      describeOption("property_type", row.property_type, categories) ??
      describeOption(
        "property_type",
        PROPERTY_TYPE_FOR_UNIT_TYPE[toUnitType(row.unit_type) ?? "plot"],
        categories,
      ),

    usageKey: row.usage_category,

    usageLabel: describeOption(
      "usage_category",
      row.usage_category,
      categories,
    ),

    subtypeKey: row.property_subtype,

    subtypeLabel: describeOption(
      "property_subtype",
      row.property_subtype,
      categories,
    ),

    furnishingKey: row.furnishing,

    furnishingLabel: describeOption("furnishing", row.furnishing, categories),

    saleModeKey: row.sale_mode,

    saleModeLabel: describeOption("sale_mode", row.sale_mode, categories),

    allowsInstallments: saleModeAllowsInstallments(row.sale_mode ?? ""),

    possessionKey: row.possession,

    possessionLabel: describeOption(
      "possession_status",
      row.possession,
      categories,
    ),

    ownershipKey: row.ownership,

    ownershipLabel: describeOption("ownership_type", row.ownership, categories),

    ownershipNotes: row.ownership_notes,

    isLand: propertyType?.isLand ?? false,

    sizeValue,

    sizeUnitKey: row.size_unit,

    sizeUnitLabel,

    sizeDisplay:
      sizeValue !== null && sizeUnitLabel !== null
        ? `${formatSize(sizeValue)} ${sizeUnitLabel}`
        : null,

    bedrooms: row.bedrooms,

    bathrooms: row.bathrooms,

    kitchens: row.kitchens,

    lounges: row.lounges,

    floorsCount: row.floors_count,

    floorNumber: row.floor_number,

    parking: row.parking,

    facing: row.facing,

    facingLabel,

    view: row.property_view,

    ageYears: row.age_years,

    subtypeOptions,

    visibleFields,

    detailSummary: unitDetailSummary(
      {
        bedrooms: row.bedrooms,
        bathrooms: row.bathrooms,
        lounges: row.lounges,
        parking: row.parking,
        facing: facingLabel,
        floorNumber: row.floor_number,
      },
      visibleFields,
    ),

    address: row.address,

    areaCity: row.area_city,

    latitude: row.latitude,

    longitude: row.longitude,

    description: row.description,

    amenityKeys: extras.amenityKeys,

    amenities: extras.amenities,

    media: extras.media,

    // The card image: the main photo if one was marked, else the first photo, else
    // nothing. Never a video, because a card that looks like a broken image is worse
    // than a card with no image.
    mainPhoto:
      extras.media.find((item) => item.isMain && item.kind === "photo")?.href ??
      extras.media.find((item) => item.kind === "photo")?.href ??
      null,
  }
}

function facingLabelOf(facing: string): string {
  return facing.charAt(0).toUpperCase() + facing.slice(1)
}

/** `4.5` rather than `4.5000000000000004`, which a REAL column will eventually hand back. */
function formatSize(value: number): string {
  return String(Math.round(value * 100) / 100)
}

/** One unit's amenities and media, resolved against the tenant's vocabulary. */
function readExtras(
  unitId: string,
  categories: InventoryCategoryMaps,
): UnitExtras {
  const extras = new Map<string, UnitExtras>()

  readExtrasFor([unitId], categories, extras)

  return extras.get(unitId) ?? { amenities: [], amenityKeys: [], media: [] }
}

/**
 * Amenities and media for many units in two queries.
 *
 * Fills `into` so a listing of three hundred units costs two reads, not six hundred.
 * Units with no child rows are simply absent, which the caller treats as empty — the
 * same default an attribute-less unit already gets.
 */
function readExtrasFor(
  unitIds: readonly string[],
  categories: InventoryCategoryMaps,
  into: Map<string, UnitExtras>,
): void {
  if (unitIds.length === 0) return

  const placeholders = unitIds.map(() => "?").join(",")

  for (const row of all<AmenityRow>(
    `SELECT unit_id, amenity_key FROM inventory_unit_amenities
      WHERE unit_id IN (${placeholders}) ORDER BY amenity_key COLLATE NOCASE`,
    ...unitIds,
  )) {
    const entry = into.get(row.unit_id) ?? emptyExtras(row.unit_id, into)

    entry.amenityKeys.push(row.amenity_key)

    entry.amenities.push(
      describeOption("amenity", row.amenity_key, categories) ?? row.amenity_key,
    )
  }

  for (const row of all<MediaRow>(
    `SELECT id, unit_id, kind, href, label, is_main, sort_order FROM inventory_unit_media
      WHERE unit_id IN (${placeholders})
      ORDER BY sort_order, kind, created_at`,
    ...unitIds,
  )) {
    const entry = into.get(row.unit_id) ?? emptyExtras(row.unit_id, into)

    entry.media.push({
      id: row.id,
      kind: isUnitMediaKind(row.kind) ? row.kind : "photo",
      href: row.href,
      label: row.label,
      isMain: row.is_main === 1,
      sortOrder: row.sort_order,
    })
  }
}

function emptyExtras(
  unitId: string,
  into: Map<string, UnitExtras>,
): UnitExtras {
  const entry: UnitExtras = { amenities: [], amenityKeys: [], media: [] }

  into.set(unitId, entry)

  return entry
}

// --- Validation -------------------------------------------------------------

/**
 * Parses the attribute bag the client sends.
 *
 * Rejects rather than silently dropping: a duplicate key, an over-long key, or a
 * non-string value are all things the user can see and fix in the editor they just
 * used. A row that is entirely blank is dropped instead, because a half-filled
 * repeater row is an accident and not an attribute.
 */

function readAttributesFrom(
  raw: unknown,

  errors: Record<string, string>,
): UnitAttribute[] {
  if (raw === undefined || raw === null) return []

  if (!Array.isArray(raw)) {
    errors.attributes = "Attributes must be a list of names and values."

    return []
  }

  if (raw.length > UNIT_ATTRIBUTE_MAX) {
    errors.attributes = `Record at most ${UNIT_ATTRIBUTE_MAX} attributes.`

    return []
  }

  const collected: UnitAttribute[] = []

  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) {
      errors.attributes = "Each attribute needs a name and a value."

      return []
    }

    const pair = entry as Record<string, unknown>

    const key = typeof pair.key === "string" ? pair.key.trim() : ""

    const value = typeof pair.value === "string" ? pair.value.trim() : ""

    if (key === "" && value === "") continue

    if (key.length < 1) {
      errors.attributes = "Every attribute needs a name."

      return []
    }

    if (key.length > UNIT_ATTRIBUTE_KEY_MAX) {
      errors.attributes = `Keep attribute names under ${UNIT_ATTRIBUTE_KEY_MAX} characters.`

      return []
    }

    if (value.length > UNIT_ATTRIBUTE_VALUE_MAX) {
      errors.attributes = `Keep attribute values under ${UNIT_ATTRIBUTE_VALUE_MAX} characters.`

      return []
    }

    // Stored with the name as typed, but checked case-insensitively so a unit never

    // carries "Bedrooms" and "bedrooms" as two separate facts.

    if (findAttributeKeyClash(collected, { key, value }) !== -1) {
      errors.attributes = `"${key}" is listed twice.`

      return []
    }

    collected.push({ key, value })
  }

  return collected
}

/** Rejects a code already used by another unit in this project. */

function readPricingConfig(
  raw: unknown,
  errors: Record<string, string>,
): UnitPricingConfig {
  if (raw === undefined || raw === null) {
    return normalizeUnitPricingConfig(undefined)
  }

  if (typeof raw !== "object" || Array.isArray(raw)) {
    errors.pricing = "Price settings must be an object."
    return normalizeUnitPricingConfig(undefined)
  }

  const candidate = raw as Record<string, unknown>
  const casted = candidate as Record<string, unknown>

  const config = normalizeUnitPricingConfig({
    pricePerSqft:
      typeof casted.pricePerSqft === "number" ||
      typeof casted.pricePerSqft === "string"
        ? Number(casted.pricePerSqft)
        : 0,
    developmentCharge:
      typeof casted.developmentCharge === "number" ||
      typeof casted.developmentCharge === "string"
        ? Number(casted.developmentCharge)
        : 0,
    cornerPremium:
      typeof casted.cornerPremium === "number" ||
      typeof casted.cornerPremium === "string"
        ? Number(casted.cornerPremium)
        : 0,
    parkFacingPremium:
      typeof casted.parkFacingPremium === "number" ||
      typeof casted.parkFacingPremium === "string"
        ? Number(casted.parkFacingPremium)
        : 0,
    floorPremium:
      typeof casted.floorPremium === "number" ||
      typeof casted.floorPremium === "string"
        ? Number(casted.floorPremium)
        : 0,
    discount:
      typeof casted.discount === "number" || typeof casted.discount === "string"
        ? Number(casted.discount)
        : 0,
  })

  return config
}

function assertNoCodeClash(
  tenantId: string,

  projectId: string,

  unitCode: string,

  selfId: string | null,
): void {
  const clash = get<{ id: string }>(
    `SELECT id FROM inventory_units
      WHERE tenant_id = ?
        AND project_id = ?
        AND id IS NOT ?
        AND unit_code = ? COLLATE NOCASE
      LIMIT 1`,

    tenantId,

    projectId,

    selfId,

    unitCode,
  )

  if (clash) {
    throw conflict("Another unit in this project already uses that code", {
      unitCode: "That code is already used in this project",
    })
  }
}

/**
 * A whole number within bounds, rejecting fractions, negatives and nonsense.
 *
 * An absent or blank field is an error rather than a zero: coercing an empty price
 * box to 0 would state a figure nobody entered, and 0 is a real price that has to
 * be typed to be believed.
 */

function readWholeNumber(
  raw: unknown,

  field: string,

  min: number,

  max: number,

  errors: Record<string, string>,

  label: string,
): number | null {
  if (raw === undefined || raw === null) {
    errors[field] = `Enter a ${label}.`

    return null
  }

  if (typeof raw === "string" && raw.trim() === "") {
    errors[field] = `Enter a ${label}.`

    return null
  }

  const value = typeof raw === "number" ? raw : Number(String(raw).trim())

  if (!Number.isFinite(value)) {
    errors[field] = `Enter a ${label}.`

    return null
  }

  if (!Number.isInteger(value)) {
    errors[field] = `Whole numbers only for ${label}.`

    return null
  }

  if (value < min || value > max) {
    errors[field] =
      `Enter a ${label} between ${min.toLocaleString("en-US")} and ${max.toLocaleString("en-US")}.`

    return null
  }

  return value
}

/** A required id pointing at a structure node of this project. */

function readNodeId(
  raw: unknown,

  tenantId: string,

  projectId: string,

  errors: Record<string, string>,
): string | null {
  if (typeof raw !== "string" || raw.trim() === "") {
    errors.structureNodeId = "Choose where this unit sits."

    return null
  }

  requireStructureNode(tenantId, projectId, raw)

  return raw
}

/** Everything the insert needs, already narrowed to storable types. */

interface StorableUnit {
  unitType: UnitType

  /**
   * A status key, validated against the tenant's vocabulary rather than a closed set.
   *
   * Deliberately a plain string. A union type built from the built-ins would be a lie
   * the moment a tenant adds a status, and the compiler would not be the one to notice
   * — it would forbid writing the custom key, and every feature that touches a custom
   * status would need a cast to work at all.
   */

  status: string

  structureNodeId: string

  sizeSqft: number

  basePrice: number

  pricing: UnitPricingConfig
}

/**
 * Narrows the collected values before a write.
 *
 * The null cases are already reported through `errors`, so reaching a null here
 * means the caller skipped the errors check; the throw keeps that a clear
 * rejection rather than a "cannot read property of null" further down. These are
 * the shared guards rather than casts, so a value outside the vocabulary is
 * refused at the boundary instead of landing in a CHECK-constrained column.
 */

function assertStorable(candidate: {
  unitType: UnitType | null

  status: string | null

  structureNodeId: string | null

  sizeSqft: number | null

  basePrice: number | null

  pricing: UnitPricingConfig | null
}): StorableUnit {
  if (
    candidate.unitType === null ||
    candidate.status === null ||
    candidate.structureNodeId === null ||
    !isUnitSize(candidate.sizeSqft) ||
    !isUnitPrice(candidate.basePrice) ||
    candidate.pricing === null
  ) {
    throw badRequest("Check the highlighted fields")
  }

  return {
    unitType: candidate.unitType,

    status: candidate.status,

    structureNodeId: candidate.structureNodeId,

    sizeSqft: candidate.sizeSqft,

    basePrice: candidate.basePrice,

    pricing: normalizeUnitPricingConfig(candidate.pricing),
  }
}

/** Replaces a unit's whole attribute set inside the caller's transaction. */

function writeAttributes(
  unitId: string,

  attributes: readonly UnitAttribute[],
): void {
  run("DELETE FROM inventory_unit_attributes WHERE unit_id = ?", unitId)

  for (const attribute of attributes) {
    run(
      `INSERT INTO inventory_unit_attributes (unit_id, key, value, created_at)
        VALUES (?, ?, ?, ?)`,

      unitId,

      attribute.key,

      attribute.value,

      now(),
    )
  }
}

// --- Categories -------------------------------------------------------------

/**
 * The `inventory_units` columns the category block writes, in one fixed order.
 *
 * Named once because three statements — create, update, and the importer's insert —
 * write exactly these columns, and a list duplicated across them is a column that gets
 * added to two of the three.
 */
const CATEGORY_COLUMNS: readonly string[] = [
  "property_type",
  "usage_category",
  "property_subtype",
  "furnishing",
  "sale_mode",
  "possession",
  "ownership",
  "ownership_notes",
  "size_value",
  "size_unit",
  "bedrooms",
  "bathrooms",
  "kitchens",
  "lounges",
  "floors_count",
  "floor_number",
  "parking",
  "facing",
  "property_view",
  "age_years",
  "address",
  "area_city",
  "latitude",
  "longitude",
  "description",
]

/** A media item the client sent, already validated enough to store. */
interface UnitMediaInput {
  kind: UnitMediaKind

  href: string

  label: string | null

  isMain: boolean
}

/** Everything the category columns hold, narrowed to storable values. */
interface ClassificationInput {
  propertyType: string | null

  usageCategory: string | null

  subtype: string | null

  furnishing: string | null

  saleMode: string | null

  possession: string | null

  ownership: string | null

  ownershipNotes: string | null

  sizeValue: number | null

  sizeUnit: string | null

  bedrooms: number | null

  bathrooms: number | null

  kitchens: number | null

  lounges: number | null

  floorsCount: number | null

  floorNumber: number | null

  parking: number | null

  facing: string | null

  propertyView: string | null

  ageYears: number | null

  address: string | null

  areaCity: string | null

  latitude: number | null

  longitude: number | null

  description: string | null

  amenities: string[]

  media: UnitMediaInput[]

  /** Derived from the typed size and its unit's factor, or from `sizeSqft` directly. */
  sizeSqft: number | null

  /** The coarse family `unit_type` keeps, so the rest of the product still counts. */
  legacyType: UnitType | null
}

/** The params for `CATEGORY_COLUMNS`, in the same order. */
function categoryParams(
  input: ClassificationInput,
): (string | number | null)[] {
  return [
    input.propertyType,
    input.usageCategory,
    input.subtype,
    input.furnishing,
    input.saleMode,
    input.possession,
    input.ownership,
    input.ownershipNotes,
    input.sizeValue,
    input.sizeUnit,
    input.bedrooms,
    input.bathrooms,
    input.kitchens,
    input.lounges,
    input.floorsCount,
    input.floorNumber,
    input.parking,
    input.facing,
    input.propertyView,
    input.ageYears,
    input.address,
    input.areaCity,
    input.latitude,
    input.longitude,
    input.description,
  ]
}

const CATEGORY_PLACEHOLDERS = CATEGORY_COLUMNS.map(() => "?").join(", ")

const CATEGORY_ASSIGNMENTS = CATEGORY_COLUMNS.map(
  (column) => `${column} = ?`,
).join(", ")

/**
 * Reads and validates the whole category block.
 *
 * `current` is the stored row on a PATCH and null on a create: absent means "not
 * changing this" in one and "use the default" in the other, which is the same contract
 * `readStatusKey` already has for the status field.
 *
 * Nothing here invents a value. A field the tenant's vocabulary has never heard of is
 * an error on the field the user typed, not a silent fallback — a unit quietly
 * reclassified from Penthouse to Plot because of a typo is a lost sale conversation.
 */
function readClassification(
  body: Record<string, unknown>,
  categories: InventoryCategoryMaps,
  current: UnitRow | null,
  errors: Record<string, string>,
): ClassificationInput {
  const propertyType = readKey(
    body,
    "propertyType",
    "property_type",
    categories,
    current?.property_type ?? null,
    errors,
    null,
  )

  const typeOption = findOption(categories, "property_type", propertyType)

  const subtype = readKey(
    body,
    "subtype",
    "property_subtype",
    categories,
    current?.property_subtype ?? null,
    errors,
    propertyType,
  )

  // A usage that was not sent comes from the type: choosing Shop should not also
  // require someone to say "Commercial", and the type row already says which it is.
  // Retyping the unit re-derives it, because a Shop left holding `commercial` after it
  // becomes a Flat would keep hiding the bedrooms field the new type needs.
  const retyped = current !== null && propertyType !== current.property_type

  const usageCategory = readKey(
    body,
    "usageCategory",
    "usage_category",
    categories,
    retyped
      ? (typeOption?.usageKey ?? null)
      : (current?.usage_category ?? typeOption?.usageKey ?? null),
    errors,
    null,
  )

  const sizeUnit = readKey(
    body,
    "sizeUnit",
    "size_unit",
    categories,
    current?.size_unit ?? "square_feet",
    errors,
    null,
  )

  const sizeValue = readSizeValue(
    body.sizeValue,

    current?.size_value ?? null,

    errors,
  )

  const factor = findOption(categories, "size_unit", sizeUnit)?.valueNum ?? 1

  // Only a size the caller actually typed may rewrite the square feet. Deriving it from
  // the stored value would re-round `size_sqft` on every unrelated PATCH, and a price
  // per square foot that moves by a square foot each time somebody edits the description
  // is not a figure anyone should publish.
  const sqftFromSize =
    body.sizeValue !== undefined && sizeValue !== null
      ? sizeToSquareFeet(sizeValue, factor)
      : null

  if (
    body.sizeValue !== undefined &&
    sizeValue !== null &&
    sqftFromSize === null
  ) {
    errors.sizeValue = "That size is too large to convert to square feet."
  }

  return {
    propertyType,

    usageCategory,

    // Clearing the type clears the variants that hung off it; keeping a Corner Shop on
    // a row that is now a Flat is a contradiction the filter chips would show. A create
    // has no previous type, so what the caller just chose is kept rather than dropped.
    subtype:
      current === null || propertyType === current.property_type
        ? subtype
        : null,

    furnishing: readKey(
      body,
      "furnishing",
      "furnishing",
      categories,
      current?.furnishing ?? null,
      errors,
      null,
    ),

    saleMode: readKey(
      body,
      "saleMode",
      "sale_mode",
      categories,
      current?.sale_mode ?? null,
      errors,
      null,
    ),

    possession: readKey(
      body,
      "possession",
      "possession_status",
      categories,
      current?.possession ?? null,
      errors,
      null,
    ),

    ownership: readKey(
      body,
      "ownership",
      "ownership_type",
      categories,
      current?.ownership ?? null,
      errors,
      null,
    ),

    ownershipNotes: readBoundedText(
      body.ownershipNotes,
      "ownershipNotes",
      UNIT_NOTES_MAX,
      current?.ownership_notes ?? null,
      errors,
    ),

    sizeValue,

    sizeUnit,

    bedrooms: readCount(
      body.bedrooms,
      "bedrooms",
      UNIT_ROOM_COUNT_MAX,
      current?.bedrooms ?? null,
      errors,
    ),

    bathrooms: readCount(
      body.bathrooms,
      "bathrooms",
      UNIT_ROOM_COUNT_MAX,
      current?.bathrooms ?? null,
      errors,
    ),

    kitchens: readCount(
      body.kitchens,
      "kitchens",
      UNIT_ROOM_COUNT_MAX,
      current?.kitchens ?? null,
      errors,
    ),

    lounges: readCount(
      body.lounges,
      "lounges",
      UNIT_ROOM_COUNT_MAX,
      current?.lounges ?? null,
      errors,
    ),

    floorsCount: readCount(
      body.floorsCount,
      "floorsCount",
      UNIT_FLOOR_COUNT_MAX,
      current?.floors_count ?? null,
      errors,
    ),

    floorNumber: readCount(
      body.floorNumber,
      "floorNumber",
      UNIT_FLOOR_COUNT_MAX,
      current?.floor_number ?? null,
      errors,
    ),

    parking: readCount(
      body.parking,
      "parking",
      UNIT_ROOM_COUNT_MAX,
      current?.parking ?? null,
      errors,
    ),

    facing: readFacing(body.facing, current?.facing ?? null, errors),

    propertyView: readBoundedText(
      body.view,
      "view",
      UNIT_VIEW_MAX,
      current?.property_view ?? null,
      errors,
    ),

    ageYears: readCount(
      body.ageYears,
      "ageYears",
      UNIT_AGE_MAX,
      current?.age_years ?? null,
      errors,
    ),

    address: readBoundedText(
      body.address,
      "address",
      UNIT_ADDRESS_MAX,
      current?.address ?? null,
      errors,
    ),

    areaCity: readBoundedText(
      body.areaCity,
      "areaCity",
      UNIT_AREA_MAX,
      current?.area_city ?? null,
      errors,
    ),

    latitude: readCoordinate(
      body.latitude,
      "latitude",
      90,
      current?.latitude ?? null,
      errors,
    ),

    longitude: readCoordinate(
      body.longitude,
      "longitude",
      180,
      current?.longitude ?? null,
      errors,
    ),

    description: readBoundedText(
      body.description,
      "description",
      UNIT_DESCRIPTION_MAX,
      current?.description ?? null,
      errors,
    ),

    amenities: readAmenityKeys(body.amenities, categories, errors),

    media: readMediaInput(body.media, errors),

    sizeSqft: sqftFromSize,

    legacyType: typeOption?.legacyType ?? null,
  }
}

/** A dropdown field stored as an option key: label or key both accepted. */
function readKey(
  body: Record<string, unknown>,
  field: string,
  kind: InventoryOptionKind,
  categories: InventoryCategoryMaps,
  current: string | null,
  errors: Record<string, string>,
  parentKey: string | null,
): string | null {
  const read = readOptionKey(body[field], kind, categories, current, parentKey)

  if (read.invalid) {
    errors[field] =
      `Choose one of: ${optionChoices(categories, kind, parentKey)}.`

    return current
  }

  return read.value
}

/** A typed size in whatever unit the seller quotes in. */
function readSizeValue(
  raw: unknown,
  current: number | null,
  errors: Record<string, string>,
): number | null {
  if (raw === undefined) return current

  if (raw === null || raw === "") return null

  const value = typeof raw === "number" ? raw : Number(String(raw).trim())

  if (
    !Number.isFinite(value) ||
    value < UNIT_SIZE_VALUE_MIN ||
    value > UNIT_SIZE_VALUE_MAX
  ) {
    errors.sizeValue = `Enter a size between ${UNIT_SIZE_VALUE_MIN} and ${UNIT_SIZE_VALUE_MAX}.`

    return current
  }

  return roundSizeValue(value)
}

/** A room, floor or bay count. Zero is a real answer; a negative one is not. */
function readCount(
  raw: unknown,
  field: string,
  max: number,
  current: number | null,
  errors: Record<string, string>,
): number | null {
  if (raw === undefined) return current

  if (raw === null || raw === "") return null

  const value = typeof raw === "number" ? raw : Number(String(raw).trim())

  if (!Number.isInteger(value) || value < 0 || value > max) {
    errors[field] = `Enter a whole number between 0 and ${max}.`

    return current
  }

  return value
}

function readBoundedText(
  raw: unknown,
  field: string,
  max: number,
  current: string | null,
  errors: Record<string, string>,
): string | null {
  if (raw === undefined) return current

  if (raw === null) return null

  if (typeof raw !== "string") {
    errors[field] = "Enter text."

    return current
  }

  const value = raw.trim()

  if (value === "") return null

  if (value.length > max) {
    errors[field] = `Keep this to ${max} characters.`

    return current
  }

  return value
}

/**
 * A coordinate, or nothing.
 *
 * Rounded to four decimal places, which is about eleven metres: a pin further apart
 * than that is a data-entry error, and storing more precision implies a survey the
 * workspace did not do.
 */
function readCoordinate(
  raw: unknown,
  field: string,
  limit: number,
  current: number | null,
  errors: Record<string, string>,
): number | null {
  if (raw === undefined) return current

  if (raw === null || raw === "") return null

  const value = typeof raw === "number" ? raw : Number(String(raw).trim())

  if (!Number.isFinite(value) || Math.abs(value) > limit) {
    errors[field] = `Enter a value between -${limit} and ${limit}.`

    return current
  }

  const scale = 10 ** 4

  return Math.round(value * scale) / scale
}

function readFacing(
  raw: unknown,
  current: string | null,
  errors: Record<string, string>,
): string | null {
  if (raw === undefined) return current

  if (raw === null || raw === "") return null

  if (typeof raw !== "string") {
    errors.facing = "Choose a direction."

    return current
  }

  const value = raw.trim().toLowerCase()

  if (!isUnitFacing(value)) {
    errors.facing = "Choose North, South, East or West."

    return current
  }

  return value
}

/**
 * The amenity multi-select.
 *
 * Labels are accepted as well as keys, because the importer reads "Lift; Generator" out
 * of a spreadsheet, and a cell that has to contain a machine key is a cell that gets
 * typed wrong. Unknown entries are refused rather than dropped: a unit recorded with an
 * amenity the workspace does not have is a filter chip that will never match it.
 */
function readAmenityKeys(
  raw: unknown,
  categories: InventoryCategoryMaps,
  errors: Record<string, string>,
): string[] {
  if (raw === undefined || raw === null) return []

  if (!Array.isArray(raw)) {
    errors.amenities = "Amenities must be a list."

    return []
  }

  const keys: string[] = []

  for (const entry of raw) {
    const read = readOptionKey(entry, "amenity", categories, null, null)

    if (read.invalid || read.value === null) {
      errors.amenities = `Choose amenities this workspace has. Unknown: ${String(entry)}.`

      return keys
    }

    if (!keys.includes(read.value)) keys.push(read.value)
  }

  if (keys.length > AMENITY_KEYS_PER_UNIT_MAX) {
    errors.amenities = `Record at most ${AMENITY_KEYS_PER_UNIT_MAX} amenities.`

    return keys.slice(0, AMENITY_KEYS_PER_UNIT_MAX)
  }

  return keys
}

/**
 * Photos, a floor plan, a video link.
 *
 * At most one item is marked main and the first one wins, because "the card image" is
 * one picture by definition and a partial unique index is not something SQLite can
 * enforce — see the note in migration 0054.
 */
function readMediaInput(
  raw: unknown,
  errors: Record<string, string>,
): UnitMediaInput[] {
  if (raw === undefined || raw === null) return []

  if (!Array.isArray(raw)) {
    errors.media = "Media must be a list of links."

    return []
  }

  const items: UnitMediaInput[] = []

  let mainTaken = false

  let photos = 0

  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) {
      errors.media = "Each media item needs a kind and a link."

      return items
    }

    const candidate = entry as Record<string, unknown>

    const kind = isUnitMediaKind(candidate.kind) ? candidate.kind : null

    if (kind === null) {
      errors.media =
        "Choose whether each item is a photo, a floor plan or a video."

      return items
    }

    const href = typeof candidate.href === "string" ? candidate.href.trim() : ""

    if (href === "" || href.length > UNIT_MEDIA_HREF_MAX) {
      errors.media = `Every media item needs a link of at most ${UNIT_MEDIA_HREF_MAX} characters.`

      return items
    }

    if (kind === "photo") photos++

    if (photos > UNIT_PHOTOS_MAX) {
      errors.media = `Record at most ${UNIT_PHOTOS_MAX} photos.`

      return items
    }

    const labelRaw =
      typeof candidate.label === "string" ? candidate.label.trim() : ""

    const label =
      labelRaw === "" ? null : labelRaw.slice(0, UNIT_MEDIA_LABEL_MAX)

    const wantsMain = candidate.isMain === true

    const isMain = wantsMain && !mainTaken && kind === "photo"

    if (isMain) mainTaken = true

    items.push({
      kind,
      href,
      label,
      isMain,
    })
  }

  return items
}

/** Amenities are replaced wholesale, the same way attributes are: a removal must be sayable. */
function writeAmenities(unitId: string, keys: readonly string[]): void {
  run("DELETE FROM inventory_unit_amenities WHERE unit_id = ?", unitId)

  for (const key of keys) {
    run(
      `INSERT INTO inventory_unit_amenities (unit_id, amenity_key, created_at)
        VALUES (?, ?, ?)`,
      unitId,
      key,
      now(),
    )
  }
}

function writeMedia(
  unitId: string,
  tenantId: string,
  items: readonly UnitMediaInput[],
): void {
  run("DELETE FROM inventory_unit_media WHERE unit_id = ?", unitId)

  items.forEach((item, index) => {
    run(
      `INSERT INTO inventory_unit_media (
          id, tenant_id, unit_id, kind, href, label, is_main, sort_order, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      `media_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`,
      tenantId,
      unitId,
      item.kind,
      item.href,
      item.label,
      item.isMain ? 1 : 0,
      index,
      now(),
    )
  })
}

/**
 * Who a transition is recorded against.
 *
 * Named rather than written inline because it is passed in from both callers and read
 * back out of the session, and a shape used in two places deserves one name.
 */
interface StatusActor {
  id: string

  name: string
}

/**
 * Appends one row to a unit's status trail.
 *
 * `from` is null only when a unit is being recorded in the status it was created in.
 * The actor is passed rather than read from a context so that a future booking or
 * cancellation workflow can record the move with `source: "system"` and no user —
 * which is the whole reason `changed_by_user_id` is nullable. The name is stored
 * beside the id for the same reason the migration gives: a trail that goes blank when
 * somebody leaves is not a trail.
 *
 * `note` is only ever attached to a real transition, so an empty string from the client
 * becomes null rather than a row that reads "someone typed nothing".
 */
function recordStatusChange(
  tenantId: string,

  projectId: string,

  unitId: string,

  from: string | null,

  to: string,

  actor: StatusActor | null,

  source: "manual" | "system",

  note: string | null,
): void {
  run(
    `INSERT INTO inventory_unit_status_history (
        id, tenant_id, project_id, unit_id, from_status, to_status,
        changed_by_user_id, changed_by_name, source, note, changed_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,

    `sh_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`,

    tenantId,

    projectId,

    unitId,

    from,

    to,

    actor?.id ?? null,

    actor?.name ?? null,

    source,

    note,

    now(),
  )
}

/**
 * Moves a unit to a status the way a workflow does, not the way a person does.
 *
 * The booking and cancellation flows own this: they have already passed their own
 * `bookings.*` permission check, and they must be able to drive a unit's status
 * without also holding `inventory.change_status` — the split the migration and the
 * `recordStatusChange` doc both anticipated when they made the actor nullable and
 * reserved `source: "system"`. So this writes the status, appends the trail entry
 * with no actor, and leaves the caller's transaction to give it atomicity: it runs
 * inside whatever `transaction()` wraps the booking write, so a booking and its
 * status change commit together or not at all.
 *
 * The `from` status is read back rather than assumed, so the trail records the real
 * transition even if the unit moved since the caller last looked.
 */
export function applySystemUnitStatus(
  tenantId: string,

  projectId: string,

  unitId: string,

  toKey: string,

  note: string,
): void {
  const current = get<{ status: string }>(
    `SELECT status FROM inventory_units
      WHERE tenant_id = ? AND project_id = ? AND id = ?`,

    tenantId,

    projectId,

    unitId,
  )

  if (!current) throw notFound("That unit does not exist")

  const stamp = now()

  run(
    `UPDATE inventory_units SET status = ?, updated_at = ?
      WHERE tenant_id = ? AND project_id = ? AND id = ?`,

    toKey,

    stamp,

    tenantId,

    projectId,

    unitId,
  )

  recordStatusChange(
    tenantId,

    projectId,

    unitId,

    current.status,

    toKey,

    null,

    "system",

    note,
  )
}

// --- Totals -----------------------------------------------------------------

export type UnitTotals = {
  total: number

  /**
   * How many units hold each status, keyed by status key.
   *
   * A map rather than four named numbers because the vocabulary is data: a tenant with
   * an `Under Offer` status needs that count in the same place as the built-in ones,
   * and a column called `sold` cannot hold a status this build does not know about.
   * Counts are reported as zero rather than omitted so the tiles can render every
   * status the workspace has, and the client decides which ones deserve a tile.
   */

  byStatus: Record<string, number>

  /** Base price summed across units not yet sold. */

  openValue: number

  /** Base price summed across every unit, drafts included. */

  totalValue: number
}

/**
 * Counts and sums for the tiles above the table.
 *
 * `totalValue` includes drafts, because a draft still carries the price its
 * publisher intends, and `openValue` excludes sold units, because money already
 * earned is not inventory value. They are two tiles rather than one ambiguous
 * "value", since conflating them is how a listed price gets read as a forecast.
 *
 * `openValue` asks "is this unit still open?" through `OPEN_UNIT_STATUS_KEYS`, which
 * lists the built-in keys that mean not-yet-gone — available and reserved. A tenant's
 * own status cannot join that list, so a custom status does not count towards open
 * value unless it is the same key. That is a deliberate limit of the feature rather
 * than an oversight: "what is this inventory still worth" is a question about the
 * lifecycle this product defines, and letting a label change the answer would make
 * the tile untrustworthy in the worst way — quietly wrong.
 */

export function unitTotals(
  rows: readonly UnitRow[],
  statuses: Map<string, UnitStatusView>,
): UnitTotals {
  const byStatus: Record<string, number> = {}

  // Seeded from the vocabulary so a status with no units reports zero. Only the
  // statuses this workspace actually has are seeded: an archived status is excluded
  // by `readStatusMap`'s callers passing live statuses, and a key no row holds and no
  // status claims cannot occur.

  for (const status of statuses.values()) {
    byStatus[status.key] = 0
  }

  let openValue = 0

  let totalValue = 0

  for (const row of rows) {
    byStatus[row.status] = (byStatus[row.status] ?? 0) + 1

    totalValue += row.base_price

    if (OPEN_UNIT_STATUS_KEYS.includes(row.status)) {
      openValue += row.base_price
    }
  }

  return {
    total: rows.length,

    byStatus,

    openValue,

    totalValue,
  }
}

/** One category card: how much of this kind of unit the project has, and how much is still sellable. */
interface CategoryGroup {
  key: string | null

  label: string

  usageKey: string | null

  usageLabel: string | null

  total: number

  available: number

  value: number

  subtypes: CategorySubtypeGroup[]
}

interface CategorySubtypeGroup {
  key: string | null

  label: string

  count: number
}

/**
 * The counts behind the category cards, from rows already in hand.
 *
 * Computed over the listing rather than by a second query because the cards describe the
 * units the table is showing; a `GROUP BY` on the whole tenant would put a number beside
 * the filtered table that does not add up to it. "Available" means an open status, which
 * is the same reading `unitTotals` uses and for the same reason.
 */
function summariseCategories(
  rows: readonly UnitRow[],
  categories: InventoryCategoryMaps,
): CategoryGroup[] {
  const groups = new Map<string, CategoryGroup>()

  for (const row of rows) {
    const key = row.property_type ?? ""

    let group = groups.get(key)

    if (!group) {
      group = {
        key: row.property_type,

        label:
          describeOption("property_type", row.property_type, categories) ??
          "Unclassified",

        usageKey: row.usage_category,

        usageLabel: describeOption(
          "usage_category",
          row.usage_category,
          categories,
        ),

        total: 0,

        available: 0,

        value: 0,

        subtypes: [],
      }

      groups.set(key, group)
    }

    group.total += 1

    group.value += row.base_price

    if (OPEN_UNIT_STATUS_KEYS.includes(row.status)) group.available += 1

    if (row.property_subtype !== null && row.property_subtype !== "") {
      const existing = group.subtypes.find(
        (subtype) => subtype.key === row.property_subtype,
      )

      if (existing) existing.count += 1
      else {
        group.subtypes.push({
          key: row.property_subtype,
          label:
            describeOption(
              "property_subtype",
              row.property_subtype,
              categories,
            ) ?? row.property_subtype,
          count: 1,
        })
      }
    }
  }

  // Largest first: a card has room for three variants, so the ones worth the space are
  // the ones with the most units behind them.
  for (const group of groups.values()) {
    group.subtypes.sort(
      (a, b) =>
        b.count - a.count ||
        a.label.localeCompare(b.label, undefined, { sensitivity: "base" }),
    )
  }

  return [...groups.values()].sort(
    (a, b) =>
      b.total - a.total ||
      a.label.localeCompare(b.label, undefined, { sensitivity: "base" }),
  )
}

// --- Routes -----------------------------------------------------------------

/**
 * GET /api/projects/:id/units
 *
 * Returns the project's whole unit set rather than a filtered page: the list is
 * filtered in the client, which keeps the counts above the table honest and means a
 * project with a few thousand units never needs a second request to change a
 * filter.
 */

export async function listUnits(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "inventory", "view")

  const projectId = ctx.params.id

  if (!projectId) throw notFound("That project does not exist")

  const currency = requireScopedProject(guarded.tenantId, projectId)

  const rows = all<UnitRow>(
    `SELECT * FROM inventory_units
      WHERE tenant_id = ? AND project_id = ?
      ORDER BY unit_code COLLATE NOCASE`,

    guarded.tenantId,

    projectId,
  )

  // One grouped fetch for every attribute rather than a query per unit.

  const attributesByUnit = new Map<string, UnitAttribute[]>()

  if (rows.length > 0) {
    const placeholders = rows.map(() => "?").join(",")

    for (const attribute of all<AttributeRow>(
      `SELECT unit_id, key, value FROM inventory_unit_attributes
        WHERE unit_id IN (${placeholders})
        ORDER BY key COLLATE NOCASE`,

      ...rows.map((row) => row.id),
    )) {
      const existing = attributesByUnit.get(attribute.unit_id)

      if (existing)
        existing.push({ key: attribute.key, value: attribute.value })
      else
        attributesByUnit.set(attribute.unit_id, [
          { key: attribute.key, value: attribute.value },
        ])
    }
  }

  const nodes = readNodeRefs(guarded.tenantId, projectId)

  // The whole vocabulary, archived rows included: a unit can still be holding a status
  // or a category that was retired, and its cell has to name it rather than print the raw
  // key.

  const statuses = readStatusMap(guarded.tenantId)

  const categories = readCategoryMaps(guarded.tenantId)

  // Amenities and media for the whole page in two grouped reads, mirroring how the
  // attributes above are fetched.
  const extrasByUnit = new Map<string, UnitExtras>()

  readExtrasFor(
    rows.map((row) => row.id),

    categories,

    extrasByUnit,
  )

  return {
    units: rows.map((row) =>
      toUnit(
        row,

        structurePath(guarded.tenantId, nodes, row.structure_node_id),

        attributesByUnit.get(row.id) ?? [],

        statuses,

        categories,

        extrasByUnit.get(row.id) ?? {
          amenities: [],
          amenityKeys: [],
          media: [],
        },
      ),
    ),

    totals: unitTotals(rows, statuses),

    // Category-wise counts for the summary cards, for this project only: the cards are
    // a claim about the stock on screen, and a tenant-wide number next to a filtered
    // table is two numbers that cannot both be right.
    categories: summariseCategories(rows, categories),

    // The tenant's own currency, so a price is never labelled with the wrong symbol

    // by a client-side default.

    currency,

    canEdit: guarded.can("inventory", "edit"),

    // Sent apart from `canEdit` because the two are separate rights: a project manager
    // can retype a unit's code and price but not decide that a sale fell through. The
    // client hides the control; this is what stops the request behind it.

    canChangeStatus: guarded.can("inventory", "change_status"),
  }
}

/**
 * GET /api/projects/:id/units/structure
 *
 * The structure nodes a unit may be attached to, each with the path that leads to
 * it so the select reads "Tower A / Level 12" rather than twelve rows all called
 * "Level 12".
 *
 * A unit cannot be created without one, so the editor needs this even when the
 * structure tab has never been opened. Every node kind is offered: apartments hang
 * off floors, but a shop can sit directly on a block, and refusing that would be a
 * rule about how buildings work rather than about this data model.
 */

export async function listUnitStructure(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "inventory", "view")

  const projectId = ctx.params.id

  if (!projectId) throw notFound("That project does not exist")

  requireScopedProject(guarded.tenantId, projectId)

  const nodes = readNodeRefs(guarded.tenantId, projectId)

  // sort_order ranks siblings rather than the whole project, so the rows are

  // collected unordered and then walked as a tree to keep each parent above its

  // subtree in the picker.

  const rows = all<OrderedNode>(
    `SELECT id, sort_order FROM project_structure_nodes
      WHERE tenant_id = ? AND project_id = ?`,

    guarded.tenantId,

    projectId,
  )

  const sortOrders = new Map<string, number>(
    rows.map((row) => [row.id, row.sort_order]),
  )

  return {
    options: treeOrder(nodes, sortOrders).map((id) => ({
      id,

      name: nodes.get(id)?.name ?? "",

      path: structurePath(guarded.tenantId, nodes, id),
    })),
  }
}

/** A size unit's square-foot value, defaulting to square feet when none is recorded. */
function sizeFactor(
  categories: InventoryCategoryMaps,
  sizeUnitKey: string | null,
): number {
  return findOption(categories, "size_unit", sizeUnitKey)?.valueNum ?? 1
}

/** POST /api/projects/:id/units */

export async function createUnit(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "inventory", "edit")

  const projectId = ctx.params.id

  if (!projectId) throw notFound("That project does not exist")

  requireScopedProject(guarded.tenantId, projectId)

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const { values, errors } = validateTextFields(body, UNIT_RULES)

  const unitType = readEnum(body, "unitType", isUnitType, null)

  const statuses = readStatusMap(guarded.tenantId)

  const status = readStatusKey(body, statuses, DEFAULT_UNIT_STATUS)

  // Read before the size, because a typed size in marla or kanal is what the square feet
  // come from, and the conversion needs the tenant's own factor.
  const categories = readCategoryMaps(guarded.tenantId)

  const classification = readClassification(body, categories, null, errors)

  const structureNodeId = readNodeId(
    body.structureNodeId,

    guarded.tenantId,

    projectId,

    errors,
  )

  const sizeSqft = readWholeNumber(
    body.sizeSqft === undefined ? classification.sizeSqft : body.sizeSqft,

    "sizeSqft",

    UNIT_SIZE_MIN,

    UNIT_SIZE_MAX,

    errors,

    "size in square feet",
  )

  // A unit listed only in square feet still has a typed size for the form to show, so
  // the two columns cannot drift: the derived value is the stored figure read back in
  // the unit the workspace says it quotes in.
  if (
    classification.sizeValue === null &&
    sizeSqft !== null &&
    body.sizeValue === undefined
  ) {
    classification.sizeValue = squareFeetToSize(
      sizeSqft,

      sizeFactor(categories, classification.sizeUnit),
    )
  }

  const basePrice = readWholeNumber(
    body.basePrice,

    "basePrice",

    UNIT_PRICE_MIN,

    UNIT_PRICE_MAX,

    errors,

    "base price",
  )

  const pricing = readPricingConfig(body.pricing, errors)

  const attributes = readAttributesFrom(body.attributes, errors)

  // `readEnum` treats an absent field as "keep the current value", which is what a

  // PATCH means and the opposite of what a create means. A create passes null as the

  // fallback, so a null result here is a missing type — and a missing type is an

  // error, because guessing what a unit is would put a wrong word in front of a

  // buyer. An absent status, by contrast, defaults to available: that is the state a

  // freshly listed unit is in.
  //
  // The property type says which coarse family a unit is, so a form that picks "Corner
  // Shop" does not also have to offer a five-word select. An explicit `unitType` still
  // wins, because every existing caller and test sends one.
  const resolvedUnitType: UnitType | null =
    unitType.value ?? classification.legacyType

  if (unitType.invalid || resolvedUnitType === null) {
    errors.unitType = `Choose one of: ${UNIT_TYPES.join(", ")}.`
  }

  if (status.invalid) {
    errors.status = `Choose one of: ${statusChoices(statuses)}.`
  }

  // Listing a unit directly into anything other than available is a status decision,
  // not a field of the record, so it needs the same grant as changing a status later.
  // A unit created as sold would otherwise be a way around the permission entirely:
  // one request instead of two, and no transition ever recorded.

  if (
    status.invalid === false &&
    status.value !== DEFAULT_UNIT_STATUS &&
    !guarded.can("inventory", "change_status")
  ) {
    throw forbidden(
      "Your role can add units but not set their status. Ask a tenant admin to adjust the role, or create the unit as Available.",
      "permission_denied",
    )
  }

  if (Object.keys(errors).length > 0) {
    throw badRequest("Check the highlighted fields", errors)
  }

  const unitCode = values.unitCode ?? ""

  const location = values.location

  // The null cases are covered by the errors above, but the guards are what narrow

  // these to storable types, so they are asserted rather than cast.

  const storable = assertStorable({
    unitType: resolvedUnitType,

    status: status.value,

    structureNodeId,

    sizeSqft,

    basePrice,

    pricing,
  })

  assertNoCodeClash(guarded.tenantId, projectId, unitCode, null)

  const id = `unit_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`

  try {
    transaction(() => {
      run(
        `INSERT INTO inventory_units (
            id, tenant_id, project_id, structure_node_id, unit_code, unit_type,
            location, size_sqft, base_price, pricing_config, status, created_at, updated_at,
            ${CATEGORY_COLUMNS.join(", ")}
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${CATEGORY_PLACEHOLDERS})`,

        id,

        guarded.tenantId,

        projectId,

        storable.structureNodeId,

        unitCode,

        storable.unitType,

        location,

        storable.sizeSqft,

        storable.basePrice,

        JSON.stringify(storable.pricing),

        storable.status,

        now(),

        now(),

        ...categoryParams(classification),
      )

      writeAttributes(id, attributes)

      writeAmenities(id, classification.amenities)

      writeMedia(id, guarded.tenantId, classification.media)

      // The creation itself is the unit's first status history entry, with nothing
      // before it. Without this a unit that opened as Reserved and closed as Sold would
      // show one entry rather than a trail, and the question "how did this unit get
      // here?" would have no starting point.

      recordStatusChange(
        guarded.tenantId,

        projectId,

        id,

        null,

        storable.status,

        { id: guarded.userId, name: guarded.session.user.fullName },

        "manual",

        null,
      )
    })
  } catch (error) {
    // The index is the authority under concurrency; the check above only makes the

    // common case a field error rather than a 500.

    if (isUniqueViolation(error)) {
      throw conflict("Another unit in this project already uses that code", {
        unitCode: "That code is already used in this project",
      })
    }

    throw error
  }

  writeAudit(
    guarded,

    "project.inventory.created",

    "inventory_unit",

    id,

    {
      projectId,

      unitCode,

      unitType: storable.unitType,

      propertyType: classification.propertyType,

      status: storable.status,

      sizeSqft: storable.sizeSqft,

      structureNodeId: storable.structureNodeId,
    },

    ctx.ip,
  )

  const row = readUnit(guarded.tenantId, projectId, id)

  return {
    unit: toUnit(
      row,

      structurePath(
        guarded.tenantId,

        readNodeRefs(guarded.tenantId, projectId),

        row.structure_node_id,
      ),

      readAttributes(id),

      statuses,

      categories,

      readExtras(id, categories),
    ),
  }
}

/** PATCH /api/projects/:id/units/:unitId */

export async function updateUnit(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "inventory", "edit")

  // The route spells the project segment `:id`; aliased locally so this handler

  // reads the same as the list and create handlers above.

  const { id: projectId, unitId } = ctx.params

  if (!projectId || !unitId) throw notFound("That unit does not exist")

  requireScopedProject(guarded.tenantId, projectId)

  const existing = readUnit(guarded.tenantId, projectId, unitId)

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  // Validated against the stored row with the request layered over it, because the

  // code is required and a PATCH that does not mention it is saying "not changing

  // this" — not "send me an empty code". This is the same merge `projects.ts`

  // relies on; without it every partial edit is a 400.

  //

  // The merge is also what makes clearing an optional field expressible:

  // `location: ""` overrides the stored value here and comes back from the text

  // rules as null.

  const { values, errors } = validateTextFields(
    { unitCode: existing.unit_code, location: existing.location, ...body },

    [...UNIT_RULES, STATUS_NOTE_RULE],
  )

  const unitCode = values.unitCode ?? ""

  const location = values.location

  const unitType = readEnum(
    body,

    "unitType",

    isUnitType,

    toUnitType(existing.unit_type),
  )

  const statuses = readStatusMap(guarded.tenantId)

  // The stored status is the fallback, so a PATCH that never mentions status is saying
  // "not changing this" — which is also what makes the permission gate below compare
  // against the right thing.

  const status = readStatusKey(body, statuses, existing.status)

  // Same reason as on a create: the typed size and its unit's factor are what the stored
  // square feet are derived from, and a PATCH of the price must not lose them.
  const categories = readCategoryMaps(guarded.tenantId)

  const classification = readClassification(body, categories, existing, errors)

  // A property type that says which family the unit belongs to also answers `unit_type`,
  // so retyping a Villa as a House moves both columns rather than leaving the coarse
  // family behind. `readEnum` falls back to the stored value when the field is absent,
  // which would outrank the new type, so an absent `unitType` follows the type here.
  const resolvedUnitType: UnitType | null =
    body.unitType === undefined
      ? (classification.legacyType ?? unitType.value)
      : unitType.value

  if (unitType.invalid) {
    errors.unitType = `Choose one of: ${UNIT_TYPES.join(", ")}.`
  }

  if (status.invalid) {
    errors.status = `Choose one of: ${statusChoices(statuses)}.`
  }

  const structureNodeId =
    body.structureNodeId === undefined
      ? existing.structure_node_id
      : readNodeId(body.structureNodeId, guarded.tenantId, projectId, errors)

  const sizeSqft =
    body.sizeSqft !== undefined
      ? readWholeNumber(
          body.sizeSqft,

          "sizeSqft",

          UNIT_SIZE_MIN,

          UNIT_SIZE_MAX,

          errors,

          "size in square feet",
        )
      : (classification.sizeSqft ?? existing.size_sqft)

  const basePrice =
    body.basePrice === undefined
      ? existing.base_price
      : readWholeNumber(
          body.basePrice,

          "basePrice",

          UNIT_PRICE_MIN,

          UNIT_PRICE_MAX,

          errors,

          "base price",
        )

  const pricing =
    body.pricing === undefined
      ? normalizeUnitPricingConfig(
          existing.pricing_config
            ? JSON.parse(existing.pricing_config)
            : undefined,
        )
      : readPricingConfig(body.pricing, errors)

  // Absent attributes means "leave them alone"; an explicit array replaces the

  // whole set, which is how a removed tag is expressed.

  const attributes =
    body.attributes === undefined
      ? readAttributes(existing.id)
      : readAttributesFrom(body.attributes, errors)

  // A unit whose square feet were just re-typed in marla keeps a typed size that agrees
  // with them, so the form never shows two sizes for one unit.
  if (
    body.sizeValue === undefined &&
    classification.sizeValue === null &&
    sizeSqft !== null
  ) {
    classification.sizeValue = squareFeetToSize(
      sizeSqft,

      sizeFactor(categories, classification.sizeUnit),
    )
  }

  if (Object.keys(errors).length > 0) {
    throw badRequest("Check the highlighted fields", errors)
  }

  const storable = assertStorable({
    unitType: resolvedUnitType,

    status: status.value,

    structureNodeId,

    sizeSqft,

    basePrice,

    pricing,
  })

  // Always checked, not only when the code was sent: the self-exclusion inside

  // makes keeping your own code a non-event, and skipping the check when the code

  // was merely re-sent unchanged would be a hole in the one rule that makes a code

  // usable in correspondence.

  assertNoCodeClash(guarded.tenantId, projectId, unitCode, unitId)

  // Whether the status is actually moving, decided once here so the gate and the
  // history row cannot disagree.

  const statusChanged = storable.status !== existing.status

  if (statusChanged && !guarded.can("inventory", "change_status")) {
    throw forbidden(
      "Your role can edit units but not change their status. Ask a tenant admin to adjust the role.",
      "permission_denied",
    )
  }

  try {
    transaction(() => {
      run(
        `UPDATE inventory_units
            SET structure_node_id = ?, unit_code = ?, unit_type = ?, location = ?,
                size_sqft = ?, base_price = ?, pricing_config = ?, status = ?, updated_at = ?,
                ${CATEGORY_ASSIGNMENTS}
          WHERE tenant_id = ? AND project_id = ? AND id = ?`,

        storable.structureNodeId,

        unitCode,

        storable.unitType,

        location,

        storable.sizeSqft,

        storable.basePrice,

        JSON.stringify(storable.pricing),

        storable.status,

        now(),

        ...categoryParams(classification),

        guarded.tenantId,

        projectId,

        unitId,
      )

      if (body.attributes !== undefined) writeAttributes(unitId, attributes)

      if (body.amenities !== undefined)
        writeAmenities(unitId, classification.amenities)

      if (body.media !== undefined)
        writeMedia(unitId, guarded.tenantId, classification.media)

      // Only on a real transition. Re-saving an unchanged status is not a change, and
      // recording it would fill the trail with entries that all say the same thing —
      // which is how a trail becomes something nobody reads. The note rides along only
      // when there is a transition to explain, for the same reason.

      if (statusChanged) {
        recordStatusChange(
          guarded.tenantId,

          projectId,

          unitId,

          existing.status,

          storable.status,

          { id: guarded.userId, name: guarded.session.user.fullName },

          "manual",

          values.statusNote ?? null,
        )
      }
    })
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw conflict("Another unit in this project already uses that code", {
        unitCode: "That code is already used in this project",
      })
    }

    throw error
  }

  writeAudit(
    guarded,

    "project.inventory.updated",

    "inventory_unit",

    unitId,

    {
      projectId,

      unitCode,

      unitType: storable.unitType,

      status: storable.status,

      // Recorded here as well as in the unit's own trail. The audit log answers "who

      // touched this row" across every module; the trail answers "how did this unit

      // get here". Both are wanted, and the overlap on a status change is the point

      // rather than a duplication bug.

      statusChanged,

      fromStatus: statusChanged ? existing.status : null,

      toStatus: statusChanged ? storable.status : null,
    },

    ctx.ip,
  )

  const row = readUnit(guarded.tenantId, projectId, unitId)

  return {
    unit: toUnit(
      row,

      structurePath(
        guarded.tenantId,

        readNodeRefs(guarded.tenantId, projectId),

        row.structure_node_id,
      ),

      readAttributes(unitId),

      statuses,

      categories,

      readExtras(unitId, categories),
    ),
  }
}

/** DELETE /api/projects/:id/units/:unitId */

export async function deleteUnit(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "inventory", "edit")

  const { id: projectId, unitId } = ctx.params

  if (!projectId || !unitId) throw notFound("That unit does not exist")

  requireScopedProject(guarded.tenantId, projectId)

  const existing = readUnit(guarded.tenantId, projectId, unitId)

  // Attributes go with it. This is the one cascade in this module that runs

  // unconditionally, because a unit holds nothing but its own custom fields.

  transaction(() => {
    run(
      "DELETE FROM inventory_units WHERE tenant_id = ? AND project_id = ? AND id = ?",

      guarded.tenantId,

      projectId,

      unitId,
    )
  })

  writeAudit(
    guarded,

    "project.inventory.deleted",

    "inventory_unit",

    unitId,

    { projectId, unitCode: existing.unit_code },

    ctx.ip,
  )

  return { deleted: { id: unitId } }
}

// --- Status history ---------------------------------------------------------

type HistoryRow = {
  id: string

  unit_id: string

  from_status: string | null

  to_status: string

  changed_by_user_id: string | null

  changed_by_name: string | null

  source: string

  note: string | null

  changed_at: string
}

/**
 * One history row as the wire carries it.
 *
 * Both ends of the transition are described, not just the new one: "Available → Booked"
 * is a readable event, and a trail of bare destinations cannot tell a promotion from a
 * demotion. The description is resolved against the tenant's vocabulary, so a status
 * that has since been renamed still reads with the name it had when it was current.
 *
 * `changedByName` is null only when a workflow moved the unit, and the two keys are
 * deliberately separate so the client can render "Moved automatically" rather than a
 * blank person.
 */
function toHistoryEntry(
  row: HistoryRow,
  statuses: Map<string, UnitStatusView>,
) {
  const from =
    row.from_status === null ? null : describeStatus(row.from_status, statuses)

  const to = describeStatus(row.to_status, statuses)

  return {
    id: row.id,

    unitId: row.unit_id,

    fromStatus: row.from_status,

    fromStatusLabel: from?.statusLabel ?? null,

    fromStatusTone: from?.statusTone ?? null,

    toStatus: row.to_status,

    toStatusLabel: to.statusLabel,

    toStatusTone: to.statusTone,

    changedByUserId: row.changed_by_user_id,

    changedByName: row.changed_by_name,

    source: row.source === "system" ? "system" : "manual",

    note: row.note,

    changedAt: row.changed_at,
  }
}

/**
 * How many entries a history read returns.
 *
 * Capped because the trail is unbounded — a unit in a busy sales office is moved
 * constantly — and a dialog has no use for four hundred of them. The cap is a constant
 * rather than a query parameter so there is exactly one number this endpoint can return
 * and no way to ask it for more.
 */
const HISTORY_LIMIT = 100

/** GET /api/projects/:id/units/:unitId/status-history */
export async function listUnitStatusHistory(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "inventory", "view")

  const { id: projectId, unitId } = ctx.params

  if (!projectId || !unitId) throw notFound("That unit does not exist")

  requireScopedProject(guarded.tenantId, projectId)

  // Resolved rather than trusted from the query, so the unit is confirmed to be in this
  // project in this workspace before any trail is read from it.

  readUnit(guarded.tenantId, projectId, unitId)

  const statuses = readStatusMap(guarded.tenantId)

  const rows = all<HistoryRow>(
    `SELECT id, unit_id, from_status, to_status, changed_by_user_id,
            changed_by_name, source, note, changed_at
       FROM inventory_unit_status_history
      WHERE tenant_id = ? AND project_id = ? AND unit_id = ?
      ORDER BY changed_at DESC, rowid DESC
      LIMIT ?`,

    guarded.tenantId,

    projectId,

    unitId,

    HISTORY_LIMIT,
  )

  return {
    entries: rows.map((row) => toHistoryEntry(row, statuses)),

    truncated: rows.length === HISTORY_LIMIT,
  }
}

/** GET /api/projects/:id/units/status-changes */
export async function listProjectStatusChanges(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "inventory", "view")

  const projectId = ctx.params.id

  if (!projectId) throw notFound("That project does not exist")

  requireScopedProject(guarded.tenantId, projectId)

  const statuses = readStatusMap(guarded.tenantId)

  const rows = all<HistoryRow & { unit_code: string }>(
    `SELECT h.id, h.unit_id, h.from_status, h.to_status, h.changed_by_user_id,
            h.changed_by_name, h.source, h.note, h.changed_at, u.unit_code
       FROM inventory_unit_status_history AS h
       JOIN inventory_units AS u ON u.id = h.unit_id
      WHERE h.tenant_id = ? AND h.project_id = ?
      ORDER BY h.changed_at DESC, h.rowid DESC
      LIMIT ?`,

    guarded.tenantId,

    projectId,

    HISTORY_LIMIT,
  )

  return {
    entries: rows.map((row) => ({
      ...toHistoryEntry(row, statuses),

      unitCode: row.unit_code,
    })),

    truncated: rows.length === HISTORY_LIMIT,
  }
}

// --- Quotations -------------------------------------------------------------

interface QuotationRow {
  id: string
  quote_number: string
  project_id: string
  unit_id: string
  lead_id: string | null
  customer_id: string | null
  unit_code: string
  lead_name: string | null
  customer_name: string | null
  issued_by_name: string
  issued_at: string
  base_price: number
  discount_type: "percent" | "fixed"
  discount_value: number
  discount_amount: number
  extra_charges: number
  total: number
  down_payment_percent: number
  installment_count: number
  payment_plan: string
  notes: string | null
}

function toQuotation(row: QuotationRow) {
  return {
    id: row.id,
    quoteNumber: row.quote_number,
    projectId: row.project_id,
    unitId: row.unit_id,
    leadId: row.lead_id,
    customerId: row.customer_id,
    unitCode: row.unit_code,
    leadName: row.lead_name,
    customerName: row.customer_name,
    recipientName: row.customer_name ?? row.lead_name ?? "",
    recipientType: row.customer_id ? "customer" : "lead",
    issuedByName: row.issued_by_name,
    issuedAt: row.issued_at,
    basePrice: row.base_price,
    discountType: row.discount_type,
    discountValue: row.discount_value,
    discountAmount: row.discount_amount,
    extraCharges: row.extra_charges,
    total: row.total,
    downPaymentPercent: row.down_payment_percent,
    installmentCount: row.installment_count,
    paymentPlan: JSON.parse(row.payment_plan) as Array<{
      label: string
      amount: number
    }>,
    notes: row.notes,
  }
}

const QUOTATION_HISTORY_LIMIT = 100

/** GET /api/projects/:id/units/:unitId/quotations */
export async function listUnitQuotations(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "inventory", "view")
  const { id: projectId, unitId } = ctx.params

  if (!projectId || !unitId) throw notFound("That unit does not exist")

  requireScopedProject(guarded.tenantId, projectId)
  readUnit(guarded.tenantId, projectId, unitId)

  const rows = all<QuotationRow>(
    `SELECT id, quote_number, project_id, unit_id, lead_id, customer_id,
            unit_code, lead_name, customer_name, issued_by_name, issued_at,
            base_price, discount_type, discount_value, discount_amount,
            extra_charges, total, down_payment_percent, installment_count,
            payment_plan, notes
       FROM unit_quotations
      WHERE tenant_id = ? AND project_id = ? AND unit_id = ?
      ORDER BY issued_at DESC, rowid DESC
      LIMIT ?`,
    guarded.tenantId,
    projectId,
    unitId,
    QUOTATION_HISTORY_LIMIT,
  )

  return {
    quotations: rows.map(toQuotation),
    truncated: rows.length === QUOTATION_HISTORY_LIMIT,
  }
}

/** POST /api/projects/:id/units/:unitId/quotations */
export async function createUnitQuotation(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "inventory", "edit")
  const { id: projectId, unitId } = ctx.params

  if (!projectId || !unitId) throw notFound("That unit does not exist")

  const currency = requireScopedProject(guarded.tenantId, projectId)
  const unit = readUnit(guarded.tenantId, projectId, unitId)
  const body = await readJsonBody<Record<string, unknown>>(ctx.req)
  const errors: Record<string, string> = {}
  const leadId =
    typeof body.leadId === "string" && body.leadId !== "" ? body.leadId : null
  const customerId =
    typeof body.customerId === "string" && body.customerId !== ""
      ? body.customerId
      : null

  if ((leadId === null) === (customerId === null)) {
    errors.recipient = "Choose one lead or customer."
  }

  if (leadId) requirePermission(guarded, "leads", "view")

  if (customerId) requirePermission(guarded, "customers", "view")

  const discountType = body.discountType === "fixed" ? "fixed" : "percent"
  if (
    body.discountType !== undefined &&
    body.discountType !== "percent" &&
    body.discountType !== "fixed"
  ) {
    errors.discountType = "Choose percentage or fixed discount."
  }

  const readInteger = (
    key: string,
    fallback: number,
    min: number,
    max: number,
  ) => {
    const value =
      body[key] === undefined || body[key] === "" ? fallback : body[key]
    if (
      typeof value !== "number" ||
      !Number.isSafeInteger(value) ||
      value < min ||
      value > max
    ) {
      errors[key] = `Enter a whole number from ${min} to ${max}.`
      return fallback
    }
    return value
  }

  const discountValue = readInteger(
    "discountValue",
    0,
    0,
    discountType === "percent" ? 100 : UNIT_PRICE_MAX,
  )
  const extraCharges = readInteger("extraCharges", 0, 0, UNIT_PRICE_MAX)
  const downPaymentPercent = readInteger("downPaymentPercent", 20, 0, 100)
  const installmentCount = readInteger("installmentCount", 1, 1, 60)
  const notes =
    body.notes === undefined || body.notes === null || body.notes === ""
      ? null
      : body.notes

  if (
    notes !== null &&
    (typeof notes !== "string" || notes.trim().length > 1000)
  ) {
    errors.notes = "Use 1,000 characters or fewer."
  }

  let leadName: string | null = null
  let customerName: string | null = null

  if (leadId) {
    const lead = get<{ full_name: string }>(
      "SELECT full_name FROM leads WHERE tenant_id = ? AND id = ?",
      guarded.tenantId,
      leadId,
    )
    if (!lead) errors.leadId = "Choose a lead in this workspace."
    else leadName = lead.full_name
  }

  if (customerId) {
    const customer = get<{ full_name: string }>(
      "SELECT full_name FROM customers WHERE tenant_id = ? AND id = ?",
      guarded.tenantId,
      customerId,
    )
    if (!customer) errors.customerId = "Choose a customer in this workspace."
    else customerName = customer.full_name
  }

  if (Object.keys(errors).length > 0)
    throw badRequest("Check the highlighted fields", errors)

  const discountAmount =
    discountType === "percent"
      ? Math.round((unit.base_price * discountValue) / 100)
      : discountValue
  if (discountAmount > unit.base_price) {
    throw badRequest("Discount cannot exceed the unit price", {
      discountValue: "Discount cannot exceed the unit price.",
    })
  }

  const total = unit.base_price - discountAmount + extraCharges
  if (!Number.isSafeInteger(total) || total > UNIT_PRICE_MAX) {
    throw badRequest("Quotation total is outside the supported range", {
      extraCharges: "The total exceeds the supported price range.",
    })
  }

  const downPayment = Math.round((total * downPaymentPercent) / 100)
  const balance = total - downPayment
  const installmentBase = Math.floor(balance / installmentCount)
  const remainder = balance % installmentCount
  const paymentPlan = [
    { label: `Down payment (${downPaymentPercent}%)`, amount: downPayment },
    ...Array.from({ length: installmentCount }, (_, index) => ({
      label: `Installment ${index + 1}`,
      amount: installmentBase + (index < remainder ? 1 : 0),
    })),
  ]

  const issuedAt = now()
  const id = `quote_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`
  let quoteNumber = ""

  transaction(() => {
    const count =
      get<{ total: number }>(
        "SELECT count(*) AS total FROM unit_quotations WHERE tenant_id = ? AND project_id = ? AND unit_id = ?",
        guarded.tenantId,
        projectId,
        unitId,
      )?.total ?? 0
    quoteNumber = `Q-${unit.unit_code}-${String(count + 1).padStart(3, "0")}`
    run(
      `INSERT INTO unit_quotations (
        id, tenant_id, project_id, unit_id, lead_id, customer_id, quote_number,
        unit_code, lead_name, customer_name, issued_by_user_id, issued_by_name,
        issued_at, base_price, discount_type, discount_value, discount_amount,
        extra_charges, total, down_payment_percent, installment_count, payment_plan,
        notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      guarded.tenantId,
      projectId,
      unitId,
      leadId,
      customerId,
      quoteNumber,
      unit.unit_code,
      leadName,
      customerName,
      guarded.userId,
      guarded.session.user.fullName,
      issuedAt,
      unit.base_price,
      discountType,
      discountValue,
      discountAmount,
      extraCharges,
      total,
      downPaymentPercent,
      installmentCount,
      JSON.stringify(paymentPlan),
      typeof notes === "string" ? notes.trim() || null : null,
      issuedAt,
      issuedAt,
    )
  })

  writeAudit(
    guarded,
    "project.inventory.quotation_created",
    "unit_quotation",
    id,
    {
      projectId,
      unitId,
      quoteNumber,
      recipientType: customerId ? "customer" : "lead",
      recipientId: customerId ?? leadId,
      total,
      currency,
    },
    ctx.ip,
  )

  const row = get<QuotationRow>(
    `SELECT id, quote_number, project_id, unit_id, lead_id, customer_id,
            unit_code, lead_name, customer_name, issued_by_name, issued_at,
            base_price, discount_type, discount_value, discount_amount,
            extra_charges, total, down_payment_percent, installment_count,
            payment_plan, notes
       FROM unit_quotations WHERE tenant_id = ? AND id = ?`,
    guarded.tenantId,
    id,
  )

  if (!row) throw notFound("That quotation does not exist")
  return { quote: toQuotation(row), currency }
}

// --- Bulk import ------------------------------------------------------------

/**
 * One parsed spreadsheet row: the sheet's own row number and the cells, keyed by the
 * JSON field names the template documents in `shared/inventory-categories.ts`.
 *
 * The client does the parsing — a browser reads the file, and Excel export is not one
 * format — and the server does the judgement. Row numbers come from the client because
 * that is the number the user sees in the sheet, and telling them "row 14" when the
 * server counted from its own zero is how an import report gets ignored.
 */
interface ImportRowInput {
  row: number

  values: Record<string, unknown>
}

/** A row that could not be imported, with the reasons keyed by field. */
interface ImportRowError {
  row: number

  unitCode: string | null

  errors: Record<string, string>
}

/**
 * POST /api/projects/:id/units/import
 *
 * Row-level error reporting rather than an all-or-nothing load, because a sheet with
 * three typos in two hundred rows is a normal thing, and refusing the whole batch makes
 * the user retype the good rows. Valid rows land, invalid ones are listed with the field
 * and the reason, and the codes are checked against the project before the insert so a
 * duplicate is a row error rather than a constraint violation that ends the batch.
 */
export async function importUnits(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "inventory", "edit")

  const projectId = ctx.params.id

  if (!projectId) throw notFound("That project does not exist")

  requireScopedProject(guarded.tenantId, projectId)

  const body = await readJsonBody<Record<string, unknown>>(
    ctx.req,

    UNIT_IMPORT_MAX_BODY_BYTES,
  )

  if (!Array.isArray(body.rows)) {
    throw badRequest("Check the highlighted fields", {
      rows: "Send the parsed rows to import.",
    })
  }

  if (body.rows.length === 0) {
    throw badRequest("Check the highlighted fields", {
      rows: "There is nothing to import.",
    })
  }

  if (body.rows.length > UNIT_IMPORT_MAX_ROWS) {
    throw badRequest("Check the highlighted fields", {
      rows: `Import at most ${UNIT_IMPORT_MAX_ROWS} rows at a time.`,
    })
  }

  const statuses = readStatusMap(guarded.tenantId)

  const categories = readCategoryMaps(guarded.tenantId)

  // Structure paths are resolved from the project's own tree, so a sheet can say
  // "Tower A / Level 12" — which is what a tracker holds — instead of node ids.
  const nodes = readNodeRefs(guarded.tenantId, projectId)

  const pathIndex = new Map<string, string>()

  for (const nodeId of nodes.keys()) {
    const path = structurePath(guarded.tenantId, nodes, nodeId)
      .join(" / ")
      .toLowerCase()

    if (!pathIndex.has(path)) pathIndex.set(path, nodeId)
  }

  const failures: ImportRowError[] = []

  const createdIds: string[] = []

  const codesSeen = new Set<string>()

  // Rows are judged one at a time inside one transaction: a bad row costs a line in the
  // report, and the good rows in the same file still land together, so a half-imported
  // sheet is not a state a project's stock can be left in.
  transaction(() => {
    for (const entry of body.rows as ImportRowInput[]) {
      const values = importRowValues(entry.values)

      const result = importOneRow({
        tenantId: guarded.tenantId,
        projectId,
        actor: {
          id: guarded.userId,

          name: guarded.session.user.fullName,
        },
        values,
        statuses,
        categories,
        pathIndex,
        codesSeen,
        rowNumber: entry.row,
      })

      if (Object.keys(result.errors).length > 0) {
        failures.push({
          row: entry.row,
          unitCode:
            typeof values.unitCode === "string" ? values.unitCode : null,
          errors: result.errors,
        })

        continue
      }

      createdIds.push(result.id)
    }
  })

  writeAudit(
    guarded,

    "project.inventory.imported",

    "inventory_unit",

    projectId,

    {
      projectId,

      attempted: (body.rows as ImportRowInput[]).length,

      created: createdIds.length,

      failed: failures.length,
    },

    ctx.ip,
  )

  const importedNodes = readNodeRefs(guarded.tenantId, projectId)

  return {
    created: createdIds.length,

    failed: failures.length,

    failures,

    // The rows that did land, already resolved, so the table can show the result of an
    // import rather than only its count.
    units: createdIds.map((id) => {
      const row = readUnit(guarded.tenantId, projectId, id)

      return toUnit(
        row,

        structurePath(guarded.tenantId, importedNodes, row.structure_node_id),
        readAttributes(id),

        statuses,

        categories,

        readExtras(id, categories),
      )
    }),
  }
}

/**
 * Normalises a parsed row into the field names the write path already reads.
 *
 * The importer's column names are the spreadsheet's (`Usage`, `Photos`, `Block /
 * Floor`); everything below the boundary speaks the API's. Translating here keeps one
 * set of validation code rather than a second copy for bulk entry, which is where a
 * second copy would quietly fall behind.
 */
function importRowValues(
  raw: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const values: Record<string, unknown> = { ...(raw ?? {}) }

  if (values.usageCategory === undefined) values.usageCategory = values.usage

  if (
    values.propertyType === undefined &&
    values["property type"] !== undefined
  ) {
    values.propertyType = values["property type"]
  }

  const photos = splitList(values.photos)

  const media: UnitMediaInput[] = []

  let firstPhoto = true

  for (const href of photos) {
    media.push({
      kind: "photo",
      href,
      label: null,
      // The template says the first link is the main photo, so the first one wins
      // rather than leaving every imported unit without a card image.
      isMain: firstPhoto,
    })

    firstPhoto = false
  }

  const floorPlan =
    typeof values.floorPlanUrl === "string" ? values.floorPlanUrl.trim() : ""

  if (floorPlan !== "")
    media.push({
      kind: "floor_plan",
      href: floorPlan,
      label: null,
      isMain: false,
    })

  const video =
    typeof values.videoUrl === "string" ? values.videoUrl.trim() : ""

  if (video !== "")
    media.push({ kind: "video", href: video, label: null, isMain: false })

  if (values.media === undefined) values.media = media

  // The shipped template's Amenities column arrives as the raw cell text under
  // `amenities`, so it is split here rather than only the `amenityList` alias: a
  // template column that could never import is worse than no template.
  if (values.amenities !== undefined || values.amenityList !== undefined) {
    values.amenities = splitList(values.amenities ?? values.amenityList)
  }

  return values
}

/** A spreadsheet cell holding several values: `Lift; Generator`, or a real array. */
function splitList(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw
      .filter((item) => typeof item === "string" && item.trim() !== "")
      .map((item) => String(item).trim())
  }

  if (typeof raw !== "string" || raw.trim() === "") return []

  return raw
    .split(";")
    .map((item) => item.trim())
    .filter((item) => item !== "")
}

interface ImportRowContext {
  tenantId: string

  projectId: string

  /**
   * Whoever uploaded the sheet.
   *
   * The trail's actor column carries a foreign key to `users`, so an importer cannot
   * invent a sentinel like `import`: the honest answer to "who put this unit on the
   * market?" is the person who pressed the button, which is already in the session.
   */
  actor: StatusActor

  values: Record<string, unknown>

  statuses: Map<string, UnitStatusView>

  categories: InventoryCategoryMaps

  pathIndex: Map<string, string>

  codesSeen: Set<string>

  rowNumber: number
}

/** One imported row's outcome: the new id, or the fields that were wrong. */
interface ImportRowResult {
  id: string

  errors: Record<string, string>
}

/**
 * Validates and inserts one imported row.
 *
 * Never throws: a row that does not parse is a line in the report, not a failed request,
 * which is the whole difference between an importer a sales desk will use and one they
 * will send back as a bug.
 */
function importOneRow(context: ImportRowContext): ImportRowResult {
  const errors: Record<string, string> = {}

  const { values, statuses, categories, projectId, tenantId } = context

  const { values: text, errors: textErrors } = validateTextFields(
    values,
    UNIT_RULES,
  )

  Object.assign(errors, textErrors)

  const classification = readClassification(values, categories, null, errors)

  const status = readStatusKey(
    { status: values.status },

    statuses,

    DEFAULT_UNIT_STATUS,
  )

  if (status.invalid) {
    errors.status = `Choose a status this workspace has: ${statusChoices(statuses)}.`
  }

  // The coarse family is what every other screen counts by, and a property type that
  // does not name one cannot be imported — a row with no `unit_type` is a NOT NULL
  // violation, and a row that silently became "plot" is a wrong word in front of a buyer.
  const unitType = classification.legacyType

  if (unitType === null) {
    errors.propertyType = "Every row needs a property type this workspace has."
  }

  let structureNodeId: string | null = null

  if (
    typeof values.structureNodeId === "string" &&
    values.structureNodeId !== ""
  ) {
    structureNodeId = values.structureNodeId
  } else {
    const path = String(values.structurePath ?? "")
      .toLowerCase()
      .replace(/\s*\/\s*/g, " / ")
      .trim()

    if (path === "") errors.structurePath = "Give each row its block or floor."
    else {
      structureNodeId = context.pathIndex.get(path) ?? null

      if (structureNodeId === null) {
        errors.structurePath = `This project has no structure node called "${String(values.structurePath).trim()}".`
      } else {
        try {
          requireStructureNode(tenantId, projectId, structureNodeId)
        } catch {
          errors.structurePath = `This project has no structure node called "${String(values.structurePath).trim()}".`

          structureNodeId = null
        }
      }
    }
  }

  const sizeSqft = classification.sizeSqft

  if (sizeSqft === null) {
    errors.sizeValue = "Give each row a size, in the size unit named on it."
  }

  const basePrice = readWholeNumber(
    values.basePrice,

    "basePrice",

    UNIT_PRICE_MIN,

    UNIT_PRICE_MAX,

    errors,

    "base price",
  )

  const unitCode = text.unitCode ?? ""

  if (unitCode !== "" && context.codesSeen.has(unitCode.toLowerCase())) {
    errors.unitCode = "Two rows in this file use the same unit code."
  }

  if (Object.keys(errors).length > 0) return { id: "", errors }

  const pricing = normalizeUnitPricingConfig(undefined)

  const id = `unit_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}${context.rowNumber.toString(36)}`

  context.codesSeen.add(unitCode.toLowerCase())

  const stamp = now()

  try {
    run(
      `INSERT INTO inventory_units (
          id, tenant_id, project_id, structure_node_id, unit_code, unit_type,
          location, size_sqft, base_price, pricing_config, status, created_at, updated_at,
          ${CATEGORY_COLUMNS.join(", ")}
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${CATEGORY_PLACEHOLDERS})`,
      id,
      tenantId,
      projectId,
      structureNodeId,
      unitCode,
      unitType,
      text.location,
      sizeSqft,
      basePrice,
      JSON.stringify(pricing),
      status.value,
      stamp,
      stamp,
      ...categoryParams(classification),
    )
  } catch (error) {
    if (isUniqueViolation(error)) {
      return {
        id: "",
        errors: { unitCode: "This project already has a unit with that code." },
      }
    }

    throw error
  }

  writeAmenities(id, classification.amenities)

  writeMedia(id, tenantId, classification.media)

  recordStatusChange(
    tenantId,
    projectId,
    id,
    null,
    status.value,
    context.actor,
    "manual",
    null,
  )

  return { id, errors }
}
