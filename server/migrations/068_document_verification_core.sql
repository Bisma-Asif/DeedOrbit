-- Customer Document Verification: the columns that turn a filed document into a
-- verified record.
--
-- This extends the `documents` table already widened by 056 (which added
-- `verification_status`, `verified_by_*`, `reject_reason`, `checklist_key`,
-- `issue_date`, `note`). Nothing here renames or re-types an existing column, so
-- the current Documents module keeps reading and writing the rows exactly as it
-- did. Every new column is nullable with a benign default, which in SQLite is a
-- metadata-only change safe to run against a populated table.
--
-- The catalogue slot reuses 056's `checklist_key`; the expiry reuses 034's
-- `expires_at`. There is deliberately no duplicate `type_key`/`expiry_date`,
-- because a second column for the same fact is a second place to be wrong.
--
-- `verification_status` carries a *new value* (`under_review`), not a new column:
-- it has no CHECK constraint, so the closed state set is validated in code
-- against `shared/document-verification.ts`, and an old row left at the 056
-- default `unverified` still reads correctly.
--
-- The sensitive extracted fields (CNIC number, name, guardian name) are stored
-- AES-GCM encrypted in `*_enc` columns — the key never lives in this table, so a
-- leaked database file is not a leaked identity. `cnic_hash` is a keyed digest:
-- enough to detect a duplicate CNIC across customers, not enough to recover it.
-- `file_sha256` is the same idea for the bytes: a duplicate-document fingerprint.
--
-- The provider columns only ever carry a value when a licensed identity provider
-- returned a real response. In manual mode they stay NULL, which is what keeps
-- "Manually Verified" and "Government Verified" visibly different facts.

ALTER TABLE documents ADD COLUMN extracted_cnic_enc TEXT;
ALTER TABLE documents ADD COLUMN extracted_name_enc TEXT;
ALTER TABLE documents ADD COLUMN extracted_guardian_enc TEXT;
ALTER TABLE documents ADD COLUMN extracted_dob TEXT;
ALTER TABLE documents ADD COLUMN extracted_expiry TEXT;
ALTER TABLE documents ADD COLUMN cnic_hash TEXT;
ALTER TABLE documents ADD COLUMN file_sha256 TEXT;
ALTER TABLE documents ADD COLUMN ocr_status TEXT NOT NULL DEFAULT 'none';
ALTER TABLE documents ADD COLUMN reupload_requested INTEGER NOT NULL DEFAULT 0;
ALTER TABLE documents ADD COLUMN reupload_reason TEXT;
ALTER TABLE documents ADD COLUMN retention_until TEXT;
ALTER TABLE documents ADD COLUMN source TEXT NOT NULL DEFAULT 'staff';
ALTER TABLE documents ADD COLUMN verified_via TEXT;
ALTER TABLE documents ADD COLUMN provider_name TEXT;
ALTER TABLE documents ADD COLUMN provider_ref TEXT;
ALTER TABLE documents ADD COLUMN provider_response_enc TEXT;
ALTER TABLE documents ADD COLUMN provider_verified_at TEXT;

-- The queue reads pending items per tenant; the checklist reads a customer's files
-- by catalogue slot; the duplicate detectors scan by fingerprint. These four
-- indexes are exactly those access paths, all scoped by tenant_id first.
CREATE INDEX IF NOT EXISTS idx_documents_checklist
  ON documents (tenant_id, entity_type, entity_id, checklist_key);

CREATE INDEX IF NOT EXISTS idx_documents_cnic_hash
  ON documents (tenant_id, cnic_hash);

CREATE INDEX IF NOT EXISTS idx_documents_file_hash
  ON documents (tenant_id, file_sha256);

CREATE INDEX IF NOT EXISTS idx_documents_expiry
  ON documents (tenant_id, expires_at);
