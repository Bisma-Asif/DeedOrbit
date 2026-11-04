/**
 * The buyer's own document checklist and upload, inside the portal.
 *
 * This is the customer-facing reduction of the staff verification module. It
 * answers one question — *what do I still owe the office* — with the honest
 * four-plus-two statuses the server hands over: verified, under review, needs
 * re-upload (with the reason), not uploaded, expired. A buyer can upload a file
 * against a slot; that upload enters the office queue as *under review*, never a
 * certification, and there is no verify control here at all — a customer cannot
 * verify their own paper.
 *
 * The checklist is scoped by the server to the profiles linked to this login, so
 * the buyer never passes a customer id they are not entitled to. CNICs and raw
 * file URLs are never shown.
 */

import { useRef, useState } from "react"

import { CheckCircle2, FileUp, RefreshCw, Upload } from "lucide-react"

import { Alert, AlertDescription } from "@/components/ui/alert"

import { Badge } from "@/components/ui/badge"

import { Button } from "@/components/ui/button"

import { Card, CardContent } from "@/components/ui/card"

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

import { Progress } from "@/components/ui/progress"

import { Skeleton } from "@/components/ui/skeleton"

import { useSave } from "@/features/organization/use-save"

import { useAsyncResource } from "@/lib/use-async-resource"

import { formatDate } from "@/lib/format"

import {
  formatBytes,
  readFileAsDataUrl,
} from "@/features/documents/document-utils"

import { portalApi } from "@/lib/portal-api"

import {
  PORTAL_DOCUMENT_STATUS_LABELS,
  type PortalDocumentChecklistEntry,
  type PortalDocumentStatus,
} from "@shared/portal"

import { DOCUMENT_MAX_BYTES, DOCUMENT_TITLE_MAX } from "@shared/documents"

import { DOCUMENT_VERIFICATION_ALLOWED_MIMES } from "@shared/document-verification"

const STATUS_TONES: Record<PortalDocumentStatus, "outline" | "pending" | "danger"> =
  {
    verified: "outline",

    pending: "pending",

    needs_reupload: "danger",

    missing: "outline",

    expired: "danger",
  }

const ACCEPT_ATTR = DOCUMENT_VERIFICATION_ALLOWED_MIMES.join(",")

export function PortalVerificationChecklist() {
  const overview = useAsyncResource((signal) => portalApi.overview(signal))

  if (overview.loading && !overview.data) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
    )
  }

  if (overview.error && !overview.data) {
    return (
      <Alert variant="danger">
        <AlertDescription>{overview.error}</AlertDescription>
      </Alert>
    )
  }

  const profiles = overview.data?.profiles ?? []

  if (profiles.length === 0) {
    return null
  }

  return (
    <div className="flex flex-col gap-4">
      {profiles.map((profile) => (
        <PortalProfileChecklist key={profile.id} customerId={profile.id} />
      ))}
    </div>
  )
}

function PortalProfileChecklist({ customerId }: { customerId: string }) {
  const resource = useAsyncResource((signal) =>
    portalApi.documentChecklist(customerId, signal),
  )

  const [uploadFor, setUploadFor] =
    useState<PortalDocumentChecklistEntry | null>(null)

  if (resource.loading && !resource.data) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
    )
  }

  if (resource.error && !resource.data) {
    return (
      <Alert variant="danger">
        <AlertDescription>{resource.error}</AlertDescription>
      </Alert>
    )
  }

  const checklist = resource.data

  if (!checklist) return null

  const needsAttention = checklist.entries.some(
    (entry) => entry.status === "missing" || entry.status === "needs_reupload",
  )

  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-foreground">
              Your documents
            </p>
            <p className="text-[11.5px] text-muted-foreground">
              {checklist.customerName} · {checklist.percent}% of required
              paperwork verified
            </p>
          </div>

          <Badge variant={checklist.percent === 100 ? "outline" : "pending"}>
            {checklist.percent}% complete
          </Badge>
        </div>

        <Progress value={checklist.percent} />

        <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
          {checklist.entries.map((entry) => (
            <ChecklistRow
              key={entry.key}
              entry={entry}
              canUpload={checklist.canUpload}
              onUpload={() => setUploadFor(entry)}
            />
          ))}
        </ul>

        {needsAttention ? (
          <p className="text-[11.5px] text-muted-foreground">
            Upload the items marked not uploaded or needs re-upload. Once the
            office reviews a file its status updates here — uploading does not
            verify it yourself.
          </p>
        ) : null}

        {uploadFor ? (
          <PortalUploadDialog
            open
            entry={uploadFor}
            customerId={customerId}
            onOpenChange={(open) => {
              if (!open) setUploadFor(null)
            }}
            onUploaded={() => {
              setUploadFor(null)

              void resource.reload()
            }}
          />
        ) : null}
      </CardContent>
    </Card>
  )
}

function ChecklistRow({
  entry,

  canUpload,

  onUpload,
}: {
  entry: PortalDocumentChecklistEntry

  canUpload: boolean

  onUpload: () => void
}) {
  const canAct =
    canUpload &&
    (entry.status === "missing" || entry.status === "needs_reupload")

  return (
    <li className="flex items-center justify-between gap-3 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[13px] font-medium text-foreground">
            {entry.label}
          </p>

          <Badge variant={STATUS_TONES[entry.status]}>
            {PORTAL_DOCUMENT_STATUS_LABELS[entry.status]}
          </Badge>

          {entry.required ? (
            <span className="text-[11px] text-muted-foreground">required</span>
          ) : (
            <span className="text-[11px] text-muted-foreground">optional</span>
          )}
        </div>

        <p className="mt-0.5 truncate text-[11.5px] text-muted-foreground">
          {entry.status === "needs_reupload" && entry.rejectReason
            ? `Re-upload needed: ${entry.rejectReason}`
            : entry.expiresAt
              ? entry.status === "expired"
                ? `Expired ${formatDate(entry.expiresAt)}`
                : `Validity ends ${formatDate(entry.expiresAt)}`
              : entry.hint || "—"}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {entry.status === "verified" ? (
          <span className="inline-flex items-center gap-1 text-[11.5px] text-muted-foreground">
            <CheckCircle2 size={12} />
            Done
          </span>
        ) : null}

        {entry.status === "needs_reupload" ? (
          <RefreshCw size={12} className="text-warning" />
        ) : null}

        {canAct ? (
          <Button variant="outline" size="sm" onClick={onUpload}>
            <Upload size={13} />
            {entry.status === "needs_reupload" ? "Re-upload" : "Upload"}
          </Button>
        ) : null}
      </div>
    </li>
  )
}

function PortalUploadDialog({
  open,

  entry,

  customerId,

  onOpenChange,

  onUploaded,
}: {
  open: boolean

  entry: PortalDocumentChecklistEntry

  customerId: string

  onOpenChange: (open: boolean) => void

  onUploaded: () => void
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)

  const save = useSave()

  const [file, setFile] = useState<File | null>(null)

  const [title, setTitle] = useState("")

  const [expiresAt, setExpiresAt] = useState("")

  const [localError, setLocalError] = useState<string | null>(null)

  function pick(next: File | null) {
    setLocalError(null)

    if (!next) {
      setFile(null)

      return
    }

    if (next.size > DOCUMENT_MAX_BYTES) {
      setLocalError(
        `That file is too large — the limit is ${formatBytes(DOCUMENT_MAX_BYTES)}.`,
      )

      setFile(null)

      return
    }

    if (
      !(DOCUMENT_VERIFICATION_ALLOWED_MIMES as readonly string[]).includes(
        next.type,
      )
    ) {
      setLocalError(
        `Allowed types: ${DOCUMENT_VERIFICATION_ALLOWED_MIMES.join(", ")}.`,
      )

      setFile(null)

      return
    }

    setFile(next)

    if (title === "") setTitle(next.name.replace(/\.[^.]+$/, ""))
  }

  async function submit() {
    setLocalError(null)

    if (!file) {
      setLocalError("Choose a file to upload.")

      return
    }

    if (title.trim() === "") {
      setLocalError("Give the document a title.")

      return
    }

    const chosen = file

    const done = await save.run(async () => {
      const dataUrl = await readFileAsDataUrl(chosen)

      await portalApi.uploadDocument({
        customerId,

        checklistKey: entry.key,

        title: title.trim(),

        filename: chosen.name,

        dataUrl,

        expiresAt: expiresAt === "" ? null : expiresAt,
      })
    })

    if (done) onUploaded()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[34rem]">
        <DialogHeader>
          <DialogTitle>Upload · {entry.label}</DialogTitle>

          <DialogDescription>
            Sends this file to the office for review. It will show as under
            review until a person verifies it — uploading does not verify it
            yourself.
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

          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT_ATTR}
            className="hidden"
            onChange={(event) => pick(event.target.files?.[0] ?? null)}
          />

          <div className="flex flex-col items-start gap-1.5">
            <Button variant="outline" onClick={() => inputRef.current?.click()}>
              <FileUp size={13} />
              {file ? file.name : "Choose a file"}
            </Button>

            {file ? (
              <p className="text-[11.5px] text-muted-foreground">
                {formatBytes(file.size)} · {file.type}
              </p>
            ) : null}
          </div>

          <Field label="Title" htmlFor="portal-doc-title" required>
            <Input
              id="portal-doc-title"
              value={title}
              maxLength={DOCUMENT_TITLE_MAX}
              onChange={(event) => setTitle(event.target.value)}
            />
          </Field>

          <Field
            label="Validity ends (if applicable)"
            htmlFor="portal-doc-expiry"
            hint="For ID cards or letters with an expiry date, so the office can alert you before it lapses."
          >
            <Input
              id="portal-doc-expiry"
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

          <Button disabled={save.saving} onClick={() => void submit()}>
            <Upload size={13} />
            {save.saving ? "Uploading…" : "Upload for review"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
