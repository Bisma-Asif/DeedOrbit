-- Maker-checker approvals.
--
-- Two tables. `approval_policies` is the tenant's configuration: which actions are
-- routed through the queue and, for the amount-gated ones, the threshold above which
-- a request is required. Every row seeds disabled so a booking is confirmed and a
-- cancellation applied immediately until an admin deliberately turns a policy on —
-- the existing immediate behaviour and its tests stay green untouched.
--
-- `approvals` is the deferred-action queue itself. The pending state lives here and
-- not on the business row: a booking above threshold inserts a request carrying its
-- validated body as JSON and makes nothing, and only an approve replays that payload.
-- The shape is generic so discount / exceptional-pricing actions slot in later with
-- no new table.

CREATE TABLE IF NOT EXISTS approval_policies (
  tenant_id TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  action_key TEXT NOT NULL CHECK (action_key IN ('booking', 'cancellation', 'discount', 'exceptional_pricing')),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  threshold_amount INTEGER NOT NULL DEFAULT 0 CHECK (threshold_amount BETWEEN 0 AND 1000000000000),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, action_key)
);

CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  action_key TEXT NOT NULL CHECK (action_key IN ('booking', 'cancellation', 'discount', 'exceptional_pricing')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  summary TEXT,
  payload TEXT NOT NULL,
  entity_type TEXT,
  result_entity_id TEXT,
  requested_by_user_id TEXT NOT NULL,
  requested_by_name TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  decided_by_user_id TEXT,
  decided_by_name TEXT,
  decision_note TEXT,
  decided_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_approvals_status
  ON approvals (tenant_id, status, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_approvals_entity
  ON approvals (tenant_id, entity_type);
