/**
 * Minimal HTTP plumbing on `node:http`: JSON in, JSON out, typed errors.
 *
 * The platform has no web framework dependency, so this file owns the small set
 * of concerns a framework would otherwise provide — body limits, cookie
 * parsing, error shapes, and CORS for the Vite dev origin.
 */

import type { IncomingMessage, ServerResponse } from "node:http"

export const MAX_BODY_BYTES = 64 * 1024

export class HttpError extends Error {
  status: number
  code: string
  details: Record<string, string> | null

  constructor(
    status: number,
    code: string,
    message: string,
    details?: Record<string, string>,
  ) {
    super(message)
    this.name = "HttpError"
    this.status = status
    this.code = code
    this.details = details ?? null
  }
}

export const badRequest = (message: string, details?: Record<string, string>) =>
  new HttpError(400, "bad_request", message, details)

export const unauthorized = (message: string, code = "unauthenticated") =>
  new HttpError(401, code, message)

export const forbidden = (message: string, code = "forbidden") =>
  new HttpError(403, code, message)

export const notFound = (message: string) =>
  new HttpError(404, "not_found", message)

export const conflict = (message: string, details?: Record<string, string>) =>
  new HttpError(422, "conflict", message, details)

export const tooManyRequests = (message: string) =>
  new HttpError(429, "rate_limited", message)

export type Json = Record<string, unknown> | unknown[]

/**
 * Reads and parses a JSON body.
 *
 * `maxBytes` exists for the one endpoint that legitimately needs more than the
 * global cap (logo upload). It is an argument rather than a raised constant so
 * a single oversized route cannot quietly widen the limit for every route.
 */
export async function readJsonBody<T = Json>(
  req: IncomingMessage,
  maxBytes: number = MAX_BODY_BYTES,
): Promise<T> {
  const chunks: Buffer[] = []
  let size = 0

  for await (const chunk of req) {
    const buffer = chunk as Buffer
    size += buffer.length
    if (size > maxBytes) {
      throw new HttpError(
        413,
        "payload_too_large",
        maxBytes === MAX_BODY_BYTES
          ? "Request body is too large"
          : `That upload is too large. The limit is ${Math.floor(maxBytes / 1024)} KB.`,
      )
    }
    chunks.push(buffer)
  }

  if (chunks.length === 0) return {} as T

  const raw = Buffer.concat(chunks).toString("utf8").trim()
  if (!raw) return {} as T

  try {
    return JSON.parse(raw) as T
  } catch {
    throw badRequest("Request body must be valid JSON")
  }
}

export function sendJson(
  res: ServerResponse,
  status: number,
  payload: unknown,
): void {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  })
  res.end(body)
}

export function sendError(res: ServerResponse, error: unknown): void {
  if (error instanceof HttpError) {
    sendJson(res, error.status, {
      error: {
        code: error.code,
        message: error.message,
        ...(error.details ? { fields: error.details } : {}),
      },
    })
    return
  }

  const message = error instanceof Error ? error.message : String(error)
  console.error("[api] unhandled error:", error)
  sendJson(res, 500, {
    error: {
      code: "internal_error",
      message: "Something went wrong on our side.",
    },
    ...(process.env.NODE_ENV !== "production" ? { detail: message } : {}),
  })
}

// --- Cookies ---------------------------------------------------------------

export function parseCookies(
  header: string | undefined,
): Record<string, string> {
  if (!header) return {}
  const out: Record<string, string> = {}

  for (const part of header.split(";")) {
    const index = part.indexOf("=")
    if (index < 1) continue
    const key = part.slice(0, index).trim()
    const value = part.slice(index + 1).trim()
    if (key) out[key] = decodeURIComponent(value)
  }
  return out
}

export function setCookie(
  res: ServerResponse,
  name: string,
  value: string,
  options: {
    maxAgeMs?: number
    httpOnly?: boolean
    sameSite?: "Strict" | "Lax" | "None"
    path?: string
    secure?: boolean
  } = {},
): void {
  const parts = [`${name}=${encodeURIComponent(value)}`]
  parts.push(`Path=${options.path ?? "/"}`)

  if (options.httpOnly !== false) parts.push("HttpOnly")
  parts.push(`SameSite=${options.sameSite ?? "Lax"}`)
  if (options.secure) parts.push("Secure")
  if (options.maxAgeMs !== undefined) {
    parts.push(`Max-Age=${Math.floor(options.maxAgeMs / 1000)}`)
  }

  const existing = res.getHeader("Set-Cookie")
  const cookie = parts.join("; ")
  if (Array.isArray(existing)) {
    res.setHeader("Set-Cookie", [...existing, cookie])
  } else {
    res.setHeader("Set-Cookie", [cookie])
  }
}

export function clearCookie(res: ServerResponse, name: string): void {
  setCookie(res, name, "", { maxAgeMs: 0 })
}

// --- Request context -------------------------------------------------------

export type RequestContext = {
  req: IncomingMessage
  res: ServerResponse
  method: string
  pathname: string
  query: URLSearchParams
  params: Record<string, string>
  cookies: Record<string, string>
  ip: string
  userAgent: string
}

export function clientIp(req: IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"]
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0]!.trim()
  }
  return req.socket.remoteAddress ?? "unknown"
}
