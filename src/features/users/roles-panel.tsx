import { useEffect, useMemo, useState } from "react"
import { Lock, RotateCcw, Save, ShieldCheck } from "lucide-react"
import { EmptyState } from "@/components/empty-state"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  ApiError,
  rolesApi,
  type EffectivePermission,
  type RoleSummary,
} from "@/lib/api"
import { MODULE_LABELS } from "@shared/access"
import { useSession } from "@/lib/session-context"

export type RolesPanelProps = {
  roles: RoleSummary[]
  onChanged: () => void
}

/**
 * Role picker plus the module x action grant matrix for the selected role.
 *
 * The matrix writes through to `role_permission_overrides` for this tenant, so
 * an edit here never changes another tenant. The server refuses to let a role
 * gain more than the caller's own effective grants, and the client mirrors that
 * by disabling anything it already holds — the server remains the authority.
 */
export function RolesPanel({ roles, onChanged }: RolesPanelProps) {
  const { data: session, can, refresh } = useSession()
  const [roleId, setRoleId] = useState("")
  const [permissions, setPermissions] = useState<EffectivePermission[]>([])
  const [draft, setDraft] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const mayEdit = can("users", "edit")

  useEffect(() => {
    // Land on the caller's own role first: it is the one they can always edit.
    if (!roleId && roles.length > 0) {
      setRoleId(session?.role.id ?? roles[0].id)
    }
  }, [roleId, roles, session?.role.id])

  useEffect(() => {
    if (!roleId) return
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    setSaved(false)

    rolesApi
      .detail(roleId)
      .then((result) => {
        if (controller.signal.aborted) return
        setPermissions(result.permissions)
        setDraft(
          new Set(
            result.permissions
              .filter((entry) => entry.allowed)
              .map((entry) => entry.permissionId),
          ),
        )
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return
        setError(
          caught instanceof ApiError
            ? caught.message
            : "That role could not be loaded.",
        )
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [roleId])

  const role = roles.find((entry) => entry.id === roleId)
  const selected = permissions
    .filter((entry) => entry.allowed)
    .map((entry) => entry.permissionId)
  const dirty = useMemo(() => {
    if (draft.size === selected.length)
      return selected.every((id) => draft.has(id))
    return false
  }, [draft, selected])

  const modules = useMemo(
    () => [...new Set(permissions.map((entry) => entry.module))],
    [permissions],
  )
  const actions = useMemo(
    () => [...new Set(permissions.map((entry) => entry.action))],
    [permissions],
  )

  // A role may never be granted more than the caller already holds, and never
  // edited to exceed their own rank. Both limits are enforced server-side too.
  const ceiling = useMemo(() => {
    if (!session) return new Set<string>()
    return new Set(
      Object.entries(session.permissions)
        .filter(([, allowed]) => allowed)
        .map(([id]) => id),
    )
  }, [session])

  const cannotGrant = (id: string) =>
    mayEdit && ceiling.size > 0 && !ceiling.has(id)
  const isOwnRole = roleId === session?.role.id

  function toggle(permissionId: string) {
    if (!mayEdit) return
    setSaved(false)
    setDraft((current) => {
      const next = new Set(current)
      if (next.has(permissionId)) next.delete(permissionId)
      else next.add(permissionId)
      return next
    })
  }

  function toggleModule(module: string, on: boolean) {
    if (!mayEdit) return
    setSaved(false)
    setDraft((current) => {
      const next = new Set(current)
      for (const entry of permissions) {
        if (entry.module !== module) continue
        const id = entry.permissionId
        if (on) {
          if (!cannotGrant(id)) next.add(id)
        } else {
          next.delete(id)
        }
      }
      return next
    })
  }

  async function save() {
    if (!roleId) return
    setSaving(true)
    setError(null)
    try {
      const result = await rolesApi.setPermissions(roleId, [...draft])
      setPermissions(result.permissions)
      setDraft(
        new Set(
          result.permissions
            .filter((entry) => entry.allowed)
            .map((entry) => entry.permissionId),
        ),
      )
      setSaved(true)
      // The caller's own grants may have narrowed, so the shell must re-read them.
      await refresh()
      onChanged()
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Those changes were refused.",
      )
    } finally {
      setSaving(false)
    }
  }

  if (roles.length === 0) {
    return (
      <EmptyState
        icon={ShieldCheck}
        title="No roles available"
        description="Roles are seeded with the workspace. If this list is empty, the seed did not run."
      />
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full sm:w-72">
          <Label
            htmlFor="role-picker"
            className="text-[12px] font-medium text-foreground"
          >
            Role
          </Label>
          <Select value={roleId} onValueChange={setRoleId}>
            <SelectTrigger id="role-picker" className="mt-1 w-full">
              <SelectValue placeholder="Choose a role" />
            </SelectTrigger>
            <SelectContent>
              {roles.map((entry) => (
                <SelectItem key={entry.id} value={entry.id}>
                  {entry.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2 pb-0.5">
          {role?.scope === "platform" ? (
            <Badge variant="nav">Platform scope</Badge>
          ) : null}
          {isOwnRole ? <Badge variant="info">Your role</Badge> : null}
          <span className="text-[12px] text-muted-foreground tabular-nums">
            {draft.size} of {permissions.length} granted
          </span>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!mayEdit || saving}
            onClick={() => {
              setSaved(false)
              setDraft(
                new Set(
                  permissions
                    .filter((entry) => entry.allowed)
                    .map((entry) => entry.permissionId),
                ),
              )
            }}
          >
            <RotateCcw size={13} /> Discard
          </Button>
          <Button
            size="sm"
            disabled={!mayEdit || saving || dirty}
            onClick={save}
          >
            <Save size={13} /> {saving ? "Saving…" : "Save permissions"}
          </Button>
        </div>
      </div>

      {error ? (
        <Alert variant="danger">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {saved && !error ? (
        <Alert variant="success">
          <AlertTitle>Permissions updated</AlertTitle>
          <AlertDescription>
            The change applies to this workspace only. Other tenants keep their
            own grants for {role?.label ?? "this role"}.
          </AlertDescription>
        </Alert>
      ) : null}

      {!mayEdit ? (
        <Alert>
          <Lock size={15} />
          <AlertDescription>
            You can review these grants but not change them. Editing roles needs
            the <span className="font-medium">Edit users</span> permission.
          </AlertDescription>
        </Alert>
      ) : null}

      {isOwnRole && mayEdit ? (
        <Alert variant="pending">
          <AlertTitle>This is your own role</AlertTitle>
          <AlertDescription>
            You can remove your own access, but the server refuses any change
            that would grant more than you hold today — you cannot promote
            yourself.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[42rem] border-collapse text-[13px]">
          <caption className="sr-only">
            Permissions granted to {role?.label ?? "the selected role"}
          </caption>
          <thead>
            <tr>
              <th
                scope="col"
                className="h-8 w-56 border-b border-border bg-muted/70 px-3 text-left text-[10.5px] font-semibold tracking-[0.06em] whitespace-nowrap text-muted-foreground uppercase"
              >
                Module
              </th>
              {actions.map((action) => (
                <th
                  key={action}
                  scope="col"
                  className="h-8 border-b border-border bg-muted/70 px-3 text-center text-[10.5px] font-semibold tracking-[0.06em] text-muted-foreground uppercase"
                >
                  {action}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: 6 }, (_, index) => (
                  <tr key={index} className="border-b border-border">
                    <td className="h-9 px-3">
                      <span
                        aria-hidden="true"
                        className="block h-3 w-32 animate-pulse rounded bg-muted"
                      />
                    </td>
                    {actions.map((action) => (
                      <td key={action} className="px-3 text-center">
                        <span
                          aria-hidden="true"
                          className="mx-auto block size-3.5 animate-pulse rounded bg-muted"
                        />
                      </td>
                    ))}
                  </tr>
                ))
              : modules.map((module) => {
                  const entries = permissions.filter(
                    (entry) => entry.module === module,
                  )
                  const allOn = entries.every((entry) =>
                    draft.has(entry.permissionId),
                  )
                  return (
                    <tr
                      key={module}
                      className="border-b border-border last:border-b-0"
                    >
                      <th
                        scope="row"
                        className="h-9 px-3 text-left text-[12.5px] font-medium text-foreground"
                      >
                        <div className="flex items-center gap-2">
                          {MODULE_LABELS[module] ?? module}
                          <Checkbox
                            aria-label={`Toggle every ${module} permission`}
                            checked={allOn}
                            disabled={!mayEdit}
                            onCheckedChange={(checked) =>
                              toggleModule(module, checked === true)
                            }
                            className="ml-auto"
                          />
                        </div>
                      </th>
                      {actions.map((action) => {
                        const entry = entries.find(
                          (item) => item.action === action,
                        )
                        if (!entry) {
                          return (
                            <td
                              key={action}
                              className="px-3 text-center text-muted-foreground"
                            >
                              —
                            </td>
                          )
                        }
                        const blocked = cannotGrant(entry.permissionId)
                        return (
                          <td key={action} className="px-3 text-center">
                            <Checkbox
                              aria-label={`${MODULE_LABELS[module] ?? module} ${action}`}
                              checked={draft.has(entry.permissionId)}
                              disabled={
                                !mayEdit ||
                                (blocked && !draft.has(entry.permissionId))
                              }
                              onCheckedChange={() => toggle(entry.permissionId)}
                            />
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
          </tbody>
        </table>
      </div>

      <p className="text-[11.5px] leading-4 text-muted-foreground">
        Grants are stored per workspace in the database, layered over the
        platform defaults. A box that cannot be ticked is a permission you do
        not hold yourself.
      </p>
    </div>
  )
}
