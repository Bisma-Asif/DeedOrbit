import { useEffect, useMemo, useState, type ReactNode } from "react"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Building2, ShieldCheck } from "lucide-react"
import {
  Sidebar,
  SidebarDrawer,
  type SidebarMode,
} from "@/components/layout/sidebar"
import { TopBar } from "@/components/layout/top-bar"
import { findModuleByPath } from "@/lib/navigation"
import { ROLES } from "@shared/access"
import { tenantFromSession, userFromSession } from "@/lib/workspace"
import { BREAKPOINTS, useMediaQuery } from "@/lib/use-media-query"
import { cn } from "@/lib/utils"
import type { SessionPayload } from "@/lib/api"

const SIDEBAR_WIDTHS: Record<SidebarMode, number> = {
  expanded: 240,
  rail: 64,
  overlay: 0,
}

type AppShellProps = {
  session: SessionPayload
  path: string
  /** Decides which modules appear in the navigation, from the DB grants. */
  canView: (module: string) => boolean
  onSwitchTenant: (tenantId: string) => void
  onSignOut: () => void
  /**
   * Swap the chrome to the Platform Super Admin variant: shield mark, "Platform
   * operations" sidebar, no tenant module links. Set from the session's role
   * scope in the route switch, never from the URL alone.
   */
  platform?: boolean
  children: ReactNode
}

/**
 * Fixed application chrome: navy sidebar on the left, top bar with tenant
 * switcher / search / notifications / user menu, and a scrollable content
 * region sized to clear both.
 */
export function AppShell({
  session,
  path,
  canView,
  onSwitchTenant,
  onSignOut,
  platform = false,
  children,
}: AppShellProps) {
  const [navOpen, setNavOpen] = useState(false)
  const [collapsedByUser, setCollapsedByUser] = useState(false)

  const canExpand = useMediaQuery(BREAKPOINTS.sidebarExpanded)
  const isOverlay = !useMediaQuery(`not ${BREAKPOINTS.sidebarOverlay}`)

  const mode: SidebarMode = isOverlay
    ? "overlay"
    : canExpand && !collapsedByUser
      ? "expanded"
      : "rail"

  const offset = SIDEBAR_WIDTHS[mode]
  const tenant = useMemo(() => tenantFromSession(session), [session])
  const user = useMemo(
    () => userFromSession(session.user, session.role.label),
    [session.user, session.role.label],
  )
  const activeModule = findModuleByPath(path)

  // The doorway between the two chrome surfaces: a platform-scope operator
  // sees "Platform console" in the tenant sidebar and "Back to workspace" in
  // the platform sidebar. An entry link is discoverability only - the route
  // switch and the API both re-check the role scope.
  const isPlatformOperator = ROLES.some(
    (role) => role.id === session.role.id && role.scope === "platform",
  )
  const crossSurfaceLink = !isPlatformOperator
    ? null
    : platform
      ? {
          id: "workspace-entry",
          label: "Back to workspace",
          path: "/dashboard",
          icon: Building2,
        }
      : {
          id: "platform-entry",
          label: "Platform console",
          path: "/platform/tenants",
          icon: ShieldCheck,
        }

  // The server returns only the modules this role may open, so a revoked grant
  // removes the link. The route guard is separate and still enforced.
  useEffect(() => {
    setNavOpen(false)
  }, [path])

  return (
    <TooltipProvider>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-nav focus:px-3 focus:py-1.5 focus:text-[12px] focus:font-medium focus:text-nav-foreground"
      >
        Skip to content
      </a>
      <div className="min-h-dvh bg-background text-foreground">
        <Sidebar
          mode={mode}
          activePath={path}
          tenantName={tenant.name}
          canView={canView}
          platform={platform}
          extraLinks={crossSurfaceLink ? [crossSurfaceLink] : []}
          // Only offer the toggle where an expanded sidebar actually fits.
          onToggleCollapse={
            canExpand ? () => setCollapsedByUser((value) => !value) : undefined
          }
        />

        <SidebarDrawer
          open={navOpen}
          onOpenChange={setNavOpen}
          activePath={path}
          tenantName={tenant.name}
          canView={canView}
          platform={platform}
          extraLinks={crossSurfaceLink ? [crossSurfaceLink] : []}
        />

        <TopBar
          user={user}
          tenant={tenant}
          memberships={session.memberships}
          moduleLabel={
            activeModule?.label ?? (platform ? "Platform" : "Workspace")
          }
          onOpenNav={() => setNavOpen(true)}
          onSwitchTenant={onSwitchTenant}
          onSignOut={onSignOut}
          offset={offset}
        />

        <div
          className={cn(
            "flex min-h-dvh flex-col pt-14 transition-[padding] duration-200",
          )}
          style={{ paddingLeft: offset }}
        >
          <main id="main-content" className="flex-1 px-3 py-4 md:px-5 md:py-5">
            <div className="mx-auto w-full max-w-[1600px]">{children}</div>
          </main>
          <footer className="border-t border-border px-4 py-3 md:px-6">
            <div className="mx-auto flex w-full max-w-[1600px] flex-wrap items-center justify-between gap-2 text-[11.5px] text-muted-foreground">
              <p>
                {platform
                  ? `Platform console · ${session.role.label}`
                  : `${tenant.legalName} · ${tenant.role}`}
              </p>
              <p className="tabular-nums">Signed in as {user.email}</p>
            </div>
          </footer>
        </div>
      </div>
    </TooltipProvider>
  )
}
