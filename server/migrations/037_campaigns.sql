-- Campaigns: a lead source with a public, token-keyed landing webhook.
--
-- A campaign names an external acquisition channel (a Facebook ad, a property
-- portal listing, a referral code). Its `webhook_token` is the secret that
-- external landing pages POST against: `POST /api/public/campaigns/:token/leads`
-- creates a lead with no session, so the token is the only gate and must be
-- unguessable and unique. Rotating the token issues a new one and strands the
-- old — an expired campaign is deactivated (`active = 0`) rather than deleted, so
-- the metrics history survives.
--
-- `leads` already carries `source` and `campaign` text; a real `campaign_id` link
-- is what makes the leads -> bookings conversion metrics honest, so leads created
-- through the webhook also record the campaign row they came from. The column is
-- nullable and unlinked leads simply do not count toward any campaign.

CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT '',
  channel TEXT NOT NULL DEFAULT 'other',
  webhook_token TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  notes TEXT,
  created_by_user_id TEXT,
  created_by_name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_campaigns_token
  ON campaigns (webhook_token);

CREATE INDEX IF NOT EXISTS idx_campaigns_tenant
  ON campaigns (tenant_id, active);

ALTER TABLE leads ADD COLUMN campaign_id TEXT;

CREATE INDEX IF NOT EXISTS idx_leads_campaign
  ON leads (tenant_id, campaign_id);
