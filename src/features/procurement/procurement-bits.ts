/**
 * Shared display helpers for the procurement screens.
 *
 * The tone maps read the same closed sets the server and the badges use, so a
 * status added to the schema without a tone is a type error rather than an
 * unstyled chip. The three-way match has its own helper: a missing leg is a
 * dash, not a zero — the platform never infers that something arrived or that
 * it was billed, so the display rule and the data rule agree.
 */

import type { BadgeVariant } from "@/components/ui/badge"

import type {
  GrnStatus,
  MovementType,
  PoStatus,
  RequisitionStatus,
} from "@shared/procurement"

export const REQUISITION_STATUS_TONES: Record<RequisitionStatus, BadgeVariant> =
  {
    draft: "neutral",

    submitted: "pending",

    approved: "info",

    rejected: "danger",

    converted: "success",
  }

export const PO_STATUS_TONES: Record<PoStatus, BadgeVariant> = {
  draft: "neutral",

  pending_approval: "pending",

  approved: "info",

  sent: "info",

  partially_received: "pending",

  received: "success",

  closed: "neutral",

  cancelled: "danger",
}

export const GRN_STATUS_TONES: Record<GrnStatus, BadgeVariant> = {
  recorded: "success",

  voided: "danger",
}

export const MOVEMENT_TYPE_TONES: Record<MovementType, BadgeVariant> = {
  receipt: "success",

  issue: "info",

  adjustment: "pending",

  return: "neutral",
}

export function requisitionStatusTone(status: string): BadgeVariant {
  return REQUISITION_STATUS_TONES[(status as RequisitionStatus)] ?? "neutral"
}

export function poStatusTone(status: string): BadgeVariant {
  return PO_STATUS_TONES[(status as PoStatus)] ?? "neutral"
}

export function grnStatusTone(status: string): BadgeVariant {
  return GRN_STATUS_TONES[(status as GrnStatus)] ?? "neutral"
}

export function movementTypeTone(type: string): BadgeVariant {
  return MOVEMENT_TYPE_TONES[(type as MovementType)] ?? "neutral"
}

/**
 * A whole-unit money string, or an em dash when the figure is absent. Used for
 * the match columns so an unrecorded leg never reads as a zero that would
 * falsely close the loop between ordered, received, and invoiced.
 */

export function matchValue(
  amount: number | null,

  currency: string,

  format: (value: number, currency: string) => string,
): string {
  return amount === null ? "—" : format(amount, currency)
}
