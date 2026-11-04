/**
 * Typed client for the procurement module.
 *
 * Mirrors `server/routes/procurement.ts`. Two invariants the screens lean on:
 * a material's stock is never sent or stored here — it comes back as the SUM of
 * movements — and the three-way match columns (ordered / received / invoiced)
 * arrive as numbers or null, so a missing leg renders a dash rather than a
 * guess. The supplier master stays `vendors`; a PO names one, a GRN may raise an
 * ordinary vendor invoice against it.
 */

import type {
  GrnMutationResponse,
  MaterialListResponse,
  MovementListResponse,
  PurchaseOrderDetail,
  PurchaseOrderListResponse,
  PurchaseOrderView,
  RequisitionListResponse,
  RequisitionView,
} from "@shared/procurement"

import { api } from "./api"

// --- Materials -----------------------------------------------------------------

export interface MaterialListResult extends MaterialListResponse {
  canManage: boolean
}

export interface MaterialMutation {
  material: MaterialListResponse["materials"][number]
}

export type MovementListResult = MovementListResponse

export interface MaterialInput {
  sku: string

  name: string

  category?: string

  unitOfMeasure: string

  targetStock?: number | null

  notes?: string | null
}

export interface MaterialUpdateInput {
  name?: string

  category?: string

  unitOfMeasure?: string

  status?: string

  targetStock?: number | null

  notes?: string | null
}

export interface StockAdjustInput {
  type: string

  quantity: number

  note?: string | null

  projectId?: string | null
}

// --- Requisitions --------------------------------------------------------------

export interface RequisitionLineInput {
  description: string

  quantity: number

  unit: string

  unitPrice?: number | null
}

export interface RequisitionListResult extends RequisitionListResponse {
  canCreate: boolean

  canEdit: boolean
}

export interface RequisitionDetailResult {
  requisition: RequisitionView

  canEdit: boolean

  canConvert: boolean
}

export interface RequisitionMutation {
  requisition: RequisitionView
}

export interface RequisitionInput {
  justification: string

  neededBy?: string | null

  projectId?: string | null

  phaseId?: string | null

  currency?: string

  lines: RequisitionLineInput[]
}

export interface RequisitionUpdateInput {
  justification?: string

  neededBy?: string | null

  lines?: RequisitionLineInput[]
}

// --- Purchase orders -----------------------------------------------------------

export interface PurchaseOrderLineInput {
  description: string

  materialId?: string | null

  quantity: number

  unit: string

  unitPrice: number
}

export interface PurchaseOrderListResult extends PurchaseOrderListResponse {
  canCreate: boolean

  canEdit: boolean
}

export interface PurchaseOrderMutation {
  purchaseOrder: PurchaseOrderView
}

export interface PurchaseOrderInput {
  vendorId: string

  projectId?: string | null

  phaseId?: string | null

  currency?: string

  notes?: string | null

  lines: PurchaseOrderLineInput[]
}

export interface CloseOrCancelInput {
  action: "close" | "cancel"
}

// --- Goods receipts ------------------------------------------------------------

export interface GrnLineInput {
  poLineId: string

  quantity: number

  note?: string | null
}

export interface GrnInput {
  receivedAt?: string

  note?: string | null

  createInvoice?: boolean

  lines: GrnLineInput[]
}

export interface VoidGrnResult {
  receipt: GrnMutationResponse["receipt"]

  purchaseOrder: PurchaseOrderView | null
}

// --- Query helpers -------------------------------------------------------------

function materialQuery(search?: string, status?: string): string {
  const params = new URLSearchParams()

  if (search) params.set("search", search)

  if (status) params.set("status", status)

  const qs = params.toString()

  return qs ? `?${qs}` : ""
}

function movementQuery(materialId?: string): string {
  return materialId ? `?materialId=${encodeURIComponent(materialId)}` : ""
}

function statusQuery(status?: string): string {
  return status ? `?status=${encodeURIComponent(status)}` : ""
}

export const procurementApi = {
  // Materials

  listMaterials: (search?: string, status?: string, signal?: AbortSignal) =>
    api.get<MaterialListResult>(
      `/api/procurement/materials${materialQuery(search, status)}`,

      signal,
    ),

  createMaterial: (input: MaterialInput) =>
    api.post<MaterialMutation>("/api/procurement/materials", input),

  updateMaterial: (id: string, input: MaterialUpdateInput) =>
    api.patch<MaterialMutation>(`/api/procurement/materials/${id}`, input),

  listMovements: (materialId?: string, signal?: AbortSignal) =>
    api.get<MovementListResult>(
      `/api/procurement/movements${movementQuery(materialId)}`,

      signal,
    ),

  adjustStock: (materialId: string, input: StockAdjustInput) =>
    api.post<MaterialMutation>(
      `/api/procurement/materials/${materialId}/adjust`,

      input,
    ),

  // Requisitions

  listRequisitions: (status?: string, signal?: AbortSignal) =>
    api.get<RequisitionListResult>(
      `/api/procurement/requisitions${statusQuery(status)}`,

      signal,
    ),

  createRequisition: (input: RequisitionInput) =>
    api.post<RequisitionMutation>("/api/procurement/requisitions", input),

  getRequisition: (id: string, signal?: AbortSignal) =>
    api.get<RequisitionDetailResult>(
      `/api/procurement/requisitions/${id}`,

      signal,
    ),

  updateRequisition: (id: string, input: RequisitionUpdateInput) =>
    api.patch<RequisitionMutation>(
      `/api/procurement/requisitions/${id}`,

      input,
    ),

  submitRequisition: (id: string) =>
    api.post<RequisitionMutation>(`/api/procurement/requisitions/${id}/submit`),

  convertRequisition: (id: string, vendorId: string) =>
    api.post<PurchaseOrderMutation>(
      `/api/procurement/requisitions/${id}/convert`,

      { vendorId },
    ),

  // Purchase orders

  listPurchaseOrders: (status?: string, signal?: AbortSignal) =>
    api.get<PurchaseOrderListResult>(
      `/api/procurement/purchase-orders${statusQuery(status)}`,

      signal,
    ),

  createPurchaseOrder: (input: PurchaseOrderInput) =>
    api.post<PurchaseOrderMutation>(
      "/api/procurement/purchase-orders",

      input,
    ),

  getPurchaseOrder: (id: string, signal?: AbortSignal) =>
    api.get<PurchaseOrderDetail>(
      `/api/procurement/purchase-orders/${id}`,

      signal,
    ),

  submitPurchaseOrder: (id: string) =>
    api.post<PurchaseOrderMutation>(
      `/api/procurement/purchase-orders/${id}/submit`,
    ),

  sendPurchaseOrder: (id: string) =>
    api.post<PurchaseOrderMutation>(
      `/api/procurement/purchase-orders/${id}/send`,
    ),

  closePurchaseOrder: (id: string, action: "close" | "cancel") =>
    api.post<PurchaseOrderMutation>(
      `/api/procurement/purchase-orders/${id}/close-or-cancel`,

      { action } satisfies CloseOrCancelInput,
    ),

  createGoodsReceipt: (poId: string, input: GrnInput) =>
    api.post<GrnMutationResponse>(
      `/api/procurement/purchase-orders/${poId}/receipts`,

      input,
    ),

  voidGoodsReceipt: (grnId: string) =>
    api.post<VoidGrnResult>(`/api/procurement/receipts/${grnId}/void`),
}
