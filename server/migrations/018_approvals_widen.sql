-- Widen the maker-checker queue to the money flows that always need a sign-off.
--
-- `approvals` and `approval_policies` were created with an inline CHECK that listed
-- only the four booking-era actions. SQLite cannot alter a CHECK in place, so both
-- tables are rebuilt: create the widened twin, copy the rows across, drop the original,
-- rename the twin into its place, and recreate the two indexes on `approvals`. No data
-- changes meaning — the four existing keys behave exactly as before — and the three new
-- keys (refund, late_fee_waiver, transfer) simply become legal values the queue can hold.

CREATE TABLE approval_policies_new (
  tenant_id TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  action_key TEXT NOT NULL CHECK (action_key IN (
    'booking', 'cancellation', 'discount', 'exceptional_pricing',
    'refund', 'late_fee_waiver', 'transfer'
  )),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  threshold_amount INTEGER NOT NULL DEFAULT 0 CHECK (threshold_amount BETWEEN 0 AND 1000000000000),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, action_key)
);

INSERT INTO approval_policies_new (tenant_id, action_key, enabled, threshold_amount, updated_at)
  SELECT tenant_id, action_key, enabled, threshold_amount, updated_at FROM approval_policies;

DROP TABLE approval_policies;

ALTER TABLE approval_policies_new RENAME TO approval_policies;

CREATE TABLE approvals_new (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  action_key TEXT NOT NULL CHECK (action_key IN (
    'booking', 'cancellation', 'discount', 'exceptional_pricing',
    'refund', 'late_fee_waiver', 'transfer'
  )),
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

INSERT INTO approvals_new (
  id, tenant_id, action_key, status, summary, payload, entity_type, result_entity_id,
  requested_by_user_id, requested_by_name, requested_at, decided_by_user_id,
  decided_by_name, decision_note, decided_at, updated_at
)
  SELECT
    id, tenant_id, action_key, status, summary, payload, entity_type, result_entity_id,
    requested_by_user_id, requested_by_name, requested_at, decided_by_user_id,
    decided_by_name, decision_note, decided_at, updated_at
  FROM approvals;

DROP TABLE approvals;

ALTER TABLE approvals_new RENAME TO approvals;

CREATE INDEX IF NOT EXISTS idx_approvals_status
  ON approvals (tenant_id, status, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_approvals_entity
  ON approvals (tenant_id, entity_type);
