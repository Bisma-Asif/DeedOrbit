import { useCallback, useEffect, useMemo } from "react"
import { AppShell } from "@/components/layout/app-shell"
import { DashboardPage } from "@/pages/dashboard-page"
import { ModulePage } from "@/pages/module-page"
import { NotFoundPage } from "@/pages/not-found-page"
import { SettingsPage } from "@/pages/settings-page"
import { ProjectDetailPage } from "@/features/projects/project-detail-page"
import { ProjectsPage } from "@/features/projects/projects-page"
import { LeadsPage } from "@/features/leads/leads-page"
import { CustomersPage } from "@/features/customers/customers-page"
import { CustomerDetailPage } from "@/features/customers/customer-detail-page"
import { SalesAgentsPage } from "@/features/sales-agents/sales-agents-page"
import { DealersPage } from "@/features/dealers/dealers-page"
import BookingsPage from "@/features/bookings/bookings-page"
import BookingDetailPage from "@/features/bookings/booking-detail-page"
import ApprovalsPage from "@/features/approvals/approvals-page"
import PaymentsPage from "@/features/payments/payments-page"
import ApprovalDetailPage from "@/features/approvals/approval-detail-page"
import { ExpensesPage } from "@/features/expenses/expenses-page"
import { ExpenseDetailPage } from "@/features/expenses/expense-detail-page"
import { VendorsPage } from "@/features/vendors/vendors-page"
import { VendorDetailPage } from "@/features/vendors/vendor-detail-page"
import { ConstructionPage } from "@/features/construction/construction-page"
import { PhaseDetailPage } from "@/features/construction/phase-detail-page"
import { ProcurementPage } from "@/features/procurement/procurement-page"
import { PoDetailPage } from "@/features/procurement/po-detail-page"
import { RequisitionDetailPage } from "@/features/procurement/requisition-detail-page"
import { SignaturesPage } from "@/features/signatures/signatures-page"
import { SignPage } from "@/features/signatures/sign-page"
import { TicketsPage } from "@/features/tickets/tickets-page"
import { TicketDetailPage } from "@/features/tickets/ticket-detail-page"
import { VerificationQueuePage } from "@/features/documents/verification-queue"
import { CampaignsPage } from "@/features/campaigns/campaigns-page"
import { CampaignDetailPage } from "@/features/campaigns/campaign-detail-page"
import { ReportsPage } from "@/features/reports/reports-page"
import AssistantPage from "@/features/assistant/assistant-page"

import { AuditLogPage } from "@/features/audit/audit-log-page"
import { NotificationsPage } from "@/features/notifications/notifications-page"
import { NotificationSettingsPage } from "@/features/notifications/notification-settings-page"
import { PlatformTenantsPage } from "@/features/platform/platform-tenants-page"
import { PlatformTenantDetailPage } from "@/features/platform/platform-tenant-detail-page"
import { PortalShell } from "@/features/portal/portal-shell"
import { PortalRouter } from "@/features/portal/portal-router"
import { LoginPage } from "@/features/auth/login-page"
import { SignupPage } from "@/features/auth/signup-page"
import { ForgotPasswordPage } from "@/features/auth/forgot-password-page"
import { ResetPasswordPage } from "@/features/auth/reset-password-page"
import { TwoFactorPage } from "@/features/auth/two-factor-page"
import LandingPage from "@/features/marketing/landing-page"
import { PrivacyPage } from "@/features/marketing/legal/privacy-page"
import { TermsPage } from "@/features/marketing/legal/terms-page"
import { findModuleByPath, isPlatformPath } from "@/lib/navigation"
import { ROLES } from "@shared/access"
import { navigate, readQueryParam, routePath, useRoute } from "@/lib/router"
import { tenantFromSession, userFromSession } from "@/lib/workspace"
import { useSession } from "@/lib/session-context"
import { BootScreen } from "@/features/auth/boot-screen"

/** Routes reachable without a session. */
const PUBLIC_ROUTES = new Set([
  "/login",
  "/signup",
  "/recover",
  "/recover/reset",
])

/**
 * The public marketing surfaces. They render for anyone — a signed-in visitor
 * still sees them, with the navbar swapping the auth buttons for "Go to
 * Dashboard" — and they are resolved before the session gate so the landing
 * paints without waiting on `GET /api/auth/session`. They are deliberately kept
 * out of the app's auth-redirect rule below so opening "/" never bounces.
 */
const MARKETING_ROUTES = new Set(["/", "/privacy", "/terms"])

export default function App() {
  const rawPath = useRoute()
  const path = routePath(rawPath)
  const { loading, data, twofaRequired, signOut, switchTenant, canView } =
    useSession()

  const isPublic = PUBLIC_ROUTES.has(path)
  const isMarketing = MARKETING_ROUTES.has(path)

  // A signing link is opened by a recipient who has no session at all, so the
  // ceremony is treated as public: it must never redirect to sign-in.
  const onSignRoute = path === "/sign" || path.startsWith("/sign/")

  // A logged-in `customer` lives entirely in the portal: no staff sidebar, no
  // staff modules. Both the `portal.view` grant and the `customer` role identify
  // that login, so either way it is routed to the scoped surface.
  const isPortalUser =
    data?.permissions["portal.view"] === true || data?.role.id === "customer"
  const onPortalRoute = path === "/portal" || path.startsWith("/portal/")

  // A live session should not be left sitting on the sign-in screen, and a
  // signed-out one should never stay on a protected page. A portal login is
  // kept on `/portal/*` and a staff login kept off it, so neither drifts into
  // the other's surface.
  useEffect(() => {
    if (loading) return
    if (!data) {
      if (!twofaRequired && !isPublic && !isMarketing && !onSignRoute)
        navigate("/login")
      return
    }
    if (isPortalUser) {
      if (path === "/login" || path === "/signup" || !onPortalRoute)
        navigate("/portal")
      return
    }
    if (path === "/login" || path === "/signup") navigate("/dashboard")
    else if (onPortalRoute) navigate("/dashboard")
  }, [
    loading,
    data,
    twofaRequired,
    isPublic,
    isMarketing,
    path,
    isPortalUser,
    onPortalRoute,
  ])
  const handleSignOut = useCallback(() => {
    void signOut()
  }, [signOut])

  const handleSwitchTenant = useCallback(
    (tenantId: string) => {
      void switchTenant(tenantId)
    },
    [switchTenant],
  )

  const activeModule = useMemo(() => findModuleByPath(path), [path])

  // The platform gate is the active role's scope in the shared registry, the
  // same value the `roles.scope` column stores and the API re-reads per
  // request. It is not a permission module: a tenant owner's `all: true`
  // grant expands to every module in the catalogue, so a module-based gate
  // would hand tenant owners the platform console.
  const isPlatformOperator = useMemo(
    () =>
      ROLES.some(
        (role) => role.id === data?.role.id && role.scope === "platform",
      ),

    [data],
  )

  // `/projects/:id` is a detail route under the Projects module. The id is
  // validated as a plain token so a hand-typed path cannot smuggle anything
  // through into the request; anything else falls back to the list.
  const projectId = useMemo(() => {
    if (activeModule?.id !== "projects") return null
    const segments = path.split("/").filter(Boolean)
    if (segments.length !== 2) return null
    return /^[A-Za-z0-9_-]+$/.test(segments[1]!) ? segments[1]! : null
  }, [activeModule, path])

  const customerId = useMemo(() => {
    if (activeModule?.id !== "customers") return null
    const segments = path.split("/").filter(Boolean)
    if (segments.length !== 2) return null
    return /^[A-Za-z0-9_-]+$/.test(segments[1]!) ? segments[1]! : null
  }, [activeModule, path])

  // `/bookings/:id` is the booking detail route, validated the same way as the
  // customer and project ids so a hand-typed path cannot smuggle a token through.
  const bookingId = useMemo(() => {
    if (activeModule?.id !== "bookings") return null
    const segments = path.split("/").filter(Boolean)
    if (segments.length !== 2) return null
    return /^[A-Za-z0-9_-]+$/.test(segments[1]!) ? segments[1]! : null
  }, [activeModule, path])

  // `/approvals/:id` is the approval detail route, validated the same way as the
  // booking id so a hand-typed path cannot smuggle a token through.
  const approvalId = useMemo(() => {
    if (activeModule?.id !== "approvals") return null
    const segments = path.split("/").filter(Boolean)
    if (segments.length !== 2) return null
    return /^[A-Za-z0-9_-]+$/.test(segments[1]!) ? segments[1]! : null
  }, [activeModule, path])

  // `/expenses/:id` and `/vendors/:id` are the two accounting detail routes,
  // validated the same way as the customer and booking ids.
  const expenseId = useMemo(() => {
    if (activeModule?.id !== "expenses") return null
    const segments = path.split("/").filter(Boolean)
    if (segments.length !== 2) return null
    return /^[A-Za-z0-9_-]+$/.test(segments[1]!) ? segments[1]! : null
  }, [activeModule, path])

  const vendorId = useMemo(() => {
    if (activeModule?.id !== "vendors") return null
    const segments = path.split("/").filter(Boolean)
    if (segments.length !== 2) return null
    return /^[A-Za-z0-9_-]+$/.test(segments[1]!) ? segments[1]! : null
  }, [activeModule, path])

  // `/tickets/:id` is the ticket detail route, validated the same way as the
  // other entity ids so a hand-typed path cannot smuggle a token through.
  const ticketId = useMemo(() => {
    if (activeModule?.id !== "tickets") return null
    const segments = path.split("/").filter(Boolean)
    if (segments.length !== 2) return null
    return /^[A-Za-z0-9_-]+$/.test(segments[1]!) ? segments[1]! : null
  }, [activeModule, path])

  // `/campaigns/:id` is the campaign detail route, validated the same way as the
  // other entity ids.
  const campaignId = useMemo(() => {
    if (activeModule?.id !== "campaigns") return null
    const segments = path.split("/").filter(Boolean)
    if (segments.length !== 2) return null
    return /^[A-Za-z0-9_-]+$/.test(segments[1]!) ? segments[1]! : null
  }, [activeModule, path])

  // `/construction/phases/:id` is a three-segment detail route that still
  // resolves to the `construction` module, so the phase id is read here rather
  // than in the module registry. It is validated as a plain token like the
  // other entity ids so a hand-typed path cannot smuggle a token through.
  const constructionPhaseId = useMemo(() => {
    if (activeModule?.id !== "construction") return null
    const segments = path.split("/").filter(Boolean)
    if (segments.length !== 3) return null
    if (segments[0] !== "construction" || segments[1] !== "phases") return null
    return /^[A-Za-z0-9_-]+$/.test(segments[2]!) ? segments[2]! : null
  }, [activeModule, path])

  // `/procurement/po/:id` and `/procurement/requisitions/:id` are three-segment
  // detail routes that resolve to the `procurement` module, so the ids are read
  // here and validated as plain tokens like the other entity ids.
  const procurementPoId = useMemo(() => {
    if (activeModule?.id !== "procurement") return null
    const segments = path.split("/").filter(Boolean)
    if (segments.length !== 3) return null
    if (segments[0] !== "procurement" || segments[1] !== "po") return null
    return /^[A-Za-z0-9_-]+$/.test(segments[2]!) ? segments[2]! : null
  }, [activeModule, path])

  const procurementRequisitionId = useMemo(() => {
    if (activeModule?.id !== "procurement") return null
    const segments = path.split("/").filter(Boolean)
    if (segments.length !== 3) return null
    if (segments[0] !== "procurement" || segments[1] !== "requisitions") {
      return null
    }
    return /^[A-Za-z0-9_-]+$/.test(segments[2]!) ? segments[2]! : null
  }, [activeModule, path])

  // `/sign/:token?recipientId=…` is the public ceremony. It renders before any
  // session gate, outside the app shell, and authorises on the token alone — a
  // recipient never sees a login screen.
  if (onSignRoute) {
    const segments = path.split("/").filter(Boolean)
    const signToken =
      segments.length >= 2 && /^[A-Za-z0-9_-]+$/.test(segments[1]!)
        ? segments[1]!
        : ""
    const signRecipientId = readQueryParam("recipientId", rawPath) ?? ""
    return <SignPage token={signToken} recipientId={signRecipientId} />
  }

  // The marketing pages are shown before any session/loading gate: they need no
  // cookie, must paint immediately for LCP, and a signed-in visitor who opens
  // "/" should still land on the pitch (with a "Go to Dashboard" CTA), not be
  // redirected into the shell.
  if (isMarketing) {
    if (path === "/privacy") return <PrivacyPage />
    if (path === "/terms") return <TermsPage />
    return <LandingPage />
  }

  if (loading) return <BootScreen />

  // The cookie is valid but a second factor is outstanding. Every protected
  // route is locked until this is cleared, so the challenge takes over the app.
  if (twofaRequired) return <TwoFactorPage />

  if (!data) {
    if (path === "/signup") return <SignupPage />
    if (path === "/recover") return <ForgotPasswordPage />
    if (path === "/recover/reset") return <ResetPasswordPage />
    return <LoginPage />
  }

  // A portal login is handed its own shell before the staff module registry is
  // consulted, so a `customer` never resolves a staff route or trips the
  // module-view guard. The redirect above keeps them on `/portal/*`.
  if (isPortalUser) {
    return (
      <PortalShell session={data} path={path} onSignOut={handleSignOut}>
        <PortalRouter path={path} />
      </PortalShell>
    )
  }

  // The notification inbox and its preferences are personal, self-scoped surfaces
  // any signed-in staff member can open, so they are resolved before the module
  // guard. `/notifications` is not in the module registry (it would render the
  // 404), and `/settings/notifications` would otherwise collide with the org
  // `settings` module — neither should hinge on an org grant a personal inbox
  // does not need.
  if (path === "/notifications" || path === "/settings/notifications") {
    return (
      <AppShell
        session={data}
        path={path}
        canView={canView}
        onSwitchTenant={handleSwitchTenant}
        onSignOut={handleSignOut}
      >
        {path === "/notifications" ? (
          <NotificationsPage key="notifications" />
        ) : (
          <NotificationSettingsPage key="notification-settings" />
        )}
      </AppShell>
    )
  }

  // The Platform Super Admin area resolves before the module guard, exactly
  // like the personal notification surfaces: `/platform/*` is not in the
  // module registry, so falling through would render the 404 even for the
  // operator. A non-platform session gets the 404 inside the normal tenant
  // chrome - the area is not hidden-with-a-link, it does not exist for them,
  // which is also how the API answers (404, not 403).
  if (isPlatformPath(path)) {
    if (!isPlatformOperator) {
      return (
        <AppShell
          session={data}
          path={path}
          canView={canView}
          onSwitchTenant={handleSwitchTenant}
          onSignOut={handleSignOut}
        >
          <NotFoundPage />
        </AppShell>
      )
    }

    const segments = path.split("/").filter(Boolean)

    // `/platform/tenants/:id` detail route, validated the same way as the
    // other entity ids so a hand-typed path cannot smuggle a token through.
    const platformTenantId =
      segments.length === 3 &&
      segments[0] === "platform" &&
      segments[1] === "tenants" &&
      /^[A-Za-z0-9_-]+$/.test(segments[2]!)
        ? segments[2]!
        : null

    return (
      <AppShell
        session={data}
        path={path}
        canView={canView}
        onSwitchTenant={handleSwitchTenant}
        onSignOut={handleSignOut}
        platform
      >
        {platformTenantId ? (
          <PlatformTenantDetailPage
            tenantId={platformTenantId}
            key={`platform-tenant-${platformTenantId}`}
          />
        ) : segments.length <= 2 &&
          (segments.length === 1 || segments[1] === "tenants") ? (
          <PlatformTenantsPage key="platform-tenants" />
        ) : (
          <NotFoundPage />
        )}
      </AppShell>
    )
  }

  // Route-level access control. Hiding a nav link is convenience; this is the
  // guard that stops a hand-typed hash from opening a module without the grant.
  if (activeModule && !canView(activeModule.viewModule ?? activeModule.id)) {
    return (
      <AppShell
        session={data}
        path={path}
        canView={canView}
        onSwitchTenant={handleSwitchTenant}
        onSignOut={handleSignOut}
      >
        <NotFoundPage />
      </AppShell>
    )
  }

  const tenant = tenantFromSession(data)
  const user = userFromSession(data.user, data.role.label)

  return (
    <AppShell
      session={data}
      path={path}
      canView={canView}
      onSwitchTenant={handleSwitchTenant}
      onSignOut={handleSignOut}
    >
      {!activeModule ? (
        <NotFoundPage />
      ) : activeModule.id === "dashboard" ? (
        <DashboardPage tenant={tenant} user={user} />
      ) : activeModule.id === "settings" ? (
        <SettingsPage tenant={tenant} />
      ) : activeModule.id === "projects" ? (
        // A project detail route resolves to the same module, so the id is
        // read here rather than in the module registry. `key` forces a remount
        // when moving between projects, so one project's form cannot survive
        // into the next.
        projectId ? (
          <ProjectDetailPage
            projectId={projectId}
            key={`project-${projectId}`}
          />
        ) : (
          <ProjectsPage module={activeModule} />
        )
      ) : activeModule.id === "leads" ? (
        <LeadsPage />
      ) : activeModule.id === "campaigns" ? (
        campaignId ? (
          <CampaignDetailPage
            campaignId={campaignId}
            key={`campaign-${campaignId}`}
          />
        ) : (
          <CampaignsPage />
        )
      ) : activeModule.id === "customers" ? (
        customerId ? (
          <CustomerDetailPage
            customerId={customerId}
            key={`customer-${customerId}`}
          />
        ) : (
          <CustomersPage />
        )
      ) : activeModule.id === "sales_agents" ? (
        <SalesAgentsPage />
      ) : activeModule.id === "dealers" ? (
        <DealersPage />
      ) : activeModule.id === "bookings" ? (
        bookingId ? (
          <BookingDetailPage
            bookingId={bookingId}
            key={`booking-${bookingId}`}
          />
        ) : (
          <BookingsPage module={activeModule} />
        )
      ) : activeModule.id === "approvals" ? (
        approvalId ? (
          <ApprovalDetailPage
            approvalId={approvalId}
            key={`approval-${approvalId}`}
          />
        ) : (
          <ApprovalsPage module={activeModule} />
        )
      ) : activeModule.id === "expenses" ? (
        expenseId ? (
          <ExpenseDetailPage
            expenseId={expenseId}
            key={`expense-${expenseId}`}
          />
        ) : (
          <ExpensesPage />
        )
      ) : activeModule.id === "vendors" ? (
        vendorId ? (
          <VendorDetailPage vendorId={vendorId} key={`vendor-${vendorId}`} />
        ) : (
          <VendorsPage />
        )
      ) : activeModule.id === "construction" ? (
        constructionPhaseId ? (
          <PhaseDetailPage
            phaseId={constructionPhaseId}
            key={`construction-phase-${constructionPhaseId}`}
          />
        ) : (
          <ConstructionPage />
        )
      ) : activeModule.id === "procurement" ? (
        procurementPoId ? (
          <PoDetailPage
            poId={procurementPoId}
            key={`procurement-po-${procurementPoId}`}
          />
        ) : procurementRequisitionId ? (
          <RequisitionDetailPage
            requisitionId={procurementRequisitionId}
            key={`procurement-requisition-${procurementRequisitionId}`}
          />
        ) : (
          <ProcurementPage />
        )
      ) : activeModule.id === "signatures" ? (
        <SignaturesPage />
      ) : activeModule.id === "tickets" ? (
        ticketId ? (
          <TicketDetailPage ticketId={ticketId} key={`ticket-${ticketId}`} />
        ) : (
          <TicketsPage />
        )
      ) : activeModule.id === "verifications" ? (
        // The verification queue owns its page: it is a `documents.verify`-
        // gated review surface over the documents module, not a generic
        // filtered table, so it does not fall through to `ModulePage`.
        <VerificationQueuePage key="verifications" />
      ) : activeModule.id === "payments" ? (
        // Payments is a full hub now — a receipts list with an allocation-aware
        // record dialog on one tab, the collections dashboard on the other — so
        // it owns its page instead of falling through to the generic `ModulePage`.
        <PaymentsPage module={activeModule} key="payments" />
      ) : activeModule.id === "reports" ? (
        <ReportsPage key="reports" />
      ) : activeModule.id === "audit" ? (
        // The Audit Log owns its page: it is a read-only, server-filtered table,
        // so it does not fall through to the generic `ModulePage`.
        <AuditLogPage key="audit" />
      ) : activeModule.id === "assistant" ? (
        // "Ask DeedOrbit" owns its page: it is a chat surface that posts a
        // question and renders a derived answer, not a filtered table.
        <AssistantPage key="assistant" />
      ) : (
        <ModulePage module={activeModule} key={activeModule.id} />
      )}
    </AppShell>
  )
}
