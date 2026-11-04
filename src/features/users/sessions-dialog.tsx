import { useEffect, useState } from "react"
import { Laptop, LogOut, Smartphone } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/empty-state"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  ApiError,
  usersApi,
  type ActiveSession,
  type TenantUser,
} from "@/lib/api"
import { formatDateTime, formatRelative } from "@/lib/format"

export type SessionsDialogProps = {
  user: TenantUser | null
  onOpenChange: (open: boolean) => void
  onChanged: () => void
}

/**
 * Live sessions for one member, with per-session and bulk revocation.
 *
 * Revoking is the response to a suspected compromise, so the copy says plainly
 * that the device is signed out immediately rather than "expires in 8 hours".
 */
export function SessionsDialog({
  user,
  onOpenChange,
  onChanged,
}: SessionsDialogProps) {
  const [sessions, setSessions] = useState<ActiveSession[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [revokingAll, setRevokingAll] = useState(false)

  useEffect(() => {
    if (!user) return
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    setSessions([])

    usersApi
      .sessions(user.id)
      .then((result) => {
        if (!controller.signal.aborted) setSessions(result.sessions)
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return
        setError(
          caught instanceof ApiError
            ? caught.message
            : "Sessions could not be loaded.",
        )
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [user])

  if (!user) return null

  async function revokeOne(sessionId: string) {
    if (!user) return
    setBusyId(sessionId)
    setError(null)
    try {
      await usersApi.revokeSession(user.id, sessionId)
      setSessions((current) =>
        current.filter((entry) => entry.id !== sessionId),
      )
      onChanged()
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "That session was not revoked.",
      )
    } finally {
      setBusyId(null)
    }
  }

  async function revokeAll() {
    if (!user) return
    setRevokingAll(true)
    setError(null)
    try {
      await usersApi.revokeSessions(user.id)
      setSessions([])
      onChanged()
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Sessions were not revoked.",
      )
    } finally {
      setRevokingAll(false)
    }
  }

  const others = sessions.filter((entry) => !entry.current)

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Active sessions for {user.fullName}</DialogTitle>
          <DialogDescription asChild>
            <div className="text-[12.5px] leading-5">
              Revoking a session signs that device out immediately. Sessions
              idle for more than 8 hours end on their own.
            </div>
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <Alert variant="danger">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <div className="max-h-[22rem] overflow-auto rounded-md border border-border">
          {loading ? (
            <div className="space-y-2 p-3">
              {Array.from({ length: 3 }, (_, index) => (
                <div
                  key={index}
                  aria-hidden="true"
                  className="h-9 animate-pulse rounded bg-muted"
                />
              ))}
            </div>
          ) : sessions.length === 0 ? (
            <EmptyState
              icon={Laptop}
              size="sm"
              title="No active sessions"
              description="This member is not signed in on any device right now."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Device</TableHead>
                  <TableHead>Signed in</TableHead>
                  <TableHead>Last seen</TableHead>
                  <TableHead className="text-right">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessions.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {entry.userAgent?.toLowerCase().includes("mobile") ? (
                          <Smartphone
                            size={14}
                            className="shrink-0 text-muted-foreground"
                          />
                        ) : (
                          <Laptop
                            size={14}
                            className="shrink-0 text-muted-foreground"
                          />
                        )}
                        <div className="min-w-0">
                          <p className="truncate text-[12.5px] text-foreground">
                            {entry.userAgent ?? "Unrecognised device"}
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            {entry.ipAddress ?? "IP unknown"}
                          </p>
                        </div>
                        {entry.current ? (
                          <Badge variant="success">This device</Badge>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-[12px] whitespace-nowrap text-muted-foreground">
                      {formatDateTime(entry.createdAt)}
                    </TableCell>
                    <TableCell className="text-[12px] whitespace-nowrap text-muted-foreground">
                      {formatRelative(entry.lastSeenAt)}
                    </TableCell>
                    <TableCell align="right">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busyId === entry.id}
                        onClick={() => void revokeOne(entry.id)}
                      >
                        <LogOut size={12} />
                        {busyId === entry.id ? "…" : "Revoke"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={revokeAll}
            disabled={revokingAll || others.length === 0}
          >
            {revokingAll
              ? "Revoking…"
              : `Sign out all other devices (${others.length})`}
          </Button>
          <Button onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
