CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  unit_id TEXT NOT NULL REFERENCES inventory_units (id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL REFERENCES customers (id) ON DELETE RESTRICT,
  quote_id TEXT REFERENCES unit_quotations (id) ON DELETE SET NULL,
  agent_user_id TEXT REFERENCES users (id) ON DELETE SET NULL,
  agent_name TEXT,
  dealer_id TEXT REFERENCES dealers (id) ON DELETE SET NULL,
  dealer_name TEXT,
  reference TEXT NOT NULL,
  unit_code TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  booking_amount INTEGER NOT NULL CHECK (booking_amount BETWEEN 0 AND 1000000000000),
  booking_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled')),
  terms TEXT NOT NULL CHECK (length(terms) BETWEEN 1 AND 2000),
  notes TEXT,
  created_by_user_id TEXT NOT NULL,
  created_by_name TEXT NOT NULL,
  cancelled_by_name TEXT,
  cancelled_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, reference)
);

CREATE INDEX IF NOT EXISTS idx_bookings_unit
  ON bookings (tenant_id, project_id, unit_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bookings_customer
  ON bookings (tenant_id, customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bookings_status
  ON bookings (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bookings_agent
  ON bookings (tenant_id, agent_user_id);
CREATE INDEX IF NOT EXISTS idx_bookings_dealer
  ON bookings (tenant_id, dealer_id);
