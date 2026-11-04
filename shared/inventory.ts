/**
 * The vocabulary of a sellable unit, shared by the server and the client.
 *
 * A unit is one thing — a plot, an apartment, a shop, an office, a villa — that
 * differs from its neighbours only in the word used for it and in the size and
 * price attached to it. So one table holds all five, exactly as one table holds
 * a block, a sector and a floor in `shared/projects.ts`. Separate tables per unit
 * type would mean five near-identical schemas, five route families, and a union
 * type at every call site, in exchange for integrity that a `CHECK` constraint
 * already provides.
 *
 * Everything here is a closed set or a bound. Nothing in this file describes a
 * value the database cannot hold, because a limit the server enforces and the
 * client does not know about is a limit the user learns by being rejected.
 */

/** The kinds of unit this workspace sells. */
export const UNIT_TYPES = [
  "plot",
  "apartment",
  "shop",
  "office",
  "villa",
] as const

export type UnitType = typeof UNIT_TYPES[number]

export const UNIT_TYPE_LABELS: Record<UnitType, string> = {
  plot: "Plot",
  apartment: "Apartment",
  shop: "Shop",
  office: "Office",
  villa: "Villa",
}

/**
 * Short forms for the table, where a column header already says "Type" and the
 * full word is a needless second label.
 */
export const UNIT_TYPE_SHORT: Record<UnitType, string> = {
  plot: "Plot",
  apartment: "Apt",
  shop: "Shop",
  office: "Office",
  villa: "Villa",
}

export function isUnitType(value: unknown): value is UnitType {
  return (
    typeof value === "string" &&
    (UNIT_TYPES as readonly string[]).includes(value)
  )
}

/**
 * How a status is coloured, and the only colours it may be coloured.
 *
 * A tone is stored alongside each status rather than derived from its key, because
 * a tenant that adds "Under offer" chooses how that reads. The set is closed and
 * every tone maps to a token that already exists in the palette, so a custom status
 * cannot introduce a new hue into a screen that is otherwise slate, emerald, amber
 * and muted red.
 */
export const UNIT_STATUS_TONES = [
  "neutral",
  "outline",
  "success",
  "warning",
  "info",
  "danger",
] as const

export type UnitStatusTone = typeof UNIT_STATUS_TONES[number]

export const UNIT_STATUS_TONE_LABELS: Record<UnitStatusTone, string> = {
  neutral: "Grey",

  outline: "Outlined",

  success: "Green",

  warning: "Amber",

  info: "Blue",

  danger: "Red",
}

/** One sentence on what a tone means, offered when a custom status is created. */
export const UNIT_STATUS_TONE_HINTS: Record<UnitStatusTone, string> = {
  neutral: "Finished or closed. Nothing further is expected.",

  outline: "Not yet decided, or deliberately quiet.",

  success: "On the market and sellable.",

  warning: "Spoken for, or deliberately withheld.",

  info: "Committed to a buyer but not yet completed.",

  danger: "Called off. Keeps the reason on the record.",
}

export function isUnitStatusTone(value: unknown): value is UnitStatusTone {
  return (
    typeof value === "string" &&
    (UNIT_STATUS_TONES as readonly string[]).includes(value)
  )
}

/**
 * Where a unit sits in its lifecycle.
 *
 * These are data, not a closed enum: the table below is the seed every tenant gets,
 * and a tenant admin may add more. What is *not* negotiable is that the seed covers
 * the states a sales conversation actually distinguishes — offered, spoken for,
 * committed, finished, called off, moved on, and deliberately withheld — so a report
 * written against one workspace still reads on another.
 */
export interface UnitStatusSeed {
  key: string
  label: string
  tone: UnitStatusTone
  sortOrder: number
  /** Shown in the picker so the word is not the only clue. */
  hint: string
}

export const BUILT_IN_UNIT_STATUSES: readonly UnitStatusSeed[] = [
  {
    key: "draft",
    label: "Draft",
    tone: "outline",
    sortOrder: 0,
    hint: "Recorded but not yet published to the market.",
  },
  {
    key: "available",
    label: "Available",
    tone: "success",
    sortOrder: 1,
    hint: "On the market and free to sell.",
  },
  {
    key: "reserved",
    label: "Reserved",
    tone: "warning",
    sortOrder: 2,
    hint: "Spoken for by one buyer, not yet contracted.",
  },
  {
    key: "booked",
    label: "Booked",
    tone: "info",
    sortOrder: 3,
    hint: "Contracted with a buyer, handover still ahead.",
  },
  {
    key: "sold",
    label: "Sold",
    tone: "neutral",
    sortOrder: 4,
    hint: "Completed and handed over.",
  },
  {
    key: "cancelled",
    label: "Cancelled",
    tone: "danger",
    sortOrder: 5,
    hint: "Called off. The unit returns to the market by hand or by workflow.",
  },
  {
    key: "transferred",
    label: "Transferred",
    tone: "outline",
    sortOrder: 6,
    hint: "Moved to another buyer or block without being sold again.",
  },
  {
    key: "hold",
    label: "Blocked / Hold",
    tone: "warning",
    sortOrder: 7,
    hint: "Withheld from the market deliberately — defects, legal, or instructions.",
  },
]

export const BUILT_IN_UNIT_STATUS_KEYS: readonly string[] =
  BUILT_IN_UNIT_STATUSES.map((status) => status.key)

export const BUILT_IN_UNIT_STATUS_LABELS: Record<string, string> =
  BUILT_IN_UNIT_STATUSES.reduce(
    (acc, status) => {
      acc[status.key] = status.label
      return acc
    },
    {} as Record<string, string>,
  )

export const BUILT_IN_UNIT_STATUS_TONES: Record<string, UnitStatusTone> =
  BUILT_IN_UNIT_STATUSES.reduce(
    (acc, status) => {
      acc[status.key] = status.tone
      return acc
    },
    {} as Record<string, UnitStatusTone>,
  )

/**
 * Statuses that still count towards unsold stock.
 *
 * "Available units" in a sales conversation means units nobody has spoken for, which
 * excludes drafts (not really offered yet), booked and sold (committed elsewhere),
 * cancelled and transferred (closed one way or another), and hold (withheld on
 * purpose — calling a blocked unit available is how a buyer is promised something
 * that cannot be delivered).
 */
export const OPEN_UNIT_STATUS_KEYS: readonly string[] = [
  "available",
  "reserved",
]

/**
 * A status key is the stored value, so it has to survive a URL, a JSON body and a
 * filter query string unchanged. It is derived from the label rather than typed, and
 * never shown to a user.
 */
export const UNIT_STATUS_KEY_MAX = 40
export const UNIT_STATUS_LABEL_MAX = 40

/**
 * How many statuses a tenant may define beyond the built-in set.
 *
 * A vocabulary is meant to stay short enough to read as a filter bar. Past this
 * number the list stops being a set of states and becomes a set of conventions.
 */
export const UNIT_STATUS_MAX = 24

/** An optional note recorded against a manual status change. */
export const UNIT_STATUS_NOTE_MAX = 200

/**
 * Derives the stored key from a label the admin typed: lower case, underscores, and
 * nothing else. "Blocked / Hold" and "blocked-hold" both have to reach the same key
 * so a tenant cannot end up with two statuses that read identically in a filter.
 */
export function unitStatusKeyFromLabel(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, UNIT_STATUS_KEY_MAX)
}

/** A unit code is how a unit is named in correspondence and on a plan. */
export const UNIT_CODE_MIN = 1
export const UNIT_CODE_MAX = 40

/**
 * Free text describing where the unit sits and which way it faces: "North-facing,
 * podium level", "Corner, sea view". Optional — a plot in the middle of a site
 * has no orientation worth recording, and an invented one is worse than a dash.
 */
export const UNIT_LOCATION_MAX = 120

/**
 * Size is recorded in whole square feet.
 *
 * The tenant base currency is the UAE dirham and the market quotes in square
 * feet, so square feet is the unit a user will type without thinking. Whole
 * numbers only: a tenth of a square foot is not a thing anyone sells, and an
 * integer column stores an area exactly where a float column would not.
 */
export const UNIT_SIZE_MIN = 1
export const UNIT_SIZE_MAX = 1_000_000

/**
 * Base price in whole units of the tenant's currency — dirhams, not fils.
 *
 * Deliberately an integer count of major units rather than minor ones. Property
 * is listed in whole dirhams, so the extra precision of fils would buy nothing
 * while making every stored figure unreadable in the database; and an integer
 * stores money exactly, where a float would eventually round a listed price by a
 * fils and make it disagree with the figure that was typed.
 */
export const UNIT_PRICE_MIN = 0
export const UNIT_PRICE_MAX = 1_000_000_000_000

export interface UnitPricingConfig {
  pricePerSqft: number
  developmentCharge: number
  cornerPremium: number
  parkFacingPremium: number
  floorPremium: number
  discount: number
}

export interface UnitPriceBreakdown {
  basePrice: number
  sizePrice: number
  developmentCharge: number
  cornerPremium: number
  parkFacingPremium: number
  floorPremium: number
  charges: number
  discount: number
  finalPrice: number
}

export function normalizeUnitPricingConfig(
  raw: Partial<UnitPricingConfig> | null | undefined,
): UnitPricingConfig {
  const toWholeNumber = (value: unknown, fallback: number) => {
    if (typeof value === "number" && Number.isInteger(value)) return value
    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Number(value)
      if (Number.isInteger(parsed)) return parsed
    }
    return fallback
  }

  return {
    pricePerSqft: Math.max(0, toWholeNumber(raw?.pricePerSqft ?? 0, 0)),
    developmentCharge: Math.max(
      0,
      toWholeNumber(raw?.developmentCharge ?? 0, 0),
    ),
    cornerPremium: Math.max(0, toWholeNumber(raw?.cornerPremium ?? 0, 0)),
    parkFacingPremium: Math.max(
      0,
      toWholeNumber(raw?.parkFacingPremium ?? 0, 0),
    ),
    floorPremium: Math.max(0, toWholeNumber(raw?.floorPremium ?? 0, 0)),
    discount: Math.max(0, toWholeNumber(raw?.discount ?? 0, 0)),
  }
}

export function calculateUnitPriceBreakdown({
  sizeSqft,
  basePrice,
  pricing,
}: {
  sizeSqft: number
  basePrice: number
  pricing?: Partial<UnitPricingConfig> | null
}): UnitPriceBreakdown {
  const config = normalizeUnitPricingConfig(pricing)

  const sizePrice = Math.max(0, sizeSqft) * config.pricePerSqft
  const effectiveBasePrice =
    basePrice > 0 ? Math.max(0, basePrice) : Math.max(0, sizePrice)

  const developmentCharge = config.developmentCharge
  const cornerPremium = config.cornerPremium
  const parkFacingPremium = config.parkFacingPremium
  const floorPremium = config.floorPremium
  const charges =
    developmentCharge + cornerPremium + parkFacingPremium + floorPremium
  const discount = config.discount
  const finalPrice = Math.max(0, effectiveBasePrice + charges - discount)

  return {
    basePrice: effectiveBasePrice,
    sizePrice,
    developmentCharge,
    cornerPremium,
    parkFacingPremium,
    floorPremium,
    charges,
    discount,
    finalPrice,
  }
}

/**
 * Custom attributes are how a unit states the things this schema does not have a
 * column for: bedrooms on an apartment, road frontage on a plot, a private pool
 * on a villa. The set differs per project and per unit type, which is the whole
 * reason it is data and not more columns.
 */
export const UNIT_ATTRIBUTE_MAX = 12
export const UNIT_ATTRIBUTE_KEY_MAX = 40
export const UNIT_ATTRIBUTE_VALUE_MAX = 120

export function isUnitSize(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= UNIT_SIZE_MIN &&
    value <= UNIT_SIZE_MAX
  )
}

export function isUnitPrice(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= UNIT_PRICE_MIN &&
    value <= UNIT_PRICE_MAX
  )
}

/** One custom attribute, as the wire and the table both hold it. */
export interface UnitAttribute {
  key: string

  value: string
}

/**
 * A pair of attributes that cannot both exist on one unit.
 *
 * The rule is case-insensitive because "Bedrooms" and "bedrooms" are the same
 * fact stated twice, and a user scrolling a list of attributes should not have to
 * know which spelling won.
 */
export function findAttributeKeyClash(
  attributes: readonly UnitAttribute[],
  candidate: UnitAttribute,
  ignoreIndex = -1,
): number {
  const wanted = candidate.key.trim().toLowerCase()

  return attributes.findIndex(
    (attribute, index) =>
      index !== ignoreIndex &&
      attribute.key.trim().toLowerCase() === wanted &&
      wanted !== "",
  )
}
