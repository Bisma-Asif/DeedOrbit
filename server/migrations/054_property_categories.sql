-- Migration 0054 — the property category system.
--
-- A unit has carried two classifications since migration 0006: `unit_type`, one of
-- five literals the database checked, and the status vocabulary that migration 0007
-- turned into data. The first of those is the one that has to go the same way. A sales
-- desk in Karachi sells a Corner Shop, an Upper Portion, a 5-marla Residential Plot
-- and a Food Court Kiosk, and none of those words survive the round trip through
-- "shop" or "apartment" — the buyer's question, the agent's listing and the payment
-- plan all depend on distinctions the five buckets cannot make.
--
-- So the classification becomes a set of per-tenant dropdown lists, and this migration
-- is built around one hard constraint: **nothing that exists may break**.
--
--  * `unit_type` is *not* dropped or widened. Dealer scopes store it
--    (`dealer_commissions.scope = 'unit_type'`), reports group by it, quotations and
--    bookings read it, and the tests in `server/api.test.ts` still expect a value
--    outside the five to be refused. Every unit keeps its coarse family, and a
--    property type now says which family it belongs to through `legacy_type`. The
--    fine-grained word is added, not substituted.
--
--  * `inventory_units` is extended with `ADD COLUMN`, never rebuilt. Every new column
--    is nullable, which is what makes that possible: SQLite will add a nullable column
--    to a populated table as a metadata change, and no existing row has to be rewritten
--    or re-validated. A rebuild to attach `NOT NULL` defaults would have to carry the
--    whole inventory through a temporary table, which is exactly the risk this feature
--    cannot take — an inventory that fails to come back out of a rebuild is a company
--    losing its sales stock.
--
--  * The defaults that existing units need are set by a backfill in code, after the
--    option rows are seeded, and only touch rows where the new column is still null.
--    Units recorded before categories existed read as what they are — a shop stays a
--    Shop, an office stays Commercial — instead of showing a blank classification in
--    every filter chip and document.
--
-- The option table is one table rather than nine. Nine near-identical lookup tables
-- would be nine route families, nine permission checks and nine copies of the
-- archive/rename logic, for a shape that is identical apart from a couple of columns
-- only one kind uses (`legacy_type` for property types, `value_num` for size units).
-- A `kind` column with a CHECK over the nine names keeps the vocabulary closed where it
-- should be — the *lists* are fixed — while the *contents* of each list stay the
-- tenant's to edit. That is the same trade migration 0007 made for statuses.
--
-- Seeding is deliberately not done here. The ten-odd `UNION ALL` blocks migration 0007
-- needed for eight statuses would be seventy rows for twenty-four property types, and
-- the lists live in `shared/inventory-categories.ts` because the client has to render
-- the same defaults. A SQL copy would be a second source of truth that drifts the first
-- time somebody adds a type. `server/routes/inventory-options.ts` seeds from the shared
-- list instead, for existing tenants here and for new tenants at signup.

CREATE TABLE IF NOT EXISTS inventory_category_options (
  id        TEXT PRIMARY KEY,

  tenant_id TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,

  -- Which list this row belongs to. Closed, because the nine lists are the product's
  -- shape; what is inside each one is the tenant's.
  kind      TEXT NOT NULL
              CHECK (kind IN (
                'property_type',
                'usage_category',
                'property_subtype',
                'furnishing',
                'sale_mode',
                'possession_status',
                'ownership_type',
                'size_unit',
                'amenity'
              )),

  -- The stored value a unit row carries. Derived from the label, never shown, and
  -- unique per tenant and list — including across sub-type parents, so a key on a unit
  -- always names exactly one option.
  key       TEXT NOT NULL
              CHECK (length(trim(key)) BETWEEN 1 AND 40),

  -- What a user reads and types.
  label     TEXT NOT NULL
              CHECK (length(trim(label)) BETWEEN 1 AND 60),

  -- Sub-types only: the property type key this variant belongs to. Null for every
  -- other list, which is why "Park Facing" can never appear under a Penthouse.
  parent_key TEXT,

  -- Property types only: which of the five coarse families the unit's `unit_type`
  -- should hold. Constrained to the same five literals the unit column checks, so a
  -- mapping cannot point at a family that would then be refused on write.
  legacy_type TEXT
              CHECK (legacy_type IS NULL OR legacy_type IN ('plot','apartment','shop','office','villa')),

  -- Property types only: the usage category picked alongside this type, so choosing
  -- Shop does not also require someone to say "Commercial".
  usage_key TEXT,

  -- Size units only: square feet per one of this unit. Data rather than a constant
  -- because a marla is 225 sq ft in most of Punjab and 242 in parts of Sindh.
  value_num REAL,

  -- Property types only: a bare piece of land, which is what tells the form not to ask
  -- for bedrooms, a kitchen or a floor number.
  is_land   INTEGER NOT NULL DEFAULT 0 CHECK (is_land IN (0,1)),

  -- Part of the shipped vocabulary. Its key and its conversion factor stay fixed,
  -- because units and reports already count in these; the label may still be renamed,
  -- which is the whole point of a per-tenant table.
  is_builtin  INTEGER NOT NULL DEFAULT 0 CHECK (is_builtin IN (0,1)),

  -- Hiding keeps the row — and every unit that already carries it — readable, exactly
  -- as an archived status does. A hard delete would either refuse while units are
  -- attached or strip a true record off them.
  is_archived INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0,1)),

  sort_order INTEGER NOT NULL DEFAULT 0,

  created_at TEXT NOT NULL,

  updated_at TEXT NOT NULL
);

-- One key per list per tenant. `IFNULL` rather than the bare column because a NULL
-- `parent_key` in a unique index counts as distinct from every other NULL, and the
-- non-sub-type lists would then be allowed to hold the same key twice.
CREATE UNIQUE INDEX IF NOT EXISTS idx_category_options_key
  ON inventory_category_options (
    tenant_id, kind, key COLLATE NOCASE, IFNULL(parent_key, '')
  );

-- Two options that read the same in one picker are one option with a typo — except
-- across sub-type parents, where "Normal" under Plot and "Normal" under House are two
-- different answers to two different questions.
CREATE UNIQUE INDEX IF NOT EXISTS idx_category_options_label
  ON inventory_category_options (
    tenant_id, kind, label COLLATE NOCASE, IFNULL(parent_key, '')
  );

-- Every picker on every screen reads live options in list order.
CREATE INDEX IF NOT EXISTS idx_category_options_picker
  ON inventory_category_options (tenant_id, kind, is_archived, sort_order, label);

-- The sub-type cascade: show the variants of the type that was just chosen.
CREATE INDEX IF NOT EXISTS idx_category_options_parent
  ON inventory_category_options (tenant_id, kind, parent_key);

-- Amenities are a multi-select, so they are a set of rows rather than a JSON blob on
-- the unit. "Every flat with a generator" has to be a join a report can write, and the
-- same argument migration 0006 made for attributes applies unchanged here: a blob can
-- be displayed and not asked about.
CREATE TABLE IF NOT EXISTS inventory_unit_amenities (
  unit_id     TEXT NOT NULL REFERENCES inventory_units (id) ON DELETE CASCADE,
  amenity_key TEXT NOT NULL
                CHECK (length(trim(amenity_key)) BETWEEN 1 AND 40),
  created_at  TEXT NOT NULL,
  PRIMARY KEY (unit_id, amenity_key)
);

-- "Which units have this amenity" is the question a filter asks.
CREATE INDEX IF NOT EXISTS idx_unit_amenities_key
  ON inventory_unit_amenities (amenity_key, unit_id);

-- Photos, a floor plan and a video link. `href` holds either a link the buyer can
-- click or a data URL the workspace uploaded — the same storage choice as the tenant
-- logo and expense attachments, because this product runs on locked-down intranets
-- where there is no object store to put files in.
CREATE TABLE IF NOT EXISTS inventory_unit_media (
  id        TEXT PRIMARY KEY,

  tenant_id TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,

  unit_id   TEXT NOT NULL REFERENCES inventory_units (id) ON DELETE CASCADE,

  kind      TEXT NOT NULL
              CHECK (kind IN ('photo','floor_plan','video')),

  href      TEXT NOT NULL
              CHECK (length(trim(href)) BETWEEN 1 AND 6000000),

  label     TEXT
              CHECK (label IS NULL OR length(label) <= 80),

  -- One main photo per unit, shown as the card image. Partial rather than a column
  -- constraint: SQLite cannot express "at most one true per unit", so the route
  -- enforces it and this index is what makes the lookup cheap.
  is_main   INTEGER NOT NULL DEFAULT 0 CHECK (is_main IN (0,1)),

  sort_order INTEGER NOT NULL DEFAULT 0,

  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_unit_media_unit
  ON inventory_unit_media (unit_id, kind, sort_order);

CREATE INDEX IF NOT EXISTS idx_unit_media_main
  ON inventory_unit_media (tenant_id, unit_id, is_main);
-- The rest of the migration is in code, because SQLite has no `ADD COLUMN IF NOT
-- EXISTS` and no `CREATE INDEX` that can reference a column added in the same
-- statement: `server/migrations.ts` adds the twenty-five nullable columns to
-- `inventory_units`, seeds every tenant's option lists from
-- `shared/inventory-categories.ts`, backfills the units that predate categories, and
-- then creates `idx_inventory_units_category (tenant_id, property_type)` — the read the
-- category summary cards and the dashboard breakdown do — on the column that only
-- exists once the `ALTER TABLE` has run.
