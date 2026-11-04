import { FileBarChart, HandCoins, Trophy, UserPlus, Users } from "lucide-react"

import type { LucideIcon } from "lucide-react"

import { Button } from "@/components/ui/button"

import type { PermissionModule } from "@shared/access"

import { navigate } from "@/lib/router"

import { cn } from "@/lib/utils"

interface QuickAction {
  label: string

  icon: LucideIcon

  to: string

  module: PermissionModule

  /** Only the create grant opens these; a viewer still needs the row itself. */

  requiresCreate: boolean
}

const ACTIONS: QuickAction[] = [
  {
    label: "Add Lead",

    icon: UserPlus,

    to: "/leads",

    module: "leads",

    requiresCreate: true,
  },

  {
    label: "New Booking",
    icon: Trophy,
    to: "/bookings?new=1",
    module: "bookings",
    requiresCreate: true,
  },

  {
    label: "Record Payment",
    icon: HandCoins,
    to: "/payments?tab=payments&new=1",
    module: "payments",
    requiresCreate: true,
  },

  {
    label: "Add Customer",
    icon: Users,
    to: "/customers?new=1",
    module: "customers",
    requiresCreate: true,
  },

  {
    label: "Generate Report",
    icon: FileBarChart,
    to: "/reports",
    module: "reports",
    requiresCreate: false,
  },
]

/**
 * The five actions that start the daily work, gated by the same grants the
 * target pages enforce — so a role that cannot create never sees a button that
 * would only bounce it off a 403.
 */

export function QuickActions({
  can,

  className,
}: {
  can: (module: PermissionModule, action: "view" | "create") => boolean

  className?: string
}) {
  const visible = ACTIONS.filter((action) =>
    can(action.module, action.requiresCreate ? "create" : "view"),
  )

  if (visible.length === 0) return null

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2.5",

        className,
      )}
    >
      <span className="mr-1 text-[11px] font-semibold tracking-[0.07em] text-muted-foreground uppercase">
        Quick actions
      </span>

      {visible.map((action) => (
        <Button
          key={action.label}
          variant="outline"
          size="sm"
          onClick={() => {
            navigate(action.to)
          }}
        >
          <action.icon size={13} />
          {action.label}
        </Button>
      ))}
    </div>
  )
}
