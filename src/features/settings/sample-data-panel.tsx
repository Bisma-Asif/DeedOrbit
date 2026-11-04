/**
 * Sample data.
 *
 * Loads or removes the labelled demo dataset for this workspace. Every row the
 * load writes is registered as sample data, so the sweep takes the whole
 * business away again — the schemes, staff, pipeline, schedules, receipts,
 * overdue lines, spend and paperwork — without touching a single entry the
 * tenant created themselves.
 *
 * The panel is honest about what it does: on the demo workspace the load seeds a
 * full year of trading and a set of demo logins, and the shared password is
 * shown here because this screen is the only place that says so. On any other
 * workspace the same button loads the small labelled sample instead.
 */

import { useState } from "react"

import { Database, ShieldAlert, Sparkles, Trash2 } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

import { Badge } from "@/components/ui/badge"

import { Button } from "@/components/ui/button"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

import { Skeleton } from "@/components/ui/skeleton"

import { ROLE_LABELS } from "@shared/access"

import { dashboardApi } from "@/lib/dashboard-api"

import { ApiError } from "@/lib/api"

import { useAsyncResource } from "@/lib/use-async-resource"

import { useSession } from "@/lib/session-context"

import { formatNumber, orDash } from "@/lib/format"

/** What one button press was doing, so the labels can say so. */

type Pending = "load" | "remove" | null

export function SampleDataPanel() {
  const { can, data } = useSession()

  const canManage = can("settings", "edit")

  const resource = useAsyncResource(
    (signal) => dashboardApi.sampleStatus(signal),

    canManage,
  )

  const [pending, setPending] = useState<Pending>(null)

  const [failure, setFailure] = useState<string | null>(null)

  const [confirming, setConfirming] = useState(false)

  const status = resource.data

  const active = status?.active ?? false

  const tables = status?.tables ?? []

  // A demo login is itself a registered row, so a removal can take the signed-in
  // account away with the set. The panel says so before it happens.
  const isDemoLogin =
    data?.user.email !== undefined &&
    (status?.logins ?? []).some((login) => login.email === data?.user.email)

  async function run(kind: "load" | "remove") {
    setPending(kind)

    setFailure(null)

    try {
      if (kind === "load") await dashboardApi.loadSample()
      else await dashboardApi.removeSample()

      setConfirming(false)

      if (kind === "remove" && isDemoLogin) {
        setFailure(
          "The sample data is removed. The account you signed in with was part of it, so sign in again with a workspace account that is not a demo login.",
        )

        return
      }

      await resource.reload()
    } catch (error) {
      setFailure(
        error instanceof ApiError
          ? error.message
          : "That request could not be completed.",
      )
    } finally {
      setPending(null)
    }
  }

  if (!canManage) {
    return (
      <Alert variant="pending">
        <ShieldAlert size={14} aria-hidden />
        <AlertTitle>Sample data is managed by an owner or admin</AlertTitle>

        <AlertDescription>
          Loading a demo dataset writes staff logins, schemes and money through
          the whole business, so only a role that can change workspace settings
          can load it or remove it.
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border border-success-border bg-success-subtle text-success">
              <Database size={14} aria-hidden />
            </span>

            <div className="min-w-0">
              <CardTitle>Sample data</CardTitle>

              <CardDescription>
                A clearly labelled demo dataset for exploring the workspace. It
                is flagged row by row and removed completely, so it never passes
                for your own business.
              </CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent className="flex flex-col gap-4">
          {resource.loading && !status ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-4 w-64" />

              <Skeleton className="h-4 w-40" />
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <Badge variant={active ? "success" : "outline"}>
                  {active ? "Sample data loaded" : "No sample data"}
                </Badge>

                <p className="text-[12.5px] text-muted-foreground">
                  {active
                    ? `${formatNumber(status?.rows ?? 0)} registered rows across ${formatNumber(tables.length)} tables.`
                    : status?.demoWorkspace
                      ? "Nothing is loaded yet. The full dataset seeds three schemes, staff with demo logins, and a year of pipeline, collections and spend."
                      : "Nothing is loaded yet. The sample seeds a small labelled project with units, leads, bookings and a schedule."}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {active ? (
                  <Button
                    variant="danger-outline"
                    size="sm"
                    onClick={() => setConfirming(true)}
                    disabled={pending !== null}
                  >
                    <Trash2 size={13} />
                    {pending === "remove" ? "Removing…" : "Remove sample data"}
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void run("load")}
                    disabled={pending !== null}
                  >
                    <Sparkles size={13} />
                    {pending === "load" ? "Loading…" : "Load sample data"}
                  </Button>
                )}
              </div>
            </>
          )}

          {failure && (
            <Alert variant="danger">
              <AlertDescription>{failure}</AlertDescription>
            </Alert>
          )}

          <p className="text-[11.5px] text-muted-foreground">
            Removing deletes only the rows this workspace registered as sample
            data, in the order that keeps every reference intact. Your own
            entries are never part of it.
          </p>
        </CardContent>
      </Card>

      {active && tables.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>What is loaded</CardTitle>

            <CardDescription>
              Registered sample rows by table, read from the registry.
            </CardDescription>
          </CardHeader>

          <CardContent className="flex flex-col gap-3">
            <ul className="grid gap-x-6 gap-y-1.5 text-[12.5px] sm:grid-cols-2 lg:grid-cols-3">
              {tables.map((table) => (
                <li
                  key={table.table}
                  className="flex items-baseline justify-between gap-2 border-b border-border/60 pb-1"
                >
                  <span className="truncate text-muted-foreground">
                    {table.table}
                  </span>

                  <span className="tabular-nums font-medium">
                    {formatNumber(table.rows)}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {active && status?.logins && status.logins.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Demo logins</CardTitle>

            <CardDescription>
              Every account below is fictional and shares one password. Change
              or remove the dataset before any of these are used in front of a
              customer.
            </CardDescription>
          </CardHeader>

          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[12px] text-muted-foreground">
                Password
              </span>

              <code className="rounded-md border border-border bg-muted/40 px-2 py-1 text-[12px]">
                {orDash(status.password)}
              </code>
            </div>

            <ul className="flex flex-col divide-y divide-border">
              {status.logins.map((login) => (
                <li
                  key={login.email}
                  className="flex flex-wrap items-center gap-2 py-1.5"
                >
                  <span className="min-w-0 flex-1 truncate text-[12.5px]">
                    {login.email}
                  </span>

                  <span className="text-[11.5px] text-muted-foreground">
                    {login.name}
                  </span>

                  <Badge variant="outline">
                    {ROLE_LABELS[(login.role as keyof typeof ROLE_LABELS)] ??
                      login.role}
                  </Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove the sample data?</DialogTitle>

            <DialogDescription>
              {formatNumber(status?.rows ?? 0)} registered rows go, and nothing
              else. Your own projects, customers and money stay exactly as they
              are. This cannot be undone from the screen.
              {isDemoLogin
                ? " You are signed in with a demo login, so this signs you out as well."
                : ""}
            </DialogDescription>
          </DialogHeader>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirming(false)}
              disabled={pending !== null}
            >
              Keep it
            </Button>

            <Button
              variant="danger"
              onClick={() => void run("remove")}
              disabled={pending !== null}
            >
              {pending === "remove" ? "Removing…" : "Remove sample data"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
