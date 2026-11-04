/**
 * The signatures hub — envelopes and templates in one place.
 *
 * Envelopes read down their own chain: how many signers have signed, and each
 * recipient's state. Sending is handed to the send dialog (a signing token is
 * minted there and shown once); voiding is captured with a reason so the file
 * trail says why a link died. Templates are the boilerplate behind envelopes —
 * editing text takes `edit`, but releasing one that will go out under the
 * tenant's name is a decision, so it takes `approve`.
 */

import { useMemo, useState } from "react"

import {
  Archive,
  Ban,
  ClipboardList,
  FileSignature,
  Pencil,
  PenLine,
  Plus,
  Send,
  ShieldCheck,
} from "lucide-react"

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

import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

import { EmptyState } from "@/components/empty-state"

import { Field } from "@/components/field"

import { PageHeader } from "@/components/page-header"

import { Skeleton } from "@/components/ui/skeleton"

import { StatCard } from "@/components/stat-card"

import { Textarea } from "@/components/ui/textarea"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

import { EnvelopeCreateDialog } from "@/features/signatures/envelope-create-dialog"

import { SendEnvelopeDialog } from "@/features/signatures/send-envelope-dialog"

import { TemplateFormDialog } from "@/features/signatures/template-dialog"

import {
  envelopeStatusTone,
  recipientStatusTone,
  templateStatusTone,
} from "@/features/signatures/signatures-bits"

import { signaturesApi } from "@/lib/signatures-api"

import { formatDate, orDash } from "@/lib/format"

import { useSession } from "@/lib/session-context"

import { useAsyncResource } from "@/lib/use-async-resource"

import type { DocTemplateView, EnvelopeView } from "@shared/signatures"

const SENDABLE = ["draft", "sent", "expired"]

export function SignaturesPage() {
  const session = useSession()

  const canView = session.can("signatures", "view")

  const canCreate = session.can("signatures", "create")

  const canEdit = session.can("signatures", "edit")

  const canApprove = session.can("signatures", "approve")

  const envelopes = useAsyncResource(
    (signal) => signaturesApi.listEnvelopes(signal),

    canView,
  )

  const templates = useAsyncResource(
    (signal) => signaturesApi.listTemplates(signal),

    canView,
  )

  const [tab, setTab] = useState("envelopes")

  const [creatingEnvelope, setCreatingEnvelope] = useState(false)

  const [sendTarget, setSendTarget] = useState<EnvelopeView | null>(null)

  const [voidTarget, setVoidTarget] = useState<EnvelopeView | null>(null)

  const [creatingTemplate, setCreatingTemplate] = useState(false)

  const [editTemplate, setEditTemplate] = useState<DocTemplateView | null>(null)

  const envelopeRows = envelopes.data?.envelopes ?? []

  const templateRows = useMemo(
    () => templates.data?.templates ?? [],

    [templates.data],
  )

  const awaiting = envelopeRows.filter(
    (row) => row.status === "sent" && row.live,
  ).length

  const completed = envelopeRows.filter(
    (row) => row.status === "completed",
  ).length

  async function templateAction(mutate: () => Promise<unknown>): Promise<void> {
    await mutate()

    await templates.reload()
  }

  if (!canView) {
    return (
      <EmptyState
        icon={PenLine}
        title="Signatures is not available to your role"
        description="Ask a workspace administrator for the signatures grant."
        tone="pending"
      />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Documents & Signatures"
        description="An in-app signing ceremony, audited per signer. When everyone has signed, the agreement is filed back into the document trail."
        actions={
          <>
            {tab === "templates" && canCreate ? (
              <Button size="sm" onClick={() => setCreatingTemplate(true)}>
                <Plus size={14} />
                New template
              </Button>
            ) : null}
            {tab === "envelopes" && canCreate ? (
              <Button size="sm" onClick={() => setCreatingEnvelope(true)}>
                <Plus size={14} />
                New envelope
              </Button>
            ) : null}
          </>
        }
        tabs={
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="envelopes">
                <FileSignature size={13} />
                Envelopes
              </TabsTrigger>
              <TabsTrigger value="templates">
                <ClipboardList size={13} />
                Templates
              </TabsTrigger>
            </TabsList>
          </Tabs>
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <StatCard
          label="Awaiting signatures"
          value={envelopes.loading ? undefined : awaiting}
          hint="Live envelopes with an unsigned chain"
          icon={Send}
        />
        <StatCard
          label="Completed"
          value={envelopes.loading ? undefined : completed}
          hint="Fully signed and filed as an agreement"
          icon={ShieldCheck}
        />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsContent value="envelopes" className="mt-0">
          <Card>
            <CardHeader>
              <CardTitle>Envelopes</CardTitle>
              <CardDescription>
                Each row shows its signing chain. A completed agreement is
                written into the project's documents.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 py-2">
              {envelopes.loading && !envelopes.data ? (
                <Skeleton className="h-40 w-full" />
              ) : envelopes.error ? (
                <Alert variant="danger">
                  <AlertDescription>{envelopes.error}</AlertDescription>
                </Alert>
              ) : envelopeRows.length === 0 ? (
                <EmptyState
                  icon={FileSignature}
                  size="sm"
                  title="No envelopes yet"
                  description="Raise one to send a document out for signature."
                  action={
                    canCreate ? (
                      <Button
                        size="sm"
                        onClick={() => setCreatingEnvelope(true)}
                      >
                        <Plus size={14} />
                        New envelope
                      </Button>
                    ) : undefined
                  }
                />
              ) : (
                envelopeRows.map((row) => (
                  <EnvelopeRow
                    key={row.id}
                    envelope={row}
                    canEdit={canEdit}
                    onSend={() => setSendTarget(row)}
                    onVoid={() => setVoidTarget(row)}
                  />
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="templates" className="mt-0">
          <Card>
            <CardHeader>
              <CardTitle>Templates</CardTitle>
              <CardDescription>
                Boilerplate with merge fields. Release needs the approve grant;
                only a released template can start an envelope.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col py-1">
              {templates.loading && !templates.data ? (
                <Skeleton className="h-40 w-full" />
              ) : templates.error ? (
                <Alert variant="danger">
                  <AlertDescription>{templates.error}</AlertDescription>
                </Alert>
              ) : templateRows.length === 0 ? (
                <EmptyState
                  icon={ClipboardList}
                  size="sm"
                  title="No templates yet"
                  description="Create boilerplate to draw envelopes from."
                  action={
                    canCreate ? (
                      <Button
                        size="sm"
                        onClick={() => setCreatingTemplate(true)}
                      >
                        <Plus size={14} />
                        New template
                      </Button>
                    ) : undefined
                  }
                />
              ) : (
                templateRows.map((row) => (
                  <div
                    key={row.id}
                    className="flex items-center justify-between gap-3 border-b border-border py-2.5 last:border-b-0"
                  >
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 truncate text-[13px] font-medium text-foreground">
                        {row.name}
                        <Badge variant={templateStatusTone(row.status)}>
                          {row.status}
                        </Badge>
                      </p>
                      <p className="truncate text-[11.5px] text-muted-foreground">
                        {row.categoryLabel} · {row.tokens.length} merge{" "}
                        {row.tokens.length === 1 ? "field" : "fields"} ·{" "}
                        {orDash(row.createdBy)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {canEdit ? (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => setEditTemplate(row)}
                          aria-label={`Edit ${row.name}`}
                        >
                          <Pencil size={13} />
                        </Button>
                      ) : null}
                      {canApprove && row.status === "draft" ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            void templateAction(() =>
                              signaturesApi.releaseTemplate(row.id),
                            )
                          }
                        >
                          <ShieldCheck size={13} />
                          Release
                        </Button>
                      ) : null}
                      {canEdit && row.status !== "archived" ? (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() =>
                            void templateAction(() =>
                              signaturesApi.archiveTemplate(row.id),
                            )
                          }
                          aria-label={`Archive ${row.name}`}
                        >
                          <Archive size={13} />
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <EnvelopeCreateDialog
        open={creatingEnvelope}
        onOpenChange={setCreatingEnvelope}
        onCreated={() => {
          void envelopes.reload()
        }}
      />

      {sendTarget ? (
        <SendEnvelopeDialog
          open
          envelope={sendTarget}
          onOpenChange={(open) => {
            if (!open) setSendTarget(null)
          }}
          onSent={() => {
            void envelopes.reload()
          }}
        />
      ) : null}

      {voidTarget ? (
        <VoidEnvelopeDialog
          envelope={voidTarget}
          onClose={() => setVoidTarget(null)}
          onVoided={() => {
            void envelopes.reload()
          }}
        />
      ) : null}

      <TemplateFormDialog
        open={creatingTemplate || editTemplate !== null}
        template={editTemplate}
        onOpenChange={(open) => {
          if (!open) {
            setCreatingTemplate(false)

            setEditTemplate(null)
          }
        }}
        onSaved={() => {
          setCreatingTemplate(false)

          setEditTemplate(null)

          void templates.reload()
        }}
      />
    </div>
  )
}

interface EnvelopeRowProps {
  envelope: EnvelopeView

  canEdit: boolean

  onSend: () => void

  onVoid: () => void
}

function EnvelopeRow({ envelope, canEdit, onSend, onVoid }: EnvelopeRowProps) {
  const signers = envelope.recipients.filter((r) => r.role === "signer")

  const signedCount = signers.filter((r) => r.status === "signed").length

  return (
    <div className="flex flex-col gap-2 border-b border-border py-2.5 last:border-b-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 truncate text-[13px] font-medium text-foreground">
            {envelope.title}
            <Badge variant={envelopeStatusTone(envelope.status)}>
              {envelope.statusLabel}
            </Badge>
          </p>
          <p className="truncate text-[11.5px] text-muted-foreground">
            {signers.length > 0
              ? `${signedCount}/${signers.length} signed`
              : "No signers"}
            {envelope.templateName ? ` · ${envelope.templateName}` : ""} ·{" "}
            {orDash(envelope.createdBy)} · {formatDate(envelope.createdAt)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {canEdit && SENDABLE.includes(envelope.status) ? (
            <Button size="sm" variant="outline" onClick={onSend}>
              <Send size={13} />
              {envelope.status === "draft" ? "Send" : "Links"}
            </Button>
          ) : null}
          {canEdit &&
          envelope.status !== "completed" &&
          envelope.status !== "void" ? (
            <Button
              variant="danger-outline"
              size="sm"
              onClick={onVoid}
              aria-label={`Void ${envelope.title}`}
            >
              <Ban size={13} />
              Void
            </Button>
          ) : null}
        </div>
      </div>

      {envelope.recipients.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {envelope.recipients.map((recipient) => (
            <Badge
              key={recipient.id}
              variant={recipientStatusTone(recipient.status)}
            >
              {recipient.name} · {recipient.statusLabel}
            </Badge>
          ))}
        </div>
      ) : null}

      {envelope.completedDocumentId ? (
        <p className="text-[11px] text-success">
          Agreement filed to the project's documents.
        </p>
      ) : null}
    </div>
  )
}

interface VoidEnvelopeDialogProps {
  envelope: EnvelopeView

  onClose: () => void

  onVoided: () => void
}

function VoidEnvelopeDialog({
  envelope,

  onClose,

  onVoided,
}: VoidEnvelopeDialogProps) {
  const [reason, setReason] = useState("")

  const [saving, setSaving] = useState(false)

  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setSaving(true)

    setError(null)

    try {
      await signaturesApi.voidEnvelope(envelope.id, reason.trim() || undefined)

      onVoided()

      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not void.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[32rem]">
        <DialogHeader>
          <DialogTitle>Void this envelope?</DialogTitle>
          <DialogDescription>
            Voiding revokes every signing link. The chain stops here; a voided
            envelope is kept for the record, not deleted.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3">
          {error ? (
            <Alert variant="danger">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <Field label="Reason (optional)" htmlFor="void-reason">
            <Textarea
              id="void-reason"
              rows={2}
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => void submit()}
            disabled={saving}
          >
            {saving ? "Voiding…" : "Void envelope"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
