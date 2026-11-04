-- Widen the maker-checker queue to accept two document actions.
--
-- The same rebuild-and-swap as 018/029/050: SQLite cannot alter a CHECK in place,
-- so a widened twin replaces `approvals` and its two indexes are recreated. Every
-- existing row, action, status and decision is copied by value, so a workspace
-- with requests already in the queue is untouched.
--
-- `document_delete` — deleting a document that has already been verified is an
-- act that rewrites a certified file trail, so it is not a plain `documents.delete`
-- keystroke: it queues a request and only removes the row once a *different*
-- entitled user approves it.
--
-- `document_booking_override` — when the "all required documents verified" rule
-- blocks a booking or a plan, an override releases the block. It queues here so a
-- second person signs off on shipping a sale past a compliance gate, and the
-- decision (requester, decider, reason) is the log the spec asks for.
--
-- Neither is policy-configurable in Settings: like `expense`/`refund`, they are
-- unconditional-when-triggered, so they never appear in the toggle list.

CREATE TABLE approvals_new (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  action_key TEXT NOT NULL CHECK (action_key IN (
    'booking', 'cancellation', 'discount', 'exceptional_pricing',
    'refund', 'late_fee_waiver', 'transfer', 'expense',
    'requisition', 'purchase_order',
    'document_delete', 'document_booking_override'
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
