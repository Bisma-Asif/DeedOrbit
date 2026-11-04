-- Collection targets and workload ownership.
--
-- A target is a monthly recovery goal for one officer, keyed to a YYYY-MM period, so the
-- dashboard can show achieved-versus-target per person and in aggregate. Separately, an
-- installment can carry an assigned collection officer so the overdue workload can be
-- grouped by owner; the column is nullable, meaning unassigned.

CREATE TABLE IF NOT EXISTS collection_targets (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  officer_user_id TEXT NOT NULL,
  period TEXT NOT NULL,
  target_amount INTEGER NOT NULL CHECK (target_amount BETWEEN 0 AND 1000000000000),
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, officer_user_id, period)
);

CREATE INDEX IF NOT EXISTS idx_collection_targets_period
  ON collection_targets (tenant_id, period);

-- The officer who owns the chase on a given schedule line. Nullable: an unassigned line
-- simply falls into the general overdue pool.
ALTER TABLE payment_installments ADD COLUMN collection_officer_user_id TEXT;
