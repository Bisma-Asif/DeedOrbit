import { useEffect, useState } from "react"
import { Copy, KeyRound, Mail, ShieldAlert } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ConfirmDialog } from "@/features/users/confirm-dialog"
import { ApiError, usersApi, type TenantUser } from "@/lib/api"
import { formatDateTime } from "@/lib/format"

export type ForceResetDialogProps = {
  user: TenantUser | null
  onOpenChange: (open: boolean) => void
  onChanged: () => void
}

type Issued = {
  email: string
  token: string
  expiresAt: string
  requiredAt: string
  revokedSessions: number
}

/**
 * Retires a member's password on their behalf.
 *
 * Two-step on purpose. The confirmation states the three consequences plainly —
 * the old password stops working, every device is signed out, and the member
 * cannot get back in until they set a new one — because this is the action an
 * administrator reaches for after a suspected compromise and it will lock
 * somebody out if the person is not told.
 *
 * There is no mail transport in this deployment, so the single-use link is
 * surfaced for hand delivery, exactly as the invitation flow does. That branch
 * is labelled rather than hidden, so nobody mistakes it for a working email path.
 */
export function ForceResetDialog({
  user,
  onOpenChange,
  onChanged,
}: ForceResetDialogProps) {
  const [confirming, setConfirming] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [issued, setIssued] = useState<Issued | null>(null)
  const [copied, setCopied] = useState(false)

  // Keyed on the member's id, not on the object. `onChanged()` reloads the members
  // table, which hands back a new object for the same person; resetting on the
  // object would wipe the token the administrator just came here to collect.
  const userId = user?.id ?? null

  useEffect(() => {
    setConfirming(false)
    setError(null)
    setIssued(null)
    setCopied(false)
  }, [userId])

  // Closing drops the state, so reopening for the same member starts clean.
  useEffect(() => {
    if (!user) {
      setConfirming(false)
      setError(null)
      setIssued(null)
      setCopied(false)
    }
  }, [user])

  if (!user) return null

  async function force() {
    if (!user) return
    setPending(true)
    setError(null)
    try {
      const result = await usersApi.forcePasswordReset(user.id)
      setIssued({
        email: user.email,
        token: result.devResetToken ?? "",
        expiresAt: result.expiresAt,
        requiredAt: result.requiredAt,
        revokedSessions: result.revokedSessions,
      })
      setConfirming(false)
      onChanged()
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "The password reset could not be forced.",
      )
      setConfirming(false)
    } finally {
      setPending(false)
    }
  }

  async function copyToken() {
    if (!issued?.token) return
    try {
      await navigator.clipboard.writeText(issued.token)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  return (
    <>
      <Dialog
        open={!confirming}
        onOpenChange={(open) => {
          if (!open) onOpenChange(false)
        }}
      >
        <DialogContent className="sm:max-w-lg">
          {issued ? (
            <>
              <DialogHeader>
                <DialogTitle>Password reset required</DialogTitle>
                <DialogDescription asChild>
                  <div className="text-[12.5px] leading-5">
                    {issued.email} must choose a new password before the app
                    opens for them. The old one no longer works.
                  </div>
                </DialogDescription>
              </DialogHeader>

              <div className="flex flex-col gap-4 py-1">
                <Alert>
                  <ShieldAlert size={15} />
                  <div className="flex-1">
                    <AlertTitle>What just happened</AlertTitle>
                    <AlertDescription asChild>
                      <ul className="mt-1 list-disc space-y-0.5 pl-4">
                        <li>
                          {issued.revokedSessions} live session
                          {issued.revokedSessions === 1 ? "" : "s"} signed out.
                        </li>
                        <li>Flagged at {formatDateTime(issued.requiredAt)}.</li>
                        <li>
                          Only a new password gets them in — the old one is
                          refused at sign-in.
                        </li>
                      </ul>
                    </AlertDescription>
                  </div>
                </Alert>

                {issued.token ? (
                  <Alert variant="pending">
                    <Mail size={15} />
                    <div className="flex-1">
                      <AlertTitle>No mail service is connected</AlertTitle>
                      <AlertDescription asChild>
                        <div className="space-y-2">
                          <p>
                            The server returned the single-use link because it
                            is running with token exposure enabled. Send this to
                            {issued.email}; it expires{" "}
                            {formatDateTime(issued.expiresAt)}.
                          </p>
                          <div className="flex items-center gap-2">
                            <code className="min-w-0 flex-1 truncate rounded border border-border bg-card px-2 py-1 font-mono text-[11px]">
                              {issued.token}
                            </code>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={copyToken}
                            >
                              <Copy size={12} /> {copied ? "Copied" : "Copy"}
                            </Button>
                          </div>
                        </div>
                      </AlertDescription>
                    </div>
                  </Alert>
                ) : (
                  <Alert>
                    <Mail size={15} />
                    <div className="flex-1">
                      <AlertTitle>No reset link to hand over</AlertTitle>
                      <AlertDescription asChild>
                        <p>
                          This deployment has no mail service and the server is
                          not exposing reset links, so nothing was sent to{" "}
                          {issued.email} and nobody can finish the reset from
                          here. Set <code>DEEDORBIT_EXPOSE_RESET_TOKEN=1</code>{" "}
                          on the server and force the reset again.
                        </p>
                      </AlertDescription>
                    </div>
                  </Alert>
                )}
              </div>

              <DialogFooter>
                <Button onClick={() => onOpenChange(false)}>Done</Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>
                  Force a password reset for {user.fullName}
                </DialogTitle>
                <DialogDescription asChild>
                  <div className="text-[12.5px] leading-5">
                    Use this after a suspected compromise, or when someone is
                    locked out of a password you do not hold.
                  </div>
                </DialogDescription>
              </DialogHeader>

              <div className="flex flex-col gap-4 py-1">
                {error ? (
                  <Alert variant="danger">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                ) : null}

                <div className="flex items-center justify-between gap-3 border-b border-border pb-3">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium text-foreground">
                      {user.email}
                    </p>
                    <p className="text-[11.5px] text-muted-foreground">
                      Last signed in{" "}
                      {user.lastLoginAt
                        ? formatDateTime(user.lastLoginAt)
                        : "never"}
                    </p>
                  </div>
                  <Badge variant="pending">
                    <KeyRound size={11} />
                    {user.activeSessions} live
                  </Badge>
                </div>

                <ul className="space-y-1.5 text-[12px] leading-5 text-muted-foreground">
                  <li>· Their current password stops working immediately.</li>
                  <li>· Every device they are signed in on is signed out.</li>
                  <li>
                    · They cannot reach any screen until they set a new
                    password.
                  </li>
                </ul>
              </div>

              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  disabled={pending}
                >
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  onClick={() => setConfirming(true)}
                  disabled={pending}
                >
                  <KeyRound size={13} /> Force reset
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Force a password reset for ${user.fullName}?`}
        description={`${user.fullName} will be signed out of all ${user.activeSessions} device${
          user.activeSessions === 1 ? "" : "s"
        } and blocked from signing in until they set a new password. If they are not told, nobody will be able to work until they do.`}
        confirmLabel="Force reset"
        destructive
        pending={pending}
        onConfirm={() => void force()}
      />
    </>
  )
}
