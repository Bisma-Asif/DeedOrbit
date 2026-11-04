-- Two widenings the reminder engine needs that the original tables did not foresee.
--
-- (1) `outbound_messages` gains the `in_app` channel. An escalation is a decision
-- the desk made — "this account crossed the late-day threshold and someone was
-- told" — and like every other decision it belongs in the ledger with its status
-- and its timestamp, not only in the staff inbox. The rebuild is the established
-- rename-create-copy-drop: SQLite cannot alter a CHECK in place.
--
-- (2) `notifications` and `user_notification_settings` gain the
-- `payment_escalation` type. It is a real event the fan-out writes — the same
-- bar the other keys clear (see 051): an instalment crossed the tenant's
-- escalation threshold and its collector, or the recovery desk, was alerted.
--
-- Every row written before this migration is untouched: the ledger CHECK only
-- *widens* what may be stored, and the notification CHECK likewise. A fresh
-- database arrives in the same shape by running 063/051 and then this.

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

-- (2) the notification type widen, the same twin-table swap 051 used.

CREATE TABLE notifications_new (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type          TEXT NOT NULL CHECK (
                  type IN ('booking_confirmed', 'payment_recorded',
                           'approval_requested', 'document_uploaded',
                           'requisition_decided', 'purchase_order_received',
                           'envelope_completed', 'payment_escalation')
                ),
  channel       TEXT NOT NULL CHECK (
                  channel IN ('in_app', 'email', 'both')
                ),
  title         TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 140),
  body          TEXT CHECK (body IS NULL OR length(body) <= 400),
  link_path     TEXT CHECK (link_path IS NULL OR length(link_path) <= 240),
  actor_user_id TEXT,
  actor_name    TEXT,
  read_at       TEXT,
  created_at    TEXT NOT NULL
);

INSERT INTO notifications_new (
  id, tenant_id, user_id, type, channel, title, body, link_path,
  actor_user_id, actor_name, read_at, created_at
)
  SELECT
    id, tenant_id, user_id, type, channel, title, body, link_path,
    actor_user_id, actor_name, read_at, created_at
  FROM notifications;

DROP TABLE notifications;

ALTER TABLE notifications_new RENAME TO notifications;

CREATE INDEX IF NOT EXISTS idx_notifications_inbox
  ON notifications (tenant_id, user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON notifications (tenant_id, user_id, read_at);

CREATE TABLE user_notification_settings_new (
  tenant_id  TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type       TEXT NOT NULL CHECK (
               type IN ('booking_confirmed', 'payment_recorded',
                        'approval_requested', 'document_uploaded',
                        'requisition_decided', 'purchase_order_received',
                        'envelope_completed', 'payment_escalation')
             ),
  channel    TEXT NOT NULL CHECK (
               channel IN ('in_app', 'email', 'both', 'off')
             ),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, user_id, type)
);

INSERT INTO user_notification_settings_new (
  tenant_id, user_id, type, channel, updated_at
)
  SELECT tenant_id, user_id, type, channel, updated_at
  FROM user_notification_settings;

DROP TABLE user_notification_settings;

ALTER TABLE user_notification_settings_new RENAME TO user_notification_settings;
