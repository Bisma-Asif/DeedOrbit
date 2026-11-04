import { useCallback, useEffect, useRef, useState } from "react"

import { ApiError } from "@/lib/api"

export type SaveState = {
  saving: boolean
  /** True briefly after a successful save, so the button can confirm. */
  saved: boolean
  /** A form-level problem: a network failure, a 409, a permission change. */
  error: string | null
  /** Per-field messages keyed by the field name the server used. */
  fields: Record<string, string>
}

const IDLE: SaveState = { saving: false, saved: false, error: null, fields: {} }

/**
 * Wraps a mutation with the save/confirm/fail states every settings form needs.
 *
 * Server-side field errors are kept separately from the form-level message: a
 * rejected value belongs next to the control that owns it, while a failed
 * request as a whole belongs in a banner. Collapsing the two is how a form ends
 * up saying "check the highlighted fields" with nothing highlighted.
 *
 * `clear` is exposed because a user who starts editing after a rejection should
 * not still be looking at a stale error for a value they have since changed.
 *
 * `run` reports whether the mutation landed. Callers that own a dialog need it:
 * closing on failure throws away what the user typed and hides the message, and
 * staying open on success traps focus behind a modal for a form already sent.
 */
export function useSave() {
  const [state, setState] = useState<SaveState>(IDLE)

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clear = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current)

      timer.current = null
    }

    setState(IDLE)
  }, [])

  const run = useCallback(
    async (mutate: () => Promise<void>): Promise<boolean> => {
      if (timer.current !== null) clearTimeout(timer.current)

      setState({ saving: true, saved: false, error: null, fields: {} })

      try {
        await mutate()

        setState({ saving: false, saved: true, error: null, fields: {} })

        timer.current = setTimeout(() => {
          setState((current) => ({ ...current, saved: false }))

          timer.current = null
        }, 2500)

        return true
      } catch (error) {
        if (error instanceof ApiError) {
          setState({
            saving: false,
            saved: false,
            error: Object.keys(error.fields).length > 0 ? null : error.message,
            fields: error.fields,
          })

          return false
        }

        setState({
          saving: false,
          saved: false,
          error: "Could not reach the server. Check your connection.",
          fields: {},
        })

        return false
      }
    },
    [],
  )

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current)
    },
    [],
  )

  return { ...state, run, clear }
}

/** The message for one field, or undefined when it is valid. */
export function fieldError(
  state: SaveState,

  key: string,
): string | undefined {
  return state.fields[key]
}
