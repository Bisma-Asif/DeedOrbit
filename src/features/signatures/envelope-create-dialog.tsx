/**
 * Raise a draft envelope.
 *
 * An envelope carries its content — a released template rendered against the
 * merge values the sender supplies, or free text — and the chain of people who
 * must sign. Choosing a template never invents a value: an unresolved field
 * stays as `{{token}}` in the preview so the sender sees it and fixes it before
 * the link goes out. Sending happens after this, on the hub, because the signing
 * token is minted there and shown only once.
 */

import { useEffect, useMemo, useState } from "react"

import { Plus, Trash2 } from "lucide-react"

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

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

import { Textarea } from "@/components/ui/textarea"

import { useSave } from "@/features/organization/use-save"

import { projectsApi } from "@/lib/projects-api"

import { signaturesApi, type RecipientInput } from "@/lib/signatures-api"

import { useAsyncResource } from "@/lib/use-async-resource"

import {
  ENVELOPE_MESSAGE_MAX,
  ENVELOPE_TITLE_MAX,
  RECIPIENTS_MAX,
  extractTokens,
  type EnvelopeView,
  type RecipientRole,
} from "@shared/signatures"

interface EnvelopeCreateDialogProps {
  open: boolean

  onOpenChange: (open: boolean) => void

  onCreated: (envelope: EnvelopeView) => void
}

interface RecipientDraft {
  name: string

  email: string

  role: RecipientRole
}

interface EnvelopeDraft {
  title: string

  message: string

  templateId: string

  projectId: string

  body: string
}

function blankRecipient(): RecipientDraft {
  return { name: "", email: "", role: "signer" }
}

function emptyDraft(): EnvelopeDraft {
  return { title: "", message: "", templateId: "", projectId: "", body: "" }
}

export function EnvelopeCreateDialog({
  open,

  onOpenChange,

  onCreated,
}: EnvelopeCreateDialogProps) {
  const [draft, setDraft] = useState<EnvelopeDraft>(() => emptyDraft())

  const [recipients, setRecipients] = useState<RecipientDraft[]>(() => [
    blankRecipient(),
  ])

  const [mergeValues, setMergeValues] = useState<Record<string, string>>({})

  const [invalid, setInvalid] = useState<Record<string, string>>({})

  const save = useSave()

  const templates = useAsyncResource(
    (signal) => signaturesApi.listTemplates(signal),

    open,
  )

  const projects = useAsyncResource(
    (signal) => projectsApi.list(signal),

    open,
  )

  const activeTemplates = useMemo(
    () =>
      (templates.data?.templates ?? []).filter((t) => t.status === "active"),

    [templates.data],
  )

  const projectOptions = useMemo(
    () => projects.data?.projects ?? [],

    [projects.data],
  )

  const chosenTemplate = useMemo(
    () => activeTemplates.find((t) => t.id === draft.templateId) ?? null,

    [activeTemplates, draft.templateId],
  )

  const tokens = chosenTemplate ? extractTokens(chosenTemplate.body) : []

  useEffect(() => {
    if (!open) return

    setDraft(emptyDraft())

    setRecipients([blankRecipient()])

    setMergeValues({})

    setInvalid({})

    save.clear()

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function setField<K extends keyof EnvelopeDraft>(
    key: K,

    value: EnvelopeDraft[K],
  ) {
    setDraft((current) => ({ ...current, [key]: value }))

    setInvalid((current) => {
      if (!(key in current)) return current

      const next = { ...current }

      delete next[key]

      return next
    })

    save.clear()
  }

  function setRecipient(index: number, patch: Partial<RecipientDraft>) {
    setRecipients((current) =>
      current.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    )

    save.clear()
  }

  function addRecipient() {
    setRecipients((current) =>
      current.length >= RECIPIENTS_MAX
        ? current
        : [...current, blankRecipient()],
    )
  }

  function removeRecipient(index: number) {
    setRecipients((current) =>
      current.length <= 1 ? current : current.filter((_, i) => i !== index),
    )
  }

  const preview = chosenTemplate
    ? chosenTemplate.body.replace(
        /\{\{\s*([\w.]+)\s*\}\}/g,

        (whole, key: string) => mergeValues[key]?.trim() || whole,
      )
    : draft.body

  async function submit() {
    const errors: Record<string, string> = {}

    if (draft.title.trim() === "") errors.title = "Give this envelope a title."

    if (recipients.length < 1) {
      errors.recipients = "Add at least one recipient."
    } else if (!recipients.some((r) => r.role === "signer")) {
      errors.recipients = "At least one recipient must be a signer."
    }

    if (!chosenTemplate && draft.body.trim() === "") {
      errors.body = "Add text or choose a template."
    }

    if (Object.keys(errors).length > 0) {
      setInvalid(errors)

      return
    }

    setInvalid({})

    const payloadRecipients: RecipientInput[] = recipients.map(
      (row, index) => ({
        name: row.name.trim(),

        email: row.email.trim(),

        role: row.role,

        signOrder: index + 1,
      }),
    )

    const done = await save.run(async () => {
      const result = await signaturesApi.createEnvelope({
        title: draft.title.trim(),

        message: draft.message.trim() || null,

        templateId: chosenTemplate?.id ?? null,

        projectId: draft.projectId || null,

        body: chosenTemplate ? undefined : draft.body,

        mergeValues: chosenTemplate ? mergeValues : undefined,

        recipients: payloadRecipients,
      })

      onCreated(result.envelope)
    })

    if (done) onOpenChange(false)
  }

  const errorFor = (key: string) => invalid[key] ?? save.fields[key]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[46rem]">
        <DialogHeader>
          <DialogTitle>New envelope</DialogTitle>
          <DialogDescription>
            Choose what is being signed and who signs it. The signing links are
            minted when you send, from the hub.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-3">
          {save.error ? (
            <Alert variant="danger">
              <AlertDescription>{save.error}</AlertDescription>
            </Alert>
          ) : null}

          {errorFor("recipients") ? (
            <Alert variant="danger">
              <AlertDescription>{errorFor("recipients")}</AlertDescription>
            </Alert>
          ) : null}

          <Field
            label="Title"
            htmlFor="envelope-title"
            required
            error={errorFor("title")}
          >
            <Input
              id="envelope-title"
              maxLength={ENVELOPE_TITLE_MAX}
              value={draft.title}
              onChange={(event) => setField("title", event.target.value)}
            />
          </Field>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Template (optional)" htmlFor="envelope-template">
              <Select
                value={draft.templateId || "__none"}
                onValueChange={(value) =>
                  setField("templateId", value === "__none" ? "" : value)
                }
              >
                <SelectTrigger id="envelope-template">
                  <SelectValue placeholder="Free text" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">Write the text below</SelectItem>
                  {activeTemplates.map((template) => (
                    <SelectItem key={template.id} value={template.id}>
                      {template.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Project (optional)" htmlFor="envelope-project">
              <Select
                value={draft.projectId || "__none"}
                onValueChange={(value) =>
                  setField("projectId", value === "__none" ? "" : value)
                }
              >
                <SelectTrigger id="envelope-project">
                  <SelectValue placeholder="No project" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">No project</SelectItem>
                  {projectOptions.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <Field
            label="Message to signers (optional)"
            htmlFor="envelope-message"
            error={errorFor("message")}
          >
            <Textarea
              id="envelope-message"
              rows={2}
              maxLength={ENVELOPE_MESSAGE_MAX}
              value={draft.message}
              onChange={(event) => setField("message", event.target.value)}
            />
          </Field>

          {chosenTemplate ? (
            tokens.length > 0 ? (
              <div className="flex flex-col gap-2 rounded-md border border-border p-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  Merge fields
                </p>
                {tokens.map((token) => (
                  <Field
                    key={token}
                    label={token}
                    htmlFor={`merge-${token}`}
                    hint="Blank leaves the field unresolved in the document."
                  >
                    <Input
                      id={`merge-${token}`}
                      value={mergeValues[token] ?? ""}
                      onChange={(event) =>
                        setMergeValues((current) => ({
                          ...current,

                          [token]: event.target.value,
                        }))
                      }
                    />
                  </Field>
                ))}
              </div>
            ) : (
              <p className="text-[12px] text-muted-foreground">
                This template has no merge fields.
              </p>
            )
          ) : (
            <Field
              label="Document text"
              htmlFor="envelope-body"
              required
              error={errorFor("body")}
            >
              <Textarea
                id="envelope-body"
                rows={8}
                value={draft.body}
                onChange={(event) => setField("body", event.target.value)}
              />
            </Field>
          )}

          {preview.trim() !== "" ? (
            <div className="flex flex-col gap-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                Preview
              </p>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/40 p-2.5 text-[11.5px] leading-5 text-foreground">
                {preview}
              </pre>
            </div>
          ) : null}

          <div className="flex flex-col gap-2 border-t border-border pt-3">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                Recipients (in signing order)
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={addRecipient}
                disabled={recipients.length >= RECIPIENTS_MAX}
              >
                <Plus size={13} />
                Add
              </Button>
            </div>

            {recipients.map((row, index) => (
              <div key={index} className="flex items-end gap-2">
                <Field
                  label="Name"
                  htmlFor={`rcp-name-${index}`}
                  className="flex-1"
                  error={
                    invalid[`recipient${index}Name`] ??
                    save.fields[`recipient${index}Name`]
                  }
                >
                  <Input
                    id={`rcp-name-${index}`}
                    value={row.name}
                    onChange={(event) =>
                      setRecipient(index, { name: event.target.value })
                    }
                  />
                </Field>

                <Field
                  label="Email"
                  htmlFor={`rcp-email-${index}`}
                  className="flex-1"
                  error={
                    invalid[`recipient${index}Email`] ??
                    save.fields[`recipient${index}Email`]
                  }
                >
                  <Input
                    id={`rcp-email-${index}`}
                    type="email"
                    value={row.email}
                    onChange={(event) =>
                      setRecipient(index, { email: event.target.value })
                    }
                  />
                </Field>

                <Field label="Role" htmlFor={`rcp-role-${index}`}>
                  <Select
                    value={row.role}
                    onValueChange={(value) =>
                      setRecipient(index, { role: value as RecipientRole })
                    }
                  >
                    <SelectTrigger id={`rcp-role-${index}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="signer">Signer</SelectItem>

                      <SelectItem value="cc">Copy only</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>

                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => removeRecipient(index)}
                  disabled={recipients.length <= 1}
                  aria-label={`Remove recipient ${index + 1}`}
                >
                  <Trash2 size={13} />
                </Button>
              </div>
            ))}
          </div>
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={save.saving}>
            {save.saving ? "Creating…" : "Create draft"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
