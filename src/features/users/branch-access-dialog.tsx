import { useEffect, useMemo, useState } from "react"
import { Building2, Globe } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { EmptyState } from "@/components/empty-state"
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
  type BranchOption,
  type TenantUser,
} from "@/lib/api"

export type BranchAccessDialogProps = {
  user: TenantUser | null
  branches: BranchOption[]
  onOpenChange: (open: boolean) => void
  onChanged: () => void
}

/**
 * Restricts a member to specific offices.
 *
 * The two states are deliberately not "none" and "some" but "all" and "some",
 * because an unselected list must never mean *no access* — that would turn a
 * mis-click into a lockout. "All offices" is the default a workspace
 * administrator should be in, so it is the state an untouched dialog saves.
 *
 * An archived office stays listed but is marked, because removing it from the
 * picker would make an existing grant to it un-representable and therefore
 * impossible to keep.
 */
export function BranchAccessDialog({
  user,
  branches,
  onOpenChange,
  onChanged,
}: BranchAccessDialogProps) {
  const [selected, setSelected] = useState<string[]>([])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (user) {
      setSelected(user.branchIds)
      setError(null)
    }
  }, [user])

  const archived = useMemo(
    () =>
      new Set(branches.filter((b) => b.status !== "active").map((b) => b.id)),
    [branches],
  )

  if (!user) return null

  const isAll = selected.length === 0

  // Compared as sets rather than by length: two different single-office scopes
  // have the same length, and a length-only check would leave "Save" disabled on
  // a real change from one office to another.
  const unchanged =
    isAll === (user.branchIds.length === 0) &&
    selected.length === user.branchIds.length &&
    selected.every((id) => user.branchIds.includes(id))

  function toggle(branchId: string, checked: boolean) {
    setSelected((current) =>
      checked
        ? [...current, branchId]
        : current.filter((id) => id !== branchId),
    )
  }

  async function apply() {
    if (!user) return
    setPending(true)
    setError(null)
    try {
      await usersApi.updateBranches(user.id, selected)
      onChanged()
      onOpenChange(false)
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "The branch restriction could not be saved.",
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Office access for {user.fullName}</DialogTitle>
          <DialogDescription asChild>
            <div className="text-[12.5px] leading-5">
              Limits which offices this member can record work against. It does
              not change their role or the permissions that role carries.
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
                Currently{" "}
                {user.branchAccess === "all"
                  ? "every office"
                  : user.branchNames.join(", ")}
              </p>
            </div>
            <Badge
              variant={user.branchAccess === "all" ? "outline" : "pending"}
            >
              {user.branchAccess === "all" ? "All offices" : "Restricted"}
            </Badge>
          </div>

          {branches.length === 0 ? (
            <EmptyState
              icon={Building2}
              size="sm"
              title="No offices to restrict to"
              description="This workspace has no offices yet. Add one under Settings, then come back."
            />
          ) : (
            <>
              <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-border px-3 py-2.5 transition-colors hover:bg-muted/50 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
                <Checkbox
                  checked={isAll}
                  // "All" and "some" are exclusive, so this row is a radio in
                  // everything but markup: selecting it clears the list.
                  onCheckedChange={() => setSelected([])}
                  className="mt-0.5"
                  aria-label="All offices"
                />
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-[13px] font-medium text-foreground">
                    <Globe size={13} className="text-muted-foreground" />
                    All offices
                  </p>
                  <p className="mt-0.5 text-[11.5px] leading-4 text-muted-foreground">
                    No restriction. This member can record work against every
                    office in the workspace.
                  </p>
                </div>
              </label>

              <div className="flex flex-col gap-1.5">
                {branches.map((branch) => {
                  const checked = selected.includes(branch.id)

                  return (
                    <label
                      key={branch.id}
                      className="flex cursor-pointer items-start gap-2.5 rounded-md border border-border px-3 py-2.5 transition-colors hover:bg-muted/50 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
                    >
                      <Checkbox
                        checked={checked}
                        // Turning on an explicit branch means leaving "all",
                        // so the list is seeded with nothing and grows from here.
                        onCheckedChange={(value) =>
                          toggle(branch.id, value === true)
                        }
                        className="mt-0.5"
                        aria-label={branch.name}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-1.5 text-[13px] font-medium text-foreground">
                          <span className="truncate">{branch.name}</span>
                          {branch.code ? (
                            <span className="font-mono text-[10.5px] text-muted-foreground">
                              {branch.code}
                            </span>
                          ) : null}
                          {archived.has(branch.id) ? (
                            <Badge variant="neutral">Archived</Badge>
                          ) : null}
                        </p>
                        <p className="mt-0.5 text-[11.5px] text-muted-foreground tabular-nums">
                          {branch.memberCount} member
                          {branch.memberCount === 1 ? "" : "s"} restricted here
                        </p>
                      </div>
                    </label>
                  )
                })}
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button onClick={apply} disabled={pending || unchanged}>
            {pending
              ? "Saving…"
              : unchanged
                ? "No change"
                : isAll
                  ? "Remove restriction"
                  : "Save restriction"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
