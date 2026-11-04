/**
 * Cancellation rules — what it costs to call a booking off.
 *
 * One tenant-wide rule sizes the charge against the money paid to date — a flat figure
 * or a percentage (basis points), optionally capped — and names the status the freed
 * unit returns to. The refund is whatever the customer overpaid beyond the charge. With
 * no rule saved the workspace cancels with no charge and no refund, exactly as it did
 * before this feature; the toggle only changes behaviour once it is switched on.
 *
 * Editing is gated on `settings.edit`; the server re-checks the grant anyway.
 */

import { useEffect, useState } from "react"

import { XCircle } from "lucide-react"

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

import { Field, FieldGrid } from "@/components/field"

import { Input } from "@/components/ui/input"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

import { Skeleton } from "@/components/ui/skeleton"

import { Switch } from "@/components/ui/switch"

import { useSave } from "@/features/organization/use-save"

import { useSession } from "@/lib/session-context"

import { useAsyncResource } from "@/lib/use-async-resource"

import {
  cancellationRulesApi,
  type CancellationRules,
} from "@/lib/bookings-api"

import {
  CANCELLATION_AMOUNT_MAX,
  CANCELLATION_MODES,
  CANCELLATION_MODE_LABELS,
  CANCELLATION_PERCENT_BPS_MAX,
  UNIT_OUTCOMES,
  UNIT_OUTCOME_LABELS,
  type CancellationMode,
  type UnitOutcome,
} from "@shared/cancellation"

interface CancellationDraft {
  enabled: boolean

  mode: CancellationMode

  amount: string

  percent: string

  capAmount: string

  unitOutcome: UnitOutcome
}

function seed(rules: CancellationRules): CancellationDraft {
  return {
    enabled: rules.enabled,

    mode: rules.mode,

    amount: String(rules.amount),

    percent: String(rules.percentBps / 100),

    capAmount: String(rules.capAmount),

    unitOutcome: rules.unitOutcome,
  }
}

function whole(value: string): number {
  return Math.trunc(Number(value) || 0)
}

export function CancellationRulesPanel() {
  const session = useSession()

  const canView = session.can("settings", "view")

  const resource = useAsyncResource(
    (signal) => cancellationRulesApi.read(signal),

    canView,
  )

  const [draft, setDraft] = useState<CancellationDraft | null>(null)

  const [formErrors, setFormErrors] = useState<Record<string, string>>({})

  const save = useSave()

  useEffect(() => {
    if (resource.data) setDraft(seed(resource.data.rules))
  }, [resource.data])

  if (!canView) {
    return (
      <EmptyState
        icon={XCircle}
        title="Cancellation rules are not available to your role"
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

  if (!resource.data || !draft) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Cancellation</CardTitle>
          <CardDescription>Loading cancellation configuration</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </CardContent>
      </Card>
    )
  }

  const canEdit = session.can("settings", "edit")

  function patch(next: Partial<CancellationDraft>) {
    setDraft((current) => (current ? { ...current, ...next } : current))

    setFormErrors({})

    save.clear()
  }

  async function submit() {
    if (!draft) return

    const errors: Record<string, string> = {}

    const amount = whole(draft.amount)

    const percentBps = Math.round(
      Math.max(0, Math.min(100, Number(draft.percent) || 0)) * 100,
    )

    const capAmount = whole(draft.capAmount)

    if (
      draft.amount.trim() !== "" &&
      (amount < 0 || amount > CANCELLATION_AMOUNT_MAX)
    ) {
      errors.amount = `Enter a whole number from 0 to ${CANCELLATION_AMOUNT_MAX}.`
    }

    if (percentBps > CANCELLATION_PERCENT_BPS_MAX) {
      errors.percent = "A rate cannot exceed 100%."
    }

    if (capAmount < 0 || capAmount > CANCELLATION_AMOUNT_MAX) {
      errors.capAmount = `Enter a whole number from 0 to ${CANCELLATION_AMOUNT_MAX}.`
    }

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors)

      return
    }

    setFormErrors({})

    const rules: CancellationRules = {
      enabled: draft.enabled,

      mode: draft.mode,

      amount,

      percentBps,

      capAmount,

      unitOutcome: draft.unitOutcome,
    }

    const done = await save.run(async () => {
      await cancellationRulesApi.save(rules)
    })

    if (done) {
      save.clear()

      await resource.reload()
    }
  }

  const errorFor = (key: string) => formErrors[key] ?? save.fields[key]

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cancellation</CardTitle>
        <CardDescription>
          Size the charge kept when a confirmed booking is called off, and where
          the freed unit goes. The customer is refunded what they overpaid
          beyond it.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 py-2">
        {save.error ? (
          <Alert variant="danger">
            <AlertDescription>{save.error}</AlertDescription>
          </Alert>
        ) : null}

        <div className="flex items-center justify-between gap-4 border-b border-border pb-4">
          <div className="min-w-0">
            <p className="text-[13px] font-medium text-foreground">
              Apply a cancellation charge
            </p>
            <p className="text-[11.5px] text-muted-foreground">
              {resource.data.configured
                ? "A rule is already saved for this workspace."
                : "No rule saved yet — cancellations charge nothing."}
            </p>
          </div>
          <Switch
            checked={draft.enabled}
            disabled={!canEdit}
            aria-label="Apply a cancellation charge"
            onCheckedChange={(checked) => patch({ enabled: checked })}
          />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Charge mode" htmlFor="cancellation-mode">
            <Select
              value={draft.mode}
              onValueChange={(value) =>
                patch({ mode: value as CancellationMode })
              }
              disabled={!canEdit || !draft.enabled}
            >
              <SelectTrigger id="cancellation-mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CANCELLATION_MODES.map((mode) => (
                  <SelectItem key={mode} value={mode}>
                    {CANCELLATION_MODE_LABELS[mode]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Freed unit" htmlFor="cancellation-unit">
            <Select
              value={draft.unitOutcome}
              onValueChange={(value) =>
                patch({ unitOutcome: value as UnitOutcome })
              }
              disabled={!canEdit || !draft.enabled}
            >
              <SelectTrigger id="cancellation-unit">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {UNIT_OUTCOMES.map((outcome) => (
                  <SelectItem key={outcome} value={outcome}>
                    {UNIT_OUTCOME_LABELS[outcome]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>

        <FieldGrid>
          {draft.mode === "fixed" ? (
            <Field
              label="Flat charge"
              htmlFor="cancellation-amount"
              error={errorFor("amount")}
            >
              <Input
                id="cancellation-amount"
                type="number"
                min={0}
                max={CANCELLATION_AMOUNT_MAX}
                step={1}
                inputMode="numeric"
                disabled={!canEdit || !draft.enabled}
                value={draft.amount}
                onChange={(event) => patch({ amount: event.target.value })}
              />
            </Field>
          ) : (
            <Field
              label="Rate (%)"
              htmlFor="cancellation-percent"
              error={errorFor("percent")}
              hint="Of the amount paid to date, up to 100%."
            >
              <Input
                id="cancellation-percent"
                type="number"
                min={0}
                max={100}
                step={0.01}
                inputMode="decimal"
                disabled={!canEdit || !draft.enabled}
                value={draft.percent}
                onChange={(event) => patch({ percent: event.target.value })}
              />
            </Field>
          )}

          <Field
            label="Charge cap"
            htmlFor="cancellation-cap"
            error={errorFor("capAmount")}
            hint="0 means no cap."
          >
            <Input
              id="cancellation-cap"
              type="number"
              min={0}
              max={CANCELLATION_AMOUNT_MAX}
              step={1}
              inputMode="numeric"
              disabled={!canEdit || !draft.enabled}
              value={draft.capAmount}
              onChange={(event) => patch({ capAmount: event.target.value })}
            />
          </Field>
        </FieldGrid>

        {canEdit ? (
          <div className="flex items-center gap-2 pt-1">
            <Button onClick={() => void submit()} disabled={save.saving}>
              {save.saving ? "Saving…" : "Save rule"}
            </Button>
            {save.saved ? (
              <span className="text-[12px] text-success">Saved</span>
            ) : null}
          </div>
        ) : (
          <p className="text-[11.5px] text-muted-foreground">
            Your role can view this rule but not change it.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
