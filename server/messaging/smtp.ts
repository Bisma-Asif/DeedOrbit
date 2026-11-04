/**
 * A hand-rolled SMTP client over `node:net` / `node:tls`.
 *
 * The platform ships with no mail dependency, and it will not gain one for this
 * feature: the entire RFC-5321 conversation a payment reminder needs — EHLO,
 * STARTTLS when the server offers it, AUTH LOGIN, MAIL FROM / RCPT TO / DATA
 * with dot-stuffed bodies, QUIT — is a couple of hundred lines of explicit
 * socket arithmetic, and every line of it stays readable when a delivery fails
 * at 6pm against a server nobody in the office owns.
 *
 * Two rules keep it honest on an intranet host:
 *
 * - Every server read carries a 10-second idle timeout. A wedged connection
 *   becomes a failed ledger row with a legible reason, never a hung process.
 * - Every failure surfaces as an `Error` whose message contains the last server
 *   reply. The desk reads `smtp DATA: 552 5.3.4 message size exceeds fixed
 *   maximum`, not `Connection closed`.
 *
 * Only used when `EMAIL_MODE=live` and every `SMTP_*` variable exists; see
 * `providers.ts`. Nothing here decides whether mail *should* go out.
 */

import { randomUUID } from "node:crypto"

import net from "node:net"

import tls from "node:tls"

export interface SmtpConfig {
  host: string

  port: number

  user: string

  password: string

  from: string
}

export interface SmtpMessage {
  to: string

  subject: string

  body: string
}

export interface SmtpSendResult {
  /** The `Message-ID` header we minted, kept as the ledger's provider id. */

  messageId: string
}

const IDLE_TIMEOUT_MS = 10_000

/** Final reply line ("NNN text") versus a pending one ("NNN-text"). */

function isFinalLine(line: string): boolean {
  return /^\d{3} /.test(line)
}

function isCompleteLine(buffer: string, index: number): boolean {
  return /^\d{3}[ -]/.test(buffer.slice(index))
}

/**
 * The one conversation primitive: a socket that emits whole server replies.
 *
 * Bytes are buffered until a *final* status line arrives (a three-digit code
 * followed by a space), which is when RFC-5321 says the reply is complete —
 * multi-line responses end every continuation with `NNN-`. The idle timer is
 * rearmed on each chunk so a slow-but-still-talking server is never cut off,
 * while a silent one is.
 */

class SmtpSession {
  private buffer = ""

  private closed = false

  private pending: {
    resolve: (reply: string) => void

    reject: (error: Error) => void
  } | null = null

  private timer: NodeJS.Timeout | null = null

  private readonly socket: net.Socket

  constructor(socket: net.Socket) {
    this.socket = socket

    socket.on("data", (chunk) => this.feed(String(chunk)))

    socket.on("error", (error) => this.fail(error))

    socket.on("close", () => this.fail(new Error("connection closed")))
  }

  static connect(
    host: string,
    port: number,
    implicitTls: boolean,
  ): Promise<SmtpSession> {
    return new Promise((resolve, reject) => {
      const fail = (error: Error) => reject(error)

      const socket = implicitTls
        ? tls.connect({ host, port, servername: host }, () =>
            resolve(new SmtpSession(socket)),
          )
        : net.connect({ host, port }, () => resolve(new SmtpSession(socket)))

      socket.once("error", fail)
    })
  }

  /** STARTTLS: hand the already-wrapped socket to a fresh session. */

  upgradeToTls(serverName: string): Promise<SmtpSession> {
    // Detach this session first: the upgraded socket must not deliver the old

    // session's buffered plaintext to the TLS one.

    this.detach()

    return new Promise((resolve, reject) => {
      const secure = tls.connect(
        { socket: this.socket, servername: serverName },
        () => resolve(new SmtpSession(secure)),
      )

      secure.once("error", reject)
    })
  }

  private detach(): void {
    this.socket.removeAllListeners("data")

    this.socket.removeAllListeners("error")

    this.socket.removeAllListeners("close")
  }

  destroy(): void {
    this.detach()

    if (this.timer) clearTimeout(this.timer)

    this.socket.destroy()
  }

  private feed(text: string): void {
    if (this.closed) return

    this.buffer += text

    this.armTimeout()

    this.drain()
  }

  private drain(): void {
    if (!this.pending) return

    let lineStart = 0

    let newline = this.buffer.indexOf("\r\n", lineStart)

    // Walk whole lines; the reply is finished at the first final line.

    let end = -1

    while (newline !== -1) {
      if (
        isCompleteLine(this.buffer, lineStart) &&
        isFinalLine(this.buffer.slice(lineStart, newline))
      ) {
        end = newline + 2

        break
      }

      lineStart = newline + 2

      newline = this.buffer.indexOf("\r\n", lineStart)
    }

    if (end === -1) return

    const reply = this.buffer.slice(0, end)

    this.buffer = this.buffer.slice(end)

    const pending = this.pending

    this.pending = null

    if (this.timer) {
      clearTimeout(this.timer)

      this.timer = null
    }

    pending.resolve(reply.trim())
  }

  private fail(error: Error): void {
    this.closed = true

    if (this.timer) {
      clearTimeout(this.timer)

      this.timer = null
    }

    const pending = this.pending

    this.pending = null

    pending?.reject(error)
  }

  private armTimeout(): void {
    if (this.timer) clearTimeout(this.timer)

    this.timer = setTimeout(() => {
      this.fail(new Error(`server silent for ${IDLE_TIMEOUT_MS / 1000}s`))

      this.destroy()
    }, IDLE_TIMEOUT_MS)
  }

  /** Read one complete reply. */

  read(): Promise<string> {
    return new Promise((resolve, reject) => {
      if (this.closed) {
        reject(new Error("connection closed"))

        return
      }

      if (this.pending) {
        reject(new Error("a reply is already being read"))

        return
      }

      this.pending = { resolve, reject }

      this.armTimeout()

      // Bytes may have arrived between commands; try to settle immediately.

      this.drain()
    })
  }

  /** Send one command line and read the reply. */

  async cmd(line: string): Promise<string> {
    if (this.closed) throw new Error("connection closed")

    const reply = this.read()

    this.socket.write(`${line}\r\n`)

    return reply
  }

  /** Send raw bytes (the DATA payload) and read the reply. */

  async sendRaw(payload: string): Promise<string> {
    if (this.closed) throw new Error("connection closed")

    const reply = this.read()

    this.socket.write(payload)

    return reply
  }
}

/** Expect one of `codes`, or throw with the server's own words. */

async function expect(
  session: SmtpSession,

  step: string,

  line: string | null,

  codes: number[],
): Promise<string> {
  const reply = line === null ? await session.read() : await session.cmd(line)

  const code = Number(reply.slice(0, 3))

  if (!codes.includes(code)) {
    throw new Error(`smtp ${step}: ${reply.slice(0, 300)}`)
  }

  return reply
}

/** RFC 2047 base64 word — an Urdu subject crosses a plain-ASCII wire intact. */

function encodeHeader(value: string): string {
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`
}

/**
 * RFC-5321 dot-stuffing, with the line endings normalised to CRLF on the way.
 *
 * A body line starting with a full stop would otherwise end the DATA block a
 * paragraph early; doubling the leading dot is the whole cure. Lone CRs are
 * folded so the server sees exactly one terminator per line.
 */

function prepareBody(body: string): string {
  const lines = body.replace(/\r\n?/g, "\n").split("\n")

  return lines

    .map((line) => (line.startsWith(".") ? `.${line}` : line))

    .join("\r\n")
}

/**
 * One login, one message. Opens a fresh connection per call — reminders are a
 * daily trickle, not a queue worth a pooled connection — and always closes it.
 *
 * Throws an `Error` whose message carries the failing step and the server's
 * reply; the caller in `dispatch.ts` turns any throw into a `failed` ledger
 * row. Replies are validated for every step, so a server that says 421
 * "too busy" mid-RCPT is recorded as having said so.
 */

export async function sendEmail(
  config: SmtpConfig,

  message: SmtpMessage,
): Promise<SmtpSendResult> {
  const implicitTls = config.port === 465

  let session = await SmtpSession.connect(config.host, config.port, implicitTls)

  const uuid = randomUUID()

  const messageId = `<${uuid}@${config.host}>`

  try {
    await expect(session, "greeting", null, [220])

    let hello = await expect(session, "EHLO", `EHLO ${config.host}`, [250])

    if (!implicitTls && /STARTTLS/i.test(hello)) {
      await expect(session, "STARTTLS", "STARTTLS", [220])

      session = await session.upgradeToTls(config.host)

      hello = await expect(
        session,
        "EHLO after STARTTLS",
        `EHLO ${config.host}`,
        [250],
      )
    }

    if (/AUTH[^\r\n]*LOGIN/i.test(hello)) {
      await expect(session, "AUTH LOGIN", "AUTH LOGIN", [334])

      await expect(
        session,

        "SMTP username rejected",

        Buffer.from(config.user, "utf8").toString("base64"),

        [334],
      )

      await expect(
        session,

        "SMTP password rejected",

        Buffer.from(config.password, "utf8").toString("base64"),

        [235],
      )
    }

    await expect(session, "MAIL FROM", `MAIL FROM:<${config.from}>`, [250])

    await expect(session, "RCPT TO", `RCPT TO:<${message.to}>`, [250, 251])

    await expect(session, "DATA", "DATA", [354])

    const headers = [
      `Date: ${new Date().toUTCString()}`,

      `From: ${config.from}`,

      `To: ${message.to}`,

      `Subject: ${encodeHeader(message.subject)}`,

      `Message-ID: ${messageId}`,

      "MIME-Version: 1.0",

      "Content-Type: text/plain; charset=utf-8",

      "Content-Transfer-Encoding: 8bit",
    ].join("\r\n")

    // The payload has to be written before the final 250 can arrive, so DATA

    // goes through sendRaw and the code check runs on its reply directly.

    const dataReply = await session.sendRaw(
      `${headers}\r\n\r\n${prepareBody(message.body)}\r\n.\r\n`,
    )

    const dataCode = Number(dataReply.slice(0, 3))

    if (dataCode !== 250) {
      throw new Error(`smtp DATA: ${dataReply.slice(0, 300)}`)
    }

    try {
      await session.cmd("QUIT")
    } catch {
      // A server that drops us before QUIT still accepted the message; the
      // ledger records acceptance, not politeness.
    }

    return { messageId }
  } finally {
    session.destroy()
  }
}
