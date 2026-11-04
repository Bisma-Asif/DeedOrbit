-- Platform billing: subscriptions and the platform's own ledger.
--
-- The tenants table already carried `plan` and a lifecycle `status`, but nothing
-- answered "is this workspace's subscription paid, and what did we bill it?".
-- Two tables close that gap. One row per tenant in `tenant_subscriptions` holds
-- the *stored* billing state — current, due, or an explicit granted grace window
-- with its reason. Whether a grace is still open is never stored: it is derived
-- from `grace_ends_at` at read time, exactly like installment due dates, so no
-- job has to flip anything and the reading cannot go stale between days.
--
-- `platform_billing_events` is the append-only timeline the platform area shows:
-- every invoice issued, payment received, due mark, grace grant, suspension, and
-- plan change, in one place. Money columns follow the platform's integer-major
-- convention and ceiling. Revenue is a *sum of recorded rows* — a tenant with no
-- recorded payments has zero, and nothing is back-filled by inference.
--
-- Existing workspaces are backfilled to `current`: no tenant was ever billed
-- before this feature existed, so claiming an outstanding balance would be
-- fabrication. Suspension itself stays on `tenants.status`, where the login
-- guard already reads it.

CREATE TABLE IF NOT EXISTS tenant_subscriptions (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants (id) ON DELETE CASCADE,
  billing_status TEXT NOT NULL DEFAULT 'current'
    CHECK (billing_status IN ('current','due','grace')),
  grace_ends_at TEXT,
  grace_reason TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS platform_billing_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN (
    'invoice','payment','billing_due','grace_granted','grace_expired',
    'suspension','reactivation','plan_change'
  )),
  amount INTEGER CHECK (amount IS NULL OR (amount >= 0 AND amount <= 1000000000000)),
  currency TEXT,
  note TEXT,
  actor_email TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_platform_billing_events
  ON platform_billing_events (tenant_id, created_at);

-- Backfill every workspace that predates this feature with a neutral, paid-up
-- subscription so the directory has a row to read for every tenant.
INSERT OR IGNORE INTO tenant_subscriptions (tenant_id, billing_status, updated_at)
  SELECT id, 'current', strftime('%Y-%m-%dT%H:%M:%fZ','now')
    FROM tenants;
