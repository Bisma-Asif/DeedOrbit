-- Migration 0053 — dashboard overview support.
--
-- Two things the aggregated dashboard needs that the schema does not have yet:
--
--  * Read indexes. The overview answers each widget with one grouped query over
--    bookings, installments, payments, leads, customers, units, and documents,
--    always filtered by tenant and a date window. The existing indexes cover the
--    listing pages, but not these (tenant, date) scans, so the hot ones get a
--    dedicated index each. All are IF NOT EXISTS and add nothing to the write
--    paths' column sets.
--
--  * `dashboard_sample_rows`, the registry behind "Load sample data". Every row
--    the sample loader writes is recorded here by table and id, so removal is a
--    keyed delete in FK-safe order rather than a name-pattern guess — real data
--    can never be caught by it, and the demo rows are never left behind by it.

CREATE INDEX IF NOT EXISTS idx_bookings_tenant_date
  ON bookings (tenant_id, status, booking_date);

CREATE INDEX IF NOT EXISTS idx_installments_tenant_due
  ON payment_installments (tenant_id, due_date, status);

CREATE INDEX IF NOT EXISTS idx_payments_tenant_received
  ON payments (tenant_id, received_at);

CREATE INDEX IF NOT EXISTS idx_allocations_tenant_installment
  ON payment_allocations (tenant_id, installment_id);

CREATE INDEX IF NOT EXISTS idx_leads_tenant_created
  ON leads (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_customers_tenant_created
  ON customers (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_inventory_units_tenant_status
  ON inventory_units (tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_documents_tenant_created
  ON documents (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_approvals_tenant_status_request
  ON approvals (tenant_id, status, requested_at DESC);

CREATE TABLE IF NOT EXISTS dashboard_sample_rows (
  tenant_id  TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,

  -- The business table the demo row lives in, and its primary key. Deletion
  -- walks this list child-first; the FKs are the backstop if the order drifts.
  table_name TEXT NOT NULL
               CHECK (length(trim(table_name)) BETWEEN 1 AND 64),

  row_id     TEXT NOT NULL,

  created_at TEXT NOT NULL,

  PRIMARY KEY (tenant_id, table_name, row_id)
);

CREATE INDEX IF NOT EXISTS idx_dashboard_sample_rows_table
  ON dashboard_sample_rows (tenant_id, table_name);
