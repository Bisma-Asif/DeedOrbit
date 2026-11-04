-- Migration 0007 — data-driven unit statuses, and a trail of every change.
--
-- Migration 0006 pinned a unit's status with a CHECK constraint over four literals.
-- That was the right call while the lifecycle was four states long, and it is the
-- wrong one now: a status vocabulary that needs a deploy to extend is a vocabulary
-- an administrator cannot be trusted with, and the states a real estate sale passes
-- through are more than four. So the status becomes data, and the table below is what
-- a tenant's statuses are made of.
--
-- Three things happen here.
--
--  * `inventory_unit_statuses` holds one row per status per tenant. The `tone`
--    column is why it is a table and not a config file: a custom status has to be
--    colourable, and the colour has to survive being read by a list, a badge and a
--    history entry three months later. The tone is constrained to the palette's
--    existing tokens so a tenant cannot introduce a new hue into a screen that is
--    otherwise slate, emerald, amber and muted red.
--
--  * `inventory_unit_status_history` records who moved a unit, when, and from what to
--    what. It is a separate table rather than three columns on the unit because the
--    unit holds the *current* status and this holds every previous one; a column
--    cannot keep a history. `changed_by_user_id` is nullable and `ON DELETE SET NULL`
--    so the trail outlives the person who made the change, and `changed_by_name` is
--    stored alongside it for the same reason — an audit trail that goes blank when
--    someone leaves the company is not an audit trail. `source` distinguishes a human
--    moving a unit from the booking and cancellation workflows that will do it
--    automatically later; those rows carry no user and no permission check.
--
--  * `inventory_units` is rebuilt to drop the CHECK on `status`. SQLite cannot alter
--    a constraint, so this is the documented twelve-step procedure, run inside the
--    migration's own transaction: `defer_foreign_keys` holds the child table's
--    reference open across the drop, and `legacy_alter_table` stops the rename from
--    rewriting `inventory_unit_attributes`' foreign key to point at the temporary
--    name. Every other column, constraint and comment is carried over unchanged, and
--    the three indexes are recreated because dropping the table dropped them. The
--    attribute rows are copied aside before the drop, because `DROP TABLE` fires that
--    child's cascade.

CREATE TABLE IF NOT EXISTS inventory_unit_statuses (
  id          TEXT PRIMARY KEY,

  tenant_id   TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,

  -- The stored value. Derived from the label, never shown, and unique per tenant so
  -- a unit's status is unambiguous.
  key         TEXT NOT NULL
                CHECK (length(trim(key)) BETWEEN 1 AND 40),

  -- What a user reads and types.
  label       TEXT NOT NULL
                CHECK (length(trim(label)) BETWEEN 1 AND 40),

  tone        TEXT NOT NULL DEFAULT 'neutral'
                CHECK (tone IN ('neutral','outline','success','warning','info','danger')),

  -- Built-in statuses cannot be renamed, recoloured or retired. They are the states
  -- a report written against this product knows how to count, and "Blocked / Hold"
  -- losing its amber the first time somebody tidied up would quietly change what every
  -- dashboard meant.
  is_builtin  INTEGER NOT NULL DEFAULT 0 CHECK (is_builtin IN (0,1)),

  -- Archiving hides a status from new assignments without rewriting the units that
  -- already hold it. A hard delete would either refuse while units are attached or
  -- silently strip them of a status that was a true record of what happened.
  is_archived INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0,1)),

  sort_order  INTEGER NOT NULL DEFAULT 0,

  created_at  TEXT NOT NULL,

  updated_at  TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_unit_statuses_tenant_key
  ON inventory_unit_statuses (tenant_id, key COLLATE NOCASE);

-- Two statuses that read the same in a filter bar are one status with a typo. This is
-- what stops "Hold" and "Blocked / Hold" both existing.
CREATE UNIQUE INDEX IF NOT EXISTS idx_unit_statuses_tenant_label
  ON inventory_unit_statuses (tenant_id, label COLLATE NOCASE);

-- The picker reads live statuses in their intended order on every render.
CREATE INDEX IF NOT EXISTS idx_unit_statuses_picker
  ON inventory_unit_statuses (tenant_id, is_archived, sort_order);

-- Every tenant gets the built-in set. `st_<tenant>_<key>` is deterministic so the
-- seed is re-runnable and so the ids read as what they are.
INSERT OR IGNORE INTO inventory_unit_statuses (
  id, tenant_id, key, label, tone, is_builtin, is_archived, sort_order,
  created_at, updated_at
)
SELECT
  'st_' || tenants.id || '_' || seed.key,
  tenants.id,
  seed.key,
  seed.label,
  seed.tone,
  1,
  0,
  seed.sort_order,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM tenants
CROSS JOIN (
  SELECT 'draft'       AS key, 'Draft'           AS label, 'outline' AS tone, 0 AS sort_order
  UNION ALL SELECT 'available',  'Available',       'success', 1
  UNION ALL SELECT 'reserved',   'Reserved',        'warning', 2
  UNION ALL SELECT 'booked',     'Booked',          'info',    3
  UNION ALL SELECT 'sold',       'Sold',            'neutral', 4
  UNION ALL SELECT 'cancelled',  'Cancelled',       'danger',  5
  UNION ALL SELECT 'transferred', 'Transferred',     'outline', 6
  UNION ALL SELECT 'hold',       'Blocked / Hold',  'warning', 7
) AS seed;

CREATE TABLE IF NOT EXISTS inventory_unit_status_history (
  id          TEXT PRIMARY KEY,

  tenant_id   TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,

  -- Project and unit both cascade: when a project or a unit is deleted, so is the
  -- trail. A history that outlives the record it describes is not history.
  project_id  TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  unit_id     TEXT NOT NULL REFERENCES inventory_units (id) ON DELETE CASCADE,

  -- Null only on the row that records the unit being created in its first status.
  from_status TEXT,

  to_status   TEXT NOT NULL CHECK (length(trim(to_status)) BETWEEN 1 AND 40),

  -- Null when a workflow moved the unit rather than a person.
  changed_by_user_id TEXT REFERENCES users (id) ON DELETE SET NULL,

  changed_by_name    TEXT,

  source      TEXT NOT NULL DEFAULT 'manual'
                CHECK (source IN ('manual','system')),

  note        TEXT CHECK (note IS NULL OR length(note) <= 200),

  changed_at  TEXT NOT NULL
);

-- "What happened to this unit" reads newest-first for one unit.
CREATE INDEX IF NOT EXISTS idx_unit_status_history_unit
  ON inventory_unit_status_history (unit_id, changed_at DESC);

-- The project-level feed is the same read across every unit in the project.
CREATE INDEX IF NOT EXISTS idx_unit_status_history_project
  ON inventory_unit_status_history (tenant_id, project_id, changed_at DESC);

-- Who moved what, when — the question an audit is actually asked.
CREATE INDEX IF NOT EXISTS idx_unit_status_history_actor
  ON inventory_unit_status_history (tenant_id, changed_by_user_id, changed_at DESC);

PRAGMA defer_foreign_keys = ON;
PRAGMA legacy_alter_table = ON;

-- The attribute rows have to be set aside first. Dropping `inventory_units` runs an
-- implicit DELETE FROM against it, and `inventory_unit_attributes` declares
-- `ON DELETE CASCADE` — so the rebuild would otherwise take every attribute with it.
-- `defer_foreign_keys` does not prevent this: it defers violations, it does not
-- decline to cascade. The backup carries no foreign key, so nothing cascades into it,
-- and it is dropped again at the end of this migration.
CREATE TABLE inventory_unit_attributes_backup AS
  SELECT unit_id, key, value, created_at FROM inventory_unit_attributes;

CREATE TABLE inventory_units_rebuilt (
  id         TEXT PRIMARY KEY,

  tenant_id  TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,

  -- Where the unit sits. Required: a unit that does not say which floor it is on
  -- cannot be shown on a plan or matched to the structure tab.
  structure_node_id TEXT NOT NULL
                      REFERENCES project_structure_nodes (id),

  unit_code  TEXT NOT NULL
              CHECK (length(trim(unit_code)) BETWEEN 1 AND 40),

  unit_type  TEXT NOT NULL
              CHECK (unit_type IN ('plot','apartment','shop','office','villa')),

  -- Free text: "North-facing, podium level". Nullable rather than empty-string
  -- so "not recorded" stays distinguishable from "recorded as blank".
  location   TEXT
              CHECK (location IS NULL OR length(location) <= 120),

  -- Whole square feet.
  size_sqft  INTEGER NOT NULL
              CHECK (size_sqft BETWEEN 1 AND 1000000),

  -- Whole units of the tenant's currency. An integer count of major units, not
  -- minor ones and not a float: see the note in `shared/inventory.ts`.
  base_price INTEGER NOT NULL
              CHECK (base_price BETWEEN 0 AND 1000000000000),

  -- Reusable pricing configuration for the unit: base price, size-based rate,
  -- the project charges and any unit-level discount. Stored as JSON so the same
  -- breakdown can be reused later in quotations and bookings.
  pricing_config TEXT NOT NULL DEFAULT '{}',

  -- No CHECK here on purpose: the vocabulary now lives in
  -- `inventory_unit_statuses` and is enforced by the route, which is the only
  -- writer. A constraint listing the built-in keys would reject every custom status,
  -- and one listing nothing would assert a guarantee the database does not have.
  status     TEXT NOT NULL DEFAULT 'available'
              CHECK (length(trim(status)) BETWEEN 1 AND 40),

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO inventory_units_rebuilt (
  id, tenant_id, project_id, structure_node_id, unit_code, unit_type, location,
  size_sqft, base_price, pricing_config, status, created_at, updated_at
)
SELECT
  id, tenant_id, project_id, structure_node_id, unit_code, unit_type, location,
  size_sqft, base_price, '{}', status, created_at, updated_at
FROM inventory_units;

DROP TABLE inventory_units;

ALTER TABLE inventory_units_rebuilt RENAME TO inventory_units;

-- Dropping the table dropped its indexes with it.
CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_units_project_code
  ON inventory_units (project_id, unit_code COLLATE NOCASE);

CREATE INDEX IF NOT EXISTS idx_inventory_units_listing
  ON inventory_units (tenant_id, project_id, structure_node_id);

-- Status is filtered far more often than anything else in the list, and the
-- per-status counts are what the tiles above the table need.
CREATE INDEX IF NOT EXISTS idx_inventory_units_status
  ON inventory_units (tenant_id, project_id, status);

-- Put the attributes back on the rebuilt table, now that the name they reference
-- exists again and is the real one.
INSERT INTO inventory_unit_attributes (unit_id, key, value, created_at)
  SELECT unit_id, key, value, created_at FROM inventory_unit_attributes_backup;

DROP TABLE inventory_unit_attributes_backup;

-- --- widen permissions.action to carry `change_status` ------------------------
--
-- Moving a unit between statuses is not `inventory.edit`. A project manager retyping a
-- price and a sales director declaring that a sale fell through are different decisions
-- with different consequences, and the second one is the one that ends up on the record.
-- So the action is new rather than a reuse of `approve`, which exists for payments.
--
-- `permissions.action` is CHECKed over the five verbs this product started with, and
-- SQLite cannot alter a CHECK — so this is the same rebuild as above, for the same
-- reason, in the same pragma window.
--
-- The grants are set aside first, and this is the same cascade trap as the attributes:
-- both `role_permission_defaults` and `role_permission_overrides` reference
-- `permissions` with `ON DELETE CASCADE`, so dropping the parent would leave every role
-- in the platform with no permissions at all and every tenant with no overrides. A
-- tenant's custom role configuration is the kind of data that is expensive to discover
-- missing and impossible to recreate, so it is copied out and put back by hand.
CREATE TABLE role_permission_defaults_backup AS
  SELECT role_id, permission_id FROM role_permission_defaults;

CREATE TABLE role_permission_overrides_backup AS
  SELECT tenant_id, role_id, permission_id, effect, updated_at, updated_by
    FROM role_permission_overrides;

CREATE TABLE permissions_rebuilt (
  permission_id TEXT PRIMARY KEY,           -- 'inventory.change_status'

  module_id     TEXT NOT NULL,

  -- `change_status` joins the five general verbs. It is a verb rather than a noun for
  -- the same reason `edit` is: a module's actions are asked about as "can this role
  -- <verb> a <module>", and a sixth noun would not fit the question.

  action        TEXT NOT NULL
                  CHECK (action IN ('view','create','edit','delete','approve','change_status')),

  label         TEXT NOT NULL,

  description   TEXT NOT NULL DEFAULT '',

  sort_order    INTEGER NOT NULL,

  UNIQUE (module_id, action)
);

INSERT INTO permissions_rebuilt (
  permission_id, module_id, action, label, description, sort_order
)
  SELECT permission_id, module_id, action, label, description, sort_order
    FROM permissions;

DROP TABLE permissions;

ALTER TABLE permissions_rebuilt RENAME TO permissions;

CREATE INDEX IF NOT EXISTS idx_permissions_module
  ON permissions (module_id, sort_order);

INSERT INTO role_permission_defaults (role_id, permission_id)
  SELECT role_id, permission_id FROM role_permission_defaults_backup;

INSERT INTO role_permission_overrides (
  tenant_id, role_id, permission_id, effect, updated_at, updated_by
)
  SELECT tenant_id, role_id, permission_id, effect, updated_at, updated_by
    FROM role_permission_overrides_backup;

DROP TABLE role_permission_defaults_backup;

DROP TABLE role_permission_overrides_backup;

PRAGMA legacy_alter_table = OFF;
