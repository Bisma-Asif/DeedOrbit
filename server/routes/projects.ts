/**
 * Projects — the root commercial record.
 *
 * A project answers "what is being developed, by whom, and when does it open".
 * Every other trading module (inventory, leads, bookings) hangs off one of these
 * rows, so this file is deliberately conservative about what it will accept: a
 * project is created the moment a development is real enough to plan against,
 * long before it has a launch date or a unit count.
 *
 * The rules that matter here:
 *
 *  * Tenant scoping comes from the session, never from the request, and every
 *    statement filters on `tenant_id` regardless. A project id from another
 *    workspace is indistinguishable from one that does not exist.
 *  * `projects.view` gates reads and `projects.create` / `projects.edit` gate
 *    writes. These are separate because the seeded workspace deliberately has a
 *    role that can publish units against a project without being able to create
 *    one — a permission system that treats "create" as implied by "view" cannot
 *    express that.
 *  * Nothing is invented. A project with no launch date has `launchDate: null`
 *    and the UI shows a dash; the "launching soon" figure counts only projects
 *    that actually have a date inside the window.
 */

import { all, get, isUniqueViolation, run } from "../db.ts"

import {
  badRequest,
  conflict,
  notFound,
  readJsonBody,
  type RequestContext,
} from "../http.ts"

import { requireAuth, requirePermission, writeAudit } from "../middleware.ts"

import { readEnum, validateTextFields, type TextRule } from "../validate.ts"

import {
  CODE_MAX,
  CODE_PATTERN,
  DEVELOPER_MAX,
  DEVELOPER_MIN,
  DESCRIPTION_MAX,
  LAUNCH_SOON_DAYS,
  LOCATION_MAX,
  LOCATION_MIN,
  NAME_MAX,
  NAME_MIN,
  PROJECT_STATUSES,
  PROJECT_TYPE_LABELS,
  TERMS_MAX,
  UNITS_MAX,
  UNITS_MIN,
  isIsoDate,
  isOwnershipType,
  isProjectStatus,
  isProjectType,
  isUnitCount,
  type OwnershipType,
  type ProjectStatus,
  type ProjectType,
} from "../../shared/projects.ts"

const now = () => new Date().toISOString()

// --- Rows -------------------------------------------------------------------

type ProjectRow = {
  id: string

  tenant_id: string

  name: string

  code: string | null

  developer: string

  location: string

  status: string

  launch_date: string | null

  description: string | null

  project_type: string | null

  ownership_type: string | null

  payment_terms: string | null

  handover_date: string | null

  planned_units: number | null

  created_at: string

  updated_at: string
}

const PROJECT_SELECT = `
  SELECT p.id, p.tenant_id, p.name, p.code, p.developer, p.location, p.status,
         p.launch_date, p.description, p.project_type, p.ownership_type,
         p.payment_terms, p.handover_date, p.planned_units,
         p.created_at, p.updated_at
    FROM projects p
`

/**
 * A row is written by this module and checked by the database, so a status that
 * is not in the closed set can only come from a hand-edited row. It is narrowed
 * to the union rather than cast: a bad row would otherwise reach the UI as a
 * badge with no matching tone and render as an unstyled string.
 */

function toStatus(value: string): ProjectStatus {
  return isProjectStatus(value) ? value : "planning"
}

function toProjectType(value: string | null): ProjectType | null {
  return isProjectType(value) ? value : null
}

function toOwnershipType(value: string | null): OwnershipType | null {
  return isOwnershipType(value) ? value : null
}

function toProject(row: ProjectRow) {
  return {
    id: row.id,

    name: row.name,

    code: row.code,

    developer: row.developer,

    location: row.location,

    status: toStatus(row.status),

    launchDate: row.launch_date,

    description: row.description,

    projectType: toProjectType(row.project_type),

    ownershipType: toOwnershipType(row.ownership_type),

    paymentTerms: row.payment_terms,

    handoverDate: row.handover_date,

    plannedUnits: row.planned_units,

    createdAt: row.created_at,

    updatedAt: row.updated_at,
  }
}

function readProject(tenantId: string, id: string): ProjectRow | undefined {
  return get<ProjectRow>(
    `${PROJECT_SELECT} WHERE p.tenant_id = ? AND p.id = ?`,

    tenantId,

    id,
  )
}

function requireProject(tenantId: string, id: string): ProjectRow {
  const row = readProject(tenantId, id)

  if (!row) throw notFound("That project does not exist")

  return row
}

function listProjectRows(tenantId: string): ProjectRow[] {
  return all<ProjectRow>(
    `${PROJECT_SELECT} WHERE p.tenant_id = ? ORDER BY p.name COLLATE NOCASE`,

    tenantId,
  )
}

// --- Validation -------------------------------------------------------------

const PROJECT_RULES: readonly TextRule[] = [
  {
    key: "name",

    max: NAME_MAX,

    min: NAME_MIN,

    required: true,

    requiredError: "Name the project.",
  },

  {
    key: "code",

    max: CODE_MAX,

    pattern: CODE_PATTERN,

    patternError:
      "Use letters, digits, dots, dashes, or underscores, starting with a letter or digit.",
  },

  {
    key: "developer",

    max: DEVELOPER_MAX,

    min: DEVELOPER_MIN,

    required: true,

    requiredError: "Name the developer.",
  },

  {
    key: "location",

    max: LOCATION_MAX,

    min: LOCATION_MIN,

    required: true,

    requiredError: "Say where the project is.",
  },

  { key: "description", max: DESCRIPTION_MAX },

  { key: "paymentTerms", max: TERMS_MAX },
]

/**
 * The merged, validated values for one project.
 *
 * `name`, `developer`, and `location` are strings here even though the database
 * allows them to be written as anything: the rules above guarantee that a
 * non-empty string came back, and an empty one is a validation error before the
 * INSERT is ever reached.
 */

interface ProjectValues {
  name: string

  code: string | null

  developer: string

  location: string

  status: ProjectStatus

  launchDate: string | null

  description: string | null

  projectType: ProjectType | null

  ownershipType: OwnershipType | null

  paymentTerms: string | null

  handoverDate: string | null

  plannedUnits: number | null
}

interface ValidatedProject {
  values: ProjectValues

  errors: Record<string, string>
}

/**
 * An ISO date, or null when absent/blank/malformed.
 *
 * `sent` is the request body for the same reason as `readEnum`: a stored date
 * must not be re-validated as though the caller had just sent it.
 */

function readDate(
  sent: Record<string, unknown>,

  key: string,

  current: string | null,

  errors: Record<string, string>,

  label: string,
): string | null {
  const raw = sent[key]

  if (raw === undefined) return current

  if (raw === null || raw === "") return null

  if (!isIsoDate(raw)) {
    errors[key] = `Enter ${label} as YYYY-MM-DD.`

    return current
  }

  return raw
}

/**
 * A whole unit count, rejecting fractions, negatives, and implausible totals.
 *
 * A non-numeric string arrives as NaN from the form and is rejected here rather
 * than being silently coerced to 0, which would state a figure nobody entered.
 */

function readUnits(
  sent: Record<string, unknown>,

  current: number | null,

  errors: Record<string, string>,
): number | null {
  const raw = sent.plannedUnits

  if (raw === undefined) return current

  if (raw === null || raw === "") return null

  if (!isUnitCount(raw)) {
    errors.plannedUnits = `Use a whole number from ${UNITS_MIN} to ${UNITS_MAX}.`

    return current
  }

  return raw
}

/**
 * Validates a write against the existing row when there is one.
 *
 * Two maps are in play and mixing them up is the trap:
 *
 *  * `merged` is the stored row overlaid with the request. Text fields are
 *    validated against it, so a PATCH only needs to send what changed and can
 *    never write a half-record.
 *  * `input` is the request body alone. The closed-set and date readers use it
 *    to decide what was actually sent, because on `merged` a field the caller
 *    never mentioned is indistinguishable from one they deliberately nulled.
 *
 * `undefined` means "not sent" and is ignored; an explicit `null` or "" is a
 * deliberate clear.
 */

function buildProject(
  input: Record<string, unknown>,

  fallback: ProjectRow | null,
): ValidatedProject {
  const merged: Record<string, unknown> = {}

  if (fallback) {
    merged.name = fallback.name

    merged.code = fallback.code

    merged.developer = fallback.developer

    merged.location = fallback.location

    merged.status = fallback.status

    merged.launchDate = fallback.launch_date

    merged.description = fallback.description

    merged.projectType = fallback.project_type

    merged.ownershipType = fallback.ownership_type

    merged.paymentTerms = fallback.payment_terms

    merged.handoverDate = fallback.handover_date

    merged.plannedUnits = fallback.planned_units
  }

  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) merged[key] = value
  }

  const { values: text, errors } = validateTextFields(merged, PROJECT_RULES)

  const status = readEnum(
    input,

    "status",

    isProjectStatus,

    isProjectStatus(fallback?.status) ? fallback.status : null,
  )

  if (status.invalid) {
    errors.status = `Choose one of: ${PROJECT_STATUSES.join(", ")}.`
  }

  const projectType = readEnum(
    input,

    "projectType",

    isProjectType,

    isProjectType(fallback?.project_type) ? fallback.project_type : null,
  )

  if (projectType.invalid) {
    errors.projectType = `Choose one of: ${Object.keys(PROJECT_TYPE_LABELS).join(", ")}.`
  }

  const ownershipType = readEnum(
    input,

    "ownershipType",

    isOwnershipType,

    isOwnershipType(fallback?.ownership_type) ? fallback.ownership_type : null,
  )

  if (ownershipType.invalid) {
    errors.ownershipType = "Choose freehold or leasehold, or leave blank."
  }

  const launchDate = readDate(
    input,

    "launchDate",

    fallback?.launch_date ?? null,

    errors,

    "the launch date",
  )

  const handoverDate = readDate(
    input,

    "handoverDate",

    fallback?.handover_date ?? null,

    errors,

    "the handover date",
  )

  const plannedUnits = readUnits(input, fallback?.planned_units ?? null, errors)

  return {
    values: {
      name: text.name ?? "",

      code: text.code ?? null,

      developer: text.developer ?? "",

      location: text.location ?? "",

      // Defaulting to `planning` rather than rejecting: a new project with no

      // status is the normal case, and the only valid default is the first step.

      status: status.value ?? "planning",

      launchDate,

      description: text.description ?? null,

      projectType: projectType.value,

      ownershipType: ownershipType.value,

      paymentTerms: text.paymentTerms ?? null,

      handoverDate,

      plannedUnits,
    },

    errors,
  }
}

/**
 * Rejects a name or reference code already used in this workspace.
 *
 * The database also enforces both as unique indexes. This check exists to turn
 * a constraint violation into a message attached to the field the user can edit,
 * which is the difference between "that did not work" and "that name is taken".
 */

function assertNoProjectClash(
  tenantId: string,

  values: ProjectValues,

  selfId: string | null,
): void {
  if (values.name) {
    const clash = get<{ id: string }>(
      `SELECT id FROM projects
        WHERE tenant_id = ? AND id IS NOT ? AND name = ? COLLATE NOCASE
        LIMIT 1`,

      tenantId,

      selfId,

      values.name,
    )

    if (clash) {
      throw conflict("A project with that name already exists", {
        name: "That name is already in use",
      })
    }
  }

  if (values.code) {
    const clash = get<{ id: string }>(
      `SELECT id FROM projects
        WHERE tenant_id = ? AND id IS NOT ? AND code = ? COLLATE NOCASE
        LIMIT 1`,

      tenantId,

      selfId,

      values.code,
    )

    if (clash) {
      throw conflict("That reference is already in use", {
        code: "That reference is already in use",
      })
    }
  }
}

function projectParams(values: ProjectValues): (string | number | null)[] {
  return [
    values.name,

    values.code,

    values.developer,

    values.location,

    values.status,

    values.launchDate,

    values.description,

    values.projectType,

    values.ownershipType,

    values.paymentTerms,

    values.handoverDate,

    values.plannedUnits,
  ]
}

const PROJECT_COLUMNS =
  "name, code, developer, location, status, launch_date, description," +
  " project_type, ownership_type, payment_terms, handover_date, planned_units"

function projectAssignments(): string {
  return [
    "name = ?",

    "code = ?",

    "developer = ?",

    "location = ?",

    "status = ?",

    "launch_date = ?",

    "description = ?",

    "project_type = ?",

    "ownership_type = ?",

    "payment_terms = ?",

    "handover_date = ?",

    "planned_units = ?",
  ].join(", ")
}

/**
 * The four figures the list leads with.
 *
 * Computed from the same rows the table renders rather than in a separate
 * aggregate query. A tenant holds tens of projects, not thousands, and the
 * alternative is a KPI that can silently disagree with the table below it when
 * one of the two is written wrong.
 *
 * `plannedUnits` is null rather than 0 when no project states a figure, so the
 * tile shows a dash instead of claiming the portfolio has no units.
 */

function projectTotals(rows: ProjectRow[]) {
  const today = new Date()

  const cutoff = new Date(today.getTime() + LAUNCH_SOON_DAYS * 86_400_000)

  const todayIso = today.toISOString().slice(0, 10)

  const cutoffIso = cutoff.toISOString().slice(0, 10)

  let stated = 0

  let plannedUnits = 0

  let onSale = 0

  let launchingSoon = 0

  for (const row of rows) {
    if (row.planned_units !== null) {
      stated += 1

      plannedUnits += row.planned_units
    }

    if (row.status === "on_sale") onSale += 1

    if (
      row.status === "pre_launch" &&
      row.launch_date !== null &&
      row.launch_date >= todayIso &&
      row.launch_date <= cutoffIso
    ) {
      launchingSoon += 1
    }
  }

  return {
    total: rows.length,

    onSale,

    launchingSoon,

    plannedUnits: stated === 0 ? null : plannedUnits,
  }
}

// --- Routes -----------------------------------------------------------------

/** GET /api/projects */

export async function listProjects(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "projects", "view")

  const rows = listProjectRows(guarded.tenantId)

  return {
    projects: rows.map(toProject),

    totals: projectTotals(rows),

    canCreate: guarded.can("projects", "create"),

    canEdit: guarded.can("projects", "edit"),
  }
}

/** GET /api/projects/:id */

export async function getProject(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "projects", "view")

  const id = ctx.params.id

  if (!id) throw notFound("That project does not exist")

  const row = requireProject(guarded.tenantId, id)

  return {
    project: toProject(row),

    canEdit: guarded.can("projects", "edit"),
  }
}

/** POST /api/projects */

export async function createProject(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "projects", "create")

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const { values, errors } = buildProject(body, null)

  if (Object.keys(errors).length > 0)
    throw badRequest("Check the highlighted fields", errors)

  assertNoProjectClash(guarded.tenantId, values, null)

  const id = `prj_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`

  const stamp = now()

  try {
    run(
      `INSERT INTO projects (id, tenant_id, ${PROJECT_COLUMNS}, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,

      id,

      guarded.tenantId,

      ...projectParams(values),

      stamp,

      stamp,
    )
  } catch (error) {
    // The clash check above normally catches this first. It is reachable when

    // two requests pass that check concurrently, and a raw UNIQUE error there

    // would surface as a 500 for what is plainly a user-correctable conflict.

    if (isUniqueViolation(error)) {
      throw conflict("A project with that name or reference already exists")
    }

    throw error
  }

  writeAudit(
    guarded,

    "project.created",

    "project",

    id,

    { name: values.name, developer: values.developer, status: values.status },

    ctx.ip,
  )

  return { project: toProject(requireProject(guarded.tenantId, id)) }
}

/** PATCH /api/projects/:id */

export async function updateProject(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "projects", "edit")

  const id = ctx.params.id

  if (!id) throw notFound("That project does not exist")

  const existing = requireProject(guarded.tenantId, id)

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const { values, errors } = buildProject(body, existing)

  // Every conflict is raised before the UPDATE, so a rejected request leaves the

  // row exactly as it was.

  if (Object.keys(errors).length > 0)
    throw badRequest("Check the highlighted fields", errors)

  assertNoProjectClash(guarded.tenantId, values, id)

  if (
    existing.launch_date !== null &&
    values.launchDate !== null &&
    values.launchDate < existing.launch_date &&
    values.status === "on_sale"
  ) {
    throw conflict(
      "A project on sale cannot launch before the date already recorded",

      { launchDate: "Move the launch date forward, or set the status first" },
    )
  }

  try {
    run(
      `UPDATE projects SET ${projectAssignments()}, updated_at = ?
        WHERE tenant_id = ? AND id = ?`,

      ...projectParams(values),

      now(),

      guarded.tenantId,

      id,
    )
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw conflict("A project with that name or reference already exists")
    }

    throw error
  }

  writeAudit(
    guarded,

    "project.updated",

    "project",

    id,

    { name: values.name, status: values.status },

    ctx.ip,
  )

  return { project: toProject(requireProject(guarded.tenantId, id)) }
}
