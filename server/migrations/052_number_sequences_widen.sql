-- Widen number_sequences.kind to accept the procurement document kinds.
--
-- Procurement raises requisitions and purchase orders through the same
-- numbering machinery as invoices, receipts and bookings, so the two new kinds
-- need a home. SQLite cannot alter a CHECK in place, so this rebuilds the table
-- with the wider set, copies every existing row across unchanged, and renames it
-- back. There are no secondary indexes on this table (only the composite
-- primary key), so nothing else needs recreating.

CREATE TABLE number_sequences_new (
  tenant_id         TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  kind              TEXT NOT NULL CHECK (kind IN ('invoice', 'receipt', 'booking', 'requisition', 'purchase_order')),
  prefix            TEXT NOT NULL DEFAULT '',
  padding           INTEGER NOT NULL DEFAULT 4 CHECK (padding BETWEEN 1 AND 10),
  next_value        INTEGER NOT NULL DEFAULT 1 CHECK (next_value >= 1),
  reset_yearly      INTEGER NOT NULL DEFAULT 1 CHECK (reset_yearly IN (0, 1)),
  last_fiscal_year  INTEGER,
  updated_at        TEXT NOT NULL,
  PRIMARY KEY (tenant_id, kind)
);

INSERT INTO number_sequences_new (
  tenant_id, kind, prefix, padding, next_value, reset_yearly, last_fiscal_year, updated_at
)
SELECT
  tenant_id, kind, prefix, padding, next_value, reset_yearly, last_fiscal_year, updated_at
FROM number_sequences;

DROP TABLE number_sequences;

ALTER TABLE number_sequences_new RENAME TO number_sequences;
