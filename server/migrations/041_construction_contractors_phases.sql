-- Construction: contractors and phases.
--
-- A contractor is the site-side supplier. It is *not* a parallel vendor
-- ledger: when a contractor bills, it is (or gains) a vendor row and the
-- `vendor_id` link says so. Money never lives here — a phase's actuals are
-- derived from expense/invoice rows tagged against it (see 0043).
--
-- A phase hangs off an existing project. `structure_node_id` is a soft link
-- into the project's structure tree (no FK: the tree is polymorphic and the
-- link is optional context, not a dependency). `manual_progress` is the
-- manager's latest site number and is nullable — when it is null, progress
-- is read as the rollup of the phase's tasks instead.

CREATE TABLE IF NOT EXISTS construction_contractors (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  vendor_id TEXT REFERENCES vendors (id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  trade TEXT NOT NULL DEFAULT 'general' CHECK (trade IN ('general', 'substructure', 'superstructure', 'mep', 'finishes', 'landscape', 'other')),
  contact_name TEXT,
  email TEXT,
  phone TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_construction_contractor_name
  ON construction_contractors (tenant_id, name);

CREATE INDEX IF NOT EXISTS idx_construction_contractors_status
  ON construction_contractors (tenant_id, status, name);

CREATE TABLE IF NOT EXISTS construction_phases (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  structure_node_id TEXT,
  name TEXT NOT NULL,
  sequence INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'completed', 'on_hold')),
  planned_start TEXT,
  planned_end TEXT,
  budget_amount INTEGER CHECK (budget_amount BETWEEN 1 AND 1000000000000),
  budget_currency TEXT,
  manual_progress INTEGER CHECK (manual_progress BETWEEN 0 AND 100),
  created_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_construction_phases_project
  ON construction_phases (tenant_id, project_id, sequence);

CREATE INDEX IF NOT EXISTS idx_construction_phases_status
  ON construction_phases (tenant_id, status);
