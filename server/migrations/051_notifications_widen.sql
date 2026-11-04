-- Widen the notification type CHECK for the procurement and signature events.
--
-- Same rebuild-and-swap trick as 018/029/050: SQLite cannot alter a CHECK in
-- place, so the widened twins replace both `notifications` and its preference
-- table `user_notification_settings`, and the two inbox indexes are recreated.
-- The four original event keys keep behaving exactly as before; the new
-- `requisition_decided`, `purchase_order_received`, and `envelope_completed`
-- keys simply become legal. Every one of them is a real event the fan-out
-- writes — the procurement GRN/requisition flows and the signing ceremony.

CREATE TABLE notifications_new (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type          TEXT NOT NULL CHECK (
                  type IN ('booking_confirmed', 'payment_recorded',
                           'approval_requested', 'document_uploaded',
                           'requisition_decided', 'purchase_order_received',
                           'envelope_completed')
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
                        'envelope_completed')
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
