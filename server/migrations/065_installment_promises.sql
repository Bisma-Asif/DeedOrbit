-- Promise to pay on an instalment line.
--
-- The collector reaches the customer on the phone, the customer says "send the cheque
-- next week", and the officer records the date they gave plus a note about the call. The
-- reminder engine reads this and holds the chase on that line until the promised day has
-- passed - not because the promise settles anything (only a recorded payment does that),
-- but because chasing a person who has given their word, over the top of the officer who
-- just took it, teaches the customer that nothing they say here is listened to.
--
-- Nullable columns only: an instalment without a promise is the normal state and stores
-- nothing. Clearing a promise nulls the date rather than deleting a trail - who logged it
-- and when stays in the audit log, which records the change itself.

ALTER TABLE payment_installments ADD COLUMN promise_to_pay_date TEXT;

ALTER TABLE payment_installments ADD COLUMN promise_note TEXT;

ALTER TABLE payment_installments ADD COLUMN promise_by_user_id TEXT;

ALTER TABLE payment_installments ADD COLUMN promise_by_name TEXT;

ALTER TABLE payment_installments ADD COLUMN promise_recorded_at TEXT;
