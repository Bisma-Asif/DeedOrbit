-- The tenant's chart-of-accounts mapping.
--
-- One row per money-flow source the platform knows how to produce. A row's
-- `account_code` is a short ASCII slug the tenant uses in their outside accounting
-- system. An empty code is a legal, honest value: it means the tenant has not
-- mapped that source yet, so a journal export emits the row with a blank code and
-- an `unmapped` flag rather than fabricating one.
--
-- The `source` column is the closed enum declared in shared/chart-of-accounts.ts.
-- Adding a new source means widening this CHECK alongside the shared list, which
-- is the whole point — the schema and the vocabulary cannot drift apart silently.

CREATE TABLE IF NOT EXISTS chart_of_account_mappings (
  tenant_id TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN (
    'booking_income', 'receivables', 'discounts', 'late_fee_income',
    'cancellation_charge', 'expense_project', 'expense_office',
    'expense_marketing', 'expense_construction', 'vendor_payable', 'vendor_payment'
  )),
  account_code TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, source)
);

CREATE INDEX IF NOT EXISTS idx_coa_tenant
  ON chart_of_account_mappings (tenant_id);
