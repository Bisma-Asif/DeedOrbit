import { useState } from "react"

import { Check, Inbox, X } from "lucide-react"

import { Badge } from "@/components/ui/badge"

import { Button } from "@/components/ui/button"

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

import { EmptyState } from "@/components/empty-state"

import type { DashboardApprovalRow } from "@shared/dashboard"

import { approvalsApi } from "@/lib/approvals-api"

import { formatRelative } from "@/lib/format"

import { navigate } from "@/lib/router"

import { WidgetShell } from "./widget-shell"

import type { DashboardWidgetState } from "./use-dashboard"

/** The approvals widget payload: the queue plus whether this user may decide. */

interface ApprovalsPayload {
  rows: Array<DashboardApprovalRow>

  canAct: boolean
}

/**
 * Approvals waiting on this user.
 *
 * Approval is a one-click decision with an optional note, exactly as the
 * approvals API defines it. Rejection is *not* offered inline: the server
 * requires a reason, so the button takes the approver to the detail page where
 * the note field and the full payload are in front of them, rather than firing
 * a request that would only fail validation.
 */

export function ApprovalsCard({ state }: { state: DashboardWidgetState }) {
  const [busyId, setBusyId] = useState<string | null>(null)

  const [failure, setFailure] = useState<string | null>(null)

  async function approve(row: DashboardApprovalRow) {
    setBusyId(row.id)

    setFailure(null)

    try {
      await approvalsApi.approve(row.id)

      state.retry()
    } catch (error) {
      setFailure(
        error instanceof Error
          ? error.message
          : "That decision could not be saved.",
      )
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Pending Approvals</CardTitle>

          <CardDescription>
            Bookings, discounts, cancellations and refunds awaiting your
            decision.
          </CardDescription>
        </div>

        <CardAction>
          <button
            type="button"
            onClick={() => navigate("/approvals")}
            className="text-[12px] font-medium text-primary underline-offset-4 hover:underline"
          >
            View all
          </button>
        </CardAction>
      </CardHeader>

      <CardContent>
        <WidgetShell<ApprovalsPayload>
          state={state}
          isEmpty={(payload) => payload.rows.length === 0}
          skeletonHeight="h-56"
          empty={
            <EmptyState
              icon={Inbox}
              size="sm"
              tone="positive"
              title="Nothing awaiting you"
              description="Requests that need your decision land here as soon as they are raised."
            />
          }
        >
          {({ rows, canAct }) => (
            <div className="flex flex-col">
              <p className="mb-2 flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                <Badge variant={rows.length > 0 ? "pending" : "neutral"}>
                  {rows.length === 1 ? "1 awaiting" : `${rows.length} awaiting`}
                </Badge>
                {canAct
                  ? "You can decide these."
                  : "Visible to you; another approver decides them."}
              </p>

              {failure && (
                <p className="mb-2 text-[11.5px] text-danger" role="alert">
                  {failure}
                </p>
              )}

              <ul className="flex flex-col divide-y divide-border">
                {rows.slice(0, 8).map((row) => (
                  <li
                    key={row.id}
                    className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant="pending">{row.actionLabel}</Badge>

                        <span className="text-[11.5px] text-muted-foreground">
                          {formatRelative(row.requestedAt)}
                        </span>
                      </div>

                      <p className="mt-1 truncate text-[12.5px] text-foreground">
                        {row.summary ?? row.actionLabel}
                      </p>

                      <p className="truncate text-[11.5px] text-muted-foreground">
                        Requested by {row.requestedByName}
                      </p>
                    </div>

                    {canAct && (
                      <div className="flex shrink-0 items-center gap-1.5">
                        <Button
                          size="sm"
                          onClick={() => void approve(row)}
                          disabled={busyId === row.id}
                          aria-label={`Approve ${row.actionLabel}`}
                        >
                          <Check size={12} />
                          Approve
                        </Button>

                        <Button
                          variant="danger-outline"
                          size="icon-sm"
                          onClick={() => navigate(`/approvals/${row.id}`)}
                          aria-label={`Reject ${row.actionLabel} — open the request to give a reason`}
                          title="Reject — a reason is required"
                        >
                          <X size={13} />
                        </Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </WidgetShell>
      </CardContent>
    </Card>
  )
}
