-- The vendors module.
--
-- A supplier the tenant pays: a contractor, a marketing agency, an office supply
-- house. A vendor is a catalogue row, not a user, so it does not carry credentials
-- or a session. Its money trail lives in the vendor ledger below; contracts and
-- invoices (migration 031) hang off it.
--
-- Unique `(tenant_id, name)` prevents accidental duplicates in the payables list —
-- two "Al Noor Contracting" rows would split the running balance and misreport what
-- we owe. Renaming a vendor is a PATCH, and there is no delete; archiving stops it
-- appearing in the pickers without erasing the trail.

CREATE TABLE IF NOT EXISTS vendors (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  contact_name TEXT,
  email TEXT,
  phone TEXT,
  tax_id TEXT,
  address_line1 TEXT,
  address_line2 TEXT,
  city TEXT,
  country_code TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_vendors_name
  ON vendors (tenant_id, name);

CREATE INDEX IF NOT EXISTS idx_vendors_status
  ON vendors (tenant_id, status, name);
