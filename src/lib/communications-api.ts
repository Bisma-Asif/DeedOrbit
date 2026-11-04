/**
 * Typed client for the communications settings surface.
 *
 * Mirrors `server/routes/communications.ts`, all under `/api/settings/*` and all
 * gated on `settings.view` / `settings.edit`. Nothing here sends a message: the
 * panel edits template bodies, previews a render against a sample context, and
 * reads a dry-run of the reminders the placeholder job *would* produce.
 */

import type {
  CommunicationsView,
  MessageChannel,
  MessageLanguage,
  MessageTemplate,
  PlaceholderToken,
  RenderContext,
  RenderedReminder,
  TemplateKey,
} from "@shared/communications"

import { api } from "./api"

/** The editable catalogue plus the label maps the panel renders around it. */

export interface CommunicationsViewResponse extends CommunicationsView {
  channelLabels: Record<MessageChannel, string>

  keyLabels: Record<TemplateKey, string>

  keyHints: Record<TemplateKey, string>

  tokenLabels: Record<PlaceholderToken, string>

  bodyMax: number
}

export interface TemplateSaveInput {
  channel: MessageChannel

  key: TemplateKey

  /** Absent means English, the one language every workspace already had. */
  language?: MessageLanguage

  /** Blank means "use the shipped default subject". */
  subject?: string

  body: string

  enabled: boolean
}

export interface TemplateSaveResponse {
  ok: true

  template: MessageTemplate
}

export interface TemplatePreviewInput {
  channel: MessageChannel

  key: TemplateKey

  language?: MessageLanguage

  context: RenderContext
}

export interface TemplatePreviewResponse {
  channel: MessageChannel

  key: TemplateKey

  language: MessageLanguage

  subject: string

  text: string

  missingTokens: string[]
}

export interface UpcomingRemindersResponse {
  days: number

  channel: MessageChannel

  count: number

  /** Always false — the reminder job sends nothing. */

  sent: false

  reminders: RenderedReminder[]
}

export const communicationsApi = {
  read: (signal?: AbortSignal) =>
    api.get<CommunicationsViewResponse>("/api/settings/communications", signal),

  saveTemplate: (input: TemplateSaveInput) =>
    api.put<TemplateSaveResponse>(
      "/api/settings/communications/template",
      input,
    ),

  preview: (input: TemplatePreviewInput) =>
    api.post<TemplatePreviewResponse>(
      "/api/settings/communications/preview",

      input,
    ),

  upcomingReminders: (
    days?: number,
    channel?: MessageChannel,
    signal?: AbortSignal,
  ) => {
    const params = new URLSearchParams()

    if (days !== undefined) params.set("days", String(days))

    if (channel) params.set("channel", channel)

    const qs = params.toString()

    return api.get<UpcomingRemindersResponse>(
      `/api/settings/communications/upcoming-reminders${qs ? `?${qs}` : ""}`,

      signal,
    )
  },
}
