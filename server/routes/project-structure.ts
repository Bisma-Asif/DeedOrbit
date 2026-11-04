/**
 * Project structure — the shape of a development.
 *
 * A project has no physical form until someone says what it is made of: the
 * blocks and towers, the sectors they are divided into, the floors within those.
 * This file is the editable tree of those nodes, and it is the first thing in the
 * product that is genuinely a graph rather than a flat list.
 *
 * What that changes, and the rules that follow from it:
 *
 *  * Nodes are one table with a `parent_id`, not three tables. A block, a sector
 *    and a floor are the same row with a different word on it, so they share a
 *    schema, share these routes, and need no union type at the call site.
 *
 *  * Every read is tenant-scoped, and so is every *parent* lookup. Resolving
 *    `parentId` through a plain id lookup would let a caller from one workspace
 *    graft their tree onto another workspace's node, so the parent is fetched
 *    with the same `tenant_id` filter as everything else and a miss reads as
 *    "not found" rather than "forbidden" — the caller learns nothing about rows
 *    outside their workspace.
 *
 *  * Deleting is refused for a node that has children. This is a deliberate
 *    product decision, not a technical limit: a subtree can be large and
 *    unrecoverable, and silently destroying one because a delete button was
 *    pressed is worse than making the user remove the empty nodes first. The
 *    foreign key refuses it too, so the rule holds even if this check is
 *    bypassed.
 *
 *  * Reordering is done by the server. The client sends a direction, not a list
 *    of ids: a client-supplied ordering is a second source of truth that
 *    disagrees with the database the moment anything else writes, and the
 *    sibling set is renumbered densely inside a transaction so "the node above"
 *    is never a stale guess.
 *
 * Writes all require `projects.edit`, including creating a node. They do not
 * require `projects.create`, because a tenant admin — the role that configures a
 * workspace — deliberately does not hold `projects.create`; gating structure
 * edits on it would lock the intended user out of the one screen they are meant
 * to own. See `shared/access.ts` for why that grant is shaped that way.
 */

import { all, get, isUniqueViolation, run, transaction } from "../db.ts"
import {
  badRequest,
  conflict,
  notFound,
  readJsonBody,
  type RequestContext,
} from "../http.ts"
import { requireAuth, requirePermission, writeAudit } from "../middleware.ts"
import { validateTextFields, type TextRule } from "../validate.ts"
import {
  STRUCTURE_MAX_DEPTH,
  STRUCTURE_NODE_KIND_LABELS,
  STRUCTURE_NODE_NAME_MAX,
  STRUCTURE_NODE_NAME_MIN,
  isStructureNodeKind,
  type StructureNodeKind,
} from "../../shared/projects.ts"

const now = () => new Date().toISOString()

// --- Rows -------------------------------------------------------------------

type StructureRow = {
  id: string
  tenant_id: string
  project_id: string
  parent_id: string | null
  kind: string
  name: string
  sort_order: number
  created_at: string
  updated_at: string
}

/**
 * A bad `kind` can only come from a hand-edited row — the column is `CHECK`ed
 * and the route validates before writing. It is narrowed by union rather than
 * cast so a corrupted row surfaces as a validation failure at the boundary
 * instead of an unstyled label in the tree.
 */
function toKind(value: string): StructureNodeKind | null {
  return isStructureNodeKind(value) ? value : null
}

function toNode(row: StructureRow, childCount: number) {
  return {
    id: row.id,
    parentId: row.parent_id,
    kind: toKind(row.kind),
    name: row.name,
    sortOrder: row.sort_order,
    childCount,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

// --- Reads ------------------------------------------------------------------

/**
 * Confirms the project exists in this workspace.
 *
 * Separate from the projects route's own check and deliberately duplicating it:
 * a structure node must never be readable through a project id belonging to
 * another tenant, and the cheapest way to be sure is to resolve the project with
 * the tenant filter applied before touching the tree at all.
 */
function requireScopedProject(tenantId: string, projectId: string): void {
  const row = get<{ id: string }>(
    "SELECT id FROM projects WHERE tenant_id = ? AND id = ?",
    tenantId,
    projectId,
  )
  if (!row) throw notFound("That project does not exist")
}

function readNode(
  tenantId: string,
  projectId: string,
  nodeId: string,
): StructureRow {
  const row = get<StructureRow>(
    `SELECT * FROM project_structure_nodes
      WHERE tenant_id = ? AND project_id = ? AND id = ?`,
    tenantId,
    projectId,
    nodeId,
  )
  if (!row) throw notFound("That structure node does not exist")
  return row
}

/** Direct children of a node, or the roots when `parentId` is null. */
function readSiblings(
  tenantId: string,
  projectId: string,
  parentId: string | null,
): StructureRow[] {
  return parentId === null
    ? all<StructureRow>(
        `SELECT * FROM project_structure_nodes
          WHERE tenant_id = ? AND project_id = ? AND parent_id IS NULL
          ORDER BY sort_order, name COLLATE NOCASE`,
        tenantId,
        projectId,
      )
    : all<StructureRow>(
        `SELECT * FROM project_structure_nodes
          WHERE tenant_id = ? AND project_id = ? AND parent_id = ?
          ORDER BY sort_order, name COLLATE NOCASE`,
        tenantId,
        projectId,
        parentId,
      )
}

function countChildren(tenantId: string, projectId: string, nodeId: string) {
  const row = get<{ total: number }>(
    `SELECT count(*) AS total FROM project_structure_nodes
      WHERE tenant_id = ? AND project_id = ? AND parent_id = ?`,
    tenantId,
    projectId,
    nodeId,
  )
  return row?.total ?? 0
}

// --- Validation -------------------------------------------------------------

const NODE_RULES: readonly TextRule[] = [
  {
    key: "name",
    max: STRUCTURE_NODE_NAME_MAX,
    min: STRUCTURE_NODE_NAME_MIN,
    required: true,
    requiredError: "Name this node.",
  },
]

/**
 * The parent of one node, or null when it is a root or does not exist.
 *
 * Extracted so `depthOf` can advance its cursor without the cursor's own narrowed
 * type depending on the row it is derived from — a circularity TypeScript reports
 * as TS7022 and refuses to guess at. The declared return type also gives the loop
 * a fixed shape to walk, which is what makes the depth cap below meaningful.
 */
function parentOf(
  tenantId: string,
  projectId: string,
  nodeId: string,
): string | null {
  const row = get<{ parent_id: string | null }>(
    `SELECT parent_id FROM project_structure_nodes
      WHERE tenant_id = ? AND project_id = ? AND id = ?`,
    tenantId,
    projectId,
    nodeId,
  )

  return row?.parent_id ?? null
}

/**
 * How deep a node would sit, counting the project itself as depth 0.
 *
 * Walks parents rather than counting descendants, so it is bounded by
 * `STRUCTURE_MAX_DEPTH` no matter how wide the tree is. A node directly under
 * the project is depth 1.
 *
 * The loop terminates on a malformed chain — two rows naming each other as parent
 * cannot be created through this API, but a hand-edited database can contain one,
 * and a `while` with no hop limit would hang the server rather than reject the
 * request.
 */
function depthOf(
  tenantId: string,
  projectId: string,
  parentId: string | null,
): number {
  if (parentId === null) return 1

  let depth = 1
  let cursor: string | null = parentId

  while (cursor !== null && depth <= STRUCTURE_MAX_DEPTH + 1) {
    cursor = parentOf(tenantId, projectId, cursor)
    depth += 1
  }

  return depth
}

/** Rejects a parent that does not belong to this project in this workspace. */
function requireParent(
  tenantId: string,
  projectId: string,
  parentId: string,
): void {
  const row = get<{ id: string }>(
    `SELECT id FROM project_structure_nodes
      WHERE tenant_id = ? AND project_id = ? AND id = ?`,
    tenantId,
    projectId,
    parentId,
  )
  // Same message as a missing project: a caller must not be able to probe for
  // nodes in another workspace by watching which id produces "not found".
  if (!row) throw notFound("That parent node does not exist")
}

/**
 * Rejects a name already used by a sibling.
 *
 * Checked here as well as by the unique index so the rejection arrives attached
 * to the name field, where the user can fix it, instead of as a bare 500. The
 * index is the backstop for concurrent writes; `selfId` excludes the node being
 * renamed so re-saving a name unchanged is not treated as a clash with itself.
 */
function assertNoSiblingClash(
  tenantId: string,
  projectId: string,
  parentId: string | null,
  name: string,
  selfId: string | null,
): void {
  const clash = get<{ id: string }>(
    `SELECT id FROM project_structure_nodes
      WHERE tenant_id = ?
        AND project_id = ?
        AND ifnull(parent_id, '') = ifnull(?, '')
        AND id IS NOT ?
        AND name = ? COLLATE NOCASE
      LIMIT 1`,
    tenantId,
    projectId,
    parentId,
    selfId,
    name,
  )

  if (clash) {
    throw conflict("A sibling with that name already exists", {
      name: "A sibling already uses that name",
    })
  }
}

/** Rewrites a sibling set as a dense 0..n-1 sequence in the order given. */
function renumber(
  tenantId: string,
  projectId: string,
  orderedIds: string[],
): void {
  const statement = `UPDATE project_structure_nodes
      SET sort_order = ?, updated_at = ?
    WHERE tenant_id = ? AND project_id = ? AND id = ?`

  orderedIds.forEach((id, index) => {
    run(statement, index, now(), tenantId, projectId, id)
  })
}

// --- Routes -----------------------------------------------------------------

/** GET /api/projects/:id/structure */
export async function listStructure(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "projects", "view")
  const projectId = ctx.params.id
  if (!projectId) throw notFound("That project does not exist")

  requireScopedProject(guarded.tenantId, projectId)

  const rows = all<StructureRow>(
    `SELECT * FROM project_structure_nodes
      WHERE tenant_id = ? AND project_id = ?
      ORDER BY sort_order, name COLLATE NOCASE`,
    guarded.tenantId,
    projectId,
  )

  // One grouped count rather than a query per node: the tree is rendered from
  // this response alone, so a node's child count has to arrive with it.
  const counts = new Map<string, number>()
  for (const row of rows) {
    if (row.parent_id !== null) {
      counts.set(row.parent_id, (counts.get(row.parent_id) ?? 0) + 1)
    }
  }

  return {
    // Flat, not nested. The client assembles the tree because it owns the
    // expand/collapse state, and a flat list is what reordering reasons about.
    nodes: rows.map((row) => toNode(row, counts.get(row.id) ?? 0)),
    canEdit: guarded.can("projects", "edit"),
  }
}

/** POST /api/projects/:id/structure */
export async function createStructureNode(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "projects", "edit")
  const projectId = ctx.params.id
  if (!projectId) throw notFound("That project does not exist")

  requireScopedProject(guarded.tenantId, projectId)

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)
  const { values, errors } = validateTextFields(body, NODE_RULES)

  const rawKind = body.kind
  const rawParent = body.parentId

  const KIND_CHOICES = Object.values(STRUCTURE_NODE_KIND_LABELS).join(", ")

  if (!isStructureNodeKind(rawKind)) {
    errors.kind = `Choose one of: ${KIND_CHOICES}.`
  }

  // `null` and absent both mean "directly under the project". An explicit null is
  // not an error, because that is how a client says "put this at the top level".
  let parentId: string | null = null
  if (rawParent !== undefined && rawParent !== null && rawParent !== "") {
    if (typeof rawParent !== "string") {
      errors.parentId = "That parent reference is not valid."
    } else {
      requireParent(guarded.tenantId, projectId, rawParent)
      parentId = rawParent
    }
  }

  const name = values.name ?? ""

  // Depth is only checked once everything else is clean, so the error the user
  // sees is about the thing they are actually about to fix. A name is guaranteed
  // present here because `required` would already have failed the block below.
  if (Object.keys(errors).length === 0) {
    if (depthOf(guarded.tenantId, projectId, parentId) > STRUCTURE_MAX_DEPTH) {
      throw badRequest("Check the highlighted fields", {
        parentId: `Structure is limited to ${STRUCTURE_MAX_DEPTH} levels`,
      })
    }

    assertNoSiblingClash(guarded.tenantId, projectId, parentId, name, null)
  }

  if (Object.keys(errors).length > 0)
    throw badRequest("Check the highlighted fields", errors)

  const id = `psn_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`
  const stamp = now()

  // Append to the end of its sibling set, and renumber the whole set so
  // `sort_order` stays dense. Doing this inside a transaction keeps the tree from
  // being observed mid-rewrite by a concurrent read.
  const node = transaction(() => {
    const siblings = readSiblings(guarded.tenantId, projectId, parentId)

    try {
      run(
        `INSERT INTO project_structure_nodes
           (id, tenant_id, project_id, parent_id, kind, name, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        guarded.tenantId,
        projectId,
        parentId,
        rawKind as string,
        name,
        siblings.length,
        stamp,
        stamp,
      )
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw conflict("A sibling with that name already exists", {
          name: "A sibling already uses that name",
        })
      }
      throw error
    }

    renumber(guarded.tenantId, projectId, [
      ...siblings.map((row) => row.id),
      id,
    ])

    return toNode(readNode(guarded.tenantId, projectId, id), 0)
  })

  writeAudit(
    guarded,
    "project.structure.created",
    "project_structure_node",
    id,
    { projectId, name, kind: rawKind, parentId },
    ctx.ip,
  )

  return { node }
}

/** PATCH /api/projects/:id/structure/:nodeId — rename, and change its kind. */
export async function renameStructureNode(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "projects", "edit")
  // The route spells the project segment `:id`; alias it locally so the handler
  // reads the same as the list and create handlers above.
  const { id: projectId, nodeId } = ctx.params
  if (!projectId || !nodeId)
    throw notFound("That structure node does not exist")

  requireScopedProject(guarded.tenantId, projectId)
  const existing = readNode(guarded.tenantId, projectId, nodeId)

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)
  const { values, errors } = validateTextFields(body, NODE_RULES)

  const name = values.name ?? ""

  // The kind is optional here: renaming a node must not require resending it.
  // Sending an unrecognised one is still an error rather than a silent no-op.
  let kind = toKind(existing.kind)
  if (body.kind !== undefined) {
    if (!isStructureNodeKind(body.kind)) {
      errors.kind = `Choose one of: ${Object.values(STRUCTURE_NODE_KIND_LABELS).join(", ")}.`
    } else {
      kind = body.kind
    }
  }

  if (name && Object.keys(errors).length === 0) {
    assertNoSiblingClash(
      guarded.tenantId,
      projectId,
      existing.parent_id,
      name,
      existing.id,
    )
  }

  if (Object.keys(errors).length > 0)
    throw badRequest("Check the highlighted fields", errors)

  try {
    run(
      `UPDATE project_structure_nodes
          SET name = ?, kind = ?, updated_at = ?
        WHERE tenant_id = ? AND project_id = ? AND id = ?`,
      name,
      kind ?? existing.kind,
      now(),
      guarded.tenantId,
      projectId,
      nodeId,
    )
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw conflict("A sibling with that name already exists", {
        name: "A sibling already uses that name",
      })
    }
    throw error
  }

  writeAudit(
    guarded,
    "project.structure.renamed",
    "project_structure_node",
    nodeId,
    { projectId, name, kind: kind ?? existing.kind },
    ctx.ip,
  )

  return {
    node: toNode(
      readNode(guarded.tenantId, projectId, nodeId),
      countChildren(guarded.tenantId, projectId, nodeId),
    ),
  }
}

/**
 * PATCH /api/projects/:id/structure/:nodeId/move — one step up or down.
 *
 * The client sends a direction rather than the ordering it wants. A full ordered
 * id list from the client is a second source of truth: it goes stale the moment
 * two people reorder the same tower, and the losing write silently wins. Swapping
 * on the server means the request means "move me relative to where I actually am".
 *
 * A request that would move past either end is a no-op that returns the node,
 * not an error — the button is disabled in that case, so reaching here means a
 * stale client, and failing the request would be noise.
 */
export async function moveStructureNode(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "projects", "edit")
  // The route spells the project segment `:id`; alias it locally so the handler
  // reads the same as the list and create handlers above.
  const { id: projectId, nodeId } = ctx.params
  if (!projectId || !nodeId)
    throw notFound("That structure node does not exist")

  requireScopedProject(guarded.tenantId, projectId)
  const existing = readNode(guarded.tenantId, projectId, nodeId)

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)
  const direction = body.direction

  if (direction !== "up" && direction !== "down") {
    throw badRequest("Check the highlighted fields", {
      direction: 'Say whether to move "up" or "down".',
    })
  }

  const siblings = readSiblings(guarded.tenantId, projectId, existing.parent_id)

  const index = siblings.findIndex((row) => row.id === nodeId)
  const target = direction === "up" ? index - 1 : index + 1

  if (index >= 0 && target >= 0 && target < siblings.length) {
    const reordered = [...siblings]
    const [moved] = reordered.splice(index, 1)
    reordered.splice(target, 0, moved)

    transaction(() => {
      renumber(
        guarded.tenantId,
        projectId,
        reordered.map((row) => row.id),
      )
    })
  }

  writeAudit(
    guarded,
    "project.structure.moved",
    "project_structure_node",
    nodeId,
    { projectId, direction },
    ctx.ip,
  )

  return {
    node: toNode(
      readNode(guarded.tenantId, projectId, nodeId),
      countChildren(guarded.tenantId, projectId, nodeId),
    ),
  }
}

/** DELETE /api/projects/:id/structure/:nodeId — leaves only when it is empty. */
export async function deleteStructureNode(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "projects", "edit")
  // The route spells the project segment `:id`; alias it locally so the handler
  // reads the same as the list and create handlers above.
  const { id: projectId, nodeId } = ctx.params
  if (!projectId || !nodeId)
    throw notFound("That structure node does not exist")

  requireScopedProject(guarded.tenantId, projectId)
  const existing = readNode(guarded.tenantId, projectId, nodeId)

  const children = countChildren(guarded.tenantId, projectId, nodeId)

  // The reason is stated in the message because "cannot delete" on its own tells
  // the user nothing about what to do next.
  if (children > 0) {
    throw conflict(
      children === 1
        ? "That node still has 1 child. Remove it first."
        : `That node still has ${children} children. Remove them first.`,
    )
  }

  // A node holding units is not empty either, even though it has no children. The
  // foreign key refuses the delete underneath this check, so without it the user
  // would get an unexplained 500 instead of a sentence about their inventory.
  const units =
    get<{ total: number }>(
      `SELECT count(*) AS total FROM inventory_units
      WHERE tenant_id = ? AND project_id = ? AND structure_node_id = ?`,
      guarded.tenantId,
      projectId,
      nodeId,
    )?.total ?? 0

  if (units > 0) {
    throw conflict(
      units === 1
        ? "That node still holds 1 unit. Remove it from inventory first."
        : `That node still holds ${units} units. Remove them from inventory first.`,
    )
  }

  run(
    `DELETE FROM project_structure_nodes
      WHERE tenant_id = ? AND project_id = ? AND id = ?`,
    guarded.tenantId,
    projectId,
    nodeId,
  )

  // The siblings are left with a gap in their ordering. Harmless — the next
  // insert or reorder renumbers densely — but cheap to keep tidy here.
  const siblings = readSiblings(
    guarded.tenantId,
    projectId,
    existing.parent_id,
  ).filter((row) => row.id !== nodeId)

  if (siblings.length > 0) {
    transaction(() => {
      renumber(
        guarded.tenantId,
        projectId,
        siblings.map((row) => row.id),
      )
    })
  }

  writeAudit(
    guarded,
    "project.structure.deleted",
    "project_structure_node",
    nodeId,
    { projectId, name: existing.name, kind: existing.kind },
    ctx.ip,
  )

  return { deleted: { id: nodeId } }
}
