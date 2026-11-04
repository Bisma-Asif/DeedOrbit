/**
 * Typed client for the "Ask DeedOrbit" assistant.
 *
 * Mirrors `server/routes/assistant.ts`. One question is posted and a full
 * answer comes back: a plain-language summary, the permission verdict for the
 * topic it read, and the supporting rows when they are permitted. The endpoint
 * itself is reachable only with `assistant.view`; a missing underlying-module
 * grant is reported inside the reply rather than as an error, so the caller can
 * keep the conversation going.
 */

import type { AssistantReply } from "@shared/assistant"

import { api } from "./api"

export const assistantApi = {
  ask: (question: string) =>
    api.post<AssistantReply>("/api/assistant/ask", { question }),
}
