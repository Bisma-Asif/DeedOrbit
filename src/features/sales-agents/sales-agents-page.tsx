import { useEffect, useMemo, useRef, useState } from "react"

import {
  BarChart3,
  Pencil,
  Plus,
  Search,
  Target,
  UsersRound,
} from "lucide-react"

import { Alert, AlertDescription } from "@/components/ui/alert"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"

import { Badge } from "@/components/ui/badge"

import { Button } from "@/components/ui/button"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

import { EmptyState } from "@/components/empty-state"

import { Field, FieldGrid } from "@/components/field"

import { Input } from "@/components/ui/input"

import { PageHeader } from "@/components/page-header"

import { Progress } from "@/components/ui/progress"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

import { StatCard } from "@/components/stat-card"

import { useSave } from "@/features/organization/use-save"

import { formatCurrency, formatNumber } from "@/lib/format"

import {
  salesAgentsApi,
  type SalesAgent,
  type SalesManagerOption,
  type SalesTeam,
} from "@/lib/sales-agents-api"

import { useAsyncResource } from "@/lib/use-async-resource"

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7)
}

function displayMonth(month: string): string {
  const [year, number] = month.split("-").map(Number)

  return new Date(Date.UTC(year!, number! - 1, 1)).toLocaleDateString(
    undefined,
    { month: "long", year: "numeric", timeZone: "UTC" },
  )
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join("")
    .toUpperCase()
}

export function SalesAgentsPage() {
  const [month, setMonth] = useState(currentMonth)

  const monthRef = useRef(month)

  const [query, setQuery] = useState("")

  const [teamFilter, setTeamFilter] = useState("all")

  const [teamDialog, setTeamDialog] = useState<SalesTeam | null | undefined>(
    undefined,
  )

  const [targetAgent, setTargetAgent] = useState<SalesAgent | null>(null)

  const resource = useAsyncResource((signal) =>
    salesAgentsApi.list(month, signal),
  )

  const save = useSave()

  const data = resource.data

  const agents = data?.agents ?? []

  const teams = data?.teams ?? []

  const managers = data?.managers ?? []

  const canManage = data?.canManage ?? false

  const currency = data?.currency ?? "AED"

  useEffect(() => {
    if (monthRef.current === month) return
    monthRef.current = month
    void resource.reload()
  }, [month, resource.reload])

  const visibleAgents = useMemo(
    () =>
      agents.filter((agent) => {
        if (
          teamFilter !== "all" &&
          (agent.teamId ?? "unassigned") !== teamFilter
        )
          return false

        const needle = query.trim().toLowerCase()

        if (!needle) return true

        return [
          agent.name,
          agent.email,
          agent.phone ?? "",
          agent.jobTitle ?? "",
          agent.teamName ?? "",
        ]
          .join(" ")
          .toLowerCase()
          .includes(needle)
      }),
    [agents, query, teamFilter],
  )

  const grouped = useMemo(() => {
    const groups = teams.map((team) => ({
      id: team.id,

      name: team.name,

      managerName: team.managerName,

      agents: visibleAgents.filter((agent) => agent.teamId === team.id),
    }))

    const unassigned = visibleAgents.filter((agent) => agent.teamId === null)

    if (unassigned.length > 0)
      groups.push({
        id: "unassigned",
        name: "Unassigned",
        managerName: null,
        agents: unassigned,
      })

    return groups
  }, [teams, visibleAgents])

  async function assignTeam(agentId: string, teamId: string | null) {
    const saved = await save.run(async () => {
      await salesAgentsApi.assignTeam(agentId, { teamId })

      await resource.reload()
    })

    if (saved) save.clear()
  }

  async function saveTeam(
    name: string,
    managerUserId: string,
    current: SalesTeam | null,
  ) {
    if (current)
      await salesAgentsApi.updateTeam(current.id, { name, managerUserId })
    else await salesAgentsApi.createTeam({ name, managerUserId })

    await resource.reload()

    setTeamDialog(undefined)
  }

  if (resource.error)
    return (
      <Alert variant="danger">
        <AlertDescription>{resource.error}</AlertDescription>
      </Alert>
    )

  const totalLeads = agents.reduce((sum, agent) => sum + agent.assignedLeads, 0)

  const monthlyLeadAchieved = agents.reduce(
    (sum, agent) => sum + agent.leadsAchieved,
    0,
  )

  const monthlyLeadTarget = agents.reduce(
    (sum, agent) => sum + (agent.leadsTarget ?? 0),
    0,
  )

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Sales Agents"
        description="Teams, monthly targets, and individual sales performance."
        actions={
          canManage && (
            <Button onClick={() => setTeamDialog(null)}>
              <Plus size={13} />
              New team
            </Button>
          )
        }
      />

      <div className="grid grid-cols-2 gap-2.5 xl:grid-cols-4">
        <StatCard
          label="Sales agents"
          value={data ? formatNumber(agents.length) : undefined}
        />
        <StatCard
          label="Teams"
          value={data ? formatNumber(teams.length) : undefined}
        />
        <StatCard
          label="Assigned leads"
          value={data ? formatNumber(totalLeads) : undefined}
        />
        <StatCard
          label={`${displayMonth(month)} leads`}
          value={
            data
              ? `${formatNumber(monthlyLeadAchieved)} / ${
                  monthlyLeadTarget > 0 ? formatNumber(monthlyLeadTarget) : "—"
                }`
              : undefined
          }
          hint="Created and assigned during this month"
        />
      </div>

      {save.error && (
        <Alert variant="danger">
          <AlertDescription>{save.error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>Team performance</CardTitle>
            <p className="mt-1 text-[11.5px] text-muted-foreground">
              Lead achievements use assigned leads created during the selected
              month. Booking and collection actuals are unavailable until those
              modules are connected.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-52">
              <Search
                size={13}
                className="absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                className="pl-8"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Find an agent"
                aria-label="Find an agent"
              />
            </div>
            <Select value={teamFilter} onValueChange={setTeamFilter}>
              <SelectTrigger className="w-40" aria-label="Filter by team">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All teams</SelectItem>
                <SelectItem value="unassigned">Unassigned</SelectItem>
                {teams.map((team) => (
                  <SelectItem key={team.id} value={team.id}>
                    {team.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Field label="Month" htmlFor="sales-agents-month">
              <Input
                id="sales-agents-month"
                className="w-40"
                type="month"
                value={month}
                onChange={(event) =>
                  setMonth(event.target.value || currentMonth())
                }
              />
            </Field>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-5 px-4 py-4">
          {teams.length === 0 && canManage && (
            <Alert>
              <AlertDescription>
                Create a team to group agents. Active sales-agent accounts
                already appear below.
              </AlertDescription>
            </Alert>
          )}
          {agents.length === 0 ? (
            <EmptyState
              icon={UsersRound}
              size="sm"
              title="No active sales agents"
              description="Active users with the Sales Agent role appear in this performance view."
            />
          ) : grouped.length === 0 ? (
            <EmptyState
              icon={Search}
              size="sm"
              title="No agents match"
              description="Change the team filter or search term."
            />
          ) : (
            grouped.map((group) => (
              <section key={group.id} className="flex flex-col gap-2.5">
                <div className="flex items-center justify-between gap-3 border-b border-border pb-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <h2 className="truncate text-[12.5px] font-semibold text-foreground">
                      {group.name}
                    </h2>
                    <Badge variant="outline">{group.agents.length}</Badge>
                    {group.managerName && (
                      <span className="truncate text-[11px] text-muted-foreground">
                        Manager: {group.managerName}
                      </span>
                    )}
                  </div>
                  {canManage && group.id !== "unassigned" && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Edit ${group.name}`}
                      onClick={() =>
                        setTeamDialog(
                          teams.find((team) => team.id === group.id) ?? null,
                        )
                      }
                    >
                      <Pencil size={13} />
                    </Button>
                  )}
                </div>
                <div className="grid gap-2.5 xl:grid-cols-2">
                  {group.agents.map((agent) => (
                    <AgentCard
                      key={agent.id}
                      agent={agent}
                      teams={teams}
                      currency={currency}
                      canManage={canManage}
                      onAssign={assignTeam}
                      onEditTargets={() => setTargetAgent(agent)}
                    />
                  ))}
                </div>
                {group.agents.length === 0 && (
                  <p className="py-2 text-[11.5px] text-muted-foreground">
                    No active agents assigned to this team.
                  </p>
                )}
              </section>
            ))
          )}
        </CardContent>
      </Card>

      {teamDialog !== undefined && (
        <TeamDialog
          key={teamDialog?.id ?? "new-team"}
          team={teamDialog}
          managers={managers}
          onClose={() => setTeamDialog(undefined)}
          onSave={saveTeam}
        />
      )}
      {targetAgent && data && (
        <TargetDialog
          key={`${targetAgent.id}-${month}`}
          agent={targetAgent}
          month={month}
          currency={currency}
          onClose={() => setTargetAgent(null)}
          onSaved={resource.reload}
        />
      )}
    </div>
  )
}

interface AgentCardProps {
  agent: SalesAgent

  teams: SalesTeam[]

  currency: string

  canManage: boolean

  onAssign: (agentId: string, teamId: string | null) => Promise<void>

  onEditTargets: () => void
}

function AgentCard({
  agent,
  teams,
  currency,
  canManage,
  onAssign,
  onEditTargets,
}: AgentCardProps) {
  const leadProgress =
    agent.leadsTarget && agent.leadsTarget > 0
      ? Math.min(100, (agent.leadsAchieved / agent.leadsTarget) * 100)
      : null

  return (
    <article className="rounded-md border border-border bg-card p-3.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <Avatar className="size-9">
            <AvatarFallback>{initials(agent.name)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <h3 className="truncate text-[13px] font-semibold text-foreground">
              {agent.name}
            </h3>
            <p className="truncate text-[11px] text-muted-foreground">
              {agent.jobTitle ?? "Sales Agent"}
            </p>
            <p className="truncate text-[11px] text-muted-foreground">
              {agent.email}
              {agent.phone ? ` · ${agent.phone}` : ""}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline">
            {formatNumber(agent.assignedLeads)} assigned leads
          </Badge>
          {canManage && (
            <Button variant="outline" size="sm" onClick={onEditTargets}>
              <Target size={12} />
              Targets
            </Button>
          )}
        </div>
      </div>

      {canManage && (
        <div className="mt-3 flex items-center gap-2 border-t border-border pt-2.5">
          <span className="w-16 shrink-0 text-[11px] text-muted-foreground">
            Team
          </span>
          <Select
            value={agent.teamId ?? "__none"}
            onValueChange={(value) =>
              void onAssign(agent.id, value === "__none" ? null : value)
            }
          >
            <SelectTrigger
              className="h-7 w-48 text-[11.5px]"
              aria-label={`Team for ${agent.name}`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none">Unassigned</SelectItem>
              {teams.map((team) => (
                <SelectItem key={team.id} value={team.id}>
                  {team.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="mt-3 grid gap-3 border-t border-border pt-3 sm:grid-cols-3">
        <MetricProgress
          label="Leads this month"
          achieved={agent.leadsAchieved}
          target={agent.leadsTarget}
          format="count"
          progress={leadProgress}
        />
        <MetricProgress
          label="Bookings closed"
          achieved={agent.bookingsClosed}
          target={agent.bookingsTarget}
          format="count"
        />
        <MetricProgress
          label="Collections made"
          achieved={agent.collectionsMade}
          target={agent.collectionsTarget}
          format="money"
          currency={currency}
        />
      </div>
    </article>
  )
}

interface MetricProgressProps {
  label: string

  achieved: number | null

  target: number | null

  format: "count" | "money"

  currency?: string

  progress?: number | null
}

function MetricProgress({
  label,
  achieved,
  target,
  format,
  currency,
  progress,
}: MetricProgressProps) {
  const actualLabel =
    achieved === null
      ? "Not available"
      : format === "money"
        ? formatCurrency(achieved, currency ?? "AED", {
            maximumFractionDigits: 0,
          })
        : formatNumber(achieved)

  const targetLabel =
    target === null
      ? "No target set"
      : format === "money"
        ? formatCurrency(target, currency ?? "AED", {
            maximumFractionDigits: 0,
          })
        : formatNumber(target)

  return (
    <div className="min-w-0 rounded-md bg-muted/25 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[10.5px] font-medium text-muted-foreground">
          {label}
        </span>
        {progress !== undefined && progress !== null && (
          <BarChart3 size={12} className="shrink-0 text-muted-foreground" />
        )}
      </div>
      <div className="mt-1.5 flex items-baseline justify-between gap-2">
        <span
          className={`truncate text-[13px] font-semibold tabular-nums ${
            achieved === null ? "text-muted-foreground" : "text-foreground"
          }`}
        >
          {actualLabel}
        </span>
        <span className="shrink-0 text-[10.5px] text-muted-foreground">
          Target {targetLabel}
        </span>
      </div>
      {progress !== undefined && progress !== null ? (
        <Progress className="mt-2" value={progress} />
      ) : (
        <p className="mt-2 text-[10px] text-muted-foreground">
          Actuals not connected
        </p>
      )}
    </div>
  )
}

interface TeamDialogProps {
  team: SalesTeam | null

  managers: SalesManagerOption[]

  onClose: () => void

  onSave: (
    name: string,
    managerUserId: string,
    current: SalesTeam | null,
  ) => Promise<void>
}

function TeamDialog({ team, managers, onClose, onSave }: TeamDialogProps) {
  const save = useSave()

  const [name, setName] = useState(team?.name ?? "")

  const [managerUserId, setManagerUserId] = useState(team?.managerUserId ?? "")

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{team ? "Edit team" : "Create sales team"}</DialogTitle>
          <DialogDescription>
            Group active sales-agent profiles under a manager.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          {save.error && (
            <Alert variant="danger">
              <AlertDescription>{save.error}</AlertDescription>
            </Alert>
          )}
          <FieldGrid>
            <Field
              label="Team name"
              htmlFor="sales-team-name"
              required
              error={save.fields.name}
            >
              <Input
                id="sales-team-name"
                maxLength={80}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <Field label="Manager" htmlFor="sales-team-manager">
              <Select
                value={managerUserId || "__none"}
                onValueChange={(value) =>
                  setManagerUserId(value === "__none" ? "" : value)
                }
              >
                <SelectTrigger id="sales-team-manager">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">No manager</SelectItem>
                  {managers.map((manager) => (
                    <SelectItem key={manager.id} value={manager.id}>
                      {manager.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </FieldGrid>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={save.saving}>
            Cancel
          </Button>
          <Button
            disabled={save.saving || !name.trim()}
            onClick={async () => {
              const done = await save.run(() =>
                onSave(name.trim(), managerUserId, team),
              )
              if (done) save.clear()
            }}
          >
            {save.saving ? "Saving…" : team ? "Save team" : "Create team"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface TargetDialogProps {
  agent: SalesAgent

  month: string

  currency: string

  onClose: () => void

  onSaved: () => Promise<void>
}

function TargetDialog({
  agent,
  month,
  currency,
  onClose,
  onSaved,
}: TargetDialogProps) {
  const save = useSave()

  const [leadsTarget, setLeadsTarget] = useState(
    agent.leadsTarget === null ? "" : String(agent.leadsTarget),
  )

  const [bookingsTarget, setBookingsTarget] = useState(
    agent.bookingsTarget === null ? "" : String(agent.bookingsTarget),
  )

  const [collectionsTarget, setCollectionsTarget] = useState(
    agent.collectionsTarget === null ? "" : String(agent.collectionsTarget),
  )

  const numberOrNull = (value: string) => (value === "" ? null : Number(value))

  async function submit() {
    const done = await save.run(async () => {
      await salesAgentsApi.saveTargets(agent.id, {
        month,

        leadsTarget: numberOrNull(leadsTarget),

        bookingsTarget: numberOrNull(bookingsTarget),

        collectionsTarget: numberOrNull(collectionsTarget),
      })

      await onSaved()
    })

    if (done) {
      save.clear()

      onClose()
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Monthly targets</DialogTitle>
          <DialogDescription>
            {agent.name} · {displayMonth(month)}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          {save.error && (
            <Alert variant="danger">
              <AlertDescription>{save.error}</AlertDescription>
            </Alert>
          )}
          <FieldGrid>
            <Field label="Leads" htmlFor="target-leads">
              <Input
                id="target-leads"
                type="number"
                min={0}
                step={1}
                value={leadsTarget}
                onChange={(event) => setLeadsTarget(event.target.value)}
              />
            </Field>
            <Field label="Bookings" htmlFor="target-bookings">
              <Input
                id="target-bookings"
                type="number"
                min={0}
                step={1}
                value={bookingsTarget}
                onChange={(event) => setBookingsTarget(event.target.value)}
              />
            </Field>
            <Field
              label={`Collections (${currency})`}
              htmlFor="target-collections"
            >
              <Input
                id="target-collections"
                type="number"
                min={0}
                step={1000}
                value={collectionsTarget}
                onChange={(event) => setCollectionsTarget(event.target.value)}
              />
            </Field>
          </FieldGrid>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={save.saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={save.saving}>
            {save.saving ? "Saving…" : "Save targets"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
