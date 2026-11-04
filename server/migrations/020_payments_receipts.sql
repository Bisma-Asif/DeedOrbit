-- Recorded payments, their allocation across installments, and the receipt trail.
--
-- A payment is money received against a customer in one act, captured on a header row
-- and then split across one or more schedule lines through `payment_allocations`. The
-- header carries the method, the received date, and the receipt document number minted
-- from the tenant's `receipt` sequence — unique per workspace, so two receipts can never
-- share a number. Allocating to a line whose due date is still ahead is an advance
-- payment and is legal; the per-line money trail stays in the existing
-- `installment_payments`, which grows a nullable `payment_id` linking each receipt line
-- back to the payment that produced it. Existing rows keep a NULL link, so the earlier
-- plan tests are untouched.

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  booking_id TEXT REFERENCES bookings (id) ON DELETE SET NULL,
  currency TEXT NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('cash', 'bank', 'online')),
  amount INTEGER NOT NULL CHECK (amount BETWEEN 0 AND 1000000000000),
  receipt_number TEXT,
  note TEXT,
  recorded_by_user_id TEXT NOT NULL,
  recorded_by_name TEXT NOT NULL,
  received_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_payments_customer
  ON payments (tenant_id, customer_id, received_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_receipt
  ON payments (tenant_id, receipt_number)
  WHERE receipt_number IS NOT NULL;

CREATE TABLE IF NOT EXISTS payment_allocations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  payment_id TEXT NOT NULL REFERENCES payments (id) ON DELETE CASCADE,
  installment_id TEXT NOT NULL REFERENCES payment_installments (id) ON DELETE CASCADE,
  amount INTEGER NOT NULL CHECK (amount BETWEEN 0 AND 1000000000000),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_allocations_payment
  ON payment_allocations (tenant_id, payment_id);

CREATE INDEX IF NOT EXISTS idx_allocations_installment
  ON payment_allocations (tenant_id, installment_id);

-- The receipt line now remembers the payment header it belongs to. Nullable: rows
-- written before this flow existed (and by the plan tests) simply carry no header link.
ALTER TABLE installment_payments ADD COLUMN payment_id TEXT;
