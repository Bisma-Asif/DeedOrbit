/**
 * Shared display helpers for the construction screens.
 *
 * The tone maps read the same closed sets the server and the badges use, so a
 * status added to the schema without a tone is a type error rather than an
 * unstyled chip. Progress is shown with the mode that produced it, because a
 * manager's site report and a task rollup are two different facts — the label
 * is what keeps them honest side by side.
 */

import type { BadgeVariant } from "@/components/ui/badge"

import type {
  PhaseStatus,
  ProgressMode,
  TaskStatus,
} from "@shared/construction"

export const PHASE_STATUS_TONES: Record<PhaseStatus, BadgeVariant> = {
  pending: "pending",

  active: "info",

  completed: "success",

  on_hold: "neutral",
}

export const TASK_STATUS_TONES: Record<TaskStatus, BadgeVariant> = {
  pending: "pending",

  in_progress: "info",

  completed: "success",

  blocked: "danger",
}

/** Plain-language tag for whichever figure is in play, so a UI never blends the two. */

export const PROGRESS_MODE_LABELS: Record<ProgressMode, string> = {
  derived: "rollup of tasks",

  manual: "site report",

  none: "no progress yet",
}

export function phaseStatusTone(status: string): BadgeVariant {
  return PHASE_STATUS_TONES[(status as PhaseStatus)] ?? "neutral"
}

export function taskStatusTone(status: string): BadgeVariant {
  return TASK_STATUS_TONES[(status as TaskStatus)] ?? "neutral"
}
