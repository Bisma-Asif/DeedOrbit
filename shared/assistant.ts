/**
 * "Ask DeedOrbit" assistant vocabulary, shared by the server and the client.
 *
 * The assistant answers a natural-language question about the caller's *own*
 * tenant data with a plain-language summary plus the rows behind it. There is no
 * model in the loop: a question is matched to one of the intents below by a
 * deterministic reader on the server, and the answer is derived live from the
 * same ledger reads the modules themselves use. Nothing is fabricated — where
 * there is no data the summary says so.
 *
 * Two gates protect a read, and both are named here so the panel and the
 * endpoint cannot drift: the caller must hold `assistant.view` to reach the
 * endpoint at all, and must *separately* hold the intent's `requiresModule.view`
 * to see the rows. An intent that reads payments is therefore invisible to a
 * role that cannot open Payments, even though it can open the assistant.
 */

import type { PermissionModule } from "./access.ts"

/** Longest question the endpoint accepts; a chat line, not an essay. */

export const MAX_QUESTION_LENGTH = 300

/** Most rows returned in one answer, so a summary stays readable and bounded. */

export const MAX_ANSWER_ROWS = 12

/** One thing the assistant knows how to answer, and what it needs to answer it. */

export interface AssistantIntent {
  id: string

  label: string

  /** The question this intent answers, in the assistant's own words. */

  description: string

  /** The underlying data module whose `view` grant gates the rows. */

  requiresModule: PermissionModule

  /** Prompts offered in the empty state and used to steer the matcher. */

  examples: string[]
}

/**
 * The launch catalogue: overdue payments / collections. Each intent reads the
 * payment schedule and so is gated on `payments.view`. The registry is deliberately
 * a list, so a later module adds an entry here and a matching server branch without
 * touching the contract.
 */

export const ASSISTANT_INTENTS: AssistantIntent[] = [
  {
    id: "overdue_lines",

    label: "Overdue units",

    description:
      "Which units or instalments are overdue, optionally past a day threshold.",

    requiresModule: "payments",

    examples: [
      "Which units are overdue over 60 days?",

      "List instalments overdue by more than 30 days.",

      "What is past due on confirmed bookings?",
    ],
  },

  {
    id: "overdue_summary",

    label: "Overdue totals",

    description:
      "How much is overdue overall and how it splits across the aging bands.",

    requiresModule: "payments",

    examples: [
      "How much is overdue in total?",

      "Give me a breakdown of overdue by aging bucket.",

      "What is the overall collections position?",
    ],
  },

  {
    id: "oldest_overdue",

    label: "Oldest overdue",

    description: "The longest-overdue instalments, deepest delinquency first.",

    requiresModule: "payments",

    examples: [
      "What are the oldest overdue payments?",

      "Which account is the most overdue?",

      "Show me the deepest delinquency.",
    ],
  },
]

/** A column of the supporting-rows table. `numeric` right-aligns money figures. */

export interface AssistantColumn {
  key: string

  label: string

  numeric?: boolean
}

/** The shape of the ask request body. */

export interface AssistantRequest {
  question: string
}

/** One supporting row: a flat map of column key to a displayable cell. */

export interface AssistantRow {
  [key: string]: string | number | null
}

/**
 * The whole answer. The panel renders `answer` as the assistant's message and,
 * when `permitted` and rows are present, a compact table under it. `examples`
 * is offered when nothing matched so the user can rephrase.
 */

export interface AssistantReply {
  /** The matched intent id, or null when the question was not understood. */

  intentId: string | null

  intentLabel: string | null

  /** The data module the answer would read; null when no intent matched. */

  requiresModule: PermissionModule | null

  /**
   * True when the caller may see the rows. False means the question matched an
   * intent whose underlying module the role cannot open; `answer` then explains
   * the refusal and `rows` is empty. The endpoint itself is unreachable without
   * `assistant.view`, which returns 403 rather than a reply.
   */

  permitted: boolean

  answer: string

  columns: AssistantColumn[]

  rows: AssistantRow[]

  /** Matching rows before the display cap, so the summary can say "of N". */

  matchedCount: number

  /** Whether `rows` was truncated to `MAX_ANSWER_ROWS`. */

  truncated: boolean

  currency: string

  /** The tenant's own day the aging was measured against, `YYYY-MM-DD`. */

  asOf: string

  /** Sample prompts to offer when nothing matched. */

  examples: string[]
}
