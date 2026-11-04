/**
 * The side-by-side review screen for one document.
 *
 * Left is the file itself, fetched through the short-lived signed grant the
 * review payload carries (`/api/file-access/:token`) — never the legacy direct
 * URL — with zoom, rotate, and a client-side watermark overlay when the grant is
 * marked `watermark`. Right is everything a verifier weighs: the customer's own
 * profile values beside the OCR suggestions, the mismatch and duplicate flags,
 * and the decision actions.
 *
 * The honesty rules are visible here rather than hidden: with the manual
 * (default) OCR adapter there are *no* suggestions, so the panel says so and the
 * verifier reads the number off the image instead of trusting a fabricated one.
 * Maker-checker is enforced server-side but surfaced here — the person who
 * filed the upload cannot be the person who certifies it.
 */

import { useState, type ReactNode } from "react"

import {
  AlertTriangle,
  Copy,
  Eye,
  EyeOff,
  FileWarning,
  RefreshCw,
  RotateCw,
  ShieldAlert,
  ShieldCheck,
  ZoomIn,
  ZoomOut,
} from "lucide-react"

import { Alert, AlertDescription } from "@/components/ui/alert"

import { Badge } from "@/components/ui/badge"

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

import { Field } from "@/components/field"

import { Textarea } from "@/components/ui/textarea"

import { Skeleton } from "@/components/ui/skeleton"

import { useSave } from "@/features/organization/use-save"

import { useSession } from "@/lib/session-context"

import { useAsyncResource } from "@/lib/use-async-resource"

import { formatDate, formatDateTime, orDash } from "@/lib/format"

import {
  documentVerificationApi,
  type DocumentReviewResponse,
  type DuplicateRef,
} from "@/lib/document-verification-api"

import type {
  DocumentOcrStatus,
  DocumentSource,
} from "@shared/document-verification"

import { DOCUMENT_REJECT_HINTS } from "@shared/document-verification"

/** Display labels for the stored vocabularies, local to this screen. */

const OCR_STATUS_LABELS: Record<DocumentOcrStatus, string> = {
  none: "No extraction",

  suggested: "Suggested, unconfirmed",

  confirmed: "Confirmed by a verifier",

  failed: "Extraction failed",
}

const SOURCE_LABELS: Record<DocumentSource, string> = {
  staff: "staff upload",

  portal: "customer portal",
}

interface DocumentReviewDialogProps {
  open: boolean

  onOpenChange: (open: boolean) => void

  /** The document under review; `null` renders the dialog body empty. */

  documentId: string | null

  /** Called after any decision so the queue can re-fetch. */

  onChanged: () => void
}

export function DocumentReviewDialog({
  open,

  onOpenChange,

  documentId,

  onChanged,
}: DocumentReviewDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[92rem]">
        {documentId ? (
          <ReviewPane
            key={documentId}
            documentId={documentId}
            onChanged={onChanged}
            onClose={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

/** The dialog content, remounted per document so a fresh review always loads. */

function ReviewPane({
  documentId,

  onChanged,

  onClose,
}: {
  documentId: string

  onChanged: () => void

  onClose: () => void
}) {
  const { data: session, can } = useSession()

  const resource = useAsyncResource((signal) =>
    documentVerificationApi.review(documentId, signal),
  )

  const save = useSave()

  const [scale, setScale] = useState(1)

  const [rotation, setRotation] = useState(0)

  const [rejecting, setRejecting] = useState(false)

  const [rejectReason, setRejectReason] = useState("")

  const [askReupload, setAskReupload] = useState(true)

  const [revealed, setRevealed] = useState<string | null>(null)

  const review = resource.data

  const canReveal = can("documents", "verify") || can("customers", "edit")

  async function act(mutate: () => Promise<unknown>) {
    const done = await save.run(async () => {
      await mutate()
    })

    if (done) {
      onChanged()

      setRejecting(false)

      await resource.reload()
    }
  }

  async function reveal() {
    if (revealed !== null) {
      setRevealed(null)

      return
    }

    const next = await documentVerificationApi
      .revealCnic(documentId)
      .catch(() => null)

    if (next) setRevealed(next.cnic)
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          Review document · {review?.document.title ?? "Loading"}
        </DialogTitle>
        <DialogDescription>
          {review
            ? `${review.document.filename} · filed by ${review.document.uploadedByName} via ${SOURCE_LABELS[(review.document.source as DocumentSource)] ?? review.document.source} on ${formatDate(review.document.createdAt)}`
            : "Loading the file and its extracted suggestions."}
        </DialogDescription>
      </DialogHeader>

      <DialogBody className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_26rem]">
        {resource.loading && !review ? (
          <div className="flex flex-col gap-3 lg:col-span-2">
            <Skeleton className="h-[52vh] w-full" />

            <Skeleton className="h-24 w-full" />
          </div>
        ) : !review ? (
          <div className="lg:col-span-2">
            <EmptyState
              icon={FileWarning}
              title="Nothing to review"
              description={
                resource.error ?? "This document is no longer available."
              }
            />
          </div>
        ) : (
          <>
            <PreviewPane
              review={review}
              scale={scale}
              rotation={rotation}
              viewer={session?.user.fullName ?? "Reviewer"}
              onZoom={(delta) =>
                setScale((value) => Math.min(3, Math.max(0.5, value + delta)))
              }
              onRotate={() => setRotation((value) => (value + 90) % 360)}
              onReset={() => {
                setScale(1)

                setRotation(0)
              }}
            />

            <DecisionPane
              review={review}
              revealed={revealed}
              canReveal={canReveal}
              onReveal={() => void reveal()}
            />
          </>
        )}
      </DialogBody>

      {rejecting ? (
        <div className="mx-6 mb-3 rounded-md border border-border bg-muted/30 p-3">
          <RejectComposer
            reason={rejectReason}
            onReason={setRejectReason}
            requestReupload={askReupload}
            onRequestReupload={setAskReupload}
            saving={save.saving}
            onCancel={() => setRejecting(false)}
            onConfirm={() =>
              void act(() =>
                documentVerificationApi.reject(documentId, {
                  reason: rejectReason.trim(),

                  requestReupload: askReupload,
                }),
              )
            }
          />
        </div>
      ) : null}

      {save.error || resource.error ? (
        <Alert variant="danger" className="mx-6 mb-3">
          <AlertDescription>{save.error ?? resource.error}</AlertDescription>
        </Alert>
      ) : null}

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>

        {review?.identityMode === "provider" ? (
          <Button
            variant="outline"
            disabled={save.saving || !review.canVerifyNow}
            onClick={() =>
              void act(() => documentVerificationApi.providerVerify(documentId))
            }
          >
            <ShieldCheck size={13} />
            Verify with provider
          </Button>
        ) : null}

        <Button
          variant="outline"
          disabled={save.saving}
          onClick={() =>
            void act(() => documentVerificationApi.requestReupload(documentId))
          }
        >
          <RefreshCw size={13} />
          Request re-upload
        </Button>

        <Button
          variant="danger"
          disabled={save.saving}
          onClick={() => setRejecting((value) => !value)}
        >
          <ShieldAlert size={13} />
          Reject
        </Button>

        <Button
          disabled={save.saving || !review?.canVerifyNow}
          onClick={() =>
            void act(() => documentVerificationApi.verify(documentId))
          }
        >
          <ShieldCheck size={13} />
          Verify
        </Button>
      </DialogFooter>
    </>
  )
}

/** Left half: the file, its controls, and the honest watermark overlay. */

function PreviewPane({
  review,

  scale,

  rotation,

  viewer,

  onZoom,

  onRotate,

  onReset,
}: {
  review: DocumentReviewResponse

  scale: number

  rotation: number

  viewer: string

  onZoom: (delta: number) => void

  onRotate: () => void

  onReset: () => void
}) {
  const document = review.document

  const isImage = document.mime.startsWith("image/")

  const isPdf = document.mime === "application/pdf"

  const watermark = review.preview.watermark

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <Button variant="outline" size="icon-sm" onClick={() => onZoom(-0.25)}>
          <ZoomOut size={13} />
        </Button>

        <Button variant="outline" size="icon-sm" onClick={() => onZoom(0.25)}>
          <ZoomIn size={13} />
        </Button>

        <Button variant="outline" size="icon-sm" onClick={onRotate}>
          <RotateCw size={13} />
        </Button>

        <Button variant="ghost" size="sm" onClick={onReset}>
          Reset
        </Button>

        <span className="ml-auto text-[11.5px] tabular-nums text-muted-foreground">
          {Math.round(scale * 100)}% · {rotation}°
        </span>
      </div>

      <div className="relative flex min-h-[52vh] items-center justify-center overflow-hidden rounded-md border border-border bg-muted/30">
        {isImage ? (
          <img
            src={review.preview.url}
            alt={document.title}
            style={{ transform: `scale(${scale}) rotate(${rotation}deg)` }}
            className="max-h-[52vh] w-auto max-w-full object-contain transition-transform"
          />
        ) : isPdf ? (
          <object
            data={review.preview.url}
            type="application/pdf"
            className="h-[52vh] w-full"
          >
            <p className="p-4 text-[12.5px] text-muted-foreground">
              This PDF cannot be shown inline in the review pane.
            </p>
          </object>
        ) : (
          <EmptyState
            icon={FileWarning}
            size="sm"
            title="No inline preview"
            description="This file type cannot be rendered in the browser."
          />
        )}

        {watermark ? (
          <WatermarkOverlay
            viewer={viewer}
            stamp={review.preview.expiresAt}
            label={review.customer?.cnicMasked ?? document.filename}
          />
        ) : null}
      </div>

      {watermark ? (
        <p className="text-[11px] leading-4 text-muted-foreground">
          Preview watermark only — the stored file is unchanged. Every open and
          download is written to the audit log.
        </p>
      ) : null}
    </div>
  )
}

function WatermarkOverlay({
  viewer,

  stamp,

  label,
}: {
  viewer: string

  stamp: string

  label: string
}) {
  const lines = [viewer, formatDateTime(stamp), label]

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden"
    >
      <div className="flex -rotate-[30deg] flex-col items-center gap-10">
        {[0, 1, 2].map((row) =>
          lines.map((line) => (
            <span
              key={`${row}-${line}`}
              className="whitespace-nowrap text-[13px] font-semibold uppercase tracking-wide text-slate-900/10"
            >
              {line}
            </span>
          )),
        )}
      </div>
    </div>
  )
}

/** Right half: profile vs extracted suggestions, flags, and the reveal control. */

function DecisionPane({
  review,

  revealed,

  canReveal,

  onReveal,
}: {
  review: DocumentReviewResponse

  revealed: string | null

  canReveal: boolean

  onReveal: () => void
}) {
  const noSuggestions = review.ocrStatus === "none"

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {review.verificationStatus === "verified" ? (
        <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2">
          <ShieldCheck size={14} className="text-primary" />

          <div className="min-w-0">
            <p className="text-[12.5px] font-medium text-foreground">
              {review.verifiedVia === "provider"
                ? "Verified by provider"
                : `Manually verified by ${review.verifiedByName ?? "—"}`}
            </p>

            {review.verifiedAt ? (
              <p className="text-[11px] text-muted-foreground">
                {formatDateTime(review.verifiedAt)}
                {review.providerRef ? ` · ref ${review.providerRef}` : ""}
              </p>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                A human certification — not a government check.
              </p>
            )}
          </div>
        </div>
      ) : review.verificationStatus === "rejected" ? (
        <Alert variant="danger">
          <AlertDescription>
            Rejected{review.rejectReason ? `: ${review.rejectReason}` : "."}
          </AlertDescription>
        </Alert>
      ) : null}

      {!review.canVerifyNow ? (
        <Alert variant="pending">
          <AlertTriangle />
          <AlertDescription>
            You filed this upload. Maker-checker requires a different reviewer
            to certify it — request a re-upload or ask a colleague to decide.
          </AlertDescription>
        </Alert>
      ) : null}

      {review.duplicateFile || review.duplicateCnic ? (
        <div className="flex flex-wrap gap-1.5">
          <DuplicateChip
            icon={<Copy size={11} />}
            text="Identical file already filed for another customer"
            match={review.duplicateFile}
          />

          <DuplicateChip
            icon={<Copy size={11} />}
            text="The same CNIC appears on another customer"
            match={review.duplicateCnic}
          />
        </div>
      ) : null}

      <section className="flex flex-col gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Profile on file
        </h3>

        {review.customer ? (
          <div className="flex flex-col gap-1 text-[12.5px]">
            <ProfileRow label="Name" value={review.customer.fullName} />

            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">CNIC</span>

              <span className="flex items-center gap-1.5 font-mono tabular-nums">
                {revealed ?? review.customer.cnicMasked}

                {canReveal ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={revealed ? "Hide CNIC" : "Reveal CNIC"}
                    onClick={onReveal}
                  >
                    {revealed ? <EyeOff size={13} /> : <Eye size={13} />}
                  </Button>
                ) : null}
              </span>
            </div>

            <ProfileRow
              label="Father / husband"
              value={orDash(review.customer.fatherHusbandName)}
            />

            {revealed ? (
              <p className="text-[11px] text-muted-foreground">
                This reveal was written to the audit log.
              </p>
            ) : null}
          </div>
        ) : (
          <p className="text-[12px] text-muted-foreground">
            The linked customer could not be loaded.
          </p>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Extracted from the document
        </h3>

        {noSuggestions ? (
          <p className="text-[12px] leading-5 text-muted-foreground">
            No text extraction ran for this file — the platform ships with a
            manual reader that never guesses a value. Read the fields off the
            image and confirm them against the profile above before you verify.
          </p>
        ) : (
          <div className="flex flex-col gap-1 text-[12.5px]">
            <ProfileRow
              label="Name"
              value={orDash(review.extracted.name)}
              mismatch={review.mismatch.name}
            />

            <ProfileRow
              label="CNIC"
              value={revealed ?? review.extracted.cnicMasked}
              mismatch={review.mismatch.cnic}
            />

            <ProfileRow
              label="Father / husband"
              value={orDash(review.extracted.guardianName)}
            />

            <ProfileRow
              label="Date of birth"
              value={
                review.extracted.dob ? formatDate(review.extracted.dob) : "—"
              }
            />

            <ProfileRow
              label="Expiry"
              value={
                review.extracted.expiry
                  ? formatDate(review.extracted.expiry)
                  : "—"
              }
            />
          </div>
        )}

        <p className="text-[11px] text-muted-foreground">
          {OCR_STATUS_LABELS[review.ocrStatus]}
          {review.ocrStatus === "suggested"
            ? " — suggestions are not confirmed until you verify."
            : ""}
        </p>
      </section>

      <div className="flex flex-col gap-1 text-[12.5px]">
        <ProfileRow
          label="Validity ends"
          value={
            review.document.expiresAt
              ? formatDate(review.document.expiresAt)
              : "Not tracked"
          }
        />

        <ProfileRow
          label="Verification"
          value={review.verificationStatus ?? "unverified"}
        />
      </div>

      {review.reuploadRequested ? (
        <p className="text-[12px] text-warning">
          A re-upload has already been requested
          {review.reuploadReason ? `: ${review.reuploadReason}` : "."}
        </p>
      ) : null}
    </div>
  )
}

function ProfileRow({
  label,

  value,

  mismatch = false,
}: {
  label: string

  value: string

  mismatch?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>

      <span className="flex items-center gap-1.5 tabular-nums">
        {mismatch ? (
          <Badge variant="danger">
            <AlertTriangle size={11} />
            mismatch
          </Badge>
        ) : null}

        <span className={mismatch ? "text-danger" : undefined}>{value}</span>
      </span>
    </div>
  )
}

function DuplicateChip({
  icon,

  text,

  match,
}: {
  icon: ReactNode

  text: string

  match: DuplicateRef | null
}) {
  if (!match) return null

  return (
    <Badge variant="danger">
      {icon}
      {text}
    </Badge>
  )
}

/** The rejection composer — a reason is mandatory before it can be confirmed. */

function RejectComposer({
  reason,

  onReason,

  requestReupload,

  onRequestReupload,

  saving,

  onCancel,

  onConfirm,
}: {
  reason: string

  onReason: (value: string) => void

  requestReupload: boolean

  onRequestReupload: (value: boolean) => void

  saving: boolean

  onCancel: () => void

  onConfirm: () => void
}) {
  return (
    <div className="flex flex-col gap-2">
      <Field
        label="Reason for rejection"
        htmlFor="document-reject-reason"
        required
        hint="The customer sees this wording in their portal."
      >
        <Textarea
          id="document-reject-reason"
          value={reason}
          rows={2}
          placeholder="Say plainly what is wrong so it can be fixed."
          onChange={(event) => onReason(event.target.value)}
        />
      </Field>

      <div className="flex flex-wrap gap-1.5">
        {DOCUMENT_REJECT_HINTS.map((hint) => (
          <Button
            key={hint}
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onReason(hint)}
          >
            {hint}
          </Button>
        ))}
      </div>

      <label className="flex items-center gap-2 text-[12.5px]">
        <input
          type="checkbox"
          className="size-3.5 accent-primary"
          checked={requestReupload}
          onChange={(event) => onRequestReupload(event.target.checked)}
        />
        Ask the customer to upload a fresh copy
      </label>

      <div className="flex items-center justify-end gap-2">
        <span className="mr-auto text-[11px] text-muted-foreground">
          A rejection always needs a reason.
        </span>

        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>

        <Button
          variant="danger"
          size="sm"
          disabled={saving || reason.trim() === ""}
          onClick={onConfirm}
        >
          Confirm rejection
        </Button>
      </div>
    </div>
  )
}
