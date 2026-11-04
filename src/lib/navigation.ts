import { brand } from "@/config/brand"
import type { LucideIcon } from "lucide-react"
import {
  BarChart3,
  BookOpenCheck,
  ContactRound,
  FolderKanban,
  HardHat,
  History,
  LayoutDashboard,
  LifeBuoy,
  Megaphone,
  PackageOpen,
  PenLine,
  Receipt,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Truck,
  UserRound,
  Users,
  UsersRound,
  Wallet,
} from "lucide-react"

export type NavIcon = LucideIcon

/**
 * Sidebar modules. `users` is deliberately absent: member and role administration
 * lives inside the Settings screen rather than in a nav entry of its own, so it
 * is reachable through `settings` and needs no module of its own here.
 */
export type ModuleId = "dashboard" | "projects" | "inventory" | "leads" | "campaigns" | "sales_agents" | "dealers" | "bookings" | "payments" | "customers" | "expenses" | "vendors" | "procurement" | "construction" | "signatures" | "tickets" | "verifications" | "approvals" | "reports" | "audit" | "settings" | "assistant"

export type NavItem = {
  id: ModuleId
  label: string
  path: string
  icon: NavIcon
  description: string
  /** Short label used in collapsed icon rail tooltips and page subtitles. */
  noun: string
  primaryAction: string
  /**
   * The permission module that gates this nav entry, when it is not the entry's
   * own id. `verifications` is a workspace screen, not a permission module — it
   * is shown to anyone who can read documents, so it declares
   * `viewModule: "documents"`. The sidebar filter and the route guard both read
   * this; a hidden link is convenience, the API re-checks the grant anyway.
   */
  viewModule?: string
}

export type NavGroup = {
  id: string
  label: string
  items: NavItem[]
}

export const modules: Record<ModuleId, NavItem> = {
  dashboard: {
    id: "dashboard",
    label: "Dashboard",
    path: "/dashboard",
    icon: LayoutDashboard,
    noun: "dashboard",
    description: "Operating overview across every entity in the workspace.",
    primaryAction: "Customise",
  },
  projects: {
    id: "projects",
    label: "Projects",
    path: "/projects",
    icon: FolderKanban,
    noun: "project",
    description: "Developments, phases, towers, and their commercial terms.",
    primaryAction: "New project",
  },
  inventory: {
    id: "inventory",
    label: "Inventory",
    path: "/inventory",
    icon: PackageOpen,
    noun: "unit",
    description:
      "Sellable units, pricing, availability, and reservation status.",
    primaryAction: "Add unit",
  },
  leads: {
    id: "leads",
    label: "Leads",
    path: "/leads",
    icon: Users,
    noun: "lead",
    description: "Pipeline of enquiries, owners, and allocation status.",
    primaryAction: "New lead",
  },
  sales_agents: {
    id: "sales_agents",
    label: "Sales Agents",
    path: "/sales-agents",
    icon: UsersRound,
    noun: "agent",
    description: "Sales teams, monthly targets, and agent performance.",
    primaryAction: "New team",
  },
  dealers: {
    id: "dealers",
    label: "Dealers / Channel Partners",
    path: "/dealers",
    icon: ContactRound,
    noun: "dealer",
    description:
      "Partner onboarding, referrals, commission rules, and payable statements.",
    primaryAction: "Onboard dealer",
  },
  bookings: {
    id: "bookings",
    label: "Bookings",
    path: "/bookings",
    icon: BookOpenCheck,
    noun: "booking",
    description: "Confirmed sales, allocation holds, and handover milestones.",
    primaryAction: "New booking",
  },
  payments: {
    id: "payments",
    label: "Payments",
    path: "/payments",
    icon: Wallet,
    noun: "payment",
    description: "Instalments, receipts, ledgers, and outstanding balances.",
    primaryAction: "Record payment",
  },
  customers: {
    id: "customers",
    label: "Customers",
    path: "/customers",
    icon: UserRound,
    noun: "customer",
    description: "Buyers, co-buyers, and their complete account history.",
    primaryAction: "New customer",
  },
  expenses: {
    id: "expenses",
    label: "Expenses",
    path: "/expenses",
    icon: Receipt,
    noun: "expense",
    description:
      "Project, office, marketing, and construction spend routed through approval.",
    primaryAction: "New expense",
  },
  vendors: {
    id: "vendors",
    label: "Vendors",
    path: "/vendors",
    icon: Truck,
    noun: "vendor",
    description:
      "Supplier profiles, contracts, invoices, payments, and the running vendor ledger.",
    primaryAction: "New vendor",
  },
  procurement: {
    id: "procurement",
    label: "Procurement",
    path: "/procurement",
    icon: ShoppingCart,
    noun: "requisition",
    description:
      "Requisitions, purchase orders, goods receipts, and stock — matched against the vendor ledger.",
    primaryAction: "New requisition",
  },
  construction: {
    id: "construction",
    label: "Construction",
    path: "/construction",
    icon: HardHat,
    noun: "phase",
    description:
      "Phases, tasks, and site progress per project, with spend read from tagged ledger rows.",
    primaryAction: "New phase",
  },
  signatures: {
    id: "signatures",
    label: "Signatures",
    path: "/signatures",
    icon: PenLine,
    noun: "envelope",
    description:
      "Document templates and the in-app signing ceremony, audited per signer.",
    primaryAction: "New envelope",
  },
  campaigns: {
    id: "campaigns",
    label: "Campaigns",
    path: "/campaigns",
    icon: Megaphone,
    noun: "campaign",
    description:
      "Lead sources, their public intake endpoints, and leads-to-bookings conversion.",
    primaryAction: "New campaign",
  },
  approvals: {
    id: "approvals",
    label: "Approvals",
    path: "/approvals",
    icon: ShieldCheck,
    noun: "approval",
    description: "Requests held for sign-off before they take effect.",
    primaryAction: "",
  },
  reports: {
    id: "reports",
    label: "Reports",
    path: "/reports",
    icon: BarChart3,
    noun: "report",
    description:
      "Financial and operational statements, filtered by period, project, and branch.",
    primaryAction: "",
  },
  audit: {
    id: "audit",
    label: "Audit log",
    path: "/audit",
    icon: History,
    noun: "event",
    description:
      "The read-only trail of every booking, payment, price change, and access event, with actor and timestamp.",
    primaryAction: "",
  },
  settings: {
    id: "settings",
    label: "Settings",
    path: "/settings",
    icon: Settings,
    noun: "setting",
    description:
      "Organisation profile, offices, document numbering, and access control.",
    primaryAction: "Save changes",
  },
  tickets: {
    id: "tickets",
    label: "Support tickets",
    path: "/tickets",
    icon: LifeBuoy,
    noun: "ticket",
    description:
      "Service requests raised from the customer portal, with assignment and SLA.",
    primaryAction: "New ticket",
  },
  verifications: {
    id: "verifications",
    label: "Document verification",
    path: "/verifications",
    icon: ShieldCheck,
    noun: "document",
    description:
      "The review queue for customer papers — certify, reject, or ask for a fresh copy.",
    primaryAction: "",
    viewModule: "documents",
  },
  assistant: {
    id: "assistant",
    label: `Ask ${brand.name}`,
    path: "/assistant",
    icon: Sparkles,
    noun: "question",
    description:
      "Ask a plain-language question about your workspace and get a sourced answer.",
    primaryAction: "",
  },
}

export const navGroups: NavGroup[] = [
  {
    id: "overview",
    label: "Overview",
    items: [
      modules.dashboard,
      modules.assistant,
      modules.approvals,
      modules.reports,
      modules.audit,
    ],
  },
  {
    id: "portfolio",
    label: "Portfolio",
    items: [modules.projects, modules.inventory],
  },
  {
    id: "sales",
    label: "Sales",
    items: [
      modules.leads,
      modules.campaigns,
      modules.sales_agents,
      modules.dealers,
      modules.bookings,
      modules.customers,
    ],
  },
  {
    id: "finance",
    label: "Finance",
    items: [
      modules.payments,
      modules.expenses,
      modules.vendors,
      modules.procurement,
    ],
  },
  {
    id: "delivery",
    label: "Delivery",
    items: [modules.construction],
  },
  {
    id: "support",
    label: "Support",
    items: [modules.tickets, modules.verifications, modules.signatures],
  },
]

/** Rendered in the sidebar footer, outside the collapsible groups. */
export const utilityNav: NavItem[] = [modules.settings]

/**
 * Platform Super Admin navigation.
 *
 * Deliberately not `NavItem`s: these are not permission modules. The gate is
 * the session's role *scope* (`roles.scope = 'platform'`), checked in the route
 * switch and again on every API call, so nothing here can leak into a tenant's
 * module-grant list - not even a tenant owner, whose `all: true` expands to
 * every entry in the permission catalogue.
 */
export interface PlatformNavItem {
  id: string
  label: string
  path: string
  icon: NavIcon
}

export interface PlatformNavGroup {
  id: string
  label: string
  items: PlatformNavItem[]
}

export const platformNavGroups: PlatformNavGroup[] = [
  {
    id: "operations",
    label: "Platform operations",
    items: [
      {
        id: "platform-tenants",
        label: "Workspaces",
        path: "/platform/tenants",
        icon: ShieldCheck,
      },
    ],
  },
]

/** The path prefix that marks the platform area for the shell and the router. */
export const PLATFORM_BASE_PATH = "/platform"

export function isPlatformPath(path: string): boolean {
  return (
    path === PLATFORM_BASE_PATH || path.startsWith(`${PLATFORM_BASE_PATH}/`)
  )
}

export function findModuleByPath(path: string): NavItem | undefined {
  const normalized = path.split("/").slice(0, 2).join("/") || "/dashboard"
  return Object.values(modules).find((module) => module.path === normalized)
}
