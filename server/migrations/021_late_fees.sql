-- Late-fee rules and the assessments they produce.
--
-- The rule is a single row per workspace, edited from Settings. Money is either a flat
-- figure or a percentage of the outstanding line; the percentage is stored as integer
-- basis points so it survives the whole-integer money convention. `grace_days` is the
-- wait after a due date before the first fee lands, and `max_assessments` (0 = unlimited)
-- caps how many times one overdue episode can be charged. An absent row means disabled.
--
-- One charged fee, per installment. The sweep is idempotent: it never re-assesses the
-- same installment beyond `max_assessments`, so re-running a read cannot double-charge.
-- A fee starts `applied` (a ledger debit already written). A waiver moves it through
-- `pending_waiver` while the approval is open, then `waived` (a matching ledger credit)
-- once a different user signs it off.

CREATE TABLE IF NOT EXISTS late_fee_rules (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants (id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  mode TEXT NOT NULL DEFAULT 'fixed' CHECK (mode IN ('fixed', 'percent')),
  amount INTEGER NOT NULL DEFAULT 0 CHECK (amount BETWEEN 0 AND 1000000000000),
  percent_bps INTEGER NOT NULL DEFAULT 0 CHECK (percent_bps BETWEEN 0 AND 10000),
  grace_days INTEGER NOT NULL DEFAULT 0 CHECK (grace_days BETWEEN 0 AND 365),
  max_assessments INTEGER NOT NULL DEFAULT 0 CHECK (max_assessments BETWEEN 0 AND 12),
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS late_fee_assessments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  installment_id TEXT NOT NULL REFERENCES payment_installments (id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  booking_id TEXT REFERENCES bookings (id) ON DELETE SET NULL,
  amount INTEGER NOT NULL CHECK (amount BETWEEN 0 AND 1000000000000),
  status TEXT NOT NULL DEFAULT 'applied' CHECK (status IN ('applied', 'pending_waiver', 'waived')),
  approval_id TEXT,
  reason TEXT,
  assessed_at TEXT NOT NULL,
  waived_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_late_fees_installment
  ON late_fee_assessments (tenant_id, installment_id);

CREATE INDEX IF NOT EXISTS idx_late_fees_customer
  ON late_fee_assessments (tenant_id, customer_id, assessed_at DESC);
