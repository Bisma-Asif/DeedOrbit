export interface LeadStageSeed {
  key: string
  label: string
  tone: "neutral" | "success" | "warning" | "info" | "danger"
}

export const DEFAULT_LEAD_STAGES: readonly LeadStageSeed[] = [
  { key: "new", label: "New", tone: "neutral" },
  { key: "contacted", label: "Contacted", tone: "info" },
  { key: "qualified", label: "Qualified", tone: "success" },
  { key: "site_visit", label: "Site Visit", tone: "info" },
  { key: "negotiation", label: "Negotiation", tone: "warning" },
  { key: "won", label: "Won", tone: "success" },
  { key: "lost", label: "Lost", tone: "danger" },
]

export type LeadStatus = string

export const LEAD_STATUS_LABELS: Record<string, string> = Object.fromEntries(
  DEFAULT_LEAD_STAGES.map((stage) => [stage.key, stage.label]),
)

export const LEAD_SOURCES = [
  "Website",

  "Referral",

  "Walk-in",

  "Broker",

  "Social media",

  "Campaign",

  "Other",
] as const

export const LEAD_NAME_MAX = 120

export const LEAD_PHONE_MAX = 40

export const LEAD_EMAIL_MAX = 254

export const LEAD_SOURCE_MAX = 80

export const LEAD_CAMPAIGN_MAX = 120

export const LEAD_INTEREST_MAX = 160

export const LEAD_LOST_REASON_MAX = 300

export const LEAD_NOTE_MAX = 2000

export const LEAD_STAGE_LABEL_MAX = 40

export const LEAD_STAGE_MAX = 16
