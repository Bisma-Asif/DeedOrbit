CREATE TABLE IF NOT EXISTS sales_teams (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  manager_user_id TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, name COLLATE NOCASE)
);

CREATE TABLE IF NOT EXISTS sales_team_members (
  tenant_id TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  team_id TEXT NOT NULL REFERENCES sales_teams (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, user_id)
);

CREATE TABLE IF NOT EXISTS sales_agent_targets (
  tenant_id TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  period_month TEXT NOT NULL CHECK (length(period_month) = 7),
  leads_target INTEGER CHECK (leads_target IS NULL OR leads_target >= 0),
  bookings_target INTEGER CHECK (bookings_target IS NULL OR bookings_target >= 0),
  collections_target INTEGER CHECK (collections_target IS NULL OR collections_target >= 0),
  updated_at TEXT NOT NULL,
  updated_by TEXT REFERENCES users (id) ON DELETE SET NULL,
  PRIMARY KEY (tenant_id, user_id, period_month)
);

CREATE INDEX IF NOT EXISTS idx_sales_teams_tenant_name
  ON sales_teams (tenant_id, name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_sales_team_members_team
  ON sales_team_members (tenant_id, team_id, user_id);
CREATE INDEX IF NOT EXISTS idx_sales_agent_targets_month
  ON sales_agent_targets (tenant_id, period_month, user_id);
