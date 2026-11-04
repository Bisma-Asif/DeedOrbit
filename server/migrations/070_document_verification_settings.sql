-- Per-tenant document-verification settings.
--
-- One row per workspace, created lazily on first write (a missing row reads as the
-- defaults below, so an untouched tenant behaves exactly as it did before this
-- feature). Every column here is a *policy switch*, not a fact: the code reads
-- these to decide whether a booking is blocked, whether a preview is watermarked,
-- how long files are kept, and whether the identity button is live.
--
-- The two block flags default OFF. Turning them on is an admin decision that
-- changes booking behaviour, so no existing tenant is silently gated on upgrade.
-- `allow_override` defaults ON because a hard lock with no escape hatch is how a
-- compliance rule stops a genuine sale; the override is routed through the
-- maker-checker approval queue and logged, so the block is firm but not absolute.

CREATE TABLE IF NOT EXISTS doc_verification_settings (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants (id) ON DELETE CASCADE,
  block_booking INTEGER NOT NULL DEFAULT 0,
  block_plan_activation INTEGER NOT NULL DEFAULT 0,
  allow_override INTEGER NOT NULL DEFAULT 1,
  watermark_previews INTEGER NOT NULL DEFAULT 1,
  -- Days to keep a document after its terminal event; NULL = keep indefinitely.
  -- Advisory retention enforced by a job, not a CHECK, so a wrong value never
  -- silently destroys a file.
  retention_days INTEGER,
  -- Descending thresholds for the expiry alert ladder, as "60,30,7".
  expiry_alert_days TEXT NOT NULL DEFAULT '60,30,7',
  -- 'manual' never claims a government check; 'provider' enables the Verify-with-
  -- provider button only when a live provider config exists (see 071).
  identity_mode TEXT NOT NULL DEFAULT 'manual' CHECK (identity_mode IN ('manual', 'provider')),
  updated_at TEXT NOT NULL,
  updated_by TEXT
);
