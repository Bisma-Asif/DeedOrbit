/**
 * Typed client for the customer portal and its staff-side access control.
 *
 * Mirrors `server/routes/portal.ts`. Every `/api/portal/*` read is scoped
 * server-side to the customer profiles linked to the signed-in login
 * (`customer_portal_links`); an unlinked `customer` gets a `403`
 * (`portal_not_linked`), so the client never passes an id it is not entitled to.
 *
 * The two `access` methods are the staff surface on a customer detail page:
 * reading who may see the account, and reconciling the linked logins.
 */

import type {
  PortalAccessState,
  PortalDocumentChecklist,
  PortalDocumentStatus,
  PortalDocumentUploadInput,
  PortalOverview,
  PortalPayments,
  PortalRequestDetail,
  PortalRequestInput,
  PortalRequestsResponse,
} from "@shared/portal"

import type { PortalNavKey } from "@shared/portal"

import type { PortalDocument } from "@shared/documents"

import type { TicketPriority } from "@shared/tickets"

import { api } from "./api"

export interface PortalNavItem {
  key: PortalNavKey

  label: string
}

export interface PortalOverviewResponse extends PortalOverview {
  nav: PortalNavItem[]
}

export interface PortalDocumentsResponse {
  documents: PortalDocument[]
}

export interface PortalRequestsListResponse extends PortalRequestsResponse {
  priorities: TicketPriority[]
}

export interface PortalRequestDetailResponse extends PortalRequestDetail {
  reference: string
}

export interface PortalCreateRequestResponse {
  ok: true

  requestId: string

  reference: string
}

export interface PortalCloseRequestResponse {
  ok: true

  status: string
}

export interface PortalCommentResponse {
  ok: true

  commentId: string
}

export interface PortalAttachmentResponse {
  ok: true

  attachmentId: string
}

export interface PortalAttachmentBody {
  filename: string

  dataUrl: string
}

export interface PortalUploadDocumentResponse {
  ok: true

  documentId: string

  status: PortalDocumentStatus
}

export interface PortalAccessResponse {
  ok: true

  linkedUserIds: string[]
}

/** Streams a customer-visible document the buyer owns. */

export function portalDocumentFileUrl(id: string, download = false): string {
  return `/api/portal/documents/${id}/file${download ? "?download=1" : ""}`
}

/** Streams one of the buyer's own request attachments. */

export function portalAttachmentUrl(
  requestId: string,

  attachmentId: string,
): string {
  return `/api/portal/requests/${requestId}/attachments/${attachmentId}`
}

export const portalApi = {
  overview: (signal?: AbortSignal) =>
    api.get<PortalOverviewResponse>("/api/portal/overview", signal),

  payments: (signal?: AbortSignal) =>
    api.get<PortalPayments>("/api/portal/payments", signal),

  documents: (signal?: AbortSignal) =>
    api.get<PortalDocumentsResponse>("/api/portal/documents", signal),

  // The checklist for one linked profile; the server scopes `customerId` to
  // the logins this portal is linked to and 403s anything else.
  documentChecklist: (customerId: string, signal?: AbortSignal) =>
    api.get<PortalDocumentChecklist>(
      `/api/portal/documents/checklist?customerId=${encodeURIComponent(customerId)}`,

      signal,
    ),

  uploadDocument: (input: PortalDocumentUploadInput) =>
    api.post<PortalUploadDocumentResponse>("/api/portal/documents", input),

  requests: (signal?: AbortSignal) =>
    api.get<PortalRequestsListResponse>("/api/portal/requests", signal),

  readRequest: (id: string, signal?: AbortSignal) =>
    api.get<PortalRequestDetailResponse>(`/api/portal/requests/${id}`, signal),

  createRequest: (input: PortalRequestInput) =>
    api.post<PortalCreateRequestResponse>("/api/portal/requests", input),

  closeRequest: (id: string) =>
    api.patch<PortalCloseRequestResponse>(`/api/portal/requests/${id}`, {
      status: "closed",
    }),

  comment: (id: string, body: string) =>
    api.post<PortalCommentResponse>(`/api/portal/requests/${id}/comments`, {
      body,
    }),

  uploadAttachment: (id: string, body: PortalAttachmentBody) =>
    api.post<PortalAttachmentResponse>(
      `/api/portal/requests/${id}/attachments`,

      body,
    ),

  // --- staff: who may read this customer's account --------------------------

  access: (customerId: string, signal?: AbortSignal) =>
    api.get<PortalAccessState>(
      `/api/customers/${customerId}/portal-access`,

      signal,
    ),

  setAccess: (customerId: string, userIds: string[]) =>
    api.put<PortalAccessResponse>(
      `/api/customers/${customerId}/portal-access`,

      { userIds },
    ),
}
