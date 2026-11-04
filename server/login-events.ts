/**
 * Sign-in history.
 *
 * `audit_log` answers "who changed what" — every entry is an action by an
 * already-signed-in actor. It cannot answer "was this account used by someone
 * else?", because the interesting moments are the ones that never produced a
 * session: a wrong password, a lockout, a refused suspended account.
 *
 * So `login_events` is a separate, append-only table written on every
 * authentication attempt. It is deliberately narrow — no user agent parsing, no
 * geo, no retention policy — because the only question the members module asks
 * of it is "does this timeline look like this person?".
 *
 * Writing must never break sign-in, so every function here swallows its own
 * errors. A failure to record history must not become a failure to log in.
 */

import { newId } from "./crypto.ts"
import { all, run } from "./db.ts"

export const LOGIN_OUTCOMES = [
  "success",
  "failed",
  "suspended",
  "locked",
  "reset_required",
  "twofa_challenged",
] as const

export type LoginOutcome = typeof LOGIN_OUTCOMES[number]

/** The presentation split the members table and activity log share. */
export function isSuccessfulOutcome(outcome: string): boolean {
  return outcome === "success"
}

export function isWarningOutcome(outcome: string): boolean {
  return outcome === "twofa_challenged" || outcome === "reset_required"
}

export function isBlockedOutcome(outcome: string): boolean {
  return outcome === "failed" || outcome === "suspended" || outcome === "locked"
}

/**
 * Appends one attempt. `tenant_id` is nullable because a wrong password on an
 * address that exists in no workspace cannot be attributed to a tenant, and
 * recording it against a guessed tenant would be worse than not recording it.
 */
export function recordLoginEvent(event: {
  tenantId: string | null
  userId: string | null
  email: string
  outcome: LoginOutcome
  ip: string | null
  userAgent: string | null
}): void {
  try {
    run(
      `INSERT INTO login_events (
          id, tenant_id, user_id, email, outcome, ip_address, user_agent, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      newId("lgn"),
      event.tenantId,
      event.userId,
      event.email,
      event.outcome,
      event.ip,
      event.userAgent,
      new Date().toISOString(),
    )
  } catch {
    // History is best-effort. Losing a row is preferable to refusing a sign-in.
  }
}

export type LoginEvent = {
  id: string
  email: string
  outcome: LoginOutcome
  ipAddress: string | null
  userAgent: string | null
  createdAt: string
  success: boolean
}

type LoginEventRow = {
  id: string
  email: string
  outcome: string
  ip_address: string | null
  user_agent: string | null
  created_at: string
}

/**
 * One member's history, newest first.
 *
 * Scoped to `(tenant_id, user_id)` in SQL rather than filtered afterwards. A
 * `user_id` from another workspace must not be readable by guessing, and the
 * index on `(tenant_id, user_id, created_at DESC)` makes this a bounded scan.
 */
export function listLoginEvents(
  tenantId: string,
  userId: string,
  limit: number,
): LoginEvent[] {
  const rows = all<LoginEventRow>(
    `SELECT id, email, outcome, ip_address, user_agent, created_at
       FROM login_events
      WHERE tenant_id = ? AND user_id = ?
      ORDER BY created_at DESC
      LIMIT ?`,
    tenantId,
    userId,
    limit,
  )

  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    outcome: row.outcome as LoginOutcome,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    createdAt: row.created_at,
    success: isSuccessfulOutcome(row.outcome),
  }))
}

/**
 * How many of a member's recent attempts failed.
 *
 * Shown as a plain number beside the last sign-in so an administrator notices
 * a burst of failures without opening the timeline. Computed in SQL because the
 * answer is only meaningful over a window, not over the member's whole life.
 */
export function countRecentFailures(
  tenantId: string,
  userId: string,
  sinceIso: string,
): number {
  return (
    all<{ count: number }>(
      `SELECT COUNT(*) AS count
         FROM login_events
        WHERE tenant_id = ? AND user_id = ?
          AND created_at >= ?
          AND outcome IN ('failed', 'locked')`,
      tenantId,
      userId,
      sinceIso,
    )[0]?.count ?? 0
  )
}
