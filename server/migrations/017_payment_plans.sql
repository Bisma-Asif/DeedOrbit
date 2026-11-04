-- Booking payment plans.
--
-- A plan is the financing schedule a confirmed booking is committed to. The builder
-- runs entirely client-side as a live preview; only a *confirmed* plan is persisted,
-- so a stored plan always has its generated installment rows beside it and there is
-- nothing half-finished in the table — hence the status CHECK of just 'confirmed'.
-- One plan per booking (UNIQUE), and replacing a confirmed plan is refused server-side
-- to keep the money trail honest.
--
-- Money columns are whole integers of the tenant's major currency unit, sharing the
-- platform's price ceiling. Charges are a single flat figure amortized across the
-- installment lines at generation time — there is no percentage tax engine here.

CREATE TABLE IF NOT EXISTS payment_plans (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  booking_id TEXT NOT NULL REFERENCES bookings (id) ON DELETE CASCADE,
  currency TEXT NOT NULL,
  net_amount INTEGER NOT NULL CHECK (net_amount BETWEEN 0 AND 1000000000000),
  down_payment_percent INTEGER NOT NULL CHECK (down_payment_percent BETWEEN 0 AND 100),
  charges INTEGER NOT NULL DEFAULT 0 CHECK (charges BETWEEN 0 AND 1000000000000),
  frequency TEXT NOT NULL CHECK (frequency IN ('monthly', 'quarterly', 'custom')),
  custom_interval_days INTEGER CHECK (custom_interval_days BETWEEN 1 AND 365),
  installment_count INTEGER NOT NULL CHECK (installment_count BETWEEN 1 AND 360),
  balloon_amount INTEGER NOT NULL DEFAULT 0 CHECK (balloon_amount BETWEEN 0 AND 1000000000000),
  start_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed')),
  notes TEXT,
  created_by_user_id TEXT NOT NULL,
  created_by_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  confirmed_at TEXT NOT NULL,
  UNIQUE (tenant_id, booking_id)
);

-- The generated schedule. Each row is one dated line — a down payment, an installment,
-- or the closing balloon. The stored status only ever reflects recorded money; the
-- time-relative reading (upcoming / due / overdue) is derived at read time and never
-- written here, so it cannot go stale between days.
CREATE TABLE IF NOT EXISTS payment_installments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES payment_plans (id) ON DELETE CASCADE,
  booking_id TEXT NOT NULL REFERENCES bookings (id) ON DELETE CASCADE,
  number INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('down_payment', 'installment', 'balloon')),
  due_date TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount BETWEEN 0 AND 1000000000000),
  charges INTEGER NOT NULL DEFAULT 0 CHECK (charges BETWEEN 0 AND 1000000000000),
  total INTEGER NOT NULL CHECK (total BETWEEN 0 AND 1000000000000),
  paid_amount INTEGER NOT NULL DEFAULT 0 CHECK (paid_amount BETWEEN 0 AND 1000000000000),
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'partially_paid', 'paid'))
);

CREATE INDEX IF NOT EXISTS idx_installments_booking
  ON payment_installments (tenant_id, booking_id);

CREATE INDEX IF NOT EXISTS idx_installments_plan
  ON payment_installments (plan_id, number);

-- The receipt trail: every recorded payment against a line, whoever booked it. Bumping
-- an installment's paid_amount is what moves it to partially_paid / paid.
CREATE TABLE IF NOT EXISTS installment_payments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  installment_id TEXT NOT NULL REFERENCES payment_installments (id) ON DELETE CASCADE,
  amount INTEGER NOT NULL CHECK (amount BETWEEN 0 AND 1000000000000),
  paid_at TEXT NOT NULL,
  recorded_by_user_id TEXT NOT NULL,
  recorded_by_name TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_installment_payments
  ON installment_payments (tenant_id, installment_id, paid_at DESC);
