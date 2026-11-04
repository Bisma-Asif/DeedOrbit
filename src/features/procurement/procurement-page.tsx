/**
 * The procurement hub.
 *
 * Three surfaces share one page — requisitions, purchase orders, and materials —
 * because they are one trail: a request becomes an order becomes a receipt
 * becomes stock. The stat row counts what is genuinely open (a requisition
 * awaiting its decision, an order that can still take receipts, a material under
 * the target its manager set); none of it is inferred.
 *
 * The materials tab keeps the module's central rule visible: on-hand is never a
 * typed number, it is the SUM of a material's movements, so picking a material
 * opens its ledger and the only way to change the count outside a receipt is to
 * record a signed movement.
 */

import { useMemo, useState } from "react"

import {
  Boxes,
  ClipboardList,
  PackageMinus,
  Plus,
  ShoppingCart,
  TriangleAlert,
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

import { EmptyState } from "@/components/empty-state"

import { PageHeader } from "@/components/page-header"

import { Skeleton } from "@/components/ui/skeleton"

import { StatCard } from "@/components/stat-card"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

import {
  MaterialFormDialog,
  StockAdjustDialog,
} from "@/features/procurement/material-dialogs"

import { PurchaseOrderFormDialog } from "@/features/procurement/purchase-order-form-dialog"

import { RequisitionFormDialog } from "@/features/procurement/requisition-form-dialog"

import {
  movementTypeTone,
  poStatusTone,
  requisitionStatusTone,
} from "@/features/procurement/procurement-bits"

import { procurementApi } from "@/lib/procurement-api"

import { formatCurrency, formatDate, orDash } from "@/lib/format"

import { navigate } from "@/lib/router"

import { useSession } from "@/lib/session-context"

import { useAsyncResource } from "@/lib/use-async-resource"

import type {
  MaterialView,
  PurchaseOrderView,
  RequisitionView,
  StockMovementView,
} from "@shared/procurement"

// The requisition and PO statuses that still have work outstanding. A

// requisition "awaits approval" only while submitted; a PO is open until it is

// received, closed, or cancelled — those four terminal states are excluded.

const REQUISITION_PENDING: string[] = ["submitted"]

const PO_OPEN: string[] = [
  "draft",

  "pending_approval",

  "approved",

  "sent",

  "partially_received",
]

function money(value: number, currency: string): string {
  return formatCurrency(value, currency, { maximumFractionDigits: 0 })
}

export function ProcurementPage() {
  const session = useSession()

  const canView = session.can("procurement", "view")

  const requisitions = useAsyncResource(
    (signal) => procurementApi.listRequisitions(undefined, signal),

    canView,
  )

  const orders = useAsyncResource(
    (signal) => procurementApi.listPurchaseOrders(undefined, signal),

    canView,
  )

  const materials = useAsyncResource(
    (signal) => procurementApi.listMaterials(undefined, undefined, signal),

    canView,
  )

  const [tab, setTab] = useState("requisitions")

  const [creatingRequisition, setCreatingRequisition] = useState(false)

  const [creatingOrder, setCreatingOrder] = useState(false)

  const [creatingMaterial, setCreatingMaterial] = useState(false)

  const requisitionRows = requisitions.data?.requisitions ?? []

  const orderRows = orders.data?.purchaseOrders ?? []

  const materialRows = useMemo(
    () => materials.data?.materials ?? [],

    [materials.data],
  )

  const canCreateRequisition = requisitions.data?.canCreate ?? false

  const canCreateOrder = orders.data?.canCreate ?? false

  const canManageMaterials = materials.data?.canManage ?? false

  const pendingRequisitions = requisitionRows.filter((row) =>
    REQUISITION_PENDING.includes(row.status),
  ).length

  const openOrders = orderRows.filter((row) =>
    PO_OPEN.includes(row.status),
  ).length

  const belowTarget = materials.data?.belowTargetCount ?? 0

  if (!canView) {
    return (
      <EmptyState
        icon={ShoppingCart}
        title="Procurement is not available to your role"
        description="Ask a workspace administrator for the procurement grant."
        tone="pending"
      />
    )
  }

  const primaryAction = () => {
    if (tab === "requisitions" && canCreateRequisition) {
      return (
        <Button size="sm" onClick={() => setCreatingRequisition(true)}>
          <Plus size={14} />
          New requisition
        </Button>
      )
    }

    if (tab === "orders" && canCreateOrder) {
      return (
        <Button size="sm" onClick={() => setCreatingOrder(true)}>
          <Plus size={14} />
          New purchase order
        </Button>
      )
    }

    if (tab === "materials" && canManageMaterials) {
      return (
        <Button size="sm" onClick={() => setCreatingMaterial(true)}>
          <Plus size={14} />
          New material
        </Button>
      )
    }

    return null
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Procurement"
        description="Requisitions, purchase orders, and stock. Suppliers stay on the vendor ledger — this links to them, never duplicates them."
        actions={primaryAction()}
        tabs={
          <Tabs
            value={tab}
            onValueChange={setTab}
            className="flex flex-col gap-4"
          >
            <TabsList>
              <TabsTrigger value="requisitions">
                <ClipboardList size={13} />
                Requisitions
              </TabsTrigger>
              <TabsTrigger value="orders">
                <ShoppingCart size={13} />
                Purchase orders
              </TabsTrigger>
              <TabsTrigger value="materials">
                <Boxes size={13} />
                Materials
              </TabsTrigger>
            </TabsList>
          </Tabs>
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard
          label="Awaiting approval"
          value={requisitions.loading ? undefined : pendingRequisitions}
          hint="Requisitions submitted, not yet decided"
          icon={ClipboardList}
        />
        <StatCard
          label="Open orders"
          value={orders.loading ? undefined : openOrders}
          hint="Purchase orders not yet received or closed"
          icon={ShoppingCart}
        />
        <StatCard
          label="Below target"
          value={materials.loading ? undefined : belowTarget}
          hint="Materials under the stock floor their manager set"
          icon={TriangleAlert}
        />
      </div>

      <div className="flex flex-col gap-4">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsContent value="requisitions" className="mt-0">
            <RequisitionTab
              rows={requisitionRows}
              loading={requisitions.loading && !requisitions.data}
              error={requisitions.error}
              canCreate={canCreateRequisition}
              onCreate={() => setCreatingRequisition(true)}
            />
          </TabsContent>

          <TabsContent value="orders" className="mt-0">
            <OrderTab
              rows={orderRows}
              loading={orders.loading && !orders.data}
              error={orders.error}
              canCreate={canCreateOrder}
              onCreate={() => setCreatingOrder(true)}
            />
          </TabsContent>

          <TabsContent value="materials" className="mt-0">
            <MaterialsTab
              rows={materialRows}
              loading={materials.loading && !materials.data}
              error={materials.error}
              canManage={canManageMaterials}
              onCreate={() => setCreatingMaterial(true)}
              onStockChanged={() => {
                void materials.reload()
              }}
            />
          </TabsContent>
        </Tabs>
      </div>

      <RequisitionFormDialog
        open={creatingRequisition}
        onOpenChange={setCreatingRequisition}
        onSaved={() => {
          void requisitions.reload()
        }}
      />

      <PurchaseOrderFormDialog
        open={creatingOrder}
        onOpenChange={setCreatingOrder}
        onCreated={(order) => {
          void orders.reload()

          navigate(`/procurement/po/${order.id}`)
        }}
      />

      <MaterialFormDialog
        open={creatingMaterial}
        onOpenChange={setCreatingMaterial}
        onSaved={() => {
          void materials.reload()
        }}
      />
    </div>
  )
}

interface RequisitionTabProps {
  rows: RequisitionView[]

  loading: boolean

  error: string | null

  canCreate: boolean

  onCreate: () => void
}

function RequisitionTab({
  rows,

  loading,

  error,

  canCreate,

  onCreate,
}: RequisitionTabProps) {
  if (loading) return <Skeleton className="h-64 w-full" />

  if (error) {
    return (
      <Alert variant="danger">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    )
  }

  if (rows.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={ClipboardList}
          title="No requisitions yet"
          description="A requisition is how a need gets raised and sent into approvals before anything is bought."
          action={
            canCreate ? (
              <Button size="sm" onClick={onCreate}>
                <Plus size={14} />
                New requisition
              </Button>
            ) : undefined
          }
        />
      </Card>
    )
  }

  return (
    <Card>
      <CardContent className="flex flex-col py-1">
        {rows.map((row) => (
          <button
            key={row.id}
            type="button"
            onClick={() => navigate(`/procurement/requisitions/${row.id}`)}
            className="flex items-center justify-between gap-3 border-b border-border py-2.5 text-left last:border-b-0 hover:bg-muted/40"
          >
            <div className="min-w-0">
              <p className="flex items-center gap-2 truncate text-[13px] font-medium text-foreground">
                {row.reference}
                <Badge variant={requisitionStatusTone(row.status)}>
                  {row.statusLabel}
                </Badge>
              </p>
              <p className="truncate text-[11.5px] text-muted-foreground">
                {row.justification}
                {row.projectName ? ` · ${row.projectName}` : ""}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-[12.5px] tabular-nums text-foreground">
                {row.estimatedAmount === null
                  ? "—"
                  : money(row.estimatedAmount, row.currency)}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {row.neededBy ? `by ${formatDate(row.neededBy)}` : "no date"}
              </p>
            </div>
          </button>
        ))}
      </CardContent>
    </Card>
  )
}

interface OrderTabProps {
  rows: PurchaseOrderView[]

  loading: boolean

  error: string | null

  canCreate: boolean

  onCreate: () => void
}

function OrderTab({
  rows,
  loading,
  error,
  canCreate,
  onCreate,
}: OrderTabProps) {
  if (loading) return <Skeleton className="h-64 w-full" />

  if (error) {
    return (
      <Alert variant="danger">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    )
  }

  if (rows.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={ShoppingCart}
          title="No purchase orders yet"
          description="Raise an order against a supplier, or convert an approved requisition into one."
          action={
            canCreate ? (
              <Button size="sm" onClick={onCreate}>
                <Plus size={14} />
                New purchase order
              </Button>
            ) : undefined
          }
        />
      </Card>
    )
  }

  return (
    <Card>
      <CardContent className="flex flex-col py-1">
        {rows.map((row) => (
          <button
            key={row.id}
            type="button"
            onClick={() => navigate(`/procurement/po/${row.id}`)}
            className="flex items-center justify-between gap-3 border-b border-border py-2.5 text-left last:border-b-0 hover:bg-muted/40"
          >
            <div className="min-w-0">
              <p className="flex items-center gap-2 truncate text-[13px] font-medium text-foreground">
                {row.poNumber}
                <Badge variant={poStatusTone(row.status)}>
                  {row.statusLabel}
                </Badge>
              </p>
              <p className="truncate text-[11.5px] text-muted-foreground">
                {row.vendorName}
                {row.projectLabel ? ` · ${row.projectLabel}` : ""}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-[12.5px] tabular-nums text-foreground">
                {money(row.totalAmount, row.currency)}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {row.receivedValue === null
                  ? "not received"
                  : `${money(row.receivedValue, row.currency)} received`}
              </p>
            </div>
          </button>
        ))}
      </CardContent>
    </Card>
  )
}

interface MaterialsTabProps {
  rows: MaterialView[]

  loading: boolean

  error: string | null

  canManage: boolean

  onCreate: () => void

  onStockChanged: () => void
}

function MaterialsTab({
  rows,

  loading,

  error,

  canManage,

  onCreate,

  onStockChanged,
}: MaterialsTabProps) {
  const [selectedId, setSelectedId] = useState<string>("")

  const [editing, setEditing] = useState<MaterialView | null>(null)

  if (loading) return <Skeleton className="h-64 w-full" />

  if (error) {
    return (
      <Alert variant="danger">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    )
  }

  if (rows.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={Boxes}
          title="No materials yet"
          description="Materials are the stock master. On-hand is never typed — it is the sum of each material's movements."
          action={
            canManage ? (
              <Button size="sm" onClick={onCreate}>
                <Plus size={14} />
                New material
              </Button>
            ) : undefined
          }
        />
      </Card>
    )
  }

  const selected = rows.find((row) => row.id === selectedId) ?? null

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.4fr_1fr]">
      <Card>
        <CardHeader>
          <CardTitle>Materials</CardTitle>
          <CardDescription>
            Pick a material to read its movement ledger and adjust stock.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col py-1">
          {rows.map((row) => (
            <button
              key={row.id}
              type="button"
              onClick={() => setSelectedId(row.id)}
              className={
                row.id === selectedId
                  ? "flex items-center justify-between gap-3 border-b border-border py-2.5 text-left last:border-b-0 bg-muted/40"
                  : "flex items-center justify-between gap-3 border-b border-border py-2.5 text-left last:border-b-0 hover:bg-muted/40"
              }
            >
              <div className="min-w-0">
                <p className="flex items-center gap-2 truncate text-[13px] font-medium text-foreground">
                  {row.name}
                  {row.belowTarget ? (
                    <Badge variant="pending">Below target</Badge>
                  ) : null}
                </p>
                <p className="truncate text-[11.5px] text-muted-foreground">
                  {row.sku} · {row.categoryLabel}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-[12.5px] tabular-nums text-foreground">
                  {row.currentStock} {row.unitOfMeasure}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  target {row.targetStock === null ? "—" : row.targetStock}
                </p>
              </div>
            </button>
          ))}
        </CardContent>
      </Card>

      {selected ? (
        <MaterialLedger
          // Remount on selection so the ledger reloads for the new material

          // without the parent threading a reload signal down.

          key={selected.id}
          material={selected}
          canManage={canManage}
          onEdit={() => setEditing(selected)}
          onStockChanged={onStockChanged}
        />
      ) : (
        <Card>
          <EmptyState
            icon={Boxes}
            size="sm"
            title="No material selected"
            description="Choose one on the left to see its movements."
          />
        </Card>
      )}

      <MaterialFormDialog
        open={editing !== null}
        material={editing}
        onOpenChange={(open) => {
          if (!open) setEditing(null)
        }}
        onSaved={() => {
          setEditing(null)
        }}
      />
    </div>
  )
}

interface MaterialLedgerProps {
  material: MaterialView

  canManage: boolean

  onEdit: () => void

  onStockChanged: () => void
}

function MaterialLedger({
  material,

  canManage,

  onEdit,

  onStockChanged,
}: MaterialLedgerProps) {
  const movements = useAsyncResource(
    (signal) => procurementApi.listMovements(material.id, signal),

    true,
  )

  const [adjusting, setAdjusting] = useState(false)

  const rows: StockMovementView[] = movements.data?.movements ?? []

  return (
    <Card>
      <CardHeader>
        <CardTitle>{material.name} — movements</CardTitle>
        <CardDescription>
          On-hand {material.currentStock} {material.unitOfMeasure} · the sum of
          every row below.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 py-3">
        <div className="flex flex-wrap items-center gap-2">
          {canManage ? (
            <>
              <Button size="sm" onClick={() => setAdjusting(true)}>
                <PackageMinus size={13} />
                Adjust stock
              </Button>
              <Button variant="outline" size="sm" onClick={onEdit}>
                Edit material
              </Button>
            </>
          ) : null}
          {material.status !== "active" ? (
            <Badge variant="neutral">{material.status}</Badge>
          ) : null}
        </div>

        {movements.loading && !movements.data ? (
          <Skeleton className="h-32 w-full" />
        ) : movements.error ? (
          <Alert variant="danger">
            <AlertDescription>{movements.error}</AlertDescription>
          </Alert>
        ) : rows.length === 0 ? (
          <p className="py-2 text-[12.5px] text-muted-foreground">
            No movements recorded — on-hand is a genuine zero.
          </p>
        ) : (
          <div className="flex flex-col">
            {rows.map((movement) => (
              <div
                key={movement.id}
                className="flex items-center justify-between gap-2 border-b border-border py-2 last:border-b-0"
              >
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-[12.5px] font-medium text-foreground">
                    <Badge variant={movementTypeTone(movement.type)}>
                      {movement.typeLabel}
                    </Badge>
                    <span className="tabular-nums">
                      {movement.quantity > 0 ? "+" : ""}
                      {movement.quantity} {movement.unitOfMeasure ?? ""}
                    </span>
                  </p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {orDash(movement.note)} · {movement.actorName}
                    {movement.poNumber ? ` · ${movement.poNumber}` : ""}
                  </p>
                </div>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {formatDate(movement.createdAt)}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <StockAdjustDialog
        open={adjusting}
        onOpenChange={setAdjusting}
        material={material}
        onSaved={() => {
          void movements.reload()

          // The parent list shows on-hand too, so refresh it after a movement.

          onStockChanged()
        }}
      />
    </Card>
  )
}
