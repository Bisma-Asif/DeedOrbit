/**
 * Preview a stored document without leaving the record it belongs to.
 *
 * The bytes are streamed from the same endpoint the list links to, so the type
 * gate is re-checked server-side before anything renders. Images show inline, PDFs
 * use an `<object>` with a download fallback, and any other mime is offered as a
 * download only — the browser cannot render it, and pretending otherwise would
 * show a broken frame.
 */

import { Download } from "lucide-react"

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

import { documentFileUrl } from "@/lib/documents-api"

import { formatBytes } from "./document-utils"

import type { DocumentSummary } from "@shared/documents"

interface DocumentPreviewDialogProps {
  open: boolean

  onOpenChange: (open: boolean) => void

  document: DocumentSummary | null
}

export function DocumentPreviewDialog({
  open,

  onOpenChange,

  document,
}: DocumentPreviewDialogProps) {
  const isImage = document?.mime.startsWith("image/") ?? false

  const isPdf = document?.mime === "application/pdf"

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[46rem]">
        <DialogHeader>
          <DialogTitle>{document?.title ?? "Document"}</DialogTitle>
          <DialogDescription>
            {document
              ? `${document.filename} · ${formatBytes(document.sizeBytes)} · filed by ${document.uploadedByName}`
              : undefined}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex min-h-[16rem] items-center justify-center bg-muted/30">
          {!document ? (
            <EmptyState
              icon={Download}
              size="sm"
              title="Nothing to preview"
              description="This document is no longer available."
            />
          ) : isImage ? (
            <img
              src={documentFileUrl(document.id)}
              alt={document.title}
              className="max-h-[60vh] w-auto max-w-full object-contain"
            />
          ) : isPdf ? (
            <object
              data={documentFileUrl(document.id)}
              type="application/pdf"
              className="h-[60vh] w-full"
            >
              <p className="p-4 text-[12.5px] text-muted-foreground">
                This PDF cannot be shown inline.{" "}
                <a
                  className="text-primary underline"
                  href={documentFileUrl(document.id, true)}
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
              <a href={documentFileUrl(document.id, true)} download>
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
