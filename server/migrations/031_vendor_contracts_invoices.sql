-- Vendor contracts and invoices.
--
-- A contract is a lightweight record of an agreed engagement: a reference, a title,
-- a value, a window. It exists so an invoice can name the deal it bills against and
-- so the vendor detail page can show what a supplier has been engaged for without
-- inventing an entire procurement module.
--
-- An invoice is the payable we raise when a vendor bills us. Creating an invoice
-- appends a positive `invoice` row to the vendor ledger; recording a payment (see
-- the vendors route) appends a negative `payment` row and flips the invoice to
-- `paid` once it is fully covered. Void is not a delete: it writes an equal and
-- opposite adjustment row so the running balance and the trail stay consistent.

CREATE TABLE IF NOT EXISTS vendor_contracts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  vendor_id TEXT NOT NULL REFERENCES vendors (id) ON DELETE CASCADE,
  reference TEXT NOT NULL,
  title TEXT NOT NULL,
  value INTEGER NOT NULL DEFAULT 0 CHECK (value BETWEEN 0 AND 1000000000000),
  currency TEXT NOT NULL,
  start_date TEXT,
  end_date TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_vendor_contract_reference
  ON vendor_contracts (tenant_id, vendor_id, reference);

CREATE INDEX IF NOT EXISTS idx_vendor_contracts_vendor
  ON vendor_contracts (tenant_id, vendor_id);

CREATE TABLE IF NOT EXISTS vendor_invoices (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  vendor_id TEXT NOT NULL REFERENCES vendors (id) ON DELETE CASCADE,
  contract_id TEXT REFERENCES vendor_contracts (id) ON DELETE SET NULL,
  reference TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount BETWEEN 1 AND 1000000000000),
  currency TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  due_at TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'paid', 'void')),
  paid_at TEXT,
  note TEXT,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_vendor_invoice_reference
  ON vendor_invoices (tenant_id, vendor_id, reference);

CREATE INDEX IF NOT EXISTS idx_vendor_invoices_status
  ON vendor_invoices (tenant_id, vendor_id, status, issued_at DESC);
