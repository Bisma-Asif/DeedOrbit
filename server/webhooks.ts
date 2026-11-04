/**
 * Webhook dispatch — the only place a `webhook_deliveries` row is written.
 *
 * `emitEvent` is called by a business route *after* its transaction has
 * committed. It fires a real HTTP POST at every active endpoint subscribed to
 * the event, records exactly what the remote end said, and never lets a slow or
 * dead receiver change the caller's outcome: the helper returns a promise the
 * caller does not await in production, and every error is captured into the
 * delivery log rather than thrown back into the user's request.
 *
 * There is no background retry loop. A failed attempt leaves a failed row; five
 * in a row pause the endpoint with a reason a person can read, so a dead
 * receiver is not hammered forever. Restarting a paused endpoint is a deliberate
 * act in the Settings panel, not a silent reset.
 *
 * The body is signed the way the platform signs nothing else it cannot: an
 * `X-DeedOrbit-Signature: sha256=<hmac>` over the raw JSON, keyed by the
 * endpoint's secret. A receiver can prove the call came from us and that the
 * bytes were not altered in flight.
 */

import { createHmac, randomBytes } from "node:crypto"

import { all, get, run } from "./db.ts"

import {
  WEBHOOK_AUTO_PAUSE_AFTER,
  WEBHOOK_TIMEOUT_MS,
  DELIVERY_RESPONSE_SNIPPET_MAX,
  type DeliveryStatus,
  type WebhookEvent,
} from "../shared/integrations.ts"

const now = () => new Date().toISOString()

function idFor(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString("hex")}`
}

interface EndpointRow {
  id: string

  tenant_id: string

  url: string

  secret: string

  events: string

  status: string

  consecutive_failures: number
}

interface Attempt {
  status: DeliveryStatus

  httpStatus: number | null

  durationMs: number

  snippet: string | null
}

function endpointEvents(row: EndpointRow): string[] {
  try {
    const parsed = JSON.parse(row.events)

    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

/**
 * One real POST, timed and captured. Never throws: every failure mode — a
 * non-2xx status, a network error, a timeout — becomes an `Attempt` the caller
 * records. The abort is our own timeout, not a cancellation of the user's work.
 */

async function postOnce(
  url: string,

  body: string,

  secret: string,

  event: string,
): Promise<Attempt> {
  const started = Date.now()

  const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`

  try {
    const response = await fetch(url, {
      method: "POST",

      headers: {
        "content-type": "application/json",

        "user-agent": "DeedOrbit-Webhooks/1.0",

        "x-deedorbit-event": event,

        "x-deedorbit-signature": signature,
      },

      body,

      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    })

    let snippet: string | null = null

    try {
      const text = await response.text()

      snippet = text.slice(0, DELIVERY_RESPONSE_SNIPPET_MAX) || null
    } catch {
      snippet = null
    }

    return {
      status: response.ok ? "success" : "failed",

      httpStatus: response.status,

      durationMs: Date.now() - started,

      snippet,
    }
  } catch (error) {
    const timedOut =
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError")

    return {
      status: timedOut ? "timeout" : "failed",

      httpStatus: null,

      durationMs: Date.now() - started,

      snippet:
        error instanceof Error
          ? error.message.slice(0, DELIVERY_RESPONSE_SNIPPET_MAX)
          : null,
    }
  }
}

/**
 * Records one attempt against one endpoint and folds the outcome into its
 * counters. Kept separate from the fan-out so the "Send test" button can reuse
 * it against a single endpoint with the `is_test` flag set.
 */

export async function deliverToEndpoint(
  endpoint: EndpointRow,

  event: string,

  payload: Record<string, unknown>,

  isTest: boolean,
): Promise<string> {
  const body = JSON.stringify(payload)

  const attempt = await postOnce(endpoint.url, body, endpoint.secret, event)

  const deliveryId = idFor("whd")

  run(
    `INSERT INTO webhook_deliveries (
        id, tenant_id, endpoint_id, event, payload, status, http_status,
        duration_ms, response_snippet, is_test, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,

    deliveryId,

    endpoint.tenant_id,

    endpoint.id,

    event,

    body,

    attempt.status,

    attempt.httpStatus,

    attempt.durationMs,

    attempt.snippet,

    isTest ? 1 : 0,

    now(),
  )

  // A test never counts toward the live failure streak — it is an operator

  // poking the door, not the pipeline failing.

  if (!isTest) {
    if (attempt.status === "success") {
      run(
        `UPDATE webhook_endpoints
            SET consecutive_failures = 0,
                status = CASE WHEN pause_reason LIKE 'auto:%' THEN 'active' ELSE status END,
                pause_reason = CASE WHEN pause_reason LIKE 'auto:%' THEN NULL ELSE pause_reason END
          WHERE id = ?`,

        endpoint.id,
      )
    } else {
      const next = Number(endpoint.consecutive_failures ?? 0) + 1

      const tripped = next >= WEBHOOK_AUTO_PAUSE_AFTER

      run(
        `UPDATE webhook_endpoints
            SET failure_count = failure_count + 1,
                consecutive_failures = ?,
                status = CASE WHEN ? = 1 THEN 'paused' ELSE status END,
                pause_reason = CASE WHEN ? = 1 THEN ? ELSE pause_reason END
          WHERE id = ?`,

        next,

        tripped ? 1 : 0,

        tripped ? 1 : 0,

        `auto: ${next} consecutive failures`,

        endpoint.id,
      )
    }
  }

  return deliveryId
}

/**
 * Fan an event out to the tenant's subscribed endpoints. Returns a promise the
 * production caller ignores (`void emitEvent(...)`) so a slow endpoint cannot
 * delay the response, and a test can `await` to read the resulting log rows.
 */

export async function emitEvent(
  tenantId: string,

  event: WebhookEvent,

  payload: Record<string, unknown>,
): Promise<void> {
  const endpoints = all<EndpointRow>(
    `SELECT id, tenant_id, url, secret, events, status, consecutive_failures
       FROM webhook_endpoints
      WHERE tenant_id = ? AND status = 'active'`,

    tenantId,
  ).filter((endpoint) => endpointEvents(endpoint).includes(event))

  for (const endpoint of endpoints) {
    try {
      await deliverToEndpoint(endpoint, event, payload, false)
    } catch {
      // `deliverToEndpoint` already swallows per-attempt errors; this guards the
      // loop itself (e.g. a row vanished mid-flight) so one bad endpoint can
      // never abort the fan-out to the others.
    }
  }
}

/** Load one endpoint (tenant-scoped) as the dispatch path needs it. */

export function loadEndpointRow(
  tenantId: string,

  endpointId: string,
): EndpointRow | undefined {
  return get<EndpointRow>(
    `SELECT id, tenant_id, url, secret, events, status, consecutive_failures
       FROM webhook_endpoints
      WHERE tenant_id = ? AND id = ?`,

    tenantId,

    endpointId,
  )
}
