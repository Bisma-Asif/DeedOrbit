import { useEffect, useRef, useState } from "react"

import { CircleAlert } from "lucide-react"

import { Button } from "@/components/ui/button"

import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

import { hashLinkPath, navigate, registerNavigationGuard } from "@/lib/router"

/**
 * Asks before a form with unsaved typing is left.
 *
 * The officer's work is the typing, so losing it to a stray click on the sidebar is a real
 * cost and not a nuisance. Two paths need covering: a code-driven `navigate()` call, which
 * the router consults guards about, and a sidebar link, which is a plain anchor and so is
 * stopped at the click instead — a hash change cannot be undone once it lands.
 *
 * Not covered, and deliberately not pretended: the browser's Back and Forward buttons
 * inside the same tab. A hash navigation cannot be cancelled after the fact and doing it
 * properly would mean replacing the history entries this app depends on, so a dirty form
 * says so in its own banner and autosaves a draft, and the officer decides. Closing the tab
 * or reloading it *is* covered, through `beforeunload`.
 */

export interface UnsavedGuardProps {
  /** True while the form holds input the server does not have. */

  dirty: boolean

  /**
   * Drop the input: clear the draft, reset the form, whatever the caller owns. Called
   * *before* the navigation, so the guard does not block its own release.
   */

  onRelease: () => void

  /**
   * The caller's own Cancel or Close button, when it wants the same question asked. Set it
   * true instead of closing; the guard answers with Stay or Discard.
   */

  closing?: boolean

  /** Clears `closing`, so a Stay leaves the form exactly as it was. */

  onStopClosing?: () => void

  /** What to do after the officer agrees to discard a `closing` request. */

  onProceedClose?: () => void

  /** Naming what is at stake reads better than "unsaved changes". */

  subject?: string
}

function currentPath(): string {
  const raw = window.location.hash.replace(/^#/, "")

  if (raw === "" || raw === "/") return "/dashboard"

  return raw.startsWith("/") ? raw : `/${raw}`
}

export function UnsavedGuard({
  dirty,

  onRelease,

  closing = false,

  onStopClosing,

  onProceedClose,

  subject = "this customer form",
}: UnsavedGuardProps) {
  const [pending, setPending] = useState<string | null>(null)

  // A ref, not the prop: the guard is registered once and has to read the current answer at

  // the moment of the click, while `onRelease` still has to be allowed to update the ref

  // synchronously before it calls `navigate` — otherwise it would block its own release.

  const dirtyRef = useRef(dirty)

  dirtyRef.current = dirty

  useEffect(() => {
    const guard = (target: string) => {
      if (!dirtyRef.current) return false

      setPending(target)

      return true
    }

    const release = registerNavigationGuard(guard)

    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return

      // A modified click means "open it elsewhere", which leaves nothing behind to lose.

      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
        return

      if (!dirtyRef.current) return

      const anchor = (event.target as HTMLElement | null)?.closest?.("a[href]")

      if (anchor === null || anchor === undefined) return

      const hrefValue = anchor.getAttribute("href") ?? ""

      const target = hashLinkPath(hrefValue)

      if (target === null) return

      if (target === currentPath()) return

      event.preventDefault()

      setPending(target)
    }

    document.addEventListener("click", onClick, true)

    return () => {
      release()

      document.removeEventListener("click", onClick, true)
    }
  }, [])

  useEffect(() => {
    if (!dirty) return

    const onUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()

      // Chrome needs the legacy assignment before it offers its own warning.

      event.returnValue = ""
    }

    window.addEventListener("beforeunload", onUnload)

    return () => window.removeEventListener("beforeunload", onUnload)
  }, [dirty])

  function stay() {
    setPending(null)

    onStopClosing?.()
  }

  function discard() {
    const target = pending

    setPending(null)

    onStopClosing?.()

    // The ref first: `onRelease` only queues a state update, and `navigate` below would

    // otherwise meet a guard that still believes the form is dirty and refuse itself.

    dirtyRef.current = false

    onRelease()

    if (target) navigate(target)
    else onProceedClose?.()
  }

  if (pending === null && !closing) return null

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) stay()
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Save what you typed first?</DialogTitle>
          <DialogDescription asChild>
            <div className="text-[12.5px] leading-5">
              {subject} holds values that were not saved. Leaving now puts the
              record back to what it was, and nothing has been sent.
            </div>
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="flex items-start gap-2 text-[12px] leading-5 text-muted-foreground">
            <CircleAlert size={14} className="mt-0.5 shrink-0 text-warning" />
            <p>
              Anything typed so far stays in this browser as a draft for a few
              days, so a second visit to the same form can offer it back.
            </p>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={stay}>
            Keep editing
          </Button>
          <Button variant="danger" onClick={discard}>
            {pending ? "Discard and leave" : "Discard what I typed"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
