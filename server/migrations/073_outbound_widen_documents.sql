-- Widen the outbound-message ledger with the four document lifecycle purposes.
--
-- Same twin-table swap as 063/067: the `purpose` CHECK is rebuilt to allow the new
-- keys and every existing row is copied by value. The reminder engine already owns
-- this ledger and the "write before send, UNIQUE(tenant_id, dedupe_key) is the only
-- no-duplicate guarantee" contract, so document-upload reminders and expiry alerts
-- belong here rather than in a second message table that would drift from it.
--
--   document_upload_reminder — "your file is missing these papers", sent in bulk.
--   document_rejected        — a verifier sent a document back with a reason.
--   document_expiring        — the 60/30/7 ladder for CNIC and other tracked dates.
--   document_verified        — a courtesy that a document cleared review.
--
-- A document message has no instalment, so `installment_id` stays NULL; the
-- customer-facing file itself is referenced through the dedupe key and the audit
-- trail, not a new foreign key. The in_app channel (067) already applies, so an
-- in-desk notification for a verification decision rides the same ledger.

CREATE TABLE outbound_messages_new (
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
      'document_upload_reminder',
      'document_rejected',
      'document_expiring',
      'document_verified',
      'manual'
    )
  ),
  channel TEXT NOT NULL CHECK (channel IN ('email', 'sms', 'whatsapp', 'in_app')),
  language TEXT NOT NULL CHECK (language IN ('en', 'ur')),
  to_address TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed', 'skipped')),
  skip_reason TEXT CHECK (
    skip_reason IN ('opt_out', 'quiet_hours', 'promise_paused', 'channel_disabled', 'no_address', 'template_disabled', 'booking_cancelled')
  ),
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

INSERT INTO outbound_messages_new (
  id, tenant_id, customer_id, booking_id, installment_id, purpose, channel,
  language, to_address, subject, body, status, skip_reason, dedupe_key,
  provider, provider_message_id, error, attempts, scheduled_for, sent_at,
  created_at, recorded_by_user_id, recorded_by_name
)
SELECT
  id, tenant_id, customer_id, booking_id, installment_id, purpose, channel,
  language, to_address, subject, body, status, skip_reason, dedupe_key,
  provider, provider_message_id, error, attempts, scheduled_for, sent_at,
  created_at, recorded_by_user_id, recorded_by_name
FROM outbound_messages;

DROP TABLE outbound_messages;

ALTER TABLE outbound_messages_new RENAME TO outbound_messages;

CREATE INDEX IF NOT EXISTS idx_outbound_status
  ON outbound_messages (tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_outbound_customer
  ON outbound_messages (tenant_id, customer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_outbound_installment
  ON outbound_messages (tenant_id, installment_id);

CREATE INDEX IF NOT EXISTS idx_outbound_purpose
  ON outbound_messages (tenant_id, purpose, created_at DESC);
