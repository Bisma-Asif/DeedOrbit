/**
 * Property classifications for the demo inventory.
 *
 * The dataset used to write thirteen columns per unit and leave the twenty-five
 * category columns null, which meant the demo workspace showed the feature off by
 * showing nothing: blank filter chips, a stock-by-category card with no bars, and a
 * unit form with no type. This file gives every demo unit a classification, and makes
 * sure the one property type nobody picks is not in it.
 *
 * Two rules hold:
 *
 *  * **Coverage.** The `SHOWCASE` list walks every shipped property type, every
 *    sub-type under its own parent, all five usages, all three furnishing and sale
 *    modes, all four possession statuses, all five ownership types, all five size
 *    units and every amenity, so the filter chips, the category cards and the
 *    dashboard breakdown each have at least one real row to count.
 *
 *  * **Coherence.** A showcase entry only lands on a unit whose shape fits it (land on
 *    a plot leaf, a shop on a level that could be one), and a unit already carried into
 *    a booking is never sold lump sum — the money builder writes an installment plan for
 *    those, and a plan against a lump-sum listing would contradict the rule the booking
 *    page now prints.
 *
 * Everything is written by `server/sample/inventory.ts` inside the unit's own insert,
 * so the rows leave with the unit when the sample data is removed: the amenity and media
 * children cascade, and the registry only has to know about the parent.
 */

import type { UnitType } from "../../shared/inventory.ts"

import { INVENTORY_OPTION_SEEDS } from "../../shared/inventory-categories.ts"

/** The amenity keys the demo can attach, straight from the shipped vocabulary. */

const LAND_AMENITIES = INVENTORY_OPTION_SEEDS.amenity

  .map((option) => option.key)

  .filter((key) =>
    ["water_supply", "gas", "security", "park", "mosque", "parking"].includes(
      key,
    ),
  )

const BUILDING_AMENITIES = INVENTORY_OPTION_SEEDS.amenity

  .map((option) => option.key)

  .filter((key) =>
    [
      "lift",
      "elevator",
      "generator",
      "fire_safety",
      "security",
      "parking",
      "water_supply",
      "gas",
    ].includes(key),
  )

/**
 * One unit's whole classification, as the seeder writes it.
 *
 * An interface rather than an inline literal because `oxfmt` strips the separators from
 * a single-line object type, and a list this long is only readable one field per line.
 */

export interface UnitCategorySeed {
  propertyType: string

  /** The coarse family `inventory_units.unit_type` keeps, which the type must belong to. */

  legacy: UnitType

  usage: string

  subtype: string | null

  furnishing: string

  saleMode: string

  possession: string

  ownership: string

  ownershipNotes: string | null

  sizeValue: number

  sizeUnit: string

  bedrooms: number | null

  bathrooms: number | null

  kitchens: number | null

  lounges: number | null

  floorsCount: number | null

  floorNumber: number | null

  parking: number | null

  facing: string | null

  view: string | null

  ageYears: number | null

  address: string | null

  areaCity: string | null

  latitude: number | null

  longitude: number | null

  description: string | null

  /** How many photos, plus whether this unit carries a floor plan or a tour link. */

  photos: number

  floorPlan: boolean

  video: boolean

  /** Bare land, which decides the amenity pool and the leaf it may sit on. */

  land: boolean

  /** Only for the showcase walk: never assigned twice, so coverage is countable. */

  label: string
}

/** The fields every demo unit needs no matter who classifies it. */

interface SeedBase {
  propertyType: string

  legacy: UnitType

  usage: string

  subtype: string | null

  furnishing: string

  saleMode: string

  possession: string

  ownership: string

  sizeValue: number

  sizeUnit: string

  land: boolean
}

function seed(
  base: SeedBase,
  extra: Partial<UnitCategorySeed>,
): UnitCategorySeed {
  return {
    bedrooms: null,

    bathrooms: null,

    kitchens: null,

    lounges: null,

    floorsCount: null,

    floorNumber: null,

    parking: null,

    facing: null,

    view: null,

    ageYears: null,

    address: null,

    areaCity: null,

    latitude: null,

    longitude: null,

    description: null,

    ownershipNotes: null,

    photos: 0,

    floorPlan: false,

    video: false,

    label: base.propertyType,

    ...extra,

    ...base,
  }
}

/**
 * One entry per property type, with the sub-type variants repeated under their parent.
 *
 * Sizes here are the typed figure (marla, kanal, acre), which is what the buyer is quoted
 * in; the square-foot column the rest of the product reads is written alongside it by the
 * seeder from the same option factor.
 */

export const SHOWCASE: UnitCategorySeed[] = [
  // --- Land, and the four plot sub-types -----------------------------------------------

  seed(
    {
      propertyType: "plot",

      legacy: "plot",

      usage: "residential",

      subtype: "corner",

      furnishing: "unfurnished",

      saleMode: "installment",

      possession: "under_construction",

      ownership: "freehold",

      sizeValue: 10,

      sizeUnit: "marla",

      land: true,
    },

    {
      label: "Corner plot",
      photos: 1,
      parking: 0,
      facing: "north",
      description: "Corner plot on the sector's spine road.",
    },
  ),

  seed(
    {
      propertyType: "plot",

      legacy: "plot",

      usage: "residential",

      subtype: "park_facing",

      furnishing: "unfurnished",

      saleMode: "both",

      possession: "ready",

      ownership: "leasehold",

      sizeValue: 2,

      sizeUnit: "kanal",

      land: true,
    },

    {
      label: "Park-facing plot",
      photos: 2,
      view: "Park",
      description: "Two kanal facing the sector park.",
    },
  ),

  seed(
    {
      propertyType: "plot",

      legacy: "plot",

      usage: "residential",

      subtype: "main_boulevard",

      furnishing: "unfurnished",

      saleMode: "lump_sum",

      possession: "ready",

      ownership: "registry",

      sizeValue: 500,

      sizeUnit: "square_yard",

      land: true,
    },

    {
      label: "Boulevard plot",
      photos: 1,
      ownershipNotes: "Registry available on transfer.",
    },
  ),

  seed(
    {
      propertyType: "plot",

      legacy: "plot",

      usage: "residential",

      subtype: "normal",

      furnishing: "unfurnished",

      saleMode: "installment",

      possession: "possession_given",

      ownership: "allotment",

      sizeValue: 5,

      sizeUnit: "marla",

      land: true,
    },

    {
      label: "Standard plot",
      description: "Interior plot, allotted by the scheme.",
    },
  ),

  seed(
    {
      propertyType: "residential_plot",

      legacy: "plot",

      usage: "residential",

      subtype: null,

      furnishing: "unfurnished",

      saleMode: "installment",

      possession: "off_plan",

      ownership: "freehold",

      sizeValue: 5,

      sizeUnit: "marla",

      land: true,
    },

    { label: "Residential plot", photos: 1 },
  ),

  seed(
    {
      propertyType: "commercial_plot",

      legacy: "plot",

      usage: "commercial",

      subtype: null,

      furnishing: "unfurnished",

      saleMode: "lump_sum",

      possession: "ready",

      ownership: "leasehold",

      sizeValue: 9,

      sizeUnit: "marla",

      land: true,
    },

    {
      label: "Commercial plot",
      photos: 1,
      facing: "east",
      description: "Plot on the commercial spine, main-road frontage.",
    },
  ),

  seed(
    {
      propertyType: "agricultural_land",

      legacy: "plot",

      usage: "agricultural",

      subtype: null,

      furnishing: "unfurnished",

      saleMode: "lump_sum",

      possession: "possession_given",

      ownership: "registry",

      sizeValue: 1,

      sizeUnit: "acre",

      land: true,
    },

    {
      label: "Agricultural land",

      latitude: 24.8607,

      longitude: 67.0011,

      ownershipNotes: "Tube-well on the plot; transfer by registry.",

      description: "One acre on the farm belt, off the canal road.",
    },
  ),

  seed(
    {
      propertyType: "farmhouse",

      legacy: "villa",

      usage: "residential",

      subtype: null,

      furnishing: "semi_furnished",

      saleMode: "both",

      possession: "ready",

      ownership: "freehold",

      sizeValue: 4,

      sizeUnit: "kanal",

      land: true,
    },

    {
      label: "Farmhouse",

      bedrooms: 4,

      bathrooms: 4,

      kitchens: 2,

      lounges: 1,

      floorsCount: 2,

      parking: 3,

      facing: "south",

      ageYears: 6,

      photos: 3,

      floorPlan: true,

      view: "Farm green",

      description: "Farmhouse on four kanal with a separate staff quarters.",
    },
  ),

  // --- The three house sub-types, then the other house-family types ---------------------

  seed(
    {
      propertyType: "house",

      legacy: "villa",

      usage: "residential",

      subtype: "single_storey",

      furnishing: "furnished",

      saleMode: "installment",

      possession: "ready",

      ownership: "freehold",

      sizeValue: 7,

      sizeUnit: "marla",

      land: false,
    },

    {
      label: "Single-storey house",

      bedrooms: 3,

      bathrooms: 3,

      kitchens: 1,

      lounges: 1,

      floorsCount: 1,

      floorNumber: 1,

      parking: 2,

      facing: "north",

      ageYears: 3,

      photos: 3,

      floorPlan: true,

      video: true,
    },
  ),

  seed(
    {
      propertyType: "house",

      legacy: "villa",

      usage: "residential",

      subtype: "double_storey",

      furnishing: "semi_furnished",

      saleMode: "both",

      possession: "under_construction",

      ownership: "leasehold",

      sizeValue: 10,

      sizeUnit: "marla",

      land: false,
    },

    {
      label: "Double-storey house",

      bedrooms: 4,

      bathrooms: 4,

      kitchens: 2,

      lounges: 1,

      floorsCount: 2,

      parking: 2,

      facing: "east",

      photos: 2,

      floorPlan: true,
    },
  ),

  seed(
    {
      propertyType: "house",

      legacy: "villa",

      usage: "mixed_use",

      subtype: "triple_storey",

      furnishing: "unfurnished",

      saleMode: "installment",

      possession: "off_plan",

      ownership: "allotment",

      sizeValue: 12,

      sizeUnit: "marla",

      land: false,
    },

    {
      label: "Triple-storey house",

      bedrooms: 5,

      bathrooms: 5,

      kitchens: 2,

      lounges: 2,

      floorsCount: 3,

      parking: 3,

      facing: "west",

      photos: 1,

      description: "Three floors, shop line on the ground level.",
    },
  ),

  seed(
    {
      propertyType: "villa",

      legacy: "villa",

      usage: "residential",

      subtype: null,

      furnishing: "furnished",

      saleMode: "both",

      possession: "ready",

      ownership: "freehold",

      sizeValue: 8,

      sizeUnit: "marla",

      land: false,
    },

    {
      label: "Villa",

      bedrooms: 4,

      bathrooms: 5,

      kitchens: 2,

      lounges: 2,

      floorsCount: 2,

      parking: 3,

      facing: "south",

      view: "Golf course",

      ageYears: 2,

      photos: 3,

      floorPlan: true,
    },
  ),

  seed(
    {
      propertyType: "bungalow",

      legacy: "villa",

      usage: "residential",

      subtype: null,

      furnishing: "furnished",

      saleMode: "lump_sum",

      possession: "possession_given",

      ownership: "registry",

      sizeValue: 6,

      sizeUnit: "marla",

      land: false,
    },

    {
      label: "Bungalow",

      bedrooms: 3,

      bathrooms: 2,

      kitchens: 1,

      lounges: 1,

      floorsCount: 1,

      floorNumber: 1,

      parking: 2,

      facing: "north",

      ageYears: 12,

      photos: 2,
    },
  ),

  // --- Apartments and their variants ----------------------------------------------------

  seed(
    {
      propertyType: "apartment",

      legacy: "apartment",

      usage: "residential",

      subtype: null,

      furnishing: "semi_furnished",

      saleMode: "installment",

      possession: "under_construction",

      ownership: "freehold",

      sizeValue: 1450,

      sizeUnit: "square_feet",

      land: false,
    },

    {
      label: "Apartment",

      bedrooms: 3,

      bathrooms: 3,

      kitchens: 1,

      lounges: 1,

      floorsCount: 1,

      floorNumber: 5,

      parking: 1,

      facing: "east",

      photos: 2,

      floorPlan: true,
    },
  ),

  seed(
    {
      propertyType: "flat",

      legacy: "apartment",

      usage: "residential",

      subtype: null,

      furnishing: "furnished",

      saleMode: "both",

      possession: "ready",

      ownership: "leasehold",

      sizeValue: 1150,

      sizeUnit: "square_feet",

      land: false,
    },

    {
      label: "Flat",

      bedrooms: 2,

      bathrooms: 2,

      kitchens: 1,

      lounges: 1,

      floorNumber: 3,

      parking: 1,

      facing: "south",

      ageYears: 4,

      photos: 2,
    },
  ),

  seed(
    {
      propertyType: "studio_apartment",

      legacy: "apartment",

      usage: "residential",

      subtype: null,

      furnishing: "furnished",

      saleMode: "installment",

      possession: "ready",

      ownership: "allotment",

      sizeValue: 120,

      sizeUnit: "square_yard",

      land: false,
    },

    {
      label: "Studio apartment",

      bedrooms: 1,

      bathrooms: 1,

      kitchens: 1,

      floorNumber: 6,

      facing: "west",

      photos: 1,

      description: "One room with a combined living and sleeping area.",
    },
  ),

  seed(
    {
      propertyType: "penthouse",

      legacy: "apartment",

      usage: "residential",

      subtype: null,

      furnishing: "furnished",

      saleMode: "lump_sum",

      possession: "ready",

      ownership: "freehold",

      sizeValue: 2400,

      sizeUnit: "square_feet",

      land: false,
    },

    {
      label: "Penthouse",

      bedrooms: 4,

      bathrooms: 4,

      kitchens: 2,

      lounges: 2,

      floorsCount: 2,

      floorNumber: 8,

      parking: 2,

      facing: "north",

      view: "Skyline",

      photos: 3,

      floorPlan: true,

      video: true,
    },
  ),

  seed(
    {
      propertyType: "duplex",

      legacy: "apartment",

      usage: "residential",

      subtype: null,

      furnishing: "semi_furnished",

      saleMode: "installment",

      possession: "under_construction",

      ownership: "registry",

      sizeValue: 1850,

      sizeUnit: "square_feet",

      land: false,
    },

    {
      label: "Duplex",

      bedrooms: 3,

      bathrooms: 3,

      kitchens: 1,

      lounges: 1,

      floorsCount: 2,

      floorNumber: 7,

      parking: 1,

      facing: "east",

      photos: 2,

      floorPlan: true,
    },
  ),

  seed(
    {
      propertyType: "upper_portion",

      legacy: "apartment",

      usage: "residential",

      subtype: null,

      furnishing: "unfurnished",

      saleMode: "installment",

      possession: "ready",

      ownership: "freehold",

      sizeValue: 1100,

      sizeUnit: "square_feet",

      land: false,
    },

    {
      label: "Upper portion",

      bedrooms: 3,

      bathrooms: 2,

      kitchens: 1,

      lounges: 1,

      floorNumber: 2,

      parking: 1,

      facing: "north",

      ageYears: 8,

      photos: 1,

      description: "The upstairs half of a house, sold separately.",
    },
  ),

  seed(
    {
      propertyType: "lower_portion",

      legacy: "apartment",

      usage: "mixed_use",

      subtype: null,

      furnishing: "semi_furnished",

      saleMode: "both",

      possession: "possession_given",

      ownership: "leasehold",

      sizeValue: 980,

      sizeUnit: "square_feet",

      land: false,
    },

    {
      label: "Lower portion",

      bedrooms: 2,

      bathrooms: 2,

      kitchens: 1,

      floorNumber: 1,

      facing: "south",

      ageYears: 10,

      photos: 1,

      description: "Ground-floor half with a street-facing storefront.",
    },
  ),

  seed(
    {
      propertyType: "basement",

      legacy: "apartment",

      usage: "residential",

      subtype: null,

      furnishing: "unfurnished",

      saleMode: "installment",

      possession: "ready",

      ownership: "allotment",

      sizeValue: 850,

      sizeUnit: "square_feet",

      land: false,
    },

    {
      label: "Basement",

      bedrooms: 2,

      bathrooms: 1,

      kitchens: 1,

      floorNumber: 1,

      facing: "west",

      photos: 1,

      description: "Basement residence with a light well at the rear.",
    },
  ),

  // --- The seven shop sub-types ----------------------------------------------------------

  seed(
    {
      propertyType: "shop",

      legacy: "shop",

      usage: "commercial",

      subtype: "ground_floor",

      furnishing: "unfurnished",

      saleMode: "both",

      possession: "ready",

      ownership: "freehold",

      sizeValue: 420,

      sizeUnit: "square_feet",

      land: false,
    },

    {
      label: "Ground-floor shop",
      bathrooms: 1,
      floorNumber: 1,
      facing: "east",
      photos: 2,
      floorPlan: true,
    },
  ),

  seed(
    {
      propertyType: "shop",

      legacy: "shop",

      usage: "commercial",

      subtype: "mezzanine",

      furnishing: "semi_furnished",

      saleMode: "installment",

      possession: "ready",

      ownership: "leasehold",

      sizeValue: 560,

      sizeUnit: "square_feet",

      land: false,
    },

    { label: "Mezzanine shop", bathrooms: 1, floorNumber: 2, photos: 1 },
  ),

  seed(
    {
      propertyType: "shop",

      legacy: "shop",

      usage: "commercial",

      subtype: "corner_shop",

      furnishing: "unfurnished",

      saleMode: "lump_sum",

      possession: "possession_given",

      ownership: "registry",

      sizeValue: 380,

      sizeUnit: "square_feet",

      land: false,
    },

    {
      label: "Corner shop",
      bathrooms: 1,
      facing: "north",
      photos: 2,
      description: "Double-frontage corner unit at the plaza entry.",
    },
  ),

  seed(
    {
      propertyType: "shop",

      legacy: "shop",

      usage: "commercial",

      subtype: "main_road",

      furnishing: "furnished",

      saleMode: "installment",

      possession: "ready",

      ownership: "power_of_attorney",

      sizeValue: 3,

      sizeUnit: "marla",

      land: false,
    },

    {
      label: "Main-road shop",

      bathrooms: 1,

      facing: "south",

      photos: 1,

      ownershipNotes:
        "Held on a registered power of attorney; title transfer pending.",
    },
  ),

  seed(
    {
      propertyType: "shop",

      legacy: "shop",

      usage: "commercial",

      subtype: "inside_mall",

      furnishing: "furnished",

      saleMode: "both",

      possession: "under_construction",

      ownership: "allotment",

      sizeValue: 300,

      sizeUnit: "square_feet",

      land: false,
    },

    {
      label: "Mall shop",
      bathrooms: 0,
      floorNumber: 2,
      photos: 1,
      description: "Lock-up inside the mall's first floor.",
    },
  ),

  seed(
    {
      propertyType: "shop",

      legacy: "shop",

      usage: "commercial",

      subtype: "food_court",

      furnishing: "furnished",

      saleMode: "installment",

      possession: "off_plan",

      ownership: "freehold",

      sizeValue: 220,

      sizeUnit: "square_feet",

      land: false,
    },

    { label: "Food-court counter", floorNumber: 3, photos: 1 },
  ),

  seed(
    {
      propertyType: "shop",

      legacy: "shop",

      usage: "commercial",

      subtype: "kiosk",

      furnishing: "unfurnished",

      saleMode: "lump_sum",

      possession: "ready",

      ownership: "leasehold",

      sizeValue: 90,

      sizeUnit: "square_feet",

      land: false,
    },

    { label: "Shop kiosk", photos: 1 },
  ),

  // --- The remaining commercial and industrial types -------------------------------------

  seed(
    {
      propertyType: "showroom",

      legacy: "shop",

      usage: "commercial",

      subtype: null,

      furnishing: "semi_furnished",

      saleMode: "both",

      possession: "ready",

      ownership: "freehold",

      sizeValue: 1200,

      sizeUnit: "square_feet",

      land: false,
    },

    {
      label: "Showroom",
      bathrooms: 1,
      floorNumber: 1,
      parking: 4,
      facing: "east",
      photos: 2,
      floorPlan: true,
    },
  ),

  seed(
    {
      propertyType: "office",

      legacy: "office",

      usage: "commercial",

      subtype: null,

      furnishing: "furnished",

      saleMode: "installment",

      possession: "ready",

      ownership: "leasehold",

      sizeValue: 900,

      sizeUnit: "square_feet",

      land: false,
    },

    {
      label: "Office",
      bathrooms: 2,
      floorNumber: 4,
      parking: 2,
      facing: "west",
      photos: 2,
    },
  ),

  seed(
    {
      propertyType: "floor_plaza",

      legacy: "office",

      usage: "commercial",

      subtype: null,

      furnishing: "semi_furnished",

      saleMode: "both",

      possession: "under_construction",

      ownership: "registry",

      sizeValue: 3200,

      sizeUnit: "square_feet",

      land: false,
    },

    {
      label: "Plaza floor",
      bathrooms: 3,
      floorsCount: 1,
      floorNumber: 6,
      parking: 6,
      photos: 1,
      floorPlan: true,
    },
  ),

  seed(
    {
      propertyType: "food_court_unit",

      legacy: "shop",

      usage: "commercial",

      subtype: null,

      furnishing: "furnished",

      saleMode: "installment",

      possession: "off_plan",

      ownership: "allotment",

      sizeValue: 450,

      sizeUnit: "square_feet",

      land: false,
    },

    { label: "Food-court unit", bathrooms: 1, floorNumber: 3, photos: 1 },
  ),

  seed(
    {
      propertyType: "kiosk",

      legacy: "shop",

      usage: "commercial",

      subtype: null,

      furnishing: "unfurnished",

      saleMode: "lump_sum",

      possession: "ready",

      ownership: "power_of_attorney",

      sizeValue: 120,

      sizeUnit: "square_feet",

      land: false,
    },

    {
      label: "Kiosk",

      photos: 1,

      ownershipNotes:
        "Kiosk licence renewed each season; sold on power of attorney.",
    },
  ),

  seed(
    {
      propertyType: "warehouse",

      legacy: "office",

      usage: "commercial",

      subtype: null,

      furnishing: "unfurnished",

      saleMode: "installment",

      possession: "ready",

      ownership: "freehold",

      sizeValue: 6800,

      sizeUnit: "square_feet",

      land: false,
    },

    {
      label: "Warehouse",
      bathrooms: 1,
      floorsCount: 1,
      parking: 4,
      photos: 2,
      floorPlan: true,
    },
  ),

  seed(
    {
      propertyType: "factory_industrial",

      legacy: "office",

      usage: "industrial",

      subtype: null,

      furnishing: "unfurnished",

      saleMode: "both",

      possession: "under_construction",

      ownership: "leasehold",

      sizeValue: 6,

      sizeUnit: "kanal",

      land: false,
    },

    {
      label: "Industrial unit",

      bathrooms: 2,

      floorsCount: 1,

      parking: 6,

      photos: 1,

      description: "Single-span factory unit with a crane rail and a yard.",
    },
  ),
]

/**
 * Which part of a scheme a classification can plausibly sit in.
 *
 * The demo has three projects: a plot scheme, a set of apartment towers, and a
 * pre-launch block with shops on its lower levels. Walking the showcase straight
 * down the leaf list would put a warehouse on Level 7 of a tower and a penthouse
 * on a bare plot, which reads as broken data rather than as a demo. So each entry
 * is asked where it belongs, and a leaf only offers entries that fit it.
 */

export type ShowcaseZone = "plot" | "street" | "tower"

/** Land, and the marla-sized house family, are sold on a plot leaf. */

const LAND_SIZE_UNITS = ["marla", "kanal", "acre"]

export function zoneOf(entry: UnitCategorySeed): ShowcaseZone {
  if (entry.land) return "plot"

  const traded = entry.usage === "commercial" || entry.usage === "industrial"

  if (traded) return "street"

  return LAND_SIZE_UNITS.includes(entry.sizeUnit) ? "plot" : "tower"
}

/**
 * Square feet in one of the shipped size units.
 *
 * Read from the same seed list that fills `inventory_category_options.value_num`, so
 * the `size_value` the seeder writes and the `size_sqft` every other screen reads
 * convert into each other exactly, which is what the unit form's live conversion does
 * for a typed figure too. A tenant that re-points its marla at 242 sq ft is a settings
 * change, not a seeder change; the demo ships on the defaults.
 */

export function squareFeetPerSizeUnit(key: string): number {
  const option = INVENTORY_OPTION_SEEDS.size_unit.find(
    (item) => item.key === key,
  )

  return option?.factor ?? 1
}

/** The stored square footage a showcase entry's own size figure means. */

export function squareFeetFor(entry: UnitCategorySeed): number {
  return Math.max(
    1,
    Math.round(entry.sizeValue * squareFeetPerSizeUnit(entry.sizeUnit)),
  )
}

/** Where the showcase walk has got to, per zone: the entries already handed out. */

export interface ShowcaseCursor {
  plot: number[]

  street: number[]

  tower: number[]
}

/** The entry a walk handed out, and its place in the list. */

export interface ShowcasePick {
  entry: UnitCategorySeed

  index: number
}

/** A classification derived from a leaf rather than chosen from the showcase. */

export interface DerivedCategory {
  category: UnitCategorySeed

  amenities: string[]
}

/**
 * The next showcase entry that fits this leaf's zone, or null once that walk is done.
 *
 * A committed unit never takes a lump-sum entry: the money builder has already written an
 * installment plan against it, and the booking page would then print a rule the record
 * contradicts. Such an entry is *left in the list* rather than stepped over, so the next
 * available unit of the same zone still gets it — which is what keeps the showcase's own
 * claim true, that every lump-sum type appears somewhere in the demo.
 *
 * Each zone carries the indices it has already handed out, so an entry is never placed
 * twice and the coverage it promises stays countable.
 */

export function nextShowcase(
  cursor: ShowcaseCursor,

  zone: ShowcaseZone,

  committed: boolean,
): ShowcasePick | null {
  const used = cursor[zone]

  for (let index = 0; index < SHOWCASE.length; index += 1) {
    const entry = SHOWCASE[index]!

    if (used.includes(index) || zoneOf(entry) !== zone) continue

    if (committed && entry.saleMode === "lump_sum") continue

    used.push(index)

    return { entry, index }
  }

  return null
}

/** The amenities a demo unit carries, walked around the pool so all ten appear. */

export function amenitiesFor(index: number, land: boolean): string[] {
  const pool = land ? LAND_AMENITIES : BUILDING_AMENITIES

  if (pool.length === 0) return []

  const count = (index % 3) + 1

  const keys: string[] = []

  for (let step = 0; step < count; step += 1) {
    const key = pool[(index + step * 3) % pool.length]

    if (key && !keys.includes(key)) keys.push(key)
  }

  return keys
}

/**
 * The classification a unit gets when it is not part of the showcase walk.
 *
 * Derived from what the seeder already knows about the unit — its leaf, its size, whether
 * a corner or park premium was charged — so the demo stays internally consistent: a plot
 * with a corner premium is a corner plot, and the filter chip for it finds the row.
 */

export function fallbackCategory(input: {
  plot: boolean

  preLaunch: boolean

  ownership: string

  marla: number

  sizeSqft: number

  serial: number

  position: number

  corner: boolean

  parkFacing: boolean

  level: number

  committed: boolean
}): DerivedCategory {
  const {
    plot,

    preLaunch,

    ownership,

    marla,

    sizeSqft,

    serial,

    position,

    corner,

    parkFacing,

    level,

    committed,
  } = input

  // Lump sum only appears on units nobody has committed yet: a booking needs a plan,

  // and the booking page refuses one for a lump-sum listing.

  const saleMode = committed
    ? position % 3 === 0
      ? "both"
      : "installment"
    : position % 7 === 0
      ? "both"
      : position % 9 === 0
        ? "lump_sum"
        : "installment"

  const possession = preLaunch
    ? "off_plan"
    : position % 4 === 0
      ? "under_construction"
      : "ready"

  const furnishing = plot
    ? "unfurnished"
    : position % 5 === 0
      ? "furnished"
      : position % 3 === 0
        ? "semi_furnished"
        : "unfurnished"

  const ownershipKey =
    ownership === "leasehold"
      ? "leasehold"
      : position % 11 === 0
        ? "allotment"
        : "freehold"

  if (plot) {
    return {
      amenities: amenitiesFor(position, true),

      category: seed(
        {
          propertyType: preLaunch ? "residential_plot" : "plot",

          legacy: "plot",

          usage: "residential",

          subtype: corner
            ? "corner"
            : parkFacing
              ? "park_facing"
              : serial % 4 === 0
                ? "main_boulevard"
                : "normal",

          furnishing,

          saleMode,

          possession,

          ownership: ownershipKey,

          sizeValue: marla,

          sizeUnit: "marla",

          land: true,
        },

        {
          label: preLaunch ? "Residential plot" : "Plot",

          facing: corner ? "north" : serial % 2 === 0 ? "east" : "south",

          parking: 0,
        },
      ),
    }
  }

  const bedrooms =
    sizeSqft >= 2000 ? 4 : sizeSqft >= 1400 ? 3 : sizeSqft >= 1000 ? 2 : 1

  return {
    amenities: amenitiesFor(position, false),

    category: seed(
      {
        propertyType: position % 6 === 0 ? "flat" : "apartment",

        legacy: "apartment",

        usage: "residential",

        subtype: null,

        furnishing,

        saleMode,

        possession,

        ownership: ownershipKey,

        sizeValue: sizeSqft,

        sizeUnit: "square_feet",

        land: false,
      },

      {
        label: "Apartment",

        bedrooms,

        bathrooms: bedrooms,

        kitchens: 1,

        lounges: bedrooms >= 3 ? 1 : 0,

        floorsCount: 1,

        floorNumber: level,

        parking: bedrooms >= 3 ? 1 : 0,

        facing: ["north", "south", "east", "west"][position % 4] ?? "north",

        view: level >= 6 ? "Skyline" : null,

        floorPlan: false,
      },
    ),
  }
}
