-- The expenses module.
--
-- A cost the tenant incurs against a project, an office, a campaign, or a build
-- site. An expense is never silently deleted: it moves draft -> pending_approval
-- -> approved -> paid, or is rejected once approval lands on the "no" side. The
-- approval id is stored on the row so the queue and the record point at each
-- other without a join, and the same replay path that settles refunds settles
-- expenses.
--
-- `project_id` and `vendor_id` are nullable on purpose: office and marketing
-- spend often has neither, and a project expense can be raised before a supplier
-- is picked. When a vendor is linked and the expense is marked paid, a matching
-- negative row lands on the vendor's ledger. The `vendors` FK points forward to
-- migration 030; SQLite permits a forward reference and only enforces the
-- constraint once the parent table exists, which is by the next boot.

CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('project', 'office', 'marketing', 'construction')),
  project_id TEXT REFERENCES projects (id) ON DELETE SET NULL,
  vendor_id TEXT REFERENCES vendors (id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount BETWEEN 1 AND 1000000000000),
  currency TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending_approval', 'approved', 'paid', 'rejected')),
  approval_id TEXT,
  paid_at TEXT,
  created_by_user_id TEXT NOT NULL,
  created_by_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_expenses_status
  ON expenses (tenant_id, status, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_expenses_vendor
  ON expenses (tenant_id, vendor_id);

CREATE INDEX IF NOT EXISTS idx_expenses_project
  ON expenses (tenant_id, project_id);
