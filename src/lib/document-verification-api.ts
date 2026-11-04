/**
 * Typed client for the customer document verification module.
 *
 * Mirrors `server/routes/document-verification.ts`. The response shapes are
 * declared here (never imported from a server module) exactly the way
 * `dashboard-api.ts` declares its own, so the browser bundle stays free of
 * Node-only code. Only the shared vocabulary is imported — the checklist
 * states, the score, and the customer types live in `@shared/*` and are read
 * by both halves of the product.
 *
 * Honesty carried through the types: the review payload's CNIC fields are
 * `string | null` because the server withholds plaintext unless the caller
 * holds the reveal right, and the extracted suggestions are `string | null`
 * because a manual (default) OCR adapter returns nothing rather than a guess.
 */

import type { DocumentType } from "@shared/documents"

import type {
  CustomerType,
  DocumentChecklistState,
  DocumentOcrStatus,
  VerificationScore,
} from "@shared/document-verification"

import { api } from "./api"

/** One row of the verification queue, or a checklist's linked document. */

export interface QueueDocument {
  id: string

  customerId: string

  title: string

  filename: string

  mime: string

  sizeBytes: number

  checklistKey: string | null

  docType: string

  source: string

  ocrStatus: string

  expiresAt: string | null

  uploadedByUserId: string

  uploadedByName: string

  createdAt: string

  customerName: string | null
}

/** One required-or-optional slot on a customer's checklist. */

export interface DocumentChecklistEntry {
  key: string

  label: string

  baseDocType: DocumentType

  sensitive: boolean

  trackExpiry: boolean

  required: boolean

  state: DocumentChecklistState

  documentId: string | null

  expiresAt: string | null

  reuploadRequested: boolean

  rejectReason: string | null

  verificationStatus: string | null

  verifiedByName: string | null
}

/** `GET /api/customers/:id/document-checklist`. */

export interface DocumentChecklistResponse {
  customerId: string

  customerName: string

  customerType: CustomerType

  today: string

  entries: DocumentChecklistEntry[]

  missingRequiredKeys: string[]

  score: VerificationScore

  customerTypeLabel: string

  cnicMasked: string

  canVerify: boolean

  canUpload: boolean
}

/** Body for `POST /api/customers/:id/documents` (staff upload). */

export interface DocumentUploadInput {
  checklistKey: string

  title: string

  filename: string

  dataUrl: string

  expiresAt?: string | null

  cnic?: string | null

  name?: string | null

  guardianName?: string | null

  dob?: string | null

  expiry?: string | null
}

/** A duplicate pointer — the id only, never the matching value. */

export interface DuplicateRef {
  documentId: string

  customerId: string
}

/** `POST /api/customers/:id/documents` reply. */

export interface DocumentUploadResponse {
  document: QueueDocument

  flags: DocumentUploadFlags

  ocrStatus: DocumentOcrStatus
}

/** The duplicate flags surfaced right after an upload. */

export interface DocumentUploadFlags {
  duplicateFile: DuplicateRef | null

  duplicateCnic: DuplicateRef | null
}

/** `GET /api/documents/verification-queue` reply. */

export interface VerificationQueueResponse {
  items: QueueDocument[]

  limit: number

  offset: number

  canVerify: boolean
}

/** Query for the queue; the server defaults `status` to `under_review`. */

export interface VerificationQueueParams {
  status?: "under_review" | "unverified"

  checklistKey?: string

  customerId?: string

  limit?: number

  offset?: number
}

/** The short-lived signed file door. Bytes are fetched through `url`. */

export interface FileAccessGrant {
  token: string

  url: string

  expiresAt: string

  purpose: string

  maxUses: number

  watermark: boolean
}

/** `GET /api/documents/:id/review` — the self-contained side-by-side payload. */

export interface DocumentReviewResponse {
  document: QueueDocument

  verificationStatus: string | null

  rejectReason: string | null

  reuploadRequested: boolean

  reuploadReason: string | null

  verifiedVia: string | null

  verifiedByName: string | null

  verifiedAt: string | null

  providerRef: string | null

  customer: ReviewCustomer | null

  extracted: ReviewExtracted

  ocrStatus: DocumentOcrStatus

  mismatch: ReviewMismatch

  duplicateFile: DuplicateRef | null

  duplicateCnic: DuplicateRef | null

  preview: FileAccessGrant

  identityMode: "manual" | "provider"

  uploaderUserId: string

  canVerifyNow: boolean
}

/** The customer's own profile values, for side-by-side comparison. */

export interface ReviewCustomer {
  id: string

  fullName: string

  customerType: CustomerType

  cnicMasked: string

  cnic: string | null

  fatherHusbandName: string | null
}

/** The OCR suggestions a verifier confirms or overwrites (null when none). */

export interface ReviewExtracted {
  name: string | null

  cnic: string | null

  cnicMasked: string

  guardianName: string | null

  dob: string | null

  expiry: string | null
}

/** Field-level mismatch flags computed server-side. */

export interface ReviewMismatch {
  name: boolean

  cnic: boolean
}

/** `POST /api/documents/:id/verify` reply. */

export interface VerifyDocumentResponse {
  document: QueueDocument

  verificationStatus: string
}

/** `POST /api/documents/:id/reject` reply. */

export interface RejectDocumentResponse {
  verificationStatus: string

  reason: string
}

/** Body for `POST /api/documents/:id/reject` — reason is mandatory. */

export interface RejectDocumentInput {
  reason: string

  requestReupload?: boolean
}

/** `POST /api/documents/:id/request-reupload` reply. */

export interface RequestReuploadResponse {
  reuploadRequested: boolean

  reason: string
}

/** `POST /api/documents/:id/provider-verify` reply. */

export interface ProviderVerifyResponse {
  verificationStatus: string

  verifiedVia: string

  providerRef: string | null
}

/** `GET /api/documents/:id/cnic` — an audited plaintext reveal. */

export interface RevealCnicResponse {
  documentId: string

  cnic: string

  cnicMasked: string

  name: string | null

  guardianName: string | null

  dob: string | null

  expiry: string | null
}

/** `POST /api/documents/:id/access` reply. */

export interface DocumentAccessResponse {
  access: FileAccessGrant
}

/** One audit row from the download or reveal log. */

export interface DocumentAuditEntry {
  id: string

  action: string

  actorEmail: string | null

  actorUserId: string | null

  purpose: string | null

  ip: string | null

  createdAt: string
}

/** `GET /api/documents/:id/download-log` or `/reveal-log` reply. */

export interface DocumentLogResponse {
  entries: DocumentAuditEntry[]
}

/** The tenant's verification settings (`doc_verification_settings`). */

export interface DocVerificationSettings {
  blockBooking: boolean

  blockPlanActivation: boolean

  allowOverride: boolean

  watermarkPreviews: boolean

  retentionDays: number | null

  expiryAlertDays: number[]

  identityMode: "manual" | "provider"
}

/** `GET`/`PATCH /api/settings/document-verification` reply. */

export interface VerificationSettingsResponse {
  settings: DocVerificationSettings
}

/** Partial PATCH body — send only the fields that changed. */

export interface VerificationSettingsPatch {
  blockBooking?: boolean

  blockPlanActivation?: boolean

  allowOverride?: boolean

  watermarkPreviews?: boolean

  retentionDays?: number | null

  expiryAlertDays?: string

  identityMode?: "manual" | "provider"
}

/** The provider row as the settings screen sees it (no credential echoed). */

export interface IdentityProviderView {
  configured: boolean

  provider: string

  endpoint: string

  credentialHint: string | null

  enabled: boolean

  lastCheckedAt: string | null
}

/** `GET /api/settings/identity-provider` reply. */

export interface IdentityProviderResponse {
  provider: IdentityProviderView | null

  keySource: "env" | "file"
}

/** Body for `PATCH /api/settings/identity-provider`; blank credential keeps the stored one. */

export interface IdentityProviderPatch {
  provider: "generic" | "nadra_verisys"

  endpoint?: string

  credential?: string

  enabled?: boolean
}

/** `POST /api/settings/identity-provider/test` reply. */

export interface IdentityProviderTestResponse {
  ok: boolean

  message: string
}

/** One catalogue row for the admin editor. */

export interface DocumentTypeAdminItem {
  key: string

  label: string

  baseDocType: DocumentType

  sensitive: boolean

  ocr: boolean

  trackExpiry: boolean

  sortOrder: number

  enabled: boolean

  required: DocumentTypeRequirements
}

/** Required-ness per customer type for one catalogue key. */

export interface DocumentTypeRequirements {
  individual: boolean

  company: boolean

  overseas_pakistani: boolean
}

/** `GET /api/document-types` reply. */

export interface DocumentTypesResponse {
  types: DocumentTypeAdminItem[]

  canEdit: boolean
}

/** Body for `PATCH /api/document-types/:key`. */

export interface DocumentTypePatch {
  label?: string

  baseDocType?: DocumentType

  sensitive?: boolean

  ocr?: boolean

  trackExpiry?: boolean

  enabled?: boolean

  sortOrder?: number

  required?: Partial<DocumentTypeRequirements>
}

/** `PATCH /api/document-types/:key` reply. */

export interface DocumentTypePatchResponse {
  type: DocumentTypeAdminItem
}

function queueQuery(params: VerificationQueueParams): string {
  const search = new URLSearchParams()

  if (params.status) search.set("status", params.status)

  if (params.checklistKey) search.set("checklistKey", params.checklistKey)

  if (params.customerId) search.set("customerId", params.customerId)

  if (params.limit !== undefined) search.set("limit", String(params.limit))

  if (params.offset !== undefined) search.set("offset", String(params.offset))

  const query = search.toString()

  return query === "" ? "" : `?${query}`
}

export const documentVerificationApi = {
  // --- Checklist + staff upload ---------------------------------------------

  checklist: (customerId: string, signal?: AbortSignal) =>
    api.get<DocumentChecklistResponse>(
      `/api/customers/${customerId}/document-checklist`,

      signal,
    ),

  upload: (customerId: string, input: DocumentUploadInput) =>
    api.post<DocumentUploadResponse>(
      `/api/customers/${customerId}/documents`,

      input,
    ),

  // --- Verification queue + review ------------------------------------------

  queue: (params: VerificationQueueParams, signal?: AbortSignal) =>
    api.get<VerificationQueueResponse>(
      `/api/documents/verification-queue${queueQuery(params)}`,

      signal,
    ),

  review: (documentId: string, signal?: AbortSignal) =>
    api.get<DocumentReviewResponse>(
      `/api/documents/${documentId}/review`,
      signal,
    ),

  verify: (documentId: string) =>
    api.post<VerifyDocumentResponse>(`/api/documents/${documentId}/verify`),

  reject: (documentId: string, input: RejectDocumentInput) =>
    api.post<RejectDocumentResponse>(
      `/api/documents/${documentId}/reject`,

      input,
    ),

  requestReupload: (documentId: string, reason?: string) =>
    api.post<RequestReuploadResponse>(
      `/api/documents/${documentId}/request-reupload`,

      reason ? { reason } : {},
    ),

  providerVerify: (documentId: string) =>
    api.post<ProviderVerifyResponse>(
      `/api/documents/${documentId}/provider-verify`,
    ),

  // --- Reveal, signed access, audit logs ------------------------------------

  revealCnic: (documentId: string, signal?: AbortSignal) =>
    api.get<RevealCnicResponse>(`/api/documents/${documentId}/cnic`, signal),

  access: (documentId: string, purpose: "view" | "download") =>
    api.post<DocumentAccessResponse>(
      `/api/documents/${documentId}/access`,

      { purpose },
    ),

  downloadLog: (documentId: string, signal?: AbortSignal) =>
    api.get<DocumentLogResponse>(
      `/api/documents/${documentId}/download-log`,

      signal,
    ),

  revealLog: (documentId: string, signal?: AbortSignal) =>
    api.get<DocumentLogResponse>(
      `/api/documents/${documentId}/reveal-log`,

      signal,
    ),

  bulkRemind: (customerIds: string[]) =>
    api.post<Record<string, unknown>>(
      "/api/documents/bulk-remind",

      { customerIds },
    ),

  // --- Settings -------------------------------------------------------------

  getSettings: (signal?: AbortSignal) =>
    api.get<VerificationSettingsResponse>(
      "/api/settings/document-verification",

      signal,
    ),

  patchSettings: (patch: VerificationSettingsPatch) =>
    api.patch<VerificationSettingsResponse>(
      "/api/settings/document-verification",

      patch,
    ),

  getIdentityProvider: (signal?: AbortSignal) =>
    api.get<IdentityProviderResponse>(
      "/api/settings/identity-provider",

      signal,
    ),

  patchIdentityProvider: (input: IdentityProviderPatch) =>
    api.patch<IdentityProviderResponse>(
      "/api/settings/identity-provider",

      input,
    ),

  testIdentityProvider: () =>
    api.post<IdentityProviderTestResponse>(
      "/api/settings/identity-provider/test",
    ),

  // --- Catalogue admin ------------------------------------------------------

  listDocumentTypes: (signal?: AbortSignal) =>
    api.get<DocumentTypesResponse>("/api/document-types", signal),

  patchDocumentType: (key: string, patch: DocumentTypePatch) =>
    api.patch<DocumentTypePatchResponse>(
      `/api/document-types/${key}`,

      patch,
    ),
}
