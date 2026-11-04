-- Support tickets: a customer's service request, worked by staff.
--
-- A ticket is raised by a customer through the portal (`raised_by = 'customer'`)
-- or on their behalf by staff. Its status walks `open -> in_progress -> resolved
-- -> closed`; `resolved_at` is stamped only when a decision moves it to resolved,
-- so the queue can show real resolution latency.
--
-- `sla_due_by` is a stored timestamp computed once at creation from the priority
-- (see `TICKET_SLA_HOURS` in shared/tickets.ts). It is written, not derived at
-- read, so an overdue ticket stays honestly overdue against the clock it was
-- promised on rather than drifting if the SLA table is later re-tuned.
--
-- Comments carry an `author_kind` because a thread mixes the customer's replies
-- and staff's notes; attachments mirror the expense/document base64 pattern.

CREATE TABLE IF NOT EXISTS support_tickets (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  booking_id TEXT REFERENCES bookings (id) ON DELETE SET NULL,
  subject TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  assignee_user_id TEXT REFERENCES users (id) ON DELETE SET NULL,
  sla_due_by TEXT NOT NULL,
  raised_by TEXT NOT NULL CHECK (raised_by IN ('customer', 'staff')),
  created_by_user_id TEXT,
  created_by_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_tickets_queue
  ON support_tickets (tenant_id, status, sla_due_by);

CREATE INDEX IF NOT EXISTS idx_tickets_customer
  ON support_tickets (tenant_id, customer_id);

CREATE TABLE IF NOT EXISTS ticket_comments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  ticket_id TEXT NOT NULL REFERENCES support_tickets (id) ON DELETE CASCADE,
  author_kind TEXT NOT NULL CHECK (author_kind IN ('customer', 'staff')),
  author_user_id TEXT REFERENCES users (id) ON DELETE SET NULL,
  author_name TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ticket_comments
  ON ticket_comments (tenant_id, ticket_id, created_at);

CREATE TABLE IF NOT EXISTS ticket_attachments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  ticket_id TEXT NOT NULL REFERENCES support_tickets (id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes BETWEEN 0 AND 10485760),
  data TEXT NOT NULL,
  uploaded_by_user_id TEXT NOT NULL,
  uploaded_by_name TEXT NOT NULL,
  uploaded_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ticket_attachments
  ON ticket_attachments (tenant_id, ticket_id);
