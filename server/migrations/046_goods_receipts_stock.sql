-- Procurement: goods receipts and the stock ledger.
--
-- A GRN records what physically arrived against PO lines. Every
-- material-linked received line writes a matching `receipt` movement in the
-- same transaction — the receipt is the fact, the movement is its ledger
-- entry, and stock is only ever their sum.
--
-- `stock_movements` is append-only: corrections are new rows (a negative
-- `adjustment`), never edits, for the same reason the customer ledger is.
-- A voided GRN does not delete its movements; the void writes offsetting
-- adjustments so the trail still explains itself.

CREATE TABLE IF NOT EXISTS goods_receipt_notes (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  grn_number TEXT NOT NULL,
  purchase_order_id TEXT NOT NULL REFERENCES purchase_orders (id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects (id) ON DELETE SET NULL,
  received_at TEXT NOT NULL,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'recorded' CHECK (status IN ('recorded', 'voided')),
  invoice_id TEXT REFERENCES vendor_invoices (id) ON DELETE SET NULL,
  actor_user_id TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_grn_number
  ON goods_receipt_notes (tenant_id, grn_number);

CREATE INDEX IF NOT EXISTS idx_grn_po
  ON goods_receipt_notes (tenant_id, purchase_order_id, created_at DESC);

CREATE TABLE IF NOT EXISTS goods_receipt_lines (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  grn_id TEXT NOT NULL REFERENCES goods_receipt_notes (id) ON DELETE CASCADE,
  po_line_id TEXT NOT NULL REFERENCES purchase_order_lines (id) ON DELETE CASCADE,
  material_id TEXT REFERENCES materials (id) ON DELETE SET NULL,
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 1000000),
  note TEXT
);

CREATE INDEX IF NOT EXISTS idx_grn_lines_grn
  ON goods_receipt_lines (grn_id);

CREATE INDEX IF NOT EXISTS idx_grn_lines_po_line
  ON goods_receipt_lines (po_line_id);

CREATE TABLE IF NOT EXISTS stock_movements (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  material_id TEXT NOT NULL REFERENCES materials (id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('receipt', 'issue', 'adjustment', 'return')),
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN -1000000 AND 1000000),
  note TEXT,
  project_id TEXT REFERENCES projects (id) ON DELETE SET NULL,
  purchase_order_id TEXT REFERENCES purchase_orders (id) ON DELETE SET NULL,
  grn_id TEXT REFERENCES goods_receipt_notes (id) ON DELETE SET NULL,
  actor_user_id TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_stock_movements_material
  ON stock_movements (tenant_id, material_id, created_at DESC);
