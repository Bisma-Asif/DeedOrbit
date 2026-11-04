-- Procurement: purchase orders and their lines.
--
-- A PO commits to one vendor. The supplier master stays `vendors` — this
-- table points at it and never copies it. `po_number` comes from the
-- organization's numbering settings (kind 'purchase_order'), so an issued
-- PO carries the tenant's own document format, like invoices and receipts.
--
-- Line totals are computed at creation from qty x unit price and stored,
-- because a PO line is a promise at a moment in time: if the material's
-- price moves later, the promise must not silently reprice itself.
-- Received quantity is NOT a column — it is the SUM over GRN lines (0046).

CREATE TABLE IF NOT EXISTS purchase_orders (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  po_number TEXT NOT NULL,
  vendor_id TEXT NOT NULL REFERENCES vendors (id),
  requisition_id TEXT REFERENCES purchase_requisitions (id) ON DELETE SET NULL,
  project_id TEXT REFERENCES projects (id) ON DELETE SET NULL,
  phase_id TEXT REFERENCES construction_phases (id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending_approval', 'approved', 'sent', 'partially_received', 'received', 'closed', 'cancelled')),
  currency TEXT NOT NULL,
  total_amount INTEGER NOT NULL DEFAULT 0 CHECK (total_amount BETWEEN 0 AND 1000000000000),
  notes TEXT,
  approval_id TEXT,
  created_by_user_id TEXT NOT NULL,
  created_by_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_purchase_order_number
  ON purchase_orders (tenant_id, po_number);

CREATE INDEX IF NOT EXISTS idx_purchase_orders_status
  ON purchase_orders (tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_purchase_orders_vendor
  ON purchase_orders (tenant_id, vendor_id);

CREATE TABLE IF NOT EXISTS purchase_order_lines (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  purchase_order_id TEXT NOT NULL REFERENCES purchase_orders (id) ON DELETE CASCADE,
  material_id TEXT REFERENCES materials (id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 1000000),
  unit TEXT NOT NULL,
  unit_price INTEGER NOT NULL CHECK (unit_price BETWEEN 0 AND 1000000000000),
  line_total INTEGER NOT NULL CHECK (line_total BETWEEN 0 AND 1000000000000),
  sequence INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_po_lines_order
  ON purchase_order_lines (purchase_order_id, sequence);

CREATE INDEX IF NOT EXISTS idx_po_lines_material
  ON purchase_order_lines (tenant_id, material_id);
