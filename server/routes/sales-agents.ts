import { all, get, isUniqueViolation, run } from "../db.ts"

import {
  badRequest,
  conflict,
  notFound,
  readJsonBody,
  type RequestContext,
} from "../http.ts"

import { requireAuth, requirePermission, writeAudit } from "../middleware.ts"

import { newId } from "../crypto.ts"

interface SalesTeamRow {
  id: string

  name: string

  manager_user_id: string | null

  manager_name: string | null

  member_count: number
}

interface SalesAgentRow {
  id: string

  full_name: string

  email: string

  phone: string | null

  job_title: string | null

  team_id: string | null

  team_name: string | null

  assigned_leads: number

  leads_achieved: number

  leads_target: number | null

  bookings_target: number | null

  collections_target: number | null
}

interface SalesManagerOption {
  id: string

  name: string

  role: string
}

interface TeamInputValues {
  name: string

  managerUserId: string | null
}

interface TargetValues {
  leadsTarget: number | null

  bookingsTarget: number | null

  collectionsTarget: number | null
}

interface MonthBounds {
  start: string
  end: string
}

interface ExistingTeamFields {
  name: string
  manager_user_id: string | null
}

const MAX_TEAM_NAME = 80

function monthKey(value: string | null): string {
  const candidate = value ?? new Date().toISOString().slice(0, 7)

  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(candidate)) {
    throw badRequest("Choose a valid target month.", { month: "Use YYYY-MM." })
  }

  return candidate
}

function monthBounds(month: string): MonthBounds {
  const [year, monthNumber] = month.split("-").map(Number)

  return {
    start: new Date(Date.UTC(year!, monthNumber! - 1, 1)).toISOString(),

    end: new Date(Date.UTC(year!, monthNumber!, 1)).toISOString(),
  }
}

function listTeams(tenantId: string): SalesTeamRow[] {
  return all<SalesTeamRow>(
    `SELECT t.id, t.name, t.manager_user_id,
            u.full_name AS manager_name,
            (SELECT count(*) FROM sales_team_members tm
              JOIN users member ON member.id = tm.user_id AND member.tenant_id = tm.tenant_id
              JOIN tenant_memberships membership
                ON membership.user_id = member.id AND membership.tenant_id = member.tenant_id
             WHERE tm.tenant_id = t.tenant_id AND tm.team_id = t.id
               AND member.status = 'active' AND membership.role_id = 'sales_agent') AS member_count
       FROM sales_teams t
       LEFT JOIN users u ON u.id = t.manager_user_id AND u.tenant_id = t.tenant_id
      WHERE t.tenant_id = ? ORDER BY t.name COLLATE NOCASE, t.id`,

    tenantId,
  )
}

function managerOptions(tenantId: string): SalesManagerOption[] {
  return all<SalesManagerOption>(
    `SELECT u.id, u.full_name AS name, r.label AS role
       FROM users u
       JOIN tenant_memberships m ON m.tenant_id = u.tenant_id AND m.user_id = u.id
       JOIN roles r ON r.role_id = m.role_id
      WHERE u.tenant_id = ? AND u.status = 'active'
        AND m.role_id IN ('sales_manager', 'tenant_admin')
      ORDER BY u.full_name COLLATE NOCASE`,

    tenantId,
  )
}

export async function listSalesAgents(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "sales_agents", "view")

  const month = monthKey(ctx.query.get("month"))

  const currency = get<{ currency: string }>(
    "SELECT currency FROM tenants WHERE id = ?",
    guarded.tenantId,
  )?.currency

  if (!currency) throw notFound("That workspace does not exist")

  const { start, end } = monthBounds(month)

  const agents = all<SalesAgentRow>(
    `SELECT u.id, u.full_name, u.email, u.phone, u.job_title,
            tm.team_id, t.name AS team_name,
            (SELECT count(*) FROM leads l
              WHERE l.tenant_id = u.tenant_id AND l.assigned_agent_id = u.id) AS assigned_leads,
            (SELECT count(*) FROM leads l
              WHERE l.tenant_id = u.tenant_id AND l.assigned_agent_id = u.id
                AND l.created_at >= ? AND l.created_at < ?) AS leads_achieved,
            target.leads_target, target.bookings_target, target.collections_target
       FROM users u
       JOIN tenant_memberships m ON m.tenant_id = u.tenant_id AND m.user_id = u.id
       LEFT JOIN sales_team_members tm ON tm.tenant_id = u.tenant_id AND tm.user_id = u.id
       LEFT JOIN sales_teams t ON t.tenant_id = tm.tenant_id AND t.id = tm.team_id
       LEFT JOIN sales_agent_targets target
         ON target.tenant_id = u.tenant_id AND target.user_id = u.id AND target.period_month = ?
      WHERE u.tenant_id = ? AND u.status = 'active' AND m.role_id = 'sales_agent'
      ORDER BY COALESCE(t.name, 'zzzz'), u.full_name COLLATE NOCASE, u.id`,

    start,

    end,

    month,

    guarded.tenantId,
  )

  return {
    month,

    currency,

    agents: agents.map((agent) => ({
      id: agent.id,

      name: agent.full_name,

      email: agent.email,

      phone: agent.phone,

      jobTitle: agent.job_title,

      teamId: agent.team_id,

      teamName: agent.team_name,

      assignedLeads: agent.assigned_leads,

      leadsAchieved: agent.leads_achieved,

      leadsTarget: agent.leads_target,

      bookingsClosed: null,

      bookingsTarget: agent.bookings_target,

      collectionsMade: null,

      collectionsTarget: agent.collections_target,
    })),

    teams: listTeams(guarded.tenantId).map((team) => ({
      id: team.id,

      name: team.name,

      managerUserId: team.manager_user_id,

      managerName: team.manager_name,

      memberCount: team.member_count,
    })),

    managers: managerOptions(guarded.tenantId),

    canManage: guarded.can("sales_agents", "edit"),

    canCreateTeam: guarded.can("sales_agents", "create"),
  }
}

function parseTeam(
  body: Record<string, unknown>,
  current?: ExistingTeamFields,
): TeamInputValues {
  const nameValue =
    body.name === undefined && current ? current.name : body.name

  if (
    typeof nameValue !== "string" ||
    nameValue.trim() === "" ||
    nameValue.trim().length > MAX_TEAM_NAME
  ) {
    throw badRequest("Enter a team name.", {
      name: `Use 1 to ${MAX_TEAM_NAME} characters.`,
    })
  }

  const managerValue =
    body.managerUserId === undefined && current
      ? current.manager_user_id
      : body.managerUserId

  const managerUserId =
    managerValue === "" || managerValue === null || managerValue === undefined
      ? null
      : typeof managerValue === "string"
        ? managerValue
        : null

  if (
    managerValue !== null &&
    managerValue !== undefined &&
    managerValue !== "" &&
    managerUserId === null
  ) {
    throw badRequest("Choose a valid team manager.", {
      managerUserId: "Choose an active sales manager or tenant administrator.",
    })
  }

  return { name: nameValue.trim(), managerUserId }
}

function assertTeamManager(tenantId: string, userId: string | null): void {
  if (!userId) return

  const manager = get<{ id: string }>(
    `SELECT u.id FROM users u
       JOIN tenant_memberships m ON m.user_id = u.id AND m.tenant_id = u.tenant_id
      WHERE u.id = ? AND u.tenant_id = ? AND u.status = 'active'
        AND m.role_id IN ('sales_manager', 'tenant_admin')`,

    userId,

    tenantId,
  )

  if (!manager)
    throw badRequest(
      "Choose an active sales manager or tenant administrator.",
      { managerUserId: "Choose a valid team manager." },
    )
}

export async function createSalesTeam(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "sales_agents", "create")

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const values = parseTeam(body)

  assertTeamManager(guarded.tenantId, values.managerUserId)

  const id = newId("team")

  const stamp = new Date().toISOString()

  try {
    run(
      "INSERT INTO sales_teams (id, tenant_id, name, manager_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",

      id,

      guarded.tenantId,

      values.name,

      values.managerUserId,

      stamp,

      stamp,
    )
  } catch (error) {
    if (isUniqueViolation(error))
      throw conflict("A team with that name already exists.", {
        name: "Choose another team name.",
      })

    throw error
  }

  writeAudit(
    guarded,
    "sales_team.created",
    "sales_team",
    id,
    { name: values.name },
    ctx.ip,
  )

  return { teams: listTeams(guarded.tenantId) }
}

export async function updateSalesTeam(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "sales_agents", "edit")

  const id = ctx.params.teamId

  if (!id) throw notFound("That sales team does not exist")

  const current = get<{
    id: string
    name: string
    manager_user_id: string | null
  }>(
    "SELECT id, name, manager_user_id FROM sales_teams WHERE tenant_id = ? AND id = ?",

    guarded.tenantId,

    id,
  )

  if (!current) throw notFound("That sales team does not exist")

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const values = parseTeam(body, current)

  assertTeamManager(guarded.tenantId, values.managerUserId)

  try {
    run(
      "UPDATE sales_teams SET name = ?, manager_user_id = ?, updated_at = ? WHERE tenant_id = ? AND id = ?",

      values.name,

      values.managerUserId,

      new Date().toISOString(),

      guarded.tenantId,

      id,
    )
  } catch (error) {
    if (isUniqueViolation(error))
      throw conflict("A team with that name already exists.", {
        name: "Choose another team name.",
      })

    throw error
  }

  writeAudit(
    guarded,
    "sales_team.updated",
    "sales_team",
    id,
    { name: values.name },
    ctx.ip,
  )

  return { teams: listTeams(guarded.tenantId) }
}

function requireAgent(tenantId: string, agentId: string): void {
  const agent = get<{ id: string }>(
    `SELECT u.id FROM users u
       JOIN tenant_memberships m ON m.user_id = u.id AND m.tenant_id = u.tenant_id
      WHERE u.id = ? AND u.tenant_id = ? AND u.status = 'active' AND m.role_id = 'sales_agent'`,

    agentId,

    tenantId,
  )

  if (!agent) throw notFound("That sales agent does not exist")
}

export async function assignAgentToTeam(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "sales_agents", "edit")

  const agentId = ctx.params.agentId

  if (!agentId) throw notFound("That sales agent does not exist")

  requireAgent(guarded.tenantId, agentId)

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const teamId = body.teamId === null || body.teamId === "" ? null : body.teamId

  if (teamId !== null && typeof teamId !== "string")
    throw badRequest("Choose a valid sales team.")

  if (teamId !== null) {
    const team = get<{ id: string }>(
      "SELECT id FROM sales_teams WHERE tenant_id = ? AND id = ?",
      guarded.tenantId,
      teamId,
    )

    if (!team) throw notFound("That sales team does not exist")

    run(
      `INSERT INTO sales_team_members (tenant_id, user_id, team_id, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (tenant_id, user_id) DO UPDATE SET team_id = excluded.team_id, created_at = excluded.created_at`,

      guarded.tenantId,

      agentId,

      teamId,

      new Date().toISOString(),
    )
  } else {
    run(
      "DELETE FROM sales_team_members WHERE tenant_id = ? AND user_id = ?",
      guarded.tenantId,
      agentId,
    )
  }

  writeAudit(
    guarded,
    "sales_agent.team_changed",
    "user",
    agentId,
    { teamId },
    ctx.ip,
  )

  return { ok: true }
}

function readTarget(value: unknown, field: string): number | null {
  if (value === undefined || value === null || value === "") return null

  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw badRequest("Targets must be whole numbers of zero or greater.", {
      [field]: "Enter a whole number of zero or greater.",
    })
  }

  return value
}

export async function saveAgentTargets(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "sales_agents", "edit")

  const agentId = ctx.params.agentId

  if (!agentId) throw notFound("That sales agent does not exist")

  requireAgent(guarded.tenantId, agentId)

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const month = monthKey(typeof body.month === "string" ? body.month : null)

  const targets: TargetValues = {
    leadsTarget: readTarget(body.leadsTarget, "leadsTarget"),

    bookingsTarget: readTarget(body.bookingsTarget, "bookingsTarget"),

    collectionsTarget: readTarget(body.collectionsTarget, "collectionsTarget"),
  }

  const stamp = new Date().toISOString()

  run(
    `INSERT INTO sales_agent_targets (
       tenant_id, user_id, period_month, leads_target, bookings_target,
       collections_target, updated_at, updated_by
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (tenant_id, user_id, period_month) DO UPDATE SET
       leads_target = excluded.leads_target,
       bookings_target = excluded.bookings_target,
       collections_target = excluded.collections_target,
       updated_at = excluded.updated_at,
       updated_by = excluded.updated_by`,

    guarded.tenantId,

    agentId,

    month,

    targets.leadsTarget,

    targets.bookingsTarget,

    targets.collectionsTarget,

    stamp,

    guarded.userId,
  )

  writeAudit(
    guarded,
    "sales_agent.targets_updated",
    "user",
    agentId,
    { month, ...targets },
    ctx.ip,
  )

  return { month, targets }
}
