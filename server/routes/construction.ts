/**
 * The construction module: contractors, phases, tasks, and the site-progress
 * log.
 *
 * Money is never stored here. A phase's actuals are derived on every read by
 * summing the approved/paid expenses and the non-void vendor invoices tagged
 * against the phase or one of its tasks (task-tagged rows count once, at the
 * task). Amounts group by currency: an invoice in a currency other than the
 * phase budget's is reported as a separate `foreignActuals` line, never
 * folded into the budget's number.
 *
 * Progress carries the same honesty: `derived` is the rollup of the phase's
 * tasks (milestones weighted double), `manual` is the manager's latest site
 * figure, and the view says which one is in play. No tasks and no manual
 * figure reads as null — a dash, not a zero.
 *
 * Deletion is deliberately narrow. A phase carrying tagged spend cannot be
 * deleted (the evidence stays), and an unspent one cascades cleanly;
 * contractors archive rather than vanish, because tasks name them.
 */

import { all, get, run, transaction } from "../db.ts"

import {
  badRequest,
  notFound,
  readJsonBody,
  type RequestContext,
} from "../http.ts"

import {
  loadScoped,
  requireAuth,
  requirePermission,
  writeAudit,
} from "../middleware.ts"

import {
  CONTRACTOR_TRADE_LABELS,
  MONEY_MAX,
  NOTE_MAX,
  PHASE_NAME_MAX,
  PHASE_STATUS_LABELS,
  TASK_NAME_MAX,
  isContractorTrade,
  isPhaseStatus,
  isTaskStatus,
  isValidProgress,
  type ConstructionContractorView,
  type ConstructionPhaseDetail,
  type ConstructionPhaseView,
  type ConstructionProgressLogView,
  type ConstructionTaskView,
  type CurrencyAmount,
  type ProgressMode,
} from "../../shared/construction.ts"

const now = () => new Date().toISOString()

function idFor(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`
}

function tenantCurrency(tenantId: string): string {
  return (
    get<{ currency: string }>(
      "SELECT currency FROM tenants WHERE id = ?",

      tenantId,
    )?.currency ?? "AED"
  )
}

function projectName(tenantId: string, projectId: string): string | null {
  return (
    get<{ name: string }>(
      "SELECT name FROM projects WHERE tenant_id = ? AND id = ?",

      tenantId,

      projectId,
    )?.name ?? null
  )
}

/**
 * Trimmed uppercase ISO code, or the tenant's own currency when the caller
 * left it out. A malformed code is a validation error, not a silent default.
 */

function currencyOf(
  value: unknown,

  tenantId: string,

  field: string,

  errors: Record<string, string>,
): string {
  if (value === undefined || value === null || value === "") {
    return tenantCurrency(tenantId)
  }

  const text = String(value).trim().toUpperCase()

  if (!/^[A-Z]{3}$/.test(text)) {
    errors[field] = "Use a three-letter currency code, e.g. AED."

    return tenantCurrency(tenantId)
  }

  return text
}

function bounded(
  value: unknown,

  max: number,

  field: string,

  errors: Record<string, string>,
): string | null {
  if (typeof value !== "string") return null

  const trimmed = value.trim()

  if (trimmed === "") return null

  if (trimmed.length > max) {
    errors[field] = `Use ${max} characters or fewer.`

    return null
  }

  return trimmed
}

/** A planned/stored whole number within the module's money bounds. */

function moneyOf(
  value: unknown,

  field: string,

  errors: Record<string, string>,
): number | null {
  if (value === undefined || value === null || value === "") return null

  const amount = Number(value)

  if (!Number.isSafeInteger(amount) || amount < 1 || amount > MONEY_MAX) {
    errors[field] = "Use a whole amount between 1 and the platform maximum."

    return null
  }

  return amount
}

function dateOf(
  value: unknown,

  field: string,

  errors: Record<string, string>,
): string | null {
  if (value === undefined || value === null || value === "") return null

  const text = String(value).trim()

  if (!/^\d{4}-\d{2}-\d{2}/.test(text)) {
    errors[field] = "Use an ISO date, e.g. 2026-03-01."

    return null
  }

  return text
}

// --- Derived spend ------------------------------------------------------------

/**
 * Tagged spend for one scope, grouped by currency. `phaseId` matches rows
 * tagged to the phase directly or to any task inside it; `taskId` matches
 * exactly that task. Task-level rows are included in the phase sum through
 * the OR, counted once.
 */

function taggedSpend(where: {
  phaseId?: string

  taskId?: string
}): CurrencyAmount[] {
  const clauses: string[] = []

  const params: Array<string | number> = []

  if (where.phaseId) {
    clauses.push(
      "(construction_phase_id = ? OR construction_task_id IN (SELECT id FROM construction_tasks WHERE phase_id = ?))",
    )

    params.push(where.phaseId, where.phaseId)
  }

  if (where.taskId) {
    clauses.push("construction_task_id = ?")

    params.push(where.taskId)
  }

  if (clauses.length === 0) return []

  const tagFilter = clauses.join(" OR ")

  const rows = all<CurrencyAmount>(
    `SELECT currency, SUM(amount) AS amount FROM expenses
       WHERE status IN ('approved', 'paid') AND (${tagFilter})
       GROUP BY currency
     UNION ALL
     SELECT currency, SUM(amount) AS amount FROM vendor_invoices
      WHERE status <> 'void' AND (${tagFilter})
       GROUP BY currency`,

    ...params,

    ...params,
  )

  const byCurrency = new Map<string, number>()

  for (const row of rows) {
    byCurrency.set(
      row.currency,
      (byCurrency.get(row.currency) ?? 0) + Number(row.amount),
    )
  }

  return [...byCurrency.entries()]

    .map(([currency, amount]) => ({ currency, amount }))

    .sort((a, b) => a.currency.localeCompare(b.currency))
}

/** Derived progress: task mean with milestones weighted double. */

interface ProgressWeightRow {
  weighted: number | null

  weight: number | null
}

function deriveProgress(phaseId: string): number | null {
  const row = get<ProgressWeightRow>(
    `SELECT SUM(progress * CASE WHEN milestone = 1 THEN 2 ELSE 1 END) AS weighted,
            SUM(CASE WHEN milestone = 1 THEN 2 ELSE 1 END) AS weight
       FROM construction_tasks WHERE phase_id = ?`,

    phaseId,
  )

  if (!row?.weight) return null

  return Math.round(Number(row.weighted ?? 0) / Number(row.weight))
}

// --- Contractors ---------------------------------------------------------------

type ContractorRow = {
  id: string

  tenant_id: string

  vendor_id: string | null

  name: string

  trade: string

  contact_name: string | null

  email: string | null

  phone: string | null

  notes: string | null

  status: string

  created_at: string

  open_task_count: number
}

const CONTRACTOR_SELECT = `
  SELECT c.*,
         (SELECT COUNT(*) FROM construction_tasks t
           WHERE t.tenant_id = c.tenant_id AND t.contractor_id = c.id
             AND t.status <> 'completed') AS open_task_count
    FROM construction_contractors c
`

function toContractor(row: ContractorRow): ConstructionContractorView {
  return {
    id: row.id,

    name: row.name,

    trade: row.trade,

    tradeLabel:
      CONTRACTOR_TRADE_LABELS[
        (row.trade as keyof typeof CONTRACTOR_TRADE_LABELS)
      ] ?? row.trade,

    vendorId: row.vendor_id,

    contactName: row.contact_name,

    email: row.email,

    phone: row.phone,

    notes: row.notes,

    status: row.status,

    createdAt: row.created_at,

    openTaskCount: Number(row.open_task_count),
  }
}

/** GET /api/construction/contractors */

export async function listContractors(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "construction", "view")

  const rows = all<ContractorRow>(
    `${CONTRACTOR_SELECT} WHERE c.tenant_id = ? ORDER BY c.name COLLATE NOCASE ASC`,

    guarded.tenantId,
  )

  return {
    contractors: rows.map(toContractor),

    canManage: guarded.can("construction", "create"),
  }
}

/** POST /api/construction/contractors */

export async function createContractor(ctx: RequestContext) {
  const guarded = requirePermission(
    requireAuth(ctx),

    "construction",

    "create",
  )

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const errors: Record<string, string> = {}

  const name = typeof body.name === "string" ? body.name.trim() : ""

  if (name === "") errors.name = "Name this contractor."
  else if (name.length > 120) errors.name = "Use 120 characters or fewer."

  const trade = typeof body.trade === "string" ? body.trade : "general"

  if (!isContractorTrade(trade)) errors.trade = "Pick one of the listed trades."

  const contactName = bounded(body.contactName, NOTE_MAX, "contactName", errors)

  const email = bounded(body.email, NOTE_MAX, "email", errors)

  const phone = bounded(body.phone, NOTE_MAX, "phone", errors)

  const notes = bounded(body.notes, NOTE_MAX, "notes", errors)

  const vendorId =
    typeof body.vendorId === "string" && body.vendorId !== ""
      ? body.vendorId
      : null

  if (Object.keys(errors).length > 0) {
    throw badRequest("Check the highlighted fields", errors)
  }

  if (vendorId) {
    const vendor = get<{ id: string }>(
      "SELECT id FROM vendors WHERE tenant_id = ? AND id = ?",

      guarded.tenantId,

      vendorId,
    )

    if (!vendor) {
      throw badRequest(
        "Link a vendor from your own workspace, or leave it blank.",
        {
          vendorId: "That vendor does not exist here.",
        },
      )
    }
  }

  const duplicate = get<{ id: string }>(
    `SELECT id FROM construction_contractors
      WHERE tenant_id = ? AND name = ? COLLATE NOCASE`,

    guarded.tenantId,

    name,
  )

  if (duplicate) {
    throw badRequest("A contractor with that name already exists.", {
      name: "Pick a different name or edit the existing contractor.",
    })
  }

  const id = idFor("con")

  run(
    `INSERT INTO construction_contractors (
        id, tenant_id, vendor_id, name, trade, contact_name, email, phone,
        notes, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,

    id,

    guarded.tenantId,

    vendorId,

    name,

    trade,

    contactName,

    email,

    phone,

    notes,

    now(),
  )

  writeAudit(
    guarded,
    "construction.contractor.create",
    "construction_contractor",
    id,
    { name, trade },
    ctx.ip,
  )

  const row = get<ContractorRow>(
    `${CONTRACTOR_SELECT} WHERE c.tenant_id = ? AND c.id = ?`,

    guarded.tenantId,

    id,
  )!

  return { contractor: toContractor(row) }
}

/** PATCH /api/construction/contractors/:id — fields and archive flag. */

export async function updateContractor(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "construction", "edit")

  const existing = loadScoped<ContractorRow>(
    guarded,

    "construction_contractors",

    ctx.params.contractorId!,

    "contractor",
  )

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const errors: Record<string, string> = {}

  const name =
    typeof body.name === "string" && body.name.trim() !== ""
      ? body.name.trim()
      : existing.name

  if (name.length > 120) errors.name = "Use 120 characters or fewer."

  const trade = typeof body.trade === "string" ? body.trade : existing.trade

  if (!isContractorTrade(trade)) errors.trade = "Pick one of the listed trades."

  const contactName = bounded(
    body.contactName ?? undefined,

    NOTE_MAX,

    "contactName",

    errors,
  )

  const email = bounded(body.email ?? undefined, NOTE_MAX, "email", errors)

  const phone = bounded(body.phone ?? undefined, NOTE_MAX, "phone", errors)

  const notes = bounded(body.notes ?? undefined, NOTE_MAX, "notes", errors)

  const requestedStatus =
    typeof body.status === "string" ? body.status : existing.status

  if (requestedStatus !== "active" && requestedStatus !== "archived") {
    errors.status = "A contractor is active or archived."
  }

  // Archiving with open work is a foot-gun the platform refuses rather than

  // warns about; the task list is the evidence.

  if (existing.status === "active" && requestedStatus === "archived") {
    const open = get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM construction_tasks
        WHERE tenant_id = ? AND contractor_id = ? AND status <> 'completed'`,

      guarded.tenantId,

      existing.id,
    )

    if (Number(open?.n ?? 0) > 0) {
      errors.status = "Reassign or complete its open tasks before archiving."
    }
  }

  if (Object.keys(errors).length > 0) {
    throw badRequest("Check the highlighted fields", errors)
  }

  run(
    `UPDATE construction_contractors
        SET name = ?, trade = ?, contact_name = ?, email = ?, phone = ?,
            notes = ?, status = ?
      WHERE tenant_id = ? AND id = ?`,

    name,

    trade,

    contactName ?? existing.contact_name,

    email ?? existing.email,

    phone ?? existing.phone,

    notes ?? existing.notes,

    requestedStatus,

    guarded.tenantId,

    existing.id,
  )

  writeAudit(
    guarded,

    "construction.contractor.edit",

    "construction_contractor",

    existing.id,

    { name, status: requestedStatus },

    ctx.ip,
  )

  const row = get<ContractorRow>(
    `${CONTRACTOR_SELECT} WHERE c.tenant_id = ? AND c.id = ?`,

    guarded.tenantId,

    existing.id,
  )!

  return { contractor: toContractor(row) }
}

// --- Phases -----------------------------------------------------------------------

type PhaseRow = {
  id: string

  tenant_id: string

  project_id: string

  name: string

  sequence: number

  status: string

  planned_start: string | null

  planned_end: string | null

  budget_amount: number | null

  budget_currency: string | null

  manual_progress: number | null

  created_at: string

  task_count: number

  milestone_count: number

  milestone_done_count: number

  contractor_names: string | null
}

const PHASE_SELECT = `
  SELECT p.*,
         (SELECT COUNT(*) FROM construction_tasks t WHERE t.phase_id = p.id) AS task_count,
         (SELECT COUNT(*) FROM construction_tasks t WHERE t.phase_id = p.id AND t.milestone = 1) AS milestone_count,
         (SELECT COUNT(*) FROM construction_tasks t WHERE t.phase_id = p.id AND t.milestone = 1 AND t.status = 'completed') AS milestone_done_count,
         (SELECT GROUP_CONCAT(DISTINCT c.name) FROM construction_tasks t
            JOIN construction_contractors c ON c.id = t.contractor_id
           WHERE t.phase_id = p.id) AS contractor_names
    FROM construction_phases p
`

function toPhaseView(row: PhaseRow): ConstructionPhaseView {
  const actual = taggedSpend({ phaseId: row.id })

  const budgetCurrency = row.budget_currency

  const inBudgetCurrency =
    budgetCurrency == null
      ? []
      : actual.filter((slice) => slice.currency === budgetCurrency)

  const foreignActuals =
    budgetCurrency == null
      ? actual
      : actual.filter((slice) => slice.currency !== budgetCurrency)

  const budgetAmount = row.budget_amount

  const actualInBudget = inBudgetCurrency.reduce(
    (sum, slice) => sum + slice.amount,

    0,
  )

  const derived = deriveProgress(row.id)

  const manual = row.manual_progress

  // Tasks win when they exist; the manager's figure only speaks where there

  // is nothing to roll up. The mode travels with the number so the screen

  // can label it.

  const progressMode: ProgressMode =
    row.task_count > 0 ? "derived" : manual != null ? "manual" : "none"

  const progress =
    progressMode === "derived"
      ? derived
      : progressMode === "manual"
        ? manual
        : null

  return {
    id: row.id,

    projectId: row.project_id,

    projectName: projectName(row.tenant_id, row.project_id) ?? "—",

    name: row.name,

    sequence: Number(row.sequence),

    status: row.status,

    plannedStart: row.planned_start,

    plannedEnd: row.planned_end,

    budgetAmount,

    budgetCurrency,

    actualByCurrency: inBudgetCurrency,

    foreignActuals,

    variance: budgetAmount == null ? null : budgetAmount - actualInBudget,

    taskCount: Number(row.task_count),

    milestoneCount: Number(row.milestone_count),

    milestoneDoneCount: Number(row.milestone_done_count),

    derivedProgress: derived,

    manualProgress: manual,

    progressMode,

    progress,

    contractorNames: row.contractor_names
      ? row.contractor_names.split(",")
      : [],

    createdAt: row.created_at,
  }
}

/** GET /api/construction/phases?projectId= */

export async function listPhases(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "construction", "view")

  const projectId = ctx.query.get("projectId") ?? ""

  const clauses = ["p.tenant_id = ?"]

  const params: Array<string | number> = [guarded.tenantId]

  if (projectId) {
    clauses.push("p.project_id = ?")

    params.push(projectId)
  }

  const rows = all<PhaseRow>(
    `${PHASE_SELECT} WHERE ${clauses.join(" AND ")}
      ORDER BY p.project_id, p.sequence, p.created_at`,

    ...params,
  )

  return {
    phases: rows.map(toPhaseView),

    statusLabels: PHASE_STATUS_LABELS,

    canCreate: guarded.can("construction", "create"),

    canEdit: guarded.can("construction", "edit"),
  }
}

/** POST /api/construction/phases */

export async function createPhase(ctx: RequestContext) {
  const guarded = requirePermission(
    requireAuth(ctx),

    "construction",

    "create",
  )

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const errors: Record<string, string> = {}

  const projectId =
    typeof body.projectId === "string" ? body.projectId.trim() : ""

  const project = projectId
    ? get<{ id: string }>(
        "SELECT id FROM projects WHERE tenant_id = ? AND id = ?",

        guarded.tenantId,

        projectId,
      )
    : undefined

  if (!project) errors.projectId = "Pick a project from your workspace."

  const name = typeof body.name === "string" ? body.name.trim() : ""

  if (name === "") errors.name = "Name this phase."
  else if (name.length > PHASE_NAME_MAX)
    errors.name = `Use ${PHASE_NAME_MAX} characters or fewer.`

  const plannedStart = dateOf(body.plannedStart, "plannedStart", errors)

  const plannedEnd = dateOf(body.plannedEnd, "plannedEnd", errors)

  let budgetAmount: number | null = null

  let budgetCurrency: string | null = null

  if (
    body.budgetAmount !== undefined &&
    body.budgetAmount !== null &&
    body.budgetAmount !== ""
  ) {
    budgetAmount = moneyOf(body.budgetAmount, "budgetAmount", errors)

    budgetCurrency = currencyOf(
      body.budgetCurrency,
      guarded.tenantId,
      "budgetCurrency",
      errors,
    )
  }

  const sequence = Number(body.sequence)

  const sequenceValue =
    Number.isSafeInteger(sequence) && sequence >= 1 ? sequence : null

  if (Object.keys(errors).length > 0) {
    throw badRequest("Check the highlighted fields", errors)
  }

  const id = idFor("phs")

  const stamp = now()

  run(
    `INSERT INTO construction_phases (
        id, tenant_id, project_id, name, sequence, status, planned_start,
        planned_end, budget_amount, budget_currency, created_by_user_id, created_at
      ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)`,

    id,

    guarded.tenantId,

    projectId,

    name,

    sequenceValue
      ? sequenceValue
      : Number(
          get<{ n: number }>(
            "SELECT COUNT(*) AS n FROM construction_phases WHERE tenant_id = ? AND project_id = ?",

            guarded.tenantId,

            projectId,
          )?.n ?? 0,
        ) + 1,

    plannedStart,

    plannedEnd,

    budgetAmount,

    budgetCurrency,

    guarded.userId,

    stamp,
  )

  writeAudit(
    guarded,
    "construction.phase.create",
    "construction_phase",
    id,
    { name, projectId },
    ctx.ip,
  )

  return { phase: toPhaseView(loadPhaseRow(guarded.tenantId, id)!) }
}

function loadPhaseRow(tenantId: string, id: string): PhaseRow | undefined {
  return get<PhaseRow>(
    `${PHASE_SELECT} WHERE p.tenant_id = ? AND p.id = ?`,

    tenantId,

    id,
  )
}

type TaskRow = {
  id: string

  tenant_id: string

  phase_id: string

  name: string

  description: string | null

  sequence: number

  status: string

  milestone: number

  planned_start: string | null

  planned_end: string | null

  actual_start: string | null

  actual_end: string | null

  contractor_id: string | null

  contractor_name: string | null

  assignee_user_id: string | null

  assignee_name: string | null

  budget_amount: number | null

  progress: number
}

const TASK_SELECT = `
  SELECT t.*, c.name AS contractor_name,
         (SELECT u.full_name FROM users u WHERE u.id = t.assignee_user_id) AS assignee_name
    FROM construction_tasks t
    LEFT JOIN construction_contractors c ON c.id = t.contractor_id
`

function toTaskView(row: TaskRow): ConstructionTaskView {
  return {
    id: row.id,

    phaseId: row.phase_id,

    name: row.name,

    description: row.description,

    sequence: Number(row.sequence),

    status: row.status,

    milestone: row.milestone === 1,

    plannedStart: row.planned_start,

    plannedEnd: row.planned_end,

    actualStart: row.actual_start,

    actualEnd: row.actual_end,

    contractorId: row.contractor_id,

    contractorName: row.contractor_name,

    assigneeName: row.assignee_name,

    budgetAmount: row.budget_amount,

    progress: Number(row.progress),

    actualByCurrency: taggedSpend({ taskId: row.id }),
  }
}

/** GET /api/construction/phases/:id — detail with rollups and the log. */

export async function getPhase(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "construction", "view")

  const row = loadPhaseRow(guarded.tenantId, ctx.params.phaseId!)

  if (!row) throw notFound("That phase does not exist")

  const tasks = all<TaskRow>(
    `${TASK_SELECT} WHERE t.tenant_id = ? AND t.phase_id = ?
      ORDER BY t.sequence, t.created_at`,

    guarded.tenantId,

    row.id,
  )

  const progressLog = all<{
    id: string

    task_id: string | null

    percent: number

    note: string | null

    actor_name: string

    created_at: string
  }>(
    `SELECT id, task_id, percent, note, actor_name, created_at
       FROM construction_progress_logs
      WHERE tenant_id = ? AND phase_id = ?
      ORDER BY created_at DESC, rowid DESC`,

    guarded.tenantId,

    row.id,
  )

  const detail: ConstructionPhaseDetail = {
    phase: toPhaseView(row),

    tasks: tasks.map(toTaskView),

    progressLog: progressLog.map(
      (log): ConstructionProgressLogView => ({
        id: log.id,

        phaseId: row.id,

        taskId: log.task_id,

        percent: Number(log.percent),

        note: log.note,

        actorName: log.actor_name,

        createdAt: log.created_at,
      }),
    ),

    canEdit: guarded.can("construction", "edit"),
  }

  return detail
}

/** PATCH /api/construction/phases/:id — plan, budget, status, manual figure. */

export async function updatePhase(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "construction", "edit")

  const existing = loadScoped<PhaseRow>(
    guarded,

    "construction_phases",

    ctx.params.phaseId!,

    "phase",
  )

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const errors: Record<string, string> = {}

  const name =
    typeof body.name === "string" && body.name.trim() !== ""
      ? body.name.trim()
      : existing.name

  if (name.length > PHASE_NAME_MAX)
    errors.name = `Use ${PHASE_NAME_MAX} characters or fewer.`

  const status = typeof body.status === "string" ? body.status : existing.status

  if (!isPhaseStatus(status)) errors.status = "Pick one of the listed statuses."

  const plannedStart =
    body.plannedStart === undefined
      ? existing.planned_start
      : dateOf(body.plannedStart, "plannedStart", errors)

  const plannedEnd =
    body.plannedEnd === undefined
      ? existing.planned_end
      : dateOf(body.plannedEnd, "plannedEnd", errors)

  let budgetAmount = existing.budget_amount

  let budgetCurrency = existing.budget_currency

  if (body.budgetAmount !== undefined) {
    if (body.budgetAmount === null || body.budgetAmount === "") {
      budgetAmount = null

      budgetCurrency = null
    } else {
      budgetAmount = moneyOf(body.budgetAmount, "budgetAmount", errors)

      budgetCurrency = currencyOf(
        body.budgetCurrency,

        guarded.tenantId,

        "budgetCurrency",

        errors,
      )
    }
  }

  let manualProgress = existing.manual_progress

  if (body.manualProgress !== undefined) {
    if (body.manualProgress === null || body.manualProgress === "") {
      manualProgress = null
    } else if (!isValidProgress(body.manualProgress)) {
      errors.manualProgress = "Use a whole percent between 0 and 100."
    } else {
      manualProgress = body.manualProgress
    }
  }

  if (Object.keys(errors).length > 0) {
    throw badRequest("Check the highlighted fields", errors)
  }

  run(
    `UPDATE construction_phases
        SET name = ?, status = ?, planned_start = ?, planned_end = ?,
            budget_amount = ?, budget_currency = ?, manual_progress = ?
      WHERE tenant_id = ? AND id = ?`,

    name,

    status,

    plannedStart,

    plannedEnd,

    budgetAmount,

    budgetCurrency,

    manualProgress,

    guarded.tenantId,

    existing.id,
  )

  writeAudit(
    guarded,

    "construction.phase.edit",

    "construction_phase",

    existing.id,

    { name, status, manualProgress },

    ctx.ip,
  )

  return { phase: toPhaseView(loadPhaseRow(guarded.tenantId, existing.id)!) }
}

/** DELETE /api/construction/phases/:id — only while nothing was tagged. */

export async function deletePhase(ctx: RequestContext) {
  const guarded = requirePermission(
    requireAuth(ctx),

    "construction",

    "delete",
  )

  const phase = loadScoped<PhaseRow>(
    guarded,

    "construction_phases",

    ctx.params.phaseId!,

    "phase",
  )

  const spend = get<{ n: number }>(
    `SELECT (
        (SELECT COUNT(*) FROM expenses WHERE construction_phase_id = ?
           OR construction_task_id IN (SELECT id FROM construction_tasks WHERE phase_id = ?)) +
        (SELECT COUNT(*) FROM vendor_invoices WHERE construction_phase_id = ?
           OR construction_task_id IN (SELECT id FROM construction_tasks WHERE phase_id = ?))
       ) AS n`,

    phase.id,

    phase.id,

    phase.id,

    phase.id,
  )

  if (Number(spend?.n ?? 0) > 0) {
    throw badRequest("This phase carries tagged spend.", {
      phaseId:
        "Archive it by setting its status instead — the money trail stays.",
    })
  }

  transaction(() => {
    run(
      "DELETE FROM construction_progress_logs WHERE phase_id = ?",

      phase.id,
    )

    run("DELETE FROM construction_tasks WHERE phase_id = ?", phase.id)

    run("DELETE FROM construction_phases WHERE id = ?", phase.id)
  })

  writeAudit(
    guarded,
    "construction.phase.delete",
    "construction_phase",
    phase.id,
    { name: phase.name },
    ctx.ip,
  )

  return { ok: true }
}

/** POST /api/construction/phases/:id/log-progress — the site report. */

export async function logPhaseProgress(ctx: RequestContext) {
  const guarded = requirePermission(
    requireAuth(ctx),

    "construction",

    "edit",
  )

  const phase = loadScoped<PhaseBase>(
    guarded,

    "construction_phases",

    ctx.params.phaseId!,

    "phase",
  )

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const errors: Record<string, string> = {}

  if (!isValidProgress(body.percent)) {
    errors.percent = "Use a whole percent between 0 and 100."
  }

  const note = bounded(body.note, NOTE_MAX, "note", errors)

  const taskId =
    typeof body.taskId === "string" && body.taskId !== "" ? body.taskId : null

  if (taskId) {
    const task = get<{ id: string }>(
      "SELECT id FROM construction_tasks WHERE tenant_id = ? AND id = ? AND phase_id = ?",

      guarded.tenantId,

      taskId,

      phase.id,
    )

    if (!task) errors.taskId = "That task is not part of this phase."
  }

  if (Object.keys(errors).length > 0) {
    throw badRequest("Check the highlighted fields", errors)
  }

  const id = idFor("pgl")

  const stamp = now()

  const actorName = guarded.session.user.fullName

  transaction(() => {
    run(
      `INSERT INTO construction_progress_logs (
          id, tenant_id, phase_id, task_id, percent, note, actor_user_id,
          actor_name, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,

      id,

      guarded.tenantId,

      phase.id,

      taskId,

      body.percent as number,

      note,

      guarded.userId,

      actorName,

      stamp,
    )

    // The log entry is the fact; the phase column is what the list screens

    // read as "current site progress", so both move together.

    run(
      "UPDATE construction_phases SET manual_progress = ? WHERE id = ?",

      body.percent as number,

      phase.id,
    )
  })

  writeAudit(
    guarded,

    "construction.phase.log_progress",

    "construction_phase",

    phase.id,

    { percent: body.percent, taskId },

    ctx.ip,
  )

  return { phase: toPhaseView(loadPhaseRow(guarded.tenantId, phase.id)!) }
}

// --- Tasks ---------------------------------------------------------------------------

/** POST /api/construction/phases/:id/tasks */

export async function createTask(ctx: RequestContext) {
  const guarded = requirePermission(
    requireAuth(ctx),

    "construction",

    "create",
  )

  const phase = loadScoped<PhaseBase>(
    guarded,

    "construction_phases",

    ctx.params.phaseId!,

    "phase",
  )

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const errors: Record<string, string> = {}

  const name = typeof body.name === "string" ? body.name.trim() : ""

  if (name === "") errors.name = "Name this task."
  else if (name.length > TASK_NAME_MAX)
    errors.name = `Use ${TASK_NAME_MAX} characters or fewer.`

  const description = bounded(body.description, NOTE_MAX, "description", errors)

  const plannedStart = dateOf(body.plannedStart, "plannedStart", errors)

  const plannedEnd = dateOf(body.plannedEnd, "plannedEnd", errors)

  const milestone = body.milestone === true || body.milestone === 1

  const budgetAmount = moneyOf(body.budgetAmount, "budgetAmount", errors)

  const contractorId =
    typeof body.contractorId === "string" && body.contractorId !== ""
      ? body.contractorId
      : null

  if (contractorId) {
    const contractor = get<{ id: string }>(
      "SELECT id FROM construction_contractors WHERE tenant_id = ? AND id = ?",

      guarded.tenantId,

      contractorId,
    )

    if (!contractor)
      errors.contractorId = "Pick a contractor from your workspace."
  }

  if (Object.keys(errors).length > 0) {
    throw badRequest("Check the highlighted fields", errors)
  }

  const id = idFor("tsk")

  const sequence = Number(body.sequence)

  run(
    `INSERT INTO construction_tasks (
        id, tenant_id, phase_id, name, description, sequence, status,
        milestone, planned_start, planned_end, contractor_id, budget_amount,
        progress, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, 0, ?)`,

    id,

    guarded.tenantId,

    phase.id,

    name,

    description,

    Number.isSafeInteger(sequence) && sequence >= 1
      ? sequence
      : Number(
          get<{ n: number }>(
            "SELECT COUNT(*) AS n FROM construction_tasks WHERE phase_id = ?",

            phase.id,
          )?.n ?? 0,
        ) + 1,

    milestone ? 1 : 0,

    plannedStart,

    plannedEnd,

    contractorId,

    budgetAmount,

    now(),
  )

  writeAudit(
    guarded,
    "construction.task.create",
    "construction_task",
    id,
    { name, phaseId: phase.id },
    ctx.ip,
  )

  const row = get<TaskRow>(
    `${TASK_SELECT} WHERE t.tenant_id = ? AND t.id = ?`,

    guarded.tenantId,

    id,
  )!

  return { task: toTaskView(row) }
}

/** PATCH /api/construction/tasks/:id — status, progress, assignment, dates. */

export async function updateTask(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "construction", "edit")

  const existing = loadScoped<TaskRow>(
    guarded,

    "construction_tasks",

    ctx.params.taskId!,

    "task",
  )

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const errors: Record<string, string> = {}

  const name =
    typeof body.name === "string" && body.name.trim() !== ""
      ? body.name.trim()
      : existing.name

  if (name.length > TASK_NAME_MAX)
    errors.name = `Use ${TASK_NAME_MAX} characters or fewer.`

  const description = bounded(
    body.description ?? undefined,

    NOTE_MAX,

    "description",

    errors,
  )

  const status = typeof body.status === "string" ? body.status : existing.status

  if (!isTaskStatus(status)) errors.status = "Pick one of the listed statuses."

  let progress = Number(existing.progress)

  if (body.progress !== undefined) {
    if (!isValidProgress(body.progress)) {
      errors.progress = "Use a whole percent between 0 and 100."
    } else {
      progress = body.progress
    }
  }

  // The status and the percent are one story: a completed task is at 100,

  // and leaving one refuses the mismatch rather than storing two truths.

  if (status === "completed" && progress !== 100) {
    if (body.progress === undefined) {
      progress = 100
    } else {
      errors.progress = "A completed task must read 100%."
    }
  }

  const contractorId =
    body.contractorId === null || body.contractorId === ""
      ? null
      : typeof body.contractorId === "string"
        ? body.contractorId
        : existing.contractor_id

  if (contractorId && contractorId !== existing.contractor_id) {
    const contractor = get<{ id: string }>(
      "SELECT id FROM construction_contractors WHERE tenant_id = ? AND id = ?",

      guarded.tenantId,

      contractorId,
    )

    if (!contractor)
      errors.contractorId = "Pick a contractor from your workspace."
  }

  const assigneeUserId =
    body.assigneeUserId === null || body.assigneeUserId === ""
      ? null
      : typeof body.assigneeUserId === "string"
        ? body.assigneeUserId
        : (existing.assignee_user_id ?? null)

  if (assigneeUserId && assigneeUserId !== existing.assignee_user_id) {
    const member = get<{ id: string }>(
      "SELECT id FROM users WHERE tenant_id = ? AND id = ?",

      guarded.tenantId,

      assigneeUserId,
    )

    if (!member) errors.assigneeUserId = "Assign to a member of your workspace."
  }

  const plannedStart =
    body.plannedStart === undefined
      ? existing.planned_start
      : dateOf(body.plannedStart, "plannedStart", errors)

  const plannedEnd =
    body.plannedEnd === undefined
      ? existing.planned_end
      : dateOf(body.plannedEnd, "plannedEnd", errors)

  const actualStart =
    body.actualStart === undefined
      ? existing.actual_start
      : dateOf(body.actualStart, "actualStart", errors)

  const actualEnd =
    body.actualEnd === undefined
      ? existing.actual_end
      : dateOf(body.actualEnd, "actualEnd", errors)

  const milestone =
    body.milestone === undefined
      ? existing.milestone === 1
      : body.milestone === true || body.milestone === 1

  const budgetAmount =
    body.budgetAmount === undefined
      ? existing.budget_amount
      : body.budgetAmount === null || body.budgetAmount === ""
        ? null
        : moneyOf(body.budgetAmount, "budgetAmount", errors)

  if (Object.keys(errors).length > 0) {
    throw badRequest("Check the highlighted fields", errors)
  }

  run(
    `UPDATE construction_tasks
        SET name = ?, description = ?, status = ?, progress = ?,
            contractor_id = ?, assignee_user_id = ?, planned_start = ?,
            planned_end = ?, actual_start = ?, actual_end = ?, milestone = ?,
            budget_amount = ?
      WHERE tenant_id = ? AND id = ?`,

    name,

    description ?? existing.description,

    status,

    progress,

    contractorId,

    assigneeUserId,

    plannedStart,

    plannedEnd,

    actualStart,

    actualEnd,

    milestone ? 1 : 0,

    budgetAmount,

    guarded.tenantId,

    existing.id,
  )

  writeAudit(
    guarded,
    "construction.task.edit",
    "construction_task",
    existing.id,
    { name, status, progress },
    ctx.ip,
  )

  const row = get<TaskRow>(
    `${TASK_SELECT} WHERE t.tenant_id = ? AND t.id = ?`,

    guarded.tenantId,

    existing.id,
  )!

  return { task: toTaskView(row) }
}

/** DELETE /api/construction/tasks/:id — only while nothing was tagged. */

export async function deleteTask(ctx: RequestContext) {
  const guarded = requirePermission(
    requireAuth(ctx),

    "construction",

    "delete",
  )

  const task = loadScoped<TaskBase>(
    guarded,

    "construction_tasks",

    ctx.params.taskId!,

    "task",
  )

  const spend = get<{ n: number }>(
    `SELECT (
        (SELECT COUNT(*) FROM expenses WHERE construction_task_id = ?) +
        (SELECT COUNT(*) FROM vendor_invoices WHERE construction_task_id = ?)
       ) AS n`,

    task.id,

    task.id,
  )

  if (Number(spend?.n ?? 0) > 0) {
    throw badRequest("This task carries tagged spend.", {
      taskId: "Keep it and set its status — the money trail stays.",
    })
  }

  transaction(() => {
    run("DELETE FROM construction_progress_logs WHERE task_id = ?", task.id)

    run("DELETE FROM construction_tasks WHERE id = ?", task.id)
  })

  writeAudit(
    guarded,
    "construction.task.delete",
    "construction_task",
    task.id,
    { name: task.name },
    ctx.ip,
  )

  return { ok: true }
}

/** The plain stored rows, as `loadScoped` reads them before any join. */

type PhaseBase = {
  id: string

  tenant_id: string

  project_id: string

  name: string

  sequence: number

  status: string

  planned_start: string | null

  planned_end: string | null

  budget_amount: number | null

  budget_currency: string | null

  manual_progress: number | null

  created_at: string
}

type TaskBase = {
  id: string

  tenant_id: string

  phase_id: string

  name: string

  status: string

  progress: number

  contractor_id: string | null

  assignee_user_id: string | null
}
