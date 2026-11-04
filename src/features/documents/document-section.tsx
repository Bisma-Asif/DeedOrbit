/**
 * The embedded documents section, mounted on a record's detail screen.
 *
 * A document is only meaningful beside the thing it belongs to, so there is no
 * Documents page: this is the surface. It lists the caller's readable documents
 * for one entity, offers upload/edit/delete within their grants, and previews or
 * downloads a file without leaving the record.
 *
 * Everything the row needs to decide what to show — `canView`, `canManage`,
 * `isExpired` — is computed server-side, because the answer depends on the
 * caller's per-type gates, not on the row. The client never re-derives them.
 */

import { useState } from "react"

import {
  AlertTriangle,
  Download,
  Eye,
  FileText,
  Pencil,
  Trash2,
  Upload,
} from "lucide-react"

import { Alert, AlertDescription } from "@/components/ui/alert"

import { Badge } from "@/components/ui/badge"

import { Button } from "@/components/ui/button"

import { EmptyState } from "@/components/empty-state"

import { Skeleton } from "@/components/ui/skeleton"

import { useSave } from "@/features/organization/use-save"

import { useSession } from "@/lib/session-context"

import { formatDate } from "@/lib/format"

import { useAsyncResource } from "@/lib/use-async-resource"

import { documentsApi, documentFileUrl } from "@/lib/documents-api"

import { formatBytes } from "./document-utils"

import { DocumentUploadDialog } from "./document-upload-dialog"

import { DocumentPreviewDialog } from "./document-preview-dialog"

import {
  DOCUMENT_TYPE_TONES,
  type DocumentEntityType,
  type DocumentSummary,
} from "@shared/documents"

interface DocumentSectionProps {
  entityType: DocumentEntityType

  entityId: string
}

export function DocumentSection({
  entityType,
  entityId,
}: DocumentSectionProps) {
  const { can } = useSession()

  const canView = can("documents", "view")

  const resource = useAsyncResource(
    (signal) => documentsApi.list(entityType, entityId, signal),

    canView,
  )

  const save = useSave()

  const [uploadOpen, setUploadOpen] = useState(false)

  const [editing, setEditing] = useState<DocumentSummary | null>(null)

  const [preview, setPreview] = useState<DocumentSummary | null>(null)

  if (!canView) {
    return (
      <EmptyState
        icon={FileText}
        size="sm"
        title="Documents not available"
        description="Your role cannot view documents attached to this record."
      />
    )
  }

  if (resource.loading && !resource.data) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
    )
  }

  const documents = resource.data?.documents ?? []

  const canCreate = resource.data?.canCreate ?? false

  async function remove(document: DocumentSummary) {
    const done = await save.run(async () => {
      await documentsApi.remove(document.id)
    })

    if (done) await resource.reload()
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[12.5px] text-muted-foreground">
          {documents.length === 0
            ? "No documents filed against this record yet."
            : `${documents.length} document${
                documents.length === 1 ? "" : "s"
              }.`}
        </p>
        {canCreate ? (
          <Button
            size="sm"
            onClick={() => {
              setEditing(null)

              setUploadOpen(true)
            }}
          >
            <Upload size={13} />
            Upload
          </Button>
        ) : null}
      </div>

      {resource.error ? (
        <Alert variant="danger">
          <AlertDescription>{resource.error}</AlertDescription>
        </Alert>
      ) : save.error ? (
        <Alert variant="danger">
          <AlertDescription>{save.error}</AlertDescription>
        </Alert>
      ) : null}

      {documents.length === 0 && !resource.error ? (
        <EmptyState
          icon={FileText}
          size="sm"
          title="No documents"
          description={
            canCreate
              ? "Upload an agreement, receipt, or ID copy to file it against this record."
              : "Nothing has been filed against this record that your role can read."
          }
        />
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
          {documents.map((document) => (
            <li
              key={document.id}
              className="flex items-center justify-between gap-3 px-3 py-2.5"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Badge variant={DOCUMENT_TYPE_TONES[document.docType]}>
                    {document.docTypeLabel}
                  </Badge>
                  <p className="truncate text-[13px] font-medium text-foreground">
                    {document.title}
                  </p>
                </div>
                <p className="mt-0.5 truncate text-[11.5px] text-muted-foreground">
                  {document.filename} · {formatBytes(document.sizeBytes)} · by{" "}
                  {document.uploadedByName} on {formatDate(document.createdAt)}
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
                {document.canView ? (
                  <>
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
                        href={documentFileUrl(document.id, true)}
                        download
                        aria-label={`Download ${document.title}`}
                      >
                        <Download size={13} />
                      </a>
                    </Button>
                  </>
                ) : null}
                {document.canManage ? (
                  <>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Edit ${document.title}`}
                      onClick={() => {
                        setEditing(document)

                        setUploadOpen(true)
                      }}
                    >
                      <Pencil size={13} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove ${document.title}`}
                      disabled={save.saving}
                      onClick={() => void remove(document)}
                    >
                      <Trash2 size={13} />
                    </Button>
                  </>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      <DocumentUploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        entityType={entityType}
        entityId={entityId}
        document={editing}
        onSaved={() => void resource.reload()}
      />

      <DocumentPreviewDialog
        open={preview !== null}
        onOpenChange={(open) => {
          if (!open) setPreview(null)
        }}
        document={preview}
      />
    </div>
  )
}
