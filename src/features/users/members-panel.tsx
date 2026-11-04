import { useMemo, useState } from "react"
import {
  Building2,
  Globe,
  History,
  KeyRound,
  MoreHorizontal,
  ShieldCheck,
  UserPlus,
} from "lucide-react"
import {
  DataTable,
  TableFilter,
  type DataTableColumn,
} from "@/components/data-table"
import { EmptyState } from "@/components/empty-state"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { formatDateTime, formatRelative } from "@/lib/format"
import { initialsOf } from "@/lib/workspace"
import { useSession } from "@/lib/session-context"
import {
  usersApi,
  type BranchOption,
  type RoleSummary,
  type TenantUser,
} from "@/lib/api"
import { InviteDialog } from "@/features/users/invite-dialog"
import { RoleSelectDialog } from "@/features/users/role-select-dialog"
import { SessionsDialog } from "@/features/users/sessions-dialog"
import { BranchAccessDialog } from "@/features/users/branch-access-dialog"
import { ForceResetDialog } from "@/features/users/force-reset-dialog"
import { ActivityDialog } from "@/features/users/activity-dialog"
import { ConfirmDialog } from "@/features/users/confirm-dialog"

/**
 * Amber marks work still awaiting the member, emerald a healthy account, and
 * muted red an account that is deliberately restricted.
 */
const STATUS_VARIANT: Record<TenantUser["status"], "pending" | "success" | "danger" | "neutral"> =
  {
    invited: "pending",
    active: "success",
    suspended: "danger",
    deactivated: "neutral",
  }

const STATUS_LABEL: Record<TenantUser["status"], string> = {
  invited: "Invited",
  active: "Active",
  suspended: "Suspended",
  deactivated: "Deactivated",
}

export type MembersPanelProps = {
  users: TenantUser[]
  roles: RoleSummary[]
  branches: BranchOption[]
  loading: boolean
  error: string | null
  onChanged: () => void
}

/**
 * Tenant member administration.
 *
 * Every mutation here is permission-gated twice: the action is only offered if
 * the signed-in role holds the grant, and the server re-checks it on write. A
 * role change is a deliberate two-step confirm because it alters someone's
 * access to finance and customer data without their involvement.
 */
export function MembersPanel({
  users,
  roles,
  branches,
  loading,
  error,
  onChanged,
}: MembersPanelProps) {
  const { data: session, can, refresh } = useSession()
  const [inviteOpen, setInviteOpen] = useState(false)
  const [roleTarget, setRoleTarget] = useState<TenantUser | null>(null)
  const [sessionTarget, setSessionTarget] = useState<TenantUser | null>(null)
  const [branchTarget, setBranchTarget] = useState<TenantUser | null>(null)
  const [resetTarget, setResetTarget] = useState<TenantUser | null>(null)
  const [activityTarget, setActivityTarget] = useState<TenantUser | null>(null)
  const [statusTarget, setStatusTarget] = useState<{
    user: TenantUser
    next: "active" | "suspended" | "deactivated"
  } | null>(null)
  const [filters, setFilters] = useState<Record<string, string>>({
    status: "all",
    role: "all",
    branch: "all",
  })
  const [busyId, setBusyId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const selfId = session?.user.id

  // A tenant admin may only hand out roles at or below their own rank, which is
  // what stops privilege escalation through the invite or reassign dialog.
  const ownRank = useMemo(
    () => roles.find((role) => role.id === session?.role.id)?.rank ?? 0,
    [roles, session?.role.id],
  )
  const assignableRoles = useMemo(
    () => roles.filter((role) => role.assignable && role.rank <= ownRank),
    [roles, ownRank],
  )

  // Only roles actually held by someone are offered as a filter — a filter that
  // can return nothing is just a second way to see an empty table.
  const heldRoles = useMemo(() => {
    const held = new Map<string, string>()
    for (const user of users) held.set(user.roleId, user.roleLabel)
    return [...held.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [users])

  /**
   * "Unrestricted" is a real state on the server, so it gets a filter option of
   * its own rather than being indistinguishable from "no branch matches".
   */
  const rows = useMemo(
    () =>
      users.filter((user) => {
        if (filters.status !== "all" && user.status !== filters.status)
          return false
        if (filters.role !== "all" && user.roleId !== filters.role) return false
        if (filters.branch === "unrestricted")
          return user.branchAccess === "all"
        if (
          filters.branch !== "all" &&
          !user.branchIds.includes(filters.branch)
        )
          return false
        return true
      }),
    [users, filters],
  )

  function setFilter(key: string, value: string) {
    setFilters((current) => ({ ...current, [key]: value }))
  }

  async function changeStatus(
    target: TenantUser,
    next: "active" | "suspended" | "deactivated",
  ) {
    setBusyId(target.id)
    setActionError(null)
    try {
      await usersApi.setStatus(target.id, next)
      // A status change can invalidate the caller's own session if an admin
      // suspends themselves, so revalidate rather than assume.
      await refresh()
      onChanged()
    } catch (caught) {
      setActionError(
        caught instanceof Error ? caught.message : "That change was refused.",
      )
    } finally {
      setBusyId(null)
      setStatusTarget(null)
    }
  }

  const columns: DataTableColumn<TenantUser>[] = useMemo(
    () => [
      {
        key: "member",
        header: "Member",
        sortValue: (row) => row.fullName,
        cell: (row) => (
          <div className="flex items-center gap-2.5">
            <Avatar className="size-7">
              <AvatarFallback className="text-[10.5px]">
                {initialsOf(row.fullName)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="truncate text-[13px] font-medium text-foreground">
                {row.fullName}
                {row.id === selfId ? (
                  <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">
                    (you)
                  </span>
                ) : null}
              </p>
              <p className="truncate text-[11.5px] text-muted-foreground">
                {row.email}
              </p>
            </div>
          </div>
        ),
      },
      {
        key: "role",
        header: "Role",
        sortValue: (row) => row.roleLabel,
        cell: (row) => (
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[12.5px] text-foreground">
              {row.roleLabel}
            </span>
            {row.isDefault ? (
              <Badge variant="outline" className="shrink-0">
                Owner
              </Badge>
            ) : null}
          </div>
        ),
      },
      {
        key: "status",
        header: "Status",
        sortValue: (row) => row.status,
        cell: (row) => (
          <div className="flex flex-col items-start gap-1">
            <Badge variant={STATUS_VARIANT[row.status]}>
              {STATUS_LABEL[row.status]}
            </Badge>
            {row.pendingInvite ? (
              <span className="text-[10.5px] text-muted-foreground">
                Expires {formatRelative(row.pendingInvite.expiresAt)}
              </span>
            ) : null}
            {row.mustResetPassword ? (
              <span className="text-[10.5px] text-warning">
                Password reset pending
              </span>
            ) : null}
          </div>
        ),
      },
      {
        key: "offices",
        header: "Offices",
        sortValue: (row) =>
          row.branchAccess === "all" ? "zzz" : row.branchNames.join(", "),
        cell: (row) =>
          row.branchAccess === "all" ? (
            <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
              <Globe size={13} />
              All
            </span>
          ) : (
            <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-foreground">
              <Building2 size={13} className="shrink-0 text-muted-foreground" />
              <span className="truncate">{row.branchNames.join(", ")}</span>
              <span className="shrink-0 text-[10.5px] text-muted-foreground tabular-nums">
                {row.branchNames.length}
              </span>
            </span>
          ),
      },
      {
        key: "security",
        header: "Security",
        sortValue: (row) =>
          (row.twofaEnabled ? 1 : 0) + (row.recentFailedLogins > 0 ? 0.5 : 0),
        cell: (row) => (
          <div className="flex flex-col items-start gap-1 text-[12px] text-muted-foreground">
            <div className="flex items-center gap-1.5">
              {row.twofaEnabled ? (
                <>
                  <ShieldCheck size={13} className="text-success" />
                  2FA on
                </>
              ) : (
                <>
                  <KeyRound size={13} />
                  Password only
                </>
              )}
              {row.activeSessions > 0 ? (
                <span className="tabular-nums">
                  · {row.activeSessions} live
                </span>
              ) : null}
            </div>
            {/* A burst of wrong passwords is the one thing in this column that
                is never good news, so it is stated rather than left in the
                activity log to be discovered. */}
            {row.recentFailedLogins > 0 ? (
              <span className="text-[10.5px] text-danger tabular-nums">
                {row.recentFailedLogins} failed attempt
                {row.recentFailedLogins === 1 ? "" : "s"}
              </span>
            ) : null}
          </div>
        ),
      },
      {
        key: "lastLogin",
        header: "Last sign-in",
        align: "right",
        sortValue: (row) => row.lastLoginAt ?? "",
        cell: (row) => (
          <span className="text-[12px] whitespace-nowrap text-muted-foreground">
            {row.lastLoginAt ? formatDateTime(row.lastLoginAt) : "Never"}
          </span>
        ),
      },
      {
        key: "actions",
        header: <span className="sr-only">Actions</span>,
        align: "right",
        width: "3.5rem",
        cell: (row) => (
          <MemberActions
            user={row}
            isSelf={row.id === selfId}
            busy={busyId === row.id}
            canEdit={can("users", "edit")}
            canSeeSessions={can("users", "view")}
            onChangeRole={() => setRoleTarget(row)}
            onSessions={() => setSessionTarget(row)}
            onBranches={() => setBranchTarget(row)}
            onForceReset={() => setResetTarget(row)}
            onActivity={() => setActivityTarget(row)}
            onStatus={(next) => setStatusTarget({ user: row, next })}
          />
        ),
      },
    ],
    [selfId, busyId, can, assignableRoles.length],
  )

  if (error) {
    return (
      <Alert variant="danger">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {actionError ? (
        <Alert variant="danger">
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      ) : null}

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        getRowSearchText={(row) =>
          `${row.fullName} ${row.email} ${row.roleLabel} ${row.branchNames.join(" ")}`
        }
        initialSort={{ key: "member", direction: "asc" }}
        loading={loading}
        maxHeight="max(22rem, calc(100dvh - 26rem))"
        toolbar={
          can("users", "create") ? (
            <Button size="sm" onClick={() => setInviteOpen(true)}>
              <UserPlus size={13} /> Invite member
            </Button>
          ) : null
        }
        filterBar={
          <div className="flex flex-wrap items-center gap-2">
            <TableFilter
              label="Status"
              value={filters.status}
              placeholder="All statuses"
              options={[
                { value: "all", label: "All statuses" },
                { value: "active", label: "Active" },
                { value: "invited", label: "Invited" },
                { value: "suspended", label: "Suspended" },
                { value: "deactivated", label: "Deactivated" },
              ]}
              onValueChange={(value) => setFilter("status", value)}
            />
            <TableFilter
              label="Role"
              value={filters.role}
              placeholder="All roles"
              options={[
                { value: "all", label: "All roles" },
                ...heldRoles.map(([id, label]) => ({ value: id, label })),
              ]}
              onValueChange={(value) => setFilter("role", value)}
            />
            <TableFilter
              label="Office"
              value={filters.branch}
              placeholder="All offices"
              options={[
                { value: "all", label: "Any office" },
                { value: "unrestricted", label: "Unrestricted" },
                ...branches.map((branch) => ({
                  value: branch.id,
                  label: branch.name,
                })),
              ]}
              onValueChange={(value) => setFilter("branch", value)}
            />
          </div>
        }
        emptyState={
          <EmptyState
            icon={UserPlus}
            title={
              users.length === 0
                ? "No members yet"
                : "No members match these filters"
            }
            description={
              users.length === 0
                ? "Invite your first team member to give them access to this workspace."
                : "Clear a filter or search to see the rest of the team."
            }
          />
        }
      />

      <InviteDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        roles={assignableRoles}
        onInvited={onChanged}
      />

      <RoleSelectDialog
        user={roleTarget}
        roles={assignableRoles}
        onOpenChange={(open) => !open && setRoleTarget(null)}
        onChanged={onChanged}
      />

      <SessionsDialog
        user={sessionTarget}
        onOpenChange={(open) => !open && setSessionTarget(null)}
        onChanged={onChanged}
      />

      <BranchAccessDialog
        user={branchTarget}
        branches={branches}
        onOpenChange={(open) => !open && setBranchTarget(null)}
        onChanged={onChanged}
      />

      <ForceResetDialog
        user={resetTarget}
        onOpenChange={(open) => !open && setResetTarget(null)}
        onChanged={onChanged}
      />

      <ActivityDialog
        user={activityTarget}
        onOpenChange={(open) => !open && setActivityTarget(null)}
      />

      <StatusConfirmDialog
        target={statusTarget}
        busy={busyId === statusTarget?.user.id}
        onOpenChange={(open) => !open && setStatusTarget(null)}
        onConfirm={() => {
          if (statusTarget)
            void changeStatus(statusTarget.user, statusTarget.next)
        }}
      />
    </div>
  )
}

const STATUS_VERB: Record<"active" | "suspended" | "deactivated", string> = {
  active: "Reactivate",
  suspended: "Suspend",
  deactivated: "Deactivate",
}

/**
 * Separate component so the copy is derived from a non-null target. Doing this
 * inline in the parent needs `?.` on every branch, which does not narrow and
 * leaves a hole where the name is interpolated as undefined.
 */
function StatusConfirmDialog({
  target,
  busy,
  onOpenChange,
  onConfirm,
}: {
  target: {
    user: TenantUser
    next: "active" | "suspended" | "deactivated"
  } | null
  busy: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}) {
  if (!target) return null
  const verb = STATUS_VERB[target.next]

  return (
    <ConfirmDialog
      open
      onOpenChange={onOpenChange}
      title={`${verb} ${target.user.fullName}?`}
      description={describeStatusChange(target.user, target.next)}
      confirmLabel={verb}
      destructive={target.next !== "active"}
      pending={busy}
      onConfirm={onConfirm}
    />
  )
}

function describeStatusChange(
  user: TenantUser | undefined,
  next: "active" | "suspended" | "deactivated" | undefined,
) {
  if (!user || !next) return ""
  if (next === "active") {
    return `${user.fullName} will be able to sign in again immediately with their existing role.`
  }
  if (next === "suspended") {
    return `${user.fullName} will be signed out of every device straight away and blocked from signing in until reactivated. Their role and history are kept.`
  }
  return `${user.fullName} will lose access to this workspace. Their records stay for audit, but they are no longer a member and will not appear in the team list.`
}

function MemberActions({
  user,
  isSelf,
  busy,
  canEdit,
  canSeeSessions,
  onChangeRole,
  onSessions,
  onBranches,
  onForceReset,
  onActivity,
  onStatus,
}: {
  user: TenantUser
  isSelf: boolean
  busy: boolean
  canEdit: boolean
  canSeeSessions: boolean
  onChangeRole: () => void
  onSessions: () => void
  onBranches: () => void
  onForceReset: () => void
  onActivity: () => void
  onStatus: (next: "active" | "suspended" | "deactivated") => void
}) {
  const items: React.ReactNode[] = []

  // A pending forced reset already carries the outcome, so re-issuing one
  // would only invalidate the token the member has not redeemed yet.
  if (canEdit && user.status !== "deactivated") {
    items.push(
      <DropdownMenuItem key="role" onSelect={onChangeRole}>
        <ShieldCheck size={14} /> Change role
      </DropdownMenuItem>,
      <DropdownMenuItem key="branches" onSelect={onBranches}>
        <Building2 size={14} /> Office access
        {user.branchAccess === "all" ? (
          <span className="ml-auto text-[10.5px] text-muted-foreground">
            All
          </span>
        ) : (
          <span className="ml-auto text-[10.5px] tabular-nums text-muted-foreground">
            {user.branchNames.length}
          </span>
        )}
      </DropdownMenuItem>,
    )
  }

  if (canSeeSessions) {
    items.push(
      <DropdownMenuItem key="sessions" onSelect={onSessions}>
        <KeyRound size={14} /> Active sessions
        {user.activeSessions > 0 ? (
          <span className="ml-auto text-[10.5px] tabular-nums text-muted-foreground">
            {user.activeSessions}
          </span>
        ) : null}
      </DropdownMenuItem>,
    )
  }

  if (canEdit && user.status === "active" && !user.mustResetPassword) {
    items.push(
      <DropdownMenuItem key="reset" onSelect={onForceReset}>
        <KeyRound size={14} /> Force password reset
      </DropdownMenuItem>,
    )
  }

  if (canSeeSessions && user.status !== "deactivated") {
    items.push(
      <DropdownMenuItem key="activity" onSelect={onActivity}>
        <History size={14} /> Activity log
        {user.recentFailedLogins > 0 ? (
          <span className="ml-auto text-[10.5px] tabular-nums text-danger">
            {user.recentFailedLogins}
          </span>
        ) : null}
      </DropdownMenuItem>,
    )
  }

  if (canEdit && !isSelf && user.status !== "deactivated") {
    if (items.length > 0) items.push(<DropdownMenuSeparator key="sep-status" />)
    items.push(
      <DropdownMenuItem key="status" onSelect={() => onStatus("suspended")}>
        Suspend access
      </DropdownMenuItem>,
    )
  }
  if (canEdit && isSelf && user.status === "suspended") {
    items.push(
      <DropdownMenuItem key="reactivate" onSelect={() => onStatus("active")}>
        Reactivate my access
      </DropdownMenuItem>,
    )
  }

  if (items.length === 0) {
    return <span className="text-[12px] text-muted-foreground">—</span>
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={busy}
          aria-label={`Actions for ${user.fullName}`}
        >
          <MoreHorizontal size={15} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="truncate normal-case">
          <span className="text-[12px] text-muted-foreground">
            {user.email}
          </span>
        </DropdownMenuLabel>
        {items}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
