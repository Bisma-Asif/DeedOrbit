-- Construction: tasks and milestones.
--
-- A task belongs to exactly one phase. A milestone is not a second table:
-- it is a task flagged `milestone`, weighted double when the phase rolls up
-- its tasks' progress, so the derivation stays one arithmetic over rows you
-- can point at.
--
-- Assignment is two nullable FKs, not one polymorphic column: a task is
-- given to a contractor (a firm) or to a member (a person), and the pair
-- reads honestly — a task with neither shows as unassigned.

CREATE TABLE IF NOT EXISTS construction_tasks (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  phase_id TEXT NOT NULL REFERENCES construction_phases (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  sequence INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'blocked')),
  milestone INTEGER NOT NULL DEFAULT 0 CHECK (milestone IN (0, 1)),
  planned_start TEXT,
  planned_end TEXT,
  actual_start TEXT,
  actual_end TEXT,
  contractor_id TEXT REFERENCES construction_contractors (id) ON DELETE SET NULL,
  assignee_user_id TEXT REFERENCES users (id) ON DELETE SET NULL,
  budget_amount INTEGER CHECK (budget_amount BETWEEN 1 AND 1000000000000),
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_construction_tasks_phase
  ON construction_tasks (tenant_id, phase_id, sequence);

CREATE INDEX IF NOT EXISTS idx_construction_tasks_contractor
  ON construction_tasks (tenant_id, contractor_id);
