-- Customer portal linkage.
--
-- The `customers` table has no reference to a `users` row, so a logged-in
-- customer maps to no actual account. This join table is the bridge: a tenant
-- admin links one or more customer profiles to a `customer`-role login, and the
-- portal scopes every read to exactly those profiles.
--
-- Several profiles per login is deliberate — co-buyers and family accounts mean
-- one person may own more than one purchase — and several logins per profile is
-- allowed for the same reason. The composite key stops a duplicate link, and
-- both sides cascade so removing a customer or a user never strands a link.

CREATE TABLE IF NOT EXISTS customer_portal_links (
  tenant_id TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, customer_id, user_id)
);

-- The portal resolves a login to its profiles by user, so that lookup needs an
-- index; the reverse (find who is linked to a profile) rides the PK prefix.
CREATE INDEX IF NOT EXISTS idx_portal_links_user
  ON customer_portal_links (tenant_id, user_id);
