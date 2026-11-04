-- Identity-verification provider configuration.
--
-- A licensed government-verification connection (NADRA Verisys, biometric, or a
-- generic partner) is entered by the tenant on a settings screen and stored here.
-- The secret material goes in `credentials_enc`, AES-GCM encrypted with the
-- application key (never this row): a stolen database file yields ciphertext. The
-- client is only ever told *whether a provider is configured* plus a masked hint,
-- so the credential round-trips on write and is never read back.
--
-- Real verification against government records only happens if a provider is
-- connected AND `doc_verification_settings.identity_mode = 'provider'`. With no
-- row here, or in manual mode, the platform is honest that it checked nothing
-- against any registry — see the manual-verification stamp in shared/documents.ts.

CREATE TABLE IF NOT EXISTS identity_provider_configs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('manual', 'nadra_verisys', 'generic')),
  endpoint TEXT,
  -- AES-GCM ciphertext of the provider credential blob (JSON: api key, secret,
  -- certificate, etc). NULL for the manual provider, which needs none.
  credentials_enc TEXT,
  -- A short masked echo for the settings screen, e.g. "****4821". Never the secret.
  credential_hint TEXT,
  enabled INTEGER NOT NULL DEFAULT 0,
  last_checked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_identity_provider_tenant
  ON identity_provider_configs (tenant_id, enabled);
