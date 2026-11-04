/**
 * Documents & Signatures vocabulary — templates, envelopes, and the public
 * signing ceremony.
 *
 * The rule this module holds itself to: a signature is an *event*, recorded
 * with a name, a timestamp, an IP, and a token that only the recipient holds.
 * Nothing here pretends to be a certificate authority or an external
 * provider. When every signer has signed, the completed agreement — its
 * rendered text plus the signer chain — is written back into the existing
 * `documents` table, so the workspace keeps one file trail rather than two
 * half-truths.
 *
 * Envelope status is stored; whether a signing link is still *live* is
 * derived from `expires_at` at read time, like a grace window or an
 * instalment date: no job flips anything, and a link cannot read as open
 * the morning after it lapsed.
 */

// --- Templates -----------------------------------------------------------------

export const TEMPLATE_STATUSES = ["draft", "active", "archived"] as const

export type TemplateStatus = typeof TEMPLATE_STATUSES[number]

export const TEMPLATE_CATEGORIES = [
  "sale_agreement",

  "addendum",

  "noc",

  "handover",

  "other",
] as const

export type TemplateCategory = typeof TEMPLATE_CATEGORIES[number]

export const TEMPLATE_CATEGORY_LABELS: Record<TemplateCategory, string> = {
  sale_agreement: "Sale agreement",

  addendum: "Addendum",

  noc: "No-objection certificate",

  handover: "Handover",

  other: "Other",
}

export interface DocTemplateView {
  id: string

  name: string

  category: string

  categoryLabel: string

  body: string

  /** Merge tokens found in the body, reported rather than resolved. */

  tokens: string[]

  status: string

  createdBy: string

  createdAt: string
}

export interface TemplateListResponse {
  templates: DocTemplateView[]
}

// --- Envelopes --------------------------------------------------------------------

export const ENVELOPE_STATUSES = [
  "draft",

  "sent",

  "completed",

  "void",

  "expired",
] as const

export type EnvelopeStatus = typeof ENVELOPE_STATUSES[number]

export const ENVELOPE_STATUS_LABELS: Record<EnvelopeStatus, string> = {
  draft: "Draft",

  sent: "Awaiting signatures",

  completed: "Completed",

  void: "Void",

  expired: "Link expired",
}

export const RECIPIENT_ROLES = ["signer", "cc"] as const

export type RecipientRole = typeof RECIPIENT_ROLES[number]

export const RECIPIENT_STATUSES = [
  "pending",

  "opened",

  "signed",

  "declined",
] as const

export type RecipientStatus = typeof RECIPIENT_STATUSES[number]

export const RECIPIENT_STATUS_LABELS: Record<RecipientStatus, string> = {
  pending: "Not opened",

  opened: "Opened",

  signed: "Signed",

  declined: "Declined",
}

export interface EnvelopeRecipientView {
  id: string

  name: string

  email: string

  role: string

  signOrder: number

  status: string

  statusLabel: string

  signedName: string | null

  signedAt: string | null
}

export interface EnvelopeView {
  id: string

  title: string

  message: string | null

  templateId: string | null

  templateName: string | null

  documentId: string | null

  documentTitle: string | null

  status: EnvelopeStatus

  statusLabel: string

  /** Derived: a `sent` envelope past `expires_at` reads as `expired`. */

  live: boolean

  sentAt: string | null

  expiresAt: string | null

  completedAt: string | null

  recipients: EnvelopeRecipientView[]

  /** The completed agreement, filed back into the document trail. */

  completedDocumentId: string | null

  createdBy: string

  createdAt: string
}

export interface EnvelopeListResponse {
  envelopes: EnvelopeView[]
}

// --- The public ceremony ---------------------------------------------------------------

/**
 * What a recipient sees when they open their link. Deliberately narrow:
 * the rendered body and their own place in the chain — not other signers'
 * tokens, not the workspace's other records.
 */

export interface SigningCeremonyView {
  envelope: {
    id: string

    title: string

    message: string | null

    /** Merge fields already resolved by the sender before the link went out. */

    body: string

    status: EnvelopeStatus

    signOrder: number
  }

  me: {
    recipientId: string

    name: string

    email: string

    role: string

    status: string

    statusLabel: string
  }

  /** Other signers by name and state, so the waiting order is visible. */

  chain: EnvelopeRecipientView[]

  /** False when the envelope has moved on (completed, void, expired). */

  canSign: boolean

  documentDownloadPath: string | null
}

export interface CeremonyActionResponse {
  ok: true

  me: SigningCeremonyView["me"]

  status: EnvelopeStatus

  /** Set when this action completed the envelope. */

  completedDocumentId: string | null
}

export interface EnvelopeMutationResponse {
  ok: true

  envelope: EnvelopeView
}

/** One recipient's signing link, minted at send time and never shown again. */
export interface EnvelopeSigningLink {
  recipientId: string

  name: string

  path: string
}

/** Returned exactly once, when an envelope is sent: the token never reappears. */

export interface EnvelopeSendResponse {
  ok: true

  envelope: EnvelopeView

  /** Per-recipient signing links. Shown at send time, then never again. */

  links: EnvelopeSigningLink[]
}

// --- Validation bounds ---------------------------------------------------------------------

export const TEMPLATE_NAME_MAX = 120

export const TEMPLATE_BODY_MAX = 20000

export const ENVELOPE_TITLE_MAX = 160

export const ENVELOPE_MESSAGE_MAX = 2000

export const RECIPIENTS_MIN = 1

export const RECIPIENTS_MAX = 8

export const ENVELOPE_TTL_DAYS_MAX = 90

/** Merge tokens in a template body, as the preview reports them. */

export function extractTokens(body: string): string[] {
  const found = new Set<string>()

  for (const match of body.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)) {
    found.add(match[1]!)
  }

  return [...found].sort()
}

export function isTemplateStatus(value: string): value is TemplateStatus {
  return (TEMPLATE_STATUSES as readonly string[]).includes(value)
}

export function isTemplateCategory(value: string): value is TemplateCategory {
  return (TEMPLATE_CATEGORIES as readonly string[]).includes(value)
}

export function isRecipientRole(value: string): value is RecipientRole {
  return (RECIPIENT_ROLES as readonly string[]).includes(value)
}
