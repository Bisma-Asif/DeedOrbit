-- Communication templates: the editable bodies behind email / SMS / WhatsApp.
--
-- One row per (tenant, channel, purpose). The `template_key` is one of the four
-- fixed purposes in shared/communications.ts (due-payment reminder, receipt,
-- booking confirmation, service-request update); the `body` is plain text with
-- `{placeholder}` tokens that `renderTemplate` substitutes at send/preview time.
--
-- Templates are seeded for every workspace from DEFAULT_TEMPLATES with INSERT OR
-- IGNORE (in seed.ts, mirroring the unit-status seed), so a tenant's edits are
-- never clobbered on the next boot. Nothing here sends anything: this table only
-- stores what the message would say.

CREATE TABLE IF NOT EXISTS message_templates (
  tenant_id TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('email', 'sms', 'whatsapp')),
  template_key TEXT NOT NULL CHECK (template_key IN ('due_payment_reminder', 'receipt', 'booking_confirmation', 'service_request_update')),
  body TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, channel, template_key)
);
