import { useState } from "react"
import {
  Building2,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  ShieldCheck,
} from "lucide-react"
import { cn } from "@/lib/utils"
import {
  navGroups,
  platformNavGroups,
  utilityNav,
  type NavIcon,
} from "@/lib/navigation"
import { href } from "@/lib/router"
import { brand } from "@/config/brand"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

export type SidebarMode = "expanded" | "rail" | "overlay"

type SidebarProps = {
  mode: SidebarMode
  activePath: string
  tenantName: string
  /**
   * Decides whether a module's link is shown, from the session's effective
   * grants. Hiding a link is convenience only — the route guard and the API
   * re-check the same grant.
   */
  canView: (module: string) => boolean
  onNavigate?: () => void
  onToggleCollapse?: () => void
  /** Rendered inside the footer of the off-canvas drawer. */
  onOpenSettings?: () => void
  /**
   * Links rendered in the footer area regardless of module grants - used for
   * the doorway between the workspace and the platform console for
   * platform-scope operators. The caller decides who sees them; the route
   * guard and the API re-check the scope anyway.
   */
  extraLinks?: NavEntry[]
  /**
   * Renders the Platform Super Admin chrome: shield mark, platform title, the
   * operations nav instead of the tenant modules, and a "Platform" badge where
   * the tenant drawer shows "ERP". The chrome is cosmetics only - the API
   * guard is what actually keeps this area platform-scoped.
   */
  platform?: boolean
}

/** The fields a sidebar link needs; both NavItem and PlatformNavItem fit. */
interface NavEntry {
  id: string
  label: string
  path: string
  icon: NavIcon
}

interface NavGroupBlock {
  id: string
  label: string
  items: NavEntry[]
}

function isActive(item: NavEntry, activePath: string) {
  return activePath === item.path || activePath.startsWith(`${item.path}/`)
}

function NavLink({
  item,
  active,
  rail,
  onNavigate,
}: {
  item: NavEntry
  active: boolean
  rail: boolean
  onNavigate?: () => void
}) {
  const link = (
    <a
      href={href(item.path)}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      aria-label={rail ? item.label : undefined}
      className={cn(
        "group relative flex h-8 items-center rounded-md text-[13px] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
        rail ? "mx-auto w-9 justify-center" : "w-full gap-2.5 px-2.5",
        active
          ? "bg-nav-active text-nav-foreground"
          : "text-nav-muted hover:bg-nav-hover hover:text-nav-foreground",
      )}
    >
      {active && (
        <span
          aria-hidden="true"
          className={cn(
            "absolute top-1.5 bottom-1.5 w-0.5 rounded-full bg-primary",
            rail ? "-left-2" : "-left-3",
          )}
        />
      )}
      <item.icon
        size={16}
        strokeWidth={active ? 2.1 : 1.8}
        className={cn(
          "shrink-0",
          active
            ? "text-primary"
            : "text-nav-subtle group-hover:text-nav-muted",
        )}
      />
      {!rail && <span className="truncate">{item.label}</span>}
    </a>
  )

  if (!rail) return link

  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  )
}

function NavGroupBlock({
  id,
  label,
  items,
  rail,
  activePath,
  isLast,
  onNavigate,
}: {
  id: string
  label: string
  items: NavEntry[]
  rail: boolean
  activePath: string
  isLast: boolean
  onNavigate?: () => void
}) {
  const [open, setOpen] = useState(true)
  const groupActive = items.some((item) => isActive(item, activePath))
  if (rail) {
    return (
      <div
        className={cn(
          "flex flex-col items-center gap-0.5 py-2",
          !isLast && "border-b border-nav-border/70",
        )}
      >
        {items.map((item) => (
          <NavLink
            key={item.id}
            item={item}
            active={isActive(item, activePath)}
            rail
            onNavigate={onNavigate}
          />
        ))}
      </div>
    )
  }

  return (
    <div className="py-1">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={`nav-group-${id}`}
        className="flex h-6 w-full items-center gap-1.5 rounded px-2.5 text-[10.5px] font-semibold tracking-[0.09em] text-nav-subtle uppercase transition-colors hover:text-nav-muted focus-visible:ring-2 focus-visible:ring-ring"
      >
        {label}
        <ChevronDown
          size={12}
          className={cn(
            "ml-auto transition-transform duration-150",
            !open && "-rotate-90",
          )}
        />
      </button>
      <div
        id={`nav-group-${id}`}
        className={cn(
          "grid transition-[grid-template-rows] duration-150 ease-out",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="overflow-hidden">
          <nav
            aria-label={label}
            className={cn(
              "flex flex-col gap-0.5 pb-1",
              groupActive && "text-nav-foreground",
            )}
          >
            {items.map((item) => (
              <NavLink
                key={item.id}
                item={item}
                active={isActive(item, activePath)}
                rail={false}
                onNavigate={onNavigate}
              />
            ))}
          </nav>
        </div>
      </div>
    </div>
  )
}

/** Nav body, shared by the fixed sidebar and the mobile drawer. */
export function SidebarContent({
  mode,
  activePath,
  onNavigate,
  onToggleCollapse,
  tenantName,
  canView,
  platform = false,
  extraLinks = [],
}: SidebarProps) {
  const rail = mode === "rail"

  // Drop whole groups whose modules are all invisible, so a restricted role does
  // not see an empty section heading. The platform area has no module grants to
  // filter by - reaching it already required a platform-scope role.
  const groups: NavGroupBlock[] = platform
    ? platformNavGroups
    : navGroups
        .map((group) => ({
          ...group,
          items: group.items.filter((item) =>
            canView(item.viewModule ?? item.id),
          ),
        }))
        .filter((group) => group.items.length > 0)
  const utility = platform
    ? extraLinks
    : [
        ...utilityNav.filter((item) => canView(item.viewModule ?? item.id)),
        ...extraLinks,
      ]

  const Mark = platform ? ShieldCheck : Building2

  return (
    <div className="flex h-full min-h-0 flex-col bg-nav text-nav-foreground">
      <div
        className={cn(
          "flex h-14 shrink-0 items-center border-b border-nav-border",
          rail ? "justify-center px-2" : "gap-2.5 px-4",
        )}
      >
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Mark size={16} strokeWidth={2.2} />
        </span>
        {!rail && (
          <div className="min-w-0 leading-tight">
            <p className="truncate text-[13px] font-semibold tracking-tight">
              {platform ? brand.platformName : brand.name}
            </p>
            <p className="truncate text-[10px] font-medium tracking-[0.08em] text-nav-subtle uppercase">
              {platform ? "Platform operations" : tenantName}
            </p>
          </div>
        )}
        {!rail && mode === "overlay" && (
          <span className="ml-auto rounded border border-nav-border px-1.5 py-0.5 text-[10px] font-medium text-nav-subtle">
            {platform ? "Platform" : "ERP"}
          </span>
        )}
      </div>

      <nav
        aria-label="Modules"
        className={cn(
          "scrollbar-slim min-h-0 flex-1 overflow-y-auto py-2",
          rail ? "px-2" : "px-2.5",
        )}
      >
        {groups.map((group, index) => (
          <NavGroupBlock
            key={group.id}
            id={group.id}
            label={group.label}
            items={group.items}
            rail={rail}
            activePath={activePath}
            isLast={index === groups.length - 1}
            onNavigate={onNavigate}
          />
        ))}
      </nav>

      <div
        className={cn(
          "shrink-0 border-t border-nav-border",
          rail ? "px-2 py-2" : "px-2.5 py-2",
        )}
      >
        {utility.map((item) => (
          <NavLink
            key={item.id}
            item={item}
            active={isActive(item, activePath)}
            rail={rail}
            onNavigate={onNavigate}
          />
        ))}

        {mode === "expanded" && onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            className="mt-1 flex h-7 w-full items-center gap-2.5 rounded-md px-2.5 text-[12.5px] font-medium text-nav-subtle transition-colors hover:bg-nav-hover hover:text-nav-muted"
          >
            <ChevronsLeft size={15} />
            Collapse
          </button>
        )}
        {mode === "rail" && onToggleCollapse && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onToggleCollapse}
                className="mt-1 flex h-8 w-full items-center justify-center rounded-md text-nav-subtle transition-colors hover:bg-nav-hover hover:text-nav-muted focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ChevronsRight size={15} />
                <span className="sr-only">Expand sidebar</span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Expand sidebar</TooltipContent>
          </Tooltip>
        )}

        {!rail && (
          <div className="mt-1.5 flex items-center justify-between px-2.5 text-[10.5px] text-nav-subtle">
            <span>{platform ? brand.platformName : `${brand.name} ERP`}</span>
            <span className="rounded border border-nav-border px-1 py-px font-medium">
              v0.1
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

export function Sidebar(props: SidebarProps) {
  const rail = props.mode === "rail"
  return (
    <aside
      data-mode={props.mode}
      className={cn(
        "fixed inset-y-0 left-0 z-40 hidden shrink-0 border-r border-nav-border transition-[width] duration-200 lg:block",
        rail ? "w-16" : "w-60",
      )}
    >
      <SidebarContent {...props} />
    </aside>
  )
}

/** Off-canvas drawer for phones and small tablets. */
export function SidebarDrawer({
  open,
  onOpenChange,
  platform,
  ...props
}: Omit<SidebarProps, "mode"> & {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="left"
        showCloseButton={false}
        className="w-60 max-w-[85vw] border-0 p-0 lg:hidden"
      >
        <SheetTitle className="sr-only">Module navigation</SheetTitle>
        <SheetDescription className="sr-only">
          {platform
            ? `Jump to a screen of the ${brand.platformName} console.`
            : `Jump to a module of the ${brand.name} workspace.`}
        </SheetDescription>
        <SidebarContent
          {...props}
          platform={platform}
          mode="overlay"
          onNavigate={() => onOpenChange(false)}
        />
      </SheetContent>
    </Sheet>
  )
}
