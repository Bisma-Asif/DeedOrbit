/**
 * Delivery of one ledger row — the only path that turns a `queued` message
 * into a `sent` or `failed` one.
 *
 * The row already exists before this runs: the engine queued it (rendered body
 * and all) and the provider is called strictly after that commit, mirroring the
 * webhook convention — the caller fires and forgets (`void deliverMessage(...)`)
 * so a slow socket can never delay an HTTP response, and every error, including
 * one from the delivery plumbing itself, is captured into the row rather than
 * thrown at the caller.
 *
 * `in_app` rows are not dispatched here. They are staff notifications the
 * engine fans out through `notifyRecipients` at queue time; this file only
 * knows the three customer channels that have adapters.
 *
 * A row that is not `queued` when this runs — already sent, skipped, or being
 * retried by another tick — is left exactly as it is. Status moves forward
 * only, and a retry is an explicit act that re-queues the row first.
 */

import { get, run } from "../db.ts"

import { providerFor } from "./providers.ts"

const now = () => new Date().toISOString()

interface OutboundRow {
  id: string

  customer_id: string

  channel: string

  to_address: string

  subject: string

  body: string

  status: string
}

/**
 * Read, deliver, record. Returns the resulting status, or null when there was
 * nothing to do (row gone, not queued, or a channel with no adapter). Never
 * throws: an unexpected throw from the adapter surface itself becomes a
 * `failed` row with the error text, because a reminder that died quietly is
 * the one outcome this ledger must not produce.
 */

export async function deliverMessage(
  tenantId: string,

  messageId: string,

  nowIso: string = now(),
): Promise<"sent" | "failed" | null> {
  const row = get<OutboundRow>(
    `SELECT id, customer_id, channel, to_address, subject, body, status
       FROM outbound_messages
      WHERE tenant_id = ? AND id = ?`,

    tenantId,

    messageId,
  )

  if (!row || row.status !== "queued") return null

  const provider = providerFor(row.channel)

  if (!provider) return null

  let status: "sent" | "failed"

  let providerName: string

  let providerMessageId: string

  let error: string | null

  try {
    const outcome = await provider.deliver({
      messageId,

      customerId: row.customer_id,

      to: row.to_address,

      subject: row.subject,

      body: row.body,
    })

    status = outcome.status

    providerName = outcome.provider

    providerMessageId = outcome.providerMessageId

    error = outcome.error
  } catch (thrown) {
    status = "failed"

    providerName = row.channel

    providerMessageId = ""

    error = thrown instanceof Error ? thrown.message : String(thrown)
  }

  run(
    `UPDATE outbound_messages
        SET status = ?,
            provider = ?,
            provider_message_id = ?,
            error = ?,
            attempts = MIN(attempts + 1, 100),
            sent_at = ?
      WHERE tenant_id = ? AND id = ? AND status = 'queued'`,

    status,

    providerName,

    providerMessageId,

    error,

    status === "sent" ? nowIso : null,

    tenantId,

    messageId,
  )

  return status
}
