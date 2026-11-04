/**
 * Idempotent seeding: the 11 roles, the module x action permission catalogue,
 * the platform default grants, and one demo workspace with a user per role so
 * every permission path can be exercised in the UI.
 *
 * Runs on every boot. Everything is `INSERT OR IGNORE` / upsert-by-primary-key,
 * so restarting never duplicates or clobbers a tenant's own edits.
 */

import {
  ACTION_HINTS,
  ACTION_LABELS,
  MODULE_LABELS,
  ROLES,
  defaultGrants,
} from "../shared/access.ts"

import { ACTIONS, MODULES, permissionId } from "../shared/access.ts"
import { BUILT_IN_UNIT_STATUSES } from "../shared/inventory.ts"
import {
  defaultTemplate,
  MESSAGE_CHANNELS,
  MESSAGE_LANGUAGES,
  TEMPLATE_KEYS,
} from "../shared/communications.ts"

import { PLAN_DEFINITIONS, planDefinition } from "../shared/platform.ts"

import { createHash } from "node:crypto"

import { hashPassword, hashToken } from "./crypto.ts"

import { all, get, getDb, run, transaction } from "./db.ts"

import { seedAllTenantsInventoryCategories } from "./inventory-seed.ts"

const DEMO_PASSWORD = "deedorbit-erp-2026"

export type SeedSummary = {
  roles: number

  permissions: number

  grants: number

  tenants: number

  users: number

  /** Status rows present across every workspace once the vocabulary is in place. */

  statuses: number

  /** Communication template rows present once the default bodies are seeded. */

  templates: number
}

export function seed(): SeedSummary {
  return transaction(() => {
    const now = new Date().toISOString()

    seedRoles(now)

    const { permissions: permissionCount, grants: grantCount } =
      seedPermissionCatalogue()

    const { tenants, users } = seedDemoWorkspace(now)

    const statusCount = seedUnitStatuses()

    seedCategoryVocabulary()

    const templateCount = seedMessageTemplates()

    return {
      roles: ROLES.length,

      permissions: permissionCount,

      grants: grantCount,

      tenants,

      users,

      statuses: statusCount,

      templates: templateCount,
    }
  })
}

/**
 * Gives every workspace the built-in property category vocabulary.
 *
 * The same argument as `seedUnitStatuses`, one migration later: migration 0054 backfills
 * the tenants that already existed when it ran, and the signup route seeds the one it
 * creates, but a workspace put in place by any other path — a fresh install, this file's
 * demo sweep — would otherwise open with nine empty dropdown lists and could not
 * classify its first unit. Idempotent for the same reason: `INSERT OR IGNORE`, so an
 * option an administrator has renamed or retired is left exactly as they set it.
 */
export function seedCategoryVocabulary(): void {
  seedAllTenantsInventoryCategories(getDb(), new Date().toISOString())
}

/**
 * Gives every workspace the built-in status vocabulary.
 *
 * This exists alongside the seed inside migration 0007 rather than instead of it,
 * because the two cover genuinely different cases and neither alone is enough.
 *
 * The migration's `INSERT ... FROM tenants` is the right way to backfill a database that
 * already had workspaces, but on a fresh install it runs before any tenant exists —
 * schema, then migrations, then seed — so it inserts nothing at all. This runs after
 * the workspaces exist and covers that case, and also covers a tenant created by
 * anything that is not the signup route.
 *
 * Idempotent by `INSERT OR IGNORE` against the unique `(tenant_id, key)` index, so a
 * status an administrator has since renamed or recoloured is left exactly as they set
 * it. Re-seeding must never overwrite a tenant's configuration, which is the one thing
 * a seed that "keeps things in sync" would be disastrous for.
 */
export function seedUnitStatuses(): number {
  const now = new Date().toISOString()

  for (const tenant of all<{ id: string }>("SELECT id FROM tenants")) {
    for (const status of BUILT_IN_UNIT_STATUSES) {
      run(
        `INSERT OR IGNORE INTO inventory_unit_statuses (
            id, tenant_id, key, label, tone, is_builtin, is_archived, sort_order,
            created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?, ?)`,

        `st_${tenant.id}_${status.key}`,

        tenant.id,

        status.key,

        status.label,

        status.tone,

        status.sortOrder,

        now,

        now,
      )
    }
  }

  // Reported as the total rather than as rows written, because `run` does not report
  // how many rows it changed and the distinction would mean nothing to a reader: what
  // matters is that every workspace ends up with the vocabulary.

  return (
    get<{ count: number }>(
      "SELECT count(*) AS count FROM inventory_unit_statuses",
    )?.count ?? 0
  )
}

/**
 * Seeds the default communication templates for every workspace.
 *
 * Insert-only against the `(tenant_id, channel, template_key, language)` primary
 * key, so a body an office has since edited is never overwritten on the next boot
 * — the one property a seed of user-editable configuration must have. Called both
 * from the demo seed and on every boot (see `seedCommunicationTemplates`), for the
 * same reason the permission catalogue is: a feature added after first install
 * would otherwise reach only new databases.
 *
 * The subject ships blank: a blank stored subject means "use the shipped default",
 * so an office that never touched the subject line keeps rendering exactly the
 * subject it renders today, byte for byte.
 */
function seedMessageTemplates(): number {
  const stamp = new Date().toISOString()

  for (const tenant of all<{ id: string }>("SELECT id FROM tenants")) {
    for (const channel of MESSAGE_CHANNELS) {
      for (const key of TEMPLATE_KEYS) {
        for (const language of MESSAGE_LANGUAGES) {
          run(
            `INSERT OR IGNORE INTO message_templates
               (tenant_id, channel, template_key, language, subject, body, enabled, updated_at)
             VALUES (?, ?, ?, ?, '', ?, 1, ?)`,

            tenant.id,

            channel,

            key,

            language,

            defaultTemplate(language, channel, key).body,

            stamp,
          )
        }
      }
    }
  }

  return (
    get<{ count: number }>("SELECT count(*) AS count FROM message_templates")
      ?.count ?? 0
  )
}

/** Boot-time re-seed of the template bodies. Idempotent; never clobbers an edit. */
export function seedCommunicationTemplates(): void {
  seedMessageTemplates()
}

/**
 * Platform billing demo data: one more workspace, a subscription row for every
 * tenant, and a relative-dated ledger behind each demo tenant's billing status.
 *
 * Same boot-level trap as the two functions above - `seed()` is skipped on an
 * already-installed database - so this is exported and called unconditionally.
 * Idempotency has two layers: the third workspace and the subscription backfill
 * are insert-only, and the ledger itself is guarded per tenant by "has any
 * platform_billing_events rows yet", so an operator's real mutations are never
 * duplicated or re-seeded on top.
 *
 * The three histories deliberately cover three distinct derived states:
 * DeedOrbit is paid-up (current), Meridian lapsed into suspension through a
 * grace window that expired (grace_expired, suspended), and Harbourline's
 * grace has just expired while still active (grace_expired) - the exact state
 * in which the platform area's Suspend action becomes available.
 */
export function seedPlatformBilling(): void {
  const now = new Date()

  const nowIso = now.toISOString()

  transaction(() => {
    if (
      !get<{ id: string }>(
        "SELECT id FROM tenants WHERE slug = ?",

        "harbourline-properties",
      )
    ) {
      run(
        `INSERT INTO tenants (
            id, name, legal_name, slug, status, plan, logo_initials,
            primary_color, timezone, currency, created_at, updated_at
         ) VALUES (?, ?, ?, ?, 'active', 'starter', 'HP', NULL, 'Asia/Dubai', 'AED', ?, ?)`,

        "tn_harbourline_properties",

        "Harbourline Properties",

        "Harbourline Properties LLC",

        "harbourline-properties",

        nowIso,

        nowIso,
      )

      // The vocabulary every workspace is entitled to: seed()'s own sweep ran
      // before this row existed, and signup only covers its own creation path,
      // so a demo tenant inserted here has to be picked up by the same
      // idempotent seeder rather than left status-less.
      seedUnitStatuses()

      seedCategoryVocabulary()
    }

    // Every tenant needs a subscription row so the directory reads real state
    // instead of a missing one; signups insert their own, this catches the rest.
    run(
      `INSERT OR IGNORE INTO tenant_subscriptions (
          tenant_id, billing_status, grace_ends_at, grace_reason, updated_at
       )
       SELECT id, 'current', NULL, NULL, ? FROM tenants`,

      nowIso,
    )

    seedBillingHistoryFor(
      now,

      "tn_deedorbit_holdings",

      "enterprise",

      "AED",

      [],
    )

    seedBillingHistoryFor(
      now,

      "tn_meridian_residences",

      "standard",

      "AED",

      [
        {
          billingStatus: "grace",

          // Granted 22 days ago for 10 days: the window closed 12 days ago.
          graceDaysAgo: 12,

          graceReason: "Extension requested pending investor disbursement",

          paidThrough: 2,

          dueDaysAgo: 24,

          graceGrantedDaysAgo: 22,

          graceDays: 10,

          suspended: true,
        },
      ],
    )

    seedBillingHistoryFor(
      now,

      "tn_harbourline_properties",

      "starter",

      "AED",

      [
        {
          billingStatus: "grace",

          // Granted 20 days ago for 18 days: the window closed 2 days ago,
          // which is what makes Suspend live for this workspace in the demo.
          graceDaysAgo: 2,

          graceReason: "Card payment failure; bank transfer promised",

          paidThrough: 1,

          dueDaysAgo: 25,

          graceGrantedDaysAgo: 20,

          graceDays: 18,

          suspended: false,
        },
      ],
    )
  })
}

interface BillingScenario {
  billingStatus: string

  /** When the grace window ends, in days before "now". Negative = in the future. */
  graceDaysAgo: number

  graceReason: string

  /** Number of monthly invoices that were paid; the next one goes unpaid. */
  paidThrough: number

  dueDaysAgo: number

  graceGrantedDaysAgo: number

  graceDays: number

  suspended: boolean
}

function seedBillingHistoryFor(
  now: Date,

  tenantId: string,

  plan: string,

  currency: string,

  scenarios: BillingScenario[],
): void {
  if (scenarios.length === 0) {
    // Paid-up tenants still get a short invoice/payment trail so the timeline
    // is never an empty list pretending to be a history.
    if (
      get<{ id: string }>(
        "SELECT id FROM platform_billing_events WHERE tenant_id = ? LIMIT 1",

        tenantId,
      )
    )
      return

    const definition = planDefinition(plan)

    if (!definition) return

    for (const [index, monthsAgo] of [3, 2, 1].entries()) {
      const issued = daysAgoIso(now, monthsAgo * 30 + 1)

      insertBillingEvent(
        tenantId,
        "invoice",
        definition.monthlyAmount,
        currency,
        `Monthly subscription - ${definition.label}`,
        issued,
        index * 2,
      )

      insertBillingEvent(
        tenantId,
        "payment",
        definition.monthlyAmount,
        currency,
        "Payment received",
        daysAgoIso(now, monthsAgo * 30 - 1),
        index * 2 + 1,
      )
    }

    return
  }

  for (const scenario of scenarios) {
    // Guard on the tenant's own ledger, not the file: whichever scenario ran
    // first on a fresh boot is irrelevant once rows exist.
    if (
      get<{ id: string }>(
        "SELECT id FROM platform_billing_events WHERE tenant_id = ? LIMIT 1",

        tenantId,
      )
    )
      return

    const definition = PLAN_DEFINITIONS[(plan as keyof typeof PLAN_DEFINITIONS)]

    if (!definition) return

    const amount = definition.monthlyAmount

    let seq = 0

    for (let paid = scenario.paidThrough; paid >= 1; paid -= 1) {
      const monthsAgo = paid + 1

      insertBillingEvent(
        tenantId,
        "invoice",
        amount,
        currency,
        `Monthly subscription - ${definition.label}`,
        daysAgoIso(now, monthsAgo * 30 + 1),
        seq++,
      )

      insertBillingEvent(
        tenantId,
        "payment",
        amount,
        currency,
        "Payment received",
        daysAgoIso(now, monthsAgo * 30 - 1),
        seq++,
      )
    }

    const unpaidAt = daysAgoIso(now, (scenario.paidThrough + 1) * 30 + 4)

    insertBillingEvent(
      tenantId,
      "invoice",
      amount,
      currency,
      `Monthly subscription - ${definition.label}`,
      unpaidAt,
      seq++,
    )

    insertBillingEvent(
      tenantId,
      "billing_due",
      null,
      currency,
      "Subscription payment marked overdue",
      daysAgoIso(now, scenario.dueDaysAgo),
      seq++,
    )

    insertBillingEvent(
      tenantId,

      "grace_granted",

      null,

      currency,

      `${scenario.graceDays} days of grace granted - ${scenario.graceReason}`,

      daysAgoIso(now, scenario.graceGrantedDaysAgo),

      seq++,
    )

    if (scenario.suspended) {
      insertBillingEvent(
        tenantId,
        "suspension",
        null,
        currency,
        "Workspace suspended after grace expiry",
        daysAgoIso(now, scenario.graceDaysAgo - 1),
        seq++,
      )
    }

    run(
      `UPDATE tenant_subscriptions
       SET billing_status = ?, grace_ends_at = ?, grace_reason = ?, updated_at = ?
       WHERE tenant_id = ?`,

      scenario.billingStatus,

      daysAgoIso(now, scenario.graceDaysAgo),

      scenario.graceReason,

      now.toISOString(),

      tenantId,
    )
  }
}

function daysAgoIso(now: Date, days: number): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString()
}

function insertBillingEvent(
  tenantId: string,

  kind: string,

  amount: number | null,

  currency: string,

  note: string,

  createdAt: string,

  seq: number,
): void {
  run(
    `INSERT INTO platform_billing_events (
        id, tenant_id, kind, amount, currency, note, actor_email, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO NOTHING`,

    `pbe_seed_${tenantId}_${kind}_${String(seq).padStart(2, "0")}`,

    tenantId,

    kind,

    amount,

    currency,

    note,

    "superadmin@deedorbit.com",

    createdAt,
  )
}

function seedRoles(now: string): void {
  for (const [index, role] of ROLES.entries()) {
    run(
      `INSERT INTO roles (role_id, label, scope, description, rank, is_assignable, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (role_id) DO UPDATE SET
         label = excluded.label,
         scope = excluded.scope,
         description = excluded.description,
         rank = excluded.rank`,

      role.id,

      role.label,

      role.scope,

      role.description,

      100 - index,

      // Platform scope is not handed out inside a tenant.

      role.scope === "tenant" ? 1 : 0,

      now,
    )
  }
}

/**
 * Writes the permission catalogue and the platform default grants.
 *
 * Exported and called on every boot rather than only from `seed()`, for the same
 * reason as `seedOrganizationDefaults` below: `seed()` is skipped once the demo
 * roles exist, which is the state of every already-installed workspace. A
 * permission added after the first install would otherwise be written to new
 * databases and to no other, leaving the grant absent for every role - and the
 * feature it gates answering 403 to the administrators it was built for.
 *
 * Idempotent by construction: the catalogue is upserted by primary key and the
 * grants are `ON CONFLICT DO NOTHING`. Both are defaults, and the resolver reads
 * `role_permission_overrides` *after* them, so a tenant that has since denied
 * something keeps the denial.
 */
export function seedPermissionCatalogue(): {
  permissions: number
  grants: number
} {
  return {
    permissions: seedPermissions(),

    grants: seedGrants(),
  }
}

function seedPermissions(): number {
  let order = 0

  for (const module of MODULES) {
    for (const action of ACTIONS) {
      const id = permissionId(module, action)

      run(
        `INSERT INTO permissions (permission_id, module_id, action, label, description, sort_order)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (permission_id) DO UPDATE SET
           label = excluded.label,
           description = excluded.description,
           sort_order = excluded.sort_order`,

        id,

        module,

        action,

        `${MODULE_LABELS[module]} — ${ACTION_LABELS[action]}`,

        `${ACTION_LABELS[action]} ${MODULE_LABELS[module].toLowerCase()}. ${ACTION_HINTS[action]}.`,

        order,
      )

      order += 1
    }
  }

  return order
}

function seedGrants(): number {
  let count = 0

  for (const grant of defaultGrants()) {
    for (const id of grant.permissionIds) {
      run(
        `INSERT INTO role_permission_defaults (role_id, permission_id)
         VALUES (?, ?)
         ON CONFLICT DO NOTHING`,

        grant.roleId,

        id,
      )

      count += 1
    }
  }

  return count
}

type DemoUser = {
  email: string

  fullName: string

  jobTitle: string

  roleId: string
}

const DEMO_USERS: DemoUser[] = [
  {
    email: "superadmin@deedorbit.com",

    fullName: "Farhan Qureshi",

    jobTitle: "Platform Operations Director",

    roleId: "platform_super_admin",
  },

  {
    email: "owner@deedorbit.com",

    fullName: "Amina Rahman",

    jobTitle: "Managing Director",

    roleId: "tenant_owner",
  },

  {
    email: "admin@deedorbit.com",

    fullName: "Nadia Farouk",

    jobTitle: "Head of Operations",

    roleId: "tenant_admin",
  },

  {
    email: "sales.manager@deedorbit.com",

    fullName: "Omar Haddad",

    jobTitle: "Sales Manager",

    roleId: "sales_manager",
  },

  {
    email: "sales.agent@deedorbit.com",

    fullName: "Priya Nair",

    jobTitle: "Senior Sales Consultant",

    roleId: "sales_agent",
  },

  {
    email: "recovery@deedorbit.com",

    fullName: "Tarek Mansour",

    jobTitle: "Collections Officer",

    roleId: "recovery_officer",
  },

  {
    email: "accounts@deedorbit.com",

    fullName: "Layla Aziz",

    jobTitle: "Accounts Officer",

    roleId: "accounts_officer",
  },

  {
    email: "projects@deedorbit.com",

    fullName: "Bilal Chaudhry",

    jobTitle: "Project Manager",

    roleId: "project_manager",
  },

  {
    email: "procurement@deedorbit.com",

    fullName: "Sana Idrissi",

    jobTitle: "Procurement Officer",

    roleId: "procurement_officer",
  },

  {
    email: "dealer@deedorbit.com",

    fullName: "Marcus Bell",

    jobTitle: "Channel Partner",

    roleId: "dealer_partner",
  },

  {
    email: "customer@deedorbit.com",

    fullName: "Yusuf Karim",

    jobTitle: "Buyer",

    roleId: "customer",
  },
]

interface SeedCounts {
  tenants: number
  users: number
}

interface TenantSlugRow {
  id: string
  slug: string
}

function seedDemoWorkspace(now: string): SeedCounts {
  const existing = get<{ id: string }>(
    "SELECT id FROM tenants WHERE slug = ?",

    "deedorbit",
  )

  let tenantId: string

  if (existing) {
    tenantId = existing.id
  } else {
    tenantId = "tn_deedorbit_holdings"

    run(
      `INSERT INTO tenants (
          id, name, legal_name, slug, status, plan, logo_initials,
          primary_color, timezone, currency, created_at, updated_at
       ) VALUES (?, ?, ?, ?, 'active', 'enterprise', 'DH', NULL, 'Asia/Dubai', 'AED', ?, ?)`,

      tenantId,

      "DeedOrbit Holdings",

      "DeedOrbit Holdings Ltd",

      "deedorbit",

      now,

      now,
    )

    // A second suspended workspace proves tenant status is enforced at login.

    run(
      `INSERT INTO tenants (
          id, name, legal_name, slug, status, plan, logo_initials,
          primary_color, timezone, currency, created_at, updated_at
       ) VALUES (?, ?, ?, ?, 'suspended', 'standard', 'MR', NULL, 'Asia/Dubai', 'AED', ?, ?)`,

      "tn_meridian_residences",

      "Meridian Residences JV",

      "Meridian Residences Joint Venture",

      "meridian-residences",

      now,

      now,
    )
  }

  const passwordHash = hashPassword(DEMO_PASSWORD)

  let created = 0

  for (const [index, user] of DEMO_USERS.entries()) {
    const email = user.email.toLowerCase()

    const existingUser = get<{ id: string }>(
      "SELECT id FROM users WHERE email = ?",

      email,
    )

    let userId: string

    if (existingUser) {
      userId = existingUser.id
    } else {
      userId = `usr_demo_${String(index + 1).padStart(2, "0")}`

      run(
        `INSERT INTO users (
            id, tenant_id, email, full_name, phone, job_title, status,
            password_hash, password_changed_at, email_verified_at,
            twofa_enabled, failed_login_count, created_at, updated_at
         ) VALUES (?, ?, ?, ?, NULL, ?, 'active', ?, ?, ?, 0, 0, ?, ?)`,

        userId,

        tenantId,

        email,

        user.fullName,

        user.jobTitle,

        passwordHash,

        now,

        now,

        now,

        now,
      )

      created += 1
    }

    run(
      `INSERT INTO tenant_memberships (tenant_id, user_id, role_id, is_default, created_at)
       VALUES (?, ?, ?, 1, ?)
       ON CONFLICT (tenant_id, user_id) DO UPDATE SET role_id = excluded.role_id`,

      tenantId,

      userId,

      user.roleId,

      now,
    )
  }

  seedOrganizationSettings(now)

  return { tenants: 2, users: created }
}

/**
 * Seeds organization settings: a headquarters office and the three numbering
 * sequences, for every workspace in the file.
 *
 * Two properties matter here. It is idempotent, so a re-seed adds nothing twice;
 * and profile columns are filled with COALESCE, so a re-seed never overwrites a
 * value an admin has since edited. Seeding is a demo convenience and must not
 * become a way to revert real configuration.
 *
 * Exported and called on every boot rather than only from `seed()`, because
 * `seed()` is skipped once the demo roles exist - which is exactly the state of
 * an already-installed workspace. Gating this behind that check meant the
 * organization defaults only ever reached a brand-new database.
 */
export function seedOrganizationDefaults(): void {
  seedOrganizationSettings(new Date().toISOString())
}

function seedOrganizationSettings(now: string): void {
  const DEMO_BRANCHES: Record<string, {
    name: string
    code: string
    hq: boolean
    city: string
    status: string
  }[]> = {
    deedorbit: [
      {
        name: "Head Office",
        code: "HQ",
        hq: true,
        city: "Dubai",
        status: "active",
      },

      {
        name: "Dubai Marina Office",
        code: "DXB-01",
        hq: false,
        city: "Dubai",
        status: "active",
      },

      {
        name: "Abu Dhabi Site Office",
        code: "AUH-01",
        hq: false,
        city: "Abu Dhabi",
        status: "inactive",
      },
    ],

    "meridian-residences": [
      {
        name: "Head Office",
        code: "HQ",
        hq: true,
        city: "Dubai",
        status: "active",
      },
    ],
  }

  const DEMO_PROFILE: Record<string, (string | null)[]> = {
    deedorbit: [
      "DOH-1002345",
      "TRN100998877",
      "One Central, Trade Centre",
      "Unit 1402, Tower A",

      "Dubai",
      "Dubai",
      "00000",
      "AE",
      "+971 4 555 0134",
      "billing@deedorbit.demo",
    ],

    "meridian-residences": [
      "MRJ-2004411",
      "TRN200554433",
      "Gate Avenue, Business Bay",
      "Tower B, Level 21",

      "Dubai",
      "Dubai",
      "00000",
      "AE",
      "+971 4 555 0199",
      "accounts@meridian.demo",
    ],
  }

  for (const tenant of all<TenantSlugRow>("SELECT id, slug FROM tenants")) {
    const profile = DEMO_PROFILE[tenant.slug]

    if (profile) {
      const [
        registration,
        taxId,
        line1,
        line2,
        city,
        region,
        postal,
        country,
        phone,
        email,
      ] = profile

      run(
        `UPDATE tenants SET
           registration_number = COALESCE(registration_number, ?),
           tax_id             = COALESCE(tax_id, ?),
           address_line1      = COALESCE(address_line1, ?),
           address_line2      = COALESCE(address_line2, ?),
           city               = COALESCE(city, ?),
           state_region       = COALESCE(state_region, ?),
           postal_code        = COALESCE(postal_code, ?),
           country_code       = COALESCE(country_code, ?),
           phone              = COALESCE(phone, ?),
           collections_email  = COALESCE(collections_email, ?)
         WHERE id = ?`,

        registration,
        taxId,
        line1,
        line2,
        city,
        region,
        postal,
        country,
        phone,
        email,

        tenant.id,
      )
    }

    for (const branch of DEMO_BRANCHES[tenant.slug] ?? []) {
      run(
        `INSERT INTO branches (
            id, tenant_id, name, code, is_headquarters,
            address_line1, city, state_region, postal_code, country_code,
            status, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (tenant_id, code) DO NOTHING`,

        `br_${tenant.slug.replace(/[^a-z0-9]/gi, "")}_${branch.code.toLowerCase().replace(/-/g, "")}`,

        tenant.id,

        branch.name,

        branch.code,

        branch.hq ? 1 : 0,

        branch.city,

        branch.city,

        "00000",

        "AE",

        branch.status,

        now,

        now,
      )
    }

    for (const [kind, prefix] of [
      ["invoice", "INV-"],

      ["receipt", "RCP-"],

      ["booking", "BKG-"],

      ["requisition", "PRQ-"],

      ["purchase_order", "PO-"],
    ] as const) {
      run(
        `INSERT INTO number_sequences (
            tenant_id, kind, prefix, padding, next_value, reset_yearly, last_fiscal_year, updated_at
         ) VALUES (?, ?, ?, 4, 1, 1, NULL, ?)
         ON CONFLICT (tenant_id, kind) DO NOTHING`,

        tenant.id,

        kind,

        prefix,

        now,
      )
    }
  }
}

/**
 * Demo data for the four operational modules (construction, procurement,
 * documents & signatures, integrations) on the DeedOrbit workspace.
 *
 * Boot-level and idempotent like the other defaulters. Every row is inserted
 * under a fixed `*_demo_*` primary key with INSERT OR IGNORE, so a restart adds
 * nothing twice and never reverts an edit a real user has since made. Money is
 * honest: a phase's actuals stay derived - these are ordinary expense/invoice
 * rows merely tagged against a phase, not a parallel book - and stock is only
 * ever the SUM of the movements written below. No value here is fabricated to
 * make a screen look full; each row is a fact the read path can point at.
 */
export function seedOperationalModules(): void {
  const tenantId = "tn_deedorbit_holdings"

  if (!get<{ id: string }>("SELECT id FROM tenants WHERE id = ?", tenantId)) {
    return
  }

  const now = new Date()

  const daysAgo = (n: number) =>
    new Date(now.getTime() - n * 86400000).toISOString()

  const inDays = (n: number) => daysAgo(-n)

  const PM = "usr_demo_08"

  const PM_NAME = "Bilal Chaudhry"

  const PROC = "usr_demo_09"

  const PROC_NAME = "Sana Idrissi"

  const ADMIN = "usr_demo_03"

  const ADMIN_NAME = "Nadia Farouk"

  const PROJECT = "proj_demo_marina"

  const VEN_SUB = "ven_demo_alnoor"

  const VEN_MEP = "ven_demo_gulfmep"

  transaction(() => {
    // Anchors: a development and the two suppliers it spends against. Everything
    // below hangs off these, so they are written first inside the one transaction.
    run(
      `INSERT OR IGNORE INTO projects (
          id, tenant_id, name, code, developer, location, status,
          project_type, ownership_type, created_at, updated_at
        ) VALUES (?, ?, 'Marina Gate Residences', 'MG-01',
          'DeedOrbit Development', 'Dubai Marina, Dubai', 'on_sale',
          'residential', 'freehold', ?, ?)`,
      PROJECT,
      tenantId,
      daysAgo(240),
      daysAgo(240),
    )

    for (const [id, name, trade] of [
      [VEN_SUB, "Al Noor Contracting", "contracting"],
      [VEN_MEP, "Gulf MEP Supplies", "mep"],
    ] as const) {
      run(
        `INSERT OR IGNORE INTO vendors (
            id, tenant_id, name, contact_name, email, city, country_code,
            notes, status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, 'Dubai', 'AE', ?, 'active', ?, ?)`,
        id,
        tenantId,
        name,
        `Accounts - ${name}`,
        `billing@${trade}.example.invalid`,
        `Demo ${trade} supplier for the Marina Gate build.`,
        daysAgo(200),
        daysAgo(200),
      )
    }

    seedConstructionDemo({
      tenantId,
      project: PROJECT,
      venSub: VEN_SUB,
      venMep: VEN_MEP,
      pm: PM,
      pmName: PM_NAME,
      daysAgo,
      inDays,
    })

    seedProcurementDemo({
      tenantId,
      project: PROJECT,
      venSub: VEN_SUB,
      proc: PROC,
      procName: PROC_NAME,
      daysAgo,
    })

    seedSignaturesDemo({
      tenantId,
      project: PROJECT,
      admin: ADMIN,
      adminName: ADMIN_NAME,
      daysAgo,
      inDays,
    })

    seedDocumentVerificationDemo({
      tenantId,
      admin: ADMIN,
      adminName: ADMIN_NAME,
      uploader: "usr_demo_04",
      uploaderName: "Omar Haddad",
      daysAgo,
      inDays,
    })

    seedIntegrationsDemo({
      tenantId,
      admin: ADMIN,
      adminName: ADMIN_NAME,
      daysAgo,
    })
  })
}

interface ConstructionSeed {
  tenantId: string
  project: string
  venSub: string
  venMep: string
  pm: string
  pmName: string
  daysAgo: (n: number) => string
  inDays: (n: number) => string
}

function seedConstructionDemo(s: ConstructionSeed) {
  // Three contractors. Two are the billing suppliers (so carry a vendor link);
  // one is a site-only firm that has not invoiced yet, so its vendor_id is null.
  const contractors: [string, string, string, string | null][] = [
    ["con_demo_sub", "Al Noor Contracting", "substructure", s.venSub],
    ["con_demo_mep", "Gulf MEP Partners", "mep", s.venMep],
    ["con_demo_fin", "Deco Finishes LLC", "finishes", null],
  ]

  for (const [id, name, trade, vendorId] of contractors) {
    run(
      `INSERT OR IGNORE INTO construction_contractors (
          id, tenant_id, vendor_id, name, trade, status, created_at
        ) VALUES (?, ?, ?, ?, ?, 'active', ?)`,
      id,
      s.tenantId,
      vendorId,
      name,
      trade,
      s.daysAgo(180),
    )
  }

  // Two phases with tasks (progress derived from the task rollup) and one phase
  // with no tasks but a manual figure - so the UI can show which source is in play.
  const phases: [string, string, number, string, number, number | null][] = [
    ["ph_demo_sub", "Substructure", 1, "active", 500000000, null],
    ["ph_demo_sup", "Superstructure", 2, "pending", 400000000, null],
    ["ph_demo_fin", "Finishes", 3, "pending", 200000000, 25],
  ]

  for (const [id, name, seq, status, budget, manual] of phases) {
    run(
      `INSERT OR IGNORE INTO construction_phases (
          id, tenant_id, project_id, name, sequence, status, planned_start,
          planned_end, budget_amount, budget_currency, manual_progress,
          created_by_user_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'AED', ?, ?, ?)`,
      id,
      s.tenantId,
      s.project,
      name,
      seq,
      status,
      s.daysAgo(120),
      s.inDays(60),
      budget,
      manual,
      s.pm,
      s.daysAgo(120),
    )
  }

  // Tasks under Substructure: one done, one milestone part-done, one running.
  // Rollup = (100 + 60x2 + 30) / 4, so the derived figure is a fact about these rows.
  const tasks: [string, string, string, number, string, number, number][] = [
    [
      "ct_demo_exc",
      "ph_demo_sub",
      "Excavation & piling",
      1,
      "completed",
      0,
      100,
    ],
    [
      "ct_demo_ftg",
      "ph_demo_sub",
      "Footings & raft slab",
      2,
      "in_progress",
      1,
      60,
    ],
    [
      "ct_demo_col",
      "ph_demo_sub",
      "Columns & shear walls",
      3,
      "in_progress",
      0,
      30,
    ],
    ["ct_demo_sup", "ph_demo_sup", "Core walls", 1, "pending", 0, 0],
  ]

  for (const [id, phase, name, seq, status, milestone, progress] of tasks) {
    run(
      `INSERT OR IGNORE INTO construction_tasks (
          id, tenant_id, phase_id, name, sequence, status, milestone,
          contractor_id, progress, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'con_demo_sub', ?, ?)`,
      id,
      s.tenantId,
      phase,
      name,
      seq,
      status,
      milestone,
      progress,
      s.daysAgo(110),
    )
  }

  // The site-progress log, append-only: the newest row is "current site progress".
  const logs: [string, number, number][] = [
    ["cpl_demo_1", 40, 14],
    ["cpl_demo_2", 55, 7],
  ]

  for (const [id, percent, ago] of logs) {
    run(
      `INSERT OR IGNORE INTO construction_progress_logs (
          id, tenant_id, phase_id, percent, note, actor_user_id, actor_name,
          created_at
        ) VALUES (?, ?, 'ph_demo_sub', ?, ?, ?, ?, ?)`,
      id,
      s.tenantId,
      percent,
      `Site report: substructure at ${percent}%`,
      s.pm,
      s.pmName,
      s.daysAgo(ago),
    )
  }

  // Tagged ledger rows: two expenses (phase-level and task-level) and two vendor
  // invoices. One invoice is USD against an AED phase, so the derivation shows it
  // on its own line rather than summing across currencies.
  run(
    `INSERT OR IGNORE INTO expenses (
        id, tenant_id, category, project_id, vendor_id, description, amount,
        currency, occurred_at, status, construction_phase_id, paid_at,
        created_by_user_id, created_by_name, created_at, updated_at
      ) VALUES (?, ?, 'construction', ?, ?, 'Substructure concrete pour',
        120000000, 'AED', ?, 'paid', 'ph_demo_sub', ?, ?, ?, ?, ?)`,
    "exp_demo_sub",
    s.tenantId,
    s.project,
    s.venSub,
    s.daysAgo(10),
    s.daysAgo(9),
    s.pm,
    s.pmName,
    s.daysAgo(10),
    s.daysAgo(9),
  )

  run(
    `INSERT OR IGNORE INTO expenses (
        id, tenant_id, category, project_id, vendor_id, description, amount,
        currency, occurred_at, status, construction_phase_id,
        construction_task_id, created_by_user_id, created_by_name,
        created_at, updated_at
      ) VALUES (?, ?, 'construction', ?, ?, 'Rebar for footings', 30000000,
        'AED', ?, 'approved', 'ph_demo_sub', 'ct_demo_ftg', ?, ?, ?, ?)`,
    "exp_demo_ftg",
    s.tenantId,
    s.project,
    s.venSub,
    s.daysAgo(5),
    s.pm,
    s.pmName,
    s.daysAgo(5),
    s.daysAgo(5),
  )

  run(
    `INSERT OR IGNORE INTO vendor_invoices (
        id, tenant_id, vendor_id, reference, amount, currency, issued_at,
        status, construction_phase_id, created_at
      ) VALUES (?, ?, ?, 'VI-DEMO-0001', 80000000, 'AED', ?, 'open',
        'ph_demo_sub', ?)`,
    "vi_demo_sub",
    s.tenantId,
    s.venSub,
    s.daysAgo(8),
    s.daysAgo(8),
  )

  run(
    `INSERT OR IGNORE INTO vendor_invoices (
        id, tenant_id, vendor_id, reference, amount, currency, issued_at,
        status, construction_phase_id, created_at
      ) VALUES (?, ?, ?, 'VI-DEMO-0002', 10000000, 'USD', ?, 'open',
        'ph_demo_sub', ?)`,
    "vi_demo_usd",
    s.tenantId,
    s.venMep,
    s.daysAgo(6),
    s.daysAgo(6),
  )
}

interface ProcurementSeed {
  tenantId: string
  project: string
  venSub: string
  proc: string
  procName: string
  daysAgo: (n: number) => string
}

function seedProcurementDemo(s: ProcurementSeed) {
  // Materials. Stock is never a column - it is read as the SUM of movements.
  // Gloves carry no target, so "below target" renders a dash, not zero.
  const materials: [string, string, string, string, string, number | null][] = [
    ["mat_cement", "CEM-50", "Portland Cement 50kg", "material", "bag", 500],
    ["mat_rebar", "REB-12", "Rebar 12mm", "material", "tonne", 20],
    ["mat_gloves", "GLV-01", "Safety Gloves", "consumable", "pair", null],
  ]

  for (const [id, sku, name, category, unit, target] of materials) {
    run(
      `INSERT OR IGNORE INTO materials (
          id, tenant_id, sku, name, category, unit_of_measure, target_stock,
          status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
      id,
      s.tenantId,
      sku,
      name,
      category,
      unit,
      target,
      s.daysAgo(90),
    )
  }

  // One approved requisition (the one the PO converts from) and one open, whose
  // single unpriced line keeps its estimate null rather than guessing a total.
  run(
    `INSERT OR IGNORE INTO purchase_requisitions (
        id, tenant_id, reference, justification, needed_by, project_id,
        phase_id, estimated_amount, currency, line_items, status,
        created_by_user_id, created_by_name, created_at, updated_at
      ) VALUES (?, ?, 'PRQ-0901', 'Substructure pour for footings', ?,
        ?, 'ph_demo_sub', 500600000, 'AED', ?, 'approved', ?, ?, ?, ?)`,
    "req_demo_1",
    s.tenantId,
    s.daysAgo(30),
    s.project,
    JSON.stringify([
      {
        description: "Portland Cement 50kg",
        quantity: 500,
        unit: "bag",
        unitPrice: 1200,
      },
      {
        description: "Rebar 12mm",
        quantity: 20,
        unit: "tonne",
        unitPrice: 25000000,
      },
    ]),
    s.proc,
    s.procName,
    s.daysAgo(35),
    s.daysAgo(28),
  )

  run(
    `INSERT OR IGNORE INTO purchase_requisitions (
        id, tenant_id, reference, justification, needed_by, project_id,
        estimated_amount, currency, line_items, status,
        created_by_user_id, created_by_name, created_at, updated_at
      ) VALUES (?, ?, 'PRQ-0902', 'Site signage for handover', ?, ?, NULL,
        'AED', ?, 'submitted', ?, ?, ?, ?)`,
    "req_demo_2",
    s.tenantId,
    s.daysAgo(20),
    s.project,
    JSON.stringify([
      {
        description: "Directional site signage",
        quantity: 4,
        unit: "each",
        unitPrice: null,
      },
    ]),
    s.proc,
    s.procName,
    s.daysAgo(22),
    s.daysAgo(21),
  )

  // The full PO -> GRN -> invoice chain, marked received.
  run(
    `INSERT OR IGNORE INTO purchase_orders (
        id, tenant_id, po_number, vendor_id, requisition_id, project_id,
        phase_id, status, currency, total_amount, notes,
        created_by_user_id, created_by_name, created_at, updated_at
      ) VALUES (?, ?, 'PO-0901', ?, 'req_demo_1', ?, 'ph_demo_sub', 'received',
        'AED', 500600000, 'Demo cement and rebar order.', ?, ?, ?, ?)`,
    "po_demo_1",
    s.tenantId,
    s.venSub,
    s.project,
    s.proc,
    s.procName,
    s.daysAgo(28),
    s.daysAgo(15),
  )

  const poLines: [string, string, string, number, string, number, number][] = [
    ["pol_1", "mat_cement", "Portland Cement 50kg", 500, "bag", 1200, 600000],
    ["pol_2", "mat_rebar", "Rebar 12mm", 20, "tonne", 25000000, 500000000],
  ]

  for (const [
    index,
    [id, material, desc, qty, unit, price, total],
  ] of poLines.entries()) {
    run(
      `INSERT OR IGNORE INTO purchase_order_lines (
          id, tenant_id, purchase_order_id, material_id, description, quantity,
          unit, unit_price, line_total, sequence
        ) VALUES (?, ?, 'po_demo_1', ?, ?, ?, ?, ?, ?, ?)`,
      id,
      s.tenantId,
      material,
      desc,
      qty,
      unit,
      price,
      total,
      index + 1,
    )
  }

  // The purchase invoice the GRN raises, tagged to the PO for the three-way
  // match. Inserted before the GRN so the receipt's invoice_id resolves.
  run(
    `INSERT OR IGNORE INTO vendor_invoices (
        id, tenant_id, vendor_id, reference, amount, currency, issued_at,
        status, purchase_order_id, note, created_at
      ) VALUES ('vi_demo_po', ?, ?, 'VI-DEMO-0901', 500600000, 'AED', ?, 'open',
        'po_demo_1', 'Raised from GRN-0901.', ?)`,
    s.tenantId,
    s.venSub,
    s.daysAgo(14),
    s.daysAgo(14),
  )

  // GRN covering both lines in full; it points at the matching open invoice.
  run(
    `INSERT OR IGNORE INTO goods_receipt_notes (
        id, tenant_id, grn_number, purchase_order_id, project_id, received_at,
        note, status, invoice_id, actor_user_id, actor_name, created_at
      ) VALUES ('grn_demo', ?, 'GRN-0901', 'po_demo_1', ?, ?, 'Full receipt of
        cement and rebar.', 'recorded', 'vi_demo_po', ?, ?, ?)`,
    s.tenantId,
    s.project,
    s.daysAgo(15),
    s.proc,
    s.procName,
    s.daysAgo(15),
  )

  run(
    `INSERT OR IGNORE INTO goods_receipt_lines (
        id, tenant_id, grn_id, po_line_id, material_id, quantity
      ) VALUES ('grl_1', ?, 'grn_demo', 'pol_1', 'mat_cement', 500)`,
    s.tenantId,
  )

  run(
    `INSERT OR IGNORE INTO goods_receipt_lines (
        id, tenant_id, grn_id, po_line_id, material_id, quantity
      ) VALUES ('grl_2', ?, 'grn_demo', 'pol_2', 'mat_rebar', 20)`,
    s.tenantId,
  )

  // Movements: the two receipts the GRN wrote, plus one site issue. Cement nets
  // to 400 against a 500 target (below target); rebar sits at its target; gloves
  // have no movement and no target.
  const movements: [string, string, string, number, string | null, string][] = [
    ["sm_1", "mat_cement", "receipt", 500, "grn_demo", "Received on GRN-0901"],
    ["sm_2", "mat_rebar", "receipt", 20, "grn_demo", "Received on GRN-0901"],
    ["sm_3", "mat_cement", "issue", -100, null, "Site draw - substructure"],
  ]

  for (const [id, material, type, qty, grn, note] of movements) {
    run(
      `INSERT OR IGNORE INTO stock_movements (
          id, tenant_id, material_id, type, quantity, note, project_id,
          purchase_order_id, grn_id, actor_user_id, actor_name, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      s.tenantId,
      material,
      type,
      qty,
      note,
      s.project,
      grn ? "po_demo_1" : null,
      grn,
      s.proc,
      s.procName,
      s.daysAgo(grn ? 15 : 12),
    )
  }
}

interface VerificationSeed {
  tenantId: string

  admin: string

  adminName: string

  uploader: string

  uploaderName: string

  daysAgo: (n: number) => string

  inDays: (n: number) => string
}

// One placeholder document to file against a demo customer.
interface DemoVerificationDoc {
  id: string

  customer: string

  docType: string

  key: string

  title: string

  filename: string

  status: string

  expiresAt: string | null

  source: string

  reupload: number

  rejectReason: string | null

  verified: boolean

  cnicHash: string | null

  dupTag: string | null
}

/**
 * FLAGGED: placeholder sample data for the Customer Document Verification module.
 *
 * The images below are a single synthetic blank PNG generated at seed time — not a
 * real ID, not a real scan, and not any real person's data. The CNIC numbers are the
 * reserved dummy value. This block exists only to populate every checklist state
 * (missing, uploaded, under_review, verified, rejected, expired), a deliberate
 * duplicate pair (identical file + CNIC fingerprints across two customers), and
 * near-expiry dates inside the 60 / 30 / 7 alert windows so the desk, the customer
 * page, and the reminders all have something honest to show.
 *
 * Honesty is preserved: `ocr_status` stays `none` and every extracted / provider
 * column is NULL, because in manual mode nothing is auto-filled and nothing is ever
 * stamped government-verified. Verified rows are stamped by a person who is *not*
 * the uploader, so the maker-checker split is visible in the sample itself.
 */
function seedDocumentVerificationDemo(s: VerificationSeed) {
  // A 1x1 transparent PNG — a placeholder byte blob, never a real document.
  const png =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="

  const dataUrl = `data:image/png;base64,${png}`

  const sizeBytes = Buffer.from(png, "base64").byteLength

  const fp = (tag: string) =>
    createHash("sha256").update(`deedorbit-demo|${tag}`).digest("hex")

  const custA = "cus_demo_amna"

  const custB = "cus_demo_imran"

  const cnicA = "12345-1234567-1"

  const cnicB = "45678-7654321-9"

  // A keyed CNIC fingerprint. Duplicate detection only compares this column for
  // equality, so the duplicate pair is seeded with the same value on purpose.
  const cnicHashA = fp(`cnic|${cnicA}`)

  // The shared file fingerprint for the deliberate duplicate pair (Amna + Imran).
  const dupFileTag = "cnic-front-duplicate"

  const customers: [string, string, string][] = [
    [custA, "Amna Traders", cnicA],

    [custB, "Imran Sheikh", cnicB],
  ]

  for (const [id, name, cnic] of customers) {
    run(
      `INSERT OR IGNORE INTO customers (
          id, tenant_id, full_name, phone, email, cnic, customer_type,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'individual', ?, ?)`,
      id,
      s.tenantId,
      name,
      "+000-0000000000",
      `${id.replace(/[^a-z0-9]/g, "")}@example.invalid`,
      cnic,
      s.daysAgo(40),
      s.daysAgo(40),
    )
  }

  const docs: DemoVerificationDoc[] = [
    // verified — the face page, checked by an officer who is not the uploader.
    {
      id: "dv_amna_cnic_front",
      customer: custA,
      docType: "id_copy",
      key: "cnic_front",
      title: "CNIC front (placeholder)",
      filename: "cnic-front-placeholder.png",
      status: "verified",
      expiresAt: s.inDays(400).slice(0, 10),
      source: "staff",
      reupload: 0,
      rejectReason: null,
      verified: true,
      cnicHash: cnicHashA,
      dupTag: dupFileTag,
    },
    // under_review — the back page is in the queue awaiting a decision.
    {
      id: "dv_amna_cnic_back",
      customer: custA,
      docType: "id_copy",
      key: "cnic_back",
      title: "CNIC back (placeholder)",
      filename: "cnic-back-placeholder.png",
      status: "under_review",
      expiresAt: s.inDays(400).slice(0, 10),
      source: "staff",
      reupload: 0,
      rejectReason: null,
      verified: false,
      cnicHash: null,
      dupTag: null,
    },
    // uploaded — arrived via the portal, not yet opened by a reviewer.
    {
      id: "dv_amna_photograph",
      customer: custA,
      docType: "id_copy",
      key: "photograph",
      title: "Photograph (placeholder)",
      filename: "photograph-placeholder.png",
      status: "unverified",
      expiresAt: null,
      source: "portal",
      reupload: 0,
      rejectReason: null,
      verified: false,
      cnicHash: null,
      dupTag: null,
    },
    // rejected — turned back with a reason and a re-upload request.
    {
      id: "dv_amna_income",
      customer: custA,
      docType: "other",
      key: "proof_of_income",
      title: "Proof of income (placeholder)",
      filename: "proof-of-income-placeholder.png",
      status: "rejected",
      expiresAt: null,
      source: "staff",
      reupload: 1,
      rejectReason:
        "The figures are unreadable — please re-submit a clearer scan.",
      verified: false,
      cnicHash: null,
      dupTag: null,
    },
    // expired — a once-verified passport whose validity has passed.
    {
      id: "dv_amna_passport",
      customer: custA,
      docType: "id_copy",
      key: "passport",
      title: "Passport (placeholder)",
      filename: "passport-placeholder.png",
      status: "verified",
      expiresAt: s.daysAgo(15).slice(0, 10),
      source: "staff",
      reupload: 0,
      rejectReason: null,
      verified: true,
      cnicHash: null,
      dupTag: null,
    },
    // Expiry-window examples (verified, but inside each alert threshold).
    {
      id: "dv_amna_utility",
      customer: custA,
      docType: "other",
      key: "utility_bill",
      title: "Utility bill (placeholder)",
      filename: "utility-bill-placeholder.png",
      status: "verified",
      expiresAt: s.inDays(55).slice(0, 10),
      source: "staff",
      reupload: 0,
      rejectReason: null,
      verified: true,
      cnicHash: null,
      dupTag: null,
    },
    {
      id: "dv_amna_nominee",
      customer: custA,
      docType: "id_copy",
      key: "nominee_cnic",
      title: "Nominee CNIC (placeholder)",
      filename: "nominee-cnic-placeholder.png",
      status: "verified",
      expiresAt: s.inDays(20).slice(0, 10),
      source: "staff",
      reupload: 0,
      rejectReason: null,
      verified: true,
      cnicHash: null,
      dupTag: null,
    },
    {
      id: "dv_amna_affidavit",
      customer: custA,
      docType: "agreement",
      key: "affidavit",
      title: "Affidavit (placeholder)",
      filename: "affidavit-placeholder.png",
      status: "verified",
      expiresAt: s.inDays(5).slice(0, 10),
      source: "staff",
      reupload: 0,
      rejectReason: null,
      verified: true,
      cnicHash: null,
      dupTag: null,
    },
    // Duplicate pair on a second customer — same file + CNIC fingerprints, so the
    // review screen flags it exactly as a real re-submission would.
    {
      id: "dv_imran_cnic_front",
      customer: custB,
      docType: "id_copy",
      key: "cnic_front",
      title: "CNIC front (placeholder)",
      filename: "cnic-front-placeholder.png",
      status: "under_review",
      expiresAt: s.inDays(365).slice(0, 10),
      source: "staff",
      reupload: 0,
      rejectReason: null,
      verified: false,
      cnicHash: cnicHashA,
      dupTag: dupFileTag,
    },
    // booking_form is deliberately left un-filed so the checklist shows `missing`.
  ]

  for (const d of docs) {
    const fileSha = fp(d.dupTag ?? d.id)

    const verifiedVia = d.verified ? "manual" : null

    const verifiedBy = d.verified ? s.admin : null

    const verifiedByName = d.verified ? s.adminName : null

    const verifiedAt = d.verified ? s.daysAgo(5) : null

    run(
      `INSERT OR IGNORE INTO documents (
          id, tenant_id, entity_type, entity_id, doc_type, title, filename, mime,
          size_bytes, data, expires_at, checklist_key, verification_status,
          uploaded_by_user_id, uploaded_by_name, created_at, updated_at, ocr_status,
          reupload_requested, source, verified_via, verified_by_user_id,
          verified_by_name, verified_at, reject_reason, cnic_hash, file_sha256
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      d.id,
      s.tenantId,
      "customer",
      d.customer,
      d.docType,
      d.title,
      d.filename,
      "image/png",
      sizeBytes,
      dataUrl,
      d.expiresAt,
      d.key,
      d.status,
      s.uploader,
      s.uploaderName,
      s.daysAgo(20),
      s.daysAgo(20),
      "none",
      d.reupload,
      d.source,
      verifiedVia,
      verifiedBy,
      verifiedByName,
      verifiedAt,
      d.rejectReason,
      d.cnicHash,
      fileSha,
    )
  }
}

interface SignaturesSeed {
  tenantId: string
  project: string
  admin: string
  adminName: string
  daysAgo: (n: number) => string
  inDays: (n: number) => string
}

function seedSignaturesDemo(s: SignaturesSeed) {
  run(
    `INSERT OR IGNORE INTO doc_templates (
        id, tenant_id, name, category, body_text, status,
        created_by_user_id, created_by_name, created_at, updated_at
      ) VALUES ('tmpl_sale', ?, 'Sale & Purchase Agreement', 'sale_agreement',
        ?, 'active', ?, ?, ?, ?)`,
    s.tenantId,
    "SALE & PURCHASE AGREEMENT\n\nBuyer: {{buyerName}}\nUnit: {{unitCode}}\nProject: Marina Gate Residences\n",
    s.admin,
    s.adminName,
    s.daysAgo(60),
    s.daysAgo(60),
  )

  run(
    `INSERT OR IGNORE INTO doc_templates (
        id, tenant_id, name, category, body_text, status,
        created_by_user_id, created_by_name, created_at, updated_at
      ) VALUES ('tmpl_noc', ?, 'Handover NOC', 'noc',
        'NO OBJECTION CERTIFICATE\n\nRe: {{unitCode}}\n', 'draft', ?, ?, ?, ?)`,
    s.tenantId,
    s.admin,
    s.adminName,
    s.daysAgo(45),
    s.daysAgo(45),
  )

  // The signed envelope's completed document, filed in the existing documents
  // table (the file trail stays in one place): a text/plain data URL, as the
  // ceremony writes it.
  const agreementText =
    "SALE & PURCHASE AGREEMENT\n\nBuyer: Yusuf Karim\nUnit: B12\nProject: Marina Gate Residences\n\n---\nSigners\nYusuf Karim <customer@deedorbit.com>\nAmina Rahman <owner@deedorbit.com>\n"

  const dataUrl = `data:text/plain;base64,${Buffer.from(agreementText, "utf8").toString("base64")}`

  run(
    `INSERT OR IGNORE INTO documents (
        id, tenant_id, entity_type, entity_id, doc_type, title, filename, mime,
        size_bytes, data, uploaded_by_user_id, uploaded_by_name, created_at,
        updated_at
      ) VALUES ('doc_demo_signed', ?, 'project', ?, 'agreement',
        'Marina Gate - Sale Agreement (signed)',
        'marina-gate-sale-agreement-signed.txt', 'text/plain', ?, ?, ?, ?, ?, ?)`,
    s.tenantId,
    s.project,
    Buffer.byteLength(agreementText, "utf8"),
    dataUrl,
    s.admin,
    s.adminName,
    s.daysAgo(3),
    s.daysAgo(3),
  )

  run(
    `INSERT OR IGNORE INTO doc_envelopes (
        id, tenant_id, title, message, template_id, rendered_body, project_id,
        status, sent_at, expires_at, completed_at, completed_document_id,
        created_by_user_id, created_by_name, created_at
      ) VALUES ('env_signed', ?, 'Marina Gate - Sale Agreement', 'Please countersign.',
        'tmpl_sale', ?, ?, 'completed', ?, ?, ?, 'doc_demo_signed', ?, ?, ?)`,
    s.tenantId,
    "SALE & PURCHASE AGREEMENT\n\nBuyer: Yusuf Karim\nUnit: B12\nProject: Marina Gate Residences\n",
    s.project,
    s.daysAgo(20),
    s.inDays(30),
    s.daysAgo(3),
    s.admin,
    s.adminName,
    s.daysAgo(20),
  )

  const signedRecipients: [string, string, string, string, string, number, string][] =
    [
      [
        "er_signed_1",
        "Yusuf Karim",
        "customer@deedorbit.com",
        "signer",
        "signed",
        1,
        "Buyer",
      ],
      [
        "er_signed_2",
        "Amina Rahman",
        "owner@deedorbit.com",
        "signer",
        "signed",
        2,
        "Seller",
      ],
      [
        "er_cc_1",
        "Layla Aziz",
        "accounts@deedorbit.com",
        "cc",
        "opened",
        3,
        "Copy",
      ],
    ]

  for (const [id, name, email, role, status, order, note] of signedRecipients) {
    run(
      `INSERT OR IGNORE INTO envelope_recipients (
          id, tenant_id, envelope_id, name, email, role, sign_order, status,
          signed_name, signed_at, signed_ip, opened_at, created_at
        ) VALUES (?, ?, 'env_signed', ?, ?, ?, ?, ?,
          CASE WHEN ? = 'signed' THEN ? ELSE NULL END,
          CASE WHEN ? = 'signed' THEN ? ELSE NULL END,
          CASE WHEN ? = 'signed' THEN '127.0.0.1' ELSE NULL END,
          CASE WHEN ? = 'opened' THEN ? ELSE NULL END, ?)`,
      id,
      s.tenantId,
      name,
      email,
      role,
      order,
      status,
      status,
      name,
      status,
      s.daysAgo(4),
      status,
      status,
      s.daysAgo(6),
      s.daysAgo(20),
    )
    void note
  }

  // A live, unsent-token ceremony: `sent` with a hashed token so the public link
  // resolves, and its single signer still pending.
  run(
    `INSERT OR IGNORE INTO doc_envelopes (
        id, tenant_id, title, message, template_id, rendered_body, project_id,
        status, token_hash, sent_at, expires_at,
        created_by_user_id, created_by_name, created_at
      ) VALUES ('env_pending', ?, 'Marina Gate - Unit C04 Addendum', 'For review and signature.',
        'tmpl_sale', ?, ?, 'sent', ?, ?, ?, ?, ?, ?)`,
    s.tenantId,
    "SALE & PURCHASE AGREEMENT\n\nBuyer: Hamid Al Zahedi\nUnit: C04\nProject: Marina Gate Residences\n",
    s.project,
    hashToken("iv_demo_pending_sign_token"),
    s.daysAgo(1),
    s.inDays(30),
    s.admin,
    s.adminName,
    s.daysAgo(1),
  )

  run(
    `INSERT OR IGNORE INTO envelope_recipients (
        id, tenant_id, envelope_id, name, email, role, sign_order, status,
        created_at
      ) VALUES ('er_pend_1', ?, 'env_pending', 'Hamid Al Zahedi',
        'hamid@example.invalid', 'signer', 1, 'pending', ?)`,
    s.tenantId,
    s.daysAgo(1),
  )
}

interface IntegrationsSeed {
  tenantId: string
  admin: string
  adminName: string
  daysAgo: (n: number) => string
}

function seedIntegrationsDemo(s: IntegrationsSeed) {
  // A read-only key. Only the hash and the display prefix are stored here - the
  // plaintext is exactly what the create dialog would have shown once, and it is
  // not recoverable from the row, which is the whole point.
  const token = "iv_demo_readonly_0001"

  run(
    `INSERT OR IGNORE INTO api_keys (
        id, tenant_id, label, token_hash, prefix, created_by_user_id,
        created_by_name, created_at
      ) VALUES ('key_demo_1', ?, 'Demo read-only key', ?, ?, ?, ?, ?)`,
    s.tenantId,
    hashToken(token),
    token.slice(0, 8),
    s.admin,
    s.adminName,
    s.daysAgo(40),
  )

  run(
    `INSERT OR IGNORE INTO webhook_endpoints (
        id, tenant_id, url, secret, events, status, failure_count,
        consecutive_failures, created_by_user_id, created_by_name, created_at
      ) VALUES ('ep_demo_1', ?, 'https://example.invalid/webhooks/deedorbit',
        'whsec_demo_shared_secret', ?, 'active', 1, 1, ?, ?, ?)`,
    s.tenantId,
    JSON.stringify(["lead_created", "booking_created"]),
    s.admin,
    s.adminName,
    s.daysAgo(30),
  )

  // One real (non-test) failed delivery, so the log opens on honest state rather
  // than an empty table - and the failure count above is what that row produced.
  run(
    `INSERT OR IGNORE INTO webhook_deliveries (
        id, tenant_id, endpoint_id, event, payload, status, http_status,
        duration_ms, response_snippet, is_test, created_at
      ) VALUES ('del_demo_1', ?, 'ep_demo_1', 'lead_created', ?, 'failed', 500,
        1200, '500 Internal Server Error', 0, ?)`,
    s.tenantId,
    JSON.stringify({ event: "lead_created", source: "seed" }),
    s.daysAgo(9),
  )
}

export function isSeeded(): boolean {
  return (
    (all<{ count: number }>("SELECT COUNT(*) AS count FROM roles")[0]?.count ??
      0) > 0
  )
}

export { DEMO_PASSWORD, DEMO_USERS }
