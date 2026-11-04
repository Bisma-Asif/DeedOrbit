/**
 * Typed client for the project structure endpoints.
 *
 * Split from `projects-api.ts` for the same reason that file is split from
 * `api.ts`: the structure tree has its own vocabulary and its own shapes, and
 * keeping them apart means the project contract stays readable on its own.
 *
 * The server returns a FLAT list of nodes, not a nested tree, and that is
 * deliberate. Reordering is expressed as "move this node one step up", which is a
 * question about a node's siblings and is answered far more simply from a flat
 * list; the client then assembles the hierarchy for display. Nested server-side
 * would mean the response changed shape every time a node moved.
 *
 * `childCount` arrives with each node rather than being counted by the client, so
 * the "has children, cannot delete" rule is decided from one response and cannot
 * disagree with the list the user is looking at.
 */

import type { StructureNodeKind } from "@shared/projects"

import { api } from "./api"

export interface ProjectStructureNode {
  id: string
  /** Null when the node sits directly under the project. */
  parentId: string | null
  kind: StructureNodeKind | null
  name: string
  sortOrder: number
  childCount: number
  createdAt: string
  updatedAt: string
}

export interface ProjectStructureResponse {
  nodes: ProjectStructureNode[]
  canEdit: boolean
}

/** A node plus its resolved children, built by the panel for rendering. */
export interface StructureTreeNode extends ProjectStructureNode {
  children: StructureTreeNode[]
}

export interface CreateStructureNodeInput {
  name: string
  kind: StructureNodeKind
  parentId?: string | null
}

/** Rename sends the name; changing the kind is optional and independent. */
export interface RenameStructureNodeInput {
  name: string
  kind?: StructureNodeKind
}

export type StructureMoveDirection = "up" | "down"

interface NodePayload {
  node: ProjectStructureNode
}

interface DeletedPayload {
  deleted: { id: string }
}

/**
 * Assembles a flat node list into a tree, sorted by `sortOrder` then name.
 *
 * Two malformed shapes have to be survived without hanging the tab:
 *
 *  * A node whose `parentId` is missing from the list — a hand-edited row, or a
 *    partially failed read. It is promoted to a root rather than dropped, so a
 *    broken chain shows up as a slightly wrong tree instead of a silently
 *    shorter one.
 *
 *  * A cycle in `parentId`, which the API cannot produce but a hand-edited
 *    database can. `built` memoises each node as it is assembled, so a repeat is
 *    returned as-is instead of recursed into. Note the honest consequence: a
 *    cycle is unreachable from any root, so it renders as nothing at all.
 */
export function buildStructureTree(
  nodes: ProjectStructureNode[],
): StructureTreeNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node]))

  const childIds = new Map<string, string[]>()
  const rootIds: string[] = []

  for (const node of nodes) {
    if (node.parentId === null || !byId.has(node.parentId)) {
      rootIds.push(node.id)
      continue
    }

    const siblings = childIds.get(node.parentId)
    if (siblings) siblings.push(node.id)
    else childIds.set(node.parentId, [node.id])
  }

  const compare = (a: ProjectStructureNode, b: ProjectStructureNode) =>
    a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)

  const bySortOrder = (a: string, b: string) =>
    compare(byId.get(a)!, byId.get(b)!)

  for (const ids of childIds.values()) ids.sort(bySortOrder)
  rootIds.sort(bySortOrder)

  const built = new Map<string, StructureTreeNode>()

  const attach = (id: string): StructureTreeNode | null => {
    const memo = built.get(id)
    if (memo) return memo

    const node = byId.get(id)
    if (!node) return null

    const entry: StructureTreeNode = { ...node, children: [] }
    built.set(id, entry)

    for (const childId of childIds.get(id) ?? []) {
      const child = attach(childId)
      if (child) entry.children.push(child)
    }

    return entry
  }

  const roots: StructureTreeNode[] = []

  for (const id of rootIds) {
    const root = attach(id)
    if (root) roots.push(root)
  }

  return roots
}

/** Total nodes at and below a list — used for the tree's running summary. */
export function countStructureNodes(nodes: StructureTreeNode[]): number {
  return nodes.reduce(
    (total, node) => total + 1 + countStructureNodes(node.children),
    0,
  )
}

/** How many levels the deepest branch reaches, for the same summary. */
export function structureDepth(nodes: StructureTreeNode[]): number {
  let deepest = 0

  const walk = (list: StructureTreeNode[], level: number) => {
    if (list.length === 0) return

    deepest = Math.max(deepest, level)

    for (const node of list) walk(node.children, level + 1)
  }

  walk(nodes, 1)

  return deepest
}

export const projectStructureApi = {
  list: (projectId: string, signal?: AbortSignal) =>
    api.get<ProjectStructureResponse>(
      `/api/projects/${projectId}/structure`,
      signal,
    ),

  create: (projectId: string, input: CreateStructureNodeInput) =>
    api.post<NodePayload>(`/api/projects/${projectId}/structure`, input),

  rename: (
    projectId: string,
    nodeId: string,
    input: RenameStructureNodeInput,
  ) =>
    api.patch<NodePayload>(
      `/api/projects/${projectId}/structure/${nodeId}`,
      input,
    ),

  move: (
    projectId: string,
    nodeId: string,
    direction: StructureMoveDirection,
  ) =>
    api.patch<NodePayload>(
      `/api/projects/${projectId}/structure/${nodeId}/move`,
      { direction },
    ),

  remove: (projectId: string, nodeId: string) =>
    api.delete<DeletedPayload>(
      `/api/projects/${projectId}/structure/${nodeId}`,
    ),
}
