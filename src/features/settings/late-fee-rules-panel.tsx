/**
 * Late-fee rules — one tenant-wide switch and its shape.
 *
 * A rule is a single configuration: whether an overdue line is charged at all, whether
 * the charge is a flat amount or a percentage of the outstanding balance, how many days
 * of grace must pass before it bites, and how many times one installment may be
 * assessed. Nothing is charged until a collections or overdue read runs the sweep, and
 * an untouched workspace has no rule row, so the toggle starts off and no fee appears.
 *
 * The percentage is stored in basis points (hundredths of a percent) to keep the money
 * path in whole integers; the form edits a friendly percent value and converts on save.
 * Editing is gated on `settings.edit`, and the server re-checks the grant regardless.
 */

import { useEffect, useState } from "react"

import { AlertTriangle } from "lucide-react"

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

import { lateFeesApi, type LateFeeRules } from "@/lib/late-fees-api"

import {
  GRACE_DAYS_MAX,
  LATE_FEE_AMOUNT_MAX,
  LATE_FEE_MODES,
  LATE_FEE_MODE_LABELS,
  MAX_ASSESSMENTS_MAX,
  PERCENT_BPS_MAX,
  type LateFeeMode,
} from "@shared/late-fees"

interface LateFeeDraft {
  enabled: boolean

  mode: LateFeeMode

  amount: string

  percent: string

  graceDays: string

  maxAssessments: string
}

function seed(rules: LateFeeRules): LateFeeDraft {
  return {
    enabled: rules.enabled,

    mode: rules.mode,

    amount: String(rules.amount),

    percent: String(rules.percentBps / 100),

    graceDays: String(rules.graceDays),

    maxAssessments: String(rules.maxAssessments),
  }
}

function whole(value: string): number {
  return Math.trunc(Number(value) || 0)
}

export function LateFeeRulesPanel() {
  const session = useSession()

  const canView = session.can("settings", "view")

  const resource = useAsyncResource(
    (signal) => lateFeesApi.getRules(signal),

    canView,
  )

  const [draft, setDraft] = useState<LateFeeDraft | null>(null)

  const [formErrors, setFormErrors] = useState<Record<string, string>>({})

  const save = useSave()

  useEffect(() => {
    if (resource.data) setDraft(seed(resource.data.rules))
  }, [resource.data])

  if (!canView) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Late-fee rules are not available to your role"
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
          <CardTitle>Late fees</CardTitle>
          <CardDescription>Loading late-fee configuration</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </CardContent>
      </Card>
    )
  }

  const canEdit = session.can("settings", "edit")

  function patch(next: Partial<LateFeeDraft>) {
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

    const graceDays = whole(draft.graceDays)

    const maxAssessments = whole(draft.maxAssessments)

    if (
      draft.amount.trim() !== "" &&
      (amount < 0 || amount > LATE_FEE_AMOUNT_MAX)
    ) {
      errors.amount = `Enter a whole number from 0 to ${LATE_FEE_AMOUNT_MAX}.`
    }

    if (percentBps > PERCENT_BPS_MAX) {
      errors.percent = "A rate cannot exceed 100%."
    }

    if (graceDays < 0 || graceDays > GRACE_DAYS_MAX) {
      errors.graceDays = `Enter a whole number from 0 to ${GRACE_DAYS_MAX}.`
    }

    if (maxAssessments < 0 || maxAssessments > MAX_ASSESSMENTS_MAX) {
      errors.maxAssessments = `Enter a whole number from 0 to ${MAX_ASSESSMENTS_MAX}.`
    }

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors)

      return
    }

    setFormErrors({})

    const rules: LateFeeRules = {
      enabled: draft.enabled,

      mode: draft.mode,

      amount,

      percentBps,

      graceDays,

      maxAssessments,
    }

    const done = await save.run(async () => {
      await lateFeesApi.saveRules(rules)
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
        <CardTitle>Late fees</CardTitle>
        <CardDescription>
          Charge a fee when an installment slips past its due date. A waiver of
          any fee still needs a second sign-off.
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
              Charge late fees
            </p>
            <p className="text-[11.5px] text-muted-foreground">
              {resource.data.configured
                ? "A rule is already saved for this workspace."
                : "No rule saved yet — fees are off until you save one."}
            </p>
          </div>
          <Switch
            checked={draft.enabled}
            disabled={!canEdit}
            aria-label="Charge late fees"
            onCheckedChange={(checked) => patch({ enabled: checked })}
          />
        </div>

        <Field label="Fee mode" htmlFor="late-fee-mode">
          <Select
            value={draft.mode}
            onValueChange={(value) => patch({ mode: value as LateFeeMode })}
            disabled={!canEdit || !draft.enabled}
          >
            <SelectTrigger id="late-fee-mode">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LATE_FEE_MODES.map((mode) => (
                <SelectItem key={mode} value={mode}>
                  {LATE_FEE_MODE_LABELS[mode]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <FieldGrid>
          {draft.mode === "fixed" ? (
            <Field
              label="Fixed amount"
              htmlFor="late-fee-amount"
              error={errorFor("amount")}
            >
              <Input
                id="late-fee-amount"
                type="number"
                min={0}
                max={LATE_FEE_AMOUNT_MAX}
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
              htmlFor="late-fee-percent"
              error={errorFor("percent")}
              hint="Of the outstanding balance, up to 100%."
            >
              <Input
                id="late-fee-percent"
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
            label="Grace days"
            htmlFor="late-fee-grace"
            error={errorFor("graceDays")}
            hint="Days past due before a fee is charged."
          >
            <Input
              id="late-fee-grace"
              type="number"
              min={0}
              max={GRACE_DAYS_MAX}
              step={1}
              inputMode="numeric"
              disabled={!canEdit || !draft.enabled}
              value={draft.graceDays}
              onChange={(event) => patch({ graceDays: event.target.value })}
            />
          </Field>

          <Field
            label="Max assessments"
            htmlFor="late-fee-max"
            error={errorFor("maxAssessments")}
            hint="0 allows an unlimited number per installment."
          >
            <Input
              id="late-fee-max"
              type="number"
              min={0}
              max={MAX_ASSESSMENTS_MAX}
              step={1}
              inputMode="numeric"
              disabled={!canEdit || !draft.enabled}
              value={draft.maxAssessments}
              onChange={(event) =>
                patch({ maxAssessments: event.target.value })
              }
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
