-- Admin-configurable document-type catalogue and per-customer-type requirements.
--
-- Both tables hold *overrides only*. The platform's default catalogue (CNIC front
-- and back, passport, photograph, proof of income, utility bill, nominee CNIC,
-- booking form, affidavit, power of attorney, allotment letter, sale agreement,
-- registry / transfer papers, bank cheque copy) lives as data in
-- `shared/document-verification.ts`, and the read merges the tenant's override
-- rows on top of it. A brand-new workspace therefore needs no seeding step and no
-- signup hook: an empty override table simply means "the tenant never changed the
-- defaults", which is the truthful state rather than a fabricated copy.
--
-- `base_doc_type` is the six-value category the existing `documents.doc_type`
-- CHECK already understands (agreement, booking_form, id_copy, receipt, invoice,
-- other). Keeping the granular identity in `key` and the coarse access bucket in
-- `base_doc_type` is what lets a new document type reuse the fixed per-type access
-- map without weakening it — an ID copy still gates on the ID-copy permission.

CREATE TABLE IF NOT EXISTS document_type_catalog (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  -- Matches a default catalogue key, or a new tenant-defined key.
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  base_doc_type TEXT NOT NULL CHECK (
    base_doc_type IN ('agreement', 'booking_form', 'id_copy', 'receipt', 'invoice', 'other')
  ),
  -- Sensitive types get masking, encryption of extracted fields, and a stricter
  -- reveal gate. OCR applies to the identity documents. track_expiry means the
  -- 60/30/7 alert ladder is relevant to this slot.
  sensitive INTEGER NOT NULL DEFAULT 0,
  ocr INTEGER NOT NULL DEFAULT 0,
  track_expiry INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, key)
);

CREATE INDEX IF NOT EXISTS idx_document_type_catalog_tenant
  ON document_type_catalog (tenant_id, sort_order);

-- Required / optional per customer type. A row is written only when the tenant
-- diverges from the default required-ness, so "is a passport required for an
-- overseas Pakistani?" resolves to: this table first, the shared default second.
CREATE TABLE IF NOT EXISTS document_type_requirements (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  type_key TEXT NOT NULL,
  customer_type TEXT NOT NULL CHECK (
    customer_type IN ('individual', 'company', 'overseas_pakistani')
  ),
  required INTEGER NOT NULL DEFAULT 1,
  -- How many of this type the file must hold at minimum (0 = not required here).
  min_count INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  updated_by TEXT,
  UNIQUE (tenant_id, type_key, customer_type)
);

CREATE INDEX IF NOT EXISTS idx_document_type_requirements_tenant
  ON document_type_requirements (tenant_id, customer_type);
