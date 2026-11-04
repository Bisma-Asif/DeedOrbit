/**
 * Settings > Integrations dialogs: API keys and webhook endpoints.
 *
 * Both carry the same one-time-reveal rule the server enforces. A new API key's
 * plaintext and a new endpoint's signing secret are returned in exactly one
 * response, so these dialogs keep themselves open after the create call and show
 * the value once, with a copy affordance and a plain warning that it will not be
 * shown again. Editing an endpoint never re-reveals its secret — the server has
 * none to give.
 */

import { useEffect, useState } from "react"

import { Check, Copy, KeyRound, Webhook } from "lucide-react"

import { Alert, AlertDescription } from "@/components/ui/alert"

import { Button } from "@/components/ui/button"

import { Checkbox } from "@/components/ui/checkbox"

import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

import { Field } from "@/components/field"

import { Input } from "@/components/ui/input"

import { useSave } from "@/features/organization/use-save"

import { integrationsApi } from "@/lib/integrations-api"

import {
  API_KEY_LABEL_MAX,
  API_KEY_TTL_DAYS_MAX,
  WEBHOOK_EVENTS,
  WEBHOOK_EVENT_DESCRIPTIONS,
  WEBHOOK_EVENT_LABELS,
  WEBHOOK_URL_MAX,
  type ApiKeyView,
  type WebhookEndpointView,
  type WebhookEvent,
} from "@shared/integrations"

function useCopy() {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return

    const timer = setTimeout(() => setCopied(false), 1800)

    return () => clearTimeout(timer)
  }, [copied])

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value)

      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return { copied, copy }
}

/** Reveal a once-only secret with a copy button and a warning that it is last seen. */

function SecretReveal({ value }: { value: string }) {
  const { copied, copy } = useCopy()

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 p-2">
        <code className="min-w-0 flex-1 truncate font-mono text-[12px] text-foreground">
          {value}
        </code>
        <Button variant="outline" size="sm" onClick={() => void copy(value)}>
          {copied ? (
            <>
              <Check size={13} />
              Copied
            </>
          ) : (
            <>
              <Copy size={13} />
              Copy
            </>
          )}
        </Button>
      </div>
      <Alert variant="pending">
        <AlertDescription>
          This value is shown once and cannot be retrieved later. Store it now,
          or revoke and issue a fresh one.
        </AlertDescription>
      </Alert>
    </div>
  )
}

// --- API keys --------------------------------------------------------------

interface CreateApiKeyDialogProps {
  open: boolean

  onOpenChange: (open: boolean) => void

  onCreated: () => void
}

export function CreateApiKeyDialog({
  open,

  onOpenChange,

  onCreated,
}: CreateApiKeyDialogProps) {
  const [label, setLabel] = useState("")

  const [ttlDays, setTtlDays] = useState("")

  const [token, setToken] = useState<string | null>(null)

  const [invalid, setInvalid] = useState<Record<string, string>>({})

  const save = useSave()

  useEffect(() => {
    if (!open) return

    setLabel("")

    setTtlDays("")

    setToken(null)

    setInvalid({})

    save.clear()

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  async function create() {
    const errors: Record<string, string> = {}

    const trimmed = label.trim()

    if (trimmed === "") errors.label = "Give the key a label."
    else if (trimmed.length > API_KEY_LABEL_MAX)
      errors.label = `Use ${API_KEY_LABEL_MAX} characters or fewer.`

    const raw = ttlDays.trim()

    let days: number | undefined

    if (raw !== "") {
      const parsed = Number(raw)

      if (
        !Number.isSafeInteger(parsed) ||
        parsed < 1 ||
        parsed > API_KEY_TTL_DAYS_MAX
      ) {
        errors.ttlDays = `Use a lifetime between 1 and ${API_KEY_TTL_DAYS_MAX} days, or leave blank.`
      } else {
        days = parsed
      }
    }

    if (Object.keys(errors).length > 0) {
      setInvalid(errors)

      return
    }

    setInvalid({})

    await save.run(async () => {
      const result = await integrationsApi.createApiKey({
        label: trimmed,

        ttlDays: days ?? null,
      })

      setToken(result.token)

      onCreated()
    })
  }

  const errorFor = (key: string) => invalid[key] ?? save.fields[key]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[32rem]">
        <DialogHeader>
          <DialogTitle>New API key</DialogTitle>
          <DialogDescription>
            {token
              ? "Copy the key now — this is the only time it is shown."
              : "Issue a bearer key for the read-only open surface. It authenticates only its own workspace."}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-3">
          {save.error ? (
            <Alert variant="danger">
              <AlertDescription>{save.error}</AlertDescription>
            </Alert>
          ) : null}

          {token === null ? (
            <>
              <Field
                label="Label"
                htmlFor="key-label"
                required
                hint="So you can recognise which integration uses it."
                error={errorFor("label")}
              >
                <Input
                  id="key-label"
                  value={label}
                  maxLength={API_KEY_LABEL_MAX}
                  onChange={(event) => {
                    setLabel(event.target.value)

                    setInvalid({})

                    save.clear()
                  }}
                />
              </Field>

              <Field
                label="Lifetime (days, optional)"
                htmlFor="key-ttl"
                hint="Leave blank for a key that does not expire on its own."
                error={errorFor("ttlDays")}
              >
                <Input
                  id="key-ttl"
                  type="number"
                  min={1}
                  max={API_KEY_TTL_DAYS_MAX}
                  step={1}
                  inputMode="numeric"
                  value={ttlDays}
                  onChange={(event) => {
                    setTtlDays(event.target.value)

                    setInvalid({})

                    save.clear()
                  }}
                />
              </Field>
            </>
          ) : (
            <SecretReveal value={token} />
          )}
        </DialogBody>

        <DialogFooter>
          {token === null ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={() => void create()} disabled={save.saving}>
                <KeyRound size={13} />
                {save.saving ? "Issuing…" : "Create key"}
              </Button>
            </>
          ) : (
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface RevokeApiKeyDialogProps {
  apiKey: ApiKeyView

  onClose: () => void

  onRevoked: () => void
}

export function RevokeApiKeyDialog({
  apiKey,

  onClose,

  onRevoked,
}: RevokeApiKeyDialogProps) {
  const [error, setError] = useState<string | null>(null)

  const [saving, setSaving] = useState(false)

  async function revoke() {
    setSaving(true)

    setError(null)

    try {
      await integrationsApi.revokeApiKey(apiKey.id)

      onRevoked()

      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not revoke.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[28rem]">
        <DialogHeader>
          <DialogTitle>Revoke “{apiKey.label}”?</DialogTitle>
          <DialogDescription>
            The key stops authenticating immediately. The record stays in the
            list for the audit trail; nothing that already happened is undone.
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          {error ? (
            <Alert variant="danger">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => void revoke()}
            disabled={saving}
          >
            {saving ? "Revoking…" : "Revoke key"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// --- Webhook endpoints -----------------------------------------------------

interface EndpointFormDialogProps {
  open: boolean

  onOpenChange: (open: boolean) => void

  endpoint: WebhookEndpointView | null

  onSaved: () => void
}

export function EndpointFormDialog({
  open,

  onOpenChange,

  endpoint,

  onSaved,
}: EndpointFormDialogProps) {
  const editing = endpoint !== null

  const [url, setUrl] = useState("")

  const [events, setEvents] = useState<WebhookEvent[]>([])

  const [secret, setSecret] = useState<string | null>(null)

  const [invalid, setInvalid] = useState<Record<string, string>>({})

  const save = useSave()

  useEffect(() => {
    if (!open) return

    setUrl(endpoint?.url ?? "")

    setEvents(endpoint?.events ?? [])

    setSecret(null)

    setInvalid({})

    save.clear()

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, endpoint?.id])

  function toggleEvent(event: WebhookEvent, checked: boolean) {
    setEvents((current) =>
      checked
        ? current.includes(event)
          ? current
          : [...current, event]
        : current.filter((entry) => entry !== event),
    )

    setInvalid({})

    save.clear()
  }

  async function submit() {
    const errors: Record<string, string> = {}

    const trimmed = url.trim()

    if (trimmed === "") errors.url = "Where should we POST these events?"
    else if (trimmed.length > WEBHOOK_URL_MAX)
      errors.url = `Use ${WEBHOOK_URL_MAX} characters or fewer.`
    else if (!/^https?:\/\//i.test(trimmed))
      errors.url = "The URL must start with http:// or https://."

    if (events.length === 0) errors.events = "Pick at least one event."

    if (Object.keys(errors).length > 0) {
      setInvalid(errors)

      return
    }

    setInvalid({})

    await save.run(async () => {
      if (editing && endpoint) {
        await integrationsApi.updateEndpoint(endpoint.id, {
          url: trimmed,

          events,
        })

        onSaved()
      } else {
        const result = await integrationsApi.createEndpoint({
          url: trimmed,

          events,
        })

        setSecret(result.endpoint.secret)

        onSaved()
      }
    })
  }

  const errorFor = (key: string) => invalid[key] ?? save.fields[key]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[34rem]">
        <DialogHeader>
          <DialogTitle>
            {editing ? "Edit endpoint" : "New webhook endpoint"}
          </DialogTitle>
          <DialogDescription>
            {secret
              ? "Copy the signing secret now — it is only shown at creation."
              : editing
                ? "Change the target or the events. The signing secret does not change and is not shown again."
                : "Each event POSTs a real request here. We sign it with HMAC-SHA256 in the X-DeedOrbit-Signature header."}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-3">
          {save.error ? (
            <Alert variant="danger">
              <AlertDescription>{save.error}</AlertDescription>
            </Alert>
          ) : null}

          {secret === null ? (
            <>
              <Field
                label="Endpoint URL"
                htmlFor="endpoint-url"
                required
                error={errorFor("url")}
              >
                <Input
                  id="endpoint-url"
                  value={url}
                  maxLength={WEBHOOK_URL_MAX}
                  placeholder="https://example.com/hooks/deedorbit"
                  onChange={(event) => {
                    setUrl(event.target.value)

                    setInvalid({})

                    save.clear()
                  }}
                />
              </Field>

              <Field
                label="Events"
                htmlFor="endpoint-events"
                error={errorFor("events")}
              >
                <div className="flex flex-col gap-2 rounded-md border border-border p-2.5">
                  {WEBHOOK_EVENTS.map((event) => {
                    const checked = events.includes(event)

                    return (
                      <label
                        key={event}
                        htmlFor={`event-${event}`}
                        className="flex cursor-pointer items-start gap-2.5"
                      >
                        <Checkbox
                          id={`event-${event}`}
                          className="mt-0.5"
                          checked={checked}
                          onCheckedChange={(next) =>
                            toggleEvent(event, next === true)
                          }
                        />
                        <span className="min-w-0">
                          <span className="block text-[12.5px] font-medium text-foreground">
                            {WEBHOOK_EVENT_LABELS[event]}
                          </span>
                          <span className="block text-[11.5px] text-muted-foreground">
                            {WEBHOOK_EVENT_DESCRIPTIONS[event]}
                          </span>
                        </span>
                      </label>
                    )
                  })}
                </div>
              </Field>
            </>
          ) : (
            <SecretReveal value={secret} />
          )}
        </DialogBody>

        <DialogFooter>
          {secret === null ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={() => void submit()} disabled={save.saving}>
                <Webhook size={13} />
                {save.saving
                  ? "Saving…"
                  : editing
                    ? "Save changes"
                    : "Create endpoint"}
              </Button>
            </>
          ) : (
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
