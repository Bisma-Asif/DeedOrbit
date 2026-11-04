/**
 * OCR extraction adapters — pluggable, manual-only by default.
 *
 * The platform must never invent an identity field. If there is no real OCR
 * engine wired up, extraction returns *nothing*, and the reviewer types the
 * fields themselves; the UI is never handed a pre-filled name or CNIC it might
 * mistake for a machine reading. That is the whole honesty argument for the
 * `ocr_status` column: it is only ever `suggested` when a provider genuinely
 * returned values, and `none` otherwise.
 *
 * A real engine (cloud vision, an on-device model) is added by writing an
 * `OcrProvider` and pointing `OCR_PROVIDER` at it; nothing else changes. The
 * `manual` provider is the default and returns null on every call.
 */

/** The identity fields the review screen can pre-fill from a genuine read. */

export interface OcrFields {
  /** A normalised 13-digit CNIC, digits only, if the engine read one. */

  cnic?: string

  fullName?: string

  /** Father / husband name, as printed on the card. */

  guardianName?: string

  /** `YYYY-MM-DD`, if a date of birth was read. */

  dob?: string

  /** `YYYY-MM-DD`, if an expiry / validity date was read. */

  expiry?: string
}

/** What a provider returns for one successful read. */

export interface OcrResult {
  fields: OcrFields

  /** 0..1 the engine's own confidence; shown to the reviewer, never trusted blindly. */

  confidence: number
}

export interface OcrProvider {
  /** Stable id, matching the `OCR_PROVIDER` env value and any settings UI. */

  id: string

  /**
   * Reads the document bytes. Returns a result only when it genuinely extracted
   * something, and null when it did not or is unavailable — never a guess.
   */

  extract(buffer: Buffer, mime: string): Promise<OcrResult | null>
}

/**
 * The default provider: reads nothing. Choosing `manual` is the system's way of
 * saying "no machine has looked at this", so every field stays a human's.
 */

export const manualOcrProvider: OcrProvider = {
  id: "manual",

  async extract(): Promise<OcrResult | null> {
    return null
  },
}

const REGISTRY: Record<string, OcrProvider> = {
  manual: manualOcrProvider,
}

/** Registers a real engine so `OCR_PROVIDER=<id>` can select it. */

export function registerOcrProvider(provider: OcrProvider): void {
  REGISTRY[provider.id] = provider
}

/**
 * Resolves the active provider from `OCR_PROVIDER`, defaulting to manual.
 *
 * An unknown id falls back to manual rather than throwing: a typo in an env var
 * must not silently start returning fabricated fields, and it must not take the
 * whole document flow down. Manual is the safe, honest answer.
 */

export function resolveOcrProvider(): OcrProvider {
  const id = (process.env.OCR_PROVIDER ?? "manual").trim().toLowerCase()

  return REGISTRY[id] ?? manualOcrProvider
}
