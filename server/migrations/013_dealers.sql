CREATE TABLE IF NOT EXISTS dealers (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  portal_user_id TEXT REFERENCES users (id) ON DELETE SET NULL,
  company_name TEXT NOT NULL CHECK (length(trim(company_name)) BETWEEN 1 AND 120),
  contact_name TEXT NOT NULL CHECK (length(trim(contact_name)) BETWEEN 1 AND 120),
  email TEXT,
  phone TEXT NOT NULL,
  business_registration TEXT,
  tax_id TEXT,
  address TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, portal_user_id)
);

ALTER TABLE leads ADD COLUMN assigned_dealer_id TEXT REFERENCES dealers (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_dealers_tenant_company
  ON dealers (tenant_id, company_name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_dealers_tenant_status
  ON dealers (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_leads_tenant_dealer
  ON leads (tenant_id, assigned_dealer_id);

CREATE TABLE IF NOT EXISTS dealer_commission_rules (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  dealer_id TEXT NOT NULL REFERENCES dealers (id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK (scope IN ('project', 'unit_type')),
  project_id TEXT REFERENCES projects (id) ON DELETE CASCADE,
  unit_type TEXT CHECK (unit_type IN ('plot', 'apartment', 'shop', 'office', 'villa')),
  commission_type TEXT NOT NULL CHECK (commission_type IN ('percentage', 'fixed')),
  commission_value REAL NOT NULL CHECK (commission_value >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    (scope = 'project' AND project_id IS NOT NULL AND unit_type IS NULL) OR
    (scope = 'unit_type' AND project_id IS NULL AND unit_type IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_dealer_rules_project
  ON dealer_commission_rules (tenant_id, dealer_id, project_id)
  WHERE scope = 'project';
CREATE UNIQUE INDEX IF NOT EXISTS idx_dealer_rules_unit_type
  ON dealer_commission_rules (tenant_id, dealer_id, unit_type)
  WHERE scope = 'unit_type';
CREATE INDEX IF NOT EXISTS idx_dealer_rules_dealer
  ON dealer_commission_rules (tenant_id, dealer_id, scope);

CREATE TABLE IF NOT EXISTS dealer_bookings (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  dealer_id TEXT NOT NULL REFERENCES dealers (id) ON DELETE CASCADE,
  lead_id TEXT REFERENCES leads (id) ON DELETE SET NULL,
  booking_reference TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects (id),
  unit_type TEXT NOT NULL CHECK (unit_type IN ('plot', 'apartment', 'shop', 'office', 'villa')),
  booking_amount INTEGER NOT NULL CHECK (booking_amount >= 0),
  booking_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'cancelled')),
  commission_rule_id TEXT REFERENCES dealer_commission_rules (id) ON DELETE SET NULL,
  commission_type TEXT CHECK (commission_type IN ('percentage', 'fixed')),
  commission_value REAL,
  commission_amount INTEGER CHECK (commission_amount IS NULL OR commission_amount >= 0),
  created_by TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, booking_reference)
);

CREATE TABLE IF NOT EXISTS dealer_commission_payments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  dealer_id TEXT NOT NULL REFERENCES dealers (id) ON DELETE CASCADE,
  booking_id TEXT NOT NULL REFERENCES dealer_bookings (id) ON DELETE RESTRICT,
  amount INTEGER NOT NULL CHECK (amount > 0),
  paid_on TEXT NOT NULL,
  note TEXT,
  recorded_by TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_dealer_bookings_dealer_date
  ON dealer_bookings (tenant_id, dealer_id, booking_date DESC);
CREATE INDEX IF NOT EXISTS idx_dealer_bookings_status
  ON dealer_bookings (tenant_id, status, dealer_id);
CREATE INDEX IF NOT EXISTS idx_dealer_commission_payments_booking
  ON dealer_commission_payments (tenant_id, booking_id, paid_on);
