/**
 * Send an envelope and hand out its signing links.
 *
 * Sending mints a fresh per-envelope token; the row keeps only its digest, so
 * the plaintext links appear here once and nowhere else. A re-send rotates the
 * token — the old links stop resolving — which is why this dialog sends on the
 * user's click rather than on open, and re-reads the links after each send.
 */

import { useEffect, useState } from "react"

import { Check, Copy, Send } from "lucide-react"

import { Alert, AlertDescription } from "@/components/ui/alert"

import { Button } from "@/components/ui/button"

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

import { signaturesApi } from "@/lib/signatures-api"

import {
  ENVELOPE_TTL_DAYS_MAX,
  type EnvelopeSigningLink,
  type EnvelopeView,
} from "@shared/signatures"

interface SendEnvelopeDialogProps {
  open: boolean

  onOpenChange: (open: boolean) => void

  envelope: EnvelopeView

  onSent: () => void
}

function absoluteLink(path: string): string {
  const base = window.location.href.split("#")[0]

  return `${base}#${path}`
}

export function SendEnvelopeDialog({
  open,

  onOpenChange,

  envelope,

  onSent,
}: SendEnvelopeDialogProps) {
  const [ttlDays, setTtlDays] = useState("")

  const [invalid, setInvalid] = useState<Record<string, string>>({})

  const [links, setLinks] = useState<EnvelopeSigningLink[] | null>(null)

  const [copied, setCopied] = useState<string | null>(null)

  const save = useSave()

  useEffect(() => {
    if (!open) return

    setTtlDays("")

    setInvalid({})

    setLinks(null)

    setCopied(null)

    save.clear()

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, envelope.id])

  async function send() {
    const errors: Record<string, string> = {}

    const raw = ttlDays.trim()

    let days: number | undefined

    if (raw !== "") {
      const parsed = Number(raw)

      if (
        !Number.isSafeInteger(parsed) ||
        parsed < 1 ||
        parsed > ENVELOPE_TTL_DAYS_MAX
      ) {
        errors.ttlDays = `Use 1-${ENVELOPE_TTL_DAYS_MAX} days, or leave blank.`
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
      const result = await signaturesApi.sendEnvelope(envelope.id, days)

      // The links reveal here, once; the dialog stays open so they can be

      // copied. `onSent` refreshes the hub behind it.

      setLinks(result.links)

      onSent()
    })
  }

  async function copy(link: EnvelopeSigningLink) {
    const url = absoluteLink(link.path)

    try {
      await navigator.clipboard.writeText(url)

      setCopied(link.recipientId)
    } catch {
      setCopied(null)
    }
  }

  const errorFor = (key: string) => invalid[key] ?? save.fields[key]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[40rem]">
        <DialogHeader>
          <DialogTitle>
            {links ? "Signing links" : `Send “${envelope.title}”`}
          </DialogTitle>
          <DialogDescription>
            {links
              ? "These links appear once. Each signer opens their own; the token is never shown again."
              : "Mints the signing token and opens the recipients' links. You can set how long they stay valid."}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-3">
          {save.error ? (
            <Alert variant="danger">
              <AlertDescription>{save.error}</AlertDescription>
            </Alert>
          ) : null}

          {links === null ? (
            <>
              {envelope.status === "sent" ? (
                <Alert variant="pending">
                  <AlertDescription>
                    Re-sending rotates the token: the links already issued will
                    stop working, and unsigned signers reset to “not opened”.
                  </AlertDescription>
                </Alert>
              ) : null}

              <Field
                label="Link window (days, optional)"
                htmlFor="send-ttl"
                hint="Leave blank for a link that never expires."
                error={errorFor("ttlDays")}
              >
                <Input
                  id="send-ttl"
                  type="number"
                  min={1}
                  max={ENVELOPE_TTL_DAYS_MAX}
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
            <div className="flex flex-col gap-2">
              {links.length === 0 ? (
                <p className="text-[12.5px] text-muted-foreground">
                  This envelope has no signers to link.
                </p>
              ) : (
                links.map((link) => (
                  <div
                    key={link.recipientId}
                    className="flex items-center justify-between gap-2 rounded-md border border-border p-2"
                  >
                    <div className="min-w-0">
                      <p className="text-[12.5px] font-medium text-foreground">
                        {link.name}
                      </p>
                      <p className="truncate font-mono text-[11px] text-muted-foreground">
                        {absoluteLink(link.path)}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void copy(link)}
                    >
                      {copied === link.recipientId ? (
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
                ))
              )}
            </div>
          )}
        </DialogBody>

        <DialogFooter>
          {links === null ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={() => void send()} disabled={save.saving}>
                <Send size={13} />
                {save.saving
                  ? "Sending…"
                  : envelope.status === "sent"
                    ? "Re-send (new links)"
                    : "Send for signing"}
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
