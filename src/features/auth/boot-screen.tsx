import { Building2 } from "lucide-react"

/**
 * Shown while `GET /api/auth/session` resolves. Without this the app would
 * flash the sign-in screen at an already-authenticated user on every reload,
 * because there is no client-side session to read synchronously.
 */
export function BootScreen() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-background">
      <span className="flex size-9 items-center justify-center rounded-md bg-nav text-nav-foreground">
        <Building2 size={19} strokeWidth={2.2} />
      </span>
      <p className="text-[12.5px] font-medium text-muted-foreground">
        Restoring your session…
      </p>
      <span
        role="status"
        aria-live="polite"
        className="size-4 animate-spin rounded-full border-2 border-border border-t-primary"
      />
    </div>
  )
}
