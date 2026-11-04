import { Activity, FileText, HandCoins, Trophy, UserPlus } from "lucide-react"

import type { LucideIcon } from "lucide-react"

import { Badge, type BadgeVariant } from "@/components/ui/badge"

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

import { EmptyState } from "@/components/empty-state"

import { Progress } from "@/components/ui/progress"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

import type {
  DashboardActivityRow,
  DashboardAgentRow,
  DashboardBookingRow,
} from "@shared/dashboard"

import { formatDate, formatDateTime, formatNumber } from "@/lib/format"

import { navigate } from "@/lib/router"

import { MoneyExact } from "./money-text"

import { isEmptyRows, WidgetShell } from "./widget-shell"

import type { DashboardWidgetState } from "./use-dashboard"

const BOOKING_TONES: Record<string, BadgeVariant> = {
  confirmed: "success",

  pending: "pending",

  cancelled: "danger",
}

const ACTIVITY_ICONS: Record<string, LucideIcon> = {
  lead: UserPlus,

  booking: Trophy,

  payment: HandCoins,

  document: FileText,
}

/** Newest confirmed bookings — reference, customer, unit, value, agent, status. */

export function RecentBookingsCard({
  state,

  currency,
}: {
  state: DashboardWidgetState

  currency: string
}) {
  return (
    <Card className="min-w-0 xl:col-span-6">
      <CardHeader>
        <div>
          <CardTitle>Recent Bookings</CardTitle>

          <CardDescription>
            Latest bookings raised inside the selected window.
          </CardDescription>
        </div>

        <CardAction>
          <button
            type="button"
            onClick={() => navigate("/bookings")}
            className="text-[12px] font-medium text-primary underline-offset-4 hover:underline"
          >
            View all
          </button>
        </CardAction>
      </CardHeader>

      <CardContent className="px-0 pb-0">
        <WidgetShell<Array<DashboardBookingRow>>
          state={state}
          isEmpty={isEmptyRows}
          skeletonHeight="h-48"
          empty={
            <EmptyState
              icon={Trophy}
              size="sm"
              title="No bookings in this window"
              description="Confirmed bookings appear here as soon as they are recorded."
              action={
                <button
                  type="button"
                  onClick={() => navigate("/bookings")}
                  className="text-[12.5px] font-medium text-primary underline-offset-4 hover:underline"
                >
                  Go to bookings
                </button>
              }
            />
          }
        >
          {(rows) => (
            <div className="overflow-x-auto">
              <Table className="min-w-[44rem]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Booking</TableHead>

                    <TableHead>Customer</TableHead>

                    <TableHead>Project / Unit</TableHead>

                    <TableHead className="text-right">Amount</TableHead>

                    <TableHead>Agent</TableHead>

                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {rows.slice(0, 8).map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="text-[12.5px] font-medium whitespace-nowrap">
                        <a
                          href={`#/bookings/${row.id}`}
                          className="text-primary underline-offset-4 hover:underline"
                        >
                          {row.reference}
                        </a>

                        <p className="text-[11px] text-muted-foreground">
                          {formatDate(row.bookingDate)}
                        </p>
                      </TableCell>

                      <TableCell className="text-[12.5px]">
                        {row.customerName}
                      </TableCell>

                      <TableCell className="text-[12.5px]">
                        <p className="truncate">{row.projectName}</p>

                        <p className="text-[11px] tabular-nums text-muted-foreground">
                          {row.unitCode}
                        </p>
                      </TableCell>

                      <TableCell className="text-right text-[12.5px] tabular-nums whitespace-nowrap">
                        <MoneyExact value={row.amount} currency={currency} />
                      </TableCell>

                      <TableCell className="text-[12.5px]">
                        {row.agentName ?? "—"}
                      </TableCell>

                      <TableCell>
                        <Badge variant={BOOKING_TONES[row.status] ?? "neutral"}>
                          {row.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </WidgetShell>
      </CardContent>
    </Card>
  )
}

/** The period's leading sellers, measured against their booked target. */

export function TopAgentsCard({
  state,

  currency,
}: {
  state: DashboardWidgetState

  currency: string
}) {
  return (
    <Card className="xl:col-span-3">
      <CardHeader>
        <div>
          <CardTitle>Top Sales Agents</CardTitle>

          <CardDescription>
            Booked value in the window against target.
          </CardDescription>
        </div>
      </CardHeader>

      <CardContent>
        <WidgetShell<Array<DashboardAgentRow>>
          state={state}
          isEmpty={isEmptyRows}
          skeletonHeight="h-48"
          empty={
            <EmptyState
              icon={Trophy}
              size="sm"
              title="No bookings this window"
              description="The leaderboard fills as agents close bookings inside the selected range."
            />
          }
        >
          {(rows) => (
            <ol className="flex flex-col gap-3">
              {rows.map((agent, index) => (
                <li key={agent.userId}>
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="min-w-0 truncate text-[12.5px] font-medium text-foreground">
                      <span className="text-muted-foreground tabular-nums">
                        {index + 1}.
                      </span>{" "}
                      {agent.name}
                    </p>

                    <p className="shrink-0 text-[11.5px] tabular-nums text-muted-foreground">
                      {formatNumber(agent.bookings)} bookings
                    </p>
                  </div>

                  <p className="mt-0.5 text-[12.5px] tabular-nums text-foreground">
                    <MoneyExact value={agent.value} currency={currency} />
                  </p>

                  <div className="mt-1 flex items-center gap-2">
                    <Progress
                      value={Math.min(100, agent.achievedPct ?? 0)}
                      className="flex-1"
                      aria-label={`${agent.name} target achieved`}
                    />

                    <span className="w-12 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                      {agent.achievedPct === null
                        ? "No target"
                        : `${agent.achievedPct}%`}
                    </span>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </WidgetShell>
      </CardContent>
    </Card>
  )
}

/** The workspace's latest moves, each labelled by its own icon, not colour. */

export function ActivityCard({ state }: { state: DashboardWidgetState }) {
  return (
    <Card className="xl:col-span-3">
      <CardHeader>
        <div>
          <CardTitle>Recent Activity</CardTitle>

          <CardDescription>
            Leads, bookings, receipts and documents, newest first.
          </CardDescription>
        </div>
      </CardHeader>

      <CardContent>
        <WidgetShell<Array<DashboardActivityRow>>
          state={state}
          isEmpty={isEmptyRows}
          skeletonHeight="h-48"
          empty={
            <EmptyState
              icon={Activity}
              size="sm"
              title="Nothing logged yet"
              description="As your team works, the latest actions show up here."
            />
          }
        >
          {(rows) => (
            <ol className="flex flex-col gap-3">
              {rows.map((row) => {
                const Icon = ACTIVITY_ICONS[row.kind] ?? Activity

                return (
                  <li key={row.id} className="flex gap-2.5">
                    <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground">
                      <Icon size={11} aria-hidden />
                    </span>

                    <div className="min-w-0">
                      <p className="text-[12.5px] leading-4 text-foreground">
                        {row.text}
                      </p>

                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                        {row.actorName} · {formatDateTime(row.at)}
                      </p>
                    </div>
                  </li>
                )
              })}
            </ol>
          )}
        </WidgetShell>
      </CardContent>
    </Card>
  )
}
