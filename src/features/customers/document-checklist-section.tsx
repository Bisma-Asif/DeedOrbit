/**
 * The document checklist, mounted on a customer's detail screen.
 *
 * It answers the one question the desk actually asks — *which paper is still
 * outstanding for this buyer* — per customer type, with the server-computed
 * state on every slot and the verification score at the top. States and the
 * score are never re-derived here: they arrive ready to render.
 *
 * Upload files against a checklist slot (staff source), a review opens the
 * side-by-side decide screen, and a reminder posts to the missing-required set.
 * The CNIC stays masked; the plaintext lives on the review/reveal surfaces only.
 */

import { useRef, useState } from "react"

import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileUp,
  Inbox,
  RefreshCw,
  Send,
  ShieldCheck,
  Upload,
} from "lucide-react"

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

import { EmptyState } from "@/components/empty-state"

import { Field, FieldGrid } from "@/components/field"

import { Input } from "@/components/ui/input"

import { Progress } from "@/components/ui/progress"

import { Skeleton } from "@/components/ui/skeleton"

import { useSave } from "@/features/organization/use-save"

import { useSession } from "@/lib/session-context"

import { useAsyncResource } from "@/lib/use-async-resource"

import { formatDate } from "@/lib/format"

import {
  documentVerificationApi,
  type DocumentChecklistResponse,
  type DocumentChecklistEntry as ChecklistEntry,
} from "@/lib/document-verification-api"

import { DocumentReviewDialog } from "@/features/documents/document-review-dialog"

import {
  readFileAsDataUrl,
  formatBytes,
} from "@/features/documents/document-utils"

import {
  DOCUMENT_CHECKLIST_STATE_LABELS,
  DOCUMENT_CHECKLIST_STATE_TONES,
  DOCUMENT_VERIFICATION_ALLOWED_MIMES,
} from "@shared/document-verification"

import { DOCUMENT_MAX_BYTES, DOCUMENT_TITLE_MAX } from "@shared/documents"

interface DocumentChecklistSectionProps {
  customerId: string
}

export function DocumentChecklistSection({
  customerId,
}: DocumentChecklistSectionProps) {
  const { can } = useSession()

  const canView = can("documents", "view")

  const resource = useAsyncResource(
    (signal) => documentVerificationApi.checklist(customerId, signal),

    canView,
  )

  const save = useSave()

  const [uploadFor, setUploadFor] = useState<ChecklistEntry | null>(null)

  const [reviewId, setReviewId] = useState<string | null>(null)

  const [reminded, setReminded] = useState<string | null>(null)

  const canVerify = can("documents", "verify")

  const canRemind = can("documents", "edit") || can("reminders", "edit")

  if (!canView) {
    return (
      <EmptyState
        icon={ShieldCheck}
        size="sm"
        title="Checklist not available"
        description="Your role cannot view customer documents."
      />
    )
  }

  if (resource.loading && !resource.data) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
    )
  }

  const checklist = resource.data

  async function sendReminder() {
    const done = await save.run(async () => {
      await documentVerificationApi.bulkRemind([customerId])
    })

    if (done) setReminded("Reminder queued for the missing documents.")
  }

  return (
    <div className="flex flex-col gap-3">
      {resource.error ? (
        <Alert variant="danger">
          <AlertDescription>{resource.error}</AlertDescription>
        </Alert>
      ) : !checklist ? (
        <EmptyState
          icon={Inbox}
          size="sm"
          title="No checklist"
          description="This customer could not be loaded for the document checklist."
        />
      ) : (
        <>
          <ScoreHeader
            checklist={checklist}
            canRemind={canRemind}
            reminding={save.saving}
            onRemind={() => void sendReminder()}
          />

          {reminded && !save.error ? (
            <Alert variant="success">
              <AlertDescription>{reminded}</AlertDescription>
            </Alert>
          ) : null}

          {save.error ? (
            <Alert variant="danger">
              <AlertDescription>{save.error}</AlertDescription>
            </Alert>
          ) : null}

          <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
            {checklist.entries.map((entry) => (
              <ChecklistRow
                key={entry.key}
                entry={entry}
                canVerify={canVerify}
                canUpload={checklist.canUpload}
                onUpload={() => setUploadFor(entry)}
                onReview={() =>
                  entry.documentId && setReviewId(entry.documentId)
                }
              />
            ))}
          </ul>

          <DocumentReviewDialog
            open={reviewId !== null}
            documentId={reviewId}
            onOpenChange={(open) => {
              if (!open) setReviewId(null)
            }}
            onChanged={() => void resource.reload()}
          />

          {uploadFor ? (
            <ChecklistUploadDialog
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
        </>
      )}
    </div>
  )
}

function ScoreHeader({
  checklist,

  canRemind,

  reminding,

  onRemind,
}: {
  checklist: DocumentChecklistResponse

  canRemind: boolean

  reminding: boolean

  onRemind: () => void
}) {
  const { score } = checklist

  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-col">
            <p className="text-[13px] font-semibold text-foreground">
              {checklist.customerName}
            </p>

            <p className="text-[11.5px] text-muted-foreground">
              {checklist.customerTypeLabel} · CNIC {checklist.cnicMasked}
            </p>
          </div>

          <div className="flex items-center gap-2">
            {checklist.missingRequiredKeys.length > 0 && canRemind ? (
              <Button
                variant="outline"
                size="sm"
                disabled={reminding}
                onClick={onRemind}
              >
                <Send size={13} />
                Remind customer
              </Button>
            ) : null}

            <Badge variant={score.percent === 100 ? "outline" : "pending"}>
              {score.requiredVerified}/{score.requiredTotal} required verified
            </Badge>
          </div>
        </div>

        <Progress value={score.percent} />

        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <CheckCircle2 size={12} />
            {score.percent}% complete
          </span>

          {score.missing > 0 ? (
            <span className="inline-flex items-center gap-1">
              <AlertTriangle size={12} />
              {score.missing} missing
            </span>
          ) : null}

          {score.expiringSoon > 0 ? (
            <span className="inline-flex items-center gap-1 text-danger">
              <Clock size={12} />
              {score.expiringSoon} expired
            </span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}

function ChecklistRow({
  entry,

  canVerify,

  canUpload,

  onUpload,

  onReview,
}: {
  entry: ChecklistEntry

  canVerify: boolean

  canUpload: boolean

  onUpload: () => void

  onReview: () => void
}) {
  const tone = DOCUMENT_CHECKLIST_STATE_TONES[entry.state]

  return (
    <li className="flex items-center justify-between gap-3 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[13px] font-medium text-foreground">
            {entry.label}
          </p>

          <Badge variant={tone}>
            {DOCUMENT_CHECKLIST_STATE_LABELS[entry.state]}
          </Badge>

          {entry.required ? (
            <span className="text-[11px] text-muted-foreground">required</span>
          ) : (
            <span className="text-[11px] text-muted-foreground">optional</span>
          )}

          {entry.reuploadRequested ? (
            <span className="inline-flex items-center gap-1 text-[11px] text-warning">
              <RefreshCw size={11} />
              re-upload requested
            </span>
          ) : null}
        </div>

        <p className="mt-0.5 truncate text-[11.5px] text-muted-foreground">
          {entry.state === "rejected" && entry.rejectReason
            ? `Rejected: ${entry.rejectReason}`
            : entry.state === "verified" && entry.verifiedByName
              ? `Manually verified by ${entry.verifiedByName}`
              : entry.expiresAt
                ? `Validity ends ${formatDate(entry.expiresAt)}`
                : entry.state === "missing"
                  ? "No file uploaded yet"
                  : "—"}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {entry.documentId && canVerify ? (
          <Button variant="outline" size="sm" onClick={onReview}>
            <ShieldCheck size={13} />
            Review
          </Button>
        ) : null}

        {canUpload && (entry.state === "missing" || entry.reuploadRequested) ? (
          <Button variant="outline" size="sm" onClick={onUpload}>
            <Upload size={13} />
            Upload
          </Button>
        ) : null}
      </div>
    </li>
  )
}

const ACCEPT_ATTR = DOCUMENT_VERIFICATION_ALLOWED_MIMES.join(",")

/** Shown after a save that also raised a duplicate flag — advisory, not an error. */

const DUPLICATE_NOTE =
  "Filed — but a possible duplicate was flagged for the reviewer to decide."

function ChecklistUploadDialog({
  open,

  entry,

  customerId,

  onOpenChange,

  onUploaded,
}: {
  open: boolean

  entry: ChecklistEntry

  customerId: string

  onOpenChange: (open: boolean) => void

  onUploaded: () => void
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)

  const save = useSave()

  const [file, setFile] = useState<File | null>(null)

  const [title, setTitle] = useState("")

  const [expiresAt, setExpiresAt] = useState("")

  const [cnic, setCnic] = useState("")

  const [localError, setLocalError] = useState<string | null>(null)

  const identity = entry.baseDocType === "id_copy"

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

      const created = await documentVerificationApi.upload(customerId, {
        checklistKey: entry.key,

        title: title.trim(),

        filename: chosen.name,

        dataUrl,

        expiresAt: expiresAt === "" ? null : expiresAt,

        cnic: identity && cnic.trim() !== "" ? cnic.trim() : null,
      })

      // Duplicate *detection*, never prevention: the file is filed and the

      // reviewer decides. Say so plainly rather than hiding the flag.

      if (created.flags.duplicateFile || created.flags.duplicateCnic) {
        window.setTimeout(() => setLocalError(DUPLICATE_NOTE), 0)
      }
    })

    if (done) onUploaded()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[36rem]">
        <DialogHeader>
          <DialogTitle>Upload · {entry.label}</DialogTitle>

          <DialogDescription>
            Files against this customer and enters the verification queue as
            under review — an upload is never a certification.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-3">
          {localError ? (
            <Alert
              variant={localError === DUPLICATE_NOTE ? "pending" : "danger"}
            >
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

          <FieldGrid>
            <Field label="Title" htmlFor="checklist-title" required>
              <Input
                id="checklist-title"
                value={title}
                maxLength={DOCUMENT_TITLE_MAX}
                onChange={(event) => setTitle(event.target.value)}
              />
            </Field>

            {entry.trackExpiry ? (
              <Field
                label="Validity ends"
                htmlFor="checklist-expiry"
                hint="Drives the 60/30/7 expiry alerts."
              >
                <Input
                  id="checklist-expiry"
                  type="date"
                  value={expiresAt}
                  onChange={(event) => setExpiresAt(event.target.value)}
                />
              </Field>
            ) : null}
          </FieldGrid>

          {identity ? (
            <Field
              label="CNIC read from the card"
              htmlFor="checklist-cnic"
              hint="Optional. Typed here it drives duplicate detection; nothing is filled in for you unless a real reader ran."
            >
              <Input
                id="checklist-cnic"
                value={cnic}
                inputMode="numeric"
                placeholder="12345-1234567-1"
                maxLength={20}
                onChange={(event) => setCnic(event.target.value)}
              />
            </Field>
          ) : null}
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>

          <Button disabled={save.saving} onClick={() => void submit()}>
            <Upload size={13} />
            {save.saving ? "Uploading…" : "Upload"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
