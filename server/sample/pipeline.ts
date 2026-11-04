/**
 * The sales funnel for the demo dataset: pipeline vocabulary, leads, their
 * activity trail, customers and quotations.
 *
 * Eighty leads sit across the seven built-in stages, fifty-one customers carry
 * nominee details, and forty-five quotations point at real units. Sources use
 * the app's own lead-source vocabulary so the pipeline filters group them the
 * way a real workspace's would, and the campaign text carries the channel the
 * brief names (Facebook, a property expo, a dealer).
 *
 * Every person is invented: a Pakistani name from a pool, a `0300-555xxxx`
 * mobile, an all-zero CNIC body, and `@example.com` mail.
 */

import { run } from "../db.ts"

import {
  dayMinus,
  demoId,
  fakeCnic,
  fakePhone,
  seqId,
  stamp,
  write,
  type CustomerSeed,
  type Demo,
  type LeadSeed,
  type StageSeed,
  type UnitSeed,
  type Weighted,
} from "./common.ts"

/** Mirrors `DEFAULT_LEAD_STAGES` in `shared/leads.ts`. */

const STAGES: StageSeed[] = [
  { key: "new", label: "New", tone: "neutral", sort: 0 },

  { key: "contacted", label: "Contacted", tone: "info", sort: 1 },

  { key: "qualified", label: "Qualified", tone: "info", sort: 2 },

  { key: "site_visit", label: "Site Visit", tone: "warning", sort: 3 },

  { key: "negotiation", label: "Negotiation", tone: "warning", sort: 4 },

  { key: "won", label: "Won", tone: "success", sort: 5 },

  { key: "lost", label: "Lost", tone: "danger", sort: 6 },
]

/** How the eighty leads fall across the stages. */

const STAGE_PLAN: Weighted<string>[] = [
  { item: "new", weight: 12 },

  { item: "contacted", weight: 12 },

  { item: "qualified", weight: 11 },

  { item: "site_visit", weight: 9 },

  { item: "negotiation", weight: 8 },

  { item: "won", weight: 18 },

  { item: "lost", weight: 10 },
]

const LEAD_TOTAL = 80

const DIRECT_CUSTOMERS = 32

/**
 * The channel vocabulary the routes use, so a filter on the pipeline tab finds
 * these rows. The brief's names are carried in the campaign text instead:
 * Facebook sits under social media, a dealer under broker, the expo under
 * campaign.
 */

interface SourceSpec {
  source: string

  campaigns: string[]

  weight: number
}

const SOURCES: SourceSpec[] = [
  {
    source: "Social media",

    weight: 26,

    campaigns: [
      "Facebook - Spring Plots Campaign",

      "Facebook - Meridian Towers Launch",

      "Instagram Reels - Rowan Valley",
    ],
  },

  {
    source: "Walk-in",

    weight: 18,

    campaigns: ["Site office walk-in"],
  },

  {
    source: "Referral",

    weight: 16,

    campaigns: ["Referral Drive - Friends & Family"],
  },

  {
    source: "Broker",

    weight: 14,

    campaigns: ["Channel partner intro"],
  },

  {
    source: "Website",

    weight: 16,

    campaigns: ["Web enquiry - amna-traders.example.com"],
  },

  {
    source: "Campaign",

    weight: 10,

    campaigns: ["Autumn Property Fair 2026", "Property Expo stall - Lahore"],
  },
]

/** Leads per month, eleven months back to the current one: a soft season with a
 * double peak around the spring and autumn launches rather than a flat line. */

const LEAD_MONTH_WEIGHTS = [5, 4, 6, 9, 11, 12, 8, 5, 7, 10, 9, 7]

const LOST_REASONS = [
  "Price above stated budget",

  "Purchased in a competing scheme",

  "Not reachable after two follow-ups",

  "Deferred the purchase to next year",

  "Rejected the payment plan length",

  "Location did not suit the family",
]

const MALE_NAMES = [
  "Tariq",

  "Bilal",

  "Usman",

  "Faisal",

  "Adeel",

  "Shahid",

  "Kamran",

  "Naveed",

  "Zeeshan",

  "Junaid",

  "Waqas",

  "Salman",

  "Fawad",

  "Asad",

  "Daniyal",

  "Arshad",

  "Ovais",

  "Rizwan",

  "Nadeem",

  "Taimur",
]

const FEMALE_NAMES = [
  "Ayesha",

  "Fatima",

  "Sana",

  "Rabia",

  "Nadia",

  "Sadia",

  "Hina",

  "Zainab",

  "Mehak",

  "Farah",

  "Bushra",

  "Iqra",

  "Laiba",

  "Humaira",

  "Kinza",

  "Maryam",

  "Nazia",

  "Samina",

  "Shazia",

  "Uzma",
]

const FAMILY_NAMES = [
  "Ahmed",

  "Khan",

  "Malik",

  "Chaudhry",

  "Sheikh",

  "Qureshi",

  "Baloch",

  "Raza",

  "Aslam",

  "Iqbal",

  "Baig",

  "Warraich",

  "Farooq",

  "Siddiqui",

  "Afridi",

  "Kakar",

  "Lashari",

  "Memon",

  "Sethi",

  "Anjum",
]

const RELATIONSHIPS = [
  "Spouse",
  "Son",
  "Daughter",
  "Brother",
  "Father",
  "Mother",
]

const CITIES: Weighted<string>[] = [
  { item: "Karachi", weight: 45 },

  { item: "Lahore", weight: 30 },

  { item: "Rawalpindi", weight: 12 },

  { item: "Hyderabad", weight: 7 },

  { item: "Multan", weight: 6 },
]

const NEIGHBOURHOODS = [
  "Sunrise Colony",

  "Citrus Town",

  "Greenbelt Phase 2",

  "Baharan Vista",

  "Rowan Park Road",

  "Palm Grove Lane",
]

const NOTE_BODIES = [
  "Called back the enquiry; wants the payment plan in writing before a visit.",

  "Comparing two plots on the same sector; price sentiment is the blocker.",

  "Confirmed budget and possession timeline; needs the plan approved by family.",

  "Visited the site with the family; asked for a corner unit list.",

  "Asked whether the booking can be split between two installments plans.",

  "Wants the corner premium waived; escalating the discount request.",

  "Requested the possession date in writing before signing.",

  "Sourced from the dealer network; commission terms already shared.",
]

/** Writes the pipeline vocabulary, the leads, the customers and the quotations. */

export function seedPipeline(demo: Demo): void {
  ensureStages(demo)

  seedLeads(demo)

  seedCustomers(demo)

  seedQuotations(demo)
}

/**
 * The seven built-in stages, using the same deterministic ids the routes use.
 *
 * These are not registered as demo rows: they are configuration the application
 * writes for itself the first time anyone opens the pipeline, so removing the
 * demo dataset leaves a working vocabulary behind rather than a broken one.
 */

function ensureStages(demo: Demo): void {
  for (const stage of STAGES) {
    run(
      `INSERT INTO lead_stages (
         id, tenant_id, stage_key, label, tone, sort_order, is_builtin,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
       ON CONFLICT (tenant_id, stage_key) DO NOTHING`,

      `stage_${demo.tenantId}_${stage.key}`,

      demo.tenantId,

      stage.key,

      stage.label,

      stage.tone,

      stage.sort,

      stamp(demo.today, 320, 9),

      stamp(demo.today, 320, 9),
    )
  }
}

function seedLeads(demo: Demo): void {
  const weightedMonths: Weighted<number>[] = LEAD_MONTH_WEIGHTS.map(
    (weight, index) => ({ item: index, weight }),
  )

  const sourceChoices: Weighted<SourceSpec>[] = SOURCES.map((spec) => ({
    item: spec,

    weight: spec.weight,
  }))

  const statuses = planStatuses(demo)

  for (let index = 0; index < LEAD_TOTAL; index += 1) {
    const id = demoId(demo, "led", index + 1)

    const status = statuses[index] ?? "new"

    const source = demo.rand.weighted(sourceChoices)

    const monthIndex = demo.rand.weighted(weightedMonths)

    const createdDaysAgo = Math.max(
      0,

      325 - monthIndex * 28 - demo.rand.int(0, 27),
    )

    const created = stamp(demo.today, createdDaysAgo, demo.rand.int(9, 19))

    const agent = demo.agents[index % Math.max(1, demo.agents.length)]

    const dealer =
      source.source === "Broker"
        ? demo.dealers[index % Math.max(1, demo.dealers.length)]
        : undefined

    const fullName = personName(index)

    const budgetLow = demo.rand.money(3_500_000, 12_000_000)

    const budgetHigh = budgetLow + demo.rand.money(2_000_000, 9_000_000)

    const project = demo.projects[index % Math.max(1, demo.projects.length)]

    const campaign = demo.rand.pick(source.campaigns)

    const campaignRow = demo.campaigns.find((row) =>
      campaign.startsWith(row.name.slice(0, 12)),
    )

    const followUp = followUpDate(demo, status, createdDaysAgo)

    write(demo, "leads", id, () =>
      run(
        `INSERT INTO leads (
           id, tenant_id, full_name, phone, email, source, campaign,
           project_interest, budget_min, budget_max, assigned_agent_id,
           status, follow_up_date, lost_reason, customer_id, created_by,
           created_at, updated_at, assigned_dealer_id, campaign_id
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,

        id,

        demo.tenantId,

        fullName,

        fakePhone(demo, 100 + index),

        emailFor(fullName, index),

        source.source,

        campaign,

        project?.name ?? "",

        budgetLow,

        budgetHigh,

        agent?.userId ?? null,

        status,

        followUp,

        status === "lost" ? LOST_REASONS[index % LOST_REASONS.length] : null,

        agent?.userId ?? demo.actorUserId,

        created,

        stamp(demo.today, Math.max(0, createdDaysAgo - 20), 15),

        dealer ? dealerId(demo, index) : null,

        campaignRow?.id ?? null,
      ),
    )

    writeLeadTrail(
      demo,
      id,
      fullName,
      status,
      createdDaysAgo,
      agent?.userId ?? null,
    )

    const seed: LeadSeed = {
      id,

      fullName,

      status,

      agentUserId: agent?.userId ?? demo.actorUserId,

      customerId: null,
    }

    demo.leads.push(seed)

    if (status === "won") demo.wonLeads.push(seed)

    if (status === "lost" && seed.id) {
      demo.lostReasons.set(
        seed.id,

        LOST_REASONS[index % LOST_REASONS.length] ?? "Not stated",
      )
    }
  }
}

/** The dealer a broker-sourced lead belongs to, cycled in order. */

function dealerId(demo: Demo, index: number): string | null {
  return demo.dealers[index % Math.max(1, demo.dealers.length)]?.id ?? null
}

/** The stage list, in the exact counts the plan calls for, shuffled. */

function planStatuses(demo: Demo): string[] {
  const out: string[] = []

  for (const bucket of STAGE_PLAN) {
    for (let i = 0; i < bucket.weight; i += 1) out.push(bucket.item)
  }

  while (out.length < LEAD_TOTAL) out.push("contacted")

  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = demo.rand.int(0, i)

    const swap = out[i]!

    out[i] = out[j]!

    out[j] = swap
  }

  return out
}

/**
 * Follow-ups only make sense on a live lead. A share of them is already due and
 * a share land today, which is what the "overdue follow-ups" figure on the
 * dashboard needs to be non-zero and honest.
 */

function followUpDate(
  demo: Demo,

  status: string,

  createdDaysAgo: number,
): string | null {
  if (status === "won" || status === "lost") return null

  // A lead captured this week cannot have an overdue follow-up yet.

  if (createdDaysAgo < 6) return dayMinus(demo.today, -demo.rand.int(1, 14))

  const roll = demo.rand.int(1, 10)

  if (roll <= 2) return demo.today

  if (roll <= 5) {
    return dayMinus(demo.today, demo.rand.int(1, Math.min(24, createdDaysAgo)))
  }

  return dayMinus(demo.today, -demo.rand.int(1, 21))
}

/** The activity trail: creation, the stage moves that got it here, and notes. */

function writeLeadTrail(
  demo: Demo,

  leadId: string,

  fullName: string,

  status: string,

  createdDaysAgo: number,

  actorUserId: string | null,
): void {
  const actorName =
    (actorUserId ? demo.userNames.get(actorUserId) : null) ?? "Sales desk"

  const order = STAGES.map((stage) => stage.key)

  const reached = Math.max(0, order.indexOf(status))

  const steps =
    status === "lost" ? demo.rand.int(1, Math.max(1, reached - 1)) : reached

  activity(
    demo,
    leadId,
    "created",
    `Lead ${fullName} captured on the pipeline.`,
    null,
    "new",
    actorUserId,
    actorName,
    stamp(demo.today, createdDaysAgo, 10),
  )

  let from = "new"

  for (let step = 1; step <= steps; step += 1) {
    const to = order[Math.min(order.length - 1, step)] ?? "contacted"

    if (to === from) continue

    activity(
      demo,
      leadId,
      "stage_changed",
      `Stage moved from ${labelOf(from)} to ${labelOf(to)}.`,
      from,
      to,
      actorUserId,
      actorName,
      stamp(demo.today, Math.max(0, createdDaysAgo - step * 7), 12),
    )

    from = to
  }

  if (status === "lost") {
    const reason =
      LOST_REASONS[Math.abs(createdDaysAgo) % LOST_REASONS.length] ??
      "Not stated"

    activity(
      demo,
      leadId,
      "stage_changed",
      `Closed as lost: ${reason.toLowerCase()}.`,
      from,
      "lost",
      actorUserId,
      actorName,
      stamp(demo.today, Math.max(0, createdDaysAgo - 25), 16),
    )
  }

  const notes = demo.rand.int(1, 2)

  for (let note = 0; note < notes; note += 1) {
    activity(
      demo,
      leadId,
      "note_added",
      NOTE_BODIES[(createdDaysAgo + note * 3) % NOTE_BODIES.length] ??
        "Follow-up noted.",
      null,
      null,
      actorUserId,
      actorName,
      stamp(demo.today, Math.max(0, createdDaysAgo - 10 - note * 6), 14),
    )
  }
}

/** One pipeline activity row, registered under the id it is stored with. */

function activity(
  demo: Demo,

  leadId: string,

  type: string,

  body: string,

  fromStage: string | null,

  toStage: string | null,

  actorUserId: string | null,

  actorName: string,

  at: string,
): void {
  const id = seqId(demo, "lact")

  write(demo, "lead_activities", id, () =>
    run(
      `INSERT INTO lead_activities (
         id, tenant_id, lead_id, activity_type, body, from_stage, to_stage,
         actor_user_id, actor_name, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,

      id,

      demo.tenantId,

      leadId,

      type,

      body,

      fromStage,

      toStage,

      actorUserId,

      actorName,

      at,
    ),
  )
}

function labelOf(key: string): string {
  return STAGES.find((stage) => stage.key === key)?.label ?? key
}

/**
 * Customers, converted from the won leads plus the workspace's own walk-in
 * bookers. The last row is deliberately kept free of bookings: it is the
 * transferee the demo transfer moves a unit to.
 */

function seedCustomers(demo: Demo): void {
  const won = demo.wonLeads

  const total = won.length + DIRECT_CUSTOMERS + 1

  for (let index = 0; index < total; index += 1) {
    const id = demoId(demo, "cus", index + 1)

    const lead = index < won.length ? won[index]! : null

    const fullName = lead ? lead.fullName : personName(LEAD_TOTAL + index)

    const city = demo.rand.weighted(CITIES)

    const createdDaysAgo = lead
      ? Math.max(2, demo.rand.int(5, 300))
      : demo.rand.int(30, 340)

    const nominee = personName(300 + index)

    const relationship = demo.rand.pick(RELATIONSHIPS)

    write(demo, "customers", id, () =>
      run(
        `INSERT INTO customers (
           id, tenant_id, source_lead_id, full_name, phone, email,
           address_line1, address_line2, city, state_region, postal_code,
           country, id_document_type, id_document_number,
           id_issuing_authority, id_issue_date, id_expiry_date,
           nominee_name, nominee_relationship, nominee_phone, nominee_email,
           next_of_kin_name, next_of_kin_relationship, next_of_kin_phone,
           next_of_kin_email, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pakistan', 'CNIC', ?,
           'NADRA', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,

        id,

        demo.tenantId,

        lead?.id ?? null,

        fullName,

        fakePhone(demo, 200 + index),

        emailFor(fullName, 200 + index),

        `House ${10 + (index % 80)}, ${demo.rand.pick(NEIGHBOURHOODS)}`,

        null,

        city,

        regionFor(city),

        postalFor(city),

        fakeCnic(index + 1, cnicRegion(city)),

        dayMinus(demo.today, demo.rand.int(900, 3200)),

        dayMinus(demo.today, -demo.rand.int(400, 1800)),

        nominee,

        relationship,

        fakePhone(demo, 500 + index),

        emailFor(nominee, 500 + index),

        relationship === "Spouse" ? nominee : personName(700 + index),

        relationship === "Spouse" ? "Spouse" : "Brother",

        fakePhone(demo, 800 + index),

        null,

        stamp(demo.today, createdDaysAgo, 11),

        stamp(demo.today, Math.max(0, createdDaysAgo - 30), 11),
      ),
    )

    const seed: CustomerSeed = {
      id,

      fullName,

      leadId: lead?.id ?? null,
    }

    demo.customers.push(seed)

    if (lead) {
      lead.customerId = id

      run(
        `UPDATE leads SET customer_id = ?, updated_at = ? WHERE tenant_id = ? AND id = ?`,

        id,

        stamp(demo.today, createdDaysAgo, 11),

        demo.tenantId,

        lead.id,
      )

      activity(
        demo,

        lead.id,

        "converted",

        `Lead converted: customer record opened for ${fullName}.`,

        "negotiation",

        "won",

        lead.agentUserId,

        demo.userNames.get(lead.agentUserId) ?? "Sales desk",

        stamp(demo.today, createdDaysAgo, 11),
      )
    }
  }
}

/**
 * Forty-five quotations against real units. The split follows the server's own
 * arithmetic - an even base with the remainder carried by the first lines - so
 * the document a user opens adds up to the figures stored beside it.
 */

function seedQuotations(demo: Demo): void {
  const pool: UnitSeed[] = demo.units

  for (let index = 0; index < 45; index += 1) {
    const id = demoId(demo, "quo", index + 1)

    const unit = pool[(index * 17 + 5) % pool.length]!

    const customer = demo.customers[index % Math.max(1, demo.customers.length)]!

    const lead = customer.leadId
      ? (demo.leads.find((row) => row.id === customer.leadId) ?? null)
      : null

    const issuedDaysAgo = Math.max(2, demo.rand.int(3, 280))

    const downPaymentPercent = demo.rand.pick([20, 25, 30])

    const installmentCount = demo.rand.pick([6, 12, 18, 24])

    const discountType = demo.rand.chance(0.5) ? "percent" : "fixed"

    const discountValue =
      discountType === "percent"
        ? demo.rand.pick([1, 2, 3])
        : demo.rand.money(100_000, 500_000)

    const discountAmount =
      discountType === "percent"
        ? Math.round((unit.price * discountValue) / 100)
        : discountValue

    const total = unit.price - discountAmount

    const downPayment = Math.round((total * downPaymentPercent) / 100)

    const balance = total - downPayment

    const base = Math.floor(balance / installmentCount)

    const remainder = balance % installmentCount

    const paymentPlan = JSON.stringify([
      { label: `Down payment (${downPaymentPercent}%)`, amount: downPayment },

      ...Array.from({ length: installmentCount }, (_, position) => ({
        label: `Installment ${position + 1}`,

        amount: base + (position < remainder ? 1 : 0),
      })),
    ])

    const agent = demo.agents[index % Math.max(1, demo.agents.length)]

    write(demo, "unit_quotations", id, () =>
      run(
        `INSERT INTO unit_quotations (
           id, tenant_id, project_id, unit_id, lead_id, customer_id,
           quote_number, unit_code, lead_name, customer_name,
           issued_by_user_id, issued_by_name, issued_at, base_price,
           discount_type, discount_value, discount_amount, extra_charges,
           total, down_payment_percent, installment_count, payment_plan,
           notes, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)`,

        id,

        demo.tenantId,

        unit.projectId,

        unit.id,

        lead?.id ?? null,

        customer.id,

        `AT-Q-${String(1000 + index + 1)}`,

        unit.code,

        lead?.fullName ?? null,

        customer.fullName,

        agent?.userId ?? demo.actorUserId,

        agent?.fullName ?? demo.actorName,

        stamp(demo.today, issuedDaysAgo, 13),

        unit.price,

        discountType,

        discountValue,

        discountAmount,

        total,

        downPaymentPercent,

        installmentCount,

        paymentPlan,

        "Quotation issued from the demo dataset.",

        stamp(demo.today, issuedDaysAgo, 13),

        stamp(demo.today, issuedDaysAgo, 13),
      ),
    )
  }
}

function personName(index: number): string {
  const female = index % 3 === 2

  const first = female
    ? FEMALE_NAMES[index % FEMALE_NAMES.length]
    : MALE_NAMES[index % MALE_NAMES.length]

  const family = FAMILY_NAMES[(index * 7 + 3) % FAMILY_NAMES.length]

  return `${first} ${family}`
}

/** Builds a fictional mailbox from the person's own name. */

function emailFor(fullName: string, index: number): string {
  const slug = fullName
    .toLowerCase()
    .replace(/[^a-z]+/g, ".")
    .replace(/^\.|\.$/g, "")

  return `${slug}.${index}@example.com`
}

function regionFor(city: string): string {
  if (city === "Karachi") return "Sindh"

  if (city === "Lahore") return "Punjab"

  if (city === "Hyderabad") return "Sindh"

  return "Punjab"
}

function postalFor(city: string): string {
  if (city === "Karachi") return "74000"

  if (city === "Lahore") return "54000"

  if (city === "Rawalpindi") return "46000"

  if (city === "Hyderabad") return "71000"

  return "60000"
}

/** The CNIC area code that belongs to the city, kept fictional in the body. */

function cnicRegion(city: string): string {
  if (city === "Karachi") return "42101"

  if (city === "Hyderabad") return "41301"

  if (city === "Lahore") return "35202"

  if (city === "Multan") return "31004"

  return "37401"
}
