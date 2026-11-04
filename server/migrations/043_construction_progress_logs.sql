-- Construction: the site-progress log.
--
-- Append-only. Each row is one site report as the manager gave it; nothing
-- is rewritten after the fact. A phase's "current site progress" is the
-- latest row, and the history under it is exactly what it always was —
-- which is why the log has no updated_at.

CREATE TABLE IF NOT EXISTS construction_progress_logs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  phase_id TEXT NOT NULL REFERENCES construction_phases (id) ON DELETE CASCADE,
  task_id TEXT REFERENCES construction_tasks (id) ON DELETE SET NULL,
  percent INTEGER NOT NULL CHECK (percent BETWEEN 0 AND 100),
  note TEXT,
  actor_user_id TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_construction_progress_phase
  ON construction_progress_logs (tenant_id, phase_id, created_at DESC);
