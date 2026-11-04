-- Per-customer messaging consent and language.
--
-- The chase may only knock on a door the customer agreed to: a flag per channel, read by
-- the engine before anything is queued, honoured by writing an honest `skipped/opt_out`
-- ledger row rather than silently producing nothing. Default is opted-in, because a buyer
-- who signed up to be chased about instalments should be chased - the officer switches a
-- channel off when the customer asks, not by default.
--
-- `reminder_language` is deliberately nullable-with-no-default: "the customer never chose"
-- is a different fact from "the customer chose English", and the engine resolves NULL to
-- the tenant default at read time. All three are nullable column additions, so SQLite
-- treats them as metadata changes on a populated table.

ALTER TABLE customers ADD COLUMN email_opt_in INTEGER NOT NULL DEFAULT 1 CHECK (email_opt_in IN (0, 1));

ALTER TABLE customers ADD COLUMN sms_opt_in INTEGER NOT NULL DEFAULT 1 CHECK (sms_opt_in IN (0, 1));

ALTER TABLE customers ADD COLUMN whatsapp_opt_in INTEGER NOT NULL DEFAULT 1 CHECK (whatsapp_opt_in IN (0, 1));

ALTER TABLE customers ADD COLUMN reminder_language TEXT CHECK (reminder_language IN ('en', 'ur'));
