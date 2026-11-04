/**
 * Staff control: who may read this customer's account through the portal.
 *
 * A portal login is a `customer`-role user, and the link between that login and
 * a `customers` profile is the whole of the portal's authorisation — so this is
 * where the office decides who sees whose purchase. The list shows every active
 * buyer login in the workspace; ticking one links it to this profile, and the
 * whole set is written back at once, so a half-applied edit is impossible. Gated
 * on `customers.edit`, because deciding who reads a buyer's records is a
 * customer-administration act, not a portal one.
 */

import { useEffect, useState } from "react"

import { KeyRound, Users } from "lucide-react"

import { Alert, AlertDescription } from "@/components/ui/alert"

import { Badge } from "@/components/ui/badge"

import { Button } from "@/components/ui/button"

import { EmptyState } from "@/components/empty-state"

import { Switch } from "@/components/ui/switch"

import { Skeleton } from "@/components/ui/skeleton"

import { useSave } from "@/features/organization/use-save"

import { useSession } from "@/lib/session-context"

import { portalApi } from "@/lib/portal-api"

import { useAsyncResource } from "@/lib/use-async-resource"

interface PortalAccessCardProps {
  customerId: string
}

export function PortalAccessCard({ customerId }: PortalAccessCardProps) {
  const { can } = useSession()

  const canManage = can("customers", "edit")

  const resource = useAsyncResource(
    (signal) => portalApi.access(customerId, signal),

    canManage,
  )

  const save = useSave()

  const [linked, setLinked] = useState<string[]>([])

  const state = resource.data

  useEffect(() => {
    if (state) setLinked(state.linkedUserIds)
  }, [state])

  if (!canManage) {
    return (
      <EmptyState
        icon={KeyRound}
        size="sm"
        title="Portal access not available"
        description="Only a role that can edit customers can manage who reads this account in the portal."
      />
    )
  }

  if (resource.loading && !state) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
    )
  }

  if (resource.error) {
    return (
      <Alert variant="danger">
        <AlertDescription>{resource.error}</AlertDescription>
      </Alert>
    )
  }

  if (!state) return null

  const dirty =
    linked.length !== state.linkedUserIds.length ||
    linked.some((id) => !state.linkedUserIds.includes(id))

  function toggle(userId: string, on: boolean) {
    setLinked((current) =>
      on
        ? [...new Set([...current, userId])]
        : current.filter((id) => id !== userId),
    )

    save.clear()
  }

  async function submit() {
    const done = await save.run(async () => {
      await portalApi.setAccess(customerId, linked)
    })

    if (done) await resource.reload()
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12.5px] text-muted-foreground">
        Link the buyer logins that should be able to read this account in the
        customer portal. A buyer with no linked profile sees nothing.
      </p>

      {save.error ? (
        <Alert variant="danger">
          <AlertDescription>{save.error}</AlertDescription>
        </Alert>
      ) : null}

      {state.candidates.length === 0 ? (
        <EmptyState
          icon={Users}
          size="sm"
          title="No buyer accounts in this workspace"
          description="Portal access can be granted once a user holds the customer role."
        />
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
          {state.candidates.map((candidate) => {
            const isLinked = linked.includes(candidate.userId)

            return (
              <li
                key={candidate.userId}
                className="flex items-center justify-between gap-3 px-3 py-2.5"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-[13px] font-medium text-foreground">
                      {candidate.fullName}
                    </p>
                    {candidate.status !== "active" ? (
                      <Badge variant="outline">{candidate.status}</Badge>
                    ) : isLinked ? (
                      <Badge variant="success">Linked</Badge>
                    ) : null}
                  </div>
                  <p className="truncate text-[11.5px] text-muted-foreground">
                    {candidate.email}
                  </p>
                </div>

                <Switch
                  checked={isLinked}
                  disabled={candidate.status !== "active" || save.saving}
                  onCheckedChange={(checked) =>
                    toggle(candidate.userId, checked)
                  }
                  aria-label={`Link ${candidate.fullName} to this account`}
                />
              </li>
            )
          })}
        </ul>
      )}

      <div className="flex justify-end">
        <Button onClick={() => void submit()} disabled={!dirty || save.saving}>
          {save.saving ? "Saving…" : "Save access"}
        </Button>
      </div>
    </div>
  )
}
