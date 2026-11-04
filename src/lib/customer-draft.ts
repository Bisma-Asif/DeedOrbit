import { useCallback, useEffect, useState } from "react"

import {
  CUSTOMER_FIELD_KEYS,
  type CustomerEntryInput,
  emptyCustomerInput,
} from "@shared/customer-entry"

/**
 * A customer form that was never saved, kept in this browser only.
 *
 * The officer typing a new file works from a paper form in front of them, and a browser
 * that closes takes the afternoon's typing with it. Nothing here is a record of the
 * customer: it is a convenience kept on one machine, so it is stored per tenant and per
 * record, is offered back with the time it was written, and disappears the moment the save
 * lands — a stale copy that kept offering itself is how a desk starts trusting a screen
 * instead of the file.
 *
 * It never leaves this tab's storage and never reaches the API, so a draft cannot be
 * mistaken for a saved value by anyone else in the workspace.
 */

const PREFIX = "deedorbit.customer-draft"

/** Long enough that a burst of typing is one write, short enough that a crash loses little. */

const DRAFT_DEBOUNCE_MS = 800

/**
 * How long a draft is worth offering back.
 *
 * `localStorage` has no expiry of its own, so an abandoned form would otherwise sit there
 * for months and then reappear beside a record the office has since corrected on paper.
 * Three days is a weekend plus the Monday someone comes back in.
 */

const DRAFT_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000

export interface CustomerDraft {
  values: CustomerEntryInput

  /** When it was written, as an ISO timestamp — the banner shows this, not a guess. */

  savedAt: string
}

/** `"new"` for a record that has no id yet, so the two kinds never share a slot. */

export function customerDraftKey(tenantId: string, recordId: string): string {
  return `${PREFIX}.${tenantId}.${recordId === "" ? "new" : recordId}`
}

/**
 * A stored object read back as a full form record.
 *
 * Unknown keys are dropped and a missing one keeps its empty value rather than becoming
 * `undefined`: a draft saved before a field existed is still worth restoring, and a form
 * whose props are partly undefined renders as a crash.
 */

function sanitizeValues(raw: unknown): CustomerEntryInput {
  const values = emptyCustomerInput()

  if (raw === null || typeof raw !== "object") return values

  const source = raw as Record<string, unknown>

  for (const key of CUSTOMER_FIELD_KEYS) {
    const value = source[key]

    if (typeof value === "string") values[key] = value
  }

  return values
}

export function readCustomerDraft(key: string): CustomerDraft | null {
  let raw: string | null = null

  try {
    raw = window.localStorage.getItem(key)
  } catch {
    // Storage can be unavailable (private mode, a locked-down browser). The form still

    // works; it simply cannot promise to keep a draft.

    return null
  }

  if (!raw) return null

  let parsed: unknown

  try {
    parsed = JSON.parse(raw)
  } catch {
    clearCustomerDraft(key)

    return null
  }

  const record = parsed as {
    values?: unknown
    savedAt?: unknown
  }

  if (typeof record.savedAt !== "string") return null

  const savedAt = Date.parse(record.savedAt)

  if (Number.isNaN(savedAt)) return null

  if (Date.now() - savedAt > DRAFT_MAX_AGE_MS) {
    clearCustomerDraft(key)

    return null
  }

  const values = sanitizeValues(record.values)

  if (!draftHasContent(values)) return null

  return { values, savedAt: record.savedAt }
}

export function writeCustomerDraft(
  key: string,

  values: CustomerEntryInput,
): void {
  try {
    window.localStorage.setItem(
      key,

      JSON.stringify({ values, savedAt: new Date().toISOString() }),
    )
  } catch {
    // A full or blocked storage is not a reason to lose what is on screen.
  }
}

export function clearCustomerDraft(key: string): void {
  try {
    window.localStorage.removeItem(key)
  } catch {
    // Nothing to do: the draft was never going to be kept anyway.
  }
}

/** Whether anybody has typed anything yet, compared against the pristine form. */

export function draftHasContent(values: CustomerEntryInput): boolean {
  const pristine = emptyCustomerInput()

  return CUSTOMER_FIELD_KEYS.some((key) => values[key] !== pristine[key])
}

/** Whether two form records say different things. */

export function draftDiffers(
  a: CustomerEntryInput,

  b: CustomerEntryInput,
): boolean {
  return CUSTOMER_FIELD_KEYS.some((key) => a[key] !== b[key])
}

/**
 * The time a restore banner names: `14:32` for today, `01 Nov 2026 14:32` for any other
 * day. The officer needs to know whether this is the form they left or last week's.
 */

export function customerDraftStamp(savedAt: string): string {
  const date = new Date(savedAt)

  if (Number.isNaN(date.valueOf())) return "an earlier time"

  const clock = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",

    minute: "2-digit",
  }).format(date)

  const now = new Date()

  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()

  if (sameDay) return clock

  return `${new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",

    month: "short",

    year: "numeric",
  }).format(date)} ${clock}`
}

export interface CustomerDraftOptions {
  /** Null while the session is still resolving, which means no draft slot to use. */

  tenantId: string | null

  /** The record's id, or `""` for a customer that has not been saved yet. */

  recordId: string

  /** What is on screen now. Null until the form has loaded its record. */

  values: CustomerEntryInput | null

  /** What the form was opened with: the pristine record for an edit, blanks for a new one. */

  baseline: CustomerEntryInput | null

  /** Hands the stored values to whoever holds the form state. */

  onRestore: (values: CustomerEntryInput) => void
}

export interface CustomerDraftControls {
  /** A stored draft worth offering, or null. */

  draft: CustomerDraft | null

  /** The form holds something the server does not. */

  dirty: boolean

  restore: () => void

  /** Throw the stored draft away without applying it. */

  discard: () => void

  /** Call once a save lands: the server has the values now, so this copy must not linger. */

  saved: () => void
}

/**
 * Autosave, restore and cleanup for one customer form.
 *
 * The banner itself belongs to the page, because what it says next to "Discard" differs
 * between a dialog that closes and a profile that goes back to read-only. This owns only
 * the storage: it reads once per record, writes on a pause in the typing, and clears on
 * both a save and a discard.
 */

export function useCustomerDraft(
  options: CustomerDraftOptions,
): CustomerDraftControls {
  const { tenantId, recordId, values, baseline, onRestore } = options

  const key = tenantId ? customerDraftKey(tenantId, recordId) : null

  const [draft, setDraft] = useState<CustomerDraft | null>(null)

  const dirty =
    values !== null && baseline !== null && draftDiffers(values, baseline)

  // Read once per record. Re-reading on every keystroke would offer the draft back after

  // the officer has already discarded it, because the write and the read would race.

  useEffect(() => {
    if (!key) {
      setDraft(null)

      return
    }

    const stored = readCustomerDraft(key)

    // A draft equal to what the form already holds is not information, and a banner about

    // it would be noise over the top of the record.

    const worthOffering =
      stored !== null &&
      (baseline === null || draftDiffers(stored.values, baseline))

    setDraft(worthOffering ? stored : null)
  }, [key, baseline])

  useEffect(() => {
    if (!key || !dirty || values === null) return

    const handle = setTimeout(() => {
      writeCustomerDraft(key, values)
    }, DRAFT_DEBOUNCE_MS)

    return () => clearTimeout(handle)
  }, [key, dirty, values])

  const discard = useCallback(() => {
    if (key) clearCustomerDraft(key)

    setDraft(null)
  }, [key])

  const restore = useCallback(() => {
    if (draft) {
      onRestore(draft.values)

      // The values are in the form now, which holds them under the same key. Leaving the

      // copy behind would mean two versions of the same afternoon.

      if (key) clearCustomerDraft(key)

      setDraft(null)
    }
  }, [draft, key, onRestore])

  const saved = useCallback(() => {
    if (key) clearCustomerDraft(key)

    setDraft(null)
  }, [key])

  return { draft, dirty, restore, discard, saved }
}
