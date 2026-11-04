/**
 * Shared display helpers for the signatures screens.
 *
 * The tone maps read the same closed sets the server and the badges use, so a
 * status added to the schema without a tone is a type error rather than an
 * unstyled chip. Envelope status is the *effective* one the server derives —
 * a lapsed link reads as expired, not open.
 */

import type { BadgeVariant } from "@/components/ui/badge"

import type {
  EnvelopeStatus,
  RecipientStatus,
  TemplateStatus,
} from "@shared/signatures"

export const TEMPLATE_STATUS_TONES: Record<TemplateStatus, BadgeVariant> = {
  draft: "pending",

  active: "success",

  archived: "neutral",
}

export const ENVELOPE_STATUS_TONES: Record<EnvelopeStatus, BadgeVariant> = {
  draft: "neutral",

  sent: "pending",

  completed: "success",

  void: "danger",

  expired: "neutral",
}

export const RECIPIENT_STATUS_TONES: Record<RecipientStatus, BadgeVariant> = {
  pending: "neutral",

  opened: "pending",

  signed: "success",

  declined: "danger",
}

export function templateStatusTone(status: string): BadgeVariant {
  return TEMPLATE_STATUS_TONES[(status as TemplateStatus)] ?? "neutral"
}

export function envelopeStatusTone(status: string): BadgeVariant {
  return ENVELOPE_STATUS_TONES[(status as EnvelopeStatus)] ?? "neutral"
}

export function recipientStatusTone(status: string): BadgeVariant {
  return RECIPIENT_STATUS_TONES[(status as RecipientStatus)] ?? "neutral"
}
