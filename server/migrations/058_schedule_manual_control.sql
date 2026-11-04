-- The schedule is the officer's to write, and every change to it is on the record.
--
-- A generated plan is the normal case, so `source` starts at 'generated' on every row
-- and `schedule_mode` starts at 'generated' on every plan. A line the officer added by
-- hand says 'manual' and names who added it, so the schedule a manager reads can be told
-- apart from the arithmetic that produced most of it.
--
-- `schedule_change_logs` is the diary of that editing: a row per added, changed or
-- removed line, with the before and after figures and the reason the officer gave. It is
-- written by the same handler that moves the row, so the log cannot fall behind the
-- schedule. Once money has been recorded against a line the change stops being an edit
-- and becomes a request - `payment_amendments` and the approval queue carry those, and
-- an `approval_id` recorded here is how an approved change is traceable after the fact.

ALTER TABLE payment_installments ADD COLUMN source TEXT NOT NULL DEFAULT 'generated';
ALTER TABLE payment_installments ADD COLUMN added_by_user_id TEXT;
ALTER TABLE payment_installments ADD COLUMN added_by_name TEXT;
ALTER TABLE payment_installments ADD COLUMN edited_at TEXT;

ALTER TABLE payment_plans ADD COLUMN schedule_mode TEXT NOT NULL DEFAULT 'generated';

CREATE TABLE IF NOT EXISTS schedule_change_logs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  booking_id TEXT NOT NULL REFERENCES bookings (id) ON DELETE CASCADE,
  plan_id TEXT REFERENCES payment_plans (id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (
    action IN ('added', 'edited', 'removed', 'confirmed', 'held_for_approval')
  ),
  installment_number INTEGER,
  -- JSON objects of the line as it was and as it became. A removal has no `after`, an
  -- addition no `before` - a dash on screen is honest where a zero would not be.
  before TEXT,
  after TEXT,
  reason TEXT NOT NULL,
  user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  approval_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_schedule_change_logs_booking
  ON schedule_change_logs (tenant_id, booking_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Money already written down is not edited in place
-- ---------------------------------------------------------------------------
--
-- A receipt in a customer's hand says something about the ledger. Changing or deleting
-- the payment behind it is therefore raised as a request with a reason, held in the
-- generic approval queue, and replayed from `proposed` by a *different* user when it is
-- signed off - the same maker-checker machinery every other sensitive change here uses,
-- so there is no second engine of half-applied edits. `status` mirrors the approval so
-- the payment screen can show its own pending state without reading the queue.
CREATE TABLE IF NOT EXISTS payment_amendments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  payment_id TEXT NOT NULL REFERENCES payments (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('edit', 'delete')),
  -- The validated body to replay on approval, exactly as an approval row stores it.
  proposed TEXT,
  reason TEXT NOT NULL,
  requested_by_user_id TEXT NOT NULL,
  requested_by_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'approved', 'rejected')
  ),
  approval_id TEXT,
  created_at TEXT NOT NULL,
  applied_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_payment_amendments_payment
  ON payment_amendments (tenant_id, payment_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_amendments_status
  ON payment_amendments (tenant_id, status);
