-- A seventh action: verify.
--
-- `view` says you may read it, `edit` says you may change it, `approve` says you may sign
-- off a request held in the queue. None of those is "I opened this file myself and I am
-- certifying that it is what it purports to be", which is a distinct act with a distinct
-- accountability - and the whole point of manual verification is that the person who
-- uploaded a document is not the person who certifies it. So `verify` is its own action,
-- granted per module like everything else, and a role that files documents does not get
-- it by default.
--
-- `action` carries a CHECK, so the catalogue table is rebuilt. Its two grant tables
-- reference it, so they are rebuilt in the same migration to point back at the live
-- `permissions` before the temporary parent is dropped - the same order
-- `057_payment_manual_entry` uses, and for the same reason: renaming a parent rewrites
-- the child clauses to the temporary name, and dropping it would then cascade through
-- them. Every existing row, override and denial is copied by value, so a tenant that has
-- narrowed a role keeps the narrowing.
--
-- The new permission rows themselves are not written here. `seedPermissionCatalogue()`
-- runs on every boot from the widened `ACTIONS` list in shared/access.ts, which is the
-- only place that knows the module x action cross-product, the labels and the hints -
-- writing them here would put the catalogue in two places that can disagree.

ALTER TABLE permissions RENAME TO permissions_before_verify;

CREATE TABLE permissions (
  permission_id TEXT PRIMARY KEY,
  module_id     TEXT NOT NULL,
  action        TEXT NOT NULL CHECK (
    action IN ('view', 'create', 'edit', 'delete', 'approve', 'change_status', 'verify')
  ),
  label         TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  sort_order    INTEGER NOT NULL,
  UNIQUE (module_id, action)
);

INSERT INTO permissions (
  permission_id, module_id, action, label, description, sort_order
)
SELECT
  permission_id, module_id, action, label, description, sort_order
FROM permissions_before_verify;

ALTER TABLE role_permission_defaults RENAME TO role_permission_defaults_before_verify;

CREATE TABLE role_permission_defaults (
  role_id       TEXT NOT NULL REFERENCES roles (role_id) ON DELETE CASCADE,
  permission_id TEXT NOT NULL REFERENCES permissions (permission_id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

INSERT INTO role_permission_defaults (role_id, permission_id)
SELECT role_id, permission_id
FROM role_permission_defaults_before_verify;

DROP TABLE role_permission_defaults_before_verify;

ALTER TABLE role_permission_overrides RENAME TO role_permission_overrides_before_verify;

CREATE TABLE role_permission_overrides (
  tenant_id     TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  role_id       TEXT NOT NULL REFERENCES roles (role_id) ON DELETE CASCADE,
  permission_id TEXT NOT NULL REFERENCES permissions (permission_id) ON DELETE CASCADE,
  effect        TEXT NOT NULL CHECK (effect IN ('allow', 'deny')),
  updated_at    TEXT NOT NULL,
  updated_by    TEXT,
  PRIMARY KEY (tenant_id, role_id, permission_id)
);

INSERT INTO role_permission_overrides (
  tenant_id, role_id, permission_id, effect, updated_at, updated_by
)
SELECT
  tenant_id, role_id, permission_id, effect, updated_at, updated_by
FROM role_permission_overrides_before_verify;

DROP TABLE role_permission_overrides_before_verify;

DROP TABLE permissions_before_verify;

CREATE INDEX IF NOT EXISTS idx_permissions_module ON permissions (module_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_overrides_tenant
  ON role_permission_overrides (tenant_id, role_id);
