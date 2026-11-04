/**
 * Approval policies — the settings half of the maker-checker queue.
 *
 * One row per action that can be held for sign-off. Enabling a row sends matching
 * requests to the approvals queue instead of applying them immediately; a threshold
 * amount narrows that to actions at or above the figure (meaningful only for booking
 * and discount, the actions that carry one). Every policy starts disabled, so an
 * untouched workspace keeps its immediate booking and cancellation behaviour.
 *
 * Editing is gated on `settings.edit`, and the server re-checks the grant anyway. The
 * save is PATCH-by-section: the whole set is written at once and the response reseeds
 * the form, so a saved row reads back exactly as the server stored it.
 */

import { useEffect, useState } from "react"

import { ShieldCheck } from "lucide-react"

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

import { Switch } from "@/components/ui/switch"

import { useSave } from "@/features/organization/use-save"

import { useSession } from "@/lib/session-context"

import { useAsyncResource } from "@/lib/use-async-resource"

import { UNIT_PRICE_MAX } from "@shared/inventory"

import type { ApprovalAction } from "@shared/approvals"

import {
  approvalsPoliciesApi,
  type ApprovalPolicy,
  type ApprovalPolicyInput,
} from "@/lib/approvals-api"

/** One row's editable state. The threshold stays a string until it is saved. */

interface PolicyDraft {
  enabled: boolean

  thresholdAmount: string
}

function seedDrafts(policies: ApprovalPolicy[]): Record<string, PolicyDraft> {
  const drafts: Record<string, PolicyDraft> = {}

  for (const policy of policies) {
    drafts[policy.actionKey] = {
      enabled: policy.enabled,

      thresholdAmount: policy.hasThreshold
        ? String(policy.thresholdAmount)
        : "0",
    }
  }

  return drafts
}

export function ApprovalPoliciesPanel() {
  const session = useSession()

  const canView = session.can("settings", "view")

  const resource = useAsyncResource(
    (signal) => approvalsPoliciesApi.read(signal),

    canView,
  )

  const [drafts, setDrafts] = useState<Record<string, PolicyDraft>>({})

  // Client-side validation messages, kept beside the server's own field map. The

  // threshold range is checked here so a bad figure is flagged before a round-trip.

  const [formErrors, setFormErrors] = useState<Record<string, string>>({})

  const save = useSave()

  // Re-arm the form from the server's read whenever it (re)loads, so a save that

  // reshaped a value cannot leave a stale draft on screen.

  useEffect(() => {
    if (resource.data) setDrafts(seedDrafts(resource.data.policies))
  }, [resource.data])

  if (!canView) {
    return (
      <EmptyState
        icon={ShieldCheck}
        title="Approval policies are not available to your role"
        description="Ask a workspace administrator for the settings grant to view this section."
        tone="pending"
      />
    )
  }

  if (resource.error && !resource.data) {
    return (
      <Alert variant="danger">
        <AlertDescription>{resource.error}</AlertDescription>
      </Alert>
    )
  }

  if (!resource.data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Approval policies</CardTitle>
          <CardDescription>Loading approval configuration</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </CardContent>
      </Card>
    )
  }

  const canEdit = resource.data.canEdit && session.can("settings", "edit")

  const policies = resource.data.policies

  function patch(actionKey: ApprovalAction, next: Partial<PolicyDraft>) {
    setDrafts((current) => ({
      ...current,

      [actionKey]: { ...current[actionKey], ...next },
    }))

    setFormErrors({})

    save.clear()
  }

  async function submit() {
    const errors: Record<string, string> = {}

    const built: ApprovalPolicyInput[] = []

    for (const policy of policies) {
      const draft = drafts[policy.actionKey] ?? {
        enabled: false,
        thresholdAmount: "0",
      }

      let thresholdAmount = 0

      if (policy.hasThreshold) {
        const raw = draft.thresholdAmount.trim()

        const value = raw === "" ? 0 : Number(raw)

        if (
          !Number.isSafeInteger(value) ||
          value < 0 ||
          value > UNIT_PRICE_MAX
        ) {
          errors[`${policy.actionKey}.thresholdAmount`] =
            `Enter a whole number from 0 to ${UNIT_PRICE_MAX}.`

          continue
        }

        thresholdAmount = value
      }

      built.push({
        actionKey: policy.actionKey,

        enabled: draft.enabled,

        thresholdAmount,
      })
    }

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors)

      return
    }

    setFormErrors({})

    const done = await save.run(async () => {
      await approvalsPoliciesApi.update(built)
    })

    if (done) {
      save.clear()

      await resource.reload()
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Approval policies</CardTitle>
        <CardDescription>
          Route these actions through the approvals queue so a different,
          entitled user must sign them off before they take effect.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 py-2">
        {save.error ? (
          <Alert variant="danger">
            <AlertDescription>{save.error}</AlertDescription>
          </Alert>
        ) : null}

        {policies.map((policy) => {
          const draft = drafts[policy.actionKey] ?? {
            enabled: false,

            thresholdAmount: "0",
          }

          return (
            <div
              key={policy.actionKey}
              className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-border pb-4 last:border-b-0 last:pb-0"
            >
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-foreground">
                  {policy.label}
                </p>
                <p className="text-[11.5px] text-muted-foreground">
                  {policy.hasThreshold
                    ? "Hold at or above the amount below."
                    : "Hold every request of this kind."}
                </p>
              </div>

              <div className="flex items-center gap-3">
                {policy.hasThreshold ? (
                  <Field
                    label="Threshold"
                    htmlFor={`approval-threshold-${policy.actionKey}`}
                    className="w-40"
                    error={
                      formErrors[`${policy.actionKey}.thresholdAmount`] ??
                      save.fields[`${policy.actionKey}.thresholdAmount`]
                    }
                  >
                    <Input
                      id={`approval-threshold-${policy.actionKey}`}
                      type="number"
                      min={0}
                      max={UNIT_PRICE_MAX}
                      step={1}
                      inputMode="numeric"
                      disabled={!canEdit || !draft.enabled}
                      value={draft.thresholdAmount}
                      onChange={(event) =>
                        patch(policy.actionKey, {
                          thresholdAmount: event.target.value,
                        })
                      }
                    />
                  </Field>
                ) : null}

                <Switch
                  checked={draft.enabled}
                  disabled={!canEdit}
                  aria-label={`Hold ${policy.label} for approval`}
                  onCheckedChange={(checked) =>
                    patch(policy.actionKey, { enabled: checked })
                  }
                />
              </div>
            </div>
          )
        })}

        {canEdit ? (
          <div className="flex items-center gap-2 pt-1">
            <Button onClick={() => void submit()} disabled={save.saving}>
              {save.saving ? "Saving…" : "Save policies"}
            </Button>
            {save.saved ? (
              <span className="text-[12px] text-success">Saved</span>
            ) : null}
          </div>
        ) : (
          <p className="text-[11.5px] text-muted-foreground">
            Your role can view these policies but not change them.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
