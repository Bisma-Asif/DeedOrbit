/**
 * The property category vocabulary — what kind of thing a unit is.
 *
 * `shared/inventory.ts` already owns the two classifications a unit had when it was
 * five types and a status: `unit_type` (a closed set of five literals checked by the
 * database) and the tenant's status vocabulary. That is not what a Pakistani sales
 * desk works with. A shop is not the same conversation as a showroom, "Upper Portion"
 * is not an apartment, a plot is sold in marla and Kanal rather than square feet, and
 * whether a unit can go on installments decides whether the booking form asks about
 * payment plans at all. So the classification becomes its own vocabulary, and the
 * five-literal `unit_type` stays where it is: dealer scopes, reports and the old
 * columns all read it, and a category system that deleted it would rewrite half the
 * product.
 *
 * Every list here is stored per tenant in `inventory_category_options`, seeded from
 * the values below. They are seeds rather than a closed union for the same reason
 * statuses became data in migration 0007: an administrator has to be able to add
 * "Guest House" or retire "Kiosk" without a deploy, and a vocabulary that needs code
 * changes is one nobody can be trusted with.
 *
 * Three things are worth knowing before reading the lists:
 *
 *  * A property type carries a `legacy` unit type. Every unit keeps its coarse family
 *    — plot, apartment, shop, office, villa — because the rest of the product counts
 *    in those five words. The category says what the unit is; the legacy type says
 *    which of the existing buckets it belongs to.
 *
 *  * A property type carries a default `usage`. Picking Shop should not then require
 *    someone to say "Commercial" as well.
 *
 *  * Size units carry a conversion factor to square feet. A marla is 225 square feet
 *    in most of Punjab and 242 in parts of the Sindh canal colonies, so the factor is
 *    workspace data and the admin may correct it. The stored square feet is what the
 *    unit keeps, because a price-per-square-foot comparison across two workspaces that
 *    disagree about the marla is only meaningful once the conversion has already
 *    happened.
 */

import type { UnitType } from "./inventory.ts"

/** The dropdown lists a tenant can configure under Settings > Inventory Setup. */

export const INVENTORY_OPTION_KINDS = [
  "property_type",

  "usage_category",

  "property_subtype",

  "furnishing",

  "sale_mode",

  "possession_status",

  "ownership_type",

  "size_unit",

  "amenity",
] as const

export type InventoryOptionKind = typeof INVENTORY_OPTION_KINDS[number]

/** What each list is called on screen. */

export const INVENTORY_OPTION_KIND_LABELS: Record<InventoryOptionKind, string> =
  {
    property_type: "Property Type",

    usage_category: "Usage Category",

    property_subtype: "Sub-type",

    furnishing: "Furnishing",

    sale_mode: "Sale / Payment Mode",

    possession_status: "Possession Status",

    ownership_type: "Ownership / Legal",

    size_unit: "Size Unit",

    amenity: "Amenities",
  }

/** One-line description under each list's heading. */

export const INVENTORY_OPTION_KIND_HINTS: Record<InventoryOptionKind, string> =
  {
    property_type:
      "What the unit actually is — plot, shop, penthouse, warehouse.",

    usage_category:
      "Whether it is sold as residential, commercial, or something else.",

    property_subtype:
      "The variants that only mean something for one property type, like Corner Shop.",

    furnishing: "What the buyer walks into.",

    sale_mode:
      "Installment, lump sum, or either. Decides whether a booking needs a payment plan.",

    possession_status: "When the buyer can move in or start trading.",

    ownership_type: "How the title is held and transferred.",

    size_unit:
      "The units a size is typed in, and what each is worth in square feet.",

    amenity: "The multi-select list offered on every unit.",
  }

/**
 * The kinds that narrow a picker by another value.
 *
 * Sub-types belong to one property type, and the form must not offer "Park Facing"
 * under a Penthouse. Everything else is a flat list.
 */

export const SUBTYPE_PARENT_KIND = "property_type" as const

export function isInventoryOptionKind(
  value: unknown,
): value is InventoryOptionKind {
  return (
    typeof value === "string" &&
    (INVENTORY_OPTION_KINDS as readonly string[]).includes(value)
  )
}

/**
 * A stored option.
 *
 * One row per option per tenant, in `inventory_category_options`. Only the columns
 * their kind uses are filled: `factor` belongs to a size unit, `legacyType` and
 * `usageKey` to a property type, `parentKey` to a sub-type.
 */

export interface InventoryOptionSeed {
  key: string

  label: string

  /** Sub-types only: the property type key this variant belongs to. */

  parent?: string

  /** Property types only: which of the five coarse families this counts as. */

  legacy?: UnitType

  /** Property types only: the usage category picked alongside it. */

  usage?: string

  /** Size units only: square feet per one unit of this size. */

  factor?: number

  /** Property types only: a bare piece of land, with nothing built on it. */

  land?: boolean

  /** Offered in the picker so the word is not the only clue. */

  hint?: string
}

/**
 * The defaults every workspace starts with.
 *
 * The property types are the list a sales desk in Karachi and Lahore actually uses.
 * A tenant that needs "Guest House" adds it; a tenant that will never sell a kiosk
 * retires it. Nothing here is a claim that a market works this way — it is a starting
 * vocabulary that every screen already knows how to render.
 */

export const INVENTORY_OPTION_SEEDS: Record<InventoryOptionKind, readonly InventoryOptionSeed[]> =
  {
    property_type: [
      {
        key: "plot",

        label: "Plot",

        legacy: "plot",

        usage: "residential",

        land: true,

        hint: "A bare piece of land, size quoted in marla or kanal.",
      },

      {
        key: "house",

        label: "House",

        legacy: "villa",

        usage: "residential",

        hint: "A whole house on its own plot.",
      },

      {
        key: "villa",

        label: "Villa",

        legacy: "villa",

        usage: "residential",
      },

      {
        key: "bungalow",

        label: "Bungalow",

        legacy: "villa",

        usage: "residential",

        hint: "Single-storey house.",
      },

      {
        key: "farmhouse",

        label: "Farmhouse",

        legacy: "villa",

        usage: "residential",

        hint: "On the farm-plot belt; usually land plus a house.",
      },

      {
        key: "flat",

        label: "Flat",

        legacy: "apartment",

        usage: "residential",
      },

      {
        key: "apartment",

        label: "Apartment",

        legacy: "apartment",

        usage: "residential",
      },

      {
        key: "studio_apartment",

        label: "Studio Apartment",

        legacy: "apartment",

        usage: "residential",

        hint: "One room, combined living and sleeping.",
      },

      {
        key: "penthouse",

        label: "Penthouse",

        legacy: "apartment",

        usage: "residential",
      },

      {
        key: "duplex",

        label: "Duplex",

        legacy: "apartment",

        usage: "residential",

        hint: "Two floors joined by an internal stair.",
      },

      {
        key: "upper_portion",

        label: "Upper Portion",

        legacy: "apartment",

        usage: "residential",

        hint: "The upstairs half of a house, sold separately.",
      },

      {
        key: "lower_portion",

        label: "Lower Portion",

        legacy: "apartment",

        usage: "residential",

        hint: "The ground-floor half of a house, sold separately.",
      },

      {
        key: "basement",

        label: "Basement",

        legacy: "apartment",

        usage: "residential",
      },

      {
        key: "shop",

        label: "Shop",

        legacy: "shop",

        usage: "commercial",

        hint: "A ground-floor retail unit. Has its own sub-types.",
      },

      {
        key: "showroom",

        label: "Showroom",

        legacy: "shop",

        usage: "commercial",
      },

      {
        key: "office",

        label: "Office",

        legacy: "office",

        usage: "commercial",
      },

      {
        key: "floor_plaza",

        label: "Floor / Plaza Unit",

        legacy: "office",

        usage: "commercial",

        hint: "A whole floor in a commercial plaza.",
      },

      {
        key: "food_court_unit",

        label: "Food Court Unit",

        legacy: "shop",

        usage: "commercial",
      },

      {
        key: "kiosk",

        label: "Kiosk",

        legacy: "shop",

        usage: "commercial",
      },

      {
        key: "warehouse",

        label: "Warehouse",

        legacy: "office",

        usage: "commercial",
      },

      {
        key: "factory_industrial",

        label: "Factory / Industrial Unit",

        legacy: "office",

        usage: "industrial",
      },

      {
        key: "agricultural_land",

        label: "Agricultural Land",

        legacy: "plot",

        usage: "agricultural",

        land: true,

        hint: "Usually quoted in acres.",
      },

      {
        key: "commercial_plot",

        label: "Commercial Plot",

        legacy: "plot",

        usage: "commercial",

        land: true,
      },

      {
        key: "residential_plot",

        label: "Residential Plot",

        legacy: "plot",

        usage: "residential",

        land: true,
      },
    ],

    usage_category: [
      {
        key: "residential",

        label: "Residential",

        hint: "Somewhere people live.",
      },

      {
        key: "commercial",

        label: "Commercial",

        hint: "Trading, offices, retail.",
      },

      {
        key: "industrial",

        label: "Industrial",

        hint: "Factory and units.",
      },

      {
        key: "mixed_use",

        label: "Mixed Use",

        hint: "Shop downstairs, residence above.",
      },

      {
        key: "agricultural",

        label: "Agricultural",

        hint: "Farm land.",
      },
    ],

    property_subtype: [
      { key: "ground_floor", label: "Ground Floor", parent: "shop" },

      { key: "mezzanine", label: "Mezzanine", parent: "shop" },

      { key: "corner_shop", label: "Corner Shop", parent: "shop" },

      { key: "main_road", label: "Main Road", parent: "shop" },

      { key: "inside_mall", label: "Inside Mall", parent: "shop" },

      { key: "food_court", label: "Food Court", parent: "shop" },

      { key: "kiosk", label: "Kiosk", parent: "shop" },

      { key: "corner", label: "Corner", parent: "plot" },

      { key: "park_facing", label: "Park Facing", parent: "plot" },

      { key: "main_boulevard", label: "Main Boulevard", parent: "plot" },

      { key: "normal", label: "Normal", parent: "plot" },

      { key: "single_storey", label: "Single Storey", parent: "house" },

      { key: "double_storey", label: "Double Storey", parent: "house" },

      { key: "triple_storey", label: "Triple Storey", parent: "house" },
    ],

    furnishing: [
      { key: "furnished", label: "Furnished" },

      { key: "semi_furnished", label: "Semi-Furnished" },

      { key: "unfurnished", label: "Unfurnished" },
    ],

    sale_mode: [
      {
        key: "installment",

        label: "Installment",

        hint: "Booked against a payment plan.",
      },

      {
        key: "lump_sum",

        label: "Lump Sum",

        hint: "Full payment. No plan is raised at booking.",
      },

      {
        key: "both",

        label: "Both Available",

        hint: "The buyer chooses at booking.",
      },
    ],

    possession_status: [
      { key: "ready", label: "Ready", hint: "Hand over the keys." },

      {
        key: "under_construction",

        label: "Under Construction",

        hint: "Built but not finished.",
      },

      {
        key: "off_plan",

        label: "Off-Plan",

        hint: "Sold before the build starts.",
      },

      {
        key: "possession_given",

        label: "Possession Given",

        hint: "Handed over to the buyer.",
      },
    ],

    ownership_type: [
      { key: "freehold", label: "Freehold" },

      { key: "leasehold", label: "Leasehold" },

      {
        key: "allotment",
        label: "Allotment",
        hint: "Society or authority allotment.",
      },

      { key: "registry", label: "Registry" },

      {
        key: "power_of_attorney",

        label: "Power of Attorney",

        hint: "POA transfer, not a registered title.",
      },
    ],

    size_unit: [
      {
        key: "marla",
        label: "Marla",
        factor: 225,
        hint: "225 sq ft by default.",
      },

      { key: "kanal", label: "Kanal", factor: 4500, hint: "20 marla." },

      { key: "square_feet", label: "Square Feet", factor: 1 },

      { key: "square_yard", label: "Square Yard", factor: 9 },

      { key: "acre", label: "Acre", factor: 43560 },
    ],

    amenity: [
      { key: "lift", label: "Lift" },

      { key: "generator", label: "Generator" },

      { key: "gas", label: "Gas" },

      { key: "water_supply", label: "Water Supply" },

      { key: "security", label: "Security" },

      { key: "mosque", label: "Mosque" },

      { key: "park", label: "Park" },

      { key: "elevator", label: "Elevator" },

      { key: "parking", label: "Parking" },

      { key: "fire_safety", label: "Fire Safety" },
    ],
  }

/** The five coarse families, as the seed list reads them. */

export const LEGACY_UNIT_TYPES: readonly UnitType[] = [
  "plot",

  "apartment",

  "shop",

  "office",

  "villa",
]

/**
 * What a stored `unit_type` means in the new vocabulary.
 *
 * Used twice: to seed the property type of units recorded before categories existed,
 * and as the fallback for a row whose category key has gone missing. It has to be a
 * whole mapping rather than a default, because a blank classification renders as a
 * dash and every filter chip silently skips the unit.
 */

export const PROPERTY_TYPE_FOR_UNIT_TYPE: Record<UnitType, string> = {
  plot: "plot",

  apartment: "apartment",

  shop: "shop",

  office: "office",

  villa: "house",
}

/** Keys that are part of the product rather than a tenant's own additions. */

export const BUILT_IN_INVENTORY_OPTION_KEYS: Record<InventoryOptionKind, readonly string[]> =
  {
    property_type: INVENTORY_OPTION_SEEDS.property_type.map((seed) => seed.key),

    usage_category: INVENTORY_OPTION_SEEDS.usage_category.map(
      (seed) => seed.key,
    ),

    property_subtype: INVENTORY_OPTION_SEEDS.property_subtype.map(
      (seed) => `${seed.parent ?? ""}:${seed.key}`,
    ),

    furnishing: INVENTORY_OPTION_SEEDS.furnishing.map((seed) => seed.key),

    sale_mode: INVENTORY_OPTION_SEEDS.sale_mode.map((seed) => seed.key),

    possession_status: INVENTORY_OPTION_SEEDS.possession_status.map(
      (seed) => seed.key,
    ),

    ownership_type: INVENTORY_OPTION_SEEDS.ownership_type.map(
      (seed) => seed.key,
    ),

    size_unit: INVENTORY_OPTION_SEEDS.size_unit.map((seed) => seed.key),

    amenity: INVENTORY_OPTION_SEEDS.amenity.map((seed) => seed.key),
  }

/** The defaults a unit is classified with when nothing is recorded. */

export const DEFAULT_INVENTORY_OPTION_KEYS: Record<InventoryOptionKind, string> =
  {
    property_type: "plot",

    usage_category: "residential",

    property_subtype: "",

    furnishing: "unfurnished",

    sale_mode: "both",

    possession_status: "ready",

    ownership_type: "freehold",

    size_unit: "square_feet",

    amenity: "",
  }

// --- Bounds -----------------------------------------------------------------

/**
 * A key is the stored value — it survives a rename of the label, so it is derived
 * from the label and never typed by a user.
 */

export const INVENTORY_OPTION_KEY_MAX = 40

export const INVENTORY_OPTION_LABEL_MAX = 60

/** How many options a tenant may keep per list, built-ins included. */

export const INVENTORY_OPTION_MAX_PER_KIND = 60

/**
 * How a size is typed.
 *
 * A decimal, because five and a half marla is a normal thing to sell and 1,237.5
 * square feet is what it converts to. One square foot of rounding error on a marla
 * conversion is not worth a rational type; the integer square feet stays on the row
 * for every comparison the product already makes.
 */

export const UNIT_SIZE_VALUE_MIN = 0.01

export const UNIT_SIZE_VALUE_MAX = 10_000_000

/** Decimal places kept on a typed size. Anything finer is a rounding artefact. */

export const UNIT_SIZE_VALUE_PRECISION = 2

/** Counts of rooms, floors and parking bays. Zero is a real answer; 99 is not a room. */

export const UNIT_ROOM_COUNT_MAX = 99

export const UNIT_FLOOR_COUNT_MAX = 200

/** A building older than 999 years is a data-entry error, not a heritage listing. */

export const UNIT_AGE_MAX = 999

export const UNIT_ADDRESS_MAX = 240

export const UNIT_AREA_MAX = 120

export const UNIT_VIEW_MAX = 120

export const UNIT_NOTES_MAX = 500

export const UNIT_DESCRIPTION_MAX = 2000

/** Four decimal places is about 11 metres — plenty for a site plan pin. */

export const UNIT_COORDINATE_DECIMALS = 4

export const AMENITY_KEYS_PER_UNIT_MAX = 40

export const UNIT_PHOTOS_MAX = 12

/**
 * A media href is either a link the buyer can click or a data URL the workspace
 * uploaded. The cap is the one the upload endpoint accepts, so a client that read a
 * 4 MB file into base64 and posted it gets told the truth rather than a 413 about a
 * "request body".
 */

export const UNIT_MEDIA_HREF_MAX = 6_000_000

export const UNIT_MEDIA_LABEL_MAX = 80

export const UNIT_MEDIA_KINDS = ["photo", "floor_plan", "video"] as const

export type UnitMediaKind = typeof UNIT_MEDIA_KINDS[number]

export const UNIT_MEDIA_KIND_LABELS: Record<UnitMediaKind, string> = {
  photo: "Photo",

  floor_plan: "Floor plan",

  video: "Video link",
}

export function isUnitMediaKind(value: unknown): value is UnitMediaKind {
  return (
    typeof value === "string" &&
    (UNIT_MEDIA_KINDS as readonly string[]).includes(value)
  )
}

/** The four directions a unit can face. */

export const UNIT_FACINGS = ["north", "south", "east", "west"] as const

export type UnitFacing = typeof UNIT_FACINGS[number]

export const UNIT_FACING_LABELS: Record<UnitFacing, string> = {
  north: "North",

  south: "South",

  east: "East",

  west: "West",
}

export function isUnitFacing(value: unknown): value is UnitFacing {
  return (
    typeof value === "string" &&
    (UNIT_FACINGS as readonly string[]).includes(value)
  )
}

/**
 * Derives a stored key from a label the admin typed, exactly as a status key is
 * derived. "Upper Portion" and "upper-portion" have to reach the same key, or one
 * workspace ends up with two options that read identically in a filter chip.
 */

export function inventoryOptionKeyFromLabel(label: string): string {
  return label

    .trim()

    .toLowerCase()

    .replace(/[^a-z0-9]+/g, "_")

    .replace(/^_+|_+$/g, "")

    .slice(0, INVENTORY_OPTION_KEY_MAX)
}

// --- Size conversion --------------------------------------------------------

/**
 * Square feet for a typed size, rounded to a whole square foot.
 *
 * `factor` arrives from the tenant's own size-unit row, so a workspace that sells
 * 242-sq-ft marlas converts differently from one that sells 225 — and both agree with
 * the `sizeSqft` column every other screen already reads.
 */

export function sizeToSquareFeet(
  value: number,

  factor: number,
): number | null {
  if (
    !Number.isFinite(value) ||
    !Number.isFinite(factor) ||
    value < UNIT_SIZE_VALUE_MIN ||
    value > UNIT_SIZE_VALUE_MAX ||
    factor <= 0
  ) {
    return null
  }

  return Math.max(1, Math.round(value * factor))
}

/** The reverse, for showing a stored square-foot figure back in the unit it was sold in. */

export function squareFeetToSize(
  sqft: number,

  factor: number,
): number | null {
  if (
    !Number.isFinite(sqft) ||
    sqft <= 0 ||
    !Number.isFinite(factor) ||
    factor <= 0
  ) {
    return null
  }

  const scale = 10 ** UNIT_SIZE_VALUE_PRECISION

  return Math.round((sqft / factor) * scale) / scale
}

/** Rounds a typed size to the precision the column keeps. */

export function roundSizeValue(value: number): number {
  const scale = 10 ** UNIT_SIZE_VALUE_PRECISION

  return Math.round(value * scale) / scale
}

export function isUnitSizeValue(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= UNIT_SIZE_VALUE_MIN &&
    value <= UNIT_SIZE_VALUE_MAX
  )
}

// --- Field visibility -------------------------------------------------------

/**
 * The extra detail fields, and which of them a given classification makes relevant.
 *
 * "Show only fields that make sense for the chosen Property Type" cannot be written
 * as a switch over the 24 seeded keys, because a tenant that adds "Guest House" would
 * get a form with nothing on it. The rule is therefore read off the two things the
 * admin did set: the usage category, and whether the type is a bare piece of land.
 */

export interface UnitDetailFieldSet {
  bedrooms: boolean

  bathrooms: boolean

  kitchens: boolean

  lounges: boolean

  floorsCount: boolean

  floorNumber: boolean

  parking: boolean

  facing: boolean

  view: boolean

  ageYears: boolean

  subtype: boolean

  amenities: boolean
}

/** Usage keys this product treats as "someone lives or works inside it". */

const OCCUPIED_USAGE_KEYS = ["residential", "mixed_use"]

/**
 * Land is decided by the type's `land` flag, not by a name match: a farmhouse is land
 * plus a house, and its owner needs bedrooms on the form. The flag is what the admin
 * can set when they add a type, which is why it is stored rather than inferred.
 */

export function unitDetailFieldsFor(
  usageKey: string,

  isLand: boolean,

  hasSubTypes: boolean,
): UnitDetailFieldSet {
  const occupied = OCCUPIED_USAGE_KEYS.includes(usageKey)

  // Shops, offices, warehouses and factories are inside but nobody sleeps in them.

  const inside = !isLand

  return {
    bedrooms: occupied && inside,

    bathrooms: inside,

    kitchens: occupied && inside,

    lounges: occupied && inside,

    floorsCount: inside,

    floorNumber: inside,

    parking: true,

    facing: true,

    view: inside,

    ageYears: inside,

    subtype: hasSubTypes,

    amenities: true,
  }
}

/** Which of the detail fields are set on a unit, for a document or a table cell. */

export function unitDetailSummary(
  fields: Partial<Record<keyof UnitDetailFieldSet, number | string | null>>,

  visible: UnitDetailFieldSet,
): string[] {
  const parts: string[] = []

  const count = (key: keyof UnitDetailFieldSet, label: string) => {
    if (!visible[key]) return

    const value = fields[key]

    if (typeof value === "number" && value > 0) parts.push(`${value} ${label}`)
  }

  count("bedrooms", "bed")

  count("bathrooms", "bath")

  count("lounges", "lounge")

  count("parking", "parking")

  if (
    visible.facing &&
    typeof fields.facing === "string" &&
    fields.facing !== ""
  ) {
    parts.push(`${fields.facing} facing`)
  }

  if (
    visible.floorNumber &&
    typeof fields.floorNumber === "number" &&
    fields.floorNumber !== 0
  ) {
    parts.push(`Floor ${fields.floorNumber}`)
  }

  return parts
}

// --- Payment mode -----------------------------------------------------------

/**
 * Whether a booking of this unit needs a payment plan.
 *
 * Lump sum means the whole price is paid at once, so the booking form should not ask
 * anyone to invent a schedule. Installment and "both" do need one — with "both", the
 * choice is made at booking rather than decided here, which is why it is not treated
 * like lump sum.
 *
 * An empty key means no mode was recorded, which restricts nothing: a unit added before
 * this feature, or one whose admin never picked a mode, must keep the plan it always had.
 * Only the word `lump_sum` on the row is a decision, so only that one closes the door.
 */

export function saleModeAllowsInstallments(saleModeKey: string): boolean {
  if (saleModeKey === "") return true

  return saleModeKey === "installment" || saleModeKey === "both"
}

export function saleModeRequiresLumpSum(saleModeKey: string): boolean {
  return saleModeKey === "lump_sum"
}

// --- Printable facts --------------------------------------------------------

/**
 * The classification a document prints for one unit.
 *
 * A quotation, a booking record and a payment plan all have to answer "which property is
 * this, and what is it?", and none of them should need the whole inventory payload to say
 * so. Every value here is a label already resolved against the tenant's own lists, so a
 * unit sitting on a renamed or retired option prints the word this workspace uses.
 *
 * A `null` means nothing was recorded, and the document prints a dash for it. An empty
 * `detailSummary` means no detail field is set, which is a fact rather than a gap.
 */

export interface UnitFacts {
  unitCode: string

  /** The property type as this tenant names it. */

  propertyType: string | null

  subtype: string | null

  usage: string | null

  furnishing: string | null

  /** How the unit is sold, so a paper offer can state the mode it was made under. */

  saleMode: string | null

  /** False for a lump-sum-only unit, which is what stops a payment plan being built. */

  allowsInstallments: boolean

  possession: string | null

  ownership: string | null

  /** `4.5 Marla` in the unit it was sold in, or the stored square feet. */

  sizeDisplay: string | null

  /** `3 bed`, `2 bath`, `North facing` — the set detail fields only. */

  detailSummary: string[]

  address: string | null

  areaCity: string | null
}

// --- Bulk import ------------------------------------------------------------

/**
 * The CSV columns the importer reads, in template order.
 *
 * Column names are the words an accountant would type in a spreadsheet, not the JSON
 * field names: a sheet exported from a sales tracker says "Property Type" and
 * "Marla", and an importer that required `propertyTypeKey` would be a developer-only
 * feature. `key` is what the server reads off the parsed row, so the two never have to
 * match anything but this list.
 */

export interface UnitImportField {
  /** The header word in the template. */

  column: string

  /** The JSON field the parsed value is sent as. */

  key: string

  required: boolean

  /** How the cell is converted, and what makes it a bad row. */

  kind: "text" | "integer" | "decimal" | "code" | "list" | "boolean"

  max: number

  hint: string
}

export const UNIT_IMPORT_FIELDS: readonly UnitImportField[] = [
  {
    column: "Unit Code",

    key: "unitCode",

    required: true,

    kind: "text",

    max: 40,

    hint: "Unique inside this project.",
  },

  {
    column: "Property Type",

    key: "propertyType",

    required: true,

    kind: "code",

    max: 60,

    hint: "A label or key from Settings > Inventory Setup, e.g. Shop.",
  },

  {
    column: "Sub-type",

    key: "subtype",

    required: false,

    kind: "code",

    max: 60,

    hint: "Only for types that have them, e.g. Corner Shop.",
  },

  {
    column: "Usage",

    key: "usage",

    required: false,

    kind: "code",

    max: 60,

    hint: "Residential, Commercial, Industrial, Mixed Use, Agricultural.",
  },

  {
    column: "Block / Floor",

    key: "structurePath",

    required: true,

    kind: "text",

    max: 240,

    hint: "Structure path joined with /, e.g. Tower A / Level 12.",
  },

  {
    column: "Size",

    key: "sizeValue",

    required: true,

    kind: "decimal",

    max: 10,

    hint: "In the size unit below.",
  },

  {
    column: "Size Unit",

    key: "sizeUnit",

    required: false,

    kind: "code",

    max: 40,

    hint: "Marla, Kanal, Sq Ft, Sq Yd, Acre. Default Sq Ft.",
  },

  {
    column: "Base Price",

    key: "basePrice",

    required: true,

    kind: "integer",

    max: 13,

    hint: "Whole currency units, no decimals.",
  },

  {
    column: "Payment Mode",

    key: "saleMode",

    required: false,

    kind: "code",

    max: 40,

    hint: "Installment, Lump Sum, or Both. Blank allows installments.",
  },

  {
    column: "Furnishing",

    key: "furnishing",

    required: false,

    kind: "code",

    max: 40,

    hint: "Furnished, Semi-Furnished, Unfurnished.",
  },

  {
    column: "Possession",

    key: "possession",

    required: false,

    kind: "code",

    max: 40,

    hint: "Ready, Under Construction, Off-Plan, Possession Given.",
  },

  {
    column: "Ownership",

    key: "ownership",

    required: false,

    kind: "code",

    max: 40,

    hint: "Freehold, Leasehold, Allotment, Registry, Power of Attorney.",
  },

  {
    column: "Status",

    key: "status",

    required: false,

    kind: "code",

    max: 40,

    hint: "A status this workspace has. Default Available.",
  },

  {
    column: "Bedrooms",

    key: "bedrooms",

    required: false,

    kind: "integer",

    max: 2,

    hint: "Left blank for shops and plots.",
  },

  {
    column: "Bathrooms",

    key: "bathrooms",

    required: false,

    kind: "integer",

    max: 2,

    hint: "",
  },

  {
    column: "Kitchens",

    key: "kitchens",

    required: false,

    kind: "integer",

    max: 2,

    hint: "",
  },

  {
    column: "Parking",

    key: "parking",

    required: false,

    kind: "integer",

    max: 2,

    hint: "",
  },

  {
    column: "Floors",

    key: "floorsCount",

    required: false,

    kind: "integer",

    max: 3,

    hint: "How many storeys the unit has.",
  },

  {
    column: "Floor Number",

    key: "floorNumber",

    required: false,

    kind: "integer",

    max: 3,

    hint: "Which floor the unit is on.",
  },

  {
    column: "Facing",

    key: "facing",

    required: false,

    kind: "code",

    max: 20,

    hint: "North, South, East, West.",
  },

  {
    column: "View",

    key: "view",

    required: false,

    kind: "text",

    max: 120,

    hint: "",
  },

  {
    column: "Age (years)",

    key: "ageYears",

    required: false,

    kind: "integer",

    max: 3,

    hint: "",
  },

  {
    column: "Amenities",

    key: "amenities",

    required: false,

    kind: "list",

    max: 240,

    hint: "Separated by ;, e.g. Lift; Generator; Parking.",
  },

  {
    column: "Address",

    key: "address",

    required: false,

    kind: "text",

    max: 240,

    hint: "",
  },

  {
    column: "Area / City",

    key: "areaCity",

    required: false,

    kind: "text",

    max: 120,

    hint: "",
  },

  {
    column: "Latitude",

    key: "latitude",

    required: false,

    kind: "decimal",

    max: 12,

    hint: "",
  },

  {
    column: "Longitude",

    key: "longitude",

    required: false,

    kind: "decimal",

    max: 12,

    hint: "",
  },

  {
    column: "Photos",

    key: "photos",

    required: false,

    kind: "list",

    max: 2400,

    hint: "Links separated by ;. The first one becomes the main photo.",
  },

  {
    column: "Floor Plan",

    key: "floorPlanUrl",

    required: false,

    kind: "text",

    max: 2000,

    hint: "",
  },

  {
    column: "Video",

    key: "videoUrl",

    required: false,

    kind: "text",

    max: 2000,

    hint: "",
  },

  {
    column: "Description",

    key: "description",

    required: false,

    kind: "text",

    max: 2000,

    hint: "",
  },
]

/** The header line of the downloadable template. */

export function unitImportTemplateHeader(): string {
  return UNIT_IMPORT_FIELDS.map((field) => field.column).join(",")
}

/** Quote a cell the way a spreadsheet writes one: only when it needs it. */

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

/**
 * The worked example, one entry per importer field key.
 *
 * Written as a record rather than a comma string on purpose. A hand-typed row drifts:
 * the first version of this example carried fewer cells than the header had columns, so
 * everything from Bedrooms onward landed one or two columns to the left — `North` under
 * Floors, the amenity list under Age — and the file that looked like the safest way to
 * learn the format was the surest way to fill a sheet in wrong. Keying the values by the
 * same names the importer reads means a column can be added, removed or reordered in
 * `UNIT_IMPORT_FIELDS` and the example still lines up.
 */

const UNIT_IMPORT_EXAMPLE: Record<string, string> = {
  unitCode: "SHOP-12",
  propertyType: "Shop",
  subtype: "Corner Shop",
  usage: "Commercial",
  structurePath: "Tower A / Ground Floor",
  sizeValue: "4.5",
  sizeUnit: "Marla",
  basePrice: "18500000",
  saleMode: "Installment",
  furnishing: "Unfurnished",
  possession: "Ready",
  ownership: "Freehold",
  status: "Available",
  // Left blank because a shop has no bedrooms, which is the point the form makes too.

  bedrooms: "",
  bathrooms: "2",
  kitchens: "",
  parking: "1",
  floorsCount: "",
  floorNumber: "1",
  facing: "North",
  view: "Park view",
  ageYears: "",
  amenities: "Lift; Generator; Security; Parking",
  address: "Plot 12 Main Boulevard",
  areaCity: "Site Area D",
  latitude: "24.7039",
  longitude: "67.0915",
  photos: "https://example.com/shop-12.jpg",
  floorPlanUrl: "",
  videoUrl: "",
  description: "Corner shop on the ground floor, main entrance.",
}

/**
 * One example row.
 *
 * A template with only headers gets filled in wrong: the size unit column is where
 * everyone guesses, and a worked example settles what "Both" and "Corner Shop" mean
 * without anyone opening Settings first.
 */

export function unitImportTemplateRows(): string[] {
  return [
    UNIT_IMPORT_FIELDS.map((field) =>
      csvCell(UNIT_IMPORT_EXAMPLE[field.key] ?? ""),
    ).join(","),
  ]
}

/**
 * How many rows one import may carry.
 *
 * Bounded by the request body cap rather than by taste: every row is a full unit with
 * its attributes, amenities and media, and an importer that accepted 50,000 rows would
 * hold a transaction open long enough to block the sales desk behind it.
 */

export const UNIT_IMPORT_MAX_ROWS = 500

/**
 * The body cap for one import.
 *
 * The global 64 KB JSON limit is well short of 500 rows of 30 columns, and a bulk
 * import is the one screen where a large body is the point. Raised here rather than
 * globally for the reason `readJsonBody` states: a cap that a single route widens
 * cannot quietly widen the platform.
 */

export const UNIT_IMPORT_MAX_BODY_BYTES = 4 * 1024 * 1024
