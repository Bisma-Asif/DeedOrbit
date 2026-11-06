/**
 * Public "Book a Demo" intake for the marketing site.
 *
 * POST /api/demo-requests is intentionally public (a visitor has no session yet),
 * so it carries its own field validation and a per-IP throttle rather than leaning
 * on the authenticated request middleware. Each accepted enquiry is stored in the
 * platform-level `demo_requests` table for the operator to follow up.
 *
 * GET /api/demo-requests is the operator's read side and requires a session.
 */

import { all, run } from "../db.ts"

import {
  badRequest,
  readJsonBody,
  tooManyRequests,
  type RequestContext,
} from "../http.ts"

import { newId } from "../crypto.ts"

import { requireAuth } from "../middleware.ts"

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

// --- Throttle --------------------------------------------------------------

type Bucket = { count: number; resetAt: number }

const WINDOW_MS = 10 * 60 * 1000
const MAX_PER_WINDOW = 8

const buckets = new Map<string, Bucket>()

function throttle(ip: string): void {
  const now = Date.now()
  const existing = buckets.get(ip)
  if (!existing || existing.resetAt <= now) {
    buckets.set(ip, { count: 1, resetAt: now + WINDOW_MS })
    return
  }
  existing.count += 1
  if (existing.count > MAX_PER_WINDOW) {
    throw tooManyRequests(
      "Too many demo requests from this address. Please try again later.",
    )
  }
}

function trimmed(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : ""
}

/** POST /api/demo-requests */
export async function create(ctx: RequestContext) {
  throttle(ctx.ip)

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const name = trimmed(body.name, 120)
  const company = trimmed(body.company, 160)
  const email = trimmed(body.email, 160)
  const phone = trimmed(body.phone, 40)

  const errors: Record<string, string> = {}
  if (name.length < 2) errors.name = "Please enter your name"
  if (company.length < 2) errors.company = "Please enter your company name"
  if (!EMAIL_PATTERN.test(email)) errors.email = "Please enter a valid email"
  if (Object.keys(errors).length > 0) {
    throw badRequest("Please check the highlighted fields", errors)
  }

  const projectsRaw = body.projects
  let projects: number | null = null
  if (projectsRaw !== undefined && projectsRaw !== null && projectsRaw !== "") {
    const parsed = Number(projectsRaw)
    if (Number.isFinite(parsed) && parsed >= 0) projects = Math.floor(parsed)
  }

  const id = newId("demo")
  const now = new Date().toISOString()

  run(
    `INSERT INTO demo_requests (
        id, name, company, email, phone, projects, source, status, ip,
        created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, 'landing', 'new', ?, ?, ?)`,
    id,
    name,
    company,
    email,
    phone || null,
    projects,
    ctx.ip,
    now,
    now,
  )

  return { id, status: "received" as const }
}

/** GET /api/demo-requests — operator read side (authenticated). */
export async function list(ctx: RequestContext) {
  requireAuth(ctx)
  return {
    items: all<Record<string, unknown>>(
      "SELECT id, name, company, email, phone, projects, status, created_at FROM demo_requests ORDER BY created_at DESC LIMIT 200",
    ),
  }
}
