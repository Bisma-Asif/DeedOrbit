/**
 * Typed client for Settings > Integrations.
 *
 * Mirrors `server/routes/integrations.ts`, gated on `settings.view`/`settings.edit`.
 * Two honesty rules carry into the UI: a plaintext API key appears exactly once
 * (in the create response) and an endpoint signing secret appears exactly once
 * (in the create response) — every other read shows only the display prefix or a
 * null secret. The `test` call performs a real HTTP POST and returns that
 * attempt's delivery row, so the panel shows what actually came back.
 */

import type {
  ApiKeyCreateResponse,
  ApiKeyView,
  DeliveryListResponse,
  IntegrationsView,
  WebhookDeliveryView,
  WebhookEndpointListResponse,
  WebhookEndpointMutationResponse,
  WebhookEvent,
} from "@shared/integrations"

import { api } from "./api"

export type IntegrationsResult = IntegrationsView

export type EndpointListResult = WebhookEndpointListResponse

export type DeliveryListResult = DeliveryListResponse

export interface ApiKeyMutation {
  ok: true

  apiKey: ApiKeyView
}

export type EndpointMutationResult = WebhookEndpointMutationResponse

export interface TestDeliveryResult {
  ok: true

  delivery: WebhookDeliveryView
}

export interface ApiKeyInput {
  label: string

  ttlDays?: number | null
}

export interface EndpointInput {
  url: string

  events: WebhookEvent[]
}

export interface EndpointUpdateInput {
  url?: string

  events?: WebhookEvent[]

  status?: "active" | "paused"
}

function deliveryQuery(event?: string, status?: string): string {
  const params = new URLSearchParams()

  if (event) params.set("event", event)

  if (status) params.set("status", status)

  const qs = params.toString()

  return qs ? `?${qs}` : ""
}

const BASE = "/api/settings/integrations"

export const integrationsApi = {
  load: (signal?: AbortSignal) => api.get<IntegrationsResult>(BASE, signal),

  // API keys

  createApiKey: (input: ApiKeyInput) =>
    api.post<ApiKeyCreateResponse>(`${BASE}/api-keys`, input),

  revokeApiKey: (id: string) =>
    api.post<{ ok: true }>(`${BASE}/api-keys/${id}/revoke`),

  // Webhook endpoints

  listEndpoints: (signal?: AbortSignal) =>
    api.get<EndpointListResult>(`${BASE}/webhooks`, signal),

  createEndpoint: (input: EndpointInput) =>
    api.post<WebhookEndpointMutationResponse>(`${BASE}/webhooks`, input),

  updateEndpoint: (id: string, input: EndpointUpdateInput) =>
    api.patch<WebhookEndpointMutationResponse>(
      `${BASE}/webhooks/${id}`,

      input,
    ),

  testEndpoint: (id: string) =>
    api.post<TestDeliveryResult>(`${BASE}/webhooks/${id}/test`),

  // Delivery log

  listDeliveries: (event?: string, status?: string, signal?: AbortSignal) =>
    api.get<DeliveryListResult>(
      `${BASE}/deliveries${deliveryQuery(event, status)}`,

      signal,
    ),
}
