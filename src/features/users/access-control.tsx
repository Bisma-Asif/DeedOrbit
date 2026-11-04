import { useState } from "react"
import { ShieldCheck, Users } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { EmptyState } from "@/components/empty-state"
import { MembersPanel } from "@/features/users/members-panel"
import { RolesPanel } from "@/features/users/roles-panel"
import { useRoles, useTenantUsers } from "@/features/users/use-admin-resources"
import { useSession } from "@/lib/session-context"

/**
 * Access control for the current workspace: members, then the role grant matrix.
 *
 * The whole tab is gated on `users.view` rather than `settings.view`, because
 * member administration is a separate grant from editing the organisation
 * profile. A tenant admin who has lost `users.view` sees an explanation rather
 * than an empty table that looks like a data problem.
 */
export function AccessControl() {
  const { can } = useSession()
  const [view, setView] = useState("members")

  const canViewUsers = can("users", "view")
  const canEditUsers = can("users", "edit")

  // Both hooks are called unconditionally, as React requires, but they must not
  // fire for a member who cannot read these tables — the server answers 403 and
  // the denial would show up as console noise on every visit.
  const members = useTenantUsers(canViewUsers)
  const roles = useRoles(canViewUsers)

  if (!canViewUsers) {
    return (
      <Alert>
        <ShieldCheck size={15} />
        <AlertDescription asChild>
          <div>
            You do not have the <span className="font-medium">View users</span>{" "}
            permission in this workspace, so members and role grants are hidden.
            Ask a tenant owner or administrator to grant it.
          </div>
        </AlertDescription>
      </Alert>
    )
  }

  if (members.error) {
    return (
      <Alert variant="danger">
        <AlertDescription>{members.error}</AlertDescription>
      </Alert>
    )
  }

  return (
    <Tabs value={view} onValueChange={setView} className="flex flex-col gap-4">
      <TabsList>
        <TabsTrigger value="members">
          <Users size={13} /> Members
          {members.users.length > 0 ? (
            <span className="ml-1 text-[10.5px] tabular-nums text-muted-foreground">
              {members.users.length}
            </span>
          ) : null}
        </TabsTrigger>
        <TabsTrigger value="roles">
          <ShieldCheck size={13} /> Roles &amp; permissions
        </TabsTrigger>
      </TabsList>

      <TabsContent value="members" className="m-0">
        <MembersPanel
          users={members.users}
          roles={roles.roles}
          branches={members.branches}
          loading={members.loading || roles.loading}
          error={roles.error}
          onChanged={() => {
            members.reload()
            roles.reload()
          }}
        />
      </TabsContent>

      <TabsContent value="roles" className="m-0">
        {roles.loading && roles.roles.length === 0 ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 5 }, (_, index) => (
              <Skeleton key={index} className="h-9 w-full" />
            ))}
          </div>
        ) : roles.roles.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title="No roles to show"
            description="Roles are seeded with the workspace. An empty list means the seed did not run."
          />
        ) : (
          <RolesPanel roles={roles.roles} onChanged={roles.reload} />
        )}
      </TabsContent>

      {!canEditUsers ? (
        <p className="text-[11.5px] text-muted-foreground">
          You can review access but not change it. Editing members and roles
          needs the <span className="font-medium">Edit users</span> permission.
        </p>
      ) : null}
    </Tabs>
  )
}
