-- Attachments on an expense (a receipt or a vendor invoice, one or two files).
--
-- The bytes live here as a base64 data URL with their real media type, mirroring
-- the tenant-logo pattern. A route-specific body cap lets the upload endpoint
-- accept up to 5 MB per file without widening the global 64 KB JSON limit for
-- every other route. Cap of two files per expense is enforced in the handler.

CREATE TABLE IF NOT EXISTS expense_attachments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  expense_id TEXT NOT NULL REFERENCES expenses (id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes BETWEEN 1 AND 5242880),
  data TEXT NOT NULL,
  uploaded_by_user_id TEXT NOT NULL,
  uploaded_by_name TEXT NOT NULL,
  uploaded_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_expense_attachments_expense
  ON expense_attachments (tenant_id, expense_id);
