-- Refund requests and their settlement trail.
--
-- A refund pays money back out of a customer account. It is always raised as a request
-- and routed through the maker-checker queue, so the row starts `pending` alongside an
-- open approval. On approval it becomes `approved` and then `paid`, minting a credit
-- note number from the tenant's `receipt` sequence (the same document kind receipts
-- use — there is no separate refund sequence) and writing a ledger entry. A rejected
-- request records the decision but touches no money. `payment_id` links the refund to
-- the original receipt it unwinds so the amount can be capped at the un-refunded
-- remainder of that payment.

CREATE TABLE IF NOT EXISTS refunds (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  booking_id TEXT REFERENCES bookings (id) ON DELETE SET NULL,
  installment_id TEXT REFERENCES payment_installments (id) ON DELETE SET NULL,
  payment_id TEXT REFERENCES payments (id) ON DELETE SET NULL,
  amount INTEGER NOT NULL CHECK (amount BETWEEN 0 AND 1000000000000),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'paid', 'rejected')),
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

CREATE INDEX IF NOT EXISTS idx_refunds_customer
  ON refunds (tenant_id, customer_id, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_refunds_status
  ON refunds (tenant_id, status);
