import { useEffect, useState } from "react"
import {
  History,
  KeyRound,
  Laptop,
  ShieldCheck,
  Smartphone,
  UserCog,
} from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
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
import {
  ApiError,
  usersApi,
  type LoginEvent,
  type LoginEventOutcome,
  type MemberActivity,
  type MemberAction,
  type TenantUser,
} from "@/lib/api"
import { formatDateTime, formatRelative } from "@/lib/format"

export type ActivityDialogProps = {
  user: TenantUser | null
  onOpenChange: (open: boolean) => void
}

/**
 * One member's sign-in history, live sessions, and the administrator actions
 * taken against them.
 *
 * This is the screen that answers a question the members table cannot: not
 * "what can this person do?" but "has anyone else been using their account?".
 * Failed attempts matter as much as successful ones, so the log is deliberately
 * not filtered down to what looks tidy — a burst of `failed` rows is the signal.
 */
export function ActivityDialog({ user, onOpenChange }: ActivityDialogProps) {
  const [data, setData] = useState<MemberActivity | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!user) return
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    setData(null)

    usersApi
      .activity(user.id)
      .then((result) => {
        if (!controller.signal.aborted) setData(result)
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return
        setError(
          caught instanceof ApiError
            ? caught.message
            : "Activity could not be loaded.",
        )
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [user])

  if (!user) return null

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Activity for {user.fullName}</DialogTitle>
          <DialogDescription asChild>
            <div className="text-[12.5px] leading-5">
              Sign-in attempts, devices currently signed in, and the access
              changes made on this membership.
            </div>
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <Alert variant="danger">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <div className="max-h-[26rem] overflow-auto">
          {loading ? (
            <div className="space-y-2 p-1">
              {Array.from({ length: 4 }, (_, index) => (
                <div
                  key={index}
                  aria-hidden="true"
                  className="h-10 animate-pulse rounded bg-muted"
                />
              ))}
            </div>
          ) : !data ? null : (
            <div className="flex flex-col gap-5">
              <SignInSummary activity={data} />

              <Section
                icon={History}
                title="Sign-in attempts"
                count={data.events.length}
                empty={
                  data.events.length === 0
                    ? "No sign-in attempt has been recorded for this member yet."
                    : undefined
                }
              >
                {data.events.map((event) => (
                  <EventRow key={event.id} event={event} />
                ))}
              </Section>

              <Section
                icon={Laptop}
                title="Signed in now"
                count={data.sessions.length}
                empty={
                  data.sessions.length === 0
                    ? "Not signed in on any device."
                    : undefined
                }
              >
                {data.sessions.map((session) => (
                  <div
                    key={session.id}
                    className="flex items-start gap-2.5 border-b border-border px-3 py-2.5 last:border-b-0"
                  >
                    {isMobile(session.userAgent) ? (
                      <Smartphone
                        size={14}
                        className="mt-0.5 shrink-0 text-muted-foreground"
                      />
                    ) : (
                      <Laptop
                        size={14}
                        className="mt-0.5 shrink-0 text-muted-foreground"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12.5px] text-foreground">
                        {session.userAgent ?? "Unrecognised device"}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {session.ipAddress ?? "IP unknown"} · signed in{" "}
                        {formatRelative(session.createdAt)} · last seen{" "}
                        {formatRelative(session.lastSeenAt)}
                      </p>
                    </div>
                  </div>
                ))}
              </Section>

              <Section
                icon={UserCog}
                title="Access changes"
                count={data.actions.length}
                empty={
                  data.actions.length === 0
                    ? "No administrator has changed this membership."
                    : undefined
                }
              >
                {data.actions.map((action) => (
                  <ActionRow key={action.id} action={action} />
                ))}
              </Section>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function isMobile(userAgent: string | null): boolean {
  return (userAgent ?? "").toLowerCase().includes("mobile")
}

const OUTCOME_LABEL: Record<LoginEventOutcome, string> = {
  success: "Signed in",
  failed: "Wrong password",
  suspended: "Account restricted",
  locked: "Locked out",
  reset_required: "Reset required",
  twofa_challenged: "Second factor pending",
}

function outcomeVariant(
  outcome: LoginEventOutcome,
): "success" | "danger" | "pending" | "neutral" {
  if (outcome === "success") return "success"
  if (outcome === "twofa_challenged" || outcome === "reset_required")
    return "pending"
  if (outcome === "failed" || outcome === "locked" || outcome === "suspended")
    return "danger"
  return "neutral"
}

function Section({
  icon: Icon,
  title,
  count,
  empty,
  children,
}: {
  icon: typeof History
  title: string
  count: number
  empty?: string
  children: React.ReactNode
}) {
  return (
    <section>
      <h3 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium tracking-[0.06em] text-muted-foreground uppercase">
        <Icon size={12} />
        {title}
        <span className="tabular-nums">({count})</span>
      </h3>
      {count === 0 && empty ? (
        <p className="rounded-md border border-dashed border-border px-3 py-3 text-[12px] text-muted-foreground">
          {empty}
        </p>
      ) : (
        <div className="rounded-md border border-border">{children}</div>
      )}
    </section>
  )
}

function EventRow({ event }: { event: LoginEvent }) {
  return (
    <div className="flex items-start gap-2.5 border-b border-border px-3 py-2.5 last:border-b-0">
      <Badge
        variant={outcomeVariant(event.outcome)}
        className="mt-0.5 shrink-0"
      >
        {OUTCOME_LABEL[event.outcome]}
      </Badge>
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] text-foreground">
          {formatDateTime(event.createdAt)}
        </p>
        <p className="text-[11px] text-muted-foreground">
          {event.ipAddress ?? "IP unknown"}
          {event.userAgent ? ` · ${event.userAgent}` : ""}
        </p>
      </div>
    </div>
  )
}

const ACTION_LABEL: Record<string, string> = {
  "user.invited": "Invited to the workspace",
  "user.updated": "Profile edited",
  "user.role_changed": "Role changed",
  "user.active": "Reactivated",
  "user.suspended": "Suspended",
  "user.deactivated": "Deactivated",
  "user.deleted": "Removed",
  "user.sessions_revoked": "All sessions revoked",
  "user.session_revoked": "One session revoked",
  "user.branches_updated": "Office restriction changed",
  "user.password_reset_forced": "Password reset forced",
}

function ActionRow({ action }: { action: MemberAction }) {
  return (
    <div className="flex items-start gap-2.5 border-b border-border px-3 py-2.5 last:border-b-0">
      <ShieldCheck
        size={14}
        className="mt-0.5 shrink-0 text-muted-foreground"
      />
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] text-foreground">
          {ACTION_LABEL[action.action] ?? action.action}
        </p>
        <p className="text-[11px] text-muted-foreground">
          by {action.actorEmail ?? "an administrator"} ·{" "}
          {formatDateTime(action.createdAt)}
        </p>
      </div>
    </div>
  )
}

/**
 * The headline numbers, stated before the log so the answer to "is something
 * wrong here?" does not depend on scrolling a list.
 */
function SignInSummary({ activity }: { activity: MemberActivity }) {
  const { member } = activity

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-md border border-border bg-muted/40 px-3 py-2.5">
      <Stat
        icon={KeyRound}
        label="Last sign-in"
        value={
          member.lastLoginAt ? formatRelative(member.lastLoginAt) : "Never"
        }
      />
      <Stat
        icon={History}
        label="Failed attempts"
        value={`${member.recentFailedLogins} in 7 days`}
        tone={member.recentFailedLogins > 0 ? "danger" : undefined}
      />
      <Stat
        icon={Laptop}
        label="Live sessions"
        value={String(activity.sessions.length)}
      />
      <Stat
        icon={ShieldCheck}
        label="Office access"
        value={
          member.branchNames.length === 0
            ? "All offices"
            : member.branchNames.join(", ")
        }
      />
      {member.mustResetPassword ? (
        <Badge variant="pending">Password reset pending</Badge>
      ) : null}
    </div>
  )
}

function Stat({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof History
  label: string
  value: string
  tone?: "danger"
}) {
  return (
    <div className="min-w-0">
      <p className="flex items-center gap-1 text-[10.5px] tracking-[0.05em] text-muted-foreground uppercase">
        <Icon size={11} />
        {label}
      </p>
      <p
        className={
          tone === "danger"
            ? "text-[13px] font-medium text-danger"
            : "truncate text-[13px] font-medium text-foreground"
        }
      >
        {value}
      </p>
    </div>
  )
}
