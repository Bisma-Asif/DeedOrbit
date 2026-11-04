CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  source TEXT NOT NULL,
  campaign TEXT,
  project_interest TEXT,
  budget_min INTEGER,
  budget_max INTEGER,
  assigned_agent_id TEXT REFERENCES users (id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'contacted', 'qualified', 'negotiation', 'converted', 'lost')),
  created_by TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (budget_min IS NULL OR budget_min >= 0),
  CHECK (budget_max IS NULL OR budget_max >= 0),
  CHECK (budget_min IS NULL OR budget_max IS NULL OR budget_min <= budget_max)
);

CREATE INDEX IF NOT EXISTS idx_leads_tenant_updated
  ON leads (tenant_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_tenant_status
  ON leads (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_leads_tenant_agent
  ON leads (tenant_id, assigned_agent_id);
