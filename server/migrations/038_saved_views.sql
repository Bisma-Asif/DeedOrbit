-- Saved views — a per-user, per-table snapshot of a filter combination.
--
-- The large data tables let a desk build a useful view (filters, search, sort,
-- column set) and then keep it for reuse. The whole configuration is stored as an
-- opaque JSON `state` string the owning page defines and re-reads; the server never
-- interprets it, so a table can persist whatever shape it needs without a migration.
--
-- A view is personal (keyed to the user who saved it) and scoped to one table, so a
-- view saved against the overdue table is never offered on the bookings list. Uniqueness
-- of (tenant, user, scope, name) is enforced in the route with a 422, rather than a
-- partial unique index, so the conflict can carry a helpful message.

CREATE TABLE IF NOT EXISTS saved_views (
  id         TEXT PRIMARY KEY,
  tenant_id  TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  scope      TEXT NOT NULL CHECK (length(trim(scope)) BETWEEN 1 AND 60),
  name       TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 60),
  state      TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- The list read on every visit to a table: this owner's views for this scope.
CREATE INDEX IF NOT EXISTS idx_saved_views_owner
  ON saved_views (tenant_id, user_id, scope, created_at DESC);
