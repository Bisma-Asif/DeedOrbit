CREATE TABLE IF NOT EXISTS lead_stages (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  stage_key TEXT NOT NULL,
  label TEXT NOT NULL CHECK (length(trim(label)) BETWEEN 1 AND 40),
  tone TEXT NOT NULL CHECK (tone IN ('neutral', 'success', 'warning', 'info', 'danger')),
  sort_order INTEGER NOT NULL,
  is_builtin INTEGER NOT NULL DEFAULT 0 CHECK (is_builtin IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, stage_key),
  UNIQUE (tenant_id, label COLLATE NOCASE)
);

INSERT OR IGNORE INTO lead_stages (
  id, tenant_id, stage_key, label, tone, sort_order, is_builtin, created_at, updated_at
)
SELECT
  'stage_' || tenants.id || '_' || seed.stage_key,
  tenants.id,
  seed.stage_key,
  seed.label,
  seed.tone,
  seed.sort_order,
  1,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM tenants
CROSS JOIN (
  SELECT 'new' AS stage_key, 'New' AS label, 'neutral' AS tone, 0 AS sort_order
  UNION ALL SELECT 'contacted', 'Contacted', 'info', 1
  UNION ALL SELECT 'qualified', 'Qualified', 'success', 2
  UNION ALL SELECT 'site_visit', 'Site Visit', 'info', 3
  UNION ALL SELECT 'negotiation', 'Negotiation', 'warning', 4
  UNION ALL SELECT 'won', 'Won', 'success', 5
  UNION ALL SELECT 'lost', 'Lost', 'danger', 6
) AS seed;

ALTER TABLE leads RENAME TO leads_before_pipeline;

CREATE TABLE leads (
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
  status TEXT NOT NULL DEFAULT 'new',
  follow_up_date TEXT,
  lost_reason TEXT,
  customer_id TEXT,
  created_by TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (budget_min IS NULL OR budget_min >= 0),
  CHECK (budget_max IS NULL OR budget_max >= 0),
  CHECK (budget_min IS NULL OR budget_max IS NULL OR budget_min <= budget_max)
);

INSERT INTO leads (
  id, tenant_id, full_name, phone, email, source, campaign, project_interest,
  budget_min, budget_max, assigned_agent_id, status, created_by, created_at, updated_at
)
SELECT
  id, tenant_id, full_name, phone, email, source, campaign, project_interest,
  budget_min, budget_max, assigned_agent_id,
  CASE WHEN status = 'converted' THEN 'won' ELSE status END,
  created_by, created_at, updated_at
FROM leads_before_pipeline;

DROP TABLE leads_before_pipeline;

CREATE TABLE customers (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  source_lead_id TEXT NOT NULL UNIQUE REFERENCES leads (id) ON DELETE RESTRICT,
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE lead_activities (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  lead_id TEXT NOT NULL REFERENCES leads (id) ON DELETE CASCADE,
  activity_type TEXT NOT NULL CHECK (activity_type IN ('created', 'stage_changed', 'note_added', 'follow_up_set', 'converted')),
  body TEXT NOT NULL,
  from_stage TEXT,
  to_stage TEXT,
  actor_user_id TEXT REFERENCES users (id) ON DELETE SET NULL,
  actor_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

INSERT INTO lead_activities (
  id, tenant_id, lead_id, activity_type, body, from_stage, to_stage,
  actor_user_id, actor_name, created_at
)
SELECT
  'act_seed_' || l.id,
  l.tenant_id,
  l.id,
  'created',
  'Lead captured',
  NULL,
  l.status,
  l.created_by,
  COALESCE(u.full_name, 'System'),
  l.created_at
FROM leads l
LEFT JOIN users u ON u.id = l.created_by AND u.tenant_id = l.tenant_id;

CREATE INDEX IF NOT EXISTS idx_leads_tenant_updated
  ON leads (tenant_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_tenant_status
  ON leads (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_leads_tenant_agent
  ON leads (tenant_id, assigned_agent_id);
CREATE INDEX IF NOT EXISTS idx_leads_tenant_follow_up
  ON leads (tenant_id, follow_up_date);
CREATE INDEX IF NOT EXISTS idx_lead_stages_tenant_order
  ON lead_stages (tenant_id, sort_order, id);
CREATE INDEX IF NOT EXISTS idx_lead_activities_timeline
  ON lead_activities (tenant_id, lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customers_tenant_name
  ON customers (tenant_id, full_name COLLATE NOCASE);
