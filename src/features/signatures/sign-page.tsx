/**
 * The public signing ceremony — `/sign/:token?recipientId=…`.
 *
 * This screen runs with no session and outside the app shell: a recipient is
 * authorised by the token in their link alone. It shows only what that recipient
 * needs — the rendered agreement, their place in the chain, and the others'
 * names and states — never another signer's token or the workspace's records.
 *
 * Signing records the name the person types, the instant, and their IP; that is
 * the whole of what this is. It is an honest event log, not a certificate, and
 * it says so. When the last signer signs, the envelope completes and the
 * agreement is filed back into the workspace's document trail.
 */

import { useState } from "react"

import { Building2, Check, PenLine, X } from "lucide-react"

import { brand } from "@/config/brand"

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

import { Field } from "@/components/field"

import { Input } from "@/components/ui/input"

import { Skeleton } from "@/components/ui/skeleton"

import { Textarea } from "@/components/ui/textarea"

import { recipientStatusTone } from "@/features/signatures/signatures-bits"

import { signaturesApi } from "@/lib/signatures-api"

import { formatDateTime } from "@/lib/format"

import { useAsyncResource } from "@/lib/use-async-resource"

interface SignPageProps {
  token: string

  recipientId: string
}

export function SignPage({ token, recipientId }: SignPageProps) {
  const resource = useAsyncResource(
    (signal) => signaturesApi.readCeremony(token, recipientId, signal),

    token !== "" && recipientId !== "",
  )

  const [fullName, setFullName] = useState("")

  const [note, setNote] = useState("")

  const [busy, setBusy] = useState<"sign" | "decline" | null>(null)

  const [error, setError] = useState<string | null>(null)

  const [confirmation, setConfirmation] = useState<string | null>(null)

  const ceremony = resource.data

  async function act(action: "sign" | "decline") {
    if (!ceremony) return

    setBusy(action)

    setError(null)

    try {
      const result = await signaturesApi.actOnCeremony(token, {
        recipientId: ceremony.me.recipientId,

        action,

        fullName: fullName.trim(),

        message: note.trim() || undefined,
      })

      setConfirmation(
        action === "decline"
          ? "You have declined to sign."
          : result.status === "completed"
            ? "Signed. That was the last signature — the agreement is complete and filed."
            : "Signed. Waiting on the remaining signers.",
      )

      await resource.reload()
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not record that.",
      )
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="min-h-dvh bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-4 py-3">
          <span className="flex size-7 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground">
            <Building2 size={15} />
          </span>
          <span className="text-[13px] font-semibold tracking-tight text-foreground">
            {brand.name} — Secure signing
          </span>
        </div>
      </header>

      <main className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-8">
        {token === "" || recipientId === "" ? (
          <EmptyState
            icon={PenLine}
            title="This signing link is incomplete"
            description="A signing link carries both a token and your recipient id. Open the full link from your invitation."
            tone="danger"
          />
        ) : resource.loading && !ceremony ? (
          <div className="flex flex-col gap-4">
            <Skeleton className="h-10 w-2/3" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : resource.error || !ceremony ? (
          <EmptyState
            icon={PenLine}
            title="That signing link is not valid"
            description="It may have been voided or re-sent. Ask the sender to share a fresh link."
            tone="danger"
          />
        ) : (
          <>
            <div>
              <h1 className="text-[20px] font-semibold tracking-tight text-foreground">
                {ceremony.envelope.title}
              </h1>
              <p className="mt-1 text-[12.5px] text-muted-foreground">
                You are signing as{" "}
                <span className="font-medium text-foreground">
                  {ceremony.me.name}
                </span>{" "}
                · #{ceremony.envelope.signOrder} in the chain
              </p>
            </div>

            {confirmation ? (
              <Alert variant="success">
                <AlertDescription>{confirmation}</AlertDescription>
              </Alert>
            ) : null}

            {error ? (
              <Alert variant="danger">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}

            {ceremony.envelope.status === "expired" ? (
              <Alert variant="pending">
                <AlertDescription>
                  This signing link has expired. Ask the sender to re-send.
                </AlertDescription>
              </Alert>
            ) : null}

            {ceremony.envelope.status === "void" ? (
              <Alert variant="danger">
                <AlertDescription>
                  This envelope has been voided; nothing can be signed on it.
                </AlertDescription>
              </Alert>
            ) : null}

            {ceremony.envelope.message ? (
              <Card>
                <CardContent className="py-3 text-[13px] leading-6 text-foreground">
                  {ceremony.envelope.message}
                </CardContent>
              </Card>
            ) : null}

            <Card>
              <CardHeader>
                <CardTitle>The document</CardTitle>
                <CardDescription>
                  Read this before you sign. Signing records your typed name,
                  the time, and your address.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/40 p-4 text-[12.5px] leading-6 text-foreground">
                  {ceremony.envelope.body}
                </pre>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Signing chain</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2 py-2">
                {ceremony.chain.map((recipient) => (
                  <div
                    key={recipient.id}
                    className="flex items-center justify-between gap-2 border-b border-border py-1.5 last:border-b-0"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[12.5px] font-medium text-foreground">
                        {recipient.name}
                        {recipient.id === ceremony.me.recipientId ? (
                          <span className="ml-1 text-[11px] text-muted-foreground">
                            (you)
                          </span>
                        ) : null}
                        {recipient.role === "cc" ? (
                          <span className="ml-1 text-[11px] text-muted-foreground">
                            · copy only
                          </span>
                        ) : null}
                      </p>
                      {recipient.signedAt ? (
                        <p className="text-[11px] text-muted-foreground">
                          {recipient.signedName ?? recipient.name} signed{" "}
                          {formatDateTime(recipient.signedAt)}
                        </p>
                      ) : null}
                    </div>
                    <Badge variant={recipientStatusTone(recipient.status)}>
                      {recipient.statusLabel}
                    </Badge>
                  </div>
                ))}
              </CardContent>
            </Card>

            {ceremony.canSign ? (
              <Card>
                <CardHeader>
                  <CardTitle>Sign</CardTitle>
                  <CardDescription>
                    Type your full legal name exactly as you wish it recorded.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3 py-3">
                  <Field label="Full name" htmlFor="sign-name" required>
                    <Input
                      id="sign-name"
                      value={fullName}
                      onChange={(event) => setFullName(event.target.value)}
                    />
                  </Field>

                  <Field
                    label="Message (optional)"
                    htmlFor="sign-note"
                    hint="Recorded with a decline as your reason."
                  >
                    <Textarea
                      id="sign-note"
                      rows={2}
                      maxLength={500}
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                    />
                  </Field>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      onClick={() => void act("sign")}
                      disabled={busy !== null || fullName.trim() === ""}
                    >
                      <Check size={14} />
                      {busy === "sign" ? "Recording…" : "Sign"}
                    </Button>
                    <Button
                      variant="danger-outline"
                      onClick={() => void act("decline")}
                      disabled={busy !== null || fullName.trim() === ""}
                    >
                      <X size={14} />
                      {busy === "decline" ? "Recording…" : "Decline"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : ceremony.me.role === "cc" ? (
              <p className="text-[12.5px] text-muted-foreground">
                You are a copy recipient — no signature is required from you.
              </p>
            ) : ceremony.me.status === "signed" ? (
              <p className="text-[12.5px] text-success">
                You have already signed this document.
              </p>
            ) : null}
          </>
        )}
      </main>
    </div>
  )
}
