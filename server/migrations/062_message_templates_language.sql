-- Message templates gain a language, wider purposes, and an editable subject.
--
-- The reminder engine delivers in the language the customer chose, falling back to the
-- tenant default, so a template body is no longer keyed by (tenant, channel, purpose)
-- alone - it is keyed by language too. A workspace that maintains English and Urdu wording
-- for the same purpose edits two rows and the engine picks per recipient; nothing is
-- translated at send time, because machine translation of a payment demand is exactly the
-- kind of silent decision this platform refuses to make on a person's behalf.
--
-- The purpose list widens from four to seven so each moment of the chase ladder has its
-- own words: the before-due courtesy note keeps `due_payment_reminder`; "today is the day"
-- becomes `payment_due_today`; the late chase becomes `payment_overdue` (carrying
-- {late_days} and {late_charge}); the instant confirmation after money lands is
-- `payment_received`. `template_key` carries a CHECK, so the table is rebuilt - there are
-- no child tables referencing it, so unlike the permissions widen this is a single rename,
-- create, copy, drop.
--
-- The old table stored no subject: the email subject always came from the shipped default.
-- A workspace that rewrites a body should equally be able to rewrite its subject, so the
-- rebuilt table carries one, seeded blank - and a blank means "use the shipped default",
-- which keeps every existing row's rendered output byte-identical after the widen.

ALTER TABLE message_templates RENAME TO message_templates_before_language;

CREATE TABLE message_templates (
  tenant_id TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('email', 'sms', 'whatsapp')),
  template_key TEXT NOT NULL CHECK (
    template_key IN (
      'due_payment_reminder',
      'payment_due_today',
      'payment_overdue',
      'payment_received',
      'booking_confirmation',
      'service_request_update',
      'receipt'
    )
  ),
  language TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'ur')),
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, channel, template_key, language)
);

-- Every row written before this migration was English-only, by definition.
INSERT INTO message_templates (tenant_id, channel, template_key, language, subject, body, enabled, updated_at)
SELECT tenant_id, channel, template_key, 'en', '', body, enabled, updated_at
FROM message_templates_before_language;

DROP TABLE message_templates_before_language;
