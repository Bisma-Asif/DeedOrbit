-- Widen the maker-checker queue to accept an expense payment sign-off.
--
-- SQLite cannot alter a CHECK in place, so the same rebuild-and-swap trick used in
-- 018_approvals_widen.sql applies here: create the widened twin, copy rows, drop the
-- original, rename the twin, and recreate the two indexes on `approvals`. The eight
-- existing keys keep behaving exactly as before; the new `expense` key simply
-- becomes legal. `approval_policies` does NOT carry `expense`, because an expense
-- payment is always routed through the queue and is not policy-configurable.

CREATE TABLE approvals_new (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  action_key TEXT NOT NULL CHECK (action_key IN (
    'booking', 'cancellation', 'discount', 'exceptional_pricing',
    'refund', 'late_fee_waiver', 'transfer', 'expense'
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
