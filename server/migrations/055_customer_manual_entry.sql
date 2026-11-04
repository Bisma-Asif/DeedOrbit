-- Manual-first customer entry.
--
-- The officer types every one of these values from the paper form in front of them.
-- Nothing here is inferred, defaulted, or filled in by a machine, which is why every
-- new column is nullable: "nobody has recorded the CNIC yet" is a different fact from
-- "this person has no CNIC", and a blank, a zero, or a placeholder would each be
-- printed as if it were an answer. SQLite cannot attach a CHECK to an added column,
-- so the shape rules (13-digit CNIC, Pakistani phone formats, closed lists for gender
-- and customer type) live in shared/customer-entry.ts and run on every write.
--
-- The two existing address groups are given a reading rather than a rename: what was
-- already on the form stays the *current* address, and the new `permanent_*` group is
-- the one that goes on a sale agreement. The `id_document_*` columns keep their
-- meaning for non-CNIC identity — a passport for an overseas Pakistani, a trade
-- licence number for a company — so a CNIC is never squeezed into a field named for
-- something else.

ALTER TABLE customers ADD COLUMN father_husband_name TEXT;
ALTER TABLE customers ADD COLUMN cnic TEXT;
ALTER TABLE customers ADD COLUMN date_of_birth TEXT;
ALTER TABLE customers ADD COLUMN gender TEXT;
ALTER TABLE customers ADD COLUMN whatsapp TEXT;
ALTER TABLE customers ADD COLUMN occupation TEXT;
ALTER TABLE customers ADD COLUMN customer_type TEXT;
ALTER TABLE customers ADD COLUMN notes TEXT;
ALTER TABLE customers ADD COLUMN permanent_address_line1 TEXT;
ALTER TABLE customers ADD COLUMN permanent_address_line2 TEXT;
ALTER TABLE customers ADD COLUMN permanent_city TEXT;
ALTER TABLE customers ADD COLUMN permanent_state_region TEXT;
ALTER TABLE customers ADD COLUMN permanent_postal_code TEXT;
ALTER TABLE customers ADD COLUMN permanent_country TEXT;
-- Who made the record. Kept as a name as well as an id: a member who later leaves the
-- workspace must not turn into "unknown", because "who entered this?" is the question
-- the field exists to answer.
ALTER TABLE customers ADD COLUMN created_by_user_id TEXT;
ALTER TABLE customers ADD COLUMN created_by_name TEXT;

-- Capture preference, off by default and a real gate rather than decoration: the form
-- only offers a "scan from document" control when it is on. It is added here rather than
-- through `TENANT_COLUMNS` in server/migrations.ts because that list belongs to migration
-- 0002, which is already recorded as applied on every existing workspace - a column added
-- to it would reach a new database and no other. A new migration runs exactly once on
-- both, which is the whole reason for its existence.
ALTER TABLE tenants ADD COLUMN ocr_capture_enabled INTEGER NOT NULL DEFAULT 0
  CHECK (ocr_capture_enabled IN (0, 1));

-- Duplicate *detection*, not duplicate prevention. A second spelling of the same
-- person's phone number is a real thing an office holds, and refusing the save would
-- throw away the rest of a carefully typed form. So these are plain partial indexes:
-- fast lookups for `findDuplicateCustomers`, no UNIQUE constraint, no surprise 409.
-- The `IS NOT NULL` filter keeps the thousands of blank CNICs out of the index.
CREATE INDEX IF NOT EXISTS idx_customers_tenant_cnic
  ON customers (tenant_id, cnic)
  WHERE cnic IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_customers_tenant_whatsapp
  ON customers (tenant_id, whatsapp)
  WHERE whatsapp IS NOT NULL;

-- ---------------------------------------------------------------------------
-- The edit trail
-- ---------------------------------------------------------------------------
--
-- One row per save, holding `changes` as a JSON array of {field, from, to}. Written
-- from the same handler that writes the row, so an edit and its trail cannot disagree.
-- The audit log already records *that* a customer was updated; this records *what
-- changed*, in words the officer can read back on the customer's own page. CNIC values
-- are stored masked, so the trail never hands a full identity number to someone who
-- could not read it on the form.
CREATE TABLE IF NOT EXISTS customer_edit_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  action TEXT NOT NULL,
  -- JSON array: [{ "field": "phone", "from": "...", "to": "..." }]
  changes TEXT NOT NULL DEFAULT '[]',
  -- Where the change came in: the form, the spreadsheet import, or an approval replay.
  source TEXT NOT NULL DEFAULT 'form',
  recorded_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_customer_edit_events_customer
  ON customer_edit_events (tenant_id, customer_id, recorded_at DESC);
