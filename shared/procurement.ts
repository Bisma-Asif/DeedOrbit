/**
 * Procurement vocabulary — the contract between the procurement routes and
 * the client screens.
 *
 * Two rules the whole module is built on. First, stock is *never stored*:
 * a material's on-hand quantity is the SUM of its movements, so a receipt,
 * an issue, and a correction are each a recorded fact and the number the
 * screen shows is arithmetic over them, not a column someone can forget to
 * update. Second, the three-way match (ordered / received / invoiced) shows
 * each figure from its own rows and a dash where nothing was recorded —
 * the platform does not infer that something arrived, or that it was billed.
 *
 * The supplier master stays `vendors`. A purchase order names one; a GRN
 * can raise one invoice against it. Nothing here duplicates the payable
 * trail — the invoice a GRN creates is an ordinary vendor invoice and lands
 * on the ordinary vendor ledger.
 */

// --- Materials -----------------------------------------------------------------

export const MATERIAL_CATEGORIES = [
  "material",

  "equipment",

  "consumable",

  "spare",
] as const

export type MaterialCategory = typeof MATERIAL_CATEGORIES[number]

export const MATERIAL_CATEGORY_LABELS: Record<MaterialCategory, string> = {
  material: "Material",

  equipment: "Equipment",

  consumable: "Consumable",

  spare: "Spare",
}

export const MOVEMENT_TYPES = [
  "receipt",
  "issue",
  "adjustment",
  "return",
] as const

export type MovementType = typeof MOVEMENT_TYPES[number]

export const MOVEMENT_TYPE_LABELS: Record<MovementType, string> = {
  receipt: "Received",

  issue: "Issued",

  adjustment: "Adjustment",

  return: "Returned",
}

export interface MaterialView {
  id: string

  sku: string

  name: string

  category: string

  categoryLabel: string

  unitOfMeasure: string

  /** The manager's target floor; null means no target was ever set — a dash. */

  targetStock: number | null

  /** SUM of movements. Zero is a real answer when nothing has moved. */

  currentStock: number

  /** False when there is no target to compare against, not a failure. */

  belowTarget: boolean

  notes: string | null

  status: string

  createdAt: string
}

export interface MaterialListResponse {
  materials: MaterialView[]

  /** Materials under their target — the only ones that qualify for the stat. */

  belowTargetCount: number

  /** Materials with a recorded movement in the last 30 days. */

  movementsThisMonth: number
}

export interface StockMovementView {
  id: string

  materialId: string

  materialName: string | null

  unitOfMeasure: string | null

  type: string

  typeLabel: string

  /** Signed for adjustments; receipts/issues/returns carry their direction. */

  quantity: number

  note: string | null

  projectName: string | null

  poNumber: string | null

  actorName: string

  createdAt: string
}

export interface MovementListResponse {
  movements: StockMovementView[]
}

// --- Requisitions ------------------------------------------------------------------

export const REQUISITION_STATUSES = [
  "draft",

  "submitted",

  "approved",

  "rejected",

  "converted",
] as const

export type RequisitionStatus = typeof REQUISITION_STATUSES[number]

export const REQUISITION_STATUS_LABELS: Record<RequisitionStatus, string> = {
  draft: "Draft",

  submitted: "Awaiting approval",

  approved: "Approved",

  rejected: "Rejected",

  converted: "Converted to PO",
}

/** One line of a requisition, stored as JSON on the row. */

export interface RequisitionLine {
  description: string

  quantity: number

  unit: string

  unitPrice: number | null
}

export interface RequisitionView {
  id: string

  reference: string

  justification: string

  neededBy: string | null

  projectId: string | null

  projectName: string | null

  phaseId: string | null

  currency: string

  /** Sum of lines with prices; null when any line is unpriced — never a guess. */

  estimatedAmount: number | null

  status: string

  statusLabel: string

  lines: RequisitionLine[]

  approvalId: string | null

  createdBy: string

  createdAt: string
}

export interface RequisitionListResponse {
  requisitions: RequisitionView[]
}

// --- Purchase orders -------------------------------------------------------------------

export const PO_STATUSES = [
  "draft",

  "pending_approval",

  "approved",

  "sent",

  "partially_received",

  "received",

  "closed",

  "cancelled",
] as const

export type PoStatus = typeof PO_STATUSES[number]

export const PO_STATUS_LABELS: Record<PoStatus, string> = {
  draft: "Draft",

  pending_approval: "Awaiting approval",

  approved: "Approved",

  sent: "Sent to supplier",

  partially_received: "Partially received",

  received: "Received",

  closed: "Closed",

  cancelled: "Cancelled",
}

/** The statuses a PO may sit in while receipts are still allowed. */

export const PO_OPEN_STATUSES: PoStatus[] = ["sent", "partially_received"]

export interface PurchaseOrderLineView {
  id: string

  description: string

  materialId: string | null

  materialName: string | null

  quantity: number

  unit: string

  unitPrice: number

  lineTotal: number

  /** SUM over receipt lines; 0 when nothing has arrived yet. */

  quantityReceived: number

  /** Invoiced quantity is not tracked line-by-line; the money match is. */

  invoicedAmount: number | null
}

export interface PurchaseOrderView {
  id: string

  poNumber: string

  vendorId: string

  vendorName: string

  requisitionId: string | null

  requisitionReference: string | null

  projectLabel: string | null

  status: string

  statusLabel: string

  currency: string

  totalAmount: number

  /** Received value derived from GRN lines priced at the PO's unit prices. */

  receivedValue: number | null

  /** Sum of live vendor invoices pointing at this PO; null when none exist. */

  invoicedValue: number | null

  lines: PurchaseOrderLineView[]

  notes: string | null

  createdBy: string

  createdAt: string
}

export interface PurchaseOrderListResponse {
  purchaseOrders: PurchaseOrderView[]
}

export interface PurchaseOrderDetail {
  purchaseOrder: PurchaseOrderView

  receipts: GoodsReceiptView[]

  invoices: PurchaseInvoiceView[]
}

// --- Goods receipts ----------------------------------------------------------------------

export const GRN_STATUSES = ["recorded", "voided"] as const

export type GrnStatus = typeof GRN_STATUSES[number]

export interface GoodsReceiptLineView {
  id: string

  poLineId: string

  lineDescription: string

  quantity: number

  note: string | null
}

export interface GoodsReceiptView {
  id: string

  grnNumber: string

  purchaseOrderId: string

  poNumber: string

  vendorName: string

  receivedAt: string

  status: string

  /** Received value at PO unit prices — the match's middle column. */

  totalValue: number | null

  lines: GoodsReceiptLineView[]

  invoiceId: string | null

  actorName: string

  createdAt: string
}

/** A vendor invoice as the procurement screen shows it. */

export interface PurchaseInvoiceView {
  id: string

  reference: string

  vendorName: string

  amount: number

  currency: string

  status: string

  issuedAt: string

  dueAt: string | null

  fromGrnId: string | null
}

export interface PurchaseOrderMutationResponse {
  ok: true

  purchaseOrder: PurchaseOrderView
}

export interface GrnMutationResponse {
  ok: true

  receipt: GoodsReceiptView

  purchaseOrder: PurchaseOrderView

  invoice: PurchaseInvoiceView | null
}

// --- Validation bounds ----------------------------------------------------------------------

export const REQUISITION_LINE_MAX = 50

export const PO_LINE_MAX = 100

export const LINE_QUANTITY_MAX = 1_000_000

export const UNIT_PRICE_MAX = 1_000_000_000_000

export const REFERENCE_MAX = 40

export function isRequisitionStatus(value: string): value is RequisitionStatus {
  return (REQUISITION_STATUSES as readonly string[]).includes(value)
}

export function isPoStatus(value: string): value is PoStatus {
  return (PO_STATUSES as readonly string[]).includes(value)
}

export function isMovementType(value: string): value is MovementType {
  return (MOVEMENT_TYPES as readonly string[]).includes(value)
}

export function isMaterialCategory(value: string): value is MaterialCategory {
  return (MATERIAL_CATEGORIES as readonly string[]).includes(value)
}
