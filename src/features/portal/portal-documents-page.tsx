/**
 * The buyer's own documents.
 *
 * Only the types marked customer-visible in the access map (an agreement, a
 * booking form, a payment receipt) are ever listed here, and only those filed
 * against this login's own customer profile or bookings. An ID copy or a
 * supplier invoice never appears — the server decides that, and this page simply
 * renders what it is given. Each file previews inline where the browser can and
 * downloads otherwise.
 */

import { useState } from "react"

import { AlertTriangle, Download, Eye, FileText } from "lucide-react"

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

import { Skeleton } from "@/components/ui/skeleton"

import { formatBytes } from "@/features/documents/document-utils"

import { PortalVerificationChecklist } from "@/features/portal/portal-verification-checklist"

import { formatDate } from "@/lib/format"

import { portalApi, portalDocumentFileUrl } from "@/lib/portal-api"

import { useAsyncResource } from "@/lib/use-async-resource"

import {
  DOCUMENT_TYPE_LABELS,
  DOCUMENT_TYPE_TONES,
  type DocumentType,
  type PortalDocument,
} from "@shared/documents"

/** Inline preview of one portal file, streamed from the portal's own route. */

function PortalDocumentPreview({
  document,

  open,

  onOpenChange,
}: {
  document: PortalDocument | null

  open: boolean

  onOpenChange: (open: boolean) => void
}) {
  const isImage = document?.mime.startsWith("image/") ?? false

  const isPdf = document?.mime === "application/pdf"

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[46rem]">
        <DialogHeader>
          <DialogTitle>{document?.title ?? "Document"}</DialogTitle>
          <DialogDescription>
            {document
              ? `${document.filename} · ${formatBytes(document.sizeBytes)}`
              : undefined}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex min-h-[16rem] items-center justify-center bg-muted/30">
          {!document ? (
            <EmptyState
              icon={FileText}
              size="sm"
              title="Nothing to preview"
              description="This document is no longer available."
            />
          ) : isImage ? (
            <img
              src={portalDocumentFileUrl(document.id)}
              alt={document.title}
              className="max-h-[60vh] w-auto max-w-full object-contain"
            />
          ) : isPdf ? (
            <object
              data={portalDocumentFileUrl(document.id)}
              type="application/pdf"
              className="h-[60vh] w-full"
            >
              <p className="p-4 text-[12.5px] text-muted-foreground">
                This PDF cannot be shown inline.{" "}
                <a
                  className="text-primary underline"
                  href={portalDocumentFileUrl(document.id, true)}
                  download
                >
                  Download it instead.
                </a>
              </p>
            </object>
          ) : (
            <EmptyState
              icon={Download}
              size="sm"
              title="No inline preview"
              description="This file type cannot be shown in the browser. Download it to open."
            />
          )}
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          {document ? (
            <Button asChild>
              <a href={portalDocumentFileUrl(document.id, true)} download>
                <Download size={13} />
                Download
              </a>
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function PortalDocumentsPage() {
  const resource = useAsyncResource((signal) => portalApi.documents(signal))

  const [preview, setPreview] = useState<PortalDocument | null>(null)

  if (resource.loading && !resource.data) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    )
  }

  if (resource.error) {
    return (
      <Alert variant="danger">
        <AlertDescription>{resource.error}</AlertDescription>
      </Alert>
    )
  }

  const documents = resource.data?.documents ?? []

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-6">
        <PortalVerificationChecklist />

        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-foreground">
            Filed documents
          </h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Agreements, booking forms, and receipts filed against your
            purchases.
          </p>
        </div>
      </div>
      {documents.length === 0 ? (
        <Card>
          <CardContent className="py-6">
            <EmptyState
              icon={FileText}
              size="sm"
              title="No documents yet"
              description="Files the office shares with you will appear here."
            />
          </CardContent>
        </Card>
      ) : (
        <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
          {documents.map((document) => (
            <li
              key={document.id}
              className="flex items-center justify-between gap-3 px-4 py-3.5"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Badge
                    variant={
                      DOCUMENT_TYPE_TONES[(document.docType as DocumentType)]
                    }
                  >
                    {DOCUMENT_TYPE_LABELS[(document.docType as DocumentType)] ??
                      document.docType}
                  </Badge>
                  <p className="truncate text-[13.5px] font-medium text-foreground">
                    {document.title}
                  </p>
                </div>
                <p className="mt-0.5 truncate text-[11.5px] text-muted-foreground">
                  {document.filename} · {formatBytes(document.sizeBytes)}
                  {document.bookingReference
                    ? ` · ${document.bookingReference}`
                    : ""}{" "}
                  · {formatDate(document.createdAt)}
                  {document.expiresAt ? (
                    document.isExpired ? (
                      <span className="ml-1 inline-flex items-center gap-1 text-danger">
                        <AlertTriangle size={11} />
                        expired {formatDate(document.expiresAt)}
                      </span>
                    ) : (
                      <span className="ml-1">
                        · expires {formatDate(document.expiresAt)}
                      </span>
                    )
                  ) : null}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPreview(document)}
                >
                  <Eye size={13} />
                  Preview
                </Button>
                <Button variant="ghost" size="icon-sm" asChild>
                  <a
                    href={portalDocumentFileUrl(document.id, true)}
                    download
                    aria-label={`Download ${document.title}`}
                  >
                    <Download size={13} />
                  </a>
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <PortalDocumentPreview
        document={preview}
        open={preview !== null}
        onOpenChange={(open) => {
          if (!open) setPreview(null)
        }}
      />
    </div>
  )
}
