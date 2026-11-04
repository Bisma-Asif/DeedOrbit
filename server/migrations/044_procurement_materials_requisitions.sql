-- Procurement: materials and purchase requisitions.
--
-- A material's stock on hand is NEVER a column here. It is the SUM of its
-- movements (0046), so every change of quantity is a recorded fact and no
-- screen can show a number that no ledger row backs. `target_stock` is
-- nullable: no target means "no opinion", rendered as a dash — not zero,
-- which would make every unmeasured material look critically low.
--
-- A requisition is a request to spend, not a spend. Its line items are a
-- JSON array on the row (an internal working list, never a money ledger),
-- and approval reuses the existing approvals machinery with entity type
-- 'requisition' — the same maker-checker that settles expenses.

CREATE TABLE IF NOT EXISTS materials (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'material' CHECK (category IN ('material', 'equipment', 'consumable', 'spare')),
  unit_of_measure TEXT NOT NULL,
  target_stock INTEGER CHECK (target_stock BETWEEN 0 AND 1000000),
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_material_sku
  ON materials (tenant_id, sku);

CREATE INDEX IF NOT EXISTS idx_materials_status
  ON materials (tenant_id, status, name);

CREATE TABLE IF NOT EXISTS purchase_requisitions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  reference TEXT NOT NULL,
  justification TEXT NOT NULL,
  needed_by TEXT,
  project_id TEXT REFERENCES projects (id) ON DELETE SET NULL,
  phase_id TEXT REFERENCES construction_phases (id) ON DELETE SET NULL,
  estimated_amount INTEGER CHECK (estimated_amount BETWEEN 1 AND 1000000000000),
  currency TEXT NOT NULL,
  line_items TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'rejected', 'converted')),
  approval_id TEXT,
  created_by_user_id TEXT NOT NULL,
  created_by_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_requisition_reference
  ON purchase_requisitions (tenant_id, reference);

CREATE INDEX IF NOT EXISTS idx_requisitions_status
  ON purchase_requisitions (tenant_id, status, created_at DESC);
