-- Cancellation-charge rules, one row per workspace.
--
-- When a booking is cancelled the platform may keep a charge against money already paid
-- and refund the remainder. The rule is a single flat figure or a basis-point percentage
-- of the amount paid to date, optionally capped. `unit_outcome` decides whether the freed
-- unit returns to the sellable pool (`available`) or is held (`blocked`). The row defaults
-- to enabled with a zero charge so that, absent any explicit configuration, cancelling is
-- the plain status flip the earlier tests already expect — no ledger money is written.

CREATE TABLE IF NOT EXISTS cancellation_rules (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants (id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  mode TEXT NOT NULL DEFAULT 'percent' CHECK (mode IN ('fixed', 'percent')),
  amount INTEGER NOT NULL DEFAULT 0 CHECK (amount BETWEEN 0 AND 1000000000000),
  percent_bps INTEGER NOT NULL DEFAULT 0 CHECK (percent_bps BETWEEN 0 AND 10000),
  cap_amount INTEGER NOT NULL DEFAULT 0 CHECK (cap_amount BETWEEN 0 AND 1000000000000),
  unit_outcome TEXT NOT NULL DEFAULT 'available' CHECK (unit_outcome IN ('available', 'blocked')),
  updated_at TEXT NOT NULL
);
