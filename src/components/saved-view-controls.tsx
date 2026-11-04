/**
 * Save-view controls for one data table.
 *
 * Drops into a `DataTable`'s `toolbar`: a "Views" menu lists the caller's saved
 * views for this scope (apply on click, delete on the trash icon) and a "Save view"
 * button opens a small dialog to name the current configuration. The page owns what
 * "current configuration" means through `serialize`/`onApply`; this component only
 * moves that opaque string to and from the server.
 *
 * Saved views are personal and gated by authentication alone, so there is no
 * permission check here — every signed-in user gets the controls for their own views.
 */

import { useState } from "react"

import { BookMarked, Save, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

import { Field } from "@/components/field"

import { Input } from "@/components/ui/input"

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

import { useSavedViews } from "@/lib/use-saved-views"

import { SAVED_VIEW_NAME_MAX } from "@shared/saved-views"

interface SavedViewControlsProps {
  /** Which table these views belong to. Must be a known `SavedViewScope`. */

  scope: string

  /** Snapshot the page's current filters/search/sort/columns as a JSON string. */

  serialize: () => string

  /** Read a stored state back and drive the page's own controls. */

  onApply: (state: string) => void

  disabled?: boolean
}

export function SavedViewControls({
  scope,

  serialize,

  onApply,

  disabled = false,
}: SavedViewControlsProps) {
  const { views, loading, saving, error, save, remove, apply } = useSavedViews({
    scope,

    serialize,

    onApply,
  })

  const [open, setOpen] = useState(false)

  const [name, setName] = useState("")

  function resetDialog() {
    setName("")

    setOpen(false)
  }

  async function submit() {
    const trimmed = name.trim()

    if (!trimmed) return

    const ok = await save(trimmed)

    if (ok) resetDialog()
  }

  return (
    <div className="flex items-center gap-1.5">
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            disabled={disabled}
            aria-label="Saved views"
          >
            <BookMarked size={13} />
            Views
            {views.length > 0 && (
              <span className="ml-1 text-muted-foreground tabular-nums">
                {views.length}
              </span>
            )}
          </Button>
        </PopoverTrigger>

        <PopoverContent align="end" className="w-72 p-0">
          <p className="border-b border-border px-3 py-2 text-[12px] font-semibold text-foreground">
            Saved views
          </p>

          {loading ? (
            <p className="px-3 py-3 text-[12px] text-muted-foreground">
              Loading…
            </p>
          ) : views.length === 0 ? (
            <p className="px-3 py-3 text-[12px] text-muted-foreground">
              No saved views yet. Configure the filters, then choose “Save
              view”.
            </p>
          ) : (
            <ul className="scrollbar-slim max-h-64 overflow-y-auto py-1">
              {views.map((view) => (
                <li
                  key={view.id}
                  className="flex items-center gap-1 px-1.5 hover:bg-muted/60"
                >
                  <button
                    type="button"
                    onClick={() => {
                      apply(view)

                      setOpen(false)
                    }}
                    className="min-w-0 flex-1 truncate rounded-sm px-1.5 py-1.5 text-left text-[12.5px] text-foreground"
                  >
                    {view.name}
                  </button>

                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Delete ${view.name}`}
                    onClick={() => void remove(view.id)}
                  >
                    <Trash2 size={13} className="text-muted-foreground" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </PopoverContent>
      </Popover>

      <Button
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <Save size={13} />
        Save view
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => (next ? setOpen(true) : resetDialog())}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Save this view</DialogTitle>

            <DialogDescription>
              Store the current filters, search, sort, and columns under a name
              for quick reuse. Views are personal to you and this table.
            </DialogDescription>
          </DialogHeader>

          <Field
            label="Name"
            htmlFor="saved-view-name"
            hint={`${name.trim().length}/${SAVED_VIEW_NAME_MAX}`}
          >
            <Input
              id="saved-view-name"
              value={name}
              maxLength={SAVED_VIEW_NAME_MAX}
              placeholder="e.g. Q3 overdue · Dubai branch"
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void submit()
              }}
            />
          </Field>

          {error ? (
            <p role="alert" className="text-[11.5px] font-medium text-danger">
              {error}
            </p>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={resetDialog}>
              Cancel
            </Button>

            <Button
              onClick={() => void submit()}
              disabled={saving || name.trim().length === 0}
            >
              {saving ? "Saving…" : "Save view"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
