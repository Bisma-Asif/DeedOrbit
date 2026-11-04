-- Migration 0005 — project structure.
--
-- The shape of a development: blocks and towers, the sectors they are divided
-- into, and the floors within those. Units will hang off the leaves of this tree
-- once inventory exists, so it is built now and left empty — a project with no
-- structure is a normal state, not an incomplete record.
--
-- One adjacency-list table holds all three kinds. `parent_id` points at another
-- row in the same table, `NULL` meaning "directly under the project". A block, a
-- sector, and a floor differ only in the word used for them, so separate tables
-- would buy nothing but three schemas and a union type in every query.
--
-- Three decisions here are load-bearing:
--
--  * `parent_id` has NO `ON DELETE CASCADE`, deliberately. The route refuses to
--    delete a node that has children, so a cascade would never fire through the
--    API; leaving it off means that if the check is ever bypassed — a hand-run
--    DELETE, a future importer — the foreign key refuses the statement instead
--    of quietly destroying a whole subtree. Deleting a project still cascades,
--    through `project_id`.
--
--  * The sibling-name index uses `ifnull(parent_id, '')`. SQLite treats NULLs as
--    distinct in a unique index, so a plain `(project_id, parent_id, name)`
--    index would constrain nested nodes and silently do nothing for the roots.
--    Collapsing the NULL to '' makes both levels behave the same way.
--
--  * Sibling names are unique, case-insensitively, for the same reason project
--    names are: two "Tower A" rows under one parent make the tree ambiguous, and
--    the user has to guess which one a unit belongs to.
--
-- `sort_order` is a dense 0..n-1 sequence per parent, rewritten on every
-- reorder. It is deliberately not globally unique — a partial unique index on it
-- would make swapping two rows impossible without a temporary value, and the
-- route renumbers the whole sibling set inside a transaction instead.

CREATE TABLE IF NOT EXISTS project_structure_nodes (
  id         TEXT PRIMARY KEY,

  tenant_id  TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,

  -- NULL means the node sits directly under the project.
  parent_id  TEXT REFERENCES project_structure_nodes (id),

  kind       TEXT NOT NULL
               CHECK (kind IN ('block','sector','floor')),

  -- How the node is labelled: "Tower A", "North Sector", "Level 12".
  name       TEXT NOT NULL
               CHECK (length(trim(name)) BETWEEN 1 AND 80),

  -- Position among its siblings. Dense, 0-based, rewritten on reorder.
  sort_order INTEGER NOT NULL DEFAULT 0,

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- One name per parent. `ifnull` is what makes this cover the roots as well.
CREATE UNIQUE INDEX IF NOT EXISTS idx_project_structure_sibling_name
  ON project_structure_nodes (project_id, ifnull(parent_id, ''), name COLLATE NOCASE);

-- Backs the whole tab: one ordered scan per project, tenant-scoped so a
-- cross-tenant id cannot be reached by index even before the WHERE is applied.
CREATE INDEX IF NOT EXISTS idx_project_structure_listing
  ON project_structure_nodes (tenant_id, project_id, parent_id, sort_order);