-- The outbound message ledger: every customer-facing message, ever attempted.
--
-- This table is the reminder engine's memory. A row is written *before* the provider is
-- called, so "we decided to send this" is recorded even if the socket then fails - and the
-- UNIQUE (tenant_id, dedupe_key) constraint is the whole no-duplicate guarantee: the engine
-- queues with INSERT OR IGNORE, so re-running yesterday's cycle, an hourly retry tick, or a
-- restarted server cannot produce a second message for the same (installment, purpose,
-- occurrence day). There is no lock row and no check-then-insert race to lose: the database
-- itself refuses the duplicate.
--
-- `status` moves forward only - queued to sent, queued to failed, failed back to queued on
-- an explicit retry - and `skipped` is terminal and honest: the message was decided against
-- (opt-out, quiet hours, a paused promise, a switched-off channel) and the reason says which.
-- A skipped row is still a row, because "why did my customer not get chased?" is a question
-- the desk asks constantly and the answer should be readable, not inferred from absence.
--
-- The body is stored rendered. Later template edits must not rewrite what was actually
-- sent; this row is the evidence of the sentence the customer received, and it is what the
-- Reminders page previews on a retry.
--
-- `purpose` reuses the widened message_templates key list plus 'manual' for a send an
-- officer triggered from the row's Send-now control, where no ladder position applies.

CREATE TABLE IF NOT EXISTS outbound_messages (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  booking_id TEXT REFERENCES bookings (id) ON DELETE SET NULL,
  installment_id TEXT REFERENCES payment_installments (id) ON DELETE SET NULL,
  purpose TEXT NOT NULL CHECK (
    purpose IN (
      'due_payment_reminder',
      'payment_due_today',
      'payment_overdue',
      'payment_received',
      'recovery_escalation',
      'manual'
    )
  ),
  channel TEXT NOT NULL CHECK (channel IN ('email', 'sms', 'whatsapp')),
  language TEXT NOT NULL CHECK (language IN ('en', 'ur')),
  -- The resolved address it went to (email address or phone), or empty when there was none.
  to_address TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed', 'skipped')),
  skip_reason TEXT CHECK (
    skip_reason IN ('opt_out', 'quiet_hours', 'promise_paused', 'channel_disabled', 'no_address', 'template_disabled', 'booking_cancelled')
  ),
  -- Unique per (tenant, ladder fire). Manual sends stamp their own instant so a
  -- deliberate "Send now" is never swallowed by a prior automatic row's key.
  dedupe_key TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT '',
  provider_message_id TEXT NOT NULL DEFAULT '',
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 100),
  scheduled_for TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL,
  recorded_by_user_id TEXT NOT NULL DEFAULT '',
  recorded_by_name TEXT NOT NULL DEFAULT '',
  UNIQUE (tenant_id, dedupe_key)
);

CREATE INDEX IF NOT EXISTS idx_outbound_status
  ON outbound_messages (tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_outbound_customer
  ON outbound_messages (tenant_id, customer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_outbound_installment
  ON outbound_messages (tenant_id, installment_id);
