/**
 * Projects, structure and unit inventory for the demo dataset.
 *
 * Three fictional projects at three life stages, sized so the inventory donut
 * reads like a working business:
 *
 *  * Rowan Valley Gardens - 120 residential plots, mostly sold.
 *  * Meridian Heights Residency - 90 apartments over three towers and eight
 *    floors, partly sold.
 *  * Palm Grove Enclave - 40 units in pre-launch, almost all available.
 *
 * Project names, developers, addresses and localities are invented; none of them
 * names a real society or developer.
 *
 * A unit's stored status is written as the status it should *end* in, and
 * `money.ts` creates the matching booking against exactly those units. That is
 * what makes "unit status matches its booking state" true without either builder
 * rewriting the other's rows. The status trail in `inventory_unit_status_history`
 * is split the same way: this file writes the opening row and the manual
 * reservations/holds, the booking builder writes the moves a booking causes.
 */

import { get, getDb, run } from "../db.ts"

import { seedInventoryCategoryOptions } from "../inventory-seed.ts"

import {
  dayMinus,
  seqId,
  stamp,
  track,
  write,
  type Demo,
  type ProjectSeed,
  type UnitSeed,
  type Weighted,
} from "./common.ts"

import {
  amenitiesFor,
  fallbackCategory,
  nextShowcase,
  squareFeetFor,
  type ShowcaseCursor,
  type ShowcaseZone,
  type UnitCategorySeed,
} from "./categories.ts"

/** Square feet in one marla at this fictional scale. */

const MARLA_SQFT = 225

/**
 * Above this footprint the demo quotes a bulk rate instead of the leaf's own.
 *
 * Only a classification written in kanal or acre gets this large - a warehouse, a factory
 * plot, a piece of farmland - and none of them is worth tower money per square foot.
 */
const BULK_SIZE_SQFT = 6_000

const BULK_RATE_SQFT = 900

interface ProjectSpec {
  name: string

  code: string

  developer: string

  location: string

  status: string

  projectType: string

  ownershipType: string

  description: string

  paymentTerms: string

  plannedUnits: number

  launchedDaysAgo: number

  handoverDaysAhead: number
}

const PROJECTS: ProjectSpec[] = [
  {
    name: "Rowan Valley Gardens",

    code: "RVG",

    developer: "Rowan Valley Developers",

    location: "Sunrise Road, Malir, Karachi",

    status: "on_sale",

    projectType: "residential",

    ownershipType: "freehold",

    description:
      "Gated residential plot scheme on a forty-acre tract. Fictional project created by the demo seeder.",

    paymentTerms: "20% down payment, balance in 12 monthly installments.",

    plannedUnits: 120,

    launchedDaysAgo: 330,

    handoverDaysAhead: 210,
  },

  {
    name: "Meridian Heights Residency",

    code: "MHR",

    developer: "Meridian Construction Partners",

    location: "Citrus Town, Valencia Road, Lahore",

    status: "on_sale",

    projectType: "residential",

    ownershipType: "leasehold",

    description:
      "Three towers of apartments; structure is published per tower and per floor. Fictional project created by the demo seeder.",

    paymentTerms: "25% down payment, balance quarterly over 24 months.",

    plannedUnits: 90,

    launchedDaysAgo: 300,

    handoverDaysAhead: 540,
  },

  {
    name: "Palm Grove Enclave",

    code: "PGE",

    developer: "Palm Grove Builders",

    location: "Green Belt, Kallar Kahar Road, Rawalpindi",

    status: "pre_launch",

    projectType: "mixed_use",

    ownershipType: "freehold",

    description:
      "Pre-launch phase of small plots and a low-rise block. Fictional project created by the demo seeder.",

    paymentTerms: "10% booking amount when sales open.",

    plannedUnits: 40,

    launchedDaysAgo: 75,

    handoverDaysAhead: 720,
  },
]

/**
 * The per-project status mix. 112 of the 250 units end sold or booked (44.8%),
 * 25 reserved (10%), 13 on hold (5.2%) and 100 available. Applied per project,
 * not portfolio-wide, so no project card shows an impossible shape: A is mostly
 * sold, B is partly sold, C has nothing committed yet.
 */

interface StatusPlan {
  sold: number

  booked: number

  reserved: number

  hold: number
}

const STATUS_PLANS: StatusPlan[] = [
  { sold: 54, booked: 18, reserved: 8, hold: 5 },

  { sold: 18, booked: 22, reserved: 10, hold: 5 },

  { sold: 0, booked: 0, reserved: 7, hold: 3 },
]

/** One leaf of the structure tree, and how many units hang off it. */

interface GroupSpec {
  kind: string

  name: string

  /** Tower or sector letter used in the unit code, e.g. "A4" for Tower A level 4. */

  short: string

  parent?: string

  count: number

  plot: boolean

  rateLow: number

  rateHigh: number

  level: number
}

const PLOT_MARLA: Weighted<number>[] = [
  { item: 5, weight: 40 },

  { item: 7, weight: 25 },

  { item: 10, weight: 20 },

  { item: 15, weight: 10 },

  { item: 20, weight: 5 },
]

const PGE_PLOT_MARLA: Weighted<number>[] = [
  { item: 5, weight: 65 },

  { item: 7, weight: 35 },
]

const APARTMENT_SIZES: Weighted<number>[] = [
  { item: 850, weight: 22 },

  { item: 1150, weight: 28 },

  { item: 1450, weight: 24 },

  { item: 1850, weight: 18 },

  { item: 2400, weight: 8 },
]

const PGE_APARTMENT_SIZES: Weighted<number>[] = [
  { item: 850, weight: 30 },

  { item: 1150, weight: 40 },

  { item: 1450, weight: 30 },
]

/** Per-floor unit counts: four on most levels, three on the two upper ones. */

const TOWER_FLOORS = [4, 4, 4, 4, 4, 3, 3, 4]

function projectGroups(index: number): GroupSpec[] {
  if (index === 0) {
    return [
      {
        kind: "sector",

        name: "Sector A",

        short: "A",

        count: 32,

        plot: true,

        rateLow: 3300,

        rateHigh: 3600,

        level: 0,
      },

      {
        kind: "sector",

        name: "Sector B",

        short: "B",

        count: 30,

        plot: true,

        rateLow: 3100,

        rateHigh: 3350,

        level: 0,
      },

      {
        kind: "sector",

        name: "Sector C",

        short: "C",

        count: 28,

        plot: true,

        rateLow: 2900,

        rateHigh: 3150,

        level: 0,
      },

      {
        kind: "sector",

        name: "Sector D",

        short: "D",

        count: 30,

        plot: true,

        rateLow: 3350,

        rateHigh: 3600,

        level: 0,
      },
    ]
  }

  if (index === 1) {
    const groups: GroupSpec[] = []

    for (const letter of ["A", "B", "C"]) {
      groups.push({
        kind: "block",

        name: `Tower ${letter}`,

        short: letter,

        count: 0,

        plot: false,

        rateLow: 0,

        rateHigh: 0,

        level: 0,
      })

      TOWER_FLOORS.forEach((count, position) => {
        const level = position + 1

        groups.push({
          kind: "floor",

          name: `Level ${level}`,

          short: `${letter}${level}`,

          parent: `Tower ${letter}`,

          count,

          plot: false,

          rateLow: 10_000 + level * 300,

          rateHigh: 10_800 + level * 300,

          level,
        })
      })
    }

    return groups
  }

  return [
    {
      kind: "sector",

      name: "Phase 1",

      short: "1",

      count: 16,

      plot: true,

      rateLow: 3000,

      rateHigh: 3300,

      level: 0,
    },

    {
      kind: "block",

      name: "Block A",

      short: "A",

      count: 0,

      plot: false,

      rateLow: 0,

      rateHigh: 0,

      level: 0,
    },

    {
      kind: "floor",

      name: "Level 1",

      short: "A1",

      parent: "Block A",

      count: 12,

      plot: false,

      rateLow: 10_000,

      rateHigh: 10_400,

      level: 1,
    },

    {
      kind: "floor",

      name: "Level 2",

      short: "A2",

      parent: "Block A",

      count: 12,

      plot: false,

      rateLow: 10_300,

      rateHigh: 10_800,

      level: 2,
    },
  ]
}

/** Where the demo dataset draws a booking unit from, per project. */

interface UnitKnobs {
  marla: Weighted<number>[]

  sizes: Weighted<number>[]
}

function projectKnobs(index: number): UnitKnobs {
  return {
    marla: index === 2 ? PGE_PLOT_MARLA : PLOT_MARLA,

    sizes: index === 2 ? PGE_APARTMENT_SIZES : APARTMENT_SIZES,
  }
}

interface NodeRef {
  id: string

  kind: string

  name: string

  short: string

  parentName: string

  rateLow: number

  rateHigh: number

  level: number

  plot: boolean
}

/**
 * Makes sure the workspace holds the vocabulary the unit rows are about to name.
 *
 * A workspace gets its category lists at signup, and migration 0054 filled the tenants
 * that already existed; both paths leave this demo workspace with the shipped lists. The
 * gap that does exist is a database where the workspace was made by hand, and a unit
 * classified with a word the tenant's pickers do not hold then reads as a dash in every
 * filter chip and document. The seed is `INSERT OR IGNORE`, so a workspace that renamed
 * "Apartment" to "Flat" keeps its own word.
 *
 * Vocabulary is configuration, not business data: like the tenant profile these rows are
 * deliberately not registered as sample data, and they stay when the demo is removed.
 */
function ensureCategoryOptions(demo: Demo): void {
  const row = get<{ n: number }>(
    "SELECT COUNT(*) AS n FROM inventory_category_options WHERE tenant_id = ?",

    demo.tenantId,
  )

  if ((row?.n ?? 0) > 0) return

  seedInventoryCategoryOptions(getDb(), demo.tenantId, new Date().toISOString())
}

/** Writes the three projects, their structure, and every unit row. */

export function seedInventory(demo: Demo): void {
  ensureCategoryOptions(demo)

  // One walk across all three projects, so a showcase classification is handed out once
  // and the coverage claim in `categories.ts` stays countable.
  const cursor: ShowcaseCursor = { plot: [], street: [], tower: [] }

  PROJECTS.forEach((spec, index) => {
    const project = createProject(demo, spec)

    const groups = projectGroups(index)

    const nodes = createNodes(demo, project, groups, spec.launchedDaysAgo)

    const units = createUnits(
      demo,

      project,

      index,

      groups,

      nodes,

      spec.launchedDaysAgo,

      cursor,

      spec.ownershipType,
    )

    writeOpeningHistory(demo, units)

    demo.projects.push(project)

    demo.units.push(...units)
  })

  // The pool the booking builder consumes: every unit that ends sold or booked,

  // plus two available units that will carry the cancellation story and return to

  // available. Shuffled so projects and price bands interleave across the months.

  const committed = demo.units.filter(
    (unit) => unit.status === "sold" || unit.status === "booked",
  )

  const cancellable = demo.units

    .filter((unit) => unit.status === "available" && unit.projectCode !== "PGE")

    .slice(0, 2)

  demo.available.push(...shuffle(demo, committed), ...cancellable)
}

function shuffle<T>(demo: Demo, items: T[]): T[] {
  const out = [...items]

  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = demo.rand.int(0, i)

    const swap = out[i]!

    out[i] = out[j]!

    out[j] = swap
  }

  return out
}

function createProject(demo: Demo, spec: ProjectSpec): ProjectSeed {
  const id = seqId(demo, "prj")

  const created = stamp(demo.today, spec.launchedDaysAgo, 9)

  write(demo, "projects", id, () =>
    run(
      `INSERT INTO projects (
         id, tenant_id, name, code, developer, location, status, launch_date,
         description, project_type, ownership_type, payment_terms,
         handover_date, planned_units, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,

      id,

      demo.tenantId,

      spec.name,

      spec.code,

      spec.developer,

      spec.location,

      spec.status,

      dayMinus(demo.today, spec.launchedDaysAgo),

      spec.description,

      spec.projectType,

      spec.ownershipType,

      spec.paymentTerms,

      dayMinus(demo.today, -spec.handoverDaysAhead),

      spec.plannedUnits,

      created,

      stamp(demo.today, 3, 17),
    ),
  )

  return { id, name: spec.name, code: spec.code, status: spec.status }
}

/**
 * Identity of a structure node inside one project. A floor name repeats across
 * towers ("Level 1" in Tower A and in Tower B), so the parent has to be part of
 * the key or the second tower's units would land on the first tower's node and
 * duplicate its unit codes.
 */

function nodeKey(parent: string | undefined, name: string): string {
  return parent ? `${parent}>${name}` : name
}

/** Parents first, then their floors: a child resolves its parent by name. */

function createNodes(
  demo: Demo,

  project: ProjectSeed,

  groups: GroupSpec[],

  launchedDaysAgo: number,
): Map<string, NodeRef> {
  const refs = new Map<string, NodeRef>()

  const created = stamp(demo.today, launchedDaysAgo - 4, 11)

  groups.forEach((spec) => {
    const id = seqId(demo, "node")

    write(demo, "project_structure_nodes", id, () =>
      run(
        `INSERT INTO project_structure_nodes (
           id, tenant_id, project_id, parent_id, kind, name, sort_order,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,

        id,

        demo.tenantId,

        project.id,

        spec.parent
          ? (refs.get(nodeKey(undefined, spec.parent))?.id ?? null)
          : null,

        spec.kind,

        spec.name,

        refs.size,

        created,

        created,
      ),
    )

    refs.set(nodeKey(spec.parent, spec.name), {
      id,

      kind: spec.kind,

      name: spec.name,

      short: spec.short,

      parentName: spec.parent ?? "",

      rateLow: spec.rateLow,

      rateHigh: spec.rateHigh,

      level: spec.level,

      plot: spec.plot,
    })
  })

  return refs
}

/**
 * Every unit under its leaf node. Statuses are decided for the whole project at
 * once and shuffled, so the sold units are not clumped at the start of the sheet
 * and a card never shows one tower fully sold while the next is empty.
 */

function createUnits(
  demo: Demo,

  project: ProjectSeed,

  index: number,

  groups: GroupSpec[],

  nodes: Map<string, NodeRef>,

  launchedDaysAgo: number,

  cursor: ShowcaseCursor,

  ownershipType: string,
): UnitSeed[] {
  const leaves = groups.filter((group) => group.count > 0)

  const total = leaves.reduce((sum, group) => sum + group.count, 0)

  const statuses = statusOrder(demo, index, total)

  const knobs = projectKnobs(index)

  const out: UnitSeed[] = []

  let position = 0

  for (const group of leaves) {
    const node = nodes.get(nodeKey(group.parent, group.name))

    if (!node) {
      position += group.count

      continue
    }

    for (let serial = 1; serial <= group.count; serial += 1) {
      const status = statuses[position] ?? "available"

      position += 1

      out.push(
        createUnit(
          demo,

          project,

          knobs,

          node,

          serial,

          status,

          position,

          launchedDaysAgo,

          cursor,

          ownershipType,
        ),
      )
    }
  }

  return out
}

function statusOrder(demo: Demo, index: number, total: number): string[] {
  const plan = STATUS_PLANS[index] ?? {
    sold: 0,
    booked: 0,
    reserved: 0,
    hold: 0,
  }

  const buckets: Weighted<string>[] = [
    { item: "sold", weight: plan.sold },

    { item: "booked", weight: plan.booked },

    { item: "reserved", weight: plan.reserved },

    { item: "hold", weight: plan.hold },
  ]

  const out: string[] = []

  for (const bucket of buckets) {
    for (let i = 0; i < bucket.weight; i += 1) out.push(bucket.item)
  }

  while (out.length < total) out.push("available")

  return shuffle(demo, out)
}

/** The address a unit inherits from its scheme, looked up by project code. */

function projectLocation(code: string): string {
  return PROJECTS.find((spec) => spec.code === code)?.location ?? ""
}

/**
 * How many units at the front of a leaf take a showcase classification.
 *
 * Three is enough for every leaf to offer its own corner/park/boulevard variant, and the
 * plot and street leaves together hold more slots than the showcase has entries, so the
 * whole walk is placed before the fallback vocabulary runs out of leaves to try.
 */
const SHOWCASE_SLOTS = 3

/** Words a size reads with on a location line, keyed by the shipped size-unit key. */
const SIZE_WORDS: Record<string, string> = {
  marla: "marla",

  kanal: "kanal",

  acre: "acre",

  square_feet: "sq ft",

  square_yard: "sq yd",
}

function sizeLabel(category: UnitCategorySeed): string {
  return `${category.sizeValue} ${SIZE_WORDS[category.sizeUnit] ?? "sq ft"}`
}

/** A unit's classification and the amenities that go with it. */
interface Classified {
  category: UnitCategorySeed

  amenities: string[]
}

/** The leaf facts a classification is chosen from. */
interface ClassifyInput {
  node: NodeRef

  serial: number

  position: number

  cursor: ShowcaseCursor

  committed: boolean

  preLaunch: boolean

  ownership: string

  marla: number

  sizeSqft: number

  corner: boolean

  parkFacing: boolean
}

/**
 * This unit's classification.
 *
 * The first units of a leaf take the next showcase entry that fits the leaf, which is what
 * puts every property type, sub-type, usage, furnishing level, sale mode, possession
 * status, ownership type, size unit and amenity in front of the filters at least once.
 * Everything else is classified from what the seeder already knows about the leaf, so a
 * plot with a corner premium really is a corner plot and a chip for it finds the row.
 */
function classifyUnit(input: ClassifyInput): Classified {
  const { node, serial, cursor, committed, preLaunch } = input

  // Land sits on a plot leaf, trade on the levels a buyer can walk into, and a home
  // above them; see `zoneOf` for why the split is made this way.
  const zone: ShowcaseZone = node.plot
    ? "plot"
    : node.level <= 2
      ? "street"
      : "tower"

  const pick =
    serial <= SHOWCASE_SLOTS ? nextShowcase(cursor, zone, committed) : null

  if (!pick) {
    const derived = fallbackCategory({
      plot: node.plot,

      preLaunch,

      ownership: input.ownership,

      marla: input.marla,

      sizeSqft: input.sizeSqft,

      serial,

      position: input.position,

      corner: input.corner,

      parkFacing: input.parkFacing,

      level: node.level,

      committed,
    })

    return { category: derived.category, amenities: derived.amenities }
  }

  return {
    // A pre-launch scheme cannot offer a key yet, whatever the entry was written with.
    category: preLaunch
      ? { ...pick.entry, possession: "off_plan" }
      : pick.entry,

    amenities: amenitiesFor(pick.index, pick.entry.land),
  }
}

function createUnit(
  demo: Demo,

  project: ProjectSeed,

  knobs: UnitKnobs,

  node: NodeRef,

  serial: number,

  status: string,

  position: number,

  launchedDaysAgo: number,

  cursor: ShowcaseCursor,

  ownershipType: string,
): UnitSeed {
  const id = seqId(demo, "unit")

  const naturalMarla = node.plot ? demo.rand.weighted(knobs.marla) : 0

  const naturalSqft = node.plot
    ? naturalMarla * MARLA_SQFT
    : demo.rand.weighted(knobs.sizes)

  const cornerPremium = demo.rand.chance(0.12)
    ? node.plot
      ? 400_000
      : 150_000
    : 0

  const parkFacingPremium = demo.rand.chance(0.15)
    ? node.plot
      ? 300_000
      : 120_000
    : 0

  const discount = demo.rand.chance(0.08)
    ? Math.round(demo.rand.money(50_000, 300_000) / 1000) * 1000
    : 0

  const { category, amenities } = classifyUnit({
    node,

    serial,

    position,

    cursor,

    committed: status === "sold" || status === "booked",

    preLaunch: project.status === "pre_launch",

    ownership: ownershipType,

    marla: naturalMarla,

    sizeSqft: naturalSqft,

    corner: cornerPremium > 0,

    parkFacing: parkFacingPremium > 0,
  })

  // The showcase quotes in marla, kanal and acre; a derived classification already says
  // the same thing in the leaf's own unit. Either way `size_sqft` and `size_value` are
  // two readings of one figure, which is what the form's live conversion expects.
  const sizeSqft = squareFeetFor(category)

  const rate = unitRate(demo, node, sizeSqft)

  const base = Math.round(sizeSqft * rate)

  const developmentCharge = node.plot
    ? Math.round(sizeSqft * 90) + 180_000
    : 350_000

  const floorPremium = node.plot ? 0 : node.level * 25_000

  const price =
    base +
    developmentCharge +
    cornerPremium +
    parkFacingPremium +
    floorPremium -
    discount

  const code = `${project.code}-${node.short}-${String(serial).padStart(
    node.plot ? 3 : 2,

    "0",
  )}`

  const location = node.plot
    ? `${sizeLabel(category)} ${
        category.legacy === "plot" ? "plot" : "property"
      }, ${node.name}, ${projectLocation(project.code)}`
    : `${node.name}, ${node.parentName || "Block"}, ${project.name}`

  // A unit is never published before its scheme, and the sheet fills in over the

  // first few weeks rather than all on launch day.

  const created = stamp(
    demo.today,

    Math.max(10, launchedDaysAgo - 2 - (position % 20)),

    9,
  )

  const pricingConfig = JSON.stringify({
    pricePerSqft: rate,

    developmentCharge,

    cornerPremium,

    parkFacingPremium,

    floorPremium,

    discount,
  })

  write(demo, "inventory_units", id, () =>
    run(
      `INSERT INTO inventory_units (
         id, tenant_id, project_id, structure_node_id, unit_code, unit_type,
         location, size_sqft, base_price, pricing_config, status,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,

      id,

      demo.tenantId,

      project.id,

      node.id,

      code,

      category.legacy,

      location,

      sizeSqft,

      base,

      pricingConfig,

      status,

      created,

      stamp(demo.today, 2, 16),
    ),
  )

  writeClassification(
    demo,
    id,
    code,
    category,
    amenities,
    {
      address: node.plot
        ? `${node.name}, ${projectLocation(project.code)}`
        : `${
            node.parentName ? `${node.parentName}, ` : ""
          }${node.name}, ${project.name}`,

      areaCity: projectLocation(project.code)
        .split(",")
        .slice(-2)
        .join(",")
        .trim(),
    },
    created,
  )

  return {
    id,

    projectId: project.id,

    projectName: project.name,

    projectCode: project.code,

    code,

    type: category.legacy,

    price,

    status,

    created,
  }
}

/** Where the unit is, in the words the classification columns store. */
interface UnitPlace {
  address: string

  areaCity: string
}

/**
 * The twenty-five classification columns, plus the amenity and media children.
 *
 * Written as an `UPDATE` after the insert rather than twenty-five more placeholders inside
 * it, because the column order then does not have to match a placeholder order across
 * thirty-odd arguments, and a mistake in a name is visible in the statement itself. The
 * children are deliberately not registered in `dashboard_sample_rows`:
 * `inventory_unit_amenities` has no `tenant_id` for a removal to key on, and both tables
 * cascade from `inventory_units`, so the unit row the registry does know about takes them
 * with it.
 */
function writeClassification(
  demo: Demo,

  unitId: string,

  code: string,

  category: UnitCategorySeed,

  amenities: readonly string[],

  place: UnitPlace,

  at: string,
): void {
  run(
    `UPDATE inventory_units
        SET property_type = ?, usage_category = ?, property_subtype = ?, furnishing = ?,
            sale_mode = ?, possession = ?, ownership = ?, ownership_notes = ?,
            size_value = ?, size_unit = ?, bedrooms = ?, bathrooms = ?, kitchens = ?,
            lounges = ?, floors_count = ?, floor_number = ?, parking = ?, facing = ?,
            property_view = ?, age_years = ?, address = ?, area_city = ?, latitude = ?,
            longitude = ?, description = ?
      WHERE id = ? AND tenant_id = ?`,

    category.propertyType,

    category.usage,

    category.subtype,

    category.furnishing,

    category.saleMode,

    category.possession,

    category.ownership,

    category.ownershipNotes,

    category.sizeValue,

    category.sizeUnit,

    category.bedrooms,

    category.bathrooms,

    category.kitchens,

    category.lounges,

    category.floorsCount,

    category.floorNumber,

    category.parking,

    category.facing,

    category.view,

    category.ageYears,

    category.address ?? place.address,

    category.areaCity ?? place.areaCity,

    category.latitude,

    category.longitude,

    category.description,

    unitId,

    demo.tenantId,
  )

  for (const key of amenities) {
    run(
      `INSERT INTO inventory_unit_amenities (unit_id, amenity_key, created_at)
       VALUES (?, ?, ?)`,

      unitId,

      key,

      at,
    )
  }

  writeMedia(demo, unitId, code, category, at)
}

/** An invented listing shot: a flat SVG, inlined the way the tenant logo is. */
function placeholderHref(caption: string, tint: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420` +
    `" viewBox="0 0 640 420"><rect width="640" height="420" fill="${tint}"/>` +
    `<path d="M0 330 L190 210 L330 300 L470 190 L640 310 L640 420 L0 420 Z" ` +
    `fill="#10b981" opacity="0.30"/><circle cx="524" cy="86" r="38" ` +
    `fill="#10b981" opacity="0.45"/><text x="32" y="58" fill="#e2e8f0" ` +
    `font-family="monospace" font-size="26">${caption}</text><text x="32" y="392" ` +
    `fill="#94a3b8" font-family="monospace" font-size="17">Sample image - not a ` +
    `real listing photograph</text></svg>`

  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

/** The photos, floor plan and tour link a showcase entry claims for its unit. */
function writeMedia(
  demo: Demo,

  unitId: string,

  code: string,

  category: UnitCategorySeed,

  at: string,
): void {
  const tints = ["#0f172a", "#1e293b", "#334155", "#475569"]

  const photos = Math.max(0, Math.trunc(category.photos))

  for (let index = 0; index < photos; index += 1) {
    run(
      `INSERT INTO inventory_unit_media (
         id, tenant_id, unit_id, kind, href, label, is_main, sort_order, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,

      seqId(demo, "media"),

      demo.tenantId,

      unitId,

      "photo",

      placeholderHref(
        `${code} - view ${index + 1}`,
        tints[index % tints.length] ?? "#334155",
      ),

      index === 0 ? "Front elevation" : `View ${index + 1}`,

      index === 0 ? 1 : 0,

      index,

      at,
    )
  }

  if (category.floorPlan) {
    run(
      `INSERT INTO inventory_unit_media (
         id, tenant_id, unit_id, kind, href, label, is_main, sort_order, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,

      seqId(demo, "media"),

      demo.tenantId,

      unitId,

      "floor_plan",

      placeholderHref(`${code} - floor plan`, "#1e293b"),

      "Floor plan",

      0,

      photos,

      at,
    )
  }

  if (category.video) {
    run(
      `INSERT INTO inventory_unit_media (
         id, tenant_id, unit_id, kind, href, label, is_main, sort_order, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,

      seqId(demo, "media"),

      demo.tenantId,

      unitId,

      "video",

      `https://videos.example.com/deedorbit-demo/${code.toLowerCase()}`,

      "Site walkthrough",

      0,

      photos + (category.floorPlan ? 1 : 0),

      at,
    )
  }
}

/**
 * A rate per square foot for the unit. Larger apartments are listed at a slightly
 * gentler rate, which keeps the penthouse band inside the price ceiling the
 * inventory sheet advertises instead of drifting past it.
 *
 * A warehouse, a factory plot or an acre of farmland is a different trade again: the
 * square footage is enormous and the rate per foot is low, so the demo quotes them on a
 * bulk rate rather than on the tower rate, which would list a shed for three hundred
 * million and flatten every chart beside it.
 */

function unitRate(demo: Demo, node: NodeRef, sizeSqft: number): number {
  const low = node.rateLow

  const high = node.rateHigh

  const bulk = sizeSqft > BULK_SIZE_SQFT

  if (high <= low) return bulk ? Math.min(low, BULK_RATE_SQFT) : low

  const rate = Math.round(demo.rand.int(low, high) / 50) * 50

  const capped = sizeSqft >= 2200 ? Math.min(rate, 12_000) : rate

  return bulk ? Math.min(capped, BULK_RATE_SQFT) : capped
}

/**
 * The opening row for every unit, plus the manual moves this file owns.
 *
 * A reserved unit was pulled aside by the agent who took the site visit; a held
 * unit is a project-office decision recorded by the project manager. Both name a
 * seeded person, so the trail is auditable inside the demo itself.
 */

function writeOpeningHistory(demo: Demo, units: UnitSeed[]): void {
  const agent = demo.agents[0]

  const manager = demo.managers[0]

  const pm = demo.roleUsers.get("project_manager")?.[0]

  units.forEach((unit) => {
    const openingId = seqId(demo, "hist")

    track(demo, "inventory_unit_status_history", openingId)

    run(
      `INSERT INTO inventory_unit_status_history (
         id, tenant_id, project_id, unit_id, from_status, to_status,
         changed_by_user_id, changed_by_name, source, note, changed_at
       ) VALUES (?, ?, ?, ?, NULL, 'available', ?, ?, 'system',
         'Published with the inventory sheet.', ?)`,

      openingId,

      demo.tenantId,

      unit.projectId,

      unit.id,

      pm ?? demo.actorUserId,

      pm ? (demo.userNames.get(pm) ?? demo.actorName) : demo.actorName,

      unit.created,
    )

    if (unit.status !== "reserved" && unit.status !== "hold") return

    const moveId = seqId(demo, "hist")

    const actor = unit.status === "reserved" ? agent : manager

    const note =
      unit.status === "reserved"
        ? "Unit reserved after a site visit; buyer to confirm the booking."
        : "Unit placed on hold pending NOC verification."

    track(demo, "inventory_unit_status_history", moveId)

    run(
      `INSERT INTO inventory_unit_status_history (
         id, tenant_id, project_id, unit_id, from_status, to_status,
         changed_by_user_id, changed_by_name, source, note, changed_at
       ) VALUES (?, ?, ?, ?, 'available', ?, ?, ?, 'manual', ?, ?)`,

      moveId,

      demo.tenantId,

      unit.projectId,

      unit.id,

      unit.status,

      actor?.userId ?? demo.actorUserId,

      actor?.fullName ?? demo.actorName,

      note,

      stamp(demo.today, demo.rand.int(5, 220), 14),
    )
  })
}
