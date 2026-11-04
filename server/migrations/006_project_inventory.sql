-- Migration 0006 — project inventory.
--
-- A unit is the thing actually sold: a plot, an apartment, a shop, an office, or
-- a villa. Each one attaches to a node in the structure tree from migration 0005,
-- because "which tower, which sector, which floor" is what makes a unit
-- identifiable, and an inventory list where every row says only "Apartment 1204"
-- cannot answer the question a buyer asks first.
--
-- Two tables, and the second is deliberate:
--
--  * `structure_node_id` has NO `ON DELETE CASCADE`, and that is the point. A
--    structure node can only be deleted while it is empty, and a node holding
--    units is not empty. The route checks this and explains it; the foreign key
--    enforces it underneath, so a hand-run DELETE or a future importer refuses
--    the statement instead of orphaning a unit whose location has just ceased to
--    exist. Deleting a unit's *project* still cascades, through `project_id`.
--
--  * Attributes live in a child table rather than a JSON column on the unit. The
--    set of things worth recording genuinely differs per project — bedrooms on an
--    apartment, road frontage on a plot, a private pool on a villa — so it cannot
--    be a fixed set of columns. But it also should not be an opaque blob: a child
--    table can be joined, indexed and filtered ("show me every corner unit"), and
--    a JSON column could be none of those without JSON functions in every query.
--    Normalising costs one extra table and buys back the ability to ask questions
--    of the data later, which a real-estate inventory is asked constantly.
--
-- `unit_code` is unique per project and case-insensitively, mirroring how project
-- codes and structure node names are constrained: a code is how this unit is
-- referred to in a brochure, so two units answering to "A-1204" would make every
-- later conversation ambiguous.

CREATE TABLE IF NOT EXISTS inventory_units (
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

  status     TEXT NOT NULL DEFAULT 'available'
              CHECK (status IN ('draft','available','reserved','sold')),

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- One code per project, case-insensitively. Not partial: a unit always has a code.
CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_units_project_code
  ON inventory_units (project_id, unit_code COLLATE NOCASE);

-- Backs the tab's own listing and the "which units are in this node" lookup.
CREATE INDEX IF NOT EXISTS idx_inventory_units_listing
  ON inventory_units (tenant_id, project_id, structure_node_id);

-- Status is filtered far more often than anything else in the list, and the
-- status-only count is what the tiles above the table need.
CREATE INDEX IF NOT EXISTS idx_inventory_units_status
  ON inventory_units (tenant_id, project_id, status);

-- One attribute per (unit, key). A plain unique index would let "Bedrooms" and
-- "bedrooms" coexist; the route normalises case before writing, and this is the
-- backstop for a hand-written insert that does not.
CREATE TABLE IF NOT EXISTS inventory_unit_attributes (
  unit_id     TEXT NOT NULL REFERENCES inventory_units (id) ON DELETE CASCADE,
  key         TEXT NOT NULL
               CHECK (length(trim(key)) BETWEEN 1 AND 40),
  value       TEXT NOT NULL DEFAULT ''
               CHECK (length(value) <= 120),
  created_at  TEXT NOT NULL,
  PRIMARY KEY (unit_id, key COLLATE NOCASE)
);

-- Makes "every corner unit in this project" a plain equality lookup rather than a
-- scan, which is the question this table exists to be able to answer.
CREATE INDEX IF NOT EXISTS idx_inventory_attributes_key_value
  ON inventory_unit_attributes (key, value);