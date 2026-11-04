-- Documents & Signatures: templates, envelopes, and recipients.
--
-- A template is merge text with {{token}} fields; releasing it (draft ->
-- active) takes the `approve` grant, because a template that goes out under
-- the tenant's name is a decision, not a draft.
--
-- An envelope carries one *content* — rendered template text, or one
-- attached row from the existing `documents` table (the storage of record
-- stays there; this module points at it, never duplicates it). The signing
-- token is stored hashed, like a session token: the plaintext exists only
-- inside the recipient's link, once.
--
-- Each recipient holds the envelope's token; their own recipient id selects
-- their place in the chain. `opened` is set by the first view of the link —
-- a fact about a click, kept because an audit that says only "signed"
-- cannot say when they first saw it.

CREATE TABLE IF NOT EXISTS doc_templates (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'other' CHECK (category IN ('sale_agreement', 'addendum', 'noc', 'handover', 'other')),
  body_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  created_by_user_id TEXT NOT NULL,
  created_by_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_doc_template_name
  ON doc_templates (tenant_id, name);

CREATE TABLE IF NOT EXISTS doc_envelopes (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  message TEXT,
  template_id TEXT REFERENCES doc_templates (id) ON DELETE SET NULL,
  document_id TEXT REFERENCES documents (id) ON DELETE SET NULL,
  rendered_body TEXT NOT NULL,
  project_id TEXT REFERENCES projects (id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'completed', 'void', 'expired')),
  token_hash TEXT,
  sent_at TEXT,
  expires_at TEXT,
  completed_at TEXT,
  void_reason TEXT,
  completed_document_id TEXT REFERENCES documents (id) ON DELETE SET NULL,
  created_by_user_id TEXT NOT NULL,
  created_by_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_envelopes_status
  ON doc_envelopes (tenant_id, status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_envelope_token
  ON doc_envelopes (token_hash);

CREATE TABLE IF NOT EXISTS envelope_recipients (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  envelope_id TEXT NOT NULL REFERENCES doc_envelopes (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'signer' CHECK (role IN ('signer', 'cc')),
  sign_order INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'opened', 'signed', 'declined')),
  signed_name TEXT,
  signed_at TEXT,
  signed_ip TEXT,
  decline_reason TEXT,
  opened_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_envelope_recipients
  ON envelope_recipients (envelope_id, sign_order);
