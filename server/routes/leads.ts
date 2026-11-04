import { all, get, run, transaction } from "../db.ts"

import {
  badRequest,
  HttpError,
  notFound,
  readJsonBody,
  type RequestContext,
} from "../http.ts"

import { requireAuth, requirePermission, writeAudit } from "../middleware.ts"

import { newId } from "../crypto.ts"

import { emitEvent } from "../webhooks.ts"

import {
  DEFAULT_LEAD_STAGES,
  LEAD_CAMPAIGN_MAX,
  LEAD_EMAIL_MAX,
  LEAD_INTEREST_MAX,
  LEAD_LOST_REASON_MAX,
  LEAD_NAME_MAX,
  LEAD_NOTE_MAX,
  LEAD_PHONE_MAX,
  LEAD_SOURCE_MAX,
  LEAD_STAGE_LABEL_MAX,
  LEAD_STAGE_MAX,
  type LeadStatus,
} from "../../shared/leads.ts"

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

const PHONE_PATTERN = /^[+\d(][\d\s().-]*\d$/

type LeadRow = {
  id: string

  tenant_id: string

  full_name: string

  phone: string

  email: string | null

  source: string

  campaign: string | null

  project_interest: string | null

  budget_min: number | null

  budget_max: number | null

  assigned_agent_id: string | null

  assigned_agent_name: string | null

  assigned_dealer_id: string | null

  assigned_dealer_name: string | null

  status: string

  follow_up_date: string | null

  lost_reason: string | null

  customer_id: string | null

  created_at: string

  updated_at: string
}

const LEAD_SELECT = `
  SELECT l.id, l.tenant_id, l.full_name, l.phone, l.email, l.source,
         l.campaign, l.project_interest, l.budget_min, l.budget_max,
         l.assigned_agent_id, u.full_name AS assigned_agent_name,
         l.assigned_dealer_id, d.company_name AS assigned_dealer_name,
         l.status, l.follow_up_date, l.lost_reason, l.customer_id,
         l.created_at, l.updated_at
    FROM leads l
    LEFT JOIN users u ON u.id = l.assigned_agent_id AND u.tenant_id = l.tenant_id
    LEFT JOIN dealers d ON d.id = l.assigned_dealer_id AND d.tenant_id = l.tenant_id
`

function toLead(row: LeadRow) {
  return {
    id: row.id,

    name: row.full_name,

    phone: row.phone,

    email: row.email,

    source: row.source,

    campaign: row.campaign,

    projectInterest: row.project_interest,

    budgetMin: row.budget_min,

    budgetMax: row.budget_max,

    assignedAgentId: row.assigned_agent_id,

    assignedAgentName: row.assigned_agent_name,

    assignedDealerId: row.assigned_dealer_id,

    assignedDealerName: row.assigned_dealer_name,

    status: isLeadStatus(row.status) ? row.status : "new",

    followUpDate: row.follow_up_date,

    lostReason: row.lost_reason,

    customerId: row.customer_id,

    createdAt: row.created_at,

    updatedAt: row.updated_at,
  }
}

function isLeadStatus(value: unknown): value is LeadStatus {
  return typeof value === "string" && /^[a-z0-9_]{1,48}$/.test(value)
}

function nullableText(
  value: unknown,
  key: string,
  max: number,
  errors: Record<string, string>,
): string | null {
  if (value === undefined || value === null || value === "") return null

  if (typeof value !== "string") {
    errors[key] = "Enter text."

    return null
  }

  const normalized = value.trim()

  if (normalized.length > max) errors[key] = `Use ${max} characters or fewer.`

  return normalized || null
}

function requiredText(
  value: unknown,
  key: string,
  max: number,
  label: string,
  errors: Record<string, string>,
): string {
  if (typeof value !== "string" || value.trim() === "") {
    errors[key] = `${label} is required.`

    return ""
  }

  const normalized = value.trim()

  if (normalized.length > max) errors[key] = `Use ${max} characters or fewer.`

  return normalized
}

function readAmount(
  value: unknown,
  key: string,
  errors: Record<string, string>,
): number | null {
  if (value === undefined || value === null || value === "") return null

  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    errors[key] = "Enter a whole amount of zero or more."

    return null
  }

  return value
}

interface LeadValues {
  name: string

  phone: string

  email: string | null

  source: string

  campaign: string | null

  projectInterest: string | null

  budgetMin: number | null

  budgetMax: number | null

  assignedAgentId: string | null

  assignedDealerId: string | null

  status: LeadStatus

  followUpDate: string | null

  lostReason: string | null
}

interface LeadBuildResult {
  values: LeadValues
  errors: Record<string, string>
}

interface LeadAgentRow {
  id: string
  name: string
  role: string
}

interface LeadStageRow {
  id: string
  key: string
  label: string
  tone: "neutral" | "success" | "warning" | "info" | "danger"
  sortOrder: number
  isBuiltin: boolean
}

interface LeadStageDbRow {
  id: string
  stage_key: string
  label: string
  tone: LeadStageRow["tone"]
  sort_order: number
  is_builtin: number
}

interface LeadActivityDbRow {
  id: string
  activity_type: string
  body: string
  from_stage: string | null
  to_stage: string | null
  actor_user_id: string | null
  actor_name: string
  created_at: string
}

interface LeadStageCurrentRow {
  id: string
  stage_key: string
  label: string
  sort_order: number
}

interface LeadStageDeleteRow {
  stage_key: string
  is_builtin: number
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return (
    !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
  )
}

function ensureLeadStages(tenantId: string): void {
  const stamp = new Date().toISOString()
  for (const [index, stage] of DEFAULT_LEAD_STAGES.entries()) {
    run(
      `INSERT OR IGNORE INTO lead_stages (
        id, tenant_id, stage_key, label, tone, sort_order, is_builtin, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      `stage_${tenantId}_${stage.key}`,
      tenantId,
      stage.key,
      stage.label,
      stage.tone,
      index,
      stamp,
      stamp,
    )
  }
}

function listStageRows(tenantId: string): LeadStageRow[] {
  ensureLeadStages(tenantId)
  return all<LeadStageDbRow>(
    `SELECT id, stage_key, label, tone, sort_order, is_builtin
       FROM lead_stages WHERE tenant_id = ? ORDER BY sort_order, id`,
    tenantId,
  ).map((row) => ({
    id: row.id,
    key: row.stage_key,
    label: row.label,
    tone: row.tone,
    sortOrder: row.sort_order,
    isBuiltin: row.is_builtin === 1,
  }))
}

function buildLead(
  body: Record<string, unknown>,
  tenantId: string,
  current?: LeadRow,
): LeadBuildResult {
  ensureLeadStages(tenantId)

  const errors: Record<string, string> = {}

  const existing: Record<string, unknown> = current
    ? {
        name: current.full_name,

        phone: current.phone,

        email: current.email,

        source: current.source,

        campaign: current.campaign,

        projectInterest: current.project_interest,

        budgetMin: current.budget_min,

        budgetMax: current.budget_max,

        assignedAgentId: current.assigned_agent_id,

        assignedDealerId: current.assigned_dealer_id,

        status: current.status,

        followUpDate: current.follow_up_date,

        lostReason: current.lost_reason,
      }
    : {}

  const sent = (key: string) =>
    body[key] === undefined && current ? existing[key] : body[key]

  const name = requiredText(sent("name"), "name", LEAD_NAME_MAX, "Name", errors)

  const phone = requiredText(
    sent("phone"),
    "phone",
    LEAD_PHONE_MAX,
    "Phone",
    errors,
  )

  if (phone && !PHONE_PATTERN.test(phone))
    errors.phone = "Enter a valid phone number."

  const emailValue = nullableText(
    sent("email"),
    "email",
    LEAD_EMAIL_MAX,
    errors,
  )

  const email = emailValue?.toLowerCase() ?? null

  if (email && !EMAIL_PATTERN.test(email))
    errors.email = "Enter a valid email address."

  const source = requiredText(
    sent("source"),
    "source",
    LEAD_SOURCE_MAX,
    "Source",
    errors,
  )

  const campaign = nullableText(
    sent("campaign"),
    "campaign",
    LEAD_CAMPAIGN_MAX,
    errors,
  )

  const projectInterest = nullableText(
    sent("projectInterest"),
    "projectInterest",
    LEAD_INTEREST_MAX,
    errors,
  )

  const budgetMin = readAmount(sent("budgetMin"), "budgetMin", errors)

  const budgetMax = readAmount(sent("budgetMax"), "budgetMax", errors)

  if (budgetMin !== null && budgetMax !== null && budgetMin > budgetMax) {
    errors.budgetMax = "Maximum budget must be at least the minimum budget."
  }

  const assignedAgentValue = sent("assignedAgentId")

  const assignedAgentId =
    assignedAgentValue === undefined ||
    assignedAgentValue === null ||
    assignedAgentValue === ""
      ? null
      : typeof assignedAgentValue === "string"
        ? assignedAgentValue
        : null

  if (
    assignedAgentValue !== undefined &&
    assignedAgentValue !== null &&
    assignedAgentValue !== "" &&
    assignedAgentId === null
  ) {
    errors.assignedAgentId = "Choose an available sales agent."
  }

  const assignedDealerValue = sent("assignedDealerId")

  const assignedDealerId =
    assignedDealerValue === undefined ||
    assignedDealerValue === null ||
    assignedDealerValue === ""
      ? null
      : typeof assignedDealerValue === "string"
        ? assignedDealerValue
        : null

  if (
    assignedDealerValue !== undefined &&
    assignedDealerValue !== null &&
    assignedDealerValue !== "" &&
    assignedDealerId === null
  ) {
    errors.assignedDealerId = "Choose an available dealer."
  }

  const statusValue = sent("status") ?? "new"

  const status = isLeadStatus(statusValue) ? statusValue : "new"

  if (!isLeadStatus(statusValue)) errors.status = "Choose a valid lead status."

  if (
    isLeadStatus(statusValue) &&
    !get(
      "SELECT id FROM lead_stages WHERE tenant_id = ? AND stage_key = ?",
      tenantId,
      statusValue,
    )
  ) {
    errors.status = "Choose a stage configured for this workspace."
  }

  const followUpDate = nullableText(
    sent("followUpDate"),
    "followUpDate",
    10,
    errors,
  )

  if (followUpDate && !isIsoDate(followUpDate)) {
    errors.followUpDate = "Enter a valid follow-up date."
  }

  const lostReason = nullableText(
    sent("lostReason"),
    "lostReason",
    LEAD_LOST_REASON_MAX,
    errors,
  )

  if (status === "lost" && !lostReason) {
    errors.lostReason = "Add a reason before moving this lead to Lost."
  }

  return {
    values: {
      name,
      phone,
      email,
      source,
      campaign,
      projectInterest,
      budgetMin,
      budgetMax,
      assignedAgentId,

      assignedDealerId,
      status,
      followUpDate,
      lostReason: status === "lost" ? lostReason : null,
    },

    errors,
  }
}

function assertAgent(tenantId: string, agentId: string | null): void {
  if (!agentId) return

  const agent = get<{ id: string }>(
    `SELECT u.id
       FROM users u
       JOIN tenant_memberships m ON m.user_id = u.id AND m.tenant_id = u.tenant_id
      WHERE u.id = ? AND u.tenant_id = ? AND u.status = 'active'
        AND m.role_id IN ('sales_agent', 'sales_manager')`,

    agentId,

    tenantId,
  )

  if (!agent)
    throw badRequest("Choose an active sales agent in this workspace.", {
      assignedAgentId: "Choose an available sales agent.",
    })
}

function assertDealer(tenantId: string, dealerId: string | null): void {
  if (!dealerId) return
  const dealer = get<{ id: string }>(
    "SELECT id FROM dealers WHERE tenant_id = ? AND id = ? AND status = 'active'",
    tenantId,
    dealerId,
  )
  if (!dealer)
    throw badRequest("Choose an active dealer in this workspace.", {
      assignedDealerId: "Choose an active dealer.",
    })
}

function requireLead(tenantId: string, id: string): LeadRow {
  const row = get<LeadRow>(
    `${LEAD_SELECT} WHERE l.tenant_id = ? AND l.id = ?`,
    tenantId,
    id,
  )

  if (!row) throw notFound("That lead does not exist")

  return row
}

function agentOptions(tenantId: string) {
  return all<LeadAgentRow>(
    `SELECT u.id, u.full_name AS name, r.label AS role
       FROM users u
       JOIN tenant_memberships m ON m.user_id = u.id AND m.tenant_id = u.tenant_id
       JOIN roles r ON r.role_id = m.role_id
      WHERE u.tenant_id = ? AND u.status = 'active'
        AND m.role_id IN ('sales_agent', 'sales_manager')
      ORDER BY u.full_name COLLATE NOCASE, u.id`,

    tenantId,
  )
}

export async function listLeads(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "leads", "view")

  const stages = listStageRows(guarded.tenantId)

  const rows = all<LeadRow>(
    `${LEAD_SELECT} WHERE l.tenant_id = ? ORDER BY l.updated_at DESC, l.full_name COLLATE NOCASE`,
    guarded.tenantId,
  )

  const leads = rows.map(toLead)

  const open = leads.filter((lead) => !["won", "lost"].includes(lead.status))

  return {
    leads,

    stages,

    agents: agentOptions(guarded.tenantId),

    sources: [...new Set(leads.map((lead) => lead.source))].sort(
      (left, right) => left.localeCompare(right),
    ),

    totals: {
      total: leads.length,

      open: open.length,

      qualified: leads.filter((lead) => lead.status === "qualified").length,

      converted: leads.filter((lead) => lead.customerId !== null).length,

      followUpsDue: leads.filter(
        (lead) =>
          !["won", "lost"].includes(lead.status) &&
          lead.followUpDate &&
          lead.followUpDate <= new Date().toISOString().slice(0, 10),
      ).length,
    },

    canCreate: guarded.can("leads", "create"),

    canEdit: guarded.can("leads", "edit"),

    canConvert:
      guarded.can("leads", "edit") && guarded.can("customers", "create"),
  }
}

function recordActivity(
  tenantId: string,
  leadId: string,
  actorUserId: string,
  actorName: string,
  activityType: string,
  body: string,
  fromStage: string | null = null,
  toStage: string | null = null,
): void {
  run(
    `INSERT INTO lead_activities (
      id, tenant_id, lead_id, activity_type, body, from_stage, to_stage,
      actor_user_id, actor_name, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    newId("act"),
    tenantId,
    leadId,
    activityType,
    body,
    fromStage,
    toStage,
    actorUserId,
    actorName,
    new Date().toISOString(),
  )
}

export async function createLead(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "leads", "create")

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const { values, errors } = buildLead(body, guarded.tenantId)

  if (Object.keys(errors).length > 0)
    throw badRequest("Check the highlighted fields", errors)

  assertAgent(guarded.tenantId, values.assignedAgentId)

  assertDealer(guarded.tenantId, values.assignedDealerId)

  const id = newId("lead")

  const stamp = new Date().toISOString()

  run(
    `INSERT INTO leads (
      id, tenant_id, full_name, phone, email, source, campaign, project_interest,
      budget_min, budget_max, assigned_agent_id, assigned_dealer_id, status, follow_up_date, lost_reason,
      created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,

    id,
    guarded.tenantId,
    values.name,
    values.phone,
    values.email,
    values.source,

    values.campaign,
    values.projectInterest,
    values.budgetMin,
    values.budgetMax,

    values.assignedAgentId,
    values.assignedDealerId,
    values.status,
    values.followUpDate,
    values.lostReason,
    guarded.userId,
    stamp,
    stamp,
  )

  recordActivity(
    guarded.tenantId,
    id,
    guarded.userId,
    guarded.session.user.fullName,
    "created",
    "Lead captured",
    null,
    values.status,
  )

  writeAudit(
    guarded,
    "lead.created",
    "lead",
    id,
    { source: values.source, status: values.status },
    ctx.ip,
  )

  // Fire-and-forget: the response has its row committed and must not wait on a
  // slow endpoint. Any delivery outcome lands in the webhook log, not here.
  void emitEvent(guarded.tenantId, "lead_created", {
    event: "lead_created",
    leadId: id,
    fullName: values.name,
    phone: values.phone,
    email: values.email,
    source: values.source,
    campaign: values.campaign,
    status: values.status,
    createdAt: stamp,
  })

  return { lead: toLead(requireLead(guarded.tenantId, id)) }
}

export async function updateLead(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "leads", "edit")

  const id = ctx.params.id

  if (!id) throw notFound("That lead does not exist")

  const existing = requireLead(guarded.tenantId, id)

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const { values, errors } = buildLead(body, guarded.tenantId, existing)

  if (Object.keys(errors).length > 0)
    throw badRequest("Check the highlighted fields", errors)

  assertAgent(guarded.tenantId, values.assignedAgentId)

  assertDealer(guarded.tenantId, values.assignedDealerId)

  const stamp = new Date().toISOString()

  run(
    `UPDATE leads SET full_name = ?, phone = ?, email = ?, source = ?, campaign = ?,
      project_interest = ?, budget_min = ?, budget_max = ?, assigned_agent_id = ?,
      assigned_dealer_id = ?, status = ?, follow_up_date = ?, lost_reason = ?, updated_at = ?
      WHERE tenant_id = ? AND id = ?`,

    values.name,
    values.phone,
    values.email,
    values.source,
    values.campaign,

    values.projectInterest,
    values.budgetMin,
    values.budgetMax,
    values.assignedAgentId,
    values.assignedDealerId,

    values.status,
    values.followUpDate,
    values.lostReason,
    stamp,
    guarded.tenantId,
    id,
  )

  if (existing.status !== values.status) {
    const oldLabel =
      listStageRows(guarded.tenantId).find(
        (stage) => stage.key === existing.status,
      )?.label ?? existing.status
    const nextLabel =
      listStageRows(guarded.tenantId).find(
        (stage) => stage.key === values.status,
      )?.label ?? values.status
    recordActivity(
      guarded.tenantId,
      id,
      guarded.userId,
      guarded.session.user.fullName,
      "stage_changed",
      `Stage changed from ${oldLabel} to ${nextLabel}`,
      existing.status,
      values.status,
    )
  }

  if (existing.follow_up_date !== values.followUpDate) {
    recordActivity(
      guarded.tenantId,
      id,
      guarded.userId,
      guarded.session.user.fullName,
      "follow_up_set",
      values.followUpDate
        ? `Follow-up scheduled for ${values.followUpDate}`
        : "Follow-up reminder cleared",
    )
  }

  if (existing.status === "lost" && values.status !== "lost") {
    recordActivity(
      guarded.tenantId,
      id,
      guarded.userId,
      guarded.session.user.fullName,
      "note_added",
      `Previous lost reason: ${existing.lost_reason ?? "Not recorded"}`,
    )
  }

  writeAudit(
    guarded,
    "lead.updated",
    "lead",
    id,
    { status: values.status },
    ctx.ip,
  )

  return { lead: toLead(requireLead(guarded.tenantId, id)) }
}

export async function getLead(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "leads", "view")
  const id = ctx.params.id
  if (!id) throw notFound("That lead does not exist")
  const lead = requireLead(guarded.tenantId, id)
  const activities = all<LeadActivityDbRow>(
    `SELECT id, activity_type, body, from_stage, to_stage, actor_user_id, actor_name, created_at
       FROM lead_activities WHERE tenant_id = ? AND lead_id = ?
      ORDER BY created_at DESC, id DESC`,
    guarded.tenantId,
    id,
  )
  return {
    lead: toLead(lead),
    activities: activities.map((activity) => ({
      id: activity.id,
      type: activity.activity_type,
      body: activity.body,
      fromStage: activity.from_stage,
      toStage: activity.to_stage,
      actorUserId: activity.actor_user_id,
      actorName: activity.actor_name,
      createdAt: activity.created_at,
    })),
    canEdit: guarded.can("leads", "edit"),
    canConvert:
      guarded.can("leads", "edit") && guarded.can("customers", "create"),
  }
}

export async function addLeadNote(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "leads", "edit")
  const id = ctx.params.id
  if (!id) throw notFound("That lead does not exist")
  requireLead(guarded.tenantId, id)
  const body = await readJsonBody<Record<string, unknown>>(ctx.req)
  const note = requiredText(body.note, "note", LEAD_NOTE_MAX, "Note", {})
  if (note === "")
    throw badRequest("Add a note before saving.", { note: "Enter a note." })
  recordActivity(
    guarded.tenantId,
    id,
    guarded.userId,
    guarded.session.user.fullName,
    "note_added",
    note,
  )
  run(
    "UPDATE leads SET updated_at = ? WHERE tenant_id = ? AND id = ?",
    new Date().toISOString(),
    guarded.tenantId,
    id,
  )
  return { ok: true }
}

export async function createLeadStage(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "leads", "edit")
  const body = await readJsonBody<Record<string, unknown>>(ctx.req)
  const errors: Record<string, string> = {}
  const label = requiredText(
    body.label,
    "label",
    LEAD_STAGE_LABEL_MAX,
    "Stage name",
    errors,
  )
  if (Object.keys(errors).length > 0)
    throw badRequest("Check the highlighted fields", errors)
  const stages = listStageRows(guarded.tenantId)
  if (stages.length >= LEAD_STAGE_MAX)
    throw badRequest(`A pipeline can have at most ${LEAD_STAGE_MAX} stages.`)
  const stageKey = `custom_${label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")}`
  if (!stageKey || stageKey.length > 48)
    throw badRequest("Use a shorter stage name.", {
      label: "Use a shorter stage name.",
    })
  const id = newId("stage")
  const stamp = new Date().toISOString()
  try {
    run(
      `INSERT INTO lead_stages (
        id, tenant_id, stage_key, label, tone, sort_order, is_builtin, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'neutral', ?, 0, ?, ?)`,
      id,
      guarded.tenantId,
      stageKey,
      label,
      stages.length,
      stamp,
      stamp,
    )
  } catch (error) {
    if (String(error).includes("UNIQUE constraint failed"))
      throw badRequest("A stage with that name already exists.", {
        label: "Choose a different name.",
      })
    throw error
  }
  writeAudit(guarded, "lead_stage.created", "lead_stage", id, { label }, ctx.ip)
  return { stages: listStageRows(guarded.tenantId) }
}

export async function updateLeadStage(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "leads", "edit")
  const id = ctx.params.stageId
  if (!id) throw notFound("That stage does not exist")
  const current = get<LeadStageCurrentRow>(
    "SELECT id, stage_key, label, sort_order FROM lead_stages WHERE tenant_id = ? AND id = ?",
    guarded.tenantId,
    id,
  )
  if (!current) throw notFound("That stage does not exist")
  const body = await readJsonBody<Record<string, unknown>>(ctx.req)
  let label = current.label
  let sortOrder = current.sort_order
  if (body.label !== undefined) {
    const errors: Record<string, string> = {}
    label = requiredText(
      body.label,
      "label",
      LEAD_STAGE_LABEL_MAX,
      "Stage name",
      errors,
    )
    if (Object.keys(errors).length > 0)
      throw badRequest("Check the highlighted fields", errors)
  }
  if (body.sortOrder !== undefined) {
    if (
      !Number.isSafeInteger(body.sortOrder) ||
      Number(body.sortOrder) < 0 ||
      Number(body.sortOrder) >= LEAD_STAGE_MAX
    )
      throw badRequest("Choose a valid stage position.", {
        sortOrder: "Choose a valid stage position.",
      })
    sortOrder = Number(body.sortOrder)
  }
  try {
    run(
      "UPDATE lead_stages SET label = ?, sort_order = ?, updated_at = ? WHERE tenant_id = ? AND id = ?",
      label,
      sortOrder,
      new Date().toISOString(),
      guarded.tenantId,
      id,
    )
  } catch (error) {
    if (String(error).includes("UNIQUE constraint failed"))
      throw badRequest("A stage with that name already exists.", {
        label: "Choose a different name.",
      })
    throw error
  }
  writeAudit(
    guarded,
    "lead_stage.updated",
    "lead_stage",
    id,
    { label, sortOrder },
    ctx.ip,
  )
  return { stages: listStageRows(guarded.tenantId) }
}

export async function deleteLeadStage(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "leads", "edit")
  const id = ctx.params.stageId
  if (!id) throw notFound("That stage does not exist")
  const stage = get<LeadStageDeleteRow>(
    "SELECT stage_key, is_builtin FROM lead_stages WHERE tenant_id = ? AND id = ?",
    guarded.tenantId,
    id,
  )
  if (!stage) throw notFound("That stage does not exist")
  if (stage.is_builtin === 1)
    throw badRequest("Built-in stages cannot be removed.")
  const usage = get<{ count: number }>(
    "SELECT count(*) AS count FROM leads WHERE tenant_id = ? AND status = ?",
    guarded.tenantId,
    stage.stage_key,
  )
  if ((usage?.count ?? 0) > 0)
    throw badRequest("Move the leads in this stage before removing it.")
  run(
    "DELETE FROM lead_stages WHERE tenant_id = ? AND id = ?",
    guarded.tenantId,
    id,
  )
  writeAudit(
    guarded,
    "lead_stage.deleted",
    "lead_stage",
    id,
    { key: stage.stage_key },
    ctx.ip,
  )
  return { stages: listStageRows(guarded.tenantId) }
}

export async function convertLeadToCustomer(ctx: RequestContext) {
  const guarded = requirePermission(
    requirePermission(requireAuth(ctx), "leads", "edit"),
    "customers",
    "create",
  )
  const id = ctx.params.id
  if (!id) throw notFound("That lead does not exist")
  const lead = requireLead(guarded.tenantId, id)
  if (lead.status !== "won")
    throw badRequest("Only a Won lead can be converted to a customer.")
  if (lead.customer_id)
    throw badRequest("This lead has already been converted.")

  const customerId = newId("cus")
  const stamp = new Date().toISOString()
  transaction(() => {
    run(
      `INSERT INTO customers (
        id, tenant_id, source_lead_id, full_name, phone, email, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      customerId,
      guarded.tenantId,
      id,
      lead.full_name,
      lead.phone,
      lead.email,
      stamp,
      stamp,
    )
    run(
      "UPDATE leads SET customer_id = ?, updated_at = ? WHERE tenant_id = ? AND id = ?",
      customerId,
      stamp,
      guarded.tenantId,
      id,
    )
    recordActivity(
      guarded.tenantId,
      id,
      guarded.userId,
      guarded.session.user.fullName,
      "converted",
      "Converted to customer",
      "won",
      "won",
    )
  })
  writeAudit(
    guarded,
    "lead.converted",
    "customer",
    customerId,
    { leadId: id },
    ctx.ip,
  )
  return {
    customer: {
      id: customerId,
      name: lead.full_name,
      phone: lead.phone,
      email: lead.email,
      sourceLeadId: id,
      createdAt: stamp,
    },
  }
}

/** Reserved for authenticated bulk import and external lead capture integrations. */

export async function importLeadsPlaceholder(ctx: RequestContext) {
  requirePermission(requireAuth(ctx), "leads", "create")

  throw new HttpError(
    501,
    "not_implemented",
    "Bulk import and external lead capture are not available yet.",
  )
}
