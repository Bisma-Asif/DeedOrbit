-- Payments entered by hand, with the bank's paperwork beside them.
--
-- A recorded payment is the officer writing down money they have actually counted or
-- seen in a statement, so the row carries what a human reads off the instrument: the
-- cheque number, the bank the transfer came from, an image of the receipt or slip, and
-- whether it was typed live or migrated in when the account was opened. `entry_source`
-- is what lets a report separate "we watched this happen" from "this was on the ledger
-- when we started using the system", which the spec asks to be visible rather than
-- quietly mixed into the day's totals.
--
-- `method` gains 'cheque', which is a CHECK constraint - so the table is rebuilt. The
-- precedent is 011 rebuilding `customers`, with one addition this one needs and that one
-- did not: `payment_allocations` and `refunds` both hold foreign keys pointing at
-- `payments`. Renaming a parent rewrites those clauses to the temporary name, and
-- dropping the temporary parent would then cascade through them (verified against this
-- exact SQLite build), so each child is rebuilt in the same migration to point back at
-- the live table before the old one is dropped. Money rows are never re-keyed.

ALTER TABLE payments RENAME TO payments_before_manual_entry;

CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  booking_id TEXT REFERENCES bookings (id) ON DELETE SET NULL,
  currency TEXT NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('cash', 'bank', 'cheque', 'online')),
  amount INTEGER NOT NULL CHECK (amount BETWEEN 0 AND 1000000000000),
  receipt_number TEXT,
  note TEXT,
  reference_number TEXT,
  bank_name TEXT,
  -- The proof image, in the same base64 shape as `documents.data`. Kept on the payment
  -- rather than as a `documents` row so no `entity_type` CHECK has to be widened and the
  -- blob table is never rebuilt; the bytes are released through the same grant endpoint.
  proof_mime TEXT,
  proof_size_bytes INTEGER CHECK (
    proof_size_bytes IS NULL OR proof_size_bytes BETWEEN 0 AND 10485760
  ),
  proof_data TEXT,
  entry_source TEXT NOT NULL DEFAULT 'manual' CHECK (
    entry_source IN ('manual', 'opening_balance', 'import', 'batch')
  ),
  amended_at TEXT,
  last_edited_by_user_id TEXT,
  recorded_by_user_id TEXT NOT NULL,
  recorded_by_name TEXT NOT NULL,
  received_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

INSERT INTO payments (
  id, tenant_id, customer_id, booking_id, currency, method, amount, receipt_number,
  note, recorded_by_user_id, recorded_by_name, received_at, created_at
)
SELECT
  id, tenant_id, customer_id, booking_id, currency, method, amount, receipt_number,
  note, recorded_by_user_id, recorded_by_name, received_at, created_at
FROM payments_before_manual_entry;

-- Rebuild the two tables that point at `payments`, in the order that keeps every row:
-- the children move out of the way and are re-created against the live parent, so the
-- temporary parent is dropped with nothing left referencing it.

ALTER TABLE payment_allocations RENAME TO payment_allocations_before_manual_entry;

CREATE TABLE payment_allocations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  payment_id TEXT NOT NULL REFERENCES payments (id) ON DELETE CASCADE,
  installment_id TEXT NOT NULL REFERENCES payment_installments (id) ON DELETE CASCADE,
  amount INTEGER NOT NULL CHECK (amount BETWEEN 0 AND 1000000000000),
  created_at TEXT NOT NULL
);

INSERT INTO payment_allocations (
  id, tenant_id, payment_id, installment_id, amount, created_at
)
SELECT
  id, tenant_id, payment_id, installment_id, amount, created_at
FROM payment_allocations_before_manual_entry;

DROP TABLE payment_allocations_before_manual_entry;

ALTER TABLE refunds RENAME TO refunds_before_manual_entry;

CREATE TABLE refunds (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  booking_id TEXT REFERENCES bookings (id) ON DELETE SET NULL,
  installment_id TEXT REFERENCES payment_installments (id) ON DELETE SET NULL,
  payment_id TEXT REFERENCES payments (id) ON DELETE SET NULL,
  amount INTEGER NOT NULL CHECK (amount BETWEEN 0 AND 1000000000000),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'approved', 'paid', 'rejected')
  ),
  credit_number TEXT,
  approval_id TEXT,
  requested_by_user_id TEXT NOT NULL,
  requested_by_name TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  paid_at TEXT,
  recorded_by_user_id TEXT,
  recorded_by_name TEXT,
  updated_at TEXT NOT NULL
);

INSERT INTO refunds (
  id, tenant_id, customer_id, booking_id, installment_id, payment_id, amount, reason,
  status, credit_number, approval_id, requested_by_user_id, requested_by_name,
  requested_at, paid_at, recorded_by_user_id, recorded_by_name, updated_at
)
SELECT
  id, tenant_id, customer_id, booking_id, installment_id, payment_id, amount, reason,
  status, credit_number, approval_id, requested_by_user_id, requested_by_name,
  requested_at, paid_at, recorded_by_user_id, recorded_by_name, updated_at
FROM refunds_before_manual_entry;

DROP TABLE refunds_before_manual_entry;

DROP TABLE payments_before_manual_entry;

CREATE INDEX IF NOT EXISTS idx_payments_customer
  ON payments (tenant_id, customer_id, received_at DESC);

-- Still unique per workspace, still only when a number was written: two blank receipts
-- are two receipts the officer has not numbered yet, not a clash.
CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_receipt
  ON payments (tenant_id, receipt_number)
  WHERE receipt_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payments_received_by
  ON payments (tenant_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_payments_entry_source
  ON payments (tenant_id, entry_source);

CREATE INDEX IF NOT EXISTS idx_allocations_payment
  ON payment_allocations (tenant_id, payment_id);

CREATE INDEX IF NOT EXISTS idx_allocations_installment
  ON payment_allocations (tenant_id, installment_id);

CREATE INDEX IF NOT EXISTS idx_refunds_customer
  ON refunds (tenant_id, customer_id, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_refunds_status
  ON refunds (tenant_id, status);
