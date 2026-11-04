-- The customer ledger: an append-only journal of monetary events on a customer account.
--
-- Every money flow — payment recorded, late fee assessed, fee waived, refund paid, a
-- booking cancelled with its charge and refund, a booking transferred out or in — writes
-- one row here. A row is never updated or deleted; a correction is a fresh, opposite
-- entry. The balance is not stored per row; it is the running sum of the signed `amount`
-- (positive adds what the customer owes, negative reduces it) computed at read time, so
-- it cannot drift from the trail it summarises.
--
-- Money is a whole number of the tenant's major currency unit, sharing the platform cap.
-- `reference` carries the receipt/credit document number when the row has one, and
-- `source_type`/`source_id` point back at the row that produced the event.

CREATE TABLE IF NOT EXISTS customer_ledger_entries (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  booking_id TEXT REFERENCES bookings (id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN (
    'payment', 'late_fee', 'waiver', 'refund', 'cancellation_charge',
    'cancellation_refund', 'transfer_out', 'transfer_in', 'adjustment'
  )),
  amount INTEGER NOT NULL CHECK (amount BETWEEN -1000000000000 AND 1000000000000),
  currency TEXT NOT NULL,
  reference TEXT,
  source_type TEXT,
  source_id TEXT,
  occurred_at TEXT NOT NULL,
  note TEXT,
  recorded_by_user_id TEXT NOT NULL,
  recorded_by_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ledger_customer
  ON customer_ledger_entries (tenant_id, customer_id, occurred_at);

CREATE INDEX IF NOT EXISTS idx_ledger_booking
  ON customer_ledger_entries (tenant_id, booking_id);
