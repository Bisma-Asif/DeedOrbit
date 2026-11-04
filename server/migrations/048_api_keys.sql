-- Integrations: API keys.
--
-- The same deal as a session token: only the SHA-256 hash is stored, the
-- plaintext exists in exactly one response and then only in the caller's
-- hands. The `prefix` is for recognition in the list — first characters,
-- useless for authenticating, enough to tell two keys apart.
--
-- `api_key_requests` is the audit-lite trail: which key touched which
-- path, and what the door said. Every request that presented a key lands
-- here, accepted or refused, so a leaked key's blast radius is readable.

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  prefix TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL,
  created_by_name TEXT NOT NULL,
  expires_at TEXT,
  revoked_at TEXT,
  last_used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_api_key_token
  ON api_keys (token_hash);

CREATE INDEX IF NOT EXISTS idx_api_keys_tenant
  ON api_keys (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS api_key_requests (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  api_key_id TEXT REFERENCES api_keys (id) ON DELETE SET NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  status INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_api_key_requests_key
  ON api_key_requests (tenant_id, api_key_id, created_at DESC);
