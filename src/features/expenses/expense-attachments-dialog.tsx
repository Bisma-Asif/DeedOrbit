/**
 * Expense attachments.
 *
 * A receipt or invoice is stored as a base64 data URL inside SQLite, mirroring
 * the tenant-logo pattern: mime validated on both sides against a small allow
 * list (png / jpeg / pdf), a 5 MB per-file cap, and a two-file-per-expense
 * ceiling enforced server-side. The client reads the picked file, refuses an
 * oversized pick before any bytes travel, and posts the encoded string.
 *
 * A paid expense is closed: the server rejects uploads and deletes on a row
 * already in `paid`, and the buttons here disable in the same situation so the
 * dialog reads honestly.
 */

import { useRef, useState } from "react"

import { Download, Paperclip, Trash2, Upload } from "lucide-react"

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

import { EmptyState } from "@/components/empty-state"

import { useSave } from "@/features/organization/use-save"

import { formatDateTime } from "@/lib/format"

import { useAsyncResource } from "@/lib/use-async-resource"

import { expensesApi, expenseAttachmentUrl } from "@/lib/expenses-api"

import {
  EXPENSE_ATTACHMENT_ALLOWED_MIMES,
  EXPENSE_ATTACHMENT_MAX_BYTES,
  EXPENSE_ATTACHMENT_MAX_COUNT,
  type Expense,
  type ExpenseAttachmentMeta,
} from "@shared/expenses"

interface ExpenseAttachmentsDialogProps {
  open: boolean

  onOpenChange: (open: boolean) => void

  expense: Expense

  onChanged: () => void
}

/** Read a picked file into a base64 data URL without dragging a dependency in. */

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = () => resolve(String(reader.result ?? ""))

    reader.onerror = () => reject(new Error("The file could not be read."))

    reader.readAsDataURL(file)
  })
}

const ACCEPT_ATTR = EXPENSE_ATTACHMENT_ALLOWED_MIMES.join(",")

/** Compact human-readable bytes for the receipt tile caption and error copy. */

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`

  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`

  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

export function ExpenseAttachmentsDialog({
  open,

  onOpenChange,

  expense,

  onChanged,
}: ExpenseAttachmentsDialogProps) {
  const resource = useAsyncResource(
    (signal) => expensesApi.read(expense.id, signal),

    open,
  )

  const [picking, setPicking] = useState(false)

  const [localError, setLocalError] = useState<string | null>(null)

  const save = useSave()

  const inputRef = useRef<HTMLInputElement | null>(null)

  const attachments = resource.data?.attachments ?? []

  const closed = expense.status === "paid"

  const atCapacity = attachments.length >= EXPENSE_ATTACHMENT_MAX_COUNT

  const canUpload = !closed && !atCapacity

  async function upload(file: File) {
    setLocalError(null)

    if (file.size > EXPENSE_ATTACHMENT_MAX_BYTES) {
      setLocalError(
        `That file is too large. The limit is ${formatBytes(EXPENSE_ATTACHMENT_MAX_BYTES)}.`,
      )

      return
    }

    if (
      !(EXPENSE_ATTACHMENT_ALLOWED_MIMES as readonly string[]).includes(
        file.type,
      )
    ) {
      setLocalError(
        `Allowed types: ${EXPENSE_ATTACHMENT_ALLOWED_MIMES.join(", ")}.`,
      )

      return
    }

    setPicking(true)

    try {
      const dataUrl = await readFileAsDataUrl(file)

      await expensesApi.uploadAttachment(expense.id, {
        filename: file.name,

        dataUrl,
      })

      await resource.reload()

      onChanged()
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Upload failed.")
    } finally {
      setPicking(false)
    }
  }

  async function remove(attachment: ExpenseAttachmentMeta) {
    const done = await save.run(async () => {
      await expensesApi.deleteAttachment(expense.id, attachment.id)
    })

    if (done) {
      await resource.reload()

      onChanged()
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[36rem]">
        <DialogHeader>
          <DialogTitle>Attachments</DialogTitle>
          <DialogDescription>
            Attach up to {EXPENSE_ATTACHMENT_MAX_COUNT} receipts (PNG, JPEG, or
            PDF, each under {formatBytes(EXPENSE_ATTACHMENT_MAX_BYTES)}).
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

          {closed ? (
            <Alert variant="pending">
              <AlertDescription>
                This expense is paid and closed. Nothing here can be added or
                removed.
              </AlertDescription>
            </Alert>
          ) : null}

          {attachments.length === 0 ? (
            <EmptyState
              icon={Paperclip}
              size="sm"
              title="No attachments"
              description={
                canUpload
                  ? "Upload a receipt or vendor invoice to attach evidence to this expense."
                  : "Nothing attached yet, and this expense cannot accept new files."
              }
            />
          ) : (
            <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
              {attachments.map((attachment) => (
                <li
                  key={attachment.id}
                  className="flex items-center justify-between gap-3 px-3 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-foreground">
                      {attachment.filename}
                    </p>
                    <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                      {attachment.mime} · {formatBytes(attachment.sizeBytes)} ·
                      uploaded by {attachment.uploadedByName} on{" "}
                      {formatDateTime(attachment.uploadedAt)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button variant="outline" size="sm" asChild>
                      <a
                        href={expenseAttachmentUrl(expense.id, attachment.id)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <Download size={13} />
                        Open
                      </a>
                    </Button>
                    {!closed ? (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Remove ${attachment.filename}`}
                        disabled={save.saving}
                        onClick={() => void remove(attachment)}
                      >
                        <Trash2 size={13} />
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}

          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT_ATTR}
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0]

              if (file) void upload(file)

              // Reset the picker so the same file can be chosen twice in a row.

              event.target.value = ""
            }}
          />
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button
            onClick={() => inputRef.current?.click()}
            disabled={!canUpload || picking}
          >
            <Upload size={13} />
            {picking ? "Uploading…" : "Upload receipt"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
