/**
 * Dashboard data plumbing shared by every widget.
 *
 * `useDashboard` owns the filter state and pulls the whole command center in a
 * single aggregated call. It deliberately does not use `useAsyncResource`: that
 * hook re-runs only when its `enabled` flag flips, and here a filter change
 * (range, custom window, project) must refetch every widget on the page. The
 * ticket counter is the same stale-response guard the shared hook uses, so a
 * slow answer from an older window can never overwrite a fresher one.
 *
 * A per-widget `retry` re-answers one failed card through the server's cached
 * pipeline and merges it over the snapshot, so a broken widget never takes the
 * page, or its healthy neighbours, down.
 */

import { useCallback, useEffect, useRef, useState } from "react"

import type {
  DashboardKpiKey,
  DashboardOverview,
  DashboardRange,
  WidgetEnvelope,
} from "@shared/dashboard"

import { ApiError } from "@/lib/api"

import { dashboardApi, type DashboardFilters } from "@/lib/dashboard-api"

export type DashboardWidgetName = keyof DashboardOverview["widgets"]

export interface DashboardWidgetState {
  /** The merged single-widget answer when present, else the snapshot's. */

  envelope: WidgetEnvelope<unknown> | undefined

  loading: boolean

  retry: () => void
}

/** One card's retry state; `envelope` stays empty while the call is in flight. */

type WidgetAttempt = {
  loading: boolean

  envelope?: WidgetEnvelope<unknown>
}

function messageFor(error: unknown): string {
  return error instanceof ApiError ? error.message : "Could not load this data."
}

export function useDashboard() {
  const [range, setRange] = useState<DashboardRange>("month")

  const [customFrom, setCustomFrom] = useState("")

  const [customTo, setCustomTo] = useState("")

  const [projectId, setProjectId] = useState<string | null>(null)

  const [data, setData] = useState<DashboardOverview | null>(null)

  const [loading, setLoading] = useState(true)

  const [error, setError] = useState<string | null>(null)

  const [attempts, setAttempts] =
    useState<Partial<Record<DashboardWidgetName, WidgetAttempt>>>({})

  const filters: DashboardFilters =
    range === "custom"
      ? {
          range,

          from: customFrom || undefined,

          to: customTo || undefined,

          projectId,
        }
      : { range, projectId }

  // A custom window is fetchable only once both ends are real dates; an

  // incomplete pick must not fire a 400 on every keystroke.

  const customReady =
    range !== "custom" || (customFrom !== "" && customTo !== "")

  // Serialized so the effect has one primitive dependency to watch.

  const filterKey = `${range}|${customFrom}|${customTo}|${projectId ?? ""}`

  const filtersRef = useRef(filters)

  filtersRef.current = filters

  const requestRef = useRef(0)

  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true

    return () => {
      mountedRef.current = false
    }
  }, [])

  const run = useCallback(() => {
    if (!customReady) {
      setLoading(false)

      setError("Pick a start and an end date for the custom range.")

      return
    }

    const controller = new AbortController()

    const ticket = ++requestRef.current

    setLoading(true)

    setError(null)

    // Merged single-widget answers belong to the window being replaced.

    setAttempts({})

    dashboardApi

      .overview(filtersRef.current, controller.signal)

      .then((next) => {
        if (!mountedRef.current || ticket !== requestRef.current) return

        setData(next)

        setLoading(false)
      })

      .catch((failure: unknown) => {
        if (
          controller.signal.aborted ||
          !mountedRef.current ||
          ticket !== requestRef.current
        ) {
          return
        }

        setData(null)

        setLoading(false)

        setError(messageFor(failure))
      })
  }, [customReady])

  useEffect(() => {
    run()

    return () => {
      // Bump the ticket so an in-flight response is ignored on unmount.

      requestRef.current++
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, filterKey])

  const retryWidget = useCallback((key: DashboardWidgetName) => {
    const controller = new AbortController()

    const ticket = requestRef.current

    setAttempts((current) => ({ ...current, [key]: { loading: true } }))

    dashboardApi

      .widget(key, filtersRef.current, controller.signal)

      .then((result) => {
        // A full overview may have landed meanwhile; then its answer wins.

        if (!mountedRef.current || ticket !== requestRef.current) return

        setAttempts((current) => ({
          ...current,

          [key]: { loading: false, envelope: result.envelope },
        }))
      })

      .catch((failure: unknown) => {
        if (controller.signal.aborted || !mountedRef.current) return

        setAttempts((current) => ({
          ...current,

          [key]: {
            loading: false,
            envelope: { ok: false, error: messageFor(failure) },
          },
        }))
      })
  }, [])

  const widget = useCallback(
    (key: DashboardWidgetName): DashboardWidgetState => {
      const attempt = attempts[key]

      return {
        envelope: attempt?.envelope ?? data?.widgets[key],

        loading: attempt?.loading === true || (loading && !data),

        retry: () => retryWidget(key),
      }
    },

    [attempts, data, loading, retryWidget],
  )

  return {
    filters,

    setRange,

    setCustomFrom,

    setCustomTo,

    setProjectId,

    data,

    meta: data?.meta ?? null,

    visible: data?.visible ?? [],

    kpiKeys: data?.kpiKeys ?? [] as DashboardKpiKey[],

    sections: data?.sections ?? [],

    loading,

    error,

    reload: run,

    widget,
  }
}
