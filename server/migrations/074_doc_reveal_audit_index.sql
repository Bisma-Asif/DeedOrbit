-- Reveal / download reporting over the existing audit trail.
--
-- Document access logging reuses `audit_log` (it already carries actor, action,
-- target, detail and IP), so there is no second log table to keep in sync. The one
-- missing piece for the compliance questions — "who revealed this customer's CNIC,
-- who downloaded which file, and when" — is a read index on (tenant, action), which
-- the base schema did not create because audit was originally write-mostly.
--
-- `IF NOT EXISTS` keeps this re-runnable, and no rows are touched.

CREATE INDEX IF NOT EXISTS idx_audit_log_action
  ON audit_log (tenant_id, action, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_target
  ON audit_log (tenant_id, target_type, target_id, created_at DESC);
