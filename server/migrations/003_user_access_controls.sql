-- Migration 0003 — user access controls.
--
-- Three things the members module needs that `0001`/`0002` did not carry:
-- per-user branch restriction, a durable sign-in history, and a flag that
-- forces a member to replace their password before the app opens.
--
-- The `users` columns are added by server/migrations.ts rather than here,
-- because SQLite has no `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` and these
-- statements must be safe on a database where 0001 already ran.

-- ---------------------------------------------------------------------------
-- Branch restriction
-- ---------------------------------------------------------------------------
--
-- A member with no rows here sees the whole workspace; a member with at least
-- one row is limited to those branches. Absence is the permissive default so
-- that adding this table cannot silently lock an existing administrator out of
-- the workspace they administer.
--
-- `tenant_id` is part of the key as well as a column, so a user id is scoped to
-- the workspace that assigned it even though `users` is keyed by id alone.

CREATE TABLE IF NOT EXISTS user_branches (
  tenant_id  TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  branch_id  TEXT NOT NULL REFERENCES branches (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, user_id, branch_id)
);

CREATE INDEX IF NOT EXISTS idx_user_branches_user   ON user_branches (tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_user_branches_branch ON user_branches (tenant_id, branch_id);

-- ---------------------------------------------------------------------------
-- Sign-in history
-- ---------------------------------------------------------------------------
--
-- One row per authentication attempt, successful or not. `audit_log` records
-- privileged *actions* by an already-signed-in actor; this table records the
-- moments a session begins or is refused, which is what an administrator
-- reviewing "was this account used by someone else?" needs to see.
--
-- `outcome` is a closed set rather than free text so the UI can colour it:
--   success     — password accepted and a session issued
--   failed      — wrong password
--   suspended   — account is suspended or deactivated
--   locked      — too many failures, or a lockout still in force
--   reset_required — password was correct but an admin forced a reset
--   twofa_challenged — password accepted, second factor still outstanding

-- `tenant_id` and `user_id` are nullable on purpose. A wrong password against an
-- address that exists in no workspace cannot be attributed to either, and
-- dropping the attempt would leave the lockout counter moving with no record of
-- it. Such a row is unreadable by design — every read is scoped by tenant and
-- user — so recording it costs nothing and leaks nothing.

CREATE TABLE IF NOT EXISTS login_events (
  id         TEXT PRIMARY KEY,
  tenant_id  TEXT REFERENCES tenants (id) ON DELETE CASCADE,
  user_id    TEXT REFERENCES users (id) ON DELETE SET NULL,
  email      TEXT NOT NULL,
  outcome    TEXT NOT NULL CHECK (outcome IN (
               'success',
               'failed',
               'suspended',
               'locked',
               'reset_required',
               'twofa_challenged'
             )),
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL
);

-- Read path is always "this user's history, newest first", scoped by tenant.
CREATE INDEX IF NOT EXISTS idx_login_events_user   ON login_events (tenant_id, user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_events_email  ON login_events (tenant_id, email, created_at DESC);