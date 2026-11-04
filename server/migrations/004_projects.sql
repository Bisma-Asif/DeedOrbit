-- Migration 0004 — projects.
--
-- A project is the root commercial record: everything sold, leased, or handed
-- over belongs to one. Nothing else references it yet, so this migration adds
-- the table on its own and the modules that hang off it (inventory, leads,
-- bookings) will key to it when they arrive.
--
-- Two decisions are worth stating, because they are the ones that are expensive
-- to change later:
--
--  * A project belongs to a tenant and is deleted with it. It is deliberately
--    NOT a child of `branches`: an office is where a salesperson sits, whereas a
--    project is a development. Conflating the two would make it impossible to
--    close a branch while its projects keep trading.
--
--  * There is no `branch_id`. Where a branch relation is wanted later it is
--    added as its own table, which is reversible; folding it into this table
--    would make every existing row implicitly "owned" by some office.

CREATE TABLE IF NOT EXISTS projects (
  id          TEXT PRIMARY KEY,

  tenant_id   TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,

  name        TEXT NOT NULL,
  -- Short internal reference, e.g. "HPR-01". Optional and unique when present.
  code        TEXT,

  -- The party developing the project. Distinct from `name`, which is how this
  -- workspace refers to it: "Marina Gate" by Emaar is two different facts.
  developer   TEXT NOT NULL,
  location    TEXT NOT NULL,

  status      TEXT NOT NULL DEFAULT 'planning'
                CHECK (status IN ('planning','pre_launch','on_sale','handed_over','on_hold')),

  -- ISO `YYYY-MM-DD`. Nullable: a project can exist in planning long before a
  -- launch is committed, and an invented date would distort the "launching
  -- soon" figure that the list leads with.
  launch_date TEXT,

  -- General project-level settings. Every one of these is optional; the columns
  -- that answer "what is this?" (name, developer, location, status) are not.
  description    TEXT,
  project_type   TEXT
                   CHECK (project_type IS NULL OR
                          project_type IN ('residential','commercial','mixed_use','industrial','land')),
  ownership_type TEXT
                   CHECK (ownership_type IS NULL OR
                          ownership_type IN ('freehold','leasehold')),
  payment_terms  TEXT,
  handover_date  TEXT,

  -- The developer's planned unit count. This is an editorial figure the user
  -- enters, NOT a count of inventory rows: no unit table exists yet, and once
  -- one does the Inventory tab will report real totals alongside it. NULL means
  -- "not stated" and renders as a dash rather than 0.
  planned_units INTEGER
                   CHECK (planned_units IS NULL OR
                          (planned_units >= 0 AND planned_units <= 100000)),

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- One project name per workspace. Case-insensitive, so "Marina Gate" and
-- "marina gate" cannot both exist and make the list ambiguous.
CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_tenant_name
  ON projects (tenant_id, name COLLATE NOCASE);

-- Reference codes identify a project in correspondence, so they must resolve to
-- exactly one row. Partial, because most projects leave it blank.
CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_tenant_code
  ON projects (tenant_id, code COLLATE NOCASE)
  WHERE code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_projects_tenant_status
  ON projects (tenant_id, status);

-- Backs the "launching soon" figure: only pre-launch rows with a date are
-- meaningful there, and the index lets SQLite skip handed-over projects.
CREATE INDEX IF NOT EXISTS idx_projects_tenant_launch
  ON projects (tenant_id, launch_date)
  WHERE status = 'pre_launch' AND launch_date IS NOT NULL;