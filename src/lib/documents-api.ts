/**
 * Typed client for the documents store.
 *
 * Mirrors `server/routes/documents.ts`. There is no list-everything endpoint on
 * purpose: a document is only read beside the record it belongs to, so `list`
 * always names an entity (`project | unit | customer | booking`) and its id. The
 * summaries carry no bytes — the file is streamed separately from `fileUrl`,
 * which re-checks the per-type gate server-side before releasing anything.
 *
 * Upload takes a pre-encoded `dataUrl` because the browser can reject an
 * oversized or wrong-typed pick before any bytes travel, mirroring the same
 * mime list and byte cap the route enforces.
 */

import type {
  DocumentEntityType,
  DocumentSummary,
  DocumentType,
} from "@shared/documents"

import { api } from "./api"

export interface DocumentListResponse {
  documents: DocumentSummary[]

  entityType: DocumentEntityType

  entityId: string

  entityTypeLabel: string

  canCreate: boolean

  canEdit: boolean

  maxPerEntity: number
}

export interface DocumentCreateInput {
  entityType: DocumentEntityType

  entityId: string

  docType: DocumentType

  title: string

  filename: string

  dataUrl: string

  expiresAt?: string | null
}

export interface DocumentUpdateInput {
  title?: string

  docType?: DocumentType

  expiresAt?: string | null
}

export interface DocumentMutationResponse {
  ok: true

  document: DocumentSummary
}

/**
 * The URL that streams a stored document back.
 *
 * `download` flips the disposition from an inline preview to a save-as, so a
 * `<img>`/`<object>` preview and a "download" link share one endpoint.
 */

export function documentFileUrl(id: string, download = false): string {
  return `/api/documents/${id}/file${download ? "?download=1" : ""}`
}

export const documentsApi = {
  list: (
    entityType: DocumentEntityType,

    entityId: string,

    signal?: AbortSignal,
  ) =>
    api.get<DocumentListResponse>(
      `/api/documents?entityType=${encodeURIComponent(
        entityType,
      )}&entityId=${encodeURIComponent(entityId)}`,

      signal,
    ),

  create: (input: DocumentCreateInput) =>
    api.post<DocumentMutationResponse>("/api/documents", input),

  update: (id: string, input: DocumentUpdateInput) =>
    api.patch<DocumentMutationResponse>(`/api/documents/${id}`, input),

  remove: (id: string) => api.delete<{ ok: true }>(`/api/documents/${id}`),
}
