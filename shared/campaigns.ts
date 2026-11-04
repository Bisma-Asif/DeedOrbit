/**
 * Campaign vocabulary: an acquisition channel with a public intake door.
 *
 * A campaign names where leads come from — a social ad, a portal listing, a
 * referral drive — and carries one secret: its webhook token. That token is the
 * only gate on the public lead endpoint, so it must be unguessable, unique, and
 * rotatable. Rotation strands the old URL rather than deleting it quietly, which
 * is why an ended campaign is deactivated instead of removed: the metrics history
 * is the reason the campaign existed.
 *
 * Conversion is defined narrowly and honestly. A campaign lead counts as
 * converted when it has become a customer profile, and it counts as a booking
 * when that customer holds at least one confirmed booking on the tenant's books.
 * A cancelled booking is not a conversion — a campaign should not be credited
 * with a sale that was unwound.
 */

export const CAMPAIGN_CHANNELS = [
  "social",

  "portal_listing",

  "search",

  "referral",

  "event",

  "print",

  "other",
] as const

export type CampaignChannel = typeof CAMPAIGN_CHANNELS[number]

export const CAMPAIGN_CHANNEL_LABELS: Record<CampaignChannel, string> = {
  social: "Social media",

  portal_listing: "Property portal listing",

  search: "Search / PPC",

  referral: "Referral drive",

  event: "Event or exhibition",

  print: "Print or outdoor",

  other: "Other",
}

export function isCampaignChannel(value: unknown): value is CampaignChannel {
  return (
    typeof value === "string" &&
    (CAMPAIGN_CHANNELS as readonly string[]).includes(value)
  )
}

export const CAMPAIGN_NAME_MAX = 120

export const CAMPAIGN_SOURCE_MAX = 80

export const CAMPAIGN_NOTES_MAX = 500

/**
 * The token shape: a fixed prefix so a leaked string is recognisable in a log,
 * then 24 characters taken from a cryptographic random source. The matcher is
 * `^`/`$`-anchored and length-capped because the token arrives from a URL, and a
 * route that accepts any string there is a route that accepts anything.
 */

export const CAMPAIGN_TOKEN_PREFIX = "cap"

export const CAMPAIGN_TOKEN_ENTROPY_LENGTH = 24

export const CAMPAIGN_TOKEN_PATTERN = /^cap_[a-z0-9]{24}$/

export function isCampaignToken(value: unknown): value is string {
  return typeof value === "string" && CAMPAIGN_TOKEN_PATTERN.test(value)
}

/** Builds a token from a random 0-9a-z string, so the shape is one function's job. */

export function formatCampaignToken(randomLowerAlphanumeric: string): string {
  return `${CAMPAIGN_TOKEN_PREFIX}_${randomLowerAlphanumeric

    .slice(0, CAMPAIGN_TOKEN_ENTROPY_LENGTH)

    .toLowerCase()}`
}

/** The fields an external landing form posts. `fullName` and `phone` are the
 * minimum a lead record needs; everything else is offered if the form has it. */

export interface CampaignLeadPayload {
  fullName?: unknown

  phone?: unknown

  email?: unknown

  projectInterest?: unknown

  source?: unknown

  consent?: unknown
}

export interface Campaign {
  id: string

  name: string

  /** The `leads.source` value stamped on anything this campaign captures. */

  source: string

  channel: CampaignChannel

  active: boolean

  notes: string | null

  createdByName: string

  createdAt: string

  updatedAt: string
}

/**
 * Conversion figures for one campaign.
 *
 * `leadToBookingRate` is a percentage of leads (0-100), rounded for display, and
 * is zero when there are no leads — an empty campaign reads as "no conversion",
 * never as "NaN%".
 */

export interface CampaignMetrics {
  leads: number

  converted: number

  bookings: number

  activeBookings: number

  leadToBookingRate: number
}

/** A campaign as the list shows it: the record plus its figures and its door. */

export interface CampaignWithMetrics extends Campaign {
  metrics: CampaignMetrics

  webhookPath: string
}

/** The staff-facing campaign view, which carries the token so it can be copied. */

export interface CampaignDetail
  extends CampaignWithMetrics {

  /** True when the caller may rotate the token and archive the campaign. */
  webhookToken: string

  canManage: boolean
}

export interface CampaignsResponse {
  campaigns: CampaignWithMetrics[]

  canCreate: boolean
}

export interface CampaignDetailResponse {
  campaign: CampaignDetail

  /** Sample markup an integrator can paste onto a landing page. */

  integration: CampaignIntegration
}

export interface CampaignIntegration {
  endpoint: string

  method: "POST"

  contentType: "application/json"

  htmlSnippet: string

  curlSnippet: string

  fields: string[]
}
