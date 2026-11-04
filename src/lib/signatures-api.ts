/**
 * Typed client for Documents & Signatures.
 *
 * Mirrors `server/routes/signatures.ts`. The guarded surface manages templates
 * and envelopes over the session; the two ceremony calls hit the public
 * `/api/sign/*` routes, which authorise on the recipient's token alone — no
 * session, so the browser may call them straight from a link. The plaintext
 * signing token never returns to the client except in the send response's links.
 */

import type {
  CeremonyActionResponse,
  DocTemplateView,
  EnvelopeListResponse,
  EnvelopeMutationResponse,
  EnvelopeSendResponse,
  EnvelopeView,
  RecipientRole,
  SigningCeremonyView,
  TemplateListResponse,
} from "@shared/signatures"

import { api } from "./api"

export type TemplateListResult = TemplateListResponse

export type EnvelopeListResult = EnvelopeListResponse

export interface TemplateMutation {
  template: DocTemplateView
}

export interface EnvelopeDetailResult {
  envelope: EnvelopeView
}

export interface TemplateInput {
  name: string

  category?: string

  body: string
}

export interface TemplateUpdateInput {
  name?: string

  category?: string

  body?: string
}

export interface RecipientInput {
  name: string

  email: string

  role: RecipientRole

  signOrder?: number
}

export interface EnvelopeInput {
  title: string

  message?: string | null

  templateId?: string | null

  documentId?: string | null

  projectId?: string | null

  body?: string

  mergeValues?: Record<string, string>

  recipients: RecipientInput[]
}

export interface CeremonySignInput {
  recipientId: string

  action: "sign" | "decline"

  fullName: string

  message?: string
}

export const signaturesApi = {
  // Templates

  listTemplates: (signal?: AbortSignal) =>
    api.get<TemplateListResult>("/api/signatures/templates", signal),

  createTemplate: (input: TemplateInput) =>
    api.post<DocTemplateView>("/api/signatures/templates", input),

  updateTemplate: (id: string, input: TemplateUpdateInput) =>
    api.patch<DocTemplateView>(`/api/signatures/templates/${id}`, input),

  releaseTemplate: (id: string) =>
    api.post<DocTemplateView>(`/api/signatures/templates/${id}/release`),

  archiveTemplate: (id: string) =>
    api.post<DocTemplateView>(`/api/signatures/templates/${id}/archive`),

  // Envelopes

  listEnvelopes: (signal?: AbortSignal) =>
    api.get<EnvelopeListResult>("/api/signatures/envelopes", signal),

  createEnvelope: (input: EnvelopeInput) =>
    api.post<EnvelopeMutationResponse>("/api/signatures/envelopes", input),

  getEnvelope: (id: string, signal?: AbortSignal) =>
    api.get<EnvelopeDetailResult>(`/api/signatures/envelopes/${id}`, signal),

  sendEnvelope: (id: string, ttlDays?: number) =>
    api.post<EnvelopeSendResponse>(
      `/api/signatures/envelopes/${id}/send`,

      ttlDays ? { ttlDays } : {},
    ),

  voidEnvelope: (id: string, reason?: string) =>
    api.post<EnvelopeMutationResponse>(
      `/api/signatures/envelopes/${id}/void`,

      { reason: reason ?? "" },
    ),

  // Public ceremony (token-authorised, no session)

  readCeremony: (token: string, recipientId: string, signal?: AbortSignal) =>
    api.get<SigningCeremonyView>(
      `/api/sign/${encodeURIComponent(token)}?recipientId=${encodeURIComponent(recipientId)}`,

      signal,
    ),

  actOnCeremony: (token: string, input: CeremonySignInput) =>
    api.post<CeremonyActionResponse>(
      `/api/sign/${encodeURIComponent(token)}/sign`,

      input,
    ),
}
