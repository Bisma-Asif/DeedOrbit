import { useMemo, useState } from "react"

import {
  LayoutGrid,
  List,
  Pencil,
  Plus,
  Search,
  Settings2,
  Users,
} from "lucide-react"

import { Alert, AlertDescription } from "@/components/ui/alert"

import { Badge } from "@/components/ui/badge"

import { Button } from "@/components/ui/button"

import { Card } from "@/components/ui/card"

import {
  DataTable,
  TableFilter,
  type DataTableColumn,
} from "@/components/data-table"

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

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

import { StatCard } from "@/components/stat-card"

import { useSave } from "@/features/organization/use-save"

import {
  LeadDetailSheet,
  LeadPipelineBoard,
  LeadStageManager,
  type LeadSelection,
} from "@/features/leads/leads-pipeline"

import { formatDateTime, formatNumber, orDash } from "@/lib/format"

import {
  leadsApi,
  type Lead,
  type LeadInput,
  type LeadStage,
} from "@/lib/leads-api"

import { useAsyncResource } from "@/lib/use-async-resource"

import {
  LEAD_CAMPAIGN_MAX,
  LEAD_EMAIL_MAX,
  LEAD_INTEREST_MAX,
  LEAD_LOST_REASON_MAX,
  LEAD_NAME_MAX,
  LEAD_PHONE_MAX,
  LEAD_SOURCES,
  LEAD_SOURCE_MAX,
  type LeadStatus,
} from "@shared/leads"

const BADGE_TONE: Record<LeadStage["tone"], "neutral" | "success" | "pending" | "danger" | "info"> =
  {
    neutral: "neutral",

    success: "success",

    warning: "pending",

    info: "info",

    danger: "danger",
  }

interface LeadDraft {
  name: string

  phone: string

  email: string

  source: string

  campaign: string

  projectInterest: string

  budgetMin: string

  budgetMax: string

  assignedAgentId: string

  status: LeadStatus

  followUpDate: string

  lostReason: string
}

interface LeadAgentOption {
  id: string

  name: string

  role: string
}

interface LeadDialogProps {
  lead: Lead | null

  stages: LeadStage[]

  agents: LeadAgentOption[]

  sources: string[]

  onClose: () => void

  onSubmit: (draft: LeadDraft, editing: Lead | null) => Promise<void>
}

const EMPTY_DRAFT: LeadDraft = {
  name: "",

  phone: "",

  email: "",

  source: "",

  campaign: "",

  projectInterest: "",

  budgetMin: "",

  budgetMax: "",

  assignedAgentId: "",

  status: "new",

  followUpDate: "",

  lostReason: "",
}

function toDraft(lead?: Lead): LeadDraft {
  if (!lead) return { ...EMPTY_DRAFT }

  return {
    name: lead.name,

    phone: lead.phone,

    email: lead.email ?? "",

    source: lead.source,

    campaign: lead.campaign ?? "",

    projectInterest: lead.projectInterest ?? "",

    budgetMin: lead.budgetMin === null ? "" : String(lead.budgetMin),

    budgetMax: lead.budgetMax === null ? "" : String(lead.budgetMax),

    assignedAgentId: lead.assignedAgentId ?? "",

    status: lead.status,

    followUpDate: lead.followUpDate ?? "",

    lostReason: lead.lostReason ?? "",
  }
}

function toInput(draft: LeadDraft): LeadInput {
  return {
    name: draft.name.trim(),

    phone: draft.phone.trim(),

    email: draft.email.trim(),

    source: draft.source.trim(),

    campaign: draft.campaign.trim(),

    projectInterest: draft.projectInterest.trim(),

    budgetMin: draft.budgetMin === "" ? null : Number(draft.budgetMin),

    budgetMax: draft.budgetMax === "" ? null : Number(draft.budgetMax),

    assignedAgentId: draft.assignedAgentId,

    status: draft.status,

    followUpDate: draft.followUpDate,

    lostReason: draft.lostReason,
  }
}

function searchLead(lead: Lead, query: string): boolean {
  if (!query.trim()) return true

  const text = [
    lead.name,
    lead.phone,
    lead.email ?? "",
    lead.source,
    lead.campaign ?? "",
    lead.projectInterest ?? "",
    lead.assignedAgentName ?? "",
  ].join(" ")

  return text.toLowerCase().includes(query.trim().toLowerCase())
}

function stageLabel(stages: LeadStage[], key: string): string {
  return stages.find((stage) => stage.key === key)?.label ?? key
}

function stageTone(stages: LeadStage[], key: string): LeadStage["tone"] {
  return stages.find((stage) => stage.key === key)?.tone ?? "neutral"
}

export function LeadsPage() {
  const resource = useAsyncResource((signal) => leadsApi.list(signal))

  const save = useSave()

  const [view, setView] = useState<"pipeline" | "table">("pipeline")

  const [filters, setFilters] = useState<Record<string, string>>({})

  const [query, setQuery] = useState("")

  const [editor, setEditor] = useState<Lead | null | undefined>(undefined)

  const [selected, setSelected] = useState<LeadSelection | null>(null)

  const [manageStages, setManageStages] = useState(false)

  const leads = resource.data?.leads ?? []

  const stages = resource.data?.stages ?? []

  const agents = resource.data?.agents ?? []

  const sources = resource.data?.sources ?? []

  const canCreate = resource.data?.canCreate ?? false

  const canEdit = resource.data?.canEdit ?? false

  const canConvert = resource.data?.canConvert ?? false

  const totals = resource.data?.totals

  const filteredLeads = useMemo(
    () =>
      leads.filter((lead) => {
        if (filters.source && lead.source !== filters.source) return false

        if (filters.status && lead.status !== filters.status) return false

        if (
          filters.agent &&
          (lead.assignedAgentId ?? "unassigned") !== filters.agent
        )
          return false

        return true
      }),
    [filters, leads],
  )

  const pipelineLeads = useMemo(
    () => filteredLeads.filter((lead) => searchLead(lead, query)),
    [filteredLeads, query],
  )

  const columns: Array<DataTableColumn<Lead>> = [
    {
      key: "name",

      header: "Lead",

      width: "15rem",

      sortValue: (lead) => lead.name,

      cell: (lead) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-foreground">{lead.name}</p>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {lead.phone}
            {lead.email ? ` · ${lead.email}` : ""}
          </p>
        </div>
      ),
    },

    {
      key: "source",
      header: "Source",
      width: "9rem",
      sortValue: (lead) => lead.source,
      cell: (lead) => <span>{lead.source}</span>,
    },

    {
      key: "campaign",
      header: "Campaign",
      width: "11rem",
      sortValue: (lead) => lead.campaign ?? "",
      cell: (lead) => <span>{orDash(lead.campaign)}</span>,
    },

    {
      key: "interest",
      header: "Project / interest",
      width: "13rem",
      sortValue: (lead) => lead.projectInterest ?? "",
      cell: (lead) => <span>{orDash(lead.projectInterest)}</span>,
    },

    {
      key: "budget",

      header: "Budget range",

      width: "10rem",

      sortValue: (lead) => lead.budgetMin ?? lead.budgetMax ?? 0,

      cell: (lead) => (
        <span className="tabular-nums">
          {lead.budgetMin === null && lead.budgetMax === null
            ? "—"
            : `${
                lead.budgetMin === null ? "—" : formatNumber(lead.budgetMin)
              } – ${
                lead.budgetMax === null ? "—" : formatNumber(lead.budgetMax)
              }`}
        </span>
      ),
    },

    {
      key: "agent",
      header: "Assigned agent",
      width: "11rem",
      sortValue: (lead) => lead.assignedAgentName ?? "",
      cell: (lead) => <span>{orDash(lead.assignedAgentName)}</span>,
    },

    {
      key: "status",
      header: "Stage",
      width: "9rem",
      sortValue: (lead) => stageLabel(stages, lead.status),
      cell: (lead) => (
        <Badge variant={BADGE_TONE[stageTone(stages, lead.status)]}>
          {stageLabel(stages, lead.status)}
        </Badge>
      ),
    },

    {
      key: "followUp",
      header: "Follow-up",
      width: "9rem",
      sortValue: (lead) => lead.followUpDate ?? "",
      cell: (lead) => (
        <span
          className={
            lead.followUpDate &&
            lead.followUpDate < new Date().toISOString().slice(0, 10)
              ? "text-[11px] font-medium text-danger"
              : "text-[11px] text-muted-foreground"
          }
        >
          {lead.followUpDate
            ? formatDateTime(`${lead.followUpDate}T00:00:00.000Z`)
            : "—"}
        </span>
      ),
    },

    {
      key: "updated",
      header: "Updated",
      width: "10rem",
      align: "right",
      sortValue: (lead) => lead.updatedAt,
      cell: (lead) => (
        <span className="whitespace-nowrap text-muted-foreground">
          {formatDateTime(lead.updatedAt)}
        </span>
      ),
    },

    ...(canEdit
      ? [
          {
            key: "actions",
            header: "",
            width: "3rem",
            align: "right" as const,
            cell: (lead: Lead) => (
              <Button
                variant="ghost"
                size="icon-sm"
                className="size-7"
                aria-label={`Edit ${lead.name}`}
                onClick={(event) => {
                  event.stopPropagation()
                  setEditor(lead)
                }}
              >
                <Pencil size={13} />
              </Button>
            ),
          },
        ]
      : []),
  ]

  async function submit(draft: LeadDraft, current: Lead | null) {
    if (current) await leadsApi.update(current.id, toInput(draft))
    else await leadsApi.create(toInput(draft))

    await resource.reload()
  }

  async function moveLead(lead: Lead, nextStage: string) {
    if (!canEdit || lead.status === nextStage || lead.customerId) return

    if (nextStage === "lost") {
      setSelected({ lead, initialStage: nextStage })

      return
    }

    const saved = await save.run(async () => {
      await leadsApi.update(lead.id, {
        ...toInput(toDraft(lead)),
        status: nextStage,
        lostReason: "",
      })

      await resource.reload()
    })

    if (saved) save.clear()
  }

  if (resource.error)
    return (
      <Alert variant="danger">
        <AlertDescription>{resource.error}</AlertDescription>
      </Alert>
    )

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Leads"
        description="Enquiries, campaign attribution, and sales ownership across your pipeline."
        actions={
          <>
            <div className="flex items-center rounded-md border border-border bg-muted/20 p-0.5">
              <Button
                size="sm"
                variant={view === "pipeline" ? "default" : "ghost"}
                className="h-7"
                onClick={() => setView("pipeline")}
              >
                <LayoutGrid size={13} />
                Pipeline
              </Button>
              <Button
                size="sm"
                variant={view === "table" ? "default" : "ghost"}
                className="h-7"
                onClick={() => setView("table")}
              >
                <List size={13} />
                Table
              </Button>
            </div>
            {canEdit && (
              <Button variant="outline" onClick={() => setManageStages(true)}>
                <Settings2 size={13} />
                Stages
              </Button>
            )}
            {canCreate && (
              <Button onClick={() => setEditor(null)}>
                <Plus size={13} />
                New lead
              </Button>
            )}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-2.5 xl:grid-cols-5">
        <StatCard
          label="Total leads"
          value={totals ? formatNumber(totals.total) : undefined}
        />
        <StatCard
          label="Open pipeline"
          value={totals ? formatNumber(totals.open) : undefined}
        />
        <StatCard
          label="Qualified"
          value={totals ? formatNumber(totals.qualified) : undefined}
        />
        <StatCard
          label="Customers"
          value={totals ? formatNumber(totals.converted) : undefined}
        />
        <StatCard
          label="Follow-ups due"
          value={totals ? formatNumber(totals.followUpsDue) : undefined}
        />
      </div>

      {save.error && (
        <Alert variant="danger">
          <AlertDescription>{save.error}</AlertDescription>
        </Alert>
      )}

      {view === "pipeline" ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-48 flex-1 sm:max-w-xs">
              <Search
                size={13}
                className="absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                className="pl-8"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search leads"
                aria-label="Search leads"
              />
            </div>
            <TableFilter
              label="Source"
              value={filters.source || "__all"}
              placeholder="All sources"
              options={sources.map((source) => ({
                value: source,
                label: source,
              }))}
              onValueChange={(value) =>
                setFilters((current) => ({
                  ...current,
                  source: value === "__all" ? "" : value,
                }))
              }
            />
            <TableFilter
              label="Status"
              value={filters.status || "__all"}
              placeholder="All stages"
              options={stages.map((stage) => ({
                value: stage.key,
                label: stage.label,
              }))}
              onValueChange={(value) =>
                setFilters((current) => ({
                  ...current,
                  status: value === "__all" ? "" : value,
                }))
              }
            />
            <TableFilter
              label="Agent"
              value={filters.agent || "__all"}
              placeholder="All agents"
              options={[
                { value: "unassigned", label: "Unassigned" },
                ...agents.map((agent) => ({
                  value: agent.id,
                  label: agent.name,
                })),
              ]}
              onValueChange={(value) =>
                setFilters((current) => ({
                  ...current,
                  agent: value === "__all" ? "" : value,
                }))
              }
            />
            {Object.values(filters).some(Boolean) && (
              <Button size="sm" variant="ghost" onClick={() => setFilters({})}>
                Clear filters
              </Button>
            )}
          </div>
          <LeadPipelineBoard
            leads={pipelineLeads}
            stages={stages}
            canEdit={canEdit}
            onSelect={(lead) => setSelected({ lead })}
            onMove={moveLead}
          />
        </div>
      ) : (
        <Card className="py-0">
          <DataTable
            columns={columns}
            rows={filteredLeads}
            rowKey={(lead) => lead.id}
            getRowSearchText={(lead) =>
              [
                lead.name,
                lead.phone,
                lead.email ?? "",
                lead.source,
                lead.campaign ?? "",
                lead.projectInterest ?? "",
                lead.assignedAgentName ?? "",
              ].join(" ")
            }
            initialSort={{ key: "updated", direction: "desc" }}
            pageSize={25}
            pageSizeOptions={[25, 50, 100]}
            filters={filters}
            onFilterChange={(key, value) =>
              setFilters((current) => ({
                ...current,
                [key]: value === "__all" ? "" : value,
              }))
            }
            loading={resource.loading}
            maxHeight="max(18rem, calc(100dvh - 25rem))"
            caption="Leads"
            onRowClick={(lead) => setSelected({ lead })}
            filterBar={
              <>
                <TableFilter
                  label="Source"
                  value={filters.source || "__all"}
                  placeholder="All sources"
                  options={sources.map((source) => ({
                    value: source,
                    label: source,
                  }))}
                  onValueChange={(value) =>
                    setFilters((current) => ({
                      ...current,
                      source: value === "__all" ? "" : value,
                    }))
                  }
                />
                <TableFilter
                  label="Status"
                  value={filters.status || "__all"}
                  placeholder="All stages"
                  options={stages.map((stage) => ({
                    value: stage.key,
                    label: stage.label,
                  }))}
                  onValueChange={(value) =>
                    setFilters((current) => ({
                      ...current,
                      status: value === "__all" ? "" : value,
                    }))
                  }
                />
                <TableFilter
                  label="Agent"
                  value={filters.agent || "__all"}
                  placeholder="All agents"
                  options={[
                    { value: "unassigned", label: "Unassigned" },
                    ...agents.map((agent) => ({
                      value: agent.id,
                      label: agent.name,
                    })),
                  ]}
                  onValueChange={(value) =>
                    setFilters((current) => ({
                      ...current,
                      agent: value === "__all" ? "" : value,
                    }))
                  }
                />
              </>
            }
            emptyState={
              <EmptyState
                icon={Users}
                title="No leads captured"
                description="Capture enquiries from referrals, walk-ins, brokers, and campaigns. Lead source and ownership stay attached as the pipeline develops."
                action={
                  canCreate ? (
                    <Button size="sm" onClick={() => setEditor(null)}>
                      <Plus size={13} />
                      Capture first lead
                    </Button>
                  ) : undefined
                }
              />
            }
          />
        </Card>
      )}

      {editor !== undefined && (
        <LeadDialog
          key={editor?.id ?? "new-lead"}
          lead={editor}
          stages={stages}
          agents={agents}
          sources={sources}
          onClose={() => {
            save.clear()
            setEditor(undefined)
          }}
          onSubmit={submit}
        />
      )}
      {selected && (
        <LeadDetailSheet
          key={`${selected.lead.id}-${selected.initialStage ?? "current"}`}
          selection={selected}
          stages={stages}
          canEdit={canEdit}
          canConvert={canConvert}
          onClose={() => setSelected(null)}
          onChanged={resource.reload}
        />
      )}
      {manageStages && (
        <LeadStageManager
          stages={stages}
          onClose={() => setManageStages(false)}
          onChanged={resource.reload}
        />
      )}
    </div>
  )
}

function LeadDialog({
  lead,
  stages,
  agents,
  sources,
  onClose,
  onSubmit,
}: LeadDialogProps) {
  const save = useSave()

  const [draft, setDraft] = useState(() => toDraft(lead ?? undefined))

  const patch = (values: Partial<LeadDraft>) =>
    setDraft((current) => ({ ...current, ...values }))

  const stage = stages.find((entry) => entry.key === draft.status)

  const availableSources = [...new Set([...LEAD_SOURCES, ...sources])]

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {lead ? `Edit ${lead.name}` : "Capture a lead"}
          </DialogTitle>
          <DialogDescription>
            Record the enquiry and route it to an agent.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          {save.error && (
            <Alert variant="danger" className="mb-3">
              <AlertDescription>{save.error}</AlertDescription>
            </Alert>
          )}
          <FieldGrid>
            <Field
              label="Full name"
              htmlFor="lead-name"
              required
              error={save.fields.name}
            >
              <Input
                value={draft.name}
                maxLength={LEAD_NAME_MAX}
                autoComplete="name"
                onChange={(event) => patch({ name: event.target.value })}
              />
            </Field>
            <Field
              label="Phone"
              htmlFor="lead-phone"
              required
              error={save.fields.phone}
            >
              <Input
                value={draft.phone}
                maxLength={LEAD_PHONE_MAX}
                autoComplete="tel"
                onChange={(event) => patch({ phone: event.target.value })}
              />
            </Field>
            <Field label="Email" htmlFor="lead-email" error={save.fields.email}>
              <Input
                type="email"
                value={draft.email}
                maxLength={LEAD_EMAIL_MAX}
                autoComplete="email"
                onChange={(event) => patch({ email: event.target.value })}
              />
            </Field>
            <Field
              label="Source"
              htmlFor="lead-source"
              required
              error={save.fields.source}
            >
              <Input
                list="lead-source-options"
                value={draft.source}
                maxLength={LEAD_SOURCE_MAX}
                onChange={(event) => patch({ source: event.target.value })}
                placeholder="Website, referral, broker…"
              />
              <datalist id="lead-source-options">
                {availableSources.map((source) => (
                  <option key={source} value={source} />
                ))}
              </datalist>
            </Field>
            <Field
              label="Campaign"
              htmlFor="lead-campaign"
              error={save.fields.campaign}
            >
              <Input
                value={draft.campaign}
                maxLength={LEAD_CAMPAIGN_MAX}
                onChange={(event) => patch({ campaign: event.target.value })}
              />
            </Field>
            <Field
              label="Project / property interest"
              htmlFor="lead-interest"
              error={save.fields.projectInterest}
            >
              <Input
                value={draft.projectInterest}
                maxLength={LEAD_INTEREST_MAX}
                onChange={(event) =>
                  patch({ projectInterest: event.target.value })
                }
              />
            </Field>
            <Field
              label="Minimum budget"
              htmlFor="lead-budget-min"
              error={save.fields.budgetMin}
            >
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                value={draft.budgetMin}
                onChange={(event) => patch({ budgetMin: event.target.value })}
              />
            </Field>
            <Field
              label="Maximum budget"
              htmlFor="lead-budget-max"
              error={save.fields.budgetMax}
            >
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                value={draft.budgetMax}
                onChange={(event) => patch({ budgetMax: event.target.value })}
              />
            </Field>
            <Field
              label="Assigned agent"
              htmlFor="lead-agent"
              error={save.fields.assignedAgentId}
            >
              <Select
                value={draft.assignedAgentId || "__unassigned"}
                onValueChange={(value) =>
                  patch({
                    assignedAgentId: value === "__unassigned" ? "" : value,
                  })
                }
              >
                <SelectTrigger id="lead-agent">
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__unassigned">Unassigned</SelectItem>
                  {agents.map((agent) => (
                    <SelectItem key={agent.id} value={agent.id}>
                      {agent.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field
              label="Stage"
              htmlFor="lead-stage"
              error={save.fields.status}
            >
              <Select
                value={draft.status}
                onValueChange={(status) => patch({ status })}
              >
                <SelectTrigger id="lead-stage">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {stages.map((entry) => (
                    <SelectItem key={entry.id} value={entry.key}>
                      {entry.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field
              label="Follow-up date"
              htmlFor="lead-follow-up"
              error={save.fields.followUpDate}
            >
              <Input
                type="date"
                value={draft.followUpDate}
                onChange={(event) =>
                  patch({ followUpDate: event.target.value })
                }
              />
            </Field>
            {stage?.key === "lost" && (
              <Field
                label="Lost reason"
                htmlFor="lead-lost-reason"
                required
                error={save.fields.lostReason}
              >
                <Input
                  value={draft.lostReason}
                  maxLength={LEAD_LOST_REASON_MAX}
                  onChange={(event) =>
                    patch({ lostReason: event.target.value })
                  }
                  placeholder="Why was this lead lost?"
                />
              </Field>
            )}
          </FieldGrid>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={save.saving}>
            Cancel
          </Button>
          <Button
            onClick={async () => {
              const saved = await save.run(() => onSubmit(draft, lead))

              if (saved) save.clear()
            }}
            disabled={save.saving}
          >
            {save.saving ? "Saving…" : lead ? "Save changes" : "Create lead"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
