CREATE TABLE IF NOT EXISTS unit_quotations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  unit_id TEXT NOT NULL REFERENCES inventory_units (id) ON DELETE CASCADE,
  lead_id TEXT REFERENCES leads (id) ON DELETE SET NULL,
  customer_id TEXT REFERENCES customers (id) ON DELETE SET NULL,
  quote_number TEXT NOT NULL,
  unit_code TEXT NOT NULL,
  lead_name TEXT,
  customer_name TEXT,
  issued_by_user_id TEXT NOT NULL,
  issued_by_name TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  base_price INTEGER NOT NULL,
  discount_type TEXT NOT NULL CHECK (discount_type IN ('percent', 'fixed')),
  discount_value INTEGER NOT NULL DEFAULT 0,
  discount_amount INTEGER NOT NULL DEFAULT 0,
  extra_charges INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL,
  down_payment_percent INTEGER NOT NULL DEFAULT 0,
  installment_count INTEGER NOT NULL DEFAULT 1,
  payment_plan TEXT NOT NULL DEFAULT '[]',
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, project_id, unit_id, quote_number)
);

CREATE INDEX IF NOT EXISTS idx_unit_quotations_unit
  ON unit_quotations (tenant_id, project_id, unit_id, issued_at DESC);

CREATE INDEX IF NOT EXISTS idx_unit_quotations_customer
  ON unit_quotations (tenant_id, customer_id, issued_at DESC);

CREATE INDEX IF NOT EXISTS idx_unit_quotations_lead
  ON unit_quotations (tenant_id, lead_id, issued_at DESC);
