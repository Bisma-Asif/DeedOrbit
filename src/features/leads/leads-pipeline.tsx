import { useState } from "react"

import {
  ArrowDown,
  ArrowUp,
  CalendarClock,
  Check,
  GripVertical,
  MessageSquare,
  Plus,
  Trash2,
} from "lucide-react"

import { Alert, AlertDescription } from "@/components/ui/alert"

import { Badge } from "@/components/ui/badge"

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

import { Field } from "@/components/field"

import { Input } from "@/components/ui/input"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"

import { Textarea } from "@/components/ui/textarea"

import { useSave } from "@/features/organization/use-save"

import { formatDate, formatDateTime, formatNumber, orDash } from "@/lib/format"

import {
  leadsApi,
  type Lead,
  type LeadInput,
  type LeadStage,
} from "@/lib/leads-api"

import { useAsyncResource } from "@/lib/use-async-resource"

import { navigate } from "@/lib/router"

import {
  LEAD_LOST_REASON_MAX,
  LEAD_NOTE_MAX,
  LEAD_STAGE_LABEL_MAX,
  LEAD_STAGE_MAX,
} from "@shared/leads"

const TONE_VARIANT: Record<LeadStage["tone"], "neutral" | "success" | "pending" | "danger" | "info"> =
  {
    neutral: "neutral",

    success: "success",

    warning: "pending",

    info: "info",

    danger: "danger",
  }

export interface LeadSelection {
  lead: Lead

  initialStage?: string
}

interface LeadPipelineBoardProps {
  leads: Lead[]

  stages: LeadStage[]

  canEdit: boolean

  onSelect: (lead: Lead) => void

  onMove: (lead: Lead, status: string) => void
}

export function LeadPipelineBoard({
  leads,
  stages,
  canEdit,
  onSelect,
  onMove,
}: LeadPipelineBoardProps) {
  const [draggedId, setDraggedId] = useState<string | null>(null)

  return (
    <div className="overflow-x-auto pb-2">
      <div
        className="grid min-w-max gap-3"
        style={{
          gridTemplateColumns: `repeat(${Math.max(stages.length, 1)}, minmax(16rem, 1fr))`,
        }}
      >
        {stages.map((stage) => {
          const stageLeads = leads.filter((lead) => lead.status === stage.key)

          return (
            <section
              key={stage.id}
              className="flex min-h-80 max-h-[calc(100dvh-20rem)] min-w-64 flex-col rounded-md border border-border bg-muted/20"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault()

                const lead = leads.find(
                  (entry) =>
                    entry.id ===
                    (draggedId ?? event.dataTransfer.getData("text/plain")),
                )

                if (lead) onMove(lead, stage.key)

                setDraggedId(null)
              }}
            >
              <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-border bg-card px-3 py-2.5">
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className={`size-2 shrink-0 rounded-full ${
                      stage.tone === "success"
                        ? "bg-emerald-600"
                        : stage.tone === "warning"
                          ? "bg-amber-500"
                          : stage.tone === "danger"
                            ? "bg-red-500"
                            : stage.tone === "info"
                              ? "bg-sky-600"
                              : "bg-muted-foreground"
                    }`}
                  />
                  <h2 className="truncate text-[12.5px] font-semibold text-foreground">
                    {stage.label}
                  </h2>
                </div>
                <span className="tabular-nums text-[11px] text-muted-foreground">
                  {stageLeads.length}
                </span>
              </div>
              <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2">
                {stageLeads.length === 0 ? (
                  <p className="px-2 py-5 text-center text-[11.5px] text-muted-foreground">
                    No leads in this stage
                  </p>
                ) : (
                  stageLeads.map((lead) => (
                    <article
                      key={lead.id}
                      draggable={canEdit && !lead.customerId}
                      onDragStart={(event) => {
                        setDraggedId(lead.id)

                        event.dataTransfer.setData("text/plain", lead.id)

                        event.dataTransfer.effectAllowed = "move"
                      }}
                      onDragEnd={() => setDraggedId(null)}
                      className={`rounded-md border border-border bg-card p-3 shadow-xs transition-colors ${
                        draggedId === lead.id
                          ? "opacity-45"
                          : "hover:border-border-strong"
                      } ${
                        canEdit && !lead.customerId
                          ? "cursor-grab active:cursor-grabbing"
                          : ""
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        {canEdit && !lead.customerId && (
                          <GripVertical
                            size={14}
                            className="mt-0.5 shrink-0 text-muted-foreground/60"
                            aria-hidden="true"
                          />
                        )}
                        <button
                          type="button"
                          className="min-w-0 flex-1 text-left"
                          onClick={() => onSelect(lead)}
                        >
                          <span className="block truncate text-[13px] font-semibold text-foreground">
                            {lead.name}
                          </span>
                          <span className="mt-0.5 block truncate text-[11.5px] text-muted-foreground">
                            {lead.phone}
                          </span>
                        </button>
                        <Badge variant={TONE_VARIANT[stage.tone]}>
                          {stage.label}
                        </Badge>
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                        <span className="truncate">
                          {orDash(lead.projectInterest)}
                        </span>
                        <span className="shrink-0 tabular-nums">
                          {lead.budgetMax === null
                            ? "Budget —"
                            : `Up to ${formatNumber(lead.budgetMax)}`}
                        </span>
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-2 border-t border-border/70 pt-2">
                        <span className="truncate text-[10.5px] text-muted-foreground">
                          {orDash(lead.assignedAgentName)}
                        </span>
                        {lead.followUpDate && (
                          <FollowUpBadge date={lead.followUpDate} />
                        )}
                      </div>
                      {lead.status === "lost" && lead.lostReason && (
                        <p className="mt-2 line-clamp-2 text-[11px] text-muted-foreground">
                          {lead.lostReason}
                        </p>
                      )}
                    </article>
                  ))
                )}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}

export function FollowUpBadge({ date }: { date: string | null }) {
  if (!date)
    return (
      <span className="text-[10.5px] text-muted-foreground">No follow-up</span>
    )

  const overdue = date < new Date().toISOString().slice(0, 10)

  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap text-[10.5px] tabular-nums ${
        overdue ? "font-medium text-danger" : "text-muted-foreground"
      }`}
    >
      <CalendarClock size={11} />
      {overdue ? "Overdue · " : "Follow-up · "}
      {formatDate(date)}
    </span>
  )
}

interface LeadDetailSheetProps {
  selection: LeadSelection

  stages: LeadStage[]

  canEdit: boolean

  canConvert: boolean

  onClose: () => void

  onChanged: () => Promise<void>
}

export function LeadDetailSheet({
  selection,
  stages,
  canEdit,
  canConvert,
  onClose,
  onChanged,
}: LeadDetailSheetProps) {
  const { lead, initialStage } = selection

  const detail = useAsyncResource((signal) => leadsApi.read(lead.id, signal))

  const save = useSave()

  const [status, setStatus] = useState(initialStage ?? lead.status)

  const [followUpDate, setFollowUpDate] = useState(lead.followUpDate ?? "")

  const [lostReason, setLostReason] = useState(
    initialStage === "lost" ? "" : (lead.lostReason ?? ""),
  )

  const [note, setNote] = useState("")

  const current = detail.data?.lead ?? lead

  const dirty =
    status !== current.status ||
    followUpDate !== (current.followUpDate ?? "") ||
    (status === "lost" && lostReason !== (current.lostReason ?? ""))

  async function saveChanges() {
    const input: LeadInput = {
      name: current.name,

      phone: current.phone,

      email: current.email ?? "",

      source: current.source,

      campaign: current.campaign ?? "",

      projectInterest: current.projectInterest ?? "",

      budgetMin: current.budgetMin,

      budgetMax: current.budgetMax,

      assignedAgentId: current.assignedAgentId ?? "",

      status,

      followUpDate,

      lostReason: status === "lost" ? lostReason : "",
    }

    const saved = await save.run(async () => {
      await leadsApi.update(current.id, input)

      await Promise.all([detail.reload(), onChanged()])
    })

    if (saved) save.clear()
  }

  async function saveNote() {
    const text = note.trim()

    if (!text) return

    const saved = await save.run(async () => {
      await leadsApi.addNote(current.id, text)

      setNote("")

      await detail.reload()
    })

    if (saved) save.clear()
  }

  async function convert() {
    const saved = await save.run(async () => {
      await leadsApi.convert(current.id)

      await onChanged()
    })

    if (saved) {
      save.clear()

      onClose()

      navigate("/customers")
    }
  }

  const activities = detail.data?.activities ?? []

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <SheetContent side="right" className="w-full overflow-hidden sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{current.name}</SheetTitle>
          <SheetDescription>
            {current.phone}
            {current.email ? ` · ${current.email}` : ""}
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {save.error && (
            <Alert variant="danger">
              <AlertDescription>{save.error}</AlertDescription>
            </Alert>
          )}
          {detail.error && (
            <Alert variant="danger">
              <AlertDescription>{detail.error}</AlertDescription>
            </Alert>
          )}
          <div className="grid grid-cols-2 gap-2">
            <DetailFact label="Source" value={current.source} />
            <DetailFact label="Campaign" value={current.campaign} />
            <DetailFact
              label="Project / interest"
              value={current.projectInterest}
            />
            <DetailFact
              label="Assigned agent"
              value={current.assignedAgentName}
            />
            <DetailFact
              label="Budget range"
              value={
                current.budgetMin === null && current.budgetMax === null
                  ? null
                  : `${
                      current.budgetMin === null
                        ? "—"
                        : formatNumber(current.budgetMin)
                    } – ${
                      current.budgetMax === null
                        ? "—"
                        : formatNumber(current.budgetMax)
                    }`
              }
            />
            <DetailFact
              label="Created"
              value={formatDateTime(current.createdAt)}
            />
          </div>
          {current.customerId && (
            <Alert variant="success">
              <AlertDescription>
                This lead is already in Customers.
              </AlertDescription>
            </Alert>
          )}
          {canEdit && (
            <section className="space-y-3 rounded-md border border-border p-3">
              <h3 className="text-[12px] font-semibold text-foreground">
                Pipeline & follow-up
              </h3>
              <Field label="Stage" htmlFor="lead-detail-stage">
                <Select
                  value={status}
                  onValueChange={(value) => setStatus(value)}
                >
                  <SelectTrigger id="lead-detail-stage">
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
              <Field label="Follow-up date" htmlFor="lead-detail-followup">
                <Input
                  id="lead-detail-followup"
                  type="date"
                  value={followUpDate}
                  onChange={(event) => setFollowUpDate(event.target.value)}
                />
              </Field>
              {status === "lost" && (
                <Field
                  label="Lost reason"
                  htmlFor="lead-detail-lost-reason"
                  required
                  error={save.fields.lostReason}
                >
                  <Textarea
                    id="lead-detail-lost-reason"
                    maxLength={LEAD_LOST_REASON_MAX}
                    value={lostReason}
                    onChange={(event) => setLostReason(event.target.value)}
                    placeholder="Why was this lead lost?"
                  />
                </Field>
              )}
              <div className="flex justify-end">
                <Button
                  size="sm"
                  onClick={saveChanges}
                  disabled={!dirty || save.saving}
                >
                  <Check size={13} />
                  {save.saving ? "Saving…" : "Save updates"}
                </Button>
              </div>
            </section>
          )}
          {canConvert && current.status === "won" && !current.customerId && (
            <Button className="w-full" onClick={convert} disabled={save.saving}>
              <Check size={13} />
              Convert to customer
            </Button>
          )}
          <section className="rounded-md border border-border p-3">
            <div className="mb-2 flex items-center gap-2">
              <MessageSquare size={14} className="text-muted-foreground" />
              <h3 className="text-[12px] font-semibold text-foreground">
                Add a note
              </h3>
            </div>
            {canEdit ? (
              <>
                <Textarea
                  maxLength={LEAD_NOTE_MAX}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="Call summary, buyer preference, or next step"
                />
                <div className="mt-2 flex justify-end">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={saveNote}
                    disabled={!note.trim() || save.saving}
                  >
                    <MessageSquare size={12} />
                    Add note
                  </Button>
                </div>
              </>
            ) : (
              <p className="text-[11.5px] text-muted-foreground">Read only.</p>
            )}
          </section>
          <section>
            <h3 className="mb-3 text-[12px] font-semibold text-foreground">
              Activity
            </h3>
            {activities.length === 0 ? (
              <p className="text-[11.5px] text-muted-foreground">
                No activity recorded.
              </p>
            ) : (
              <ol className="space-y-0 border-l border-border pl-4">
                {activities.map((activity) => (
                  <li
                    key={activity.id}
                    className="relative border-b border-border/70 pb-3 pl-1 last:border-0"
                  >
                    <span className="absolute -left-[1.35rem] top-1 size-2 rounded-full bg-emerald-600" />
                    <p className="text-[12px] leading-5 text-foreground">
                      {activity.body}
                    </p>
                    <p className="mt-0.5 text-[10.5px] text-muted-foreground">
                      {activity.actorName} ·{" "}
                      {formatDateTime(activity.createdAt)}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </SheetContent>
    </Sheet>
  )
}

interface DetailFactProps {
  label: string
  value: string | null
}

function DetailFact({ label, value }: DetailFactProps) {
  return (
    <div className="min-w-0 rounded-md border border-border bg-muted/20 p-2.5">
      <p className="text-[10px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
        {label}
      </p>
      <p className="mt-1 truncate text-[12px] text-foreground">
        {orDash(value)}
      </p>
    </div>
  )
}

interface LeadStageManagerProps {
  stages: LeadStage[]

  onClose: () => void

  onChanged: () => Promise<void>
}

export function LeadStageManager({
  stages,
  onClose,
  onChanged,
}: LeadStageManagerProps) {
  const save = useSave()

  const [drafts, setDrafts] = useState(() =>
    [...stages].sort((a, b) => a.sortOrder - b.sortOrder),
  )

  const [newLabel, setNewLabel] = useState("")

  function move(index: number, offset: number) {
    const target = index + offset

    if (target < 0 || target >= drafts.length) return

    setDrafts((current) => {
      const next = [...current]

      const [stage] = next.splice(index, 1)

      next.splice(target, 0, stage!)

      return next
    })
  }

  async function persist() {
    const saved = await save.run(async () => {
      for (const [sortOrder, stage] of drafts.entries()) {
        await leadsApi.updateStage(stage.id, { label: stage.label, sortOrder })
      }

      await onChanged()
    })

    if (saved) {
      save.clear()

      onClose()
    }
  }

  async function addStage() {
    const label = newLabel.trim()

    if (!label || drafts.length >= LEAD_STAGE_MAX) return

    const saved = await save.run(async () => {
      await leadsApi.createStage(label)

      await onChanged()
    })

    if (saved) {
      save.clear()

      setNewLabel("")

      onClose()
    }
  }

  async function removeStage(stage: LeadStage) {
    const saved = await save.run(async () => {
      await leadsApi.deleteStage(stage.id)

      await onChanged()
    })

    if (saved) {
      save.clear()

      setDrafts((current) => current.filter((entry) => entry.id !== stage.id))
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Pipeline stages</DialogTitle>
          <DialogDescription>
            Rename and reorder stages, or add a workspace-specific stage.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          {save.error && (
            <Alert variant="danger">
              <AlertDescription>{save.error}</AlertDescription>
            </Alert>
          )}
          <ol className="space-y-1.5">
            {drafts.map((stage, index) => (
              <li
                key={stage.id}
                className="flex items-center gap-1.5 rounded-md border border-border p-2"
              >
                <span
                  className={`size-2 shrink-0 rounded-full ${
                    stage.tone === "success"
                      ? "bg-emerald-600"
                      : stage.tone === "warning"
                        ? "bg-amber-500"
                        : stage.tone === "danger"
                          ? "bg-red-500"
                          : stage.tone === "info"
                            ? "bg-sky-600"
                            : "bg-muted-foreground"
                  }`}
                />
                <Input
                  maxLength={LEAD_STAGE_LABEL_MAX}
                  value={stage.label}
                  onChange={(event) =>
                    setDrafts((current) =>
                      current.map((entry) =>
                        entry.id === stage.id
                          ? { ...entry, label: event.target.value }
                          : entry,
                      ),
                    )
                  }
                  aria-label={`Stage ${index + 1} label`}
                />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Move stage up"
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUp size={13} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Move stage down"
                  disabled={index === drafts.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown size={13} />
                </Button>
                {!stage.isBuiltin && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove ${stage.label}`}
                    onClick={() => removeStage(stage)}
                    disabled={save.saving}
                  >
                    <Trash2 size={13} />
                  </Button>
                )}
              </li>
            ))}
          </ol>
          <div className="flex items-center gap-2 border-t border-border pt-3">
            <Input
              value={newLabel}
              maxLength={LEAD_STAGE_LABEL_MAX}
              onChange={(event) => setNewLabel(event.target.value)}
              placeholder="New stage name"
              aria-label="New stage name"
            />
            <Button
              variant="outline"
              onClick={addStage}
              disabled={
                !newLabel.trim() ||
                drafts.length >= LEAD_STAGE_MAX ||
                save.saving
              }
            >
              <Plus size={13} />
              Add
            </Button>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={save.saving}>
            Cancel
          </Button>
          <Button
            onClick={persist}
            disabled={save.saving || drafts.length === 0}
          >
            <Check size={13} />
            {save.saving ? "Saving…" : "Save stages"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
