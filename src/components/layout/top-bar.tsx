import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Banknote,
  Bell,
  Building2,
  CalendarCheck,
  Check,
  CheckCheck,
  ChevronDown,
  CircleHelp,
  ClipboardCheck,
  FileText,
  LifeBuoy,
  LogOut,
  Menu,
  Package,
  PenLine,
  Search,
  Settings2,
  ShoppingCart,
  TriangleAlert,
  UserRound,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { href, navigate } from "@/lib/router"
import { formatRelative } from "@/lib/format"
import { notificationApi } from "@/lib/notifications-api"
import type { NotificationView } from "@shared/notifications"
import { initialsOf, type SessionUser, type Tenant } from "@/lib/workspace"
import type { Membership } from "@/lib/api"
import { searchApi } from "@/lib/search-api"
import type { SearchHit, SearchResults } from "@shared/reports"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Separator } from "@/components/ui/separator"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { EmptyState } from "@/components/empty-state"

type TopBarProps = {
  user: SessionUser
  tenant: Tenant
  /** Every tenant this user can reach, from the session payload. */
  memberships: Membership[]
  moduleLabel: string
  onOpenNav: () => void
  onSwitchTenant: (tenantId: string) => void
  onSignOut: () => void
  /** Left offset so the bar clears the fixed sidebar. */
  offset: number
}

function TenantMark({
  initials,
  className,
}: {
  initials: string
  className?: string
}) {
  return (
    <span
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded-[5px] bg-primary text-[10px] font-bold text-primary-foreground",
        className,
      )}
      aria-hidden="true"
    >
      {initials}
    </span>
  )
}

function TenantSwitcher({
  tenant,
  memberships,
  onSwitch,
}: {
  tenant: Tenant
  memberships: Membership[]
  onSwitch: (tenantId: string) => void
}) {
  // A single-membership user has nothing to switch to, so the control is a
  // plain label rather than a menu that would open with one dead row.
  if (memberships.length <= 1) {
    return (
      <div className="flex h-8 max-w-[15rem] items-center gap-2 px-1.5">
        <TenantMark initials={tenant.initials} />
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-foreground">
          {tenant.name}
        </span>
      </div>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex h-8 max-w-[15rem] items-center gap-2 rounded-md border border-border-strong bg-card px-1.5 pr-2 text-left shadow-xs transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <TenantMark initials={tenant.initials} />
          <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-foreground">
            {tenant.name}
          </span>
          <ChevronDown size={13} className="shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel>Organisation</DropdownMenuLabel>
        {memberships.map((entry) => {
          const active = entry.id === tenant.id
          return (
            <DropdownMenuItem
              key={entry.id}
              onSelect={() => !active && onSwitch(entry.id)}
              className="items-start gap-2.5 py-2"
            >
              <TenantMark
                initials={entry.logoInitials ?? initialsOf(entry.name)}
                className="mt-px"
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-[13px] font-medium text-foreground">
                    {entry.name}
                  </span>
                  {active && (
                    <Check size={13} className="shrink-0 text-primary" />
                  )}
                </span>
                <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                  {entry.legalName ?? entry.name} · {entry.roleLabel}
                </span>
              </span>
            </DropdownMenuItem>
          )
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate("/settings")}>
          <Settings2 size={14} />
          Organisation settings
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const NOTIFICATION_ICONS: Record<NotificationView["type"], LucideIcon> = {
  booking_confirmed: CalendarCheck,
  payment_recorded: Banknote,
  approval_requested: ClipboardCheck,
  document_uploaded: FileText,
  requisition_decided: ShoppingCart,
  purchase_order_received: Package,
  envelope_completed: PenLine,
  payment_escalation: TriangleAlert,
}

/** Unread badge text, capped so a long inbox never overflows the little dot. */
function unreadBadgeLabel(count: number): string {
  if (count <= 0) return ""
  return count > 9 ? "9+" : String(count)
}

/**
 * The notification bell.
 *
 * It reads the caller's own inbox from `GET /api/notifications` on mount and then
 * every 30 s, so an approval request or a colleague's booking reaches the bell
 * without a refresh. The badge is the whole unread count (the server sends it
 * independent of any filter), never just the newest 20 rows shown here. Opening a
 * row marks it read and jumps to the record; there is no fabricated email send —
 * this surface only ever shows what actually happened.
 */
function NotificationsBell() {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<NotificationView[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const data = await notificationApi.list({ limit: 20 }, signal)

      if (signal?.aborted) return

      setItems(data.notifications)

      setUnreadCount(data.unreadCount)

      setError(null)
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return

      setError("Could not load your notifications.")
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()

    void load(controller.signal)

    const timer = setInterval(() => void load(), 30_000)

    return () => {
      controller.abort()

      clearInterval(timer)
    }
  }, [load])

  async function openItem(item: NotificationView) {
    if (!item.readAt) {
      const readAt = new Date().toISOString()

      setItems((prev) =>
        prev.map((n) => (n.id === item.id ? { ...n, readAt } : n)),
      )

      setUnreadCount((count) => Math.max(0, count - 1))

      try {
        await notificationApi.markRead(item.id)
      } catch {
        // Optimistic mark; a failure here is corrected on the next poll rather
        // than blocking the jump to the record the user asked for.
      }
    }

    setOpen(false)

    if (item.linkPath) navigate(item.linkPath)
  }

  async function markAll() {
    setItems((prev) =>
      prev.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })),
    )

    setUnreadCount(0)

    try {
      await notificationApi.markAllRead()
    } catch {
      void load()
    }
  }

  const badge = unreadBadgeLabel(unreadCount)

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)

        if (next) void load()
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={`Notifications${badge ? `, ${unreadCount} unread` : ""}`}
        >
          <Bell size={16} />
          {badge && (
            <span className="absolute top-1 right-1 flex min-w-3.5 items-center justify-center rounded-full bg-primary px-1 text-[9px] leading-3 font-bold text-primary-foreground">
              {badge}
            </span>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-[24rem] p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <p className="text-[13px] font-semibold text-foreground">
            Notifications
          </p>
          {unreadCount > 0 ? (
            <button
              type="button"
              onClick={() => void markAll()}
              className="inline-flex items-center gap-1 rounded-sm text-[11.5px] font-medium text-primary transition-colors hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <CheckCheck size={13} />
              Mark all read
            </button>
          ) : (
            <Badge variant="outline">All read</Badge>
          )}
        </div>

        {error ? (
          <div className="px-3 py-6 text-center">
            <p className="text-[12.5px] text-muted-foreground">{error}</p>
            <button
              type="button"
              onClick={() => {
                setLoading(true)

                void load()
              }}
              className="mt-1.5 text-[12px] font-medium text-primary hover:underline"
            >
              Try again
            </button>
          </div>
        ) : loading && items.length === 0 ? (
          <p className="px-3 py-6 text-center text-[12.5px] text-muted-foreground">
            Loading…
          </p>
        ) : items.length === 0 ? (
          <EmptyState
            icon={Bell}
            size="sm"
            title="Nothing needs your attention"
            description="Confirmed bookings, recorded payments, approval requests, and uploaded documents will appear here."
          />
        ) : (
          <div className="scrollbar-slim max-h-[22rem] overflow-y-auto py-1">
            {items.map((item) => {
              const Icon = NOTIFICATION_ICONS[item.type]

              const unread = item.readAt === null

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => void openItem(item)}
                  className={cn(
                    "flex w-full items-start gap-2.5 px-3 py-2 text-left transition-colors hover:bg-muted",
                    unread && "bg-primary/[0.04]",
                  )}
                >
                  <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-[5px] border border-border bg-muted text-muted-foreground">
                    <Icon size={13} />
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-1.5">
                      <span
                        className={cn(
                          "min-w-0 flex-1 truncate text-[12.5px]",
                          unread
                            ? "font-semibold text-foreground"
                            : "font-medium text-muted-foreground",
                        )}
                      >
                        {item.title}
                      </span>
                      {unread && (
                        <span
                          aria-label="Unread"
                          className="size-1.5 shrink-0 rounded-full bg-primary"
                        />
                      )}
                    </span>

                    {item.body && (
                      <span className="mt-0.5 block truncate text-[11.5px] text-muted-foreground">
                        {item.body}
                      </span>
                    )}

                    <span className="mt-0.5 block text-[10.5px] text-muted-foreground/80">
                      {item.typeLabel} · {formatRelative(item.createdAt)}
                      {item.actorName ? ` · ${item.actorName}` : ""}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        )}

        <div className="flex items-center justify-between border-t border-border px-3 py-2">
          <a
            href={href("/notifications")}
            onClick={() => setOpen(false)}
            className="text-[12px] font-medium text-primary hover:underline"
          >
            View all notifications
          </a>
          <a
            href={href("/settings/notifications")}
            onClick={() => setOpen(false)}
            className="text-[12px] font-medium text-muted-foreground hover:text-foreground hover:underline"
          >
            Notification settings
          </a>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function UserMenu({
  user,
  onSignOut,
}: {
  user: SessionUser
  onSignOut: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex h-8 items-center gap-2 rounded-md px-1 pr-1.5 transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <Avatar>
            <AvatarFallback>{user.initials}</AvatarFallback>
          </Avatar>
          <span className="hidden text-left leading-tight xl:block">
            <span className="block text-[12.5px] font-medium text-foreground">
              {user.name}
            </span>
            <span className="block text-[10.5px] text-muted-foreground">
              {user.roleLabel}
            </span>
          </span>
          <ChevronDown
            size={13}
            className="hidden shrink-0 text-muted-foreground sm:block"
          />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="normal-case">
          <span className="block text-[12.5px] font-semibold text-foreground">
            {user.name}
          </span>
          <span className="mt-0.5 block text-[11px] font-normal tracking-normal text-muted-foreground">
            {user.email}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate("/settings")}>
          <UserRound size={14} />
          My profile
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate("/settings")}>
          <Settings2 size={14} />
          Preferences
          <span className="ml-auto text-[10.5px] text-muted-foreground">
            ⌘,
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem>
          <LifeBuoy size={14} />
          Support centre
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="danger" onSelect={onSignOut}>
          <LogOut size={14} />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

type SearchGroupKey = "projects" | "units" | "customers" | "bookings"

const SEARCH_GROUPS: Array<{
  key: SearchGroupKey
  label: string
  icon: LucideIcon
}> = [
  { key: "projects", label: "Projects", icon: Building2 },
  { key: "units", label: "Units", icon: Package },
  { key: "customers", label: "Customers", icon: UserRound },
  { key: "bookings", label: "Bookings", icon: CalendarCheck },
]

/**
 * The top-bar global search.
 *
 * A debounced (250 ms) `GET /api/search` renders grouped results under the input —
 * only the groups the server returned, which are already narrowed to the modules the
 * caller may view. Ctrl/Cmd+K focuses the box, the arrows walk the flattened list,
 * Enter opens the highlighted record, and Escape closes the panel. A term shorter
 * than two characters fires nothing and shows a hint rather than an empty dropdown.
 */
function GlobalSearch() {
  const [query, setQuery] = useState("")

  const [open, setOpen] = useState(false)

  const [loading, setLoading] = useState(false)

  const [results, setResults] = useState<SearchResults | null>(null)

  const [active, setActive] = useState(0)

  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()

        inputRef.current?.focus()

        inputRef.current?.select()

        setOpen(true)
      }
    }

    window.addEventListener("keydown", onKey)

    return () => window.removeEventListener("keydown", onKey)
  }, [])

  useEffect(() => {
    const term = query.trim()

    if (term.length < 2) {
      setResults(null)

      setLoading(false)

      return
    }

    setLoading(true)

    const controller = new AbortController()

    const timer = setTimeout(() => {
      searchApi
        .run(term, controller.signal)
        .then((payload) => {
          setResults(payload)

          setActive(0)

          setOpen(true)
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError")
            return

          setResults(null)
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false)
        })
    }, 250)

    return () => {
      clearTimeout(timer)

      controller.abort()
    }
  }, [query])

  const items = useMemo(() => {
    const flat: Array<SearchHit & { group: SearchGroupKey }> = []

    for (const group of SEARCH_GROUPS) {
      for (const hit of results?.[group.key] ?? [])
        flat.push({ ...hit, group: group.key })
    }

    return flat
  }, [results])

  const groupMeta = useMemo(() => {
    const map = new Map(SEARCH_GROUPS.map((g) => [g.key, g]))

    return map
  }, [])

  function goTo(hit: SearchHit) {
    navigate(hit.path)

    setOpen(false)

    setQuery("")

    setResults(null)

    inputRef.current?.blur()
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setOpen(false)

      return
    }

    if (items.length === 0) return

    if (event.key === "ArrowDown") {
      event.preventDefault()

      setOpen(true)

      setActive((index) => (index + 1) % items.length)
    } else if (event.key === "ArrowUp") {
      event.preventDefault()

      setActive((index) => (index - 1 + items.length) % items.length)
    } else if (event.key === "Enter") {
      event.preventDefault()

      const hit = items[active]

      if (hit) goTo(hit)
    }
  }

  const showPanel = open && (loading || query.trim().length >= 2)

  return (
    <Popover open={showPanel}>
      <PopoverAnchor asChild>
        <div className="relative w-full max-w-md">
          <Search
            size={14}
            className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)

              setOpen(true)
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            placeholder="Search projects, units, customers, bookings"
            aria-label="Global search"
            role="combobox"
            aria-expanded={showPanel}
            aria-controls="global-search-results"
            className="bg-muted/50 pl-7.5 pr-14"
          />
          <kbd className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded border border-border bg-card px-1 py-px font-sans text-[10px] text-muted-foreground">
            Ctrl K
          </kbd>
        </div>
      </PopoverAnchor>

      <PopoverContent
        id="global-search-results"
        align="start"
        className="w-[min(30rem,90vw)] p-0"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        {loading ? (
          <p className="px-3 py-4 text-[12.5px] text-muted-foreground">
            Searching…
          </p>
        ) : items.length === 0 ? (
          <p className="px-3 py-4 text-[12.5px] text-muted-foreground">
            No matches for “{query.trim()}”
          </p>
        ) : (
          <div
            role="listbox"
            aria-label="Search results"
            className="scrollbar-slim max-h-80 overflow-y-auto py-1"
          >
            {items.map((hit, index) => {
              const previous = items[index - 1]

              const meta = groupMeta.get(hit.group)

              const GroupIcon = meta?.icon ?? Search

              return (
                <div key={`${hit.group}-${hit.id}`}>
                  {(!previous || previous.group !== hit.group) && (
                    <p className="flex items-center gap-1.5 px-3 pt-1.5 pb-1 text-[10.5px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
                      <GroupIcon size={12} />
                      {meta?.label}
                    </p>
                  )}

                  <button
                    type="button"
                    role="option"
                    aria-selected={index === active}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => goTo(hit)}
                    className={cn(
                      "flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-[13px] transition-colors",
                      index === active ? "bg-muted" : "hover:bg-muted/60",
                    )}
                  >
                    <span className="min-w-0 truncate font-medium text-foreground">
                      {hit.label}
                    </span>

                    {hit.sublabel && (
                      <span className="min-w-0 truncate text-[11.5px] text-muted-foreground">
                        {hit.sublabel}
                      </span>
                    )}
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

export function TopBar({
  user,
  tenant,
  memberships,
  moduleLabel,
  onOpenNav,
  onSwitchTenant,
  onSignOut,
  offset,
}: TopBarProps) {
  return (
    <header
      className="fixed top-0 right-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-card px-3 transition-[left] duration-200 md:px-4"
      style={{ left: offset }}
    >
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden"
        onClick={onOpenNav}
        aria-label="Open navigation"
      >
        <Menu size={18} />
      </Button>

      <div className="flex min-w-0 items-center gap-2">
        <TenantSwitcher
          tenant={tenant}
          memberships={memberships}
          onSwitch={onSwitchTenant}
        />
        <Separator
          orientation="vertical"
          className="mx-0.5 hidden h-5 sm:block"
        />
        <span className="hidden min-w-0 truncate text-[12.5px] font-medium text-muted-foreground sm:block">
          {moduleLabel}
        </span>
      </div>

      <div className="hidden min-w-0 flex-1 justify-center md:flex">
        <GlobalSearch />
      </div>

      <div className="ml-auto flex items-center gap-0.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Search"
              className="md:hidden"
            >
              <Search size={16} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Search</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Help and documentation"
            >
              <CircleHelp size={16} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Help centre</TooltipContent>
        </Tooltip>

        <NotificationsBell />

        <Separator
          orientation="vertical"
          className="mx-1 hidden h-5 sm:block"
        />
        <UserMenu user={user} onSignOut={onSignOut} />
      </div>
    </header>
  )
}
