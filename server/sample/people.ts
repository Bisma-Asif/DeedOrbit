/**
 * People, places and partners for the demo dataset.
 *
 * The workspace profile is configuration rather than business data, so it is
 * written with the tenant's own columns and the two branches are registered demo
 * rows like everything else. The seeded staff are demo logins with a shared
 * temporary password; a workspace's own accounts are never read or changed.
 */

import { run } from "../db.ts"

import { hashPassword } from "../crypto.ts"

import {
  dayMinus,
  demoEmail,
  demoId,
  fakePhone,
  monthOf,
  stamp,
  track,
  write,
  type Demo,
} from "./common.ts"

/** The temporary password every demo login shares. Stated in the final report. */

export const DEMO_PASSWORD = "Amna-Demo-2026"

interface PersonSeed {
  handle: string

  fullName: string

  roleId: string

  jobTitle: string

  branch: string
}

/**
 * Fourteen seeded accounts: the owner and admin the workspace needs to run the
 * demo, two sales managers over six agents, two recovery officers, one accounts
 * officer and one project manager. Names are invented; none of them is a real
 * person.
 */

export const PEOPLE: PersonSeed[] = [
  {
    handle: "owner",

    fullName: "Yasmin Iqbal",

    roleId: "tenant_owner",

    jobTitle: "Director",

    branch: "hq",
  },

  {
    handle: "admin",

    fullName: "Kashif Sheikh",

    roleId: "tenant_admin",

    jobTitle: "Operations Manager",

    branch: "hq",
  },

  {
    handle: "manager1",

    fullName: "Farhan Chaudhry",

    roleId: "sales_manager",

    jobTitle: "Sales Manager - Plots",

    branch: "hq",
  },

  {
    handle: "manager2",

    fullName: "Sana Baloch",

    roleId: "sales_manager",

    jobTitle: "Sales Manager - Towers",

    branch: "branch",
  },

  {
    handle: "agent1",

    fullName: "Tariq Mehmood",

    roleId: "sales_agent",

    jobTitle: "Sales Consultant",

    branch: "hq",
  },

  {
    handle: "agent2",

    fullName: "Nadia Aslam",

    roleId: "sales_agent",

    jobTitle: "Senior Sales Consultant",

    branch: "hq",
  },

  {
    handle: "agent3",

    fullName: "Bilal Raza",

    roleId: "sales_agent",

    jobTitle: "Sales Consultant",

    branch: "hq",
  },

  {
    handle: "agent4",

    fullName: "Sadia Iqbal",

    roleId: "sales_agent",

    jobTitle: "Sales Consultant",

    branch: "branch",
  },

  {
    handle: "agent5",

    fullName: "Usman Qureshi",

    roleId: "sales_agent",

    jobTitle: "Associate Sales Consultant",

    branch: "branch",
  },

  {
    handle: "agent6",

    fullName: "Ayesha Sundar",

    roleId: "sales_agent",

    jobTitle: "Sales Consultant",

    branch: "hq",
  },

  {
    handle: "recovery1",

    fullName: "Imran Ghauri",

    roleId: "recovery_officer",

    jobTitle: "Recovery Officer",

    branch: "hq",
  },

  {
    handle: "recovery2",

    fullName: "Rabia Baig",

    roleId: "recovery_officer",

    jobTitle: "Recovery Officer",

    branch: "branch",
  },

  {
    handle: "accounts",

    fullName: "Zeeshan Anwar",

    roleId: "accounts_officer",

    jobTitle: "Accounts Officer",

    branch: "hq",
  },

  {
    handle: "projects",

    fullName: "Daniyal Malik",

    roleId: "project_manager",

    jobTitle: "Project Manager",

    branch: "hq",
  },
]

interface DealerSpec {
  company: string

  contact: string

  handle: string

  city: string

  pct: number

  scope: string
}

const DEALERS: DealerSpec[] = [
  {
    company: "Chenab Estates Consultants",

    contact: "Moiz Lashari",

    handle: "dealer1",

    city: "Karachi",

    pct: 2,

    scope: "plot",
  },

  {
    company: "Ravi Property Partners",

    contact: "Shazia Kamal",

    handle: "dealer2",

    city: "Lahore",

    pct: 2.5,

    scope: "apartment",
  },

  {
    company: "Hunaijin Trade Links",

    contact: "Arif Kakar",

    handle: "dealer3",

    city: "Rawalpindi",

    pct: 3,

    scope: "plot",
  },
]

const CAMPAIGN_NAMES: Array<string> = [
  "Spring Plots Campaign",

  "Skyline Towers Launch",

  "Referral Drive - Friends & Family",

  "Autumn Property Fair 2026",
]

const CAMPAIGN_SOURCES: Array<string> = [
  "Social media",

  "Website",

  "Referral",

  "Campaign",
]

interface VendorSpec {
  name: string

  contact: string

  city: string

  trade: string
}

const VENDORS: VendorSpec[] = [
  {
    name: "Al-Mehrab Construction Co.",

    contact: "Naveed Anjum",

    city: "Karachi",

    trade: "civil works",
  },

  {
    name: "Chenab Builders & Suppliers",

    contact: "Waqas Dar",

    city: "Lahore",

    trade: "structure",
  },

  {
    name: "Faisal Materials Traders",

    contact: "Adnan Sethi",

    city: "Karachi",

    trade: "materials",
  },

  {
    name: "Sunbeam Signage & Print",

    contact: "Bushra Jamali",

    city: "Karachi",

    trade: "marketing",
  },

  {
    name: "Iqbal Legal Consultants",

    contact: "Advocate S. Iqbal",

    city: "Karachi",

    trade: "legal",
  },

  {
    name: "Karachi Office Supplies Ltd",

    contact: "Haris Warraich",

    city: "Karachi",

    trade: "office",
  },

  {
    name: "PowerCare Facilities Services",

    contact: "Salman Awan",

    city: "Lahore",

    trade: "facilities",
  },

  {
    name: "GreenScape Landscape Contractors",

    contact: "Farzana Rajput",

    city: "Rawalpindi",

    trade: "landscape",
  },
]

/**
 * Profile, branches, staff, partners, campaigns and vendors.
 *
 * Returns nothing: everything the later domains need is published on `demo`.
 */

export function seedWorkspace(demo: Demo): void {
  seedTenantProfile(demo)

  const branchIds = seedBranches(demo)

  const people = seedUsers(demo, branchIds)

  seedTeamsAndTargets(demo, people)

  seedDealers(demo)

  seedCampaigns(demo)

  seedVendors(demo)
}

/**
 * The workspace's own identity: PKR, Pakistan time, a fictional registered
 * address. This is an UPDATE of the tenant row - settings, not business data -
 * so it is not registered for removal. The values it replaces are printed by the
 * seed script, and nothing here touches a column a user has already filled with
 * their own detail except the currency and timezone the demo needs.
 */

function seedTenantProfile(demo: Demo): void {
  run(
    `UPDATE tenants
        SET legal_name = COALESCE(legal_name, ?),
            registration_number = COALESCE(registration_number, ?),
            tax_id = COALESCE(tax_id, ?),
            address_line1 = COALESCE(address_line1, ?),
            address_line2 = COALESCE(address_line2, ?),
            city = COALESCE(city, ?),
            state_region = COALESCE(state_region, ?),
            postal_code = COALESCE(postal_code, ?),
            country_code = COALESCE(country_code, ?),
            phone = COALESCE(phone, ?),
            collections_email = COALESCE(collections_email, ?),
            currency = ?,
            timezone = ?,
            fiscal_year_start_month = ?,
            updated_at = ?
      WHERE id = ?`,

    "Amna Traders (Private) Limited",

    "AMN-TRD-0041882",

    "NTN 4188273-6",

    "2nd Floor, Sunrise Plaza, Shahbaz Commercial Area",

    "Main Shahrah-e-Faisal",

    "Karachi",

    "Sindh",

    "74000",

    "PK",

    "+92 21 555 0142",

    "collections@amna-traders.example.com",

    demo.currency,

    demo.timezone,

    1,

    stamp(demo.today, 0, 8),

    demo.tenantId,
  )
}

function seedBranches(demo: Demo): Map<string, string> {
  const specs = [
    {
      key: "hq",

      name: "Head Office - Karachi",

      code: "HQ",

      hq: 1,

      line1: "2nd Floor, Sunrise Plaza, Shahbaz Commercial Area",

      city: "Karachi",

      region: "Sindh",

      postal: "74000",

      phone: "+92 21 555 0142",

      email: "head.office@amna-traders.example.com",
    },

    {
      key: "branch",

      name: "Lahore Branch",

      code: "LHR-01",

      hq: 0,

      line1: "Office 5, Citrus Terrace, Valencia Road",

      city: "Lahore",

      region: "Punjab",

      postal: "54000",

      phone: "+92 42 555 0177",

      email: "lahore@amna-traders.example.com",
    },
  ]

  const ids = new Map<string, string>()

  specs.forEach((spec, index) => {
    const id = demoId(demo, "brn", index + 1)

    write(demo, "branches", id, () =>
      run(
        `INSERT INTO branches (
           id, tenant_id, name, code, is_headquarters, address_line1,
           address_line2, city, state_region, postal_code, country_code,
           phone, email, status, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, 'PK', ?, ?, 'active', ?, ?)`,

        id,

        demo.tenantId,

        spec.name,

        spec.code,

        spec.hq,

        spec.line1,

        spec.city,

        spec.region,

        spec.postal,

        spec.phone,

        spec.email,

        stamp(demo.today, 330, 9),

        stamp(demo.today, 330, 9),
      ),
    )

    ids.set(spec.key, id)
  })

  return ids
}

interface SeededPeople {
  byRole: Map<string, string[]>

  nameById: Map<string, string>
}

function seedUsers(demo: Demo, branchIds: Map<string, string>): SeededPeople {
  const hash = hashPassword(DEMO_PASSWORD)

  const byRole = new Map<string, string[]>()

  const nameById = new Map<string, string>()

  const handleById = new Map<string, string>()

  const created = dayMinus(demo.today, 300)

  PEOPLE.forEach((person, index) => {
    const id = demoId(demo, "usr", index + 1)

    const email = demoEmail(demo, person.handle)

    write(demo, "users", id, () =>
      run(
        `INSERT INTO users (
           id, tenant_id, email, full_name, phone, job_title, status,
           password_hash, password_changed_at, email_verified_at,
           twofa_enabled, failed_login_count, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, 0, 0, ?, ?)`,

        id,

        demo.tenantId,

        email,

        person.fullName,

        fakePhone(demo, index + 1),

        person.jobTitle,

        hash,

        stamp(demo.today, 300, 10),

        stamp(demo.today, 300, 10),

        `${created}T10:00:00.000Z`,

        stamp(demo.today, 60, 10),
      ),
    )

    run(
      `INSERT INTO tenant_memberships (tenant_id, user_id, role_id, is_default, created_at)
       VALUES (?, ?, ?, 1, ?)`,

      demo.tenantId,

      id,

      person.roleId,

      stamp(demo.today, 300, 10),
    )

    track(demo, "tenant_memberships", id)

    const branchId = branchIds.get(person.branch)

    if (branchId) {
      run(
        `INSERT INTO user_branches (tenant_id, user_id, branch_id, created_at)
         VALUES (?, ?, ?, ?)`,

        demo.tenantId,

        id,

        branchId,

        stamp(demo.today, 300, 10),
      )

      track(demo, "user_branches", id)
    }

    const list = byRole.get(person.roleId) ?? []

    list.push(id)

    byRole.set(person.roleId, list)

    nameById.set(id, person.fullName)

    handleById.set(id, person.handle)
  })

  demo.agents = (byRole.get("sales_agent") ?? []).map((userId, index) => ({
    userId,

    fullName: nameById.get(userId) ?? `Agent ${index + 1}`,

    teamId: "",
  }))

  demo.managers = (byRole.get("sales_manager") ?? []).map((userId) => ({
    userId,

    fullName: nameById.get(userId) ?? "Sales Manager",

    teamId: "",
  }))

  demo.officers = (byRole.get("recovery_officer") ?? []).map((userId) => ({
    userId,

    fullName: nameById.get(userId) ?? "Recovery Officer",

    teamId: "",
  }))

  demo.roleUsers = byRole

  demo.userNames = nameById

  demo.userHandles = handleById

  return { byRole, nameById }
}

/** Sales teams, per-agent monthly targets, and the recovery desk's targets. */

function seedTeamsAndTargets(demo: Demo, people: SeededPeople): void {
  const teamSpecs = [
    { name: "Plot Sales Team", manager: 0, agents: [0, 2, 4] },

    { name: "Tower Sales Team", manager: 1, agents: [1, 3, 5] },
  ]

  const teamIds: string[] = []

  teamSpecs.forEach((spec, index) => {
    const id = demoId(demo, "team", index + 1)

    const manager = people.byRole.get("sales_manager")?.[spec.manager] ?? null

    write(demo, "sales_teams", id, () =>
      run(
        `INSERT INTO sales_teams (id, tenant_id, name, manager_user_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,

        id,

        demo.tenantId,

        spec.name,

        manager,

        stamp(demo.today, 290, 11),

        stamp(demo.today, 290, 11),
      ),
    )

    teamIds.push(id)

    for (const offset of spec.agents) {
      const agent = people.byRole.get("sales_agent")?.[offset]

      if (!agent) continue

      run(
        `INSERT INTO sales_team_members (tenant_id, user_id, team_id, created_at)
         VALUES (?, ?, ?, ?)`,

        demo.tenantId,

        agent,

        id,

        stamp(demo.today, 290, 11),
      )

      track(demo, "sales_team_members", agent)
    }
  })

  // Monthly targets for the last twelve months, so the targets screen has a

  // history and the leaderboard can show an agent against their number.

  demo.agents.forEach((agent, agentIndex) => {
    const team = teamIds[agentIndex % teamIds.length] ?? ""

    agent.teamId = team

    for (let back = 11; back >= 0; back -= 1) {
      const period = monthOf(dayMinus(demo.today, back * 30 + 15))

      run(
        `INSERT INTO sales_agent_targets (
           tenant_id, user_id, period_month, leads_target, bookings_target,
           collections_target, updated_at, updated_by
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (tenant_id, user_id, period_month) DO NOTHING`,

        demo.tenantId,

        agent.userId,

        period,

        10 + agentIndex * 2,

        2 + (agentIndex % 3),

        4_000_000 + agentIndex * 750_000,

        stamp(demo.today, back * 30 + 15, 12),

        people.byRole.get("sales_manager")?.[0] ?? demo.actorUserId,
      )

      track(demo, "sales_agent_targets", `${agent.userId}:${period}`)
    }
  })

  demo.officers.forEach((officer, officerIndex) => {
    for (let back = 11; back >= 0; back -= 1) {
      const period = monthOf(dayMinus(demo.today, back * 30 + 15))

      const id = demoId(demo, "ctgt", officerIndex * 12 + (11 - back) + 1)

      write(demo, "collection_targets", id, () =>
        run(
          `INSERT INTO collection_targets (id, tenant_id, officer_user_id, period, target_amount, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (tenant_id, officer_user_id, period) DO NOTHING`,

          id,

          demo.tenantId,

          officer.userId,

          period,

          6_000_000 + demo.rand.int(0, 4) * 500_000,

          stamp(demo.today, back * 30 + 15, 12),
        ),
      )
    }
  })
}

/** Channel partners, each with a portal login and one commission rule. */

function seedDealers(demo: Demo): void {
  const hash = hashPassword(DEMO_PASSWORD)

  DEALERS.forEach((spec, index) => {
    const userId = demoId(demo, "usr", PEOPLE.length + index + 1)

    const email = demoEmail(demo, spec.handle)

    const dealerId = demoId(demo, "dlr", index + 1)

    const ruleId = demoId(demo, "drule", index + 1)

    // The partner's portal login is a staff-facing actor too, so it joins the

    // name and handle maps the later domains read from.

    demo.userNames.set(userId, spec.contact)

    demo.userHandles.set(userId, spec.handle)

    write(demo, "users", userId, () =>
      run(
        `INSERT INTO users (
           id, tenant_id, email, full_name, phone, job_title, status,
           password_hash, password_changed_at, email_verified_at,
           twofa_enabled, failed_login_count, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, 'Channel Partner', 'active', ?, ?, ?, 0, 0, ?, ?)`,

        userId,

        demo.tenantId,

        email,

        spec.contact,

        fakePhone(demo, 20 + index),

        hash,

        stamp(demo.today, 240, 10),

        stamp(demo.today, 240, 10),

        stamp(demo.today, 240, 10),

        stamp(demo.today, 120, 10),
      ),
    )

    run(
      `INSERT INTO tenant_memberships (tenant_id, user_id, role_id, is_default, created_at)
       VALUES (?, ?, 'dealer_partner', 1, ?)`,

      demo.tenantId,

      userId,

      stamp(demo.today, 240, 10),
    )

    track(demo, "tenant_memberships", userId)

    write(demo, "dealers", dealerId, () =>
      run(
        `INSERT INTO dealers (
           id, tenant_id, portal_user_id, company_name, contact_name, email,
           phone, business_registration, tax_id, address, notes, status,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,

        dealerId,

        demo.tenantId,

        userId,

        spec.company,

        spec.contact,

        email,

        fakePhone(demo, 40 + index),

        `REG-${1000 + index}`,

        `NTN ${2000001 + index}-1`,

        `${spec.city}, Pakistan`,

        "Fictional channel partner created by the demo seeder.",

        stamp(demo.today, 240, 10),

        stamp(demo.today, 20, 10),
      ),
    )

    run(
      `INSERT INTO dealer_commission_rules (
         id, tenant_id, dealer_id, scope, project_id, unit_type,
         commission_type, commission_value, created_at, updated_at
       ) VALUES (?, ?, ?, 'unit_type', NULL, ?, 'percentage', ?, ?, ?)`,

      ruleId,

      demo.tenantId,

      dealerId,

      spec.scope,

      spec.pct,

      stamp(demo.today, 240, 10),

      stamp(demo.today, 240, 10),
    )

    track(demo, "dealer_commission_rules", ruleId)

    demo.dealers.push({
      id: dealerId,

      name: spec.company,

      commissionPct: spec.pct,
    })
  })
}

function seedCampaigns(demo: Demo): void {
  CAMPAIGN_NAMES.forEach((name, index) => {
    const id = demoId(demo, "cmp", index + 1)

    write(demo, "campaigns", id, () =>
      run(
        `INSERT INTO campaigns (
           id, tenant_id, name, source, channel, webhook_token, active,
           notes, created_by_user_id, created_by_name, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`,

        id,

        demo.tenantId,

        name,

        CAMPAIGN_SOURCES[index] ?? "Other",

        index === 0 ? "social" : index === 1 ? "web" : "offline",

        `demo${demo.slug}${index}`.slice(0, 24),

        "Fictional campaign used by the demo lead pipeline.",

        demo.actorUserId,

        demo.actorName,

        stamp(demo.today, 300 - index * 20, 9),

        stamp(demo.today, 10, 9),
      ),
    )

    demo.campaigns.push({
      id,

      name,

      source: CAMPAIGN_SOURCES[index] ?? "Other",
    })
  })
}

function seedVendors(demo: Demo): void {
  VENDORS.forEach((spec, index) => {
    const id = demoId(demo, "vnd", index + 1)

    write(demo, "vendors", id, () =>
      run(
        `INSERT INTO vendors (
           id, tenant_id, name, contact_name, email, phone, tax_id,
           address_line1, address_line2, city, country_code, notes,
           status, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 'PK', ?, 'active', ?, ?)`,

        id,

        demo.tenantId,

        spec.name,

        spec.contact,

        `${demo.slug}.vendor${index + 1}@example.com`,

        fakePhone(demo, 60 + index),

        `NTN ${7000001 + index}-3`,

        `Plot ${index + 12}, Industrial Estate`,

        spec.city,

        `Fictional ${spec.trade} vendor.`,

        stamp(demo.today, 280 - index * 10, 9),

        stamp(demo.today, 5, 9),
      ),
    )

    demo.vendors.push({ id, name: spec.name })
  })
}
