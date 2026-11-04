-- Month closing: a period the office has finished with.
--
-- One row per tenant per calendar month, and only for months someone has acted on - an
-- untouched month simply is not in this table, which is why reads treat a missing row as
-- 'open' rather than the table having to hold a row for every month of every workspace.
--
-- Closing blocks *writes*, not reads. Nothing here re-labels an installment, hides a
-- receipt, or freezes a report: the officer still sees the whole month, and the ledger is
-- still the ledger. What stops is recording a payment, amending one, or changing a
-- schedule line whose money falls into a period the office has already reported from,
-- because a figure that moves after the report went out is the failure this is here to
-- prevent. An override is allowed for the role that owns the money (`payments.approve`),
-- always with a reason, and the reason is what the audit row carries.
--
-- `period` is 'YYYY-MM' in the tenant's own reckoning - the same string the monthly
-- collection grid asks for and the same prefix `received_at` starts with.
CREATE TABLE IF NOT EXISTS month_periods (
  tenant_id TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  period TEXT NOT NULL CHECK (period GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  closed_by_user_id TEXT,
  closed_by_name TEXT,
  closed_at TEXT,
  note TEXT,
  -- Reopening is recorded rather than quietly allowed: the fact that a closed period was
  -- opened again, by whom, and why belongs on the same row as the closing.
  unlocked_by_user_id TEXT,
  unlock_reason TEXT,
  unlocked_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, period)
);

CREATE INDEX IF NOT EXISTS idx_month_periods_status
  ON month_periods (tenant_id, status, period DESC);
