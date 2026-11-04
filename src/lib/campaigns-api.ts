/**
 * Typed client for campaigns and their public intake webhook.
 *
 * Mirrors `server/routes/campaigns.ts`. The list omits the webhook token on
 * purpose; `read` (the detail screen) is the only place it is returned, because
 * that is where an operator copies it onto a landing page. The token is the sole
 * gate on `submitLead`, which is registered public and takes no session — a
 * helper lives here so the integration snippet and any test share one typed shape.
 */

import type {
  Campaign,
  CampaignChannel,
  CampaignDetail,
  CampaignDetailResponse,
  CampaignIntegration,
  CampaignLeadPayload,
  CampaignWithMetrics,
  CampaignsResponse,
} from "@shared/campaigns"

import { api } from "./api"

export interface CampaignListResponse extends CampaignsResponse {
  channels: CampaignChannel[]

  channelLabels: Record<CampaignChannel, string>
}

export interface CampaignReadResponse extends CampaignDetailResponse {
  channelLabels: Record<CampaignChannel, string>
}

export interface CampaignCreateInput {
  name: string

  channel?: CampaignChannel

  source?: string

  notes?: string | null

  active?: boolean
}

export type CampaignUpdateInput = Partial<CampaignCreateInput>

export interface CampaignCreateResponse {
  ok: true

  campaignId: string

  webhookToken: string
}

export interface CampaignRotateResponse {
  ok: true

  webhookToken: string

  webhookPath: string
}

export interface CampaignLeadResponse {
  ok: true

  leadId: string
}

export const campaignsApi = {
  list: (signal?: AbortSignal) =>
    api.get<CampaignListResponse>("/api/campaigns", signal),

  read: (id: string, signal?: AbortSignal) =>
    api.get<CampaignReadResponse>(`/api/campaigns/${id}`, signal),

  create: (input: CampaignCreateInput) =>
    api.post<CampaignCreateResponse>("/api/campaigns", input),

  update: (id: string, input: CampaignUpdateInput) =>
    api.patch<{ ok: true }>(`/api/campaigns/${id}`, input),

  rotateToken: (id: string) =>
    api.post<CampaignRotateResponse>(`/api/campaigns/${id}/rotate-token`),

  archive: (id: string) =>
    api.delete<{
      ok: true
      archived: true
    }>(`/api/campaigns/${id}`),

  /** Public lead intake — no session, keyed only by the campaign token. */

  submitLead: (token: string, payload: CampaignLeadPayload) =>
    api.post<CampaignLeadResponse>(
      `/api/public/campaigns/${encodeURIComponent(token)}/leads`,

      payload,
    ),
}

export type {
  Campaign,
  CampaignDetail,
  CampaignIntegration,
  CampaignWithMetrics,
}
