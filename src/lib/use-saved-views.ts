/**
 * Owns the saved-view lifecycle for one table (`scope`).
 *
 * A page supplies a `serialize()` of its current, restorable state and an
 * `onApply(state)` that reads that JSON back and drives its own filters. The hook
 * never interprets the state — it lists, creates, and deletes views through
 * `saved-views-api.ts` and hands the opaque string to the page that understands it,
 * so adding a filter to a table needs no change here.
 */

import { useCallback, useState } from "react"

import { ApiError } from "@/lib/api"

import { useAsyncResource } from "@/lib/use-async-resource"

import { savedViewsApi } from "@/lib/saved-views-api"

import type { SavedView } from "@shared/saved-views"

export interface UseSavedViewsOptions {
  scope: string

  /** Snapshot the page's current state as a JSON string to store. */

  serialize: () => string

  /** Restore a stored state; the page owns parsing and applying it. */

  onApply: (state: string) => void

  enabled?: boolean
}

export function useSavedViews({
  scope,

  serialize,

  onApply,

  enabled = true,
}: UseSavedViewsOptions) {
  const resource = useAsyncResource(
    (signal) => savedViewsApi.list(scope, signal),

    enabled,
  )

  const [saving, setSaving] = useState(false)

  const [actionError, setActionError] = useState<string | null>(null)

  const views = resource.data?.views ?? []

  const save = useCallback(
    async (name: string): Promise<boolean> => {
      setSaving(true)

      setActionError(null)

      try {
        await savedViewsApi.create({ scope, name, state: serialize() })

        await resource.reload()

        return true
      } catch (error) {
        setActionError(
          error instanceof ApiError
            ? error.message
            : "Could not save this view. Try again.",
        )

        return false
      } finally {
        setSaving(false)
      }
    },

    [resource, scope, serialize],
  )

  const remove = useCallback(
    async (id: string): Promise<void> => {
      setActionError(null)

      try {
        await savedViewsApi.remove(id)

        await resource.reload()
      } catch (error) {
        setActionError(
          error instanceof ApiError
            ? error.message
            : "Could not delete this view. Try again.",
        )
      }
    },

    [resource],
  )

  const apply = useCallback(
    (view: SavedView): void => {
      try {
        onApply(view.state)
      } catch {
        setActionError("That saved view could not be restored.")
      }
    },

    [onApply],
  )

  return {
    views,

    loading: resource.loading,

    saving,

    error: resource.error ?? actionError,

    save,

    remove,

    apply,

    reload: resource.reload,
  }
}
