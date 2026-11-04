-- The vendor ledger: an append-only journal of monetary events on a vendor account.
--
-- Structurally identical to `customer_ledger_entries`, but with the sign convention
-- flipped to match a payable: a positive amount raises what we owe the vendor (an
-- invoice, or a positive adjustment), a negative amount reduces it (a payment made,
-- or a reversal). The running balance is not stored; it is the signed sum at read
-- time, exactly as the customer ledger computes it, so it cannot drift from the trail.
--
-- `expense_id` lets a payment recorded through the Expenses module point back at
-- the row that triggered it; `invoice_id` lets a payable raised here point back at
-- the invoice that produced it. Both are nullable and neither is required for the
-- ledger to be honest — the amount is authoritative.

CREATE TABLE IF NOT EXISTS vendor_ledger_entries (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  vendor_id TEXT NOT NULL REFERENCES vendors (id) ON DELETE CASCADE,
  invoice_id TEXT REFERENCES vendor_invoices (id) ON DELETE SET NULL,
  expense_id TEXT REFERENCES expenses (id) ON DELETE SET NULL,
  contract_id TEXT REFERENCES vendor_contracts (id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('invoice', 'payment', 'adjustment')),
  amount INTEGER NOT NULL CHECK (amount BETWEEN -1000000000000 AND 1000000000000),
  currency TEXT NOT NULL,
  reference TEXT,
  source_type TEXT,
  source_id TEXT,
  occurred_at TEXT NOT NULL,
  note TEXT,
  recorded_by_user_id TEXT NOT NULL,
  recorded_by_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_vendor_ledger_vendor
  ON vendor_ledger_entries (tenant_id, vendor_id, occurred_at);

CREATE INDEX IF NOT EXISTS idx_vendor_ledger_invoice
  ON vendor_ledger_entries (tenant_id, invoice_id);
