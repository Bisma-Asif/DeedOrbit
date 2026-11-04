/**
 * Upload — or re-tag — one document.
 *
 * Doubles as the edit dialog: filing a new document needs a file, while changing
 * an existing row edits only its title, type, and expiry (the bytes are immutable
 * server-side, so a wrong upload is deleted and re-filed). One dialog keeps the
 * two paths visually identical and avoids a second near-copy.
 *
 * The mime list, byte cap, and per-type access are enforced again on the server;
 * the checks here only let us reject an obvious miss before any bytes travel.
 */

import { useEffect, useRef, useState } from "react"

import { Upload } from "lucide-react"

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

import { Field, FieldGrid } from "@/components/field"

import { Input } from "@/components/ui/input"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

import { useSave } from "@/features/organization/use-save"

import { documentsApi } from "@/lib/documents-api"

import { readFileAsDataUrl, formatBytes } from "./document-utils"

import {
  DOCUMENT_ALLOWED_MIMES,
  DOCUMENT_MAX_BYTES,
  DOCUMENT_TYPES,
  DOCUMENT_TYPE_HINTS,
  DOCUMENT_TYPE_LABELS,
  type DocumentEntityType,
  type DocumentSummary,
  type DocumentType,
} from "@shared/documents"

interface DocumentUploadDialogProps {
  open: boolean

  onOpenChange: (open: boolean) => void

  entityType: DocumentEntityType

  entityId: string

  /** Present in edit mode; the file picker is hidden and only metadata is sent. */

  document?: DocumentSummary | null

  onSaved: () => void
}

const ACCEPT_ATTR = DOCUMENT_ALLOWED_MIMES.join(",")

export function DocumentUploadDialog({
  open,

  onOpenChange,

  entityType,

  entityId,

  document,

  onSaved,
}: DocumentUploadDialogProps) {
  const editing = Boolean(document)

  const save = useSave()

  const inputRef = useRef<HTMLInputElement | null>(null)

  const [title, setTitle] = useState("")

  const [docType, setDocType] = useState<DocumentType>("other")

  const [expiresAt, setExpiresAt] = useState("")

  const [file, setFile] = useState<File | null>(null)

  const [localError, setLocalError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return

    setLocalError(null)

    save.clear()

    setTitle(document?.title ?? "")

    setDocType(document?.docType ?? "other")

    setExpiresAt(document?.expiresAt ?? "")

    setFile(null)

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, document])

  function pick(next: File | null) {
    setLocalError(null)

    if (!next) {
      setFile(null)

      return
    }

    if (next.size > DOCUMENT_MAX_BYTES) {
      setLocalError(
        `That file is too large. The limit is ${formatBytes(DOCUMENT_MAX_BYTES)}.`,
      )

      setFile(null)

      return
    }

    if (!(DOCUMENT_ALLOWED_MIMES as readonly string[]).includes(next.type)) {
      setLocalError(`Allowed types: ${DOCUMENT_ALLOWED_MIMES.join(", ")}.`)

      setFile(null)

      return
    }

    setFile(next)

    if (title === "") setTitle(next.name.replace(/\.[^.]+$/, ""))
  }

  async function submit() {
    setLocalError(null)

    if (!editing && !file) {
      setLocalError("Choose a file to upload.")

      return
    }

    if (title.trim() === "") {
      setLocalError("Give the document a title.")

      return
    }

    const done = await save.run(async () => {
      if (editing && document) {
        await documentsApi.update(document.id, {
          title: title.trim(),

          docType,

          expiresAt: expiresAt === "" ? null : expiresAt,
        })
      } else if (file) {
        const dataUrl = await readFileAsDataUrl(file)

        await documentsApi.create({
          entityType,

          entityId,

          docType,

          title: title.trim(),

          filename: file.name,

          dataUrl,

          expiresAt: expiresAt === "" ? null : expiresAt,
        })
      }
    })

    if (done) {
      onSaved()

      onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[36rem]">
        <DialogHeader>
          <DialogTitle>
            {editing ? "Edit document" : "Upload document"}
          </DialogTitle>
          <DialogDescription>
            {editing
              ? "Change how this file is filed. The file itself cannot be replaced — delete and re-upload instead."
              : `Attach a PNG, JPEG, or PDF under ${formatBytes(DOCUMENT_MAX_BYTES)} to this ${entityType}.`}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-3">
          {localError ? (
            <Alert variant="danger">
              <AlertDescription>{localError}</AlertDescription>
            </Alert>
          ) : save.error ? (
            <Alert variant="danger">
              <AlertDescription>{save.error}</AlertDescription>
            </Alert>
          ) : null}

          {!editing ? (
            <div className="flex flex-col gap-2">
              <input
                ref={inputRef}
                type="file"
                accept={ACCEPT_ATTR}
                className="hidden"
                onChange={(event) => pick(event.target.files?.[0] ?? null)}
              />
              <Button
                variant="outline"
                onClick={() => inputRef.current?.click()}
              >
                <Upload size={13} />
                {file ? file.name : "Choose a file"}
              </Button>
              {file ? (
                <p className="text-[11.5px] text-muted-foreground">
                  {formatBytes(file.size)} · {file.type}
                </p>
              ) : null}
            </div>
          ) : null}

          <FieldGrid>
            <Field label="Title" htmlFor="document-title" required>
              <Input
                id="document-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={160}
              />
            </Field>

            <Field label="Document type" htmlFor="document-type">
              <Select
                value={docType}
                onValueChange={(value) => setDocType(value as DocumentType)}
              >
                <SelectTrigger id="document-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DOCUMENT_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {DOCUMENT_TYPE_LABELS[type]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </FieldGrid>

          <p className="text-[11.5px] leading-4 text-muted-foreground">
            {DOCUMENT_TYPE_HINTS[docType]}
          </p>

          <Field
            label="Expiry (optional)"
            htmlFor="document-expiry"
            hint="Advisory only — an expired file still reads for someone entitled to it."
          >
            <Input
              id="document-expiry"
              type="date"
              value={expiresAt}
              onChange={(event) => setExpiresAt(event.target.value)}
            />
          </Field>
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={save.saving}>
            {save.saving ? "Saving…" : editing ? "Save changes" : "Upload"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
