/**
 * DeedOrbit access-control registry.
 *
 * This file is the *catalogue*: the list of modules, the actions that can be
 * performed on them, and the roles the product ships with. It is deliberately
 * separate from the *grants* — which role may do which action lives in the
 * database (`permissions`, `role_permission_defaults`,
 * `role_permission_overrides`) so a tenant admin can adjust it without a
 * deploy.
 *
 * Both the API server and the React client import this, so a module can never
 * appear in the navigation without also being securable.
 */

export const ACTIONS = [
  "view",
  "create",
  "edit",
  "delete",
  "approve",
  // Separate from `edit` on purpose. A unit's status is the one field where a
  // wrong value misreports the state of the estate to a buyer, and where the
  // honest way to change it is usually a booking or a cancellation rather than a
  // keystroke. So it is gated separately, and roles that sell do not get it.
  "change_status",

  // Also separate from `edit`, and from `approve`. `approve` signs off a request
  // somebody else put in the queue; `verify` is the officer opening a file or a
  // record themselves and certifying that it is what it says it is. Nothing in this
  // platform can decide that on a person's behalf, so the act needs its own grant -
  // and a role that uploads documents must not hold it by default, or the uploader
  // would be signing their own work.
  "verify",
] as const

export type Action = typeof ACTIONS[number]

export const ACTION_LABELS: Record<Action, string> = {
  view: "View",

  create: "Create",

  edit: "Edit",

  delete: "Delete",

  approve: "Approve",

  change_status: "Change status",

  verify: "Verify",
}

/** Short explanation shown in the role matrix. */

export const ACTION_HINTS: Record<Action, string> = {
  view: "Open the module and read its records",

  create: "Add new records",

  edit: "Change existing records",

  delete: "Remove records permanently",

  approve: "Sign off on records held for review",

  change_status: "Move a unit between statuses by hand",

  verify: "Confirm a record after opening it yourself",
}

export const MODULES = [
  "dashboard",

  "projects",

  "inventory",

  "leads",

  "sales_agents",

  "dealers",

  "bookings",

  "approvals",

  "payments",

  "customers",

  "expenses",

  "vendors",

  "construction",

  "procurement",

  "documents",

  "signatures",

  "tickets",

  "campaigns",

  "reports",

  "users",

  "settings",

  "audit",

  // "Ask DeedOrbit" - a read surface, so it is securable like every other
  // module. Reaching the endpoint needs `assistant.view`; a returned answer
  // then re-checks the underlying data module, so the assistant can never show
  // a row the caller could not already read in that module directly.
  "assistant",

  // The reminder engine's own surface: the message ledger, its retry, and a
  // manual send. View is the desk's question "what was told to this customer";
  // edit is the act of deciding a message goes out, which is why chasing roles
  // carry it and filing roles do not.
  "reminders",
] as const

export type PermissionModule = typeof MODULES[number]

export const MODULE_LABELS: Record<PermissionModule, string> = {
  dashboard: "Dashboard",

  projects: "Projects",

  inventory: "Inventory",

  leads: "Leads",

  sales_agents: "Sales Agents",

  dealers: "Dealers / Channel Partners",

  bookings: "Bookings",

  approvals: "Approvals",

  payments: "Payments",

  customers: "Customers",

  expenses: "Expenses",

  vendors: "Vendors",

  construction: "Construction",

  procurement: "Procurement",

  documents: "Documents",

  signatures: "Documents & signatures",

  tickets: "Support tickets",

  campaigns: "Campaigns",

  reports: "Reports",

  users: "Users & roles",

  settings: "Settings",

  audit: "Audit log",

  assistant: "Ask DeedOrbit",

  reminders: "Payment reminders",
}

export const ROLE_IDS = [
  "platform_super_admin",

  "tenant_owner",

  "tenant_admin",

  "sales_manager",

  "sales_agent",

  "recovery_officer",

  "accounts_officer",

  "project_manager",

  "procurement_officer",

  "dealer_partner",

  "customer",
] as const

export type RoleId = typeof ROLE_IDS[number]

export type RoleScope = "platform" | "tenant"

export type RoleDefinition = {
  id: RoleId

  label: string

  scope: RoleScope

  description: string
}

export const ROLES: RoleDefinition[] = [
  {
    id: "platform_super_admin",

    label: "Platform Super Admin",

    scope: "platform",

    description:
      "Operates the SaaS platform itself. Sees the tenant directory and can suspend any workspace.",
  },

  {
    id: "tenant_owner",

    label: "Tenant Owner",

    scope: "tenant",

    description:
      "Single accountable owner of a workspace. Full commercial and administrative control.",
  },

  {
    id: "tenant_admin",

    label: "Tenant Admin",

    scope: "tenant",

    description:
      "Runs day-to-day administration: users, roles, configuration, and approvals.",
  },

  {
    id: "sales_manager",

    label: "Sales Manager",

    scope: "tenant",

    description:
      "Owns the pipeline, the team targets, and lead-to-booking conversion.",
  },

  {
    id: "sales_agent",

    label: "Sales Agent",

    scope: "tenant",

    description:
      "Works assigned leads and drafts bookings for manager approval.",
  },

  {
    id: "recovery_officer",

    label: "Recovery / Collection Officer",

    scope: "tenant",

    description:
      "Chases overdue instalments and manages recovery on delinquent accounts.",
  },

  {
    id: "accounts_officer",

    label: "Accounts Officer",

    scope: "tenant",

    description:
      "Books receipts, reconciles ledgers, and certifies the payment trail.",
  },

  {
    id: "project_manager",

    label: "Project / Construction Manager",

    scope: "tenant",

    description:
      "Controls project delivery, inventory readiness, and handover milestones.",
  },

  {
    id: "procurement_officer",

    label: "Procurement Officer",

    scope: "tenant",

    description: "Raises and approves supplier orders and cost commitments.",
  },

  {
    id: "dealer_partner",

    label: "Dealer / Channel Partner",

    scope: "tenant",

    description:
      "External channel. Restricted to their own allocated units and allocations.",
  },

  {
    id: "customer",

    label: "Customer",

    scope: "tenant",

    description:
      "Buyer. Sees only their own bookings, statements, and payment history.",
  },
]

export const ROLE_LABELS: Record<RoleId, string> = ROLES.reduce(
  (acc, role) => {
    acc[role.id] = role.label

    return acc
  },

  {} as Record<RoleId, string>,
)

/** Roles that manage other people. Used to decide who can be invited as what. */

export const ASSIGNABLE_ROLE_IDS: RoleId[] = ROLES.filter(
  (role) => role.scope === "tenant",
).map((role) => role.id)

export function permissionId(module: PermissionModule, action: Action): string {
  return `${module}.${action}`
}

export interface ParsedPermissionId {
  module: PermissionModule
  action: Action
}

export function parsePermissionId(id: string): ParsedPermissionId | null {
  const separator = id.indexOf(".")

  if (separator < 1) return null

  const module = id.slice(0, separator) as PermissionModule

  const action = id.slice(separator + 1) as Action

  if (!MODULES.includes(module) || !ACTIONS.includes(action)) return null

  return { module, action }
}

/**
 * Platform default grants, seeded into `role_permission_defaults` on first run.
 *
 * This is seed data, not a runtime rule: the resolver only ever reads the
 * database. A tenant admin can later add an override that flips any of these.
 *
 * `*` expands to every module/action pair and is expanded during seeding, so
 * the table itself holds explicit rows.
 */

interface RoleGrantSpec {
  all?: true
  grants: string[]
}

const DEFAULT_GRANTS: Record<RoleId, RoleGrantSpec> = {
  platform_super_admin: { all: true, grants: [] },

  tenant_owner: { all: true, grants: [] },

  tenant_admin: {
    grants: [
      // The workspace overview. Every other role carries this grant, and the

      // app routes to /dashboard after sign-in, so omitting it left a Tenant

      // Admin staring at the not-found screen on their very first page.

      "dashboard.view",

      // Administration surface.

      "users.view",

      "users.create",

      "users.edit",

      "users.delete",

      "settings.view",

      "settings.edit",

      // Reading the workspace's event trail is an oversight duty, not a
      // configuration one, so it is its own module - but it belongs to the same
      // pair of roles that already administer settings and members.

      "audit.view",

      // Commercial oversight, approvals but not deletion.

      "projects.view",

      "projects.edit",

      "inventory.view",

      "inventory.edit",

      // Administration owns the stock state: it is the role that publishes a
      // project and answers for what its units are called.

      "inventory.change_status",

      "leads.view",

      "sales_agents.view",

      "sales_agents.create",

      "sales_agents.edit",

      "dealers.view",

      "dealers.create",

      "dealers.edit",

      "bookings.view",

      "bookings.edit",

      "bookings.approve",

      "approvals.view",

      "approvals.approve",

      "payments.view",

      "payments.edit",

      "payments.approve",

      "customers.view",

      // Expenses and vendors are the payable side of the money trail, so an
      // administrator sees and edits both; deleting a supplier or a spend
      // record is not on the menu — the trail stays.

      "expenses.view",

      "expenses.create",

      "expenses.edit",

      "expenses.approve",

      "vendors.view",

      "vendors.create",

      "vendors.edit",

      // The build plan and the purchase trail are administered - phases are
      // archived rather than deleted, and a PO's life is a status walk, so
      // administration gets neither module's `delete`.

      "construction.view",

      "construction.create",

      "construction.edit",

      "procurement.view",

      "procurement.create",

      "procurement.edit",

      // Signing paperwork is administered end to end: templates released,
      // envelopes sent and voided.

      "signatures.view",

      "signatures.create",

      "signatures.edit",

      "signatures.approve",

      // Documents are the file trail behind records administration already owns,
      // and tickets are the customer's side of the same desk. Neither is
      // deletable from here: a document goes with the record it hangs off.

      "documents.view",

      "documents.create",

      "documents.edit",

      // Administration certifies the file trail it owns. Verification is deliberately
      // *not* paired with `create`: whoever uploads a document has to ask a colleague to
      // sign for it, which is the one rule that stops a workspace where every file is
      // green because the person who filed it said so.

      "documents.verify",

      "tickets.view",

      "tickets.create",

      "tickets.edit",

      "campaigns.view",

      "campaigns.create",

      "campaigns.edit",

      "reports.view",

      // Administers the chase ladder itself - the offsets, the window, the
      // channels - and can send or retry from the ledger when a customer calls
      // in about a message.

      "reminders.view",

      "reminders.edit",

      "assistant.view",
    ],
  },

  sales_manager: {
    grants: [
      "dashboard.view",

      "projects.view",

      "inventory.view",

      "leads.view",

      "leads.create",

      "leads.edit",

      "leads.delete",

      "sales_agents.view",

      "sales_agents.create",

      "sales_agents.edit",

      "dealers.view",

      "dealers.create",

      "dealers.edit",

      "bookings.view",

      "bookings.create",

      "bookings.edit",

      "bookings.approve",

      "approvals.view",

      "approvals.approve",

      "customers.view",

      "customers.create",

      "customers.edit",

      "payments.view",

      // The sales desk owns the paperwork behind a sale, the requests that come
      // in from buyers, and the campaigns that produce the pipeline - including
      // retiring one, which is a decision about a channel rather than a record.
      // Sale agreements go out for signature from this desk.

      "documents.view",

      "documents.create",

      "documents.edit",

      // The desk that files a sale's paperwork also certifies it - but a document this
      // desk uploaded is verified by a peer, never by its own uploader.

      "documents.verify",

      "signatures.view",

      "signatures.create",

      "signatures.edit",

      "signatures.approve",

      "tickets.view",

      "tickets.create",

      "tickets.edit",

      "campaigns.view",

      "campaigns.create",

      "campaigns.edit",

      "campaigns.delete",

      "reports.view",

      "assistant.view",
    ],
  },

  sales_agent: {
    grants: [
      "dashboard.view",

      "projects.view",

      "inventory.view",

      "leads.view",

      "leads.create",

      "leads.edit",

      "bookings.view",

      "bookings.create",

      "approvals.view",

      "customers.view",

      "customers.create",

      "payments.view",

      // Works the documents and tickets a sale produces, and reads the campaign
      // its leads came from - but does not decide the campaign's life or death.
      // May put an envelope out for signature; releasing a template stays above.

      "documents.view",

      "documents.create",

      "signatures.view",

      "signatures.create",

      "tickets.view",

      "tickets.create",

      "tickets.edit",

      "campaigns.view",

      "assistant.view",
    ],
  },

  recovery_officer: {
    grants: [
      "dashboard.view",

      "customers.view",

      "payments.view",

      "payments.edit",

      "approvals.view",

      "bookings.view",

      "reports.view",

      // Reads and runs the chase: the message ledger is this desk's daily
      // screen, and a retry or a manual send is exactly the work it does.

      "reminders.view",

      "reminders.edit",

      // Chases the money and reads what the file and the customer's requests say
      // about it; files nothing and answers nothing.

      "documents.view",

      "tickets.view",

      "assistant.view",
    ],
  },

  accounts_officer: {
    grants: [
      "dashboard.view",

      "payments.view",

      "payments.create",

      "payments.edit",

      "payments.approve",

      "approvals.view",

      "approvals.approve",

      "bookings.view",

      "customers.view",

      // The desk that books receipts also certifies what leaves the account:
      // record an expense, submit it, sign a peer's expense, mark it paid.

      "expenses.view",

      "expenses.create",

      "expenses.edit",

      "expenses.approve",

      "vendors.view",

      "vendors.create",

      "vendors.edit",

      "vendors.approve",

      // Signs the purchase trail's side of the ledger off: a requisition or a
      // PO that clears this desk becomes a commitment. Construction is read
      // only to put a tagged expense in context.

      "construction.view",

      "procurement.view",

      "procurement.approve",

      "reports.view",

      "reports.create",

      // Reads the receipts and invoices behind money it has already booked, and
      // reads the requests that arrive about that money without answering them.

      "documents.view",

      "documents.create",

      "documents.edit",

      // The accounts desk verifies the ID copies and payment proofs behind money it has
      // already booked, and closes a month it has reported from.

      "documents.verify",

      "tickets.view",

      // Reads what the customer was told and when - the desk booking receipts
      // answers "did they get the demand notice?" - but the sending stays with
      // the chasing roles.

      "reminders.view",

      "assistant.view",
    ],
  },

  project_manager: {
    grants: [
      "dashboard.view",

      "projects.view",

      "projects.create",

      "projects.edit",

      "inventory.view",

      "inventory.create",

      "inventory.edit",

      // Controls inventory readiness, so it may take a unit off the market or put
      // it back. It still may not delete stock — that stays with administration.

      "inventory.change_status",

      // Issuing a quotation names a lead or customer on the document, so the role
      // that quotes stock is granted read access to those recipient catalogues.
      // This is view-only: it may not create, edit, or delete a lead or customer.

      "leads.view",

      "customers.view",

      "bookings.view",

      "approvals.view",

      // A project manager raises project and construction spend but does not
      // sign off on it — the finance desk does that.

      "expenses.view",

      "expenses.create",

      // Project paperwork — permits, NOCs, completion certificates — is filed
      // against the project and the unit it belongs to.

      "documents.view",

      "documents.create",

      "documents.edit",

      "tickets.view",

      "vendors.view",

      // The build is this role's own desk: phases, tasks, site logs, and the
      // contractor list. It raises requisitions but does not sign them — the
      // finance desk does that — and may not delete a phase out from under
      // tagged spend, so no `delete` here either.

      "construction.view",

      "construction.create",

      "construction.edit",

      "procurement.view",

      "procurement.create",

      "reports.view",

      "assistant.view",
    ],
  },

  procurement_officer: {
    grants: [
      "dashboard.view",

      "projects.view",

      "inventory.view",

      "inventory.create",

      "inventory.edit",

      // Raises and edits supplier spend and reads the vendor catalogue; does not
      // approve its own submissions (a different account officer signs off).

      "expenses.view",

      "expenses.create",

      "expenses.edit",

      "vendors.view",

      "vendors.create",

      "vendors.edit",

      // Procurement's own module, end to end except the signature that
      // approves a requisition or a PO - maker-checker, same as expenses.
      // Reads the build so a phase tag on an order means something.

      "procurement.view",

      "procurement.create",

      "procurement.edit",

      "construction.view",

      // Files the supplier invoices it raises spend against, and nothing else:
      // the per-type document gate keeps it out of the sale and customer files.

      "documents.view",

      "documents.create",

      "tickets.view",

      "reports.view",

      "assistant.view",
    ],
  },

  dealer_partner: {
    grants: [
      "dashboard.view",

      "dealers.view",

      "projects.view",

      "inventory.view",

      "leads.view",

      "leads.create",

      "bookings.view",

      "bookings.create",

      "approvals.view",

      "customers.view",

      "payments.view",

      // Reads the campaign its introduced leads came from, so it can see what it
      // is being credited with. No campaign writes.

      "campaigns.view",

      "assistant.view",
    ],
  },

  customer: {
    // `dashboard.view` is kept only so a signed-in buyer lands somewhere real;
    // App.tsx routes the `customer` role straight into the portal instead of the
    // staff dashboard. The tenant-wide `bookings.view` and `payments.view` this
    // role used to hold are gone: they let one buyer read every other buyer's
    // records through the staff API. Portal reads are scoped by
    // `customer_portal_links` in their own routes, which need no grant row.
    grants: ["dashboard.view"],
  },
}

export type SeededGrant = {
  roleId: RoleId

  permissionIds: string[]
}

/** Full, expanded list of default grants to seed. */

export function defaultGrants(): SeededGrant[] {
  const all: string[] = []

  for (const module of MODULES) {
    for (const action of ACTIONS) all.push(permissionId(module, action))
  }

  return ROLES.map((role) => {
    const config = DEFAULT_GRANTS[role.id]

    return {
      roleId: role.id,

      permissionIds: config.all ? all : [...config.grants].sort(),
    }
  })
}
