/**
 * Collection targets — a monthly goal per recovery officer.
 *
 * The dashboard measures each officer's collected-so-far against the target set here
 * for the current period, so this panel is where those goals are chosen. Pick a month,
 * give each recovery officer a whole-figure target, and save. A blank amount sets no
 * goal for that officer; saving writes exactly the targets that are filled in.
 *
 * The officer list is the workspace's active recovery officers, so this needs the
 * member-read grant as well as `settings.edit` to change anything. The save is scoped
 * to the chosen month only.
 */

import { useEffect, useMemo, useState } from "react"

import { Target } from "lucide-react"

import { Alert, AlertDescription } from "@/components/ui/alert"

import { Button } from "@/components/ui/button"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

import { EmptyState } from "@/components/empty-state"

import { Field } from "@/components/field"

import { Input } from "@/components/ui/input"

import { Skeleton } from "@/components/ui/skeleton"

import { useSave } from "@/features/organization/use-save"

import { useSession } from "@/lib/session-context"

import { useAsyncResource } from "@/lib/use-async-resource"

import { usersApi } from "@/lib/api"

import { collectionsApi } from "@/lib/collections-api"

import { CANCELLATION_AMOUNT_MAX } from "@shared/cancellation"

function currentPeriod(): string {
  return new Date().toISOString().slice(0, 7)
}

function whole(value: string): number | null {
  const trimmed = value.trim()

  if (trimmed === "") return null

  const parsed = Math.trunc(Number(trimmed))

  if (!Number.isFinite(parsed) || parsed < 0) return null

  return parsed
}

export function CollectionTargetsPanel() {
  const session = useSession()

  const canView = session.can("settings", "view")

  const canReadUsers = session.can("users", "view")

  const resource = useAsyncResource(
    (signal) => collectionsApi.getTargets(signal),

    canView,
  )

  const roster = useAsyncResource(
    (signal) => usersApi.list(signal),

    canView && canReadUsers,
  )

  const [period, setPeriod] = useState(currentPeriod)

  const [amounts, setAmounts] = useState<Record<string, string>>({})

  const [invalid, setInvalid] = useState<Record<string, string>>({})

  const save = useSave()

  const officers = useMemo(
    () =>
      (roster.data?.users ?? [])

        .filter(
          (user) =>
            user.roleId === "recovery_officer" && user.status === "active",
        )

        .map((user) => ({ id: user.id, name: user.fullName })),

    [roster.data],
  )

  // Re-seed the editable amounts whenever the loaded targets or the chosen month change,

  // so switching months reads back that month's saved goals.

  useEffect(() => {
    const next: Record<string, string> = {}

    for (const target of resource.data?.targets ?? []) {
      if (target.period === period)
        next[target.officerUserId] = String(target.targetAmount)
    }

    setAmounts(next)
  }, [resource.data, period])

  if (!canView) {
    return (
      <EmptyState
        icon={Target}
        title="Collection targets are not available to your role"
        description="Ask a workspace administrator for the settings grant to view this section."
        tone="pending"
      />
    )
  }

  const canEdit = session.can("settings", "edit") && canReadUsers

  const errorFor = (key: string) => save.fields[key]

  async function submit() {
    const errors: Record<string, string> = {}

    const built: {
      officerUserId: string
      period: string
      targetAmount: number
    }[] = []

    for (const officer of officers) {
      const raw = amounts[officer.id] ?? ""

      if (raw.trim() === "") continue

      const value = whole(raw)

      if (value === null || value > CANCELLATION_AMOUNT_MAX) {
        errors[officer.id] =
          `Enter a whole number from 0 to ${CANCELLATION_AMOUNT_MAX}.`

        continue
      }

      built.push({ officerUserId: officer.id, period, targetAmount: value })
    }

    if (Object.keys(errors).length > 0) {
      save.clear()

      // Surface client-side field messages through a local error via save.fields is not

      // writable, so fall back to an inline map below.

      setInvalid(errors)

      return
    }

    setInvalid({})

    const done = await save.run(async () => {
      await collectionsApi.saveTargets(built)
    })

    if (done) {
      save.clear()

      await resource.reload()
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Collection targets</CardTitle>
        <CardDescription>
          Set each recovery officer's monthly goal. The collections dashboard
          measures what they collect against it.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 py-2">
        {save.error ? (
          <Alert variant="danger">
            <AlertDescription>{save.error}</AlertDescription>
          </Alert>
        ) : null}

        <Field label="Period" htmlFor="targets-period">
          <Input
            id="targets-period"
            type="month"
            value={period}
            onChange={(event) => setPeriod(event.target.value)}
          />
        </Field>

        {!canReadUsers ? (
          <Alert variant="danger">
            <AlertDescription>
              Reading members is required to list recovery officers, so targets
              cannot be edited by your role.
            </AlertDescription>
          </Alert>
        ) : roster.loading && !roster.data ? (
          <Skeleton className="h-32 w-full" />
        ) : officers.length === 0 ? (
          <EmptyState
            icon={Target}
            size="sm"
            title="No recovery officers"
            description="Invite an active member with the recovery officer role to set targets."
          />
        ) : (
          <div className="flex flex-col divide-y divide-border rounded-md border border-border">
            {officers.map((officer) => (
              <div
                key={officer.id}
                className="flex items-center justify-between gap-4 px-3 py-2.5"
              >
                <span className="min-w-0 truncate font-medium text-foreground">
                  {officer.name}
                </span>
                <div className="w-40">
                  <Field
                    label="Target"
                    htmlFor={`target-${officer.id}`}
                    className="[&_label]:sr-only"
                    error={invalid[officer.id] ?? errorFor(officer.id)}
                  >
                    <Input
                      id={`target-${officer.id}`}
                      type="number"
                      min={0}
                      max={CANCELLATION_AMOUNT_MAX}
                      step={1}
                      inputMode="numeric"
                      disabled={!canEdit}
                      value={amounts[officer.id] ?? ""}
                      onChange={(event) => {
                        setAmounts((current) => ({
                          ...current,

                          [officer.id]: event.target.value,
                        }))

                        setInvalid((current) => {
                          if (!(officer.id in current)) return current

                          const next = { ...current }

                          delete next[officer.id]

                          return next
                        })

                        save.clear()
                      }}
                    />
                  </Field>
                </div>
              </div>
            ))}
          </div>
        )}

        {canEdit ? (
          <div className="flex items-center gap-2 pt-1">
            <Button onClick={() => void submit()} disabled={save.saving}>
              {save.saving ? "Saving…" : "Save targets"}
            </Button>
            {save.saved ? (
              <span className="text-[12px] text-success">Saved</span>
            ) : null}
          </div>
        ) : (
          <p className="text-[11.5px] text-muted-foreground">
            Your role can view these targets but not change them.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
