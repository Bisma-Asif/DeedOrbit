-- Manual document verification, and a grant in front of every file's bytes.
--
-- `verification_status` starts at 'unverified', and that default is the whole point: a
-- file that arrived before this feature existed has never been opened and signed for by
-- a person, so it must read as "not verified yet" rather than blank or, worse, green.
-- The value only ever changes when a human with `documents.verify` clicks it, and never
-- by the uploader - the maker-checker split is enforced in the route, not here, because
-- SQLite cannot express "not the same person who wrote that other column".
--
-- `checklist_key` ties a file to the slot it fills on the customer's checklist, so a
-- missing document can be named instead of counted. It is not a CHECK: the slots depend
-- on the customer type and change with the shared list, so the closed set is validated
-- in code against `CUSTOMER_DOCUMENT_CHECKLIST`.

ALTER TABLE documents ADD COLUMN checklist_key TEXT;
ALTER TABLE documents ADD COLUMN issue_date TEXT;
ALTER TABLE documents ADD COLUMN note TEXT;
ALTER TABLE documents ADD COLUMN verification_status TEXT NOT NULL DEFAULT 'unverified';
ALTER TABLE documents ADD COLUMN verified_by_user_id TEXT;
ALTER TABLE documents ADD COLUMN verified_by_name TEXT;
ALTER TABLE documents ADD COLUMN verified_at TEXT;
ALTER TABLE documents ADD COLUMN reject_reason TEXT;
ALTER TABLE documents ADD COLUMN updated_by_user_id TEXT;

CREATE INDEX IF NOT EXISTS idx_documents_verification
  ON documents (tenant_id, verification_status);

-- ---------------------------------------------------------------------------
-- Short-lived grants on file bytes
-- ---------------------------------------------------------------------------
--
-- The spec asks for private storage served through a short-lived signed URL. The blob
-- stays where this platform has always kept it - in the database, like
-- `expense_attachments`, so a backup is one file and an intranet host needs no object
-- store - and the privacy is delivered by the door instead of the shelf: a blob is never
-- listed, never addressable by a guessable path, and released only by
-- `/api/file-access/:token` after that token is looked up here.
--
-- `token_hash`, not the token: the URL is the credential, so it is stored the way every
-- other credential in this schema is. `expires_at` is 120 seconds after issue. A grant
-- is single-purpose - `view` allows a few reads because an officer opens a file more than
-- once, `download` allows one - and redeeming it re-checks the *issuing* user's current
-- grants, so revoking the officer revokes every link they ever handed out. An advisory
-- expiry that also carries a use count means an old link in a chat log is not a door.
CREATE TABLE IF NOT EXISTS file_access_grants (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,
  tenant_id TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  -- Which table the bytes live in. A payment proof is a column on `payments`, not a
  -- `documents` row, so the two blob stores share one front door.
  target_kind TEXT NOT NULL CHECK (target_kind IN ('document', 'payment_proof')),
  target_id TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('view', 'download')),
  issued_by_user_id TEXT NOT NULL,
  issued_by_name TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  redeemed_at TEXT,
  redeemed_count INTEGER NOT NULL DEFAULT 0,
  max_uses INTEGER NOT NULL DEFAULT 1 CHECK (max_uses BETWEEN 1 AND 5),
  audit_note TEXT,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_file_access_grants_token
  ON file_access_grants (token_hash);

CREATE INDEX IF NOT EXISTS idx_file_access_grants_target
  ON file_access_grants (tenant_id, target_kind, target_id);
