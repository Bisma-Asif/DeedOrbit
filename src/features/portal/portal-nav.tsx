/**
 * The portal's top navigation.
 *
 * Deliberately not the staff sidebar: a buyer needs four places, so this is a
 * single low-density bar — the workspace name on the left, the four portal
 * sections in the middle, and the signed-in identity plus sign-out on the right.
 * It reuses the navy token the staff shell uses for its rail so the two read as
 * one product, only lighter.
 */

import { Home, LogOut, Receipt, FileText, LifeBuoy } from "lucide-react"

import type { LucideIcon } from "lucide-react"

import { Button } from "@/components/ui/button"

import { initialsOf } from "@/lib/workspace"

import { href, navigate } from "@/lib/router"

import { cn } from "@/lib/utils"

import type { PortalNavKey } from "@shared/portal"

interface PortalNavLink {
  key: PortalNavKey

  label: string

  path: string

  icon: LucideIcon
}

/** The fixed portal sections, ordered as the shell shows them. */

export const PORTAL_LINKS: PortalNavLink[] = [
  { key: "overview", label: "Overview", path: "/portal", icon: Home },

  {
    key: "payments",
    label: "Payments",
    path: "/portal/payments",
    icon: Receipt,
  },

  {
    key: "documents",

    label: "Documents",

    path: "/portal/documents",

    icon: FileText,
  },

  {
    key: "requests",

    label: "My requests",

    path: "/portal/requests",

    icon: LifeBuoy,
  },
]

/** Which nav key a portal path belongs to, for the active underline. */

export function activePortalKey(path: string): PortalNavKey {
  if (path.startsWith("/portal/payments")) return "payments"

  if (path.startsWith("/portal/documents")) return "documents"

  if (path.startsWith("/portal/requests")) return "requests"

  return "overview"
}

interface PortalNavProps {
  path: string

  tenantName: string

  userName: string

  userEmail: string

  onSignOut: () => void
}

export function PortalNav({
  path,

  tenantName,

  userName,

  userEmail,

  onSignOut,
}: PortalNavProps) {
  const active = activePortalKey(path)

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-nav text-nav-foreground">
      <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-3 px-4 py-3 md:flex-row md:items-center md:justify-between md:gap-4 md:py-3.5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-md bg-nav-foreground/15 text-[13px] font-semibold tracking-tight">
              {initialsOf(tenantName)}
            </span>
            <div className="min-w-0 leading-tight">
              <p className="truncate text-[14px] font-semibold">{tenantName}</p>
              <p className="text-[11px] text-nav-foreground/70">
                Customer portal
              </p>
            </div>
          </div>
        </div>

        <nav className="flex flex-wrap items-center gap-1">
          {PORTAL_LINKS.map((link) => {
            const isActive = link.key === active

            const Icon = link.icon

            return (
              <a
                key={link.key}
                href={href(link.path)}
                aria-current={isActive ? "page" : undefined}
                onClick={(event) => {
                  event.preventDefault()

                  navigate(link.path)
                }}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] font-medium transition-colors",

                  isActive
                    ? "bg-nav-foreground/15 text-nav-foreground"
                    : "text-nav-foreground/75 hover:bg-nav-foreground/10 hover:text-nav-foreground",
                )}
              >
                <Icon size={14} />
                {link.label}
              </a>
            )
          })}
        </nav>

        <div className="flex items-center gap-2">
          <div className="min-w-0 leading-tight text-right">
            <p className="truncate text-[12.5px] font-medium">{userName}</p>
            <p className="truncate text-[11px] text-nav-foreground/70">
              {userEmail}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="text-nav-foreground/80 hover:bg-nav-foreground/10 hover:text-nav-foreground"
            onClick={onSignOut}
          >
            <LogOut size={14} />
            Sign out
          </Button>
        </div>
      </div>
    </header>
  )
}
