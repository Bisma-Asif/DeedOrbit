/**
 * Document verification settings — one tenant-wide configuration.
 *
 * These switches decide how hard the paperwork gate bites: whether an unverified
 * file blocks a booking or a plan activation, whether an entitled user may
 * override that block through an approval, whether previews carry the watermark
 * overlay, how long uploaded bytes are retained, which expiry windows raise the
 * 60/30/7-style alerts, and whether identity checks run manually or through a
 * live provider.
 *
 * Everything defaults to the least-intrusive shape (block off, manual identity)
 * so an untouched workspace behaves exactly as it did before this module. The
 * alert days are edited as a friendly comma list and stored that way; retention
 * is a whole number of days or empty for "keep forever". Editing is gated on
 * `settings.edit`, and the server re-checks the grant regardless.
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

import {
  documentVerificationApi,
  type DocVerificationSettings,
} from "@/lib/document-verification-api"

const RETENTION_DAYS_MAX = 3650

const ALERT_DAY_MAX = 365

interface VerificationDraft {
  blockBooking: boolean

  blockPlanActivation: boolean

  allowOverride: boolean

  watermarkPreviews: boolean

  retentionDays: string

  expiryAlertDays: string

  identityMode: "manual" | "provider"
}

function seed(settings: DocVerificationSettings): VerificationDraft {
  return {
    blockBooking: settings.blockBooking,

    blockPlanActivation: settings.blockPlanActivation,

    allowOverride: settings.allowOverride,

    watermarkPreviews: settings.watermarkPreviews,

    retentionDays:
      settings.retentionDays === null ? "" : String(settings.retentionDays),

    expiryAlertDays: settings.expiryAlertDays.join(", "),

    identityMode: settings.identityMode,
  }
}

function parseAlertDays(text: string): number[] {
  return [
    ...new Set(
      text

        .split(/[,\s]+/)

        .map((part) => Number(part))

        .filter((n) => Number.isInteger(n) && n > 0 && n <= ALERT_DAY_MAX),
    ),
  ].sort((a, b) => b - a)
}

export function DocumentVerificationPanel() {
  const session = useSession()

  const canView = session.can("settings", "view")

  const resource = useAsyncResource(
    (signal) => documentVerificationApi.getSettings(signal),

    canView,
  )

  const [draft, setDraft] = useState<VerificationDraft | null>(null)

  const [formErrors, setFormErrors] = useState<Record<string, string>>({})

  const save = useSave()

  useEffect(() => {
    if (resource.data) setDraft(seed(resource.data.settings))
  }, [resource.data])

  if (!canView) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Document verification settings are not available to your role"
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
          <CardTitle>Document verification</CardTitle>
          <CardDescription>Loading verification configuration</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </CardContent>
      </Card>
    )
  }

  const canEdit = session.can("settings", "edit")

  function patch(next: Partial<VerificationDraft>) {
    setDraft((current) => (current ? { ...current, ...next } : current))

    setFormErrors({})

    save.clear()
  }

  async function submit() {
    if (!draft) return

    const errors: Record<string, string> = {}

    let retentionDays: number | null = null

    if (draft.retentionDays.trim() !== "") {
      const n = Math.trunc(Number(draft.retentionDays) || 0)

      if (
        !Number.isInteger(Number(draft.retentionDays)) ||
        n < 1 ||
        n > RETENTION_DAYS_MAX
      ) {
        errors.retentionDays = `Use a whole number from 1 to ${RETENTION_DAYS_MAX}, or leave it empty to keep files forever.`
      } else {
        retentionDays = n
      }
    }

    const alertDays = parseAlertDays(draft.expiryAlertDays)

    if (alertDays.length === 0) {
      errors.expiryAlertDays =
        "Give at least one positive day threshold, like 60, 30, 7."
    }

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors)

      return
    }

    setFormErrors({})

    const done = await save.run(async () => {
      await documentVerificationApi.patchSettings({
        blockBooking: draft.blockBooking,

        blockPlanActivation: draft.blockPlanActivation,

        allowOverride: draft.allowOverride,

        watermarkPreviews: draft.watermarkPreviews,

        retentionDays,

        expiryAlertDays: alertDays.join(","),

        identityMode: draft.identityMode,
      })
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
        <CardTitle>Document verification</CardTitle>
        <CardDescription>
          Decide how the paperwork gate applies to bookings and plans, how long
          files are kept, when expiring documents raise alerts, and whether
          identity is checked manually or through a live provider.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 py-2">
        {save.error ? (
          <Alert variant="danger">
            <AlertDescription>{save.error}</AlertDescription>
          </Alert>
        ) : null}

        <ToggleRow
          title="Block booking until required documents are verified"
          description="A new booking is refused while a required document is missing or expired. Off by default, so existing tenants are untouched."
          checked={draft.blockBooking}
          disabled={!canEdit}
          onCheckedChange={(checked) => patch({ blockBooking: checked })}
        />

        <ToggleRow
          title="Block payment-plan activation"
          description="Activating an installment plan waits for the same verification, unless an override is approved."
          checked={draft.blockPlanActivation}
          disabled={!canEdit}
          onCheckedChange={(checked) => patch({ blockPlanActivation: checked })}
        />

        <ToggleRow
          title="Allow override through approval"
          description="An entitled user may raise an approval so a reviewer who is not the requester can let a blocked booking or plan proceed. Every override is audited."
          checked={draft.allowOverride}
          disabled={!canEdit}
          onCheckedChange={(checked) => patch({ allowOverride: checked })}
        />

        <ToggleRow
          title="Watermark document previews"
          description="Overlays the viewer and timestamp on on-screen previews. Downloaded bytes stay original and every download is logged."
          checked={draft.watermarkPreviews}
          disabled={!canEdit}
          onCheckedChange={(checked) => patch({ watermarkPreviews: checked })}
        />

        <FieldGrid>
          <Field
            label="Retention (days)"
            htmlFor="verification-retention"
            error={errorFor("retentionDays")}
            hint="How long uploaded files are kept. Leave empty to keep them forever."
          >
            <Input
              id="verification-retention"
              type="number"
              min={1}
              max={RETENTION_DAYS_MAX}
              step={1}
              inputMode="numeric"
              disabled={!canEdit}
              value={draft.retentionDays}
              onChange={(event) => patch({ retentionDays: event.target.value })}
            />
          </Field>

          <Field
            label="Expiry alert days"
            htmlFor="verification-alerts"
            error={errorFor("expiryAlertDays")}
            hint="Comma-separated thresholds ahead of expiry, largest first — e.g. 60, 30, 7."
          >
            <Input
              id="verification-alerts"
              disabled={!canEdit}
              value={draft.expiryAlertDays}
              onChange={(event) =>
                patch({ expiryAlertDays: event.target.value })
              }
            />
          </Field>
        </FieldGrid>

        <Field
          label="Identity verification mode"
          htmlFor="verification-identity-mode"
          hint="Manual stamps every verification as done by a person. Provider mode enables the live government-ID check once a provider is configured."
        >
          <Select
            value={draft.identityMode}
            onValueChange={(value) =>
              patch({ identityMode: value as "manual" | "provider" })
            }
            disabled={!canEdit}
          >
            <SelectTrigger id="verification-identity-mode">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="manual">Manual (no provider)</SelectItem>
              <SelectItem value="provider">Live provider</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        {canEdit ? (
          <div className="flex items-center gap-2 pt-1">
            <Button disabled={save.saving} onClick={() => void submit()}>
              {save.saving ? "Saving…" : "Save changes"}
            </Button>

            {save.saved ? (
              <span className="text-[12px] text-success">Saved</span>
            ) : null}
          </div>
        ) : (
          <p className="text-[11.5px] text-muted-foreground">
            Your role can view this configuration but not change it.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function ToggleRow({
  title,

  description,

  checked,

  disabled,

  onCheckedChange,
}: {
  title: string

  description: string

  checked: boolean

  disabled: boolean

  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border pb-4">
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-foreground">{title}</p>
        <p className="text-[11.5px] text-muted-foreground">{description}</p>
      </div>
      <Switch
        checked={checked}
        disabled={disabled}
        aria-label={title}
        onCheckedChange={onCheckedChange}
      />
    </div>
  )
}
