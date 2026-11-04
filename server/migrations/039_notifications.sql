-- In-app notifications — a personal, per-user event inbox, and the per-user
-- switches that decide which events reach which channel.
--
-- A `notifications` row is written by the fan-out helper (`server/notify.ts`) when
-- something a person cares about happens: a booking they own is confirmed, a
-- payment lands on their account, an approval waits on them, or a file is added
-- to a record they work on. It is *read-mostly* and belongs to exactly one user
-- (`user_id`), so it is scoped by authentication alone — there is no module grant,
-- because one person's inbox is not a securable workspace surface.
--
-- `channel` records how the recipient *chose* to be told for that type. There is
-- no mail gateway in this environment, so "email"/"both" are stored honestly as a
-- preference and surfaced with a "not connected" note; they are never a claim a
-- message went out. A type switched to "off" suppresses the row at the fan-out, so
-- an "off" notification simply does not exist here.
--
-- `user_notification_settings` holds a user's declared channel per type. A missing
-- row means the shared default (in-app), so the table only stores deliberate
-- choices and a new type needs no backfill. The primary key is (tenant, user, type)
-- so a preference is personal and cannot leak across workspaces.

CREATE TABLE IF NOT EXISTS notifications (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type          TEXT NOT NULL CHECK (
                  type IN ('booking_confirmed', 'payment_recorded',
                           'approval_requested', 'document_uploaded')
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

-- The inbox read on every bell open and page visit: this user's newest-first rows.
CREATE INDEX IF NOT EXISTS idx_notifications_inbox
  ON notifications (tenant_id, user_id, created_at DESC);

-- The unread count, taken on every load, filters on read_at being null.
CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON notifications (tenant_id, user_id, read_at);

CREATE TABLE IF NOT EXISTS user_notification_settings (
  tenant_id  TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type       TEXT NOT NULL CHECK (
               type IN ('booking_confirmed', 'payment_recorded',
                        'approval_requested', 'document_uploaded')
             ),
  channel    TEXT NOT NULL CHECK (
               channel IN ('in_app', 'email', 'both', 'off')
             ),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, user_id, type)
);
