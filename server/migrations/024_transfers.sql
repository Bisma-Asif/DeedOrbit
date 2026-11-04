-- Booking transfers between customers.
--
-- A transfer reassigns a confirmed booking (and, through it, its installments and payment
-- history) from one customer to another. It is always raised as a request and routed
-- through the maker-checker queue. On approval the booking's customer_id is moved and both
-- accounts get matching ledger entries — a `transfer_out` on the old customer and a
-- `transfer_in` on the new — recording the outstanding balance that moved, plus an
-- optional `adjustment` for the transfer fee on the receiving customer. `documents` is a
-- JSON snapshot of the references that travelled with the booking, kept for the
-- before/after history. A rejected request leaves the booking on the original customer.

CREATE TABLE IF NOT EXISTS transfers (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  booking_id TEXT NOT NULL REFERENCES bookings (id) ON DELETE CASCADE,
  from_customer_id TEXT NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  to_customer_id TEXT NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  fee INTEGER NOT NULL DEFAULT 0 CHECK (fee BETWEEN 0 AND 1000000000000),
  outstanding_moved INTEGER NOT NULL DEFAULT 0 CHECK (outstanding_moved BETWEEN 0 AND 1000000000000),
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  approval_id TEXT,
  documents TEXT,
  requested_by_user_id TEXT NOT NULL,
  requested_by_name TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  completed_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_transfers_booking
  ON transfers (tenant_id, booking_id);

CREATE INDEX IF NOT EXISTS idx_transfers_from
  ON transfers (tenant_id, from_customer_id, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_transfers_to
  ON transfers (tenant_id, to_customer_id, requested_at DESC);
