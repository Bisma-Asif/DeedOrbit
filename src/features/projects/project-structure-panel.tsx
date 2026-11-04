/**
 * The Structure tab — the editable hierarchy inside one project.
 *
 * A flat list of nodes from the API, assembled into a tree here and drawn as an
 * indented list with a twisty per branch. It is deliberately a list and not a
 * graph or a canvas: a development is a handful of levels, and a tree the user
 * can read top to bottom is worth more than a picture of one.
 *
 * What the interactions are allowed to do is the interesting part:
 *
 *  * Adding is available on any node, to any depth, up to `STRUCTURE_MAX_DEPTH`.
 *    The server enforces the cap; the UI states it rather than hiding the option
 *    and leaving the user to wonder why.
 *
 *  * Reordering is one step up or one step down among siblings. Not drag-and-drop:
 *    a tree that reflows while it is being dragged is disorienting on a list this
 *    dense, and "move this down" is a request the server can answer authoritatively
 *    without the client sending an ordering it could get wrong.
 *
 *  * Deleting is offered only on an empty node. The server refuses it otherwise
 *    with a message naming how many children are in the way, and the menu item is
 *    disabled to match — so the rule is visible before it is hit, not after.
 *
 *  * There is no reparenting. Moving a subtree between branches is a different
 *    operation with its own consequences for whatever hangs off the leaves, and it
 *    is not something to smuggle in alongside a reorder.
 *
 * Every row action goes through the server and reloads the tree. Nothing is
 * applied optimistically: a structure is small and read constantly, so being
 * exactly right after every action matters more than saving a round trip.
 */

import { useMemo, useState } from "react"

import {
  Building2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Layers,
  MoreHorizontal,
  Pencil,
  Plus,
  Rows3,
  Trash2,
} from "lucide-react"

import { Alert, AlertDescription } from "@/components/ui/alert"

import { Badge } from "@/components/ui/badge"

import { Button } from "@/components/ui/button"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

import { Skeleton } from "@/components/ui/skeleton"

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

import { EmptyState } from "@/components/empty-state"

import { Field, FieldGrid } from "@/components/field"

import { Input } from "@/components/ui/input"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

import { useSave } from "@/features/organization/use-save"

import { useAsyncResource } from "@/lib/use-async-resource"

import {
  buildStructureTree,
  countStructureNodes,
  projectStructureApi,
  structureDepth,
  type ProjectStructureNode,
  type StructureMoveDirection,
  type StructureTreeNode,
} from "@/lib/project-structure-api"

import {
  STRUCTURE_MAX_DEPTH,
  STRUCTURE_NODE_KIND_LABELS,
  STRUCTURE_NODE_KINDS,
  type StructureNodeKind,
} from "@shared/projects"

/**
 * One icon per kind. The kind is also in the row's accessible name and in the
 * tooltip, because an icon alone is not something a screen reader can announce.
 */

const KIND_ICONS = {
  block: Building2,

  sector: Layers,

  floor: Rows3,
} as const

/**
 * How a kind is labelled when space is tight — the full "Block / tower" reads
 * badly in a dense row, so the tree uses the short word and keeps the full label
 * for the tooltip, the dialog, and the accessible name.
 */

const KIND_SHORT: Record<StructureNodeKind, string> = {
  block: "Block",

  sector: "Sector",

  floor: "Floor",
}

/** One row's position in its sibling set, which is what reordering needs. */

interface NodePosition {
  index: number

  total: number
}

interface ProjectStructurePanelProps {
  projectId: string

  projectName: string
}

/** Which dialog is open, and what it is working on. */

/**
 * Which dialog is open, and what it is working on.
 *
 * Each variant is its own interface rather than a member of one inline union:
 * `oxfmt` collapses the separators inside a single-line object type, which turns
 * a union written on one line per arm into a syntax error. Named interfaces are
 * stable across repeated format runs.
 */
interface ClosedEditor {
  mode: "closed"
}

interface CreateEditor {
  mode: "create"
  parentId: string | null
  parentName: string | null
}

interface RenameEditor {
  mode: "rename"
  node: ProjectStructureNode
}

interface DeleteEditor {
  mode: "delete"
  node: ProjectStructureNode
}

type EditorState = ClosedEditor | CreateEditor | RenameEditor | DeleteEditor

export function ProjectStructurePanel({
  projectId,

  projectName,
}: ProjectStructurePanelProps) {
  const { data, loading, error, reload } = useAsyncResource((signal) =>
    projectStructureApi.list(projectId, signal),
  )

  const save = useSave()

  // Collapsed is the exception, not the rule: a structure tree opens fully

  // expanded so the shape of the development is visible on arrival, and the user

  // closes the branches they are not working in.

  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(
    () => new Set(),
  )

  const [editor, setEditor] = useState<EditorState>({ mode: "closed" })

  const [busyId, setBusyId] = useState<string | null>(null)

  const canEdit = data?.canEdit ?? false

  const tree = useMemo(() => buildStructureTree(data?.nodes ?? []), [data])

  const totals = useMemo(
    () => ({
      nodes: countStructureNodes(tree),

      depth: structureDepth(tree),
    }),

    [tree],
  )

  /**
   * Sibling index and count for every node.
   *
   * Computed in one pass over the tree so a row knows whether it is first or last
   * without each one re-deriving it. It drives whether "move up" and "move down"
   * are offered, so it has to agree with the order actually rendered.
   */

  const positions = useMemo(() => {
    const map = new Map<string, NodePosition>()

    const walk = (nodes: StructureTreeNode[]) => {
      nodes.forEach((node, index) => {
        map.set(node.id, { index, total: nodes.length })

        walk(node.children)
      })
    }

    walk(tree)

    return map
  }, [tree])

  function toggle(id: string) {
    setCollapsed((current) => {
      const next = new Set(current)

      if (next.has(id)) next.delete(id)
      else next.add(id)

      return next
    })
  }

  /** Forgets a deleted node's collapse state, which would otherwise linger. */

  function forget(id: string) {
    setCollapsed((current) => {
      if (!current.has(id)) return current

      const next = new Set(current)

      next.delete(id)

      return next
    })
  }

  async function move(
    node: ProjectStructureNode,
    direction: StructureMoveDirection,
  ) {
    setBusyId(node.id)

    await save.run(async () => {
      await projectStructureApi.move(projectId, node.id, direction)

      await reload()
    })

    setBusyId(null)
  }

  async function remove(node: ProjectStructureNode) {
    setBusyId(node.id)

    const removed = await save.run(async () => {
      await projectStructureApi.remove(projectId, node.id)

      forget(node.id)

      await reload()
    })

    setBusyId(null)

    // Only close once the node is actually gone. A refusal — a child that

    // appeared since the menu was opened — belongs next to the confirmation the

    // user is still looking at, not on a card behind a dialog that vanished.

    if (removed) setEditor({ mode: "closed" })
  }

  // --- render ---------------------------------------------------------------

  if (error) {
    return (
      <Alert variant="danger">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    )
  }

  if (loading && !data) {
    return (
      <div className="flex flex-col gap-1.5">
        {[0, 1, 2].map((row) => (
          <Skeleton key={row} className="h-8 w-full" />
        ))}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <Card>
        <CardHeader>
          <CardTitle>Structure</CardTitle>
          <CardDescription>
            {totals.nodes === 0
              ? `Blocks, sectors, and floors inside ${projectName}.`
              : `${totals.nodes} ${
                  totals.nodes === 1 ? "node" : "nodes"
                }, ${totals.depth} ${
                  totals.depth === 1 ? "level" : "levels"
                } deep.`}
          </CardDescription>

          {canEdit && (
            <Button
              size="sm"
              className="-mt-0.5 self-start"
              onClick={() =>
                setEditor({ mode: "create", parentId: null, parentName: null })
              }
            >
              <Plus size={13} />
              Add node
            </Button>
          )}
        </CardHeader>

        <CardContent className="px-0 py-0">
          {save.error && (
            <div className="px-4 pb-3">
              <Alert variant="danger">
                <AlertDescription>{save.error}</AlertDescription>
              </Alert>
            </div>
          )}

          {totals.nodes === 0 ? (
            <EmptyState
              icon={Layers}
              title="No structure recorded"
              description={
                canEdit
                  ? `Add the blocks, sectors, and floors that make up ${projectName}. Units are published against this tree once inventory exists.`
                  : "Nothing has been recorded for this project's structure yet."
              }
              action={
                canEdit ? (
                  <Button
                    size="sm"
                    onClick={() =>
                      setEditor({
                        mode: "create",

                        parentId: null,

                        parentName: null,
                      })
                    }
                  >
                    <Plus size={13} />
                    Add the first node
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <ul className="border-t border-border">
              {tree.map((node) => (
                <StructureRow
                  key={node.id}
                  node={node}
                  depth={0}
                  positions={positions}
                  collapsed={collapsed}
                  busyId={busyId}
                  canEdit={canEdit}
                  onToggle={toggle}
                  onAddChild={(parent) =>
                    setEditor({
                      mode: "create",

                      parentId: parent.id,

                      parentName: parent.name,
                    })
                  }
                  onRename={(target) =>
                    setEditor({ mode: "rename", node: target })
                  }
                  onDelete={(target) =>
                    setEditor({ mode: "delete", node: target })
                  }
                  onMove={move}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {!canEdit && (
        <p className="px-1 text-[11.5px] text-muted-foreground">
          Read only. Your role can see this structure but not change it.
        </p>
      )}

      <StructureDialog
        editor={editor}
        save={save}
        onClose={() => {
          save.clear()

          setEditor({ mode: "closed" })
        }}
        onCreate={async (input) => {
          const created = await save.run(async () => {
            await projectStructureApi.create(projectId, input)

            // Expand the branch the node went into, or the tab looks like it

            // ignored the click: the new node is real but sitting inside a closed

            // branch the user cannot see into.

            if (input.parentId) {
              const parentId = input.parentId

              setCollapsed((current) => {
                if (!current.has(parentId)) return current

                const next = new Set(current)

                next.delete(parentId)

                return next
              })
            }

            await reload()
          })

          // The node is in the tree now, so the dialog has done its job. Left

          // open it would sit in front of a form the user has already answered.

          if (created) {
            save.clear()

            setEditor({ mode: "closed" })
          }
        }}
        onRename={async (nodeId, input) => {
          const renamed = await save.run(async () => {
            await projectStructureApi.rename(projectId, nodeId, input)

            await reload()
          })

          if (renamed) {
            save.clear()

            setEditor({ mode: "closed" })
          }
        }}
        onDelete={remove}
      />
    </div>
  )
}

// --- Row --------------------------------------------------------------------

interface StructureRowProps {
  node: StructureTreeNode

  depth: number

  positions: Map<string, NodePosition>

  collapsed: ReadonlySet<string>

  busyId: string | null

  canEdit: boolean

  onToggle: (id: string) => void

  onAddChild: (node: StructureTreeNode) => void

  onRename: (node: ProjectStructureNode) => void

  onDelete: (node: ProjectStructureNode) => void

  onMove: (
    node: ProjectStructureNode,

    direction: StructureMoveDirection,
  ) => void
}

function StructureRow({
  node,

  depth,

  positions,

  collapsed,

  busyId,

  canEdit,

  onToggle,

  onAddChild,

  onRename,

  onDelete,

  onMove,
}: StructureRowProps) {
  const hasChildren = node.children.length > 0

  const isCollapsed = collapsed.has(node.id)

  const position = positions.get(node.id)

  const busy = busyId === node.id

  // Per-branch, not per-tree: a project can have one deep wing and a flat one,

  // and refusing to nest anywhere once the deepest branch hits the cap would be

  // wrong. A node at 0-based `depth` sits at level `depth + 1`, so a child of it

  // would land at level `depth + 2`.

  const atMaxDepth = depth + 2 > STRUCTURE_MAX_DEPTH

  // A corrupted row is the only way to get a null kind, and it must not render as

  // a blank space or crash the tab.

  const kind = node.kind

  const Icon = kind ? KIND_ICONS[kind] : Layers

  const kindLabel = kind ? STRUCTURE_NODE_KIND_LABELS[kind] : "Unknown kind"

  return (
    <>
      <li
        className="group flex h-8 items-center gap-1 border-b border-border/60 pr-2 pl-1 last:border-b-0 hover:bg-muted/50"
        aria-label={`${node.name}, ${kindLabel}, level ${depth + 1}${
          hasChildren ? `, ${node.children.length} children` : ""
        }`}
      >
        {/* Indent, plus a guide line so the level is readable at a glance. */}
        <span
          aria-hidden="true"
          className="shrink-0"
          style={{ width: depth * 16 }}
        />

        {hasChildren ? (
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-6 shrink-0 text-muted-foreground"
            aria-label={
              isCollapsed ? `Expand ${node.name}` : `Collapse ${node.name}`
            }
            aria-expanded={!isCollapsed}
            onClick={() => onToggle(node.id)}
          >
            {isCollapsed ? (
              <ChevronRight size={13} />
            ) : (
              <ChevronDown size={13} />
            )}
          </Button>
        ) : (
          // Same footprint as the twisty so names line up whether or not a

          // branch has children.

          <span aria-hidden="true" className="size-6 shrink-0" />
        )}

        <Tooltip>
          <TooltipTrigger asChild>
            <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground">
              <Icon size={13} />
            </span>
          </TooltipTrigger>
          <TooltipContent>{kindLabel}</TooltipContent>
        </Tooltip>

        <span
          className={`min-w-0 truncate text-[13px] ${
            hasChildren ? "font-medium" : ""
          }`}
        >
          {node.name}
        </span>

        <Badge variant="outline" className="ml-1 shrink-0 text-[10.5px]">
          {kind ? KIND_SHORT[kind] : "—"}
        </Badge>

        <span className="flex-1" />

        {busy && <span className="text-[11px] text-muted-foreground">…</span>}

        {canEdit && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="size-6 shrink-0 text-muted-foreground"
                aria-label={`Actions for ${node.name}`}
                disabled={busy}
              >
                <MoreHorizontal size={14} />
              </Button>
            </DropdownMenuTrigger>

            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem
                onSelect={() => onAddChild(node)}
                disabled={atMaxDepth}
              >
                <Plus size={13} />
                Add node inside
              </DropdownMenuItem>

              <DropdownMenuItem onSelect={() => onRename(node)}>
                <Pencil size={13} />
                Rename
              </DropdownMenuItem>

              <DropdownMenuSeparator />

              <DropdownMenuItem
                onSelect={() => onMove(node, "up")}
                disabled={position === undefined || position.index === 0}
              >
                <ChevronUp size={13} />
                Move up
              </DropdownMenuItem>

              <DropdownMenuItem
                onSelect={() => onMove(node, "down")}
                disabled={
                  position !== undefined &&
                  position.index === position.total - 1
                }
              >
                <ChevronDown size={13} />
                Move down
              </DropdownMenuItem>

              <DropdownMenuSeparator />

              <DropdownMenuItem
                variant="danger"
                onSelect={() => onDelete(node)}
                disabled={node.childCount > 0}
              >
                <Trash2 size={13} />
                {node.childCount > 0
                  ? `Delete — remove ${node.childCount} ${
                      node.childCount === 1 ? "child" : "children"
                    } first`
                  : "Delete"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </li>

      {hasChildren &&
        !isCollapsed &&
        node.children.map((child) => (
          <StructureRow
            key={child.id}
            node={child}
            depth={depth + 1}
            positions={positions}
            collapsed={collapsed}
            busyId={busyId}
            canEdit={canEdit}
            onToggle={onToggle}
            onAddChild={onAddChild}
            onRename={onRename}
            onDelete={onDelete}
            onMove={onMove}
          />
        ))}
    </>
  )
}

// --- Dialogs ----------------------------------------------------------------

interface StructureDialogProps {
  editor: EditorState
  save: ReturnType<typeof useSave>
  onClose: () => void
  onCreate: (input: CreateNodeValues) => Promise<void>
  onRename: (nodeId: string, input: CreateNodeValues) => Promise<void>
  onDelete: (node: ProjectStructureNode) => Promise<void>
}

interface CreateNodeValues {
  name: string
  kind: StructureNodeKind
  parentId: string | null
}

/**
 * One dialog serving create, rename, and delete.
 *
 * Sharing it is what keeps the node fields identical across the three: a rename
 * that quietly lost the kind selector would let someone turn a tower into a floor
 * without meaning to, so renaming edits the same two fields as creating and sends
 * both.
 */
export function StructureDialog({
  editor,
  save,
  onClose,
  onCreate,
  onRename,
  onDelete,
}: StructureDialogProps) {
  const node =
    editor.mode === "create" || editor.mode === "closed" ? null : editor.node

  /**
   * Identifies what the dialog is editing, so the body can be remounted when it
   * changes rather than patched.
   *
   * Remounting is the whole point: the fields hold local state seeded from the
   * node being edited, and re-seeding them in place is the render-phase-setState
   * pattern, which cannot also clear the previous node's error state without
   * calling into another hook mid-render. A `key` makes the fresh state correct on
   * the first paint, so there is no flash of the previous node's values.
   */
  const seed =
    editor.mode === "closed"
      ? "closed"
      : editor.mode === "create"
        ? `create:${editor.parentId ?? "root"}`
        : `${editor.mode}:${editor.node.id}`

  const title =
    editor.mode === "create"
      ? editor.parentName
        ? `Add a node inside ${editor.parentName}`
        : "Add a structure node"
      : editor.mode === "rename"
        ? "Rename node"
        : "Delete node"

  const description =
    editor.mode === "create"
      ? editor.parentName
        ? `This will sit directly inside ${editor.parentName}.`
        : "This will sit directly under the project."
      : editor.mode === "rename"
        ? "Changing the kind is optional and does not affect its children."
        : "Only an empty node can be deleted, and this cannot be undone."

  return (
    <Dialog
      open={editor.mode !== "closed"}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {editor.mode === "delete" && node ? (
          <DeleteNodeBody
            key={seed}
            node={node}
            save={save}
            onClose={onClose}
            onDelete={onDelete}
          />
        ) : (
          <NodeFormBody
            key={seed}
            parentName={editor.mode === "create" ? editor.parentName : null}
            initialName={editor.mode === "rename" ? (node?.name ?? "") : ""}
            initialKind={
              editor.mode === "rename" ? (node?.kind ?? "block") : "block"
            }
            save={save}
            onClose={onClose}
            onCreate={onCreate}
            onRename={onRename}
            nodeId={editor.mode === "rename" ? node?.id : undefined}
            parentId={editor.mode === "create" ? editor.parentId : null}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

interface NodeFormBodyProps {
  parentName: string | null
  initialName: string
  initialKind: StructureNodeKind
  nodeId: string | undefined
  parentId: string | null
  save: ReturnType<typeof useSave>
  onClose: () => void
  onCreate: (input: CreateNodeValues) => Promise<void>
  onRename: (nodeId: string, input: CreateNodeValues) => Promise<void>
}

function NodeFormBody({
  parentName,
  initialName,
  initialKind,
  nodeId,
  parentId,
  save,
  onClose,
  onCreate,
  onRename,
}: NodeFormBodyProps) {
  const [name, setName] = useState(initialName)
  const [kind, setKind] = useState<StructureNodeKind>(initialKind)

  const isRename = nodeId !== undefined

  return (
    <>
      <FieldGrid>
        <Field
          label="Name"
          htmlFor="structure-node-name"
          required
          error={save.fields.name}
          hint={
            parentName
              ? `How this node is labelled inside ${parentName}.`
              : "How this node is labelled inside the project."
          }
        >
          <Input
            id="structure-node-name"
            value={name}
            maxLength={80}
            autoComplete="off"
            placeholder="Tower A"
            onChange={(event) => setName(event.target.value)}
          />
        </Field>

        <Field
          label="Kind"
          htmlFor="structure-node-kind"
          error={save.fields.kind ?? save.fields.parentId}
          hint={`Nesting is limited to ${STRUCTURE_MAX_DEPTH} levels.`}
        >
          <Select
            value={kind}
            onValueChange={(value) => setKind(value as StructureNodeKind)}
          >
            <SelectTrigger id="structure-node-kind" aria-label="Kind">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STRUCTURE_NODE_KINDS.map((option) => (
                <SelectItem key={option} value={option}>
                  {STRUCTURE_NODE_KIND_LABELS[option]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </FieldGrid>

      {save.error && (
        <div className="mt-3">
          <Alert variant="danger">
            <AlertDescription>{save.error}</AlertDescription>
          </Alert>
        </div>
      )}

      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={save.saving}>
          Cancel
        </Button>

        <Button
          disabled={save.saving || name.trim().length === 0}
          onClick={() => {
            const input = { name: name.trim(), kind, parentId }

            void (isRename ? onRename(nodeId, input) : onCreate(input))
          }}
        >
          {save.saving ? "Saving…" : isRename ? "Save changes" : "Add node"}
        </Button>
      </DialogFooter>
    </>
  )
}

interface DeleteNodeBodyProps {
  node: ProjectStructureNode
  save: ReturnType<typeof useSave>
  onClose: () => void
  onDelete: (node: ProjectStructureNode) => Promise<void>
}

function DeleteNodeBody({
  node,
  save,
  onClose,
  onDelete,
}: DeleteNodeBodyProps) {
  return (
    <>
      <div className="flex items-start gap-2 rounded-md border border-danger-border bg-danger-subtle px-3 py-2.5">
        <Trash2 size={14} className="mt-0.5 shrink-0 text-danger" />
        <p className="text-[13px] text-danger">
          Delete <span className="font-medium">{node.name}</span> and everything
          under it? Nothing sits under it, so only this node goes.
        </p>
      </div>

      {save.error && (
        <div className="mt-3">
          <Alert variant="danger">
            <AlertDescription>{save.error}</AlertDescription>
          </Alert>
        </div>
      )}

      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={save.saving}>
          Cancel
        </Button>

        <Button
          variant="danger"
          disabled={save.saving}
          onClick={() => {
            void onDelete(node)
          }}
        >
          {save.saving ? "Deleting…" : "Delete node"}
        </Button>
      </DialogFooter>
    </>
  )
}
