-- Migration 0002 — organization settings.
--
-- Branches/offices and document numbering get their own tables. The new
-- `tenants` columns are added by server/migrations.ts rather than here, because
-- SQLite has no `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` and these statements
-- must be safe on a database where 0001 already ran.

-- ---------------------------------------------------------------------------
-- Branches / offices
-- ---------------------------------------------------------------------------
--
-- A tenant may trade from several offices. `is_headquarters` marks the one that
-- appears on contracts and letterhead; the server refuses to clear the flag on
-- the last headquarters row.

CREATE TABLE IF NOT EXISTS branches (
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  code           TEXT NOT NULL,                    -- short code, e.g. "HQ"
  is_headquarters INTEGER NOT NULL DEFAULT 0 CHECK (is_headquarters IN (0, 1)),
  address_line1  TEXT,
  address_line2  TEXT,
  city           TEXT,
  state_region   TEXT,
  postal_code    TEXT,
  country_code   TEXT,
  phone          TEXT,
  email          TEXT,
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

-- Scoped uniqueness, not global: two tenants may both call an office "Head Office".
CREATE UNIQUE INDEX IF NOT EXISTS idx_branches_tenant_code ON branches (tenant_id, code);
CREATE UNIQUE INDEX IF NOT EXISTS idx_branches_tenant_name ON branches (tenant_id, name);
CREATE INDEX IF NOT EXISTS idx_branches_tenant       ON branches (tenant_id);

-- ---------------------------------------------------------------------------
-- Document numbering
-- ---------------------------------------------------------------------------
--
-- `next_value` is the number the *next* document will take. `last_fiscal_year`
-- is what makes an annual reset correct: the counter is only rolled back to 1
-- when the stored year differs from the tenant's current fiscal year, so a reset
-- is idempotent and cannot be replayed by calling the endpoint twice.

CREATE TABLE IF NOT EXISTS number_sequences (
  tenant_id         TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  kind              TEXT NOT NULL CHECK (kind IN ('invoice', 'receipt', 'booking')),
  prefix            TEXT NOT NULL DEFAULT '',
  padding           INTEGER NOT NULL DEFAULT 4 CHECK (padding BETWEEN 1 AND 10),
  next_value        INTEGER NOT NULL DEFAULT 1 CHECK (next_value >= 1),
  reset_yearly      INTEGER NOT NULL DEFAULT 1 CHECK (reset_yearly IN (0, 1)),
  last_fiscal_year  INTEGER,
  updated_at        TEXT NOT NULL,
  PRIMARY KEY (tenant_id, kind)
);
