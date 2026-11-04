/**
 * The procurement module: materials and stock, purchase requisitions,
 * purchase orders, and goods receipts.
 *
 * Three rules the whole route file is built on.
 *
 * 1. Stock is never stored. A material's on-hand quantity is the SUM of its
 *    movements, written here and only here — GRN receipts, manual issues,
 *    and adjustments. A correction is a new signed row, never an edit.
 * 2. Requisitions and POs are approved through the existing maker-checker
 *    queue — the same engine that settles expenses, with `requisition` and
 *    `purchase_order` action keys. The decision lands in this module
 *    (`applyRequisitionDecision` etc. are the replay the approvals route
 *    calls), so the queue stays the one place sign-offs happen.
 * 3. The money a PO commits and the payable it becomes live in the ordinary
 *    vendor-invoice table, tagged with `purchase_order_id`. A GRN may raise
 *    one open invoice — appended to the vendor ledger through the same
 *    single writer the vendors module uses — and the three-way match reads
 *    ordered / received / invoiced from their own rows, a dash where
 *    nothing was recorded.
 *
 * PO numbers come from the tenant's own numbering settings, like receipts.
 */

import { all, get, run, transaction, isUniqueViolation } from "../db.ts"

import {
  badRequest,
  conflict,
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

import { insertApproval, pendingApprovalFor } from "./approvals.ts"

import { nextDocumentNumber } from "./organization.ts"

import { appendVendorLedger } from "./vendors.ts"

import { notifyRecipients } from "../notify.ts"

import {
  LINE_QUANTITY_MAX,
  MATERIAL_CATEGORY_LABELS,
  MOVEMENT_TYPE_LABELS,
  PO_LINE_MAX,
  PO_OPEN_STATUSES,
  PO_STATUS_LABELS,
  REFERENCE_MAX,
  REQUISITION_LINE_MAX,
  REQUISITION_STATUS_LABELS,
  UNIT_PRICE_MAX,
  isMaterialCategory,
  isPoStatus,
  isRequisitionStatus,
  type GoodsReceiptLineView,
  type GoodsReceiptView,
  type MaterialView,
  type PurchaseInvoiceView,
  type PurchaseOrderLineView,
  type PurchaseOrderView,
  type RequisitionStatus,
  type RequisitionView,
} from "../../shared/procurement.ts"

/** Minimal projection for an `{ id, status }` lookup. */
interface IdStatusRow {
  id: string

  status: string
}

/** Minimal projection for an `{ id, name }` lookup. */
interface IdNameRow {
  id: string

  name: string
}

/** PO line ordered-vs-received pair for the rollup. */
interface PoLineReceivedRow {
  quantity: number

  received: number
}

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

/** A whole quantity 1..LINE_QUANTITY_MAX, or a field error. */

function quantityOf(
  value: unknown,

  field: string,

  errors: Record<string, string>,
): number | null {
  const quantity = Number(value)

  if (
    !Number.isSafeInteger(quantity) ||
    quantity < 1 ||
    quantity > LINE_QUANTITY_MAX
  ) {
    errors[field] = `Use a whole quantity between 1 and ${LINE_QUANTITY_MAX}.`

    return null
  }

  return quantity
}

/** A whole unit price 0..UNIT_PRICE_MAX (0 is a free/gift line), or an error. */

function unitPriceOf(
  value: unknown,

  field: string,

  errors: Record<string, string>,
): number | null {
  if (value === undefined || value === null || value === "") return null

  const price = Number(value)

  if (!Number.isSafeInteger(price) || price < 0 || price > UNIT_PRICE_MAX) {
    errors[field] = "Use a whole amount between 0 and the platform maximum."

    return null
  }

  return price
}

// --- Materials -------------------------------------------------------------------

type MaterialRow = {
  id: string

  tenant_id: string

  sku: string

  name: string

  category: string

  unit_of_measure: string

  target_stock: number | null

  notes: string | null

  status: string

  created_at: string

  current_stock: number
}

const MATERIAL_SELECT = `
  SELECT m.*,
         COALESCE((SELECT SUM(s.quantity) FROM stock_movements s
                     WHERE s.tenant_id = m.tenant_id AND s.material_id = m.id), 0)
           AS current_stock
    FROM materials m
`

function toMaterial(row: MaterialRow): MaterialView {
  const current = Number(row.current_stock)

  const target = row.target_stock == null ? null : Number(row.target_stock)

  return {
    id: row.id,

    sku: row.sku,

    name: row.name,

    category: row.category,

    categoryLabel:
      MATERIAL_CATEGORY_LABELS[
        (row.category as keyof typeof MATERIAL_CATEGORY_LABELS)
      ] ?? row.category,

    unitOfMeasure: row.unit_of_measure,

    targetStock: target,

    currentStock: current,

    // False when there is no target to compare against — the screen shows a

    // dash, never a warning without a yardstick.

    belowTarget: target != null && current < target,

    notes: row.notes,

    status: row.status,

    createdAt: row.created_at,
  }
}

/** GET /api/procurement/materials */

export async function listMaterials(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "procurement", "view")

  const search = (ctx.query.get("search") ?? "").trim().toLowerCase()

  const clauses = ["m.tenant_id = ?"]

  const params: Array<string | number> = [guarded.tenantId]

  if (ctx.query.get("status") === "archived") {
    clauses.push("m.status = 'archived'")
  } else if (ctx.query.get("status") === "active") {
    clauses.push("m.status = 'active'")
  }

  if (search) {
    clauses.push("(LOWER(m.name) LIKE ? OR LOWER(m.sku) LIKE ?)")

    params.push(`%${search}%`, `%${search}%`)
  }

  const rows = all<MaterialRow>(
    `${MATERIAL_SELECT} WHERE ${clauses.join(" AND ")}
      ORDER BY m.name COLLATE NOCASE ASC`,

    ...params,
  )

  const materials = rows.map(toMaterial)

  return {
    materials,

    belowTargetCount: materials.filter((m) => m.belowTarget).length,

    movementsThisMonth: Number(
      get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM stock_movements
          WHERE tenant_id = ?
            AND created_at >= datetime('now', '-30 days')`,

        guarded.tenantId,
      )?.n ?? 0,
    ),

    canManage: guarded.can("procurement", "create"),
  }
}

/** POST /api/procurement/materials */

export async function createMaterial(ctx: RequestContext) {
  const guarded = requirePermission(
    requireAuth(ctx),

    "procurement",

    "create",
  )

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const errors: Record<string, string> = {}

  const sku = typeof body.sku === "string" ? body.sku.trim().toUpperCase() : ""

  if (sku === "") errors.sku = "Give this material an SKU."
  else if (sku.length > 40) errors.sku = "Use 40 characters or fewer."

  const name = typeof body.name === "string" ? body.name.trim() : ""

  if (name === "") errors.name = "Name this material."
  else if (name.length > 120) errors.name = "Use 120 characters or fewer."

  const category =
    typeof body.category === "string" ? body.category : "material"

  if (!isMaterialCategory(category)) {
    errors.category = "Pick one of the listed categories."
  }

  const unitOfMeasure =
    typeof body.unitOfMeasure === "string" ? body.unitOfMeasure.trim() : ""

  if (unitOfMeasure === "") errors.unitOfMeasure = "Name the unit, e.g. bag."
  else if (unitOfMeasure.length > 24)
    errors.unitOfMeasure = "Use 24 characters or fewer."

  let targetStock: number | null = null

  if (
    body.targetStock !== undefined &&
    body.targetStock !== null &&
    body.targetStock !== ""
  ) {
    const target = Number(body.targetStock)

    if (!Number.isSafeInteger(target) || target < 0 || target > 1_000_000) {
      errors.targetStock = "Use a whole number between 0 and 1,000,000."
    } else {
      targetStock = target
    }
  }

  const notes = bounded(body.notes, 500, "notes", errors)

  if (Object.keys(errors).length > 0) {
    throw badRequest("Check the highlighted fields", errors)
  }

  const id = idFor("mat")

  try {
    run(
      `INSERT INTO materials (
          id, tenant_id, sku, name, category, unit_of_measure, target_stock,
          notes, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,

      id,

      guarded.tenantId,

      sku,

      name,

      category,

      unitOfMeasure,

      targetStock,

      notes,

      now(),
    )
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw badRequest("An active material with that SKU already exists.", {
        sku: "Pick a different SKU.",
      })
    }

    throw error
  }

  writeAudit(
    guarded,
    "procurement.material.create",
    "material",
    id,
    { sku, name },
    ctx.ip,
  )

  const row = get<MaterialRow>(
    `${MATERIAL_SELECT} WHERE m.tenant_id = ? AND m.id = ?`,

    guarded.tenantId,

    id,
  )!

  return { material: toMaterial(row) }
}

/** PATCH /api/procurement/materials/:id */

export async function updateMaterial(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "procurement", "edit")

  const existing = loadScoped<MaterialRow & { current_stock?: number }>(
    guarded,

    "materials",

    ctx.params.materialId!,

    "material",
  )

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const errors: Record<string, string> = {}

  const name =
    typeof body.name === "string" && body.name.trim() !== ""
      ? body.name.trim()
      : existing.name

  if (name.length > 120) errors.name = "Use 120 characters or fewer."

  const category =
    typeof body.category === "string" ? body.category : existing.category

  if (!isMaterialCategory(category)) {
    errors.category = "Pick one of the listed categories."
  }

  const unitOfMeasure =
    typeof body.unitOfMeasure === "string" && body.unitOfMeasure.trim() !== ""
      ? body.unitOfMeasure.trim()
      : existing.unit_of_measure

  const status = typeof body.status === "string" ? body.status : existing.status

  if (status !== "active" && status !== "archived") {
    errors.status = "A material is active or archived."
  }

  let targetStock =
    existing.target_stock == null ? null : Number(existing.target_stock)

  if (body.targetStock !== undefined) {
    if (body.targetStock === null || body.targetStock === "") {
      targetStock = null
    } else {
      const target = Number(body.targetStock)

      if (!Number.isSafeInteger(target) || target < 0 || target > 1_000_000) {
        errors.targetStock = "Use a whole number between 0 and 1,000,000."
      } else {
        targetStock = target
      }
    }
  }

  const notes = bounded(body.notes ?? undefined, 500, "notes", errors)

  if (Object.keys(errors).length > 0) {
    throw badRequest("Check the highlighted fields", errors)
  }

  run(
    `UPDATE materials
        SET name = ?, category = ?, unit_of_measure = ?, target_stock = ?,
            notes = ?, status = ?
      WHERE tenant_id = ? AND id = ?`,

    name,

    category,

    unitOfMeasure,

    targetStock,

    notes ?? existing.notes,

    status,

    guarded.tenantId,

    existing.id,
  )

  writeAudit(
    guarded,
    "procurement.material.edit",
    "material",
    existing.id,
    { name, status },
    ctx.ip,
  )

  const row = get<MaterialRow>(
    `${MATERIAL_SELECT} WHERE m.tenant_id = ? AND m.id = ?`,

    guarded.tenantId,

    existing.id,
  )!

  return { material: toMaterial(row) }
}

// --- Stock movements ---------------------------------------------------------------

type MovementRow = {
  id: string

  material_id: string

  material_name: string | null

  unit_of_measure: string | null

  type: string

  quantity: number

  note: string | null

  project_name: string | null

  po_number: string | null

  actor_name: string

  created_at: string
}

const MOVEMENT_SELECT = `
  SELECT s.*, m.name AS material_name, m.unit_of_measure,
         (SELECT p.name FROM projects p WHERE p.id = s.project_id) AS project_name,
         (SELECT o.po_number FROM purchase_orders o WHERE o.id = s.purchase_order_id) AS po_number
    FROM stock_movements s
    LEFT JOIN materials m ON m.id = s.material_id
`

function toMovement(row: MovementRow) {
  return {
    id: row.id,

    materialId: row.material_id,

    materialName: row.material_name,

    unitOfMeasure: row.unit_of_measure,

    type: row.type,

    typeLabel:
      MOVEMENT_TYPE_LABELS[(row.type as keyof typeof MOVEMENT_TYPE_LABELS)] ??
      row.type,

    quantity: Number(row.quantity),

    note: row.note,

    projectName: row.project_name,

    poNumber: row.po_number,

    actorName: row.actor_name,

    createdAt: row.created_at,
  }
}

/** GET /api/procurement/movements?materialId= */

export async function listMovements(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "procurement", "view")

  const materialId = ctx.query.get("materialId") ?? ""

  const clauses = ["s.tenant_id = ?"]

  const params: Array<string | number> = [guarded.tenantId]

  if (materialId) {
    clauses.push("s.material_id = ?")

    params.push(materialId)
  }

  const rows = all<MovementRow>(
    `${MOVEMENT_SELECT} WHERE ${clauses.join(" AND ")}
      ORDER BY s.created_at DESC, s.rowid DESC LIMIT 300`,

    ...params,
  )

  return { movements: rows.map(toMovement) }
}

/**
 * POST /api/procurement/materials/:id/adjust — the one way quantity moves
 * outside a receipt. Receipts never come from here; they arrive on a GRN.
 */

export async function adjustStock(ctx: RequestContext) {
  const guarded = requirePermission(
    requireAuth(ctx),

    "procurement",

    "edit",
  )

  const material = loadScoped<MaterialRow>(
    guarded,

    "materials",

    ctx.params.materialId!,

    "material",
  )

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const errors: Record<string, string> = {}

  const type = typeof body.type === "string" ? body.type : ""

  // A receipt via this door would double-count against a GRN; a return is

  // also GRN territory. Adjustment and issue are the honest manual entries.

  if (type !== "issue" && type !== "adjustment" && type !== "return") {
    errors.type =
      "Pick issue, return, or adjustment — receipts arrive on a GRN."
  }

  const quantity = Number(body.quantity)

  if (!Number.isSafeInteger(quantity) || quantity === 0) {
    errors.quantity = "Use a whole, non-zero quantity (negative to correct). "
  } else if (Math.abs(quantity) > 1_000_000) {
    errors.quantity = "That quantity is beyond the platform maximum."
  }

  const note = bounded(body.note, 500, "note", errors)

  if (note == null && type === "adjustment") {
    errors.note = "Say why the count is being corrected."
  }

  const projectId =
    typeof body.projectId === "string" && body.projectId !== ""
      ? body.projectId
      : null

  if (Object.keys(errors).length > 0) {
    throw badRequest("Check the highlighted fields", errors)
  }

  if (projectId) {
    const project = get<{ id: string }>(
      "SELECT id FROM projects WHERE tenant_id = ? AND id = ?",

      guarded.tenantId,

      projectId,
    )

    if (!project) errors.projectId = "Pick a project from your workspace."
  }

  const id = idFor("svm")

  run(
    `INSERT INTO stock_movements (
        id, tenant_id, material_id, type, quantity, note, project_id,
        actor_user_id, actor_name, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,

    id,

    guarded.tenantId,

    material.id,

    type,

    quantity,

    note,

    projectId,

    guarded.userId,

    guarded.session.user.fullName,

    now(),
  )

  writeAudit(
    guarded,

    "procurement.stock.adjust",

    "material",

    material.id,

    { type, quantity },

    ctx.ip,
  )

  const row = get<MaterialRow>(
    `${MATERIAL_SELECT} WHERE m.tenant_id = ? AND m.id = ?`,

    guarded.tenantId,

    material.id,
  )!

  return { material: toMaterial(row) }
}

// --- Requisitions ---------------------------------------------------------------------

type RequisitionRow = {
  id: string

  tenant_id: string

  reference: string

  justification: string

  needed_by: string | null

  project_id: string | null

  project_name: string | null

  phase_id: string | null

  currency: string

  estimated_amount: number | null

  line_items: string

  status: string

  approval_id: string | null

  created_by_user_id: string

  created_by_name: string

  created_at: string
}

const REQUISITION_SELECT = `
  SELECT r.*, (SELECT p.name FROM projects p WHERE p.id = r.project_id) AS project_name
    FROM purchase_requisitions r
`

interface StoredRequisitionLine {
  description: string

  quantity: number

  unit: string

  unitPrice: number | null
}

function parseLines(json: string): StoredRequisitionLine[] {
  try {
    const parsed = JSON.parse(json) as unknown

    return Array.isArray(parsed) ? parsed as StoredRequisitionLine[] : []
  } catch {
    return []
  }
}

function toRequisition(row: RequisitionRow): RequisitionView {
  const lines = parseLines(row.line_items)

  // The stored estimate is the sum of priced lines; null when any line is

  // unpriced. A half-priced total is a guess, and the platform does not guess.

  const priced = lines.filter((line) => line.unitPrice != null)

  const estimatedAmount =
    lines.length > 0 && priced.length === lines.length
      ? priced.reduce(
          (sum, line) => sum + line.quantity * (line.unitPrice ?? 0),
          0,
        )
      : null

  return {
    id: row.id,

    reference: row.reference,

    justification: row.justification,

    neededBy: row.needed_by,

    projectId: row.project_id,

    projectName: row.project_name,

    phaseId: row.phase_id,

    currency: row.currency,

    estimatedAmount,

    status: row.status,

    statusLabel:
      REQUISITION_STATUS_LABELS[(row.status as RequisitionStatus)] ??
      row.status,

    lines: lines.map((line) => ({
      description: line.description,

      quantity: line.quantity,

      unit: line.unit,

      unitPrice: line.unitPrice,
    })),

    approvalId: row.approval_id,

    createdBy: row.created_by_name,

    createdAt: row.created_at,
  }
}

function loadRequisition(
  tenantId: string,
  id: string,
): RequisitionRow | undefined {
  return get<RequisitionRow>(
    `${REQUISITION_SELECT} WHERE r.tenant_id = ? AND r.id = ?`,

    tenantId,

    id,
  )
}

/** Validate a `lines` array into stored shape, or fill field errors. */

function parseLineArray(
  raw: unknown,

  errors: Record<string, string>,
): StoredRequisitionLine[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    errors.lines = "List at least one line."

    return []
  }

  if (raw.length > REQUISITION_LINE_MAX) {
    errors.lines = `Use ${REQUISITION_LINE_MAX} lines or fewer.`

    return []
  }

  const lines: StoredRequisitionLine[] = []

  for (const [index, entry] of raw.entries()) {
    const item = (entry ?? {}) as Record<string, unknown>

    const description =
      typeof item.description === "string" ? item.description.trim() : ""

    const unit = typeof item.unit === "string" ? item.unit.trim() : ""

    if (description === "" || unit === "") {
      errors[`line${index}`] = "Every line needs a description and a unit."
    }

    const quantity = Number(item.quantity)

    if (
      !Number.isSafeInteger(quantity) ||
      quantity < 1 ||
      quantity > LINE_QUANTITY_MAX
    ) {
      errors[`line${index}`] =
        "Quantities are whole numbers up to the platform maximum."
    }

    let unitPrice: number | null = null

    if (
      item.unitPrice !== undefined &&
      item.unitPrice !== null &&
      item.unitPrice !== ""
    ) {
      const price = Number(item.unitPrice)

      if (!Number.isSafeInteger(price) || price < 0 || price > UNIT_PRICE_MAX) {
        errors[`line${index}`] =
          "Prices are whole amounts up to the platform maximum."
      } else {
        unitPrice = price
      }
    }

    lines.push({
      description: description.slice(0, 200),

      quantity: Number.isSafeInteger(quantity) ? quantity : 0,

      unit: unit.slice(0, 24),

      unitPrice,
    })
  }

  return lines
}

/** GET /api/procurement/requisitions */

export async function listRequisitions(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "procurement", "view")

  const status = ctx.query.get("status") ?? ""

  const clauses = ["r.tenant_id = ?"]

  const params: Array<string | number> = [guarded.tenantId]

  if (status && isRequisitionStatus(status)) {
    clauses.push("r.status = ?")

    params.push(status)
  }

  const rows = all<RequisitionRow>(
    `${REQUISITION_SELECT} WHERE ${clauses.join(" AND ")}
      ORDER BY r.created_at DESC, r.rowid DESC LIMIT 200`,

    ...params,
  )

  return {
    requisitions: rows.map(toRequisition),

    canCreate: guarded.can("procurement", "create"),

    canEdit: guarded.can("procurement", "edit"),
  }
}

/** POST /api/procurement/requisitions — draft, reference from settings. */

export async function createRequisition(ctx: RequestContext) {
  const guarded = requirePermission(
    requireAuth(ctx),

    "procurement",

    "create",
  )

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const errors: Record<string, string> = {}

  const justification =
    typeof body.justification === "string" ? body.justification.trim() : ""

  if (justification === "") errors.justification = "Say why this is needed."
  else if (justification.length > 2000)
    errors.justification = "Use 2000 characters or fewer."

  const neededBy = dateOf(body.neededBy, "neededBy", errors)

  const projectId =
    typeof body.projectId === "string" && body.projectId !== ""
      ? body.projectId
      : null

  const phaseId =
    typeof body.phaseId === "string" && body.phaseId !== ""
      ? body.phaseId
      : null

  const currency = currencyOf(
    body.currency,
    guarded.tenantId,
    "currency",
    errors,
  )

  const lines = parseLineArray(body.lines, errors)

  if (Object.keys(errors).length > 0) {
    throw badRequest("Check the highlighted fields", errors)
  }

  if (projectId) {
    const project = get<{ id: string }>(
      "SELECT id FROM projects WHERE tenant_id = ? AND id = ?",

      guarded.tenantId,

      projectId,
    )

    if (!project)
      throw badRequest("Pick a project from your workspace.", {
        projectId: "That project does not exist here.",
      })
  }

  if (phaseId) {
    const phase = get<{ id: string }>(
      "SELECT id FROM construction_phases WHERE tenant_id = ? AND id = ?",

      guarded.tenantId,

      phaseId,
    )

    if (!phase)
      throw badRequest("Pick a phase from your workspace.", {
        phaseId: "That phase does not exist here.",
      })
  }

  const id = idFor("req")

  const stamp = now()

  const priced = lines.filter((line) => line.unitPrice != null)

  const estimatedAmount =
    lines.length > 0 && priced.length === lines.length
      ? priced.reduce(
          (sum, line) => sum + line.quantity * (line.unitPrice ?? 0),
          0,
        )
      : null

  transaction(() => {
    const reference = nextDocumentNumber(guarded.tenantId, "requisition")

    run(
      `INSERT INTO purchase_requisitions (
          id, tenant_id, reference, justification, needed_by, project_id,
          phase_id, estimated_amount, currency, line_items, status,
          created_by_user_id, created_by_name, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`,

      id,

      guarded.tenantId,

      reference,

      justification,

      neededBy,

      projectId,

      phaseId,

      estimatedAmount,

      currency,

      JSON.stringify(lines),

      guarded.userId,

      guarded.session.user.fullName,

      stamp,

      stamp,
    )
  })

  writeAudit(
    guarded,
    "procurement.requisition.create",
    "requisition",
    id,
    { justification },
    ctx.ip,
  )

  return { requisition: toRequisition(loadRequisition(guarded.tenantId, id)!) }
}

/** PATCH /api/procurement/requisitions/:id — drafts only. */

export async function updateRequisition(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "procurement", "edit")

  const existing = loadScoped<RequisitionRow & { line_items: string }>(
    guarded,
    "purchase_requisitions",
    ctx.params.requisitionId!,
    "requisition",
  )

  if (existing.status !== "draft") {
    throw conflict("Only a draft requisition can be edited.", {
      status:
        "Once submitted, a requisition is decided in the approvals queue.",
    })
  }

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const errors: Record<string, string> = {}

  const justification =
    typeof body.justification === "string" && body.justification.trim() !== ""
      ? body.justification.trim()
      : existing.justification

  if (justification.length > 2000)
    errors.justification = "Use 2000 characters or fewer."

  const neededBy =
    body.neededBy === undefined
      ? existing.needed_by
      : dateOf(body.neededBy, "neededBy", errors)

  const lines =
    body.lines === undefined
      ? parseLines(existing.line_items)
      : parseLineArray(body.lines, errors)

  if (Object.keys(errors).length > 0) {
    throw badRequest("Check the highlighted fields", errors)
  }

  const priced = lines.filter((line) => line.unitPrice != null)

  const estimatedAmount =
    lines.length > 0 && priced.length === lines.length
      ? priced.reduce(
          (sum, line) => sum + line.quantity * (line.unitPrice ?? 0),
          0,
        )
      : null

  run(
    `UPDATE purchase_requisitions
        SET justification = ?, needed_by = ?, line_items = ?,
            estimated_amount = ?, updated_at = ?
      WHERE tenant_id = ? AND id = ?`,

    justification,

    neededBy,

    JSON.stringify(lines),

    estimatedAmount,

    now(),

    guarded.tenantId,

    existing.id,
  )

  writeAudit(
    guarded,
    "procurement.requisition.edit",
    "requisition",
    existing.id,
    { justification },
    ctx.ip,
  )

  return {
    requisition: toRequisition(loadRequisition(guarded.tenantId, existing.id)!),
  }
}

/**
 * POST /api/procurement/requisitions/:id/submit — defer to the approvals
 * queue, maker-checker. Mirrors the expense flow exactly: a pending request
 * is reused, never doubled, and the row's status carries the wait.
 */

export async function submitRequisition(ctx: RequestContext) {
  const guarded = requirePermission(
    requireAuth(ctx),

    "procurement",

    "edit",
  )

  const existing = loadScoped<RequisitionRow>(
    guarded,

    "purchase_requisitions",

    ctx.params.requisitionId!,

    "requisition",
  )

  if (existing.status !== "draft") {
    throw conflict("Only a draft requisition can be submitted.")
  }

  const lines = parseLines(existing.line_items)

  if (lines.length === 0) {
    throw badRequest("Add at least one line before submitting.", {
      lines: "A requisition with no lines asks for nothing.",
    })
  }

  const alreadyHeld = pendingApprovalFor(
    guarded.tenantId,

    "requisition",

    existing.id,
  )

  const approvalId =
    alreadyHeld?.id ??
    insertApproval({
      tenantId: guarded.tenantId,

      actionKey: "requisition",

      summary: `Requisition ${existing.reference}: ${existing.justification.slice(0, 120)}`,

      payload: {
        requisitionId: existing.id,

        reference: existing.reference,

        justification: existing.justification,

        projectName: existing.project_name,

        estimatedAmount: existing.estimated_amount,

        currency: existing.currency,

        lineCount: lines.length,
      },

      entityType: "requisition",

      resultEntityId: existing.id,

      requestedByUserId: guarded.userId,

      requestedByName: guarded.session.user.fullName,
    }).id

  transaction(() => {
    run(
      `UPDATE purchase_requisitions
          SET status = 'submitted', approval_id = ?, updated_at = ?
        WHERE tenant_id = ? AND id = ?`,

      approvalId,

      now(),

      guarded.tenantId,

      existing.id,
    )
  })

  writeAudit(
    guarded,
    "procurement.requisition.submit",
    "requisition",
    existing.id,
    { approvalId },
    ctx.ip,
  )

  return {
    requisition: toRequisition(loadRequisition(guarded.tenantId, existing.id)!),
  }
}

/**
 * The replay the approvals queue calls when a requisition decision lands.
 * Exported for `routes/approvals.ts`; guarded carries the approver, but the
 * decision credits the maker's row either way.
 */

export function applyRequisitionDecision(
  tenantId: string,

  requisitionId: string,

  approved: boolean,
): string {
  const row = get<IdStatusRow>(
    "SELECT id, status FROM purchase_requisitions WHERE tenant_id = ? AND id = ?",

    tenantId,

    requisitionId,
  )

  if (!row) throw notFound("That requisition does not exist")

  if (row.status !== "submitted") {
    throw conflict("This requisition is no longer awaiting a decision.")
  }

  run(
    `UPDATE purchase_requisitions
        SET status = ?, updated_at = ?
      WHERE tenant_id = ? AND id = ?`,

    approved ? "approved" : "rejected",

    now(),

    tenantId,

    requisitionId,
  )

  const full = loadRequisition(tenantId, requisitionId)

  if (full) {
    // The requester hears the news; the approver is the actor and skipped.

    notifyRecipients(tenantId, [full.created_by_user_id], {
      type: "requisition_decided",

      title: approved
        ? `Requisition ${full.reference} approved`
        : `Requisition ${full.reference} rejected`,

      body: approved
        ? "It is ready to convert to a purchase order."
        : "See the approvals queue for the reviewer's note.",

      linkPath: "/procurement",
    })
  }

  return requisitionId
}

/** GET /api/procurement/requisitions/:id */

export async function getRequisition(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "procurement", "view")

  const row = loadRequisition(guarded.tenantId, ctx.params.requisitionId!)

  if (!row) throw notFound("That requisition does not exist")

  return {
    requisition: toRequisition(row),

    canEdit: guarded.can("procurement", "edit") && row.status === "draft",

    canConvert:
      guarded.can("procurement", "create") && row.status === "approved",
  }
}

/**
 * POST /api/procurement/requisitions/:id/convert — an approved requisition
 * becomes a draft PO. The requisition is stamped `converted`; its lines are
 * copied at their quoted prices, because a PO is a promise and a promise
 * needs numbers.
 */

export async function convertRequisitionToPo(ctx: RequestContext) {
  const guarded = requirePermission(
    requireAuth(ctx),

    "procurement",

    "create",
  )

  const requisition = loadScoped<RequisitionRow>(
    guarded,

    "purchase_requisitions",

    ctx.params.requisitionId!,

    "requisition",
  )

  if (requisition.status !== "approved") {
    throw conflict("Only an approved requisition converts into a PO.")
  }

  const body = await readJsonBody<{ vendorId?: unknown }>(ctx.req)

  const vendorId = typeof body.vendorId === "string" ? body.vendorId.trim() : ""

  const vendor = vendorId
    ? get<IdNameRow>(
        "SELECT id, name FROM vendors WHERE tenant_id = ? AND id = ?",

        guarded.tenantId,

        vendorId,
      )
    : null

  if (!vendor) {
    throw badRequest("Pick the supplier this order will go to.", {
      vendorId: "Choose a vendor from your workspace.",
    })
  }

  const lines = parseLines(requisition.line_items)

  if (lines.some((line) => line.unitPrice == null)) {
    throw badRequest("Every line needs a price before a PO can be raised.", {
      lines: "A purchase order is a promise at a number, not a guess.",
    })
  }

  const poId = idFor("po")

  const stamp = now()

  transaction(() => {
    const poNumber = nextDocumentNumber(guarded.tenantId, "purchase_order")

    const total = lines.reduce(
      (sum, line) => sum + line.quantity * (line.unitPrice ?? 0),

      0,
    )

    run(
      `INSERT INTO purchase_orders (
          id, tenant_id, po_number, vendor_id, requisition_id, project_id,
          phase_id, status, currency, total_amount, created_by_user_id,
          created_by_name, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?)`,

      poId,

      guarded.tenantId,

      poNumber,

      vendor.id,

      requisition.id,

      requisition.project_id,

      requisition.phase_id,

      requisition.currency,

      total,

      guarded.userId,

      guarded.session.user.fullName,

      stamp,

      stamp,
    )

    for (const [index, line] of lines.entries()) {
      run(
        `INSERT INTO purchase_order_lines (
            id, tenant_id, purchase_order_id, description, quantity, unit,
            unit_price, line_total, sequence
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,

        idFor("pol"),

        guarded.tenantId,

        poId,

        line.description,

        line.quantity,

        line.unit,

        line.unitPrice,

        line.quantity * (line.unitPrice ?? 0),

        index + 1,
      )
    }

    run(
      `UPDATE purchase_requisitions
          SET status = 'converted', updated_at = ?
        WHERE tenant_id = ? AND id = ?`,

      stamp,

      guarded.tenantId,

      requisition.id,
    )
  })

  writeAudit(
    guarded,

    "procurement.requisition.convert",

    "purchase_order",

    poId,

    { requisitionId: requisition.id, vendorId: vendor.id },

    ctx.ip,
  )

  return {
    purchaseOrder: toPurchaseOrder(loadPoRow(guarded.tenantId, poId)!),
  }
}

// --- Purchase orders ----------------------------------------------------------------------

type PoRow = {
  id: string

  tenant_id: string

  po_number: string

  vendor_id: string

  vendor_name: string | null

  requisition_id: string | null

  requisition_reference: string | null

  project_id: string | null

  project_name: string | null

  phase_id: string | null

  status: string

  currency: string

  total_amount: number

  notes: string | null

  approval_id: string | null

  created_by_user_id: string

  created_by_name: string

  created_at: string
}

const PO_SELECT = `
  SELECT o.*, v.name AS vendor_name,
         (SELECT r.reference FROM purchase_requisitions r WHERE r.id = o.requisition_id) AS requisition_reference,
         (SELECT p.name FROM projects p WHERE p.id = o.project_id) AS project_name
    FROM purchase_orders o
    LEFT JOIN vendors v ON v.id = o.vendor_id
`

type PoLineRow = {
  id: string

  description: string

  material_id: string | null

  material_name: string | null

  quantity: number

  unit: string

  unit_price: number

  line_total: number

  sequence: number

  quantity_received: number
}

const PO_LINE_SELECT = `
  SELECT l.*, m.name AS material_name,
         COALESCE((SELECT SUM(g.quantity) FROM goods_receipt_lines g
                     JOIN goods_receipt_notes n ON n.id = g.grn_id
                    WHERE g.po_line_id = l.id AND n.status = 'recorded'), 0)
           AS quantity_received
    FROM purchase_order_lines l
    LEFT JOIN materials m ON m.id = l.material_id
`

function toPurchaseOrder(row: PoRow): PurchaseOrderView {
  const lineRows = all<PoLineRow>(
    `${PO_LINE_SELECT} WHERE l.purchase_order_id = ? ORDER BY l.sequence`,

    row.id,
  )

  // Invoiced value: the live payables tagged to this PO. No tagged invoice

  // is null (a dash), not zero — zero only says "nothing has been billed yet"

  // when at least one exists and all are void.

  const invoiceCount = Number(
    get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM vendor_invoices WHERE tenant_id = ? AND purchase_order_id = ?",

      row.tenant_id,

      row.id,
    )?.n ?? 0,
  )

  const invoicedValue =
    invoiceCount === 0
      ? null
      : Number(
          get<{ s: number }>(
            `SELECT COALESCE(SUM(amount), 0) AS s FROM vendor_invoices
              WHERE tenant_id = ? AND purchase_order_id = ? AND status <> 'void'`,

            row.tenant_id,

            row.id,
          )?.s ?? 0,
        )

  const grnCount = Number(
    get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM goods_receipt_notes WHERE purchase_order_id = ? AND status = 'recorded'",

      row.id,
    )?.n ?? 0,
  )

  // Received value at the PO's own unit prices — the middle column of the

  // three-way match, derived, never stored.

  const receivedValue =
    grnCount === 0
      ? null
      : lineRows.reduce(
          (sum, line) => sum + line.quantity_received * line.unit_price,

          0,
        )

  return {
    id: row.id,

    poNumber: row.po_number,

    vendorId: row.vendor_id,

    vendorName: row.vendor_name ?? "—",

    requisitionId: row.requisition_id,

    requisitionReference: row.requisition_reference,

    projectLabel: row.project_name,

    status: row.status,

    statusLabel:
      PO_STATUS_LABELS[(row.status as keyof typeof PO_STATUS_LABELS)] ??
      row.status,

    currency: row.currency,

    totalAmount: Number(row.total_amount),

    receivedValue,

    invoicedValue,

    lines: lineRows.map(
      (line): PurchaseOrderLineView => ({
        id: line.id,

        description: line.description,

        materialId: line.material_id,

        materialName: line.material_name,

        quantity: Number(line.quantity),

        unit: line.unit,

        unitPrice: Number(line.unit_price),

        lineTotal: Number(line.line_total),

        quantityReceived: Number(line.quantity_received),

        // Line-level invoicing is not tracked (invoices carry the order's

        // money, not its lines); the order-level figure is the match.

        invoicedAmount: null,
      }),
    ),

    notes: row.notes,

    createdBy: row.created_by_name,

    createdAt: row.created_at,
  }
}

function loadPoRow(tenantId: string, id: string): PoRow | undefined {
  return get<PoRow>(
    `${PO_SELECT} WHERE o.tenant_id = ? AND o.id = ?`,
    tenantId,
    id,
  )
}

/** GET /api/procurement/purchase-orders */

export async function listPurchaseOrders(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "procurement", "view")

  const status = ctx.query.get("status") ?? ""

  const clauses = ["o.tenant_id = ?"]

  const params: Array<string | number> = [guarded.tenantId]

  if (status && isPoStatus(status)) {
    clauses.push("o.status = ?")

    params.push(status)
  }

  const rows = all<PoRow>(
    `${PO_SELECT} WHERE ${clauses.join(" AND ")}
      ORDER BY o.created_at DESC, o.rowid DESC LIMIT 200`,

    ...params,
  )

  return {
    purchaseOrders: rows.map(toPurchaseOrder),

    canCreate: guarded.can("procurement", "create"),

    canEdit: guarded.can("procurement", "edit"),
  }
}

/** POST /api/procurement/purchase-orders — draft with priced lines. */

export async function createPurchaseOrder(ctx: RequestContext) {
  const guarded = requirePermission(
    requireAuth(ctx),

    "procurement",

    "create",
  )

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const errors: Record<string, string> = {}

  const vendorId = typeof body.vendorId === "string" ? body.vendorId.trim() : ""

  const projectId =
    typeof body.projectId === "string" && body.projectId !== ""
      ? body.projectId
      : null

  const phaseId =
    typeof body.phaseId === "string" && body.phaseId !== ""
      ? body.phaseId
      : null

  const currency = currencyOf(
    body.currency,
    guarded.tenantId,
    "currency",
    errors,
  )

  const notes = bounded(body.notes, 1000, "notes", errors)

  const rawLines = Array.isArray(body.lines) ? body.lines : []

  if (rawLines.length === 0) errors.lines = "A purchase order needs lines."
  else if (rawLines.length > PO_LINE_MAX)
    errors.lines = `Use ${PO_LINE_MAX} lines or fewer.`

  interface DraftLine {
    description: string

    materialId: string | null

    quantity: number

    unit: string

    unitPrice: number
  }

  const lines: DraftLine[] = []

  for (const [index, entry] of rawLines.entries()) {
    const item = (entry ?? {}) as Record<string, unknown>

    const description =
      typeof item.description === "string" ? item.description.trim() : ""

    const unit = typeof item.unit === "string" ? item.unit.trim() : ""

    if (description === "" || unit === "") {
      errors[`line${index}`] = "Every line needs a description and a unit."
    }

    const quantity = quantityOf(
      item.quantity,

      `line${index}`,

      errors,
    )

    const unitPrice = unitPriceOf(item.unitPrice, `line${index}`, errors)

    const materialId =
      typeof item.materialId === "string" && item.materialId !== ""
        ? item.materialId
        : null

    if (materialId) {
      const material = get<{ id: string }>(
        "SELECT id FROM materials WHERE tenant_id = ? AND id = ?",

        guarded.tenantId,

        materialId,
      )

      if (!material) errors[`line${index}`] = "Link lines to known materials."
    }

    lines.push({
      description: description.slice(0, 200),

      materialId,

      quantity: quantity ?? 0,

      unit: unit.slice(0, 24),

      unitPrice: unitPrice ?? 0,
    })
  }

  if (Object.keys(errors).length > 0) {
    throw badRequest("Check the highlighted fields", errors)
  }

  if (!vendorId) {
    throw badRequest("Pick the supplier this order will go to.", {
      vendorId: "Choose a vendor from your workspace.",
    })
  }

  const vendor = get<{ id: string }>(
    "SELECT id FROM vendors WHERE tenant_id = ? AND id = ?",

    guarded.tenantId,

    vendorId,
  )

  if (!vendor) {
    throw badRequest("Pick a vendor from your workspace.", {
      vendorId: "That vendor does not exist here.",
    })
  }

  const id = idFor("po")

  const stamp = now()

  const total = lines.reduce(
    (sum, line) => sum + line.quantity * line.unitPrice,
    0,
  )

  transaction(() => {
    const poNumber = nextDocumentNumber(guarded.tenantId, "purchase_order")

    run(
      `INSERT INTO purchase_orders (
          id, tenant_id, po_number, vendor_id, requisition_id, project_id,
          phase_id, status, currency, total_amount, notes, created_by_user_id,
          created_by_name, created_at, updated_at
        ) VALUES (?, ?, ?, ?, NULL, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?)`,

      id,

      guarded.tenantId,

      poNumber,

      vendor.id,

      projectId,

      phaseId,

      currency,

      total,

      notes,

      guarded.userId,

      guarded.session.user.fullName,

      stamp,

      stamp,
    )

    for (const [index, line] of lines.entries()) {
      run(
        `INSERT INTO purchase_order_lines (
            id, tenant_id, purchase_order_id, material_id, description,
            quantity, unit, unit_price, line_total, sequence
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,

        idFor("pol"),

        guarded.tenantId,

        id,

        line.materialId,

        line.description,

        line.quantity,

        line.unit,

        line.unitPrice,

        line.quantity * line.unitPrice,

        index + 1,
      )
    }
  })

  writeAudit(
    guarded,
    "procurement.po.create",
    "purchase_order",
    id,
    { vendorId: vendor.id, total },
    ctx.ip,
  )

  return { purchaseOrder: toPurchaseOrder(loadPoRow(guarded.tenantId, id)!) }
}

/** GET /api/procurement/purchase-orders/:id — detail with match + receipts. */

export async function getPurchaseOrder(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "procurement", "view")

  const row = loadPoRow(guarded.tenantId, ctx.params.poId!)

  if (!row) throw notFound("That purchase order does not exist")

  const grnRows = all<GrnRow>(
    `${GRN_SELECT} WHERE n.tenant_id = ? AND n.purchase_order_id = ?
      ORDER BY n.received_at DESC, n.rowid DESC`,

    guarded.tenantId,

    row.id,
  )

  const invoiceRows = all<{
    id: string

    reference: string

    vendor_name: string | null

    amount: number

    currency: string

    status: string

    issued_at: string

    due_at: string | null
  }>(
    `SELECT i.id, i.reference, v.name AS vendor_name, i.amount, i.currency,
            i.status, i.issued_at, i.due_at
       FROM vendor_invoices i
       LEFT JOIN vendors v ON v.id = i.vendor_id
      WHERE i.tenant_id = ? AND i.purchase_order_id = ?
      ORDER BY i.issued_at DESC`,

    guarded.tenantId,

    row.id,
  )

  return {
    purchaseOrder: toPurchaseOrder(row),

    receipts: grnRows.map((grn) =>
      toGrn(grn, row.po_number, row.vendor_name ?? "—"),
    ),

    invoices: invoiceRows.map(
      (invoice): PurchaseInvoiceView => ({
        id: invoice.id,

        reference: invoice.reference,

        vendorName: invoice.vendor_name ?? "—",

        amount: Number(invoice.amount),

        currency: invoice.currency,

        status: invoice.status,

        issuedAt: invoice.issued_at,

        dueAt: invoice.due_at,

        fromGrnId:
          get<{ id: string }>(
            "SELECT id FROM goods_receipt_notes WHERE tenant_id = ? AND invoice_id = ?",

            guarded.tenantId,

            invoice.id,
          )?.id ?? null,
      }),
    ),
  }
}

/**
 * POST /api/procurement/purchase-orders/:id/submit — a draft PO goes to the
 * approvals queue before it may be sent to the supplier.
 */

export async function submitPurchaseOrder(ctx: RequestContext) {
  const guarded = requirePermission(
    requireAuth(ctx),

    "procurement",

    "edit",
  )

  const row = loadScoped<PoRow>(
    guarded,
    "purchase_orders",
    ctx.params.poId!,
    "purchase order",
  )

  if (row.status !== "draft") {
    throw conflict("Only a draft purchase order can be submitted.")
  }

  const lineCount = Number(
    get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM purchase_order_lines WHERE purchase_order_id = ?",

      row.id,
    )?.n ?? 0,
  )

  if (lineCount === 0) throw badRequest("This purchase order has no lines.")

  const alreadyHeld = pendingApprovalFor(
    guarded.tenantId,
    "purchase_order",
    row.id,
  )

  const approvalId =
    alreadyHeld?.id ??
    insertApproval({
      tenantId: guarded.tenantId,

      actionKey: "purchase_order",

      summary: `PO ${row.po_number} to ${row.vendor_name ?? "vendor"}: ${(row.total_amount / 100).toFixed(2)} ${row.currency}`,

      payload: {
        purchaseOrderId: row.id,

        poNumber: row.po_number,

        vendorName: row.vendor_name,

        projectName: row.project_name,

        totalAmount: row.total_amount,

        currency: row.currency,

        lineCount,
      },

      entityType: "purchase_order",

      resultEntityId: row.id,

      requestedByUserId: guarded.userId,

      requestedByName: guarded.session.user.fullName,
    }).id

  run(
    `UPDATE purchase_orders
        SET status = 'pending_approval', approval_id = ?, updated_at = ?
      WHERE tenant_id = ? AND id = ?`,

    approvalId,

    now(),

    guarded.tenantId,

    row.id,
  )

  writeAudit(
    guarded,
    "procurement.po.submit",
    "purchase_order",
    row.id,
    { approvalId },
    ctx.ip,
  )

  return {
    purchaseOrder: toPurchaseOrder(loadPoRow(guarded.tenantId, row.id)!),
  }
}

/** The approvals replay: a signed-off PO becomes `approved`. */

export function applyPurchaseOrderDecision(
  tenantId: string,

  purchaseOrderId: string,

  approved: boolean,
): string {
  const row = get<{
    id: string
    status: string
    po_number: string
    created_by_user_id: string
    created_by_name: string
  }>(
    "SELECT id, status, po_number, created_by_user_id, created_by_name FROM purchase_orders WHERE tenant_id = ? AND id = ?",

    tenantId,

    purchaseOrderId,
  )

  if (!row) throw notFound("That purchase order does not exist")

  if (row.status !== "pending_approval") {
    throw conflict("This purchase order is no longer awaiting a decision.")
  }

  run(
    `UPDATE purchase_orders SET status = ?, updated_at = ? WHERE tenant_id = ? AND id = ?`,

    approved ? "approved" : "draft",

    now(),

    tenantId,

    purchaseOrderId,
  )

  // A rejected PO falls back to draft — the maker keeps the text and fixes

  // it; `cancelled` is a deliberate act, not an approval outcome.

  if (approved) {
    notifyRecipients(tenantId, [row.created_by_user_id], {
      type: "purchase_order_received",

      title: `PO ${row.po_number} approved`,

      body: "It can now be sent to the supplier.",

      linkPath: "/procurement",
    })
  } else {
    notifyRecipients(tenantId, [row.created_by_user_id], {
      type: "requisition_decided",

      title: `PO ${row.po_number} rejected`,

      body: "It is back in draft — see the approvals queue for the note.",

      linkPath: "/procurement",
    })
  }

  return purchaseOrderId
}

/** POST /api/procurement/purchase-orders/:id/send — approved to supplier. */

export async function sendPurchaseOrder(ctx: RequestContext) {
  const guarded = requirePermission(
    requireAuth(ctx),

    "procurement",

    "edit",
  )

  const row = loadScoped<PoRow>(
    guarded,
    "purchase_orders",
    ctx.params.poId!,
    "purchase order",
  )

  if (row.status !== "approved") {
    throw conflict("Only an approved purchase order can be sent.")
  }

  run(
    `UPDATE purchase_orders SET status = 'sent', updated_at = ?
      WHERE tenant_id = ? AND id = ?`,

    now(),

    guarded.tenantId,

    row.id,
  )

  writeAudit(
    guarded,
    "procurement.po.send",
    "purchase_order",
    row.id,
    { poNumber: row.po_number },
    ctx.ip,
  )

  return {
    purchaseOrder: toPurchaseOrder(loadPoRow(guarded.tenantId, row.id)!),
  }
}

/** POST /api/procurement/purchase-orders/:id/close-or-cancel */

export async function closePurchaseOrder(ctx: RequestContext) {
  const guarded = requirePermission(
    requireAuth(ctx),

    "procurement",

    "edit",
  )

  const row = loadScoped<PoRow>(
    guarded,
    "purchase_orders",
    ctx.params.poId!,
    "purchase order",
  )

  const body = await readJsonBody<{ action?: unknown }>(ctx.req)

  const action = body.action === "cancel" ? "cancel" : "close"

  const closeable = ["received", "partially_received", "sent", "approved"]

  const cancellable = [
    "draft",
    "pending_approval",
    "approved",
    "sent",
    "partially_received",
  ]

  if (action === "close" && !closeable.includes(row.status)) {
    throw conflict(
      `A ${row.status.replace(/_/g, " ")} purchase order cannot be closed.`,
    )
  }

  if (action === "cancel" && !cancellable.includes(row.status)) {
    throw conflict(
      `A ${row.status.replace(/_/g, " ")} purchase order cannot be cancelled.`,
    )
  }

  run(
    `UPDATE purchase_orders SET status = ?, updated_at = ?
      WHERE tenant_id = ? AND id = ?`,

    action === "close" ? "closed" : "cancelled",

    now(),

    guarded.tenantId,

    row.id,
  )

  writeAudit(
    guarded,

    action === "close" ? "procurement.po.close" : "procurement.po.cancel",

    "purchase_order",

    row.id,

    { poNumber: row.po_number },

    ctx.ip,
  )

  return {
    purchaseOrder: toPurchaseOrder(loadPoRow(guarded.tenantId, row.id)!),
  }
}

// --- Goods receipts --------------------------------------------------------------------------

type GrnRow = {
  id: string

  grn_number: string

  purchase_order_id: string

  received_at: string

  note: string | null

  status: string

  invoice_id: string | null

  actor_name: string

  created_at: string
}

const GRN_SELECT = `
  SELECT n.* FROM goods_receipt_notes n
`

function toGrn(
  row: GrnRow,
  poNumber: string,
  vendorName: string,
): GoodsReceiptView {
  const lineRows = all<{
    id: string

    po_line_id: string

    quantity: number

    note: string | null

    description: string | null

    unit_price: number | null
  }>(
    `SELECT g.id, g.po_line_id, g.quantity, g.note,
            l.description, l.unit_price
       FROM goods_receipt_lines g
       LEFT JOIN purchase_order_lines l ON l.id = g.po_line_id
      WHERE g.grn_id = ?`,

    row.id,
  )

  const totalValue = lineRows.every((line) => line.unit_price == null)
    ? null
    : lineRows.reduce(
        (sum, line) => sum + line.quantity * Number(line.unit_price ?? 0),

        0,
      )

  return {
    id: row.id,

    grnNumber: row.grn_number,

    purchaseOrderId: row.purchase_order_id,

    poNumber,

    vendorName,

    receivedAt: row.received_at,

    status: row.status,

    totalValue,

    lines: lineRows.map(
      (line): GoodsReceiptLineView => ({
        id: line.id,

        poLineId: line.po_line_id,

        lineDescription: line.description ?? "—",

        quantity: Number(line.quantity),

        note: line.note,
      }),
    ),

    invoiceId: row.invoice_id,

    actorName: row.actor_name,

    createdAt: row.created_at,
  }
}

/**
 * Recompute a PO's receipt status from live rows. Only ever moves between
 * sent / partially_received / received; any other status is left alone, so
 * a closed order never reopens itself through the back door of a GRN.
 */

function restockPoStatus(tenantId: string, poId: string): void {
  const po = get<{ status: string }>(
    "SELECT status FROM purchase_orders WHERE tenant_id = ? AND id = ?",

    tenantId,

    poId,
  )

  if (
    !po ||
    !PO_OPEN_STATUSES.includes(po.status as typeof PO_OPEN_STATUSES[number])
  ) {
    return
  }

  const rows = all<PoLineReceivedRow>(
    `${PO_LINE_SELECT} WHERE l.purchase_order_id = ?`,

    poId,
  )

  const outstanding = rows.some(
    (line) => Number(line.received) < Number(line.quantity),
  )

  run(
    `UPDATE purchase_orders SET status = ?, updated_at = ? WHERE tenant_id = ? AND id = ?`,

    outstanding ? "partially_received" : "received",

    now(),

    tenantId,

    poId,
  )
}

/**
 * POST /api/procurement/purchase-orders/:id/receipts — record what arrived.
 * Every material-linked line writes its `receipt` movement in the same
 * transaction, so stock and receipt cannot disagree. With `createInvoice`,
 * an ordinary open vendor invoice (tagged to the PO, added to the vendor
 * ledger) is raised for the received value at the PO's prices.
 */

export async function createGoodsReceipt(ctx: RequestContext) {
  const guarded = requirePermission(
    requireAuth(ctx),

    "procurement",

    "edit",
  )

  const po = loadScoped<PoRow>(
    guarded,
    "purchase_orders",
    ctx.params.poId!,
    "purchase order",
  )

  if (
    !PO_OPEN_STATUSES.includes(po.status as typeof PO_OPEN_STATUSES[number])
  ) {
    throw conflict(
      "Receipts are only recorded against a sent or partially received order.",
    )
  }

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const errors: Record<string, string> = {}

  const receivedAt =
    (typeof body.receivedAt === "string" && body.receivedAt.trim()) || now()

  const note = bounded(body.note, 500, "note", errors)

  const createInvoice = body.createInvoice === true

  const rawLines = Array.isArray(body.lines) ? body.lines : []

  if (rawLines.length === 0) errors.lines = "Record at least one received line."

  interface DraftReceipt {
    poLineId: string

    quantity: number

    note: string | null
  }

  const receipts: DraftReceipt[] = []

  for (const [index, entry] of rawLines.entries()) {
    const item = (entry ?? {}) as Record<string, unknown>

    const poLineId = typeof item.poLineId === "string" ? item.poLineId : ""

    const quantity = quantityOf(item.quantity, `line${index}`, errors)

    const lineNote = bounded(item.note, 200, `line${index}`, errors)

    receipts.push({ poLineId, quantity: quantity ?? 0, note: lineNote })
  }

  if (Object.keys(errors).length > 0) {
    throw badRequest("Check the highlighted fields", errors)
  }

  // Over-receipt is refused, not warned: more arrived than was ordered is a

  // fact to resolve with the supplier, and the fix is a corrected GRN or a

  // new PO line — never a silent negative variance.

  for (const receipt of receipts) {
    const line = get<{
      id: string

      material_id: string | null

      quantity: number

      unit_price: number

      description: string
    }>(
      `SELECT id, material_id, quantity, unit_price, description
         FROM purchase_order_lines
        WHERE tenant_id = ? AND purchase_order_id = ? AND id = ?`,

      guarded.tenantId,

      po.id,

      receipt.poLineId,
    )

    if (!line) {
      throw badRequest("A line does not belong to this order.", {
        lines: "Pick lines from this purchase order.",
      })
    }

    const already = Number(
      get<{ s: number }>(
        `SELECT COALESCE(SUM(g.quantity), 0) AS s FROM goods_receipt_lines g
           JOIN goods_receipt_notes n ON n.id = g.grn_id
          WHERE g.po_line_id = ? AND n.status = 'recorded'`,

        line.id,
      )?.s ?? 0,
    )

    if (already + receipt.quantity > Number(line.quantity)) {
      throw badRequest(
        `Receiving ${already + receipt.quantity} would exceed the ${line.quantity} ordered.`,

        {
          lines: "Record only what actually arrived against each line.",
        },
      )
    }
  }

  const grnId = idFor("grn")

  const stamp = now()

  let invoiceId: string | null = null

  let grnNumber = ""

  const receivedValue = transaction(() => {
    grnNumber = `GRN-${new Date().getFullYear()}-${Math.floor(
      Math.random() * 900000 + 100000,
    )}`

    run(
      `INSERT INTO goods_receipt_notes (
          id, tenant_id, grn_number, purchase_order_id, project_id,
          received_at, note, status, actor_user_id, actor_name, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'recorded', ?, ?, ?)`,

      grnId,

      guarded.tenantId,

      grnNumber,

      po.id,

      po.project_id,

      receivedAt,

      note,

      guarded.userId,

      guarded.session.user.fullName,

      stamp,
    )

    let value = 0

    for (const receipt of receipts) {
      const line = get<{
        id: string

        material_id: string | null

        unit_price: number
      }>(
        `SELECT id, material_id, unit_price FROM purchase_order_lines
          WHERE tenant_id = ? AND id = ?`,

        guarded.tenantId,

        receipt.poLineId,
      )

      if (!line) continue

      run(
        `INSERT INTO goods_receipt_lines (
            id, tenant_id, grn_id, po_line_id, material_id, quantity, note
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,

        idFor("grl"),

        guarded.tenantId,

        grnId,

        line.id,

        line.material_id,

        receipt.quantity,

        receipt.note,
      )

      value += receipt.quantity * Number(line.unit_price)

      if (line.material_id) {
        run(
          `INSERT INTO stock_movements (
              id, tenant_id, material_id, type, quantity, note, project_id,
              purchase_order_id, grn_id, actor_user_id, actor_name, created_at
            ) VALUES (?, ?, ?, 'receipt', ?, ?, ?, ?, ?, ?, ?, ?)`,

          idFor("svm"),

          guarded.tenantId,

          line.material_id,

          receipt.quantity,

          `Received on ${grnNumber}`,

          po.project_id,

          po.id,

          grnId,

          guarded.userId,

          guarded.session.user.fullName,

          stamp,
        )
      }
    }

    restockPoStatus(guarded.tenantId, po.id)

    if (createInvoice && value > 0) {
      // The payable is an ordinary vendor invoice: reference derived from

      // the GRN number, uniqueness retried once, ledger appended through

      // the vendors module's single writer.

      const base = po.currency === "x" ? "" : `${grnNumber}`

      let reference = base.slice(0, REFERENCE_MAX)

      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          invoiceId = idFor("vin")

          run(
            `INSERT INTO vendor_invoices (
                id, tenant_id, vendor_id, contract_id, reference, amount,
                currency, issued_at, due_at, status, note,
                purchase_order_id, created_at
              ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, NULL, 'open', ?, ?, ?)`,

            invoiceId,

            guarded.tenantId,

            po.vendor_id,

            reference,

            value,

            po.currency,

            receivedAt,

            `Raised from goods receipt ${grnNumber} for PO ${po.po_number}`,

            po.id,

            stamp,
          )

          break
        } catch (error) {
          invoiceId = null

          if (!isUniqueViolation(error) || attempt === 2) throw error

          reference = `${base}-${attempt + 1}`.slice(0, REFERENCE_MAX)
        }
      }

      if (invoiceId) {
        run(
          "UPDATE goods_receipt_notes SET invoice_id = ? WHERE id = ?",

          invoiceId,

          grnId,
        )

        appendVendorLedger(guarded.tenantId, {
          vendorId: po.vendor_id,

          kind: "invoice",

          amount: value,

          currency: po.currency,

          reference,

          invoiceId,

          contractId: null,

          sourceType: "goods_receipt",

          sourceId: grnId,

          occurredAt: receivedAt,

          note: `From ${grnNumber}`,

          recordedByUserId: guarded.userId,

          recordedByName: guarded.session.user.fullName,
        })
      }
    }

    return value
  })

  writeAudit(
    guarded,

    "procurement.grn.create",

    "goods_receipt",

    grnId,

    { poId: po.id, lines: receipts.length, receivedValue, invoiceId },

    ctx.ip,
  )

  if (po.created_by_user_id !== guarded.userId) {
    notifyRecipients(guarded.tenantId, [po.created_by_user_id], {
      type: "purchase_order_received",

      title: `Goods received against PO ${po.po_number}`,

      body: `${grnNumber} recorded by ${guarded.session.user.fullName}.`,

      linkPath: "/procurement",
    })
  }

  const grn = get<GrnRow>(
    `${GRN_SELECT} WHERE n.tenant_id = ? AND n.id = ?`,
    guarded.tenantId,
    grnId,
  )!

  const invoice = invoiceId
    ? get<{
        id: string

        reference: string

        amount: number

        currency: string

        status: string

        issued_at: string

        due_at: string | null
      }>(
        `SELECT id, reference, amount, currency, status, issued_at, due_at
           FROM vendor_invoices WHERE tenant_id = ? AND id = ?`,

        guarded.tenantId,

        invoiceId,
      )
    : null

  return {
    receipt: toGrn(grn, po.po_number, po.vendor_name ?? "—"),

    purchaseOrder: toPurchaseOrder(loadPoRow(guarded.tenantId, po.id)!),

    invoice: invoice
      ? {
          id: invoice.id,

          reference: invoice.reference,

          vendorName: po.vendor_name ?? "—",

          amount: Number(invoice.amount),

          currency: invoice.currency,

          status: invoice.status,

          issuedAt: invoice.issued_at,

          dueAt: invoice.due_at,

          fromGrnId: grnId,
        }
      : null,
  }
}

/**
 * POST /api/procurement/receipts/:id/void — a GRN is never deleted. It is
 * voided, its movements are offset by signed adjustments, and any invoice it
 * raised is voided too (with the vendors module's equal-and-opposite ledger
 * row), so the trail explains the retraction.
 */

export async function voidGoodsReceipt(ctx: RequestContext) {
  const guarded = requirePermission(
    requireAuth(ctx),

    "procurement",

    "edit",
  )

  const grn = loadScoped<GrnRow>(
    guarded,
    "goods_receipt_notes",
    ctx.params.grnId!,
    "goods receipt",
  )

  if (grn.status === "voided") throw conflict("This receipt is already voided.")

  transaction(() => {
    const lines = all<{
      id: string

      material_id: string | null

      quantity: number

      po_line_id: string
    }>(
      `SELECT id, material_id, quantity, po_line_id FROM goods_receipt_lines
        WHERE tenant_id = ? AND grn_id = ?`,

      guarded.tenantId,

      grn.id,
    )

    for (const line of lines) {
      if (!line.material_id) continue

      run(
        `INSERT INTO stock_movements (
            id, tenant_id, material_id, type, quantity, note, grn_id,
            purchase_order_id, actor_user_id, actor_name, created_at
          ) VALUES (?, ?, ?, 'adjustment', ?, ?, ?,
                    (SELECT purchase_order_id FROM goods_receipt_notes WHERE id = ?),
                    ?, ?, ?)`,

        idFor("svm"),

        guarded.tenantId,

        line.material_id,

        -Number(line.quantity),

        `Offset of voided receipt ${grn.grn_number}`,

        grn.id,

        grn.id,

        guarded.userId,

        guarded.session.user.fullName,

        now(),
      )
    }

    run(
      "UPDATE goods_receipt_notes SET status = 'voided' WHERE tenant_id = ? AND id = ?",

      guarded.tenantId,

      grn.id,
    )

    const purchaseOrderId = get<{ purchase_order_id: string }>(
      "SELECT purchase_order_id FROM goods_receipt_notes WHERE id = ?",

      grn.id,
    )?.purchase_order_id

    if (purchaseOrderId) {
      restockPoStatus(guarded.tenantId, purchaseOrderId)
    }

    if (grn.invoice_id) {
      const invoice = get<{
        id: string
        vendor_id: string
        amount: number
        currency: string
        status: string
        reference: string
      }>(
        `SELECT id, vendor_id, amount, currency, status, reference
           FROM vendor_invoices WHERE tenant_id = ? AND id = ?`,

        guarded.tenantId,

        grn.invoice_id,
      )

      if (invoice && invoice.status === "open") {
        run(
          `UPDATE vendor_invoices
              SET status = 'void', note = COALESCE(note, '') || ' — voided with receipt ' || ?
            WHERE tenant_id = ? AND id = ?`,

          grn.grn_number,

          guarded.tenantId,

          invoice.id,
        )

        appendVendorLedger(guarded.tenantId, {
          vendorId: invoice.vendor_id,

          kind: "adjustment",

          // Equal and opposite: the payable trail stays consistent.

          amount: -Number(invoice.amount),

          currency: invoice.currency,

          reference: invoice.reference,

          invoiceId: invoice.id,

          contractId: null,

          sourceType: "goods_receipt_void",

          sourceId: grn.id,

          occurredAt: now(),

          note: `Receipt ${grn.grn_number} voided`,

          recordedByUserId: guarded.userId,

          recordedByName: guarded.session.user.fullName,
        })
      }
    }
  })

  writeAudit(
    guarded,
    "procurement.grn.void",
    "goods_receipt",
    grn.id,
    { grnNumber: grn.grn_number },
    ctx.ip,
  )

  const fresh = get<GrnRow>(
    `${GRN_SELECT} WHERE n.tenant_id = ? AND n.id = ?`,

    guarded.tenantId,

    grn.id,
  )!

  const po = loadPoRow(guarded.tenantId, fresh.purchase_order_id)

  return {
    receipt: toGrn(fresh, po?.po_number ?? "—", po?.vendor_name ?? "—"),

    purchaseOrder: po ? toPurchaseOrder(po) : null,
  }
}
