-- Per-tenant reminder engine settings.
--
-- One row per workspace, holding the chase ladder the officer configured: how many days
-- before a due date the courtesy reminders fall, which late-day marks fire the collection
-- reminders and how they repeat, after how many late days the line escalates to a recovery
-- officer, the hours of the day a customer may be messaged in Pakistan time, which channels
-- are switched on at all, and the language a customer falls back to when they have not
-- chosen one themselves.
--
-- Offsets are CSV day lists rather than JSON because they are read whole by the engine and
-- edited whole by the settings panel; nothing queries inside them. `last_run_date` is the
-- scheduler's daily marker: the hourly tick runs the cycle for a tenant only when the
-- tenant's date has advanced, which gives daily semantics with hourly retry safety if the
-- process was down when the day turned.

CREATE TABLE IF NOT EXISTS reminder_settings (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants (id) ON DELETE CASCADE,
  -- Descending day counts before the due date, e.g. "7,3,1".
  before_offsets TEXT NOT NULL DEFAULT '7,3,1',
  -- Ascending whole-late-day marks, e.g. "1,3,7".
  late_offsets TEXT NOT NULL DEFAULT '1,3,7',
  -- After the last late offset, repeat every N days until paid.
  late_repeat_every_days INTEGER NOT NULL DEFAULT 7 CHECK (late_repeat_every_days BETWEEN 1 AND 60),
  -- Whole late days after which the assigned recovery officer is alerted. 0 switches it off.
  escalation_after_days INTEGER NOT NULL DEFAULT 15 CHECK (escalation_after_days BETWEEN 0 AND 365),
  -- Sending window in Asia/Karachi hours: messages land at or after the start hour and
  -- strictly before the end hour.
  sending_window_start_hour INTEGER NOT NULL DEFAULT 9 CHECK (sending_window_start_hour BETWEEN 0 AND 23),
  sending_window_end_hour INTEGER NOT NULL DEFAULT 20 CHECK (sending_window_end_hour BETWEEN 1 AND 24),
  -- CSV of email,sms,whatsapp,in_app; a channel missing here never dispatches.
  channels_enabled TEXT NOT NULL DEFAULT 'email,sms,whatsapp,in_app',
  default_language TEXT NOT NULL DEFAULT 'en' CHECK (default_language IN ('en', 'ur')),
  -- The YYYY-MM-DD (Karachi) the daily cycle last completed for this tenant.
  last_run_date TEXT,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);
