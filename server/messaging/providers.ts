/**
 * Channel adapters — the swap points between the ledger and the outside world.
 *
 * One interface, `MessageProvider`, sits between a queued `outbound_messages`
 * row and whatever might carry it. Email has two real implementations here:
 * the live SMTP client (`smtp.ts`), used only when `EMAIL_MODE=live` *and*
 * every `SMTP_*` variable exists, and a test mode that appends the rendered
 * message to `data/outbound-message-log.jsonl` and calls it sent with provider
 * `test` — a recorded, inspectable artifact, never a claim the customer got it.
 *
 * SMS and WhatsApp are wired behind the same adapter with the same ledger, but
 * they always resolve to test mode. A provider key in the environment
 * (`SMS_PROVIDER_KEY`, `WHATSAPP_PROVIDER_KEY`) marks the intent to go live;
 * the live client itself is the day someone signs a contract, and flipping that
 * day is one function body, not a schema or engine change. Until then every
 * log line says so out loud: "no provider connected - logged only".
 *
 * Credentials come from environment variables only and are never stored,
 * logged, or echoed anywhere a screen or a ledger row can read them.
 */

import { appendFileSync, mkdirSync } from "node:fs"

import { dirname, join } from "node:path"

import { fileURLToPath } from "node:url"

import {
  isMessageChannel,
  type MessageChannel,
} from "../../shared/communications.ts"

import { sendEmail, type SmtpConfig } from "./smtp.ts"

const here = dirname(fileURLToPath(import.meta.url))

/** Test-mode artifact: one JSON line per message that would have gone out. */

export const TEST_LOG_PATH = join(
  here,
  "..",
  "..",
  "data",
  "outbound-message-log.jsonl",
)

/** What a delivery needs from the ledger row, and who it belongs to. */

export interface DeliverInput {
  messageId: string

  customerId: string

  to: string

  subject: string

  body: string
}

/** The outcome folded back into the ledger row by `dispatch.ts`. */

export interface DeliverOutcome {
  status: "sent" | "failed"

  provider: string

  providerMessageId: string

  error: string | null
}

export interface MessageProvider {
  channel: MessageChannel

  deliver(input: DeliverInput): Promise<DeliverOutcome>
}

// --- Environment ------------------------------------------------------------

function envText(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : ""
}

/** Live email needs all five variables; anything less is test mode. */

export interface EmailLiveMode {
  mode: "live"

  smtp: SmtpConfig
}

export interface EmailTestMode {
  mode: "test"
}

/**
 * Live email requires all five variables; anything less falls back to test.
 * A half-configured mail server is the most common accident on a new intranet
 * install, and the fallback is always honest: the ledger says provider `test`.
 */

export function emailMode(): EmailLiveMode | EmailTestMode {
  if (envText(process.env.EMAIL_MODE).toLowerCase() !== "live")
    return { mode: "test" }

  const host = envText(process.env.SMTP_HOST)

  const port = Number(envText(process.env.SMTP_PORT))

  const user = envText(process.env.SMTP_USER)

  const password =
    typeof process.env.SMTP_PASS === "string" ? process.env.SMTP_PASS : ""

  const from = envText(process.env.SMTP_FROM)

  if (
    !host ||
    !Number.isInteger(port) ||
    port <= 0 ||
    port > 65535 ||
    !user ||
    !password ||
    !from
  ) {
    return { mode: "test" }
  }

  return { mode: "live", smtp: { host, port, user, password, from } }
}

// --- Test mode ---------------------------------------------------------------

function appendTestLog(entry: Record<string, unknown>): void {
  mkdirSync(dirname(TEST_LOG_PATH), { recursive: true })

  appendFileSync(TEST_LOG_PATH, `${JSON.stringify(entry)}\n`, "utf8")
}

/**
 * The one function test mode is made of: write the rendered message where a
 * person can read it, and report `sent` with provider `test`. The row's
 * provider column is what keeps this honest on the Reminders page — a `test`
 * send is visibly a test send forever after.
 */

function deliverInTestMode(
  channel: MessageChannel,

  input: DeliverInput,

  note: string,
): DeliverOutcome {
  appendTestLog({
    at: new Date().toISOString(),

    channel,

    customerId: input.customerId,

    messageId: input.messageId,

    to: input.to,

    subject: input.subject,

    body: input.body,

    provider: "test",

    note,
  })

  return {
    status: "sent",

    provider: "test",

    providerMessageId: "",

    error: null,
  }
}

// --- The adapters -------------------------------------------------------------

const emailProvider: MessageProvider = {
  channel: "email",

  async deliver(input) {
    const config = emailMode()

    if (config.mode === "test") {
      return deliverInTestMode(
        "email",
        input,
        "email in test mode - logged only",
      )
    }

    try {
      const result = await sendEmail(config.smtp, {
        to: input.to,

        subject: input.subject,

        body: input.body,
      })

      return {
        status: "sent",

        provider: "smtp",

        providerMessageId: result.messageId,

        error: null,
      }
    } catch (error) {
      return {
        status: "failed",

        provider: "smtp",

        providerMessageId: "",

        error: error instanceof Error ? error.message : String(error),
      }
    }
  },
}

/**
 * SMS: adapter wired, provider not connected. `SMS_PROVIDER_KEY` is the swap
 * signal for the day a gateway contract exists; until then this logs, exactly
 * as test-mode email does, and the ledger says `test`.
 */

const smsProvider: MessageProvider = {
  channel: "sms",

  async deliver(input) {
    return deliverInTestMode(
      "sms",

      input,

      envText(process.env.SMS_PROVIDER_KEY)
        ? "provider key present but no live adapter implemented - logged only"
        : "no provider connected - logged only",
    )
  },
}

/** WhatsApp: the same honest test mode as SMS, keyed by `WHATSAPP_PROVIDER_KEY`. */

const whatsappProvider: MessageProvider = {
  channel: "whatsapp",

  async deliver(input) {
    return deliverInTestMode(
      "whatsapp",

      input,

      envText(process.env.WHATSAPP_PROVIDER_KEY)
        ? "provider key present but no live adapter implemented - logged only"
        : "no provider connected - logged only",
    )
  },
}

const PROVIDERS: Record<MessageChannel, MessageProvider> = {
  email: emailProvider,

  sms: smsProvider,

  whatsapp: whatsappProvider,
}

export function providerFor(channel: string): MessageProvider | null {
  return isMessageChannel(channel) ? PROVIDERS[channel] : null
}

// --- Recipient resolution -----------------------------------------------------

/** The contact columns a queue path must read to resolve any channel. */

export interface ContactRow {
  email: string | null

  phone: string | null

  whatsapp: string | null
}

/**
 * Where a channel actually reaches this customer, or the empty string. Email
 * goes to their email; SMS to their phone; WhatsApp to their WhatsApp number
 * when they gave one, falling back to the phone a workspace would dial anyway.
 * An empty result is the engine's `no_address` skip — never a silent drop.
 */

export function resolveRecipientAddress(
  channel: MessageChannel,

  contact: ContactRow,
): string {
  if (channel === "email") return envText(contact.email)

  if (channel === "sms") return envText(contact.phone)

  return envText(contact.whatsapp) || envText(contact.phone)
}
