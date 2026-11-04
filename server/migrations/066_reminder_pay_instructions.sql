-- The workspace's own "how to pay" text.
--
-- {pay_instructions} in a reminder has exactly one honest source: the words the
-- office typed for its own bank account, counter, or portal habits. A workspace
-- that has written none gets the token reported as missing in the preview and left
-- visibly unsubstituted in the ledger body - the engine never composes payment
-- instructions on an office's behalf, because a wrong account number in a
-- customer-facing message is the most expensive sentence this platform can print.

ALTER TABLE reminder_settings ADD COLUMN pay_instructions TEXT NOT NULL DEFAULT '';
