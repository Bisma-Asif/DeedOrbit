/**
 * API server.
 *
 * A route table maps `METHOD /path/:param` to a handler. The three checks are
 * not applied here — each handler declares what it needs by calling
 * `requireAuth` / `requirePermission`, so a route is readable in one screen and
 * a public route is obviously public.
 *
 * Runs on `node:http` with no framework, and TypeScript is executed directly by
 * Node 24, so there is no build step for the backend and no runtime
 * dependencies to deploy.
 */

import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http"

import { realpathSync } from "node:fs"

import { fileURLToPath } from "node:url"

import {
  clientIp,
  parseCookies,
  sendError,
  sendJson,
  type RequestContext,
} from "./http.ts"

import { getDb, closeDb } from "./db.ts"

import {
  seed,
  isSeeded,
  seedOrganizationDefaults,
  seedPermissionCatalogue,
  seedCommunicationTemplates,
  seedPlatformBilling,
  seedOperationalModules,
} from "./seed.ts"

import { brand } from "../shared/brand.ts"

import { runReminderTick } from "./jobs/payment-reminders.ts"

import { runDocumentExpiryScanAll } from "./jobs/document-reminders.ts"

import * as auth from "./routes/auth.ts"

import * as users from "./routes/users.ts"

import * as tenants from "./routes/tenants.ts"

import * as org from "./routes/organization.ts"

import * as projects from "./routes/projects.ts"
import * as projectStructure from "./routes/project-structure.ts"
import * as projectInventory from "./routes/project-inventory.ts"
import * as unitStatuses from "./routes/unit-statuses.ts"
import * as inventoryOptions from "./routes/inventory-options.ts"
import * as leads from "./routes/leads.ts"
import * as customers from "./routes/customers.ts"
import * as salesAgents from "./routes/sales-agents.ts"
import * as dealers from "./routes/dealers.ts"
import * as bookings from "./routes/bookings.ts"

import * as approvals from "./routes/approvals.ts"

import * as payments from "./routes/payments.ts"

import * as lateFees from "./routes/late-fees.ts"

import * as refunds from "./routes/refunds.ts"

import * as transfers from "./routes/transfers.ts"

import * as collections from "./routes/collections.ts"

import * as assistant from "./routes/assistant.ts"

import * as chartOfAccounts from "./routes/chart-of-accounts.ts"

import * as expenses from "./routes/expenses.ts"

import * as vendors from "./routes/vendors.ts"

import * as construction from "./routes/construction.ts"

import * as procurement from "./routes/procurement.ts"

import * as signatures from "./routes/signatures.ts"

import * as integrations from "./routes/integrations.ts"

import * as journal from "./routes/journal.ts"

import * as documents from "./routes/documents.ts"

import * as fileAccess from "./file-access.ts"

import * as documentVerification from "./routes/document-verification.ts"

import * as tickets from "./routes/tickets.ts"

import * as communications from "./routes/communications.ts"

import * as campaigns from "./routes/campaigns.ts"

import * as portal from "./routes/portal.ts"

import * as reports from "./routes/reports.ts"

import * as dashboard from "./routes/dashboard.ts"

import * as dashboardOverviewRoutes from "./routes/dashboard-overview.ts"

import * as dashboardSampleRoutes from "./routes/dashboard-sample.ts"

import * as search from "./routes/search.ts"

import * as savedViews from "./routes/saved-views.ts"

import * as auditLog from "./routes/audit.ts"

import * as notifications from "./routes/notifications.ts"

import * as platform from "./routes/platform.ts"

import {
  SESSION_COOKIE,
  purgeExpiredSessions,
  verifySessionToken,
} from "./session.ts"

import { requireAuth } from "./middleware.ts"

type Handler = (ctx: RequestContext) => Promise<unknown> | unknown

type Route = {
  method: string

  pattern: string

  handler: Handler

  /** Skips the route table lookup when false (health checks). */

  public: boolean
}

const routes: Route[] = [
  // --- health -------------------------------------------------------------

  { method: "GET", pattern: "/api/health", handler: health, public: true },

  // --- auth ---------------------------------------------------------------

  {
    method: "GET",

    pattern: "/api/auth/session",

    handler: auth.getSession,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/auth/signup",

    handler: auth.signup,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/auth/login",

    handler: auth.login,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/auth/twofa/verify",

    handler: auth.verifyTwofa,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/auth/logout",

    handler: auth.logout,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/auth/forgot-password",

    handler: auth.forgotPassword,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/auth/reset-password",

    handler: auth.resetPassword,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/auth/switch-tenant",

    handler: auth.switchTenant,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/auth/change-password",

    handler: auth.changePassword,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/auth/twofa/enroll",

    handler: auth.enrollTwofa,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/auth/twofa/confirm",

    handler: auth.confirmTwofaEnrolment,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/auth/twofa/disable",

    handler: auth.disableTwofa,

    public: true,
  },

  {
    method: "GET",

    pattern: "/api/auth/sessions",

    handler: auth.listMySessions,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/auth/sessions/revoke-others",

    handler: auth.revokeOtherSessions,

    public: true,
  },

  {
    method: "GET",

    pattern: "/api/auth/permissions",

    handler: myPermissions,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/auth/dev-generate-password",

    handler: auth.suggestPassword,

    public: true,
  },

  // --- users & roles ------------------------------------------------------

  {
    method: "GET",

    pattern: "/api/users",

    handler: users.listUsers,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/users/invite",

    handler: users.inviteUser,

    public: true,
  },

  {
    method: "PATCH",

    pattern: "/api/users/:id",

    handler: users.updateUser,

    public: true,
  },

  {
    method: "DELETE",

    pattern: "/api/users/:id",

    handler: users.deleteUser,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/users/:id/status",

    handler: users.setUserStatus,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/users/:id/revoke-sessions",

    handler: users.revokeUserSessions,

    public: true,
  },

  {
    method: "GET",

    pattern: "/api/users/:id/sessions",

    handler: users.listUserSessions,

    public: true,
  },

  {
    method: "DELETE",

    pattern: "/api/users/:id/sessions/:sessionId",

    handler: users.revokeUserSession,

    public: true,
  },

  {
    method: "PUT",

    pattern: "/api/users/:id/branches",

    handler: users.updateUserBranches,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/users/:id/force-password-reset",

    handler: users.forcePasswordReset,

    public: true,
  },

  {
    method: "GET",

    pattern: "/api/users/:id/activity",

    handler: users.listUserActivity,

    public: true,
  },

  {
    method: "GET",

    pattern: "/api/roles",

    handler: users.listRoles,

    public: true,
  },

  {
    method: "GET",

    pattern: "/api/roles/:id",

    handler: users.getRole,

    public: true,
  },

  {
    method: "PUT",

    pattern: "/api/roles/:id/permissions",

    handler: users.updateRolePermissions,

    public: true,
  },

  {
    method: "GET",

    pattern: "/api/audit",

    handler: users.listAuditLog,

    public: true,
  },

  // --- tenants ------------------------------------------------------------

  {
    method: "GET",

    pattern: "/api/tenants",

    handler: tenants.listTenants,

    public: true,
  },

  {
    method: "GET",

    pattern: "/api/tenants/:id",

    handler: tenants.getTenant,

    public: true,
  },

  {
    method: "PATCH",

    pattern: "/api/tenants/:id",

    handler: tenants.updateTenant,

    public: true,
  },

  // --- organization settings ------------------------------------------------

  // Under /api/settings and deliberately carrying no tenant id: the workspace

  // comes from the session, so there is no caller-supplied value to tamper with.

  {
    method: "GET",

    pattern: "/api/settings/organization",

    handler: org.getOrganization,

    public: true,
  },

  {
    method: "PATCH",

    pattern: "/api/settings/organization",

    handler: org.updateOrganization,

    public: true,
  },

  {
    method: "PUT",

    pattern: "/api/settings/organization/logo",

    handler: org.uploadOrganizationLogo,

    public: true,
  },

  {
    method: "DELETE",

    pattern: "/api/settings/organization/logo",

    handler: org.removeOrganizationLogo,

    public: true,
  },

  {
    method: "GET",

    pattern: "/api/settings/branches",

    handler: org.listBranches,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/settings/branches",

    handler: org.createBranch,

    public: true,
  },

  {
    method: "GET",

    pattern: "/api/settings/branches/:id",

    handler: org.getBranch,

    public: true,
  },

  {
    method: "PATCH",

    pattern: "/api/settings/branches/:id",

    handler: org.updateBranch,

    public: true,
  },

  {
    method: "DELETE",

    pattern: "/api/settings/branches/:id",

    handler: org.archiveBranch,

    public: true,
  },

  {
    method: "GET",

    pattern: "/api/settings/numbering",

    handler: org.listNumbering,

    public: true,
  },

  {
    method: "PUT",

    pattern: "/api/settings/numbering",

    handler: org.updateNumbering,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/settings/numbering/:kind/next",

    handler: org.issueNextNumber,

    public: true,
  },

  // --- projects ------------------------------------------------------------

  // The root commercial record. Reads need `projects.view`, writes need
  // `projects.create` or `projects.edit`, which the handlers check for
  // themselves so the table above stays a plain dispatch list.

  {
    method: "GET",

    pattern: "/api/projects",

    handler: projects.listProjects,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/projects",

    handler: projects.createProject,

    public: true,
  },

  {
    method: "GET",

    pattern: "/api/projects/:id",

    handler: projects.getProject,

    public: true,
  },

  {
    method: "PATCH",

    pattern: "/api/projects/:id",

    handler: projects.updateProject,

    public: true,
  },

  // --- leads ---------------------------------------------------------------
  // Lead records are tenant-scoped; each handler enforces the leads permission.
  {
    method: "GET",
    pattern: "/api/leads",
    handler: leads.listLeads,
    public: true,
  },
  {
    method: "POST",
    pattern: "/api/leads/stages",
    handler: leads.createLeadStage,
    public: true,
  },
  {
    method: "PATCH",
    pattern: "/api/leads/stages/:stageId",
    handler: leads.updateLeadStage,
    public: true,
  },
  {
    method: "DELETE",
    pattern: "/api/leads/stages/:stageId",
    handler: leads.deleteLeadStage,
    public: true,
  },
  {
    method: "POST",
    pattern: "/api/leads/import",
    handler: leads.importLeadsPlaceholder,
    public: true,
  },
  {
    method: "POST",
    pattern: "/api/leads",
    handler: leads.createLead,
    public: true,
  },
  {
    method: "GET",
    pattern: "/api/leads/:id",
    handler: leads.getLead,
    public: true,
  },
  {
    method: "PATCH",
    pattern: "/api/leads/:id",
    handler: leads.updateLead,
    public: true,
  },
  {
    method: "POST",
    pattern: "/api/leads/:id/activities",
    handler: leads.addLeadNote,
    public: true,
  },
  {
    method: "POST",
    pattern: "/api/leads/:id/convert",
    handler: leads.convertLeadToCustomer,
    public: true,
  },
  {
    method: "GET",
    pattern: "/api/customers",
    handler: customers.listCustomers,
    public: true,
  },
  {
    method: "POST",
    pattern: "/api/customers",
    handler: customers.createCustomer,
    public: true,
  },
  {
    method: "GET",
    pattern: "/api/customers/:id",
    handler: customers.getCustomer,
    public: true,
  },
  {
    method: "GET",
    pattern: "/api/customers/:id/edit-history",
    handler: customers.listCustomerEditHistory,
    public: true,
  },
  {
    method: "GET",
    pattern: "/api/sales-agents",
    handler: salesAgents.listSalesAgents,
    public: true,
  },
  {
    method: "POST",
    pattern: "/api/sales-agents/teams",
    handler: salesAgents.createSalesTeam,
    public: true,
  },
  {
    method: "PATCH",
    pattern: "/api/sales-agents/teams/:teamId",
    handler: salesAgents.updateSalesTeam,
    public: true,
  },
  {
    method: "PUT",
    pattern: "/api/sales-agents/:agentId/team",
    handler: salesAgents.assignAgentToTeam,
    public: true,
  },
  {
    method: "PUT",
    pattern: "/api/sales-agents/:agentId/targets",
    handler: salesAgents.saveAgentTargets,
    public: true,
  },
  {
    method: "GET",
    pattern: "/api/dealers",
    handler: dealers.listDealers,
    public: true,
  },
  {
    method: "POST",
    pattern: "/api/dealers",
    handler: dealers.createDealer,
    public: true,
  },
  {
    method: "GET",
    pattern: "/api/dealers/:id",
    handler: dealers.getDealer,
    public: true,
  },
  {
    method: "PATCH",
    pattern: "/api/dealers/:id",
    handler: dealers.updateDealer,
    public: true,
  },
  {
    method: "POST",
    pattern: "/api/dealers/:id/leads/:leadId",
    handler: dealers.assignDealerLead,
    public: true,
  },
  {
    method: "DELETE",
    pattern: "/api/dealers/:id/leads/:leadId",
    handler: dealers.unassignDealerLead,
    public: true,
  },
  {
    method: "POST",
    pattern: "/api/dealers/:id/commission-rules",
    handler: dealers.createCommissionRule,
    public: true,
  },
  {
    method: "PATCH",
    pattern: "/api/dealers/:id/commission-rules/:ruleId",
    handler: dealers.updateCommissionRule,
    public: true,
  },
  {
    method: "DELETE",
    pattern: "/api/dealers/:id/commission-rules/:ruleId",
    handler: dealers.deleteCommissionRule,
    public: true,
  },
  {
    method: "POST",
    pattern: "/api/dealers/:id/bookings",
    handler: dealers.createDealerBooking,
    public: true,
  },
  {
    method: "PATCH",
    pattern: "/api/dealers/:id/bookings/:bookingId",
    handler: dealers.updateDealerBooking,
    public: true,
  },
  {
    method: "POST",
    pattern: "/api/dealers/:id/bookings/:bookingId/payments",
    handler: dealers.payDealerCommission,
    public: true,
  },
  {
    method: "PATCH",
    pattern: "/api/customers/:id",
    handler: customers.updateCustomer,
    public: true,
  },

  // --- project structure ----------------------------------------------------
  // The hierarchy inside one project. Reads need `projects.view`; every write
  // needs `projects.edit`, including creating a node, because the role meant to
  // configure a workspace (tenant admin) deliberately does not hold
  // `projects.create`. See `server/routes/project-structure.ts` for the tree
  // rules — no reparenting, and a delete that refuses a node with children.

  {
    method: "GET",

    pattern: "/api/projects/:id/structure",

    handler: projectStructure.listStructure,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/projects/:id/structure",

    handler: projectStructure.createStructureNode,

    public: true,
  },

  {
    method: "PATCH",

    pattern: "/api/projects/:id/structure/:nodeId",

    handler: projectStructure.renameStructureNode,

    public: true,
  },

  {
    method: "PATCH",

    pattern: "/api/projects/:id/structure/:nodeId/move",

    handler: projectStructure.moveStructureNode,

    public: true,
  },

  {
    method: "DELETE",

    pattern: "/api/projects/:id/structure/:nodeId",

    handler: projectStructure.deleteStructureNode,

    public: true,
  },

  // --- project inventory ----------------------------------------------------
  // The units for sale inside one project, each attached to a structure node.
  // Reads need `inventory.view`; every write needs `inventory.edit`, including
  // create and delete, because the two roles that publish a project's stock
  // (tenant admin, project manager) hold `inventory.edit` and not
  // `inventory.create`/`inventory.delete`. See `server/routes/project-inventory.ts`.

  {
    method: "GET",

    pattern: "/api/projects/:id/units",

    handler: projectInventory.listUnits,

    public: true,
  },

  {
    method: "GET",

    // Registered before the `:unitId` routes below purely so the intent reads in
    // order; the matcher is by segment count, so the two cannot collide.
    pattern: "/api/projects/:id/units/structure",

    handler: projectInventory.listUnitStructure,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/projects/:id/units",

    handler: projectInventory.createUnit,

    public: true,
  },

  {
    method: "POST",

    // Bulk import. Four segments like `/units/:unitId`, but no PATCH/DELETE shares the
    // method, so the literal cannot be mistaken for a unit id.
    pattern: "/api/projects/:id/units/import",

    handler: projectInventory.importUnits,

    public: true,
  },

  {
    method: "PATCH",

    pattern: "/api/projects/:id/units/:unitId",

    handler: projectInventory.updateUnit,

    public: true,
  },

  {
    method: "DELETE",

    pattern: "/api/projects/:id/units/:unitId",

    handler: projectInventory.deleteUnit,

    public: true,
  },

  // The two history reads. Registered after the `:unitId` routes because the matcher
  // is by segment count and by method, so `/units/status-changes` and
  // `/units/:unitId/status-history` cannot be confused with `/units/:unitId` — but the
  // literal reads better declared after the unit routes it hangs off.

  {
    method: "GET",

    pattern: "/api/projects/:id/units/status-changes",

    handler: projectInventory.listProjectStatusChanges,

    public: true,
  },

  {
    method: "GET",

    pattern: "/api/projects/:id/units/:unitId/status-history",

    handler: projectInventory.listUnitStatusHistory,

    public: true,
  },

  {
    method: "GET",

    pattern: "/api/projects/:id/units/:unitId/quotations",

    handler: projectInventory.listUnitQuotations,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/projects/:id/units/:unitId/quotations",

    handler: projectInventory.createUnitQuotation,

    public: true,
  },

  // --- workspace status vocabulary -------------------------------------------
  // The statuses a workspace's units may be in. Deliberately not under `/projects`:
  // a status belongs to the workspace, outlives any single project, and is managed as
  // configuration rather than per unit. Reads need `inventory.view` because anybody
  // who can see a unit must be able to read its status name and colour; writes need
  // `settings.edit`. See `server/routes/unit-statuses.ts`.

  {
    method: "GET",

    pattern: "/api/unit-statuses",

    handler: unitStatuses.listStatuses,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/unit-statuses",

    handler: unitStatuses.createStatus,

    public: true,
  },

  {
    method: "PATCH",

    pattern: "/api/unit-statuses/:id",

    handler: unitStatuses.updateStatus,

    public: true,
  },

  // --- property category vocabulary ----------------------------------------
  // The nine dropdown lists migration 0054 put behind `inventory_category_options`:
  // property type, usage, sub-type, furnishing, sale mode, possession, ownership, size
  // unit and amenities. Workspace configuration rather than per-project data, exactly as
  // the status list above is: a company's word for a unit outlives any one project.
  // Reads need `inventory.view`, writes need `settings.edit`, and the counts come back
  // with the list so retiring an option can warn about the units still holding it. See
  // `server/routes/inventory-options.ts`.

  {
    method: "GET",

    pattern: "/api/inventory-options",

    handler: inventoryOptions.listOptions,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/inventory-options",

    handler: inventoryOptions.createOption,

    public: true,
  },

  {
    method: "PATCH",

    pattern: "/api/inventory-options/:id",

    handler: inventoryOptions.updateOption,

    public: true,
  },

  {
    method: "GET",

    // Category-wise counts for the summary cards and the dashboard breakdown; `?project=`
    // narrows it to one project's stock.
    pattern: "/api/inventory-categories",

    handler: inventoryOptions.categorySummary,

    public: true,
  },

  // --- bookings -------------------------------------------------------------
  // A formal booking links a customer to a unit and, as a consequence, drives the
  // unit to its built-in `booked` status (cancelling returns it to `available`).
  // Reads need `bookings.view`, create needs `bookings.create`, cancel needs
  // `bookings.approve`; the status move is a system write that needs no inventory
  // grant. See `server/routes/bookings.ts`.

  {
    method: "GET",

    pattern: "/api/bookings",

    handler: bookings.listBookings,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/bookings",

    handler: bookings.createBooking,

    public: true,
  },

  {
    method: "GET",

    // Declared before the `/cancel` action route for reading order only; the matcher
    // is by segment count and method, so the two cannot collide.
    pattern: "/api/bookings/:id",

    handler: bookings.getBooking,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/bookings/:id/cancel",

    handler: bookings.cancelBooking,

    public: true,
  },

  // --- approvals ------------------------------------------------------------
  // The maker-checker queue. Reads need `approvals.view`; approve/reject need
  // `approvals.approve`, and an approver may not clear a request they raised. The
  // queue is generic; the booking and cancellation triggers feed it from the booking
  // routes. See `server/routes/approvals.ts`.

  {
    method: "GET",

    pattern: "/api/approvals",

    handler: approvals.listApprovals,

    public: true,
  },

  {
    method: "GET",

    pattern: "/api/approvals/:id",

    handler: approvals.getApproval,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/approvals/:id/approve",

    handler: approvals.approveApproval,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/approvals/:id/reject",

    handler: approvals.rejectApproval,

    public: true,
  },

  // --- payment plans --------------------------------------------------------
  // A confirmed booking's financing schedule. Reading and recording money need
  // `payments.view` / `payments.edit`; confirming a plan needs `payments.create`. The
  // plan routes hang off the booking id, and recording hangs off the installment id.
  // See `server/routes/payments.ts`.

  {
    method: "GET",

    pattern: "/api/bookings/:id/payment-plan",

    handler: payments.getBookingPaymentPlan,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/bookings/:id/payment-plan/confirm",

    handler: payments.confirmPaymentPlan,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/payment-installments/:id/payments",

    handler: payments.recordInstallmentPayment,

    public: true,
  },

  // --- approval policies (settings) ----------------------------------------

  {
    method: "GET",

    pattern: "/api/settings/approval-policies",

    handler: org.getApprovalPolicies,

    public: true,
  },

  {
    method: "PATCH",

    pattern: "/api/settings/approval-policies",

    handler: org.updateApprovalPolicies,

    public: true,
  },

  // --- recorded payments, receipts, and the customer ledger ------------------
  // Money received is recorded once and allocated across a customer's schedule; each
  // recording mints a receipt and writes a ledger debit. See `server/routes/payments.ts`.

  {
    method: "POST",

    pattern: "/api/payments",

    handler: payments.recordPayment,

    public: true,
  },

  {
    method: "GET",

    pattern: "/api/payments",

    handler: payments.listPayments,

    public: true,
  },

  {
    method: "GET",

    pattern: "/api/payments/:id",

    handler: payments.readPaymentReceipt,

    public: true,
  },

  {
    method: "GET",

    pattern: "/api/customers/:id/open-installments",

    handler: payments.listCustomerOpenInstallments,

    public: true,
  },

  {
    method: "GET",

    pattern: "/api/customers/:id/ledger",

    handler: payments.listCustomerLedger,

    public: true,
  },

  // --- late fees -------------------------------------------------------------

  {
    method: "GET",

    pattern: "/api/settings/late-fees",

    handler: lateFees.getLateFeeRules,

    public: true,
  },

  {
    method: "PATCH",

    pattern: "/api/settings/late-fees",

    handler: lateFees.updateLateFeeRules,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/late-fee-assessments/:id/waive",

    handler: lateFees.requestLateFeeWaiver,

    public: true,
  },

  // --- refunds ---------------------------------------------------------------

  {
    method: "POST",

    pattern: "/api/refunds",

    handler: refunds.requestRefund,

    public: true,
  },

  {
    method: "GET",

    pattern: "/api/customers/:id/refunds",

    handler: refunds.listRefunds,

    public: true,
  },

  // --- cancellation rules and preview ---------------------------------------

  {
    method: "GET",

    pattern: "/api/settings/cancellation-rules",

    handler: bookings.getCancellationRules,

    public: true,
  },

  {
    method: "PATCH",

    pattern: "/api/settings/cancellation-rules",

    handler: bookings.updateCancellationRules,

    public: true,
  },

  {
    method: "GET",

    pattern: "/api/bookings/:id/cancellation-preview",

    handler: bookings.cancellationPreview,

    public: true,
  },

  // --- transfers -------------------------------------------------------------

  {
    method: "POST",

    pattern: "/api/transfers",

    handler: transfers.requestTransfer,

    public: true,
  },

  {
    method: "GET",

    pattern: "/api/customers/:id/transfers",

    handler: transfers.listTransfersForCustomer,

    public: true,
  },

  // --- collections -----------------------------------------------------------

  {
    method: "GET",

    pattern: "/api/collections/summary",

    handler: collections.collectionsSummary,

    public: true,
  },

  {
    method: "GET",

    pattern: "/api/collections/overdue",

    handler: collections.collectionsOverdue,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/payment-installments/:id/assign",

    handler: collections.assignOfficer,

    public: true,
  },

  {
    method: "GET",

    pattern: "/api/settings/collection-targets",

    handler: collections.getCollectionTargets,

    public: true,
  },

  {
    method: "PATCH",

    pattern: "/api/settings/collection-targets",

    handler: collections.updateCollectionTargets,

    public: true,
  },

  // --- assistant -------------------------------------------------------------
  // "Ask DeedOrbit": one question in, one derived answer out. The handler
  // gates on `assistant.view` and re-checks the matched intent's own module,
  // so a role that cannot open Payments never sees overdue rows. See
  // `server/routes/assistant.ts`.

  {
    method: "POST",

    pattern: "/api/assistant/ask",

    handler: assistant.ask,

    public: true,
  },

  // --- chart of accounts ----------------------------------------------------
  // The tenant's mapping from each money-flow source to an external account
  // code. Reads need `settings.view`; writes need `settings.edit`. See
  // `server/routes/chart-of-accounts.ts`.

  {
    method: "GET",

    pattern: "/api/settings/chart-of-accounts",

    handler: chartOfAccounts.getChartOfAccounts,

    public: true,
  },

  {
    method: "PATCH",

    pattern: "/api/settings/chart-of-accounts",

    handler: chartOfAccounts.updateChartOfAccounts,

    public: true,
  },

  // --- journal export -------------------------------------------------------
  // The composed journal for a date range. Reads need `payments.view`.
  // See `server/routes/journal.ts`.

  {
    method: "GET",

    pattern: "/api/journal",

    handler: journal.getJournal,

    public: true,
  },

  // --- expenses -------------------------------------------------------------
  // The expense lifecycle: raise a draft, attach a receipt, submit through
  // maker-checker, then mark paid. See `server/routes/expenses.ts`.

  {
    method: "GET",

    pattern: "/api/expenses",

    handler: expenses.listExpenses,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/expenses",

    handler: expenses.createExpense,

    public: true,
  },

  {
    method: "GET",

    pattern: "/api/expenses/:id",

    handler: expenses.getExpense,

    public: true,
  },

  {
    method: "PATCH",

    pattern: "/api/expenses/:id",

    handler: expenses.updateExpense,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/expenses/:id/submit",

    handler: expenses.submitExpense,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/expenses/:id/mark-paid",

    handler: expenses.markExpensePaid,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/expenses/:id/attachments",

    handler: expenses.uploadExpenseAttachment,

    public: true,
  },

  {
    method: "GET",

    pattern: "/api/expenses/:id/attachments/:attachmentId",

    handler: expenses.downloadExpenseAttachment,

    public: true,
  },

  {
    method: "DELETE",

    pattern: "/api/expenses/:id/attachments/:attachmentId",

    handler: expenses.deleteExpenseAttachment,

    public: true,
  },

  // --- vendors --------------------------------------------------------------
  // Supplier profiles, contracts, invoices, payments, and the vendor ledger.
  // Reads need `vendors.view`; writes need `vendors.create` / `vendors.edit`.
  // See `server/routes/vendors.ts`.

  {
    method: "GET",

    pattern: "/api/vendors",

    handler: vendors.listVendors,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/vendors",

    handler: vendors.createVendor,

    public: true,
  },

  {
    method: "GET",

    pattern: "/api/vendors/:id",

    handler: vendors.getVendor,

    public: true,
  },

  {
    method: "PATCH",

    pattern: "/api/vendors/:id",

    handler: vendors.updateVendor,

    public: true,
  },

  {
    method: "GET",

    pattern: "/api/vendors/:id/contracts",

    handler: vendors.listVendorContracts,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/vendors/:id/contracts",

    handler: vendors.createVendorContract,

    public: true,
  },

  {
    method: "PATCH",

    pattern: "/api/vendors/:id/contracts/:contractId",

    handler: vendors.updateVendorContract,

    public: true,
  },

  {
    method: "GET",

    pattern: "/api/vendors/:id/invoices",

    handler: vendors.listVendorInvoices,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/vendors/:id/invoices",

    handler: vendors.createVendorInvoice,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/vendors/:id/invoices/:invoiceId/void",

    handler: vendors.voidVendorInvoice,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/vendors/:id/payments",

    handler: vendors.recordVendorPayment,

    public: true,
  },

  {
    method: "GET",

    pattern: "/api/vendors/:id/ledger",

    handler: vendors.listVendorLedger,

    public: true,
  },

  // --- construction ---------------------------------------------------------
  // Contractors, phases, tasks, and the site-progress log. Spend is never
  // stored here: a phase's actuals are the SUM of the expense and vendor
  // invoice rows tagged against it, derived on every read. A phase holding
  // tagged spend refuses deletion. See `server/routes/construction.ts`.

  {
    method: "GET",

    pattern: "/api/construction/contractors",

    handler: construction.listContractors,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/construction/contractors",

    handler: construction.createContractor,

    public: true,
  },

  {
    method: "PATCH",

    pattern: "/api/construction/contractors/:contractorId",

    handler: construction.updateContractor,

    public: true,
  },

  {
    method: "GET",

    pattern: "/api/construction/phases",

    handler: construction.listPhases,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/construction/phases",

    handler: construction.createPhase,

    public: true,
  },

  {
    method: "GET",

    pattern: "/api/construction/phases/:phaseId",

    handler: construction.getPhase,

    public: true,
  },

  {
    method: "PATCH",

    pattern: "/api/construction/phases/:phaseId",

    handler: construction.updatePhase,

    public: true,
  },

  {
    method: "DELETE",

    pattern: "/api/construction/phases/:phaseId",

    handler: construction.deletePhase,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/construction/phases/:phaseId/log-progress",

    handler: construction.logPhaseProgress,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/construction/phases/:phaseId/tasks",

    handler: construction.createTask,

    public: true,
  },

  {
    method: "PATCH",

    pattern: "/api/construction/tasks/:taskId",

    handler: construction.updateTask,

    public: true,
  },

  {
    method: "DELETE",

    pattern: "/api/construction/tasks/:taskId",

    handler: construction.deleteTask,

    public: true,
  },

  // --- procurement ---------------------------------------------------------
  // Materials and stock (derived as the SUM of movements, never stored),
  // purchase requisitions and orders approved through the maker-checker queue,
  // and goods receipts that write their own stock movements and may raise an
  // ordinary vendor invoice. PO numbers come from numbering settings. See
  // `server/routes/procurement.ts`.

  {
    method: "GET",

    pattern: "/api/procurement/materials",

    handler: procurement.listMaterials,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/procurement/materials",

    handler: procurement.createMaterial,

    public: true,
  },

  {
    method: "PATCH",

    pattern: "/api/procurement/materials/:materialId",

    handler: procurement.updateMaterial,

    public: true,
  },

  {
    method: "GET",

    pattern: "/api/procurement/movements",

    handler: procurement.listMovements,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/procurement/materials/:materialId/adjust",

    handler: procurement.adjustStock,

    public: true,
  },

  {
    method: "GET",

    pattern: "/api/procurement/requisitions",

    handler: procurement.listRequisitions,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/procurement/requisitions",

    handler: procurement.createRequisition,

    public: true,
  },

  {
    method: "GET",

    pattern: "/api/procurement/requisitions/:requisitionId",

    handler: procurement.getRequisition,

    public: true,
  },

  {
    method: "PATCH",

    pattern: "/api/procurement/requisitions/:requisitionId",

    handler: procurement.updateRequisition,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/procurement/requisitions/:requisitionId/submit",

    handler: procurement.submitRequisition,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/procurement/requisitions/:requisitionId/convert",

    handler: procurement.convertRequisitionToPo,

    public: true,
  },

  {
    method: "GET",

    pattern: "/api/procurement/purchase-orders",

    handler: procurement.listPurchaseOrders,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/procurement/purchase-orders",

    handler: procurement.createPurchaseOrder,

    public: true,
  },

  {
    method: "GET",

    pattern: "/api/procurement/purchase-orders/:poId",

    handler: procurement.getPurchaseOrder,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/procurement/purchase-orders/:poId/submit",

    handler: procurement.submitPurchaseOrder,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/procurement/purchase-orders/:poId/send",

    handler: procurement.sendPurchaseOrder,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/procurement/purchase-orders/:poId/close-or-cancel",

    handler: procurement.closePurchaseOrder,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/procurement/purchase-orders/:poId/receipts",

    handler: procurement.createGoodsReceipt,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/procurement/receipts/:grnId/void",

    handler: procurement.voidGoodsReceipt,

    public: true,
  },

  // --- documents & signatures ----------------------------------------------
  // Templates and envelopes for the in-app signing ceremony. The guarded
  // surface manages them; the two `/api/sign/*` routes are the public
  // ceremony, authorised by a hashed per-envelope token alone (no session).
  // On completion the agreement is filed back into `documents`. See
  // `server/routes/signatures.ts`.

  {
    method: "GET",

    pattern: "/api/signatures/templates",

    handler: signatures.listTemplates,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/signatures/templates",

    handler: signatures.createTemplate,

    public: true,
  },

  {
    method: "PATCH",

    pattern: "/api/signatures/templates/:templateId",

    handler: signatures.updateTemplate,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/signatures/templates/:templateId/release",

    handler: signatures.releaseTemplate,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/signatures/templates/:templateId/archive",

    handler: signatures.archiveTemplate,

    public: true,
  },

  {
    method: "GET",

    pattern: "/api/signatures/envelopes",

    handler: signatures.listEnvelopes,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/signatures/envelopes",

    handler: signatures.createEnvelope,

    public: true,
  },

  {
    method: "GET",

    pattern: "/api/signatures/envelopes/:envelopeId",

    handler: signatures.getEnvelope,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/signatures/envelopes/:envelopeId/send",

    handler: signatures.sendEnvelope,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/signatures/envelopes/:envelopeId/void",

    handler: signatures.voidEnvelope,

    public: true,
  },

  {
    method: "GET",

    pattern: "/api/sign/:token",

    handler: signatures.getSigningCeremony,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/sign/:token/sign",

    handler: signatures.signCeremony,

    public: true,
  },

  // --- integrations (Settings) ---------------------------------------------
  // API keys and webhook endpoints, gated on `settings.view`/`settings.edit`.
  // `GET /api/open/leads` is the one key-authenticated surface: the tenant
  // comes from the bearer key, not the request. Webhook delivery is a real
  // HTTP POST recorded in a delivery log. See `server/routes/integrations.ts`.

  {
    method: "GET",

    pattern: "/api/settings/integrations",

    handler: integrations.getIntegrations,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/settings/integrations/api-keys",

    handler: integrations.createApiKey,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/settings/integrations/api-keys/:apiKeyId/revoke",

    handler: integrations.revokeApiKey,

    public: true,
  },

  {
    method: "GET",

    pattern: "/api/settings/integrations/webhooks",

    handler: integrations.listEndpointsHandler,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/settings/integrations/webhooks",

    handler: integrations.createEndpoint,

    public: true,
  },

  {
    method: "PATCH",

    pattern: "/api/settings/integrations/webhooks/:endpointId",

    handler: integrations.updateEndpoint,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/settings/integrations/webhooks/:endpointId/test",

    handler: integrations.testEndpoint,

    public: true,
  },

  {
    method: "GET",

    pattern: "/api/settings/integrations/deliveries",

    handler: integrations.listDeliveries,

    public: true,
  },

  {
    method: "GET",

    pattern: "/api/open/leads",

    handler: integrations.openListLeads,

    public: true,
  },

  // --- documents ------------------------------------------------------------
  // Files filed against a project, unit, customer, or booking. There is no
  // standalone documents page; the section is embedded on the four detail
  // screens. Reads gate on `documents.view` plus the per-type access map.
  // See `server/routes/documents.ts`.

  {
    method: "GET",

    pattern: "/api/documents",

    handler: documents.listDocuments,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/documents",

    handler: documents.createDocument,

    public: true,
  },

  {
    method: "GET",

    pattern: "/api/documents/:id/file",

    handler: documents.downloadDocumentFile,

    public: true,
  },

  {
    method: "PATCH",

    pattern: "/api/documents/:id",

    handler: documents.updateDocument,

    public: true,
  },

  {
    method: "DELETE",

    pattern: "/api/documents/:id",

    handler: documents.deleteDocument,

    public: true,
  },

  // --- signed file access (the front door on file bytes) --------------------
  // The token is the credential, so these carry no session; `redeemGrant` re-checks
  // the issuing user's live entitlement. See `server/file-access.ts`.

  {
    method: "GET",

    pattern: "/api/file-access/:token",

    handler: fileAccess.redeemFileAccessToken,

    public: true,
  },

  {
    method: "HEAD",

    pattern: "/api/file-access/:token",

    handler: fileAccess.redeemFileAccessToken,

    public: true,
  },

  // --- customer document verification ---------------------------------------

  {
    method: "GET",

    pattern: "/api/customers/:id/document-checklist",

    handler: documentVerification.getCustomerChecklist,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/customers/:id/documents",

    handler: documentVerification.uploadCustomerDocument,

    public: true,
  },

  {
    method: "GET",

    pattern: "/api/documents/verification-queue",

    handler: documentVerification.listVerificationQueue,

    public: true,
  },

  {
    method: "GET",

    pattern: "/api/documents/:id/review",

    handler: documentVerification.getDocumentReview,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/documents/:id/verify",

    handler: documentVerification.verifyDocument,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/documents/:id/reject",

    handler: documentVerification.rejectDocument,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/documents/:id/request-reupload",

    handler: documentVerification.requestReupload,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/documents/:id/provider-verify",

    handler: documentVerification.providerVerifyDocument,

    public: true,
  },

  {
    method: "GET",

    pattern: "/api/documents/:id/cnic",

    handler: documentVerification.revealDocumentCnic,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/documents/:id/access",

    handler: documentVerification.issueDocumentAccess,

    public: true,
  },

  {
    method: "GET",

    pattern: "/api/documents/:id/download-log",

    handler: documentVerification.getDocumentDownloadLog,

    public: true,
  },

  {
    method: "GET",

    pattern: "/api/documents/:id/reveal-log",

    handler: documentVerification.getDocumentRevealLog,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/documents/bulk-remind",

    handler: documentVerification.bulkRemind,

    public: true,
  },

  // --- document verification settings + catalogue ---------------------------

  {
    method: "GET",

    pattern: "/api/settings/document-verification",

    handler: documentVerification.getVerificationSettings,

    public: true,
  },

  {
    method: "PATCH",

    pattern: "/api/settings/document-verification",

    handler: documentVerification.patchVerificationSettings,

    public: true,
  },

  {
    method: "GET",

    pattern: "/api/settings/identity-provider",

    handler: documentVerification.getIdentityProvider,

    public: true,
  },

  {
    method: "PATCH",

    pattern: "/api/settings/identity-provider",

    handler: documentVerification.patchIdentityProvider,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/settings/identity-provider/test",

    handler: documentVerification.testIdentityProvider,

    public: true,
  },

  {
    method: "GET",

    pattern: "/api/document-types",

    handler: documentVerification.listDocumentTypes,

    public: true,
  },

  {
    method: "PATCH",

    pattern: "/api/document-types/:key",

    handler: documentVerification.patchDocumentType,

    public: true,
  },

  // --- support tickets (staff queue) ----------------------------------------
  // Every service request, filterable by status/priority/assignee/SLA. Reads
  // gate on `tickets.view`. See `server/routes/tickets.ts`.

  {
    method: "GET",

    pattern: "/api/tickets",

    handler: tickets.listTickets,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/tickets",

    handler: tickets.createTicket,

    public: true,
  },

  {
    method: "GET",

    pattern: "/api/tickets/:id",

    handler: tickets.getTicket,

    public: true,
  },

  {
    method: "PATCH",

    pattern: "/api/tickets/:id",

    handler: tickets.updateTicket,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/tickets/:id/comments",

    handler: tickets.addTicketComment,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/tickets/:id/attachments",

    handler: tickets.uploadTicketAttachment,

    public: true,
  },

  {
    method: "GET",

    pattern: "/api/tickets/:id/attachments/:attachmentId",

    handler: tickets.downloadTicketAttachment,

    public: true,
  },

  {
    method: "DELETE",

    pattern: "/api/tickets/:id/attachments/:attachmentId",

    handler: tickets.deleteTicketAttachment,

    public: true,
  },

  // --- communications (settings) --------------------------------------------
  // Editable message templates and a read-only reminder dry run. Nothing sends.
  // See `server/routes/communications.ts`.

  {
    method: "GET",

    pattern: "/api/settings/communications",

    handler: communications.getCommunications,

    public: true,
  },

  {
    method: "PUT",

    pattern: "/api/settings/communications/template",

    handler: communications.saveTemplate,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/settings/communications/preview",

    handler: communications.previewTemplate,

    public: true,
  },

  {
    method: "GET",

    pattern: "/api/settings/communications/upcoming-reminders",

    handler: communications.upcomingReminders,

    public: true,
  },

  // --- campaigns ------------------------------------------------------------
  // An acquisition channel with a public, token-keyed intake door. See
  // `server/routes/campaigns.ts`.

  {
    method: "GET",

    pattern: "/api/campaigns",

    handler: campaigns.listCampaigns,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/campaigns",

    handler: campaigns.createCampaign,

    public: true,
  },

  {
    method: "GET",

    pattern: "/api/campaigns/:id",

    handler: campaigns.getCampaign,

    public: true,
  },

  {
    method: "PATCH",

    pattern: "/api/campaigns/:id",

    handler: campaigns.updateCampaign,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/campaigns/:id/rotate-token",

    handler: campaigns.rotateCampaignToken,

    public: true,
  },

  {
    method: "DELETE",

    pattern: "/api/campaigns/:id",

    handler: campaigns.archiveCampaign,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/public/campaigns/:token/leads",

    handler: campaigns.publicCreateLead,

    public: true,
  },

  // --- customer portal ------------------------------------------------------
  // Scoped reads for a logged-in buyer, authorized by `customer_portal_links`
  // rather than a grant. See `server/routes/portal.ts`.

  {
    method: "GET",

    pattern: "/api/portal/overview",

    handler: portal.portalOverview,

    public: true,
  },

  {
    method: "GET",

    pattern: "/api/portal/payments",

    handler: portal.portalPayments,

    public: true,
  },

  {
    method: "GET",

    pattern: "/api/portal/documents",

    handler: portal.portalDocuments,

    public: true,
  },

  {
    method: "GET",

    pattern: "/api/portal/documents/checklist",

    handler: portal.portalDocumentChecklist,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/portal/documents",

    handler: portal.uploadPortalDocument,

    public: true,
  },

  {
    method: "GET",

    pattern: "/api/portal/documents/:id/file",

    handler: portal.portalDocumentFile,

    public: true,
  },

  {
    method: "GET",

    pattern: "/api/portal/requests",

    handler: portal.portalRequests,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/portal/requests",

    handler: portal.createPortalRequest,

    public: true,
  },

  {
    method: "GET",

    pattern: "/api/portal/requests/:id",

    handler: portal.portalRequestDetail,

    public: true,
  },

  {
    method: "PATCH",

    pattern: "/api/portal/requests/:id",

    handler: portal.updatePortalRequest,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/portal/requests/:id/comments",

    handler: portal.addPortalRequestComment,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/portal/requests/:id/attachments",

    handler: portal.uploadPortalRequestAttachment,

    public: true,
  },

  {
    method: "GET",

    pattern: "/api/portal/requests/:id/attachments/:attachmentId",

    handler: portal.downloadPortalRequestAttachment,

    public: true,
  },

  // Staff side of the portal: who may read a customer's account. Gated on
  // `customers.edit`, reached from the customer detail page.

  {
    method: "GET",

    pattern: "/api/customers/:id/portal-access",

    handler: portal.getPortalAccess,

    public: true,
  },

  {
    method: "PUT",

    pattern: "/api/customers/:id/portal-access",

    handler: portal.putPortalAccess,

    public: true,
  },

  // --- reports ------------------------------------------------------------

  {
    method: "GET",

    pattern: "/api/reports",

    handler: reports.listReports,

    public: true,
  },

  {
    method: "GET",

    pattern: "/api/reports/:id",

    handler: reports.getReport,

    public: true,
  },

  // --- dashboard ----------------------------------------------------------

  {
    method: "GET",

    pattern: "/api/dashboard/summary",

    handler: dashboard.dashboardSummary,

    public: true,
  },

  {
    method: "GET",

    pattern: "/api/dashboard/overview",

    handler: dashboardOverviewRoutes.dashboardOverview,

    public: true,
  },

  {
    method: "GET",

    pattern: "/api/dashboard/widget",

    handler: dashboardOverviewRoutes.dashboardWidget,

    public: true,
  },

  {
    method: "GET",

    pattern: "/api/dashboard/sample-data",

    handler: dashboardSampleRoutes.sampleDataStatus,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/dashboard/sample-data/load",

    handler: dashboardSampleRoutes.loadSampleData,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/dashboard/sample-data/remove",

    handler: dashboardSampleRoutes.removeSampleData,

    public: true,
  },

  // --- global search ------------------------------------------------------

  {
    method: "GET",

    pattern: "/api/search",

    handler: search.globalSearch,

    public: true,
  },

  // --- saved views --------------------------------------------------------

  {
    method: "GET",

    pattern: "/api/saved-views",

    handler: savedViews.listSavedViews,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/saved-views",

    handler: savedViews.createSavedView,

    public: true,
  },

  {
    method: "DELETE",

    pattern: "/api/saved-views/:id",

    handler: savedViews.deleteSavedView,

    public: true,
  },

  // --- audit log ----------------------------------------------------------

  {
    method: "GET",

    pattern: "/api/audit-log",

    handler: auditLog.listAuditLog,

    public: true,
  },

  // --- notifications ------------------------------------------------------

  // A personal inbox, scoped to the caller by authentication alone; the handlers
  // read their own session, so there is no module grant to gate them on.

  {
    method: "GET",

    pattern: "/api/notifications",

    handler: notifications.listNotifications,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/notifications/read-all",

    handler: notifications.markAllNotificationsRead,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/notifications/:id/read",

    handler: notifications.markNotificationRead,

    public: true,
  },

  {
    method: "GET",

    pattern: "/api/notifications/settings",

    handler: notifications.getNotificationSettings,

    public: true,
  },

  {
    method: "PUT",

    pattern: "/api/notifications/settings",

    handler: notifications.saveNotificationSettings,

    public: true,
  },

  // --- platform super admin ------------------------------------------------

  // The operator's view across every workspace. These are the only routes that
  // legitimately read past the caller's tenant, and each handler re-checks the
  // caller's *role scope* in the database before it returns anything, so the
  // scope is enforced where the data is read rather than in the dispatch table.

  {
    method: "GET",

    pattern: "/api/platform/tenants",

    handler: platform.listPlatformTenants,

    public: true,
  },

  {
    method: "GET",

    pattern: "/api/platform/tenants/:id",

    handler: platform.getPlatformTenant,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/platform/tenants/:id/invoice",

    handler: platform.recordPlatformInvoice,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/platform/tenants/:id/payment",

    handler: platform.recordPlatformPayment,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/platform/tenants/:id/due",

    handler: platform.markPlatformTenantDue,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/platform/tenants/:id/grace",

    handler: platform.grantPlatformGrace,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/platform/tenants/:id/suspend",

    handler: platform.suspendPlatformTenant,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/platform/tenants/:id/reactivate",

    handler: platform.reactivatePlatformTenant,

    public: true,
  },

  {
    method: "POST",

    pattern: "/api/platform/tenants/:id/plan",

    handler: platform.updatePlatformTenantPlan,

    public: true,
  },
]

function health() {
  return { ok: true, service: "deedorbit-api", time: new Date().toISOString() }
}

/** The caller's own effective grants — the client uses this to shape the nav. */

function myPermissions(ctx: RequestContext) {
  const guarded = requireAuth(ctx)

  return {
    roleId: guarded.roleId,

    tenantId: guarded.tenantId,

    can: Object.fromEntries(
      ([
        ["dashboard", ["view"]],

        ["projects", ["view", "create", "edit", "approve"]],

        ["inventory", ["view", "create", "edit"]],

        ["leads", ["view", "create", "edit", "delete"]],

        ["sales_agents", ["view", "create", "edit"]],

        ["dealers", ["view", "create", "edit"]],

        ["bookings", ["view", "create", "edit", "approve"]],

        ["approvals", ["view", "approve"]],

        ["payments", ["view", "create", "edit", "approve"]],

        ["customers", ["view", "create", "edit"]],

        ["reports", ["view", "create"]],

        ["users", ["view", "create", "edit", "delete"]],

        ["settings", ["view", "edit"]],

        ["expenses", ["view", "create", "edit", "delete", "approve"]],

        ["vendors", ["view", "create", "edit", "approve"]],

        ["documents", ["view", "create", "edit", "delete"]],

        ["tickets", ["view", "create", "edit", "delete"]],

        ["campaigns", ["view", "create", "edit", "delete"]],
      ] as const).map(([module, actions]) => [
        module,

        Object.fromEntries(
          actions.map((action) => [action, guarded.can(module, action)]),
        ),
      ]),
    ),
  }
}

// --- routing ---------------------------------------------------------------

type CompiledRoute = Route & {
  segments: string[]
}

const compiled: CompiledRoute[] = routes.map((route) => ({
  ...route,

  segments: route.pattern.split("/").filter(Boolean),
}))

interface RouteMatch {
  route: CompiledRoute
  params: Record<string, string>
}

function matchRoute(method: string, pathname: string): RouteMatch | null {
  const parts = pathname.split("/").filter(Boolean)

  for (const route of compiled) {
    if (route.method !== method) continue

    if (route.segments.length !== parts.length) continue

    const params: Record<string, string> = {}

    let matched = true

    for (const [index, segment] of route.segments.entries()) {
      const part = parts[index]!

      if (segment.startsWith(":")) {
        params[segment.slice(1)] = decodeURIComponent(part)
      } else if (segment !== part) {
        matched = false

        break
      }
    }

    if (matched) return { route, params }
  }

  return null
}

/** True when the path exists under some other method — 405, not 404. */

function pathExistsAnyMethod(pathname: string): boolean {
  const parts = pathname.split("/").filter(Boolean)

  return compiled.some((route) => {
    if (route.segments.length !== parts.length) return false

    return route.segments.every((segment, index) => {
      if (segment.startsWith(":")) return true

      const part = parts[index]

      return part !== undefined && segment === part
    })
  })
}

const ALLOWED_ORIGINS = new Set(
  (
    process.env.DEEDORBIT_ALLOWED_ORIGINS ??
    "http://localhost:8443,http://127.0.0.1:8443"
  )

    .split(",")

    .map((value) => value.trim())

    .filter(Boolean),
)

function applyCors(req: IncomingMessage, res: ServerResponse): void {
  const origin = req.headers.origin

  if (typeof origin === "string" && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin)

    res.setHeader("Access-Control-Allow-Credentials", "true")

    res.setHeader("Vary", "Origin")
  }

  res.setHeader(
    "Access-Control-Allow-Methods",

    "GET,POST,PATCH,PUT,DELETE,OPTIONS",
  )

  res.setHeader("Access-Control-Allow-Headers", "Content-Type")

  res.setHeader("Access-Control-Max-Age", "600")
}

export function createApp() {
  return createServer((req, res) => {
    const started = Date.now()

    const url = new URL(
      req.url ?? "/",

      `http://${req.headers.host ?? "localhost"}`,
    )

    applyCors(req, res)

    if (req.method === "OPTIONS") {
      res.writeHead(204)

      res.end()

      return
    }

    if (!url.pathname.startsWith("/api/")) {
      sendJson(res, 404, {
        error: { code: "not_found", message: "Unknown endpoint" },
      })

      return
    }

    const match = matchRoute(req.method ?? "GET", url.pathname)

    if (!match) {
      const known = pathExistsAnyMethod(url.pathname)

      sendJson(res, known ? 405 : 404, {
        error: {
          code: known ? "method_not_allowed" : "not_found",

          message: known
            ? `${req.method} is not supported on this endpoint`
            : "Unknown endpoint",
        },
      })

      return
    }

    const ctx: RequestContext = {
      req,

      res,

      method: req.method ?? "GET",

      pathname: url.pathname,

      query: url.searchParams,

      params: match.params,

      cookies: parseCookies(req.headers.cookie),

      ip: clientIp(req),

      userAgent: String(req.headers["user-agent"] ?? "unknown"),
    }

    // A handler that throws synchronously (e.g. a streaming route rejecting a
    // forbidden read before writing headers) must land in the catch below, not
    // escape unhandled and leave the socket hanging — so invoke it inside a
    // thenable rather than as a direct argument to Promise.resolve.
    Promise.resolve()
      .then(() => match.route.handler(ctx))

      .then((payload) => {
        // The dashboard is cached for about a minute, so a write has to retire
        // that tenant's entries: recording a payment or switching the workspace
        // currency should move the numbers on the next refresh, not after the
        // cache happens to expire.

        if (ctx.method !== "GET") {
          const session = verifySessionToken(
            ctx.cookies[SESSION_COOKIE] ?? null,
          )

          if (session?.tenantId) {
            dashboardOverviewRoutes.invalidateDashboardCache(session.tenantId)
          }
        }

        if (res.headersSent) return

        sendJson(
          res,

          req.method === "POST" && payload === undefined ? 204 : 200,

          payload ?? { ok: true },
        )
      })

      .catch((error) => {
        if (res.headersSent) return

        const ms = Date.now() - started

        const status =
          error instanceof Error && "status" in error
            ? (error as { status: number }).status
            : 500

        if (status >= 500) {
          console.error(
            `[api] ${ctx.method} ${ctx.pathname} failed after ${ms}ms`,
          )
        }

        sendError(res, error)
      })
  })
}

// --- boot ------------------------------------------------------------------

// `API_PORT` is the local/dev override; `PORT` is what Render, Railway and Fly
// inject at runtime, so honouring both lets one image bind the host's port
// without an extra env mapping.
const PORT = Number(process.env.API_PORT ?? process.env.PORT ?? 8444)

const HOST = process.env.API_HOST ?? "127.0.0.1"

const REMINDER_TICK_MS = 60 * 60 * 1000

/**
 * The reminder engine's heartbeat. A catch-up pass runs shortly after the port is
 * up (so a workspace whose process was down overnight still gets today's chase on
 * boot), then an hourly tick. Each tick is fire-and-forget with its errors logged,
 * never allowed to reject unhandled or to take the API down - the same discipline
 * the outbound dispatch uses on the request path. `REMINDER_JOB=off` disables the
 * whole thing, which is how the test harness and API suite run the engine directly
 * instead of on a timer. The timers are unref'd so a graceful shutdown is never
 * blocked by a tick still waiting to fire.
 */
function startReminderScheduler(): void {
  if (process.env.REMINDER_JOB === "off") return

  const tick = () => {
    const stamp = new Date().toISOString()

    // Queue this run's document expiry nudges first, then let the reminder tick do
    // its payment cycle and its one shared dispatch pass — which moves every queued
    // row forward, document nudges included. Each stage is fire-and-forget and logs
    // its own failure, so neither can take the other (or the API) down.
    void runDocumentExpiryScanAll(stamp)
      .catch((error) => {
        console.error("[api] document expiry scan failed", error)
      })
      .finally(() => {
        void runReminderTick(stamp).catch((error) => {
          console.error("[api] reminder tick failed", error)
        })
      })
  }

  setTimeout(tick, 30_000).unref()

  setInterval(tick, REMINDER_TICK_MS).unref()
}

export function start(): ReturnType<typeof createApp> {
  getDb()

  if (!isSeeded()) seed()

  // Deliberately outside the `isSeeded()` branch above. Organization defaults
  // were added after the demo roles existed, so every already-installed
  // workspace would otherwise never receive them - the demo seed is skipped
  // precisely because the database is populated. The call is idempotent
  // (COALESCE plus ON CONFLICT DO NOTHING), so it is safe on every boot and
  // will not revert configuration an admin has since edited.
  seedOrganizationDefaults()

  // The same trap, for the permission catalogue. `inventory.change_status` was
  // added after this workspace already existed, and `seed()` had long since
  // stopped running, so without this call no role - not even the tenant's own
  // administrator - would hold the grant the status changer is gated on.
  seedPermissionCatalogue()

  // The communication template bodies, for the same reason as the two calls
  // above: a feature shipped after first install would otherwise never reach an
  // existing workspace. Insert-only, so an office's edited body is preserved.
  seedCommunicationTemplates()

  // Platform billing demo state, for the same boot-level reason as the three
  // calls above. Insert-only and guarded per tenant by its own ledger, so it
  // never re-seeds over history the platform team has since recorded.
  seedPlatformBilling()

  // Demo rows for construction, procurement, signatures and integrations, for
  // the same boot-level reason as the calls above. Fixed-key INSERT OR IGNORE, so
  // it never duplicates on restart and never reverts an edit a real user made.
  seedOperationalModules()

  purgeExpiredSessions()

  const server = createApp()

  server.listen(PORT, HOST, () => {
    console.log(`[api] ${brand.name} API on http://${HOST}:${PORT}`)
  })

  startReminderScheduler()

  const shutdown = () => {
    server.close(() => {
      closeDb()

      process.exit(0)
    })
  }

  process.on("SIGINT", shutdown)

  process.on("SIGTERM", shutdown)

  return server
}

// Only listen when executed directly, not when imported by a test. Compared

// by realpath because `import.meta.url` and `process.argv[1]` disagree on

// Windows drive-letter and slash formatting.

if (process.argv[1]) {
  const entry = realpathSync(process.argv[1])

  const self = realpathSync(fileURLToPath(import.meta.url))

  if (entry === self) start()
}
