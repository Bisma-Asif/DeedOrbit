/**
 * New / edit a document template.
 *
 * A template is boilerplate with `{{token}}` merge fields. The token list is
 * reported from the body as it is typed — the preview never resolves a value,
 * exactly like the communications preview — because the sender supplies those
 * when they build an envelope. Status moves (release, archive) live on the hub,
 * since releasing a template that will go out under the tenant's name is a
 * decision that takes the `approve` grant, not a text edit.
 */

import { useEffect, useMemo, useState } from "react"

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

import { signaturesApi } from "@/lib/signatures-api"

import {
  TEMPLATE_BODY_MAX,
  TEMPLATE_CATEGORIES,
  TEMPLATE_CATEGORY_LABELS,
  TEMPLATE_NAME_MAX,
  extractTokens,
  type DocTemplateView,
  type TemplateCategory,
} from "@shared/signatures"

interface TemplateFormDialogProps {
  open: boolean

  onOpenChange: (open: boolean) => void

  /** Present when editing; omitted/`null` opens create mode. */

  template?: DocTemplateView | null

  onSaved: (template: DocTemplateView) => void
}

interface TemplateDraft {
  name: string

  category: TemplateCategory

  body: string
}

function emptyTemplate(): TemplateDraft {
  return { name: "", category: "sale_agreement", body: "" }
}

function fromTemplate(template: DocTemplateView): TemplateDraft {
  return {
    name: template.name,

    category: (TEMPLATE_CATEGORIES as readonly string[]).includes(
      template.category,
    )
      ? template.category as TemplateCategory
      : "other",

    body: template.body,
  }
}

export function TemplateFormDialog({
  open,

  onOpenChange,

  template,

  onSaved,
}: TemplateFormDialogProps) {
  const editing = template ?? null

  const [draft, setDraft] = useState<TemplateDraft>(() => emptyTemplate())

  const [invalid, setInvalid] = useState<Record<string, string>>({})

  const save = useSave()

  const tokens = useMemo(() => extractTokens(draft.body), [draft.body])

  useEffect(() => {
    if (!open) return

    setDraft(editing ? fromTemplate(editing) : emptyTemplate())

    setInvalid({})

    save.clear()

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing])

  function set<K extends keyof TemplateDraft>(
    key: K,

    value: TemplateDraft[K],
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

  async function submit() {
    const errors: Record<string, string> = {}

    if (draft.name.trim() === "") errors.name = "Name this template."

    if (draft.body.trim() === "") errors.body = "The template needs some text."

    if (Object.keys(errors).length > 0) {
      setInvalid(errors)

      return
    }

    setInvalid({})

    const done = await save.run(async () => {
      const result = editing
        ? await signaturesApi.updateTemplate(editing.id, {
            name: draft.name.trim(),

            category: draft.category,

            body: draft.body,
          })
        : await signaturesApi.createTemplate({
            name: draft.name.trim(),

            category: draft.category,

            body: draft.body,
          })

      onSaved(result)
    })

    if (done) onOpenChange(false)
  }

  const errorFor = (key: string) => invalid[key] ?? save.fields[key]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[42rem]">
        <DialogHeader>
          <DialogTitle>
            {editing ? "Edit template" : "New template"}
          </DialogTitle>
          <DialogDescription>
            Boilerplate with merge fields written as {"{{token}}"}. The sender
            fills those when they raise an envelope.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-3">
          {save.error ? (
            <Alert variant="danger">
              <AlertDescription>{save.error}</AlertDescription>
            </Alert>
          ) : null}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field
              label="Name"
              htmlFor="template-name"
              required
              error={errorFor("name")}
            >
              <Input
                id="template-name"
                maxLength={TEMPLATE_NAME_MAX}
                value={draft.name}
                onChange={(event) => set("name", event.target.value)}
              />
            </Field>

            <Field label="Category" htmlFor="template-category">
              <Select
                value={draft.category}
                onValueChange={(value) =>
                  set("category", value as TemplateCategory)
                }
              >
                <SelectTrigger id="template-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TEMPLATE_CATEGORIES.map((category) => (
                    <SelectItem key={category} value={category}>
                      {TEMPLATE_CATEGORY_LABELS[category]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <Field
            label="Body"
            htmlFor="template-body"
            required
            hint={
              tokens.length > 0
                ? `Merge fields found: ${tokens.join(", ")}`
                : "No merge fields yet."
            }
            error={errorFor("body")}
          >
            <Textarea
              id="template-body"
              rows={12}
              maxLength={TEMPLATE_BODY_MAX}
              value={draft.body}
              onChange={(event) => set("body", event.target.value)}
              placeholder={
                "This agreement is between {{buyer}} and {{seller}}…"
              }
            />
          </Field>
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={save.saving}>
            {save.saving
              ? "Saving…"
              : editing
                ? "Save template"
                : "Create template"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
