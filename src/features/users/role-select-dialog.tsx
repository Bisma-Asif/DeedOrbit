import { useEffect, useState } from "react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field } from "@/components/field"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  ApiError,
  usersApi,
  type RoleSummary,
  type TenantUser,
} from "@/lib/api"

export type RoleSelectDialogProps = {
  user: TenantUser | null
  roles: RoleSummary[]
  onOpenChange: (open: boolean) => void
  onChanged: () => void
}

/**
 * Reassigns a member's role.
 *
 * The confirmation is required because this is the one action that silently
 * changes what someone can reach: no password reset, no notification, and a
 * session token issued under the old role still resolves against the new grants
 * on its next request. The list is limited to roles at or below the caller's own
 * rank, which mirrors the server's own guard.
 */
export function RoleSelectDialog({
  user,
  roles,
  onOpenChange,
  onChanged,
}: RoleSelectDialogProps) {
  const [roleId, setRoleId] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (user) {
      setRoleId(user.roleId)
      setError(null)
    }
  }, [user])

  if (!user) return null

  const currentRole = roles.find((role) => role.id === user.roleId)
  const next = roles.find((role) => role.id === roleId)
  const unchanged = next?.id === user.roleId
  // "Widens" is judged on the effective grant count, which is what actually
  // changes their reach — a same-count swap between sibling roles is not a risk.
  const widens = (next?.allowedCount ?? 0) > (currentRole?.allowedCount ?? 0)

  async function apply() {
    if (!user || !next) return
    setPending(true)
    setError(null)
    try {
      await usersApi.update(user.id, { roleId: next.id })
      onChanged()
      onOpenChange(false)
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "The role could not be changed.",
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Change role for {user.fullName}</DialogTitle>
          <DialogDescription asChild>
            <div className="text-[12.5px] leading-5">
              Takes effect on their next request. They are not asked to sign in
              again.
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-1">
          {error ? (
            <Alert variant="danger">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <div className="flex items-center justify-between gap-3 border-b border-border pb-3">
            <div className="min-w-0">
              <p className="truncate text-[13px] font-medium text-foreground">
                {user.email}
              </p>
              <p className="text-[11.5px] text-muted-foreground">
                Currently {user.roleLabel}
              </p>
            </div>
            <Badge variant="outline">
              {currentRole
                ? `${currentRole.allowedCount} permissions`
                : user.roleLabel}
            </Badge>
          </div>

          <Field
            label="New role"
            htmlFor="reassign-role"
            hint="Only roles at or below your own level are offered."
          >
            <Select value={roleId} onValueChange={setRoleId}>
              <SelectTrigger id="reassign-role" className="w-full">
                <SelectValue placeholder="Choose a role" />
              </SelectTrigger>
              <SelectContent>
                {roles.map((role) => (
                  <SelectItem key={role.id} value={role.id}>
                    {role.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {next ? (
            <div className="rounded-md border border-border bg-muted/40 px-3 py-2.5">
              <p className="text-[12px] leading-5 text-muted-foreground">
                <span className="font-medium text-foreground">
                  {next.label}
                </span>{" "}
                — {next.description}
              </p>
              <p className="mt-1 text-[11.5px] text-muted-foreground tabular-nums">
                {next.allowedCount} of {next.permissions.length} permissions
                granted
                {widens ? " · this widens their access" : ""}
              </p>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button onClick={apply} disabled={pending || unchanged || !next}>
            {pending ? "Updating…" : unchanged ? "No change" : "Change role"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
