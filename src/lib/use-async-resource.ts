import { useCallback, useEffect, useRef, useState } from "react"

import { ApiError } from "@/lib/api"

export type AsyncState<T,> = {
  data: T | null
  loading: boolean
  error: string | null
}

const INITIAL: AsyncState<never> = { data: null, loading: true, error: null }

const IDLE: AsyncState<never> = { data: null, loading: false, error: null }

/**
 * Loads a resource on mount and exposes a `reload` for after a mutation.
 *
 * The request is abandoned on unmount and whenever a newer load starts, so a
 * slow response can never overwrite fresher state - the usual stale-response
 * race on a table that re-fetches after every change.
 *
 * `enabled` exists because hooks cannot be called conditionally. A member
 * without the view grant must still call these hooks, but firing the request
 * anyway would guarantee a 403 in the console on every visit to the tab.
 */
export function useAsyncResource<T>(
  load: (signal: AbortSignal) => Promise<T>,
  enabled = true,
) {
  const [state, setState] = useState<AsyncState<T>>(enabled ? INITIAL : IDLE)

  const requestRef = useRef(0)

  const loadRef = useRef(load)

  loadRef.current = load

  const run = useCallback(async () => {
    if (!enabled) {
      setState(IDLE as AsyncState<T>)

      return
    }

    const controller = new AbortController()

    const ticket = ++requestRef.current

    setState((current) => ({ ...current, loading: true, error: null }))

    try {
      const data = await loadRef.current(controller.signal)

      if (ticket !== requestRef.current) return

      setState({ data, loading: false, error: null })
    } catch (error) {
      if (controller.signal.aborted || ticket !== requestRef.current) return

      setState({
        data: null,
        loading: false,
        error:
          error instanceof ApiError
            ? error.message
            : "Could not load this data.",
      })
    }
  }, [enabled])

  useEffect(() => {
    void run()

    return () => {
      // Bump the ticket so an in-flight response is ignored on unmount.
      requestRef.current++
    }
  }, [run])

  return { ...state, reload: run }
}
