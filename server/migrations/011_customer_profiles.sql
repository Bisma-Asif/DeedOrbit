ALTER TABLE customers RENAME TO customers_before_profiles;

CREATE TABLE customers (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  source_lead_id TEXT UNIQUE REFERENCES leads (id) ON DELETE SET NULL,
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  address_line1 TEXT,
  address_line2 TEXT,
  city TEXT,
  state_region TEXT,
  postal_code TEXT,
  country TEXT,
  id_document_type TEXT,
  id_document_number TEXT,
  id_issuing_authority TEXT,
  id_issue_date TEXT,
  id_expiry_date TEXT,
  nominee_name TEXT,
  nominee_relationship TEXT,
  nominee_phone TEXT,
  nominee_email TEXT,
  next_of_kin_name TEXT,
  next_of_kin_relationship TEXT,
  next_of_kin_phone TEXT,
  next_of_kin_email TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO customers (
  id, tenant_id, source_lead_id, full_name, phone, email, created_at, updated_at
)
SELECT id, tenant_id, source_lead_id, full_name, phone, email, created_at, updated_at
FROM customers_before_profiles;

DROP TABLE customers_before_profiles;

CREATE INDEX IF NOT EXISTS idx_customers_tenant_name
  ON customers (tenant_id, full_name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_customers_tenant_updated
  ON customers (tenant_id, updated_at DESC);
