-- DeedOrbit — platform schema
--
-- Tenancy rule: every business table carries a NOT NULL `tenant_id` that
-- references `tenants(id)`. Rows are never queried without it, and the API
-- middleware refuses any request whose tenant does not match the session.
--
-- Identity vs. access: `users` is an identity row (login, password, 2FA).
-- Authority is *not* on the user — it lives in `tenant_memberships`, so one
-- person can hold different roles in different workspaces.

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- Tenants
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS tenants (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  legal_name   TEXT,
  slug         TEXT NOT NULL UNIQUE,         -- tenant.deedorbit.example
  status       TEXT NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active','suspended','closed')),
  plan         TEXT NOT NULL DEFAULT 'standard',
  logo_initials TEXT,
  primary_color TEXT,
  timezone     TEXT NOT NULL DEFAULT 'UTC',
  currency     TEXT NOT NULL DEFAULT 'AED',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants (status);
CREATE INDEX IF NOT EXISTS idx_tenants_slug   ON tenants (slug);

-- ---------------------------------------------------------------------------
-- Roles — the 11 shipped roles. Labels live in the DB so they can be reworded.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS roles (
  role_id    TEXT PRIMARY KEY,               -- matches shared/access.ts RoleId
  label      TEXT NOT NULL,
  scope      TEXT NOT NULL CHECK (scope IN ('platform','tenant')),
  description TEXT NOT NULL DEFAULT '',
  rank       INTEGER NOT NULL,               -- higher outranks lower
  is_assignable INTEGER NOT NULL DEFAULT 1, -- may be handed out in-app
  created_at TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- Permissions — module x action catalogue. Seeded from shared/access.ts.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS permissions (
  permission_id TEXT PRIMARY KEY,           -- 'payments.approve'
  module_id     TEXT NOT NULL,
  action        TEXT NOT NULL CHECK (action IN ('view','create','edit','delete','approve','change_status')),
  label         TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  sort_order    INTEGER NOT NULL,
  UNIQUE (module_id, action)
);

CREATE INDEX IF NOT EXISTS idx_permissions_module ON permissions (module_id, sort_order);

-- ---------------------------------------------------------------------------
-- Grants
--
-- `role_permission_defaults` is the platform baseline applied to every tenant.
-- `role_permission_overrides` is a per-tenant adjustment that WINS over the
-- baseline. Keeping them in separate tables means "what does this role get"
-- is always one query, and the audit trail can show what a tenant changed
-- relative to the platform default.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS role_permission_defaults (
  role_id       TEXT NOT NULL REFERENCES roles (role_id) ON DELETE CASCADE,
  permission_id TEXT NOT NULL REFERENCES permissions (permission_id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS role_permission_overrides (
  tenant_id     TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  role_id       TEXT NOT NULL REFERENCES roles (role_id) ON DELETE CASCADE,
  permission_id TEXT NOT NULL REFERENCES permissions (permission_id) ON DELETE CASCADE,
  effect        TEXT NOT NULL CHECK (effect IN ('allow','deny')),
  updated_at    TEXT NOT NULL,
  updated_by    TEXT,
  PRIMARY KEY (tenant_id, role_id, permission_id)
);

CREATE INDEX IF NOT EXISTS idx_overrides_tenant ON role_permission_overrides (tenant_id, role_id);

-- ---------------------------------------------------------------------------
-- Users — identity only. No role column: authority comes from memberships.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  email         TEXT NOT NULL UNIQUE,        -- login handle, always lowercase
  full_name     TEXT NOT NULL,
  phone         TEXT,
  job_title     TEXT,
  status        TEXT NOT NULL DEFAULT 'invited'
                  CHECK (status IN ('invited','active','suspended','deactivated')),
  password_hash TEXT,                        -- NULL until an invite is accepted
  password_changed_at TEXT,
  email_verified_at TEXT,
  twofa_enabled INTEGER NOT NULL DEFAULT 0 CHECK (twofa_enabled IN (0,1)),
  twofa_secret  TEXT,                        -- base32, reserved for 2FA
  twofa_pending_secret TEXT,                 -- set between enroll and confirm
  failed_login_count INTEGER NOT NULL DEFAULT 0,
  locked_until  TEXT,
  last_login_at TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_tenant  ON users (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_users_email   ON users (email);
CREATE INDEX IF NOT EXISTS idx_users_name    ON users (tenant_id, full_name);

-- Which role a user holds in which tenant, and whether it is their default.
CREATE TABLE IF NOT EXISTS tenant_memberships (
  tenant_id  TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role_id    TEXT NOT NULL REFERENCES roles (role_id),
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0,1)),
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_memberships_user ON tenant_memberships (user_id);

-- ---------------------------------------------------------------------------
-- Sessions — token is never stored in the clear; only its SHA-256 digest.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS sessions (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  tenant_id     TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  active_role_id TEXT REFERENCES roles (role_id),
  token_hash    TEXT NOT NULL UNIQUE,
  user_agent    TEXT,
  ip_address    TEXT,
  -- A session created before the second factor is confirmed stays unusable.
  pending_twofa INTEGER NOT NULL DEFAULT 0 CHECK (pending_twofa IN (0,1)),
  created_at    TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL,
  expires_at    TEXT NOT NULL,
  revoked_at    TEXT,
  revoked_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_user    ON sessions (user_id, revoked_at);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires_at);

-- ---------------------------------------------------------------------------
-- Credential lifecycle
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id         TEXT PRIMARY KEY,
  tenant_id  TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at    TEXT
);

CREATE INDEX IF NOT EXISTS idx_reset_user ON password_reset_tokens (user_id);

CREATE TABLE IF NOT EXISTS user_invitations (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  full_name   TEXT,
  role_id     TEXT NOT NULL REFERENCES roles (role_id),
  token_hash  TEXT NOT NULL UNIQUE,
  invited_by  TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  accepted_at TEXT,
  revoked_at  TEXT
);

CREATE INDEX IF NOT EXISTS idx_invites_tenant ON user_invitations (tenant_id, created_at);

-- Used and unused 2FA recovery codes, stored hashed like passwords.
CREATE TABLE IF NOT EXISTS twofa_recovery_codes (
  id         TEXT PRIMARY KEY,
  tenant_id  TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  code_hash  TEXT NOT NULL,
  used_at    TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_recovery_user ON twofa_recovery_codes (user_id, used_at);

-- ---------------------------------------------------------------------------
-- Audit log — every privileged action, scoped to a tenant.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS audit_log (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  actor_user_id TEXT REFERENCES users (id) ON DELETE SET NULL,
  actor_email TEXT,
  action      TEXT NOT NULL,                -- 'user.invited', 'session.revoked'
  target_type TEXT,
  target_id   TEXT,
  detail      TEXT,                         -- JSON
  ip_address  TEXT,
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_tenant ON audit_log (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor  ON audit_log (actor_user_id, created_at DESC);
