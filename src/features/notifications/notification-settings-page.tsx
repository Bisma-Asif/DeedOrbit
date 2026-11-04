/**
 * Notification settings — which events reach your inbox and how.
 *
 * One switch per event type, matching exactly the four events the platform really
 * emits (see `shared/notifications.ts`). A type set to **Off** suppresses the
 * notification entirely; **In-app**, **Email**, and **Both** all still land in the
 * in-app inbox, because this workspace has no mail gateway wired — the "email"
 * choice is a recorded preference, never a claim that a message was sent. The page
 * says so plainly instead of implying a delivery that cannot happen, honouring the
 * product rule that we never fabricate a capability there is no data for.
 *
 * Everything is scoped to the signed-in user; there is no module grant to check.
 */

import { useCallback, useEffect, useMemo, useState } from "react"

import { Check, Info, Loader2, Save } from "lucide-react"

import { Alert, AlertDescription } from "@/components/ui/alert"

import { Badge } from "@/components/ui/badge"

import { Button } from "@/components/ui/button"

import { PageHeader } from "@/components/page-header"

import { Skeleton } from "@/components/ui/skeleton"

import { useAsyncResource } from "@/lib/use-async-resource"

import { notificationApi } from "@/lib/notifications-api"

import { cn } from "@/lib/utils"

import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_CHANNEL_LABELS,
  type NotificationChannel,
  type NotificationSettingView,
  type NotificationType,
} from "@shared/notifications"

const CHANNEL_ORDER: NotificationChannel[] = [...NOTIFICATION_CHANNELS]

/** The two channels that mean "deliver by email in some form", for the honest note. */

function wantsEmail(channel: NotificationChannel): boolean {
  return channel === "email" || channel === "both"
}

interface ChannelChoiceProps {
  value: NotificationChannel

  current: NotificationChannel

  onChange: (value: NotificationChannel) => void
}

/** A compact segmented control: one button per delivery channel. */

function ChannelChoice({ value, current, onChange }: ChannelChoiceProps) {
  const active = value === current

  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => onChange(value)}
      className={cn(
        "inline-flex items-center gap-1 rounded-[5px] px-2.5 py-1 text-[12px] font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",

        active
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {active && <Check size={12} />}
      {NOTIFICATION_CHANNEL_LABELS[value]}
    </button>
  )
}

interface SettingRowProps {
  setting: NotificationSettingView

  channel: NotificationChannel

  onChange: (channel: NotificationChannel) => void
}

function SettingRow({ setting, channel, onChange }: SettingRowProps) {
  return (
    <div className="flex flex-col gap-2 border-b border-border px-4 py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-foreground">
          {setting.label}
        </p>

        <p className="mt-0.5 text-[11.5px] leading-4 text-muted-foreground">
          {setting.description}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-0.5 rounded-md border border-border bg-muted/40 p-0.5">
        {CHANNEL_ORDER.map((option) => (
          <ChannelChoice
            key={option}
            value={option}
            current={channel}
            onChange={onChange}
          />
        ))}
      </div>
    </div>
  )
}

// --- Body (remounts only if we ever need a hard reload of the base set) ------

export function NotificationSettingsPage() {
  const resource = useAsyncResource((signal) =>
    notificationApi.getSettings(signal),
  )

  const data = resource.data

  const [draft, setDraft] =
    useState<Partial<Record<NotificationType, NotificationChannel>>>({})

  const [saving, setSaving] = useState(false)

  const [savedAt, setSavedAt] = useState<number | null>(null)

  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    if (!data) return

    const next: Partial<Record<NotificationType, NotificationChannel>> = {}

    for (const setting of data.settings) next[setting.type] = setting.channel

    setDraft(next)
  }, [data])

  const emailConnected = data?.emailConnected ?? false

  const settings = useMemo(() => data?.settings ?? [], [data])

  const dirty = useMemo(
    () =>
      settings.some(
        (setting) =>
          draft[setting.type] !== undefined &&
          draft[setting.type] !== setting.channel,
      ),

    [settings, draft],
  )

  const anyEmailChosen = useMemo(
    () =>
      settings.some((setting) =>
        wantsEmail(draft[setting.type] ?? setting.channel),
      ),

    [settings, draft],
  )

  const handleSave = useCallback(async () => {
    const changes: Record<string, NotificationChannel> = {}

    for (const setting of settings) {
      const chosen = draft[setting.type]

      if (chosen && chosen !== setting.channel) changes[setting.type] = chosen
    }

    if (Object.keys(changes).length === 0) return

    setSaving(true)

    setSaveError(null)

    try {
      const result = await notificationApi.saveSettings(
        changes as Partial<Record<NotificationType, NotificationChannel>>,
      )

      const next: Partial<Record<NotificationType, NotificationChannel>> = {}

      for (const setting of result.settings)
        next[setting.type] = setting.channel

      setDraft(next)

      // Nudge the shared resource so a re-read reflects the saved values.

      resource.reload()

      setSavedAt(Date.now())
    } catch {
      setSaveError("Could not save your settings. Try again.")
    } finally {
      setSaving(false)
    }
  }, [settings, draft, resource])

  if (resource.error) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Notification settings" />

        <Alert variant="danger">
          <AlertDescription>{resource.error}</AlertDescription>
        </Alert>
      </div>
    )
  }

  if (resource.loading && !data) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader
          title="Notification settings"
          description="Choose which events reach your inbox and how they are delivered."
        />

        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Notification settings"
        description="Choose which events reach your inbox and how they are delivered."
        actions={
          <Button
            size="sm"
            onClick={() => void handleSave()}
            disabled={!dirty || saving}
          >
            {saving ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Save size={13} />
            )}
            {saving ? "Saving…" : "Save changes"}
          </Button>
        }
      />

      {!emailConnected && anyEmailChosen ? (
        <Alert variant="neutral">
          <Info size={14} className="mt-0.5 shrink-0" />

          <AlertDescription>
            Email is saved as a delivery preference, but this workspace has no
            email gateway connected — those events still appear only in your
            in-app inbox. Nothing is sent to your address.
          </AlertDescription>
        </Alert>
      ) : null}

      {saveError ? (
        <Alert variant="danger">
          <AlertDescription>{saveError}</AlertDescription>
        </Alert>
      ) : null}

      <div className="overflow-hidden rounded-md border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border bg-muted/30 px-4 py-2">
          <p className="text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
            Events
          </p>

          {savedAt && !dirty ? (
            <Badge variant="success">Saved</Badge>
          ) : dirty ? (
            <Badge variant="pending">Unsaved changes</Badge>
          ) : null}
        </div>

        {settings.map((setting) => (
          <SettingRow
            key={setting.type}
            setting={setting}
            channel={draft[setting.type] ?? setting.channel}
            onChange={(channel) =>
              setDraft((current) => ({ ...current, [setting.type]: channel }))
            }
          />
        ))}
      </div>

      <p className="text-[11.5px] leading-5 text-muted-foreground">
        New settings apply to notifications created from now on. Existing items
        stay in your inbox until you read or clear them.
      </p>
    </div>
  )
}

export default NotificationSettingsPage
