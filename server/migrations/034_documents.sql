-- Documents: a base64 file store attached to any of four entity kinds.
--
-- One table serves projects, units, customers, and bookings so the upload,
-- preview, and access machinery is written once. `entity_type` + `entity_id` is
-- polymorphic, so there is no foreign key on `entity_id` — an orphan row (its
-- parent deleted) is filtered at read time by checking the parent still exists,
-- rather than trusted to an FK the schema cannot express across four tables.
--
-- The file itself is a base64 data URL in `data`, exactly like `expense_
-- attachments`: mime and size are validated server-side on upload and the raw
-- bytes are streamed back for a preview. `doc_type` drives the fixed per-type
-- access map (who may view/download each kind), and `expires_at` is optional so
-- an ID copy can carry a renewal date while a signed agreement need not.

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('project', 'unit', 'customer', 'booking')),
  entity_id TEXT NOT NULL,
  doc_type TEXT NOT NULL CHECK (doc_type IN ('agreement', 'booking_form', 'id_copy', 'receipt', 'invoice', 'other')),
  title TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes BETWEEN 0 AND 10485760),
  data TEXT NOT NULL,
  expires_at TEXT,
  uploaded_by_user_id TEXT NOT NULL,
  uploaded_by_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_documents_entity
  ON documents (tenant_id, entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_documents_type
  ON documents (tenant_id, doc_type);
