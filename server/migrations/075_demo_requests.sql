-- Platform-level intake for "Book a Demo" requests submitted from the public
-- marketing site. Not tenant-scoped: these are pre-signup enquiries a platform
-- administrator reviews. Additive only — it touches no existing table.
CREATE TABLE IF NOT EXISTS demo_requests (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  company TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  projects INTEGER,
  source TEXT NOT NULL DEFAULT 'landing',
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'contacted', 'scheduled', 'converted', 'dismissed')),
  ip TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_demo_requests_created
  ON demo_requests (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_demo_requests_status
  ON demo_requests (status);
