/**
 * Communications settings: editable message templates.
 *
 * The panel edits the body each (channel, purpose) pair would carry and shows a
 * live render with the platform's own tokens substituted against a fixed sample
 * context. Nothing sends: this is a composition desk, not a gateway — the honest
 * half of a messaging feature that has not built a provider connection yet.
 *
 * The live preview is rendered client-side with the same pure `renderTemplate`
 * the server uses, so the draft the editor shows is the draft that will be saved
 * (the server `/preview` endpoint renders only what is already stored). An
 * unsubstituted token is called out rather than left in silence.
 */

import { useEffect, useMemo, useState } from "react"

import { Mail } from "lucide-react"

import { Alert, AlertDescription } from "@/components/ui/alert"

import { Badge } from "@/components/ui/badge"

import { Button } from "@/components/ui/button"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

import { EmptyState } from "@/components/empty-state"

import { Skeleton } from "@/components/ui/skeleton"

import { Switch } from "@/components/ui/switch"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

import { Textarea } from "@/components/ui/textarea"

import { useSave } from "@/features/organization/use-save"

import { communicationsApi } from "@/lib/communications-api"

import { formatCurrency, formatDate } from "@/lib/format"

import { useSession } from "@/lib/session-context"

import { useAsyncResource } from "@/lib/use-async-resource"

import {
  placeholderSyntax,
  renderTemplate,
  type MessageChannel,
  type PlaceholderToken,
  type RenderContext,
  type TemplateKey,
} from "@shared/communications"

/** A stable example row so a preview always shows substituted values. */

const SAMPLE_CONTEXT: RenderContext = {
  customer_name: "Aisha Rahman",

  tenant_name: "DeedOrbit Holdings",

  due_amount: "AED 25,000",

  due_date: formatDate("2026-09-15"),

  amount_paid: "AED 50,000",

  outstanding_balance: "AED 1,200,000",

  booking_reference: "BK-2041",

  unit: "A-1204",

  project: "Marina Heights",

  ticket_id: "TCK-3391",

  ticket_status: "Resolved",

  receipt_number: "RCP-8842",
}

const mapKey = (channel: MessageChannel, key: TemplateKey) =>
  `${channel}|${key}`

export function CommunicationsPanel() {
  const session = useSession()

  const canView = session.can("settings", "view")

  const resource = useAsyncResource(
    (signal) => communicationsApi.read(signal),

    canView,
  )

  const [channel, setChannel] = useState<MessageChannel>("email")

  const [bodies, setBodies] = useState<Record<string, string>>({})

  const [enabledMap, setEnabledMap] = useState<Record<string, boolean>>({})

  useEffect(() => {
    const templates = resource.data?.templates

    if (!templates) return

    const nextBodies: Record<string, string> = {}

    const nextEnabled: Record<string, boolean> = {}

    for (const template of templates) {
      const id = mapKey(template.channel, template.templateKey)

      nextBodies[id] = template.body

      nextEnabled[id] = template.enabled
    }

    setBodies(nextBodies)

    setEnabledMap(nextEnabled)
  }, [resource.data])

  if (!canView) {
    return (
      <EmptyState
        icon={Mail}
        title="Communications are not available to your role"
        description="Ask a workspace administrator for the settings grant to edit message templates."
        tone="pending"
      />
    )
  }

  const canEdit = resource.data?.canEdit ?? false

  const channels = resource.data?.channels ?? []

  const keys = resource.data?.keys ?? []

  const tokens = resource.data?.tokens ?? []

  const templates = resource.data?.templates ?? []

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Message templates</CardTitle>
          <CardDescription>
            Edit what each automated message would say. Tokens in braces —{" "}
            <code className="rounded bg-muted px-1 text-[11px]">
              {"{customer_name}"}
            </code>{" "}
            — are filled when a message is composed. Nothing here is sent
            automatically; this defines the wording only.
          </CardDescription>
        </CardHeader>

        <CardContent className="py-2">
          {resource.loading && !resource.data ? (
            <Skeleton className="h-60 w-full" />
          ) : channels.length === 0 ? (
            <EmptyState
              icon={Mail}
              size="sm"
              title="No message channels configured"
              description="This build ships no communication templates."
            />
          ) : (
            <Tabs
              value={channel}
              onValueChange={(value) => setChannel(value as MessageChannel)}
              className="flex flex-col gap-4"
            >
              <TabsList>
                {channels.map((entry) => (
                  <TabsTrigger key={entry} value={entry}>
                    {resource.data?.channelLabels[entry] ?? entry}
                  </TabsTrigger>
                ))}
              </TabsList>

              {channels.map((entry) => (
                <TabsContent
                  key={entry}
                  value={entry}
                  className="m-0 flex flex-col gap-4"
                >
                  {keys.map((key) => (
                    <TemplateEditor
                      key={`${entry}-${key}`}
                      channel={entry}
                      templateKey={key}
                      body={bodies[mapKey(entry, key)] ?? ""}
                      enabled={enabledMap[mapKey(entry, key)] ?? true}
                      subject={
                        templates.find(
                          (template) =>
                            template.channel === entry &&
                            template.templateKey === key,
                        )?.subject ?? ""
                      }
                      storedBody={
                        templates.find(
                          (template) =>
                            template.channel === entry &&
                            template.templateKey === key,
                        )?.body ?? ""
                      }
                      storedEnabled={
                        templates.find(
                          (template) =>
                            template.channel === entry &&
                            template.templateKey === key,
                        )?.enabled ?? true
                      }
                      tokens={tokens}
                      tokenLabels={resource.data?.tokenLabels}
                      keyLabel={resource.data?.keyLabels[key] ?? key}
                      keyHint={resource.data?.keyHints[key] ?? ""}
                      bodyMax={resource.data?.bodyMax ?? 4000}
                      canEdit={canEdit}
                      onBodyChange={(value) =>
                        setBodies((current) => ({
                          ...current,

                          [mapKey(entry, key)]: value,
                        }))
                      }
                      onEnabledChange={(value) =>
                        setEnabledMap((current) => ({
                          ...current,

                          [mapKey(entry, key)]: value,
                        }))
                      }
                      onSaved={() => void resource.reload()}
                    />
                  ))}
                </TabsContent>
              ))}
            </Tabs>
          )}
        </CardContent>
      </Card>

      <UpcomingRemindersCard channel={channel} />
    </div>
  )
}

interface TemplateEditorProps {
  channel: MessageChannel

  templateKey: TemplateKey

  body: string

  enabled: boolean

  subject: string

  storedBody: string

  storedEnabled: boolean

  tokens: PlaceholderToken[]

  tokenLabels?: Record<PlaceholderToken, string>

  keyLabel: string

  keyHint: string

  bodyMax: number

  canEdit: boolean

  onBodyChange: (value: string) => void

  onEnabledChange: (value: boolean) => void

  onSaved: () => void
}

function TemplateEditor({
  channel,

  templateKey,

  body,

  enabled,

  subject,

  storedBody,

  storedEnabled,

  tokens,

  tokenLabels,

  keyLabel,

  keyHint,

  bodyMax,

  canEdit,

  onBodyChange,

  onEnabledChange,

  onSaved,
}: TemplateEditorProps) {
  const save = useSave()

  const dirty = body !== storedBody || enabled !== storedEnabled

  const rendered = useMemo(
    () => renderTemplate(body, SAMPLE_CONTEXT),

    [body],
  )

  const isEmail = channel === "email"

  async function submit() {
    const done = await save.run(async () => {
      await communicationsApi.saveTemplate({
        channel,

        key: templateKey,

        body,

        enabled,
      })
    })

    if (done) {
      onSaved()
    }
  }

  return (
    <div className="rounded-md border border-border">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border px-3 py-2.5">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-foreground">{keyLabel}</p>

          <p className="mt-0.5 text-[11.5px] text-muted-foreground">
            {keyHint}
          </p>
        </div>

        {canEdit ? (
          <label className="flex items-center gap-2 text-[11.5px] text-muted-foreground">
            <Switch
              checked={enabled}
              onCheckedChange={(value) => {
                onEnabledChange(value)

                save.clear()
              }}
              aria-label={`Enable ${keyLabel}`}
            />
            {enabled ? "Enabled" : "Disabled"}
          </label>
        ) : (
          <Badge variant={enabled ? "success" : "outline"}>
            {enabled ? "Enabled" : "Disabled"}
          </Badge>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 px-3 py-3 lg:grid-cols-2">
        <div className="flex flex-col gap-2">
          {isEmail && subject ? (
            <div className="rounded-md bg-muted/30 px-2.5 py-1.5 text-[11.5px] text-muted-foreground">
              <span className="font-medium text-foreground">Subject: </span>

              {subject}
            </div>
          ) : null}

          <Textarea
            value={body}
            onChange={(event) => {
              onBodyChange(event.target.value.slice(0, bodyMax))

              save.clear()
            }}
            maxLength={bodyMax}
            rows={6}
            disabled={!canEdit}
            aria-label={`${keyLabel} body`}
          />

          {canEdit ? (
            <div className="flex flex-wrap gap-1">
              {tokens.map((token) => (
                <Button
                  key={token}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-6 px-2 font-mono text-[10.5px]"
                  onClick={() => {
                    onBodyChange(
                      `${body}${
                        body.endsWith("\n") || body === "" ? "" : " "
                      }${placeholderSyntax(token)}`,
                    )

                    save.clear()
                  }}
                >
                  {tokenLabels?.[token] ?? token}
                </Button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            Preview (sample data)
          </p>

          <div className="min-h-24 whitespace-pre-wrap rounded-md border border-border bg-muted/20 px-3 py-2 text-[12.5px] text-foreground">
            {rendered.text}
          </div>

          {rendered.missingTokens.length > 0 ? (
            <Alert variant="pending">
              <AlertDescription>
                Unfilled token
                {rendered.missingTokens.length === 1 ? "" : "s"}:{" "}
                {rendered.missingTokens.map((token) => `{${token}}`).join(", ")}{" "}
                — these will show blank in a real message.
              </AlertDescription>
            </Alert>
          ) : null}

          {save.error ? (
            <Alert variant="danger">
              <AlertDescription>{save.error}</AlertDescription>
            </Alert>
          ) : null}

          {canEdit ? (
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={() => void submit()}
                disabled={save.saving || !dirty || body.trim() === ""}
              >
                {save.saving ? "Saving…" : "Save template"}
              </Button>

              {save.saved ? (
                <span className="text-[12px] text-success">Saved</span>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

/**
 * One row of the reminder dry run. The server ships a wider `RenderedReminder`;
 * this local shape names only the fields the card reads, so the cast at the
 * fetch site stays honest to what is actually rendered.
 */

interface ReminderRow {
  customerId: string

  customerName: string

  bookingReference: string

  unitCode: string

  projectName: string

  installmentId: string

  installmentNumber: number

  dueDate: string

  dueAmount: number

  outstandingBalance: number

  currency: string

  daysUntilDue: number

  subject: string

  body: string

  missingTokens: string[]
}

function UpcomingRemindersCard({ channel }: { channel: MessageChannel }) {
  const session = useSession()

  const canView = session.can("settings", "view")

  const [days, setDays] = useState(3)

  const resource = useAsyncResource(
    (signal) => communicationsApi.upcomingReminders(days, channel, signal),

    canView,
  )

  const reminders = (resource.data?.reminders ?? []) as ReminderRow[]

  return (
    <Card>
      <CardHeader>
        <CardTitle>Upcoming payment reminders</CardTitle>

        <CardDescription>
          A read-only dry run of the reminders the due-payment job would compose
          in the next few days. Nothing is sent — this shows the wording against
          real instalments.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-3 py-2">
        <div className="flex items-center gap-2">
          {[3, 7, 14].map((option) => (
            <Button
              key={option}
              size="sm"
              variant={days === option ? "default" : "outline"}
              onClick={() => {
                setDays(option)

                // The resource keys on `days` only inside the load closure, so a

                // change is picked up by asking for a fresh read explicitly.

                void resource.reload()
              }}
            >
              {option} days
            </Button>
          ))}
        </div>

        {resource.error ? (
          <Alert variant="danger">
            <AlertDescription>{resource.error}</AlertDescription>
          </Alert>
        ) : resource.loading && !resource.data ? (
          <Skeleton className="h-24 w-full" />
        ) : reminders.length === 0 ? (
          <p className="text-[12.5px] text-muted-foreground">
            No instalments fall due in the next {days} days.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {reminders.map((reminder) => (
              <li
                key={`${reminder.installmentId}-${reminder.customerId}`}
                className="rounded-md border border-border bg-card px-3 py-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[12.5px] font-medium text-foreground">
                    {reminder.customerName}
                  </p>

                  <p className="text-[11.5px] text-muted-foreground">
                    {reminder.daysUntilDue < 0
                      ? `Overdue by ${Math.abs(reminder.daysUntilDue)}d`
                      : `Due in ${reminder.daysUntilDue}d`}{" "}
                    · {formatDate(reminder.dueDate)}
                  </p>
                </div>

                <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                  {reminder.unitCode} · {reminder.projectName} · instalment{" "}
                  {reminder.installmentNumber} ·{" "}
                  {formatCurrency(reminder.dueAmount, reminder.currency, {
                    maximumFractionDigits: 0,
                  })}
                </p>

                {reminder.subject ? (
                  <p className="mt-1 text-[12px] text-foreground">
                    <span className="font-medium">Subject: </span>

                    {reminder.subject}
                  </p>
                ) : null}

                <p className="mt-1 text-[12px] whitespace-pre-wrap text-muted-foreground">
                  {reminder.body}
                </p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
