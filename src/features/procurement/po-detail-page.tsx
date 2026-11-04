/**
 * One purchase order in detail, with the three-way match.
 *
 * Each line reads ordered / received / invoiced from its own rows: ordered is
 * the PO, received is the sum over goods-receipt lines, invoiced is the money
 * actually billed against it. A missing leg is a dash, never a zero — the
 * platform does not infer that something arrived or that it was billed. The
 * header repeats the same three figures for the whole order.
 *
 * The actions follow the trail: a draft submits into approvals; an approved PO
 * is sent to the supplier; a sent/partially-received PO takes goods receipts;
 * and it can be closed when done or cancelled while it still can be. Approval
 * itself happens in the approvals queue, not here.
 */

import { useState } from "react"

import {
  ArrowLeft,
  Ban,
  CheckCheck,
  PackageCheck,
  Send,
  ShieldCheck,
  Undo2,
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

import { GrnDialog } from "@/features/procurement/grn-dialog"

import {
  grnStatusTone,
  matchValue,
  poStatusTone,
} from "@/features/procurement/procurement-bits"

import { procurementApi } from "@/lib/procurement-api"

import { formatCurrency, formatDate, orDash } from "@/lib/format"

import { navigate } from "@/lib/router"

import { useSession } from "@/lib/session-context"

import { useAsyncResource } from "@/lib/use-async-resource"

import { useSave } from "@/features/organization/use-save"

import type { PurchaseOrderLineView } from "@shared/procurement"

const CLOSEABLE = ["received", "partially_received", "sent", "approved"]

const CANCELLABLE = [
  "draft",

  "pending_approval",

  "approved",

  "sent",

  "partially_received",
]

interface PoDetailPageProps {
  poId: string
}

export function PoDetailPage({ poId }: PoDetailPageProps) {
  const session = useSession()

  const canView = session.can("procurement", "view")

  const canEdit = session.can("procurement", "edit")

  const resource = useAsyncResource(
    (signal) => procurementApi.getPurchaseOrder(poId, signal),

    canView,
  )

  const [receiving, setReceiving] = useState(false)

  const action = useSave()

  const detail = resource.data

  const po = detail?.purchaseOrder ?? null

  if (!canView) {
    return (
      <EmptyState
        icon={PackageCheck}
        title="Procurement is not available to your role"
        description="Ask a workspace administrator for the procurement grant."
        tone="pending"
      />
    )
  }

  async function runAction(mutate: () => Promise<unknown>) {
    const done = await action.run(async () => {
      await mutate()
    })

    if (done) await resource.reload()
  }

  if (resource.loading && !po) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (!po) {
    return (
      <EmptyState
        icon={PackageCheck}
        title="That purchase order does not exist"
        description="It may have been removed, or the link is wrong."
        action={
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate("/procurement")}
          >
            <ArrowLeft size={13} />
            Back to procurement
          </Button>
        }
      />
    )
  }

  const money = (value: number, currency: string) =>
    formatCurrency(value, currency, { maximumFractionDigits: 0 })

  const canReceive = po.status === "sent" || po.status === "partially_received"

  const actions = (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => navigate("/procurement")}
      >
        <ArrowLeft size={13} />
        Back
      </Button>
      {canEdit && po.status === "draft" ? (
        <Button
          size="sm"
          onClick={() =>
            void runAction(() => procurementApi.submitPurchaseOrder(po.id))
          }
          disabled={action.saving}
        >
          <Send size={13} />
          {action.saving ? "Submitting…" : "Submit for approval"}
        </Button>
      ) : null}
      {canEdit && po.status === "approved" ? (
        <Button
          size="sm"
          onClick={() =>
            void runAction(() => procurementApi.sendPurchaseOrder(po.id))
          }
          disabled={action.saving}
        >
          <ShieldCheck size={13} />
          {action.saving ? "Sending…" : "Send to supplier"}
        </Button>
      ) : null}
      {canEdit && canReceive ? (
        <Button size="sm" onClick={() => setReceiving(true)}>
          <PackageCheck size={13} />
          Receive goods
        </Button>
      ) : null}
      {canEdit && CLOSEABLE.includes(po.status) ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            void runAction(() =>
              procurementApi.closePurchaseOrder(po.id, "close"),
            )
          }
          disabled={action.saving}
        >
          <CheckCheck size={13} />
          Close
        </Button>
      ) : null}
      {canEdit && CANCELLABLE.includes(po.status) ? (
        <Button
          variant="danger-outline"
          size="sm"
          onClick={() =>
            void runAction(() =>
              procurementApi.closePurchaseOrder(po.id, "cancel"),
            )
          }
          disabled={action.saving}
        >
          <Ban size={13} />
          Cancel
        </Button>
      ) : null}
    </>
  )

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={po.poNumber}
        scope={
          <Badge variant={poStatusTone(po.status)}>{po.statusLabel}</Badge>
        }
        description={
          <>
            <button
              type="button"
              onClick={() => navigate(`/vendors/${po.vendorId}`)}
              className="text-foreground underline-offset-2 hover:underline"
            >
              {po.vendorName}
            </button>
            {po.requisitionReference
              ? ` · from requisition ${po.requisitionReference}`
              : ""}
            {po.projectLabel ? ` · ${po.projectLabel}` : ""}
          </>
        }
        actions={actions}
      />

      {action.error ? (
        <Alert variant="danger">
          <AlertDescription>{action.error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard
          label="Ordered"
          value={money(po.totalAmount, po.currency)}
          hint={
            po.requisitionReference
              ? `Converted from ${po.requisitionReference}`
              : "Purchase order total"
          }
        />
        <StatCard
          label="Received"
          value={
            po.receivedValue === null
              ? undefined
              : money(po.receivedValue, po.currency)
          }
          hint={
            po.receivedValue === null
              ? "Nothing received yet"
              : "At PO unit prices"
          }
        />
        <StatCard
          label="Invoiced"
          value={
            po.invoicedValue === null
              ? undefined
              : money(po.invoicedValue, po.currency)
          }
          hint={
            po.invoicedValue === null
              ? "No live invoice"
              : "Vendor invoices against this PO"
          }
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Lines</CardTitle>
          <CardDescription>
            Ordered, received, and invoiced per line. A dash means that leg was
            never recorded.
          </CardDescription>
        </CardHeader>
        <CardContent className="py-2">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[12.5px]">
              <thead>
                <tr className="text-[10.5px] uppercase tracking-[0.06em] text-muted-foreground">
                  <th className="py-1 pr-2 font-semibold">Description</th>
                  <th className="py-1 px-2 text-right font-semibold">
                    Ordered
                  </th>
                  <th className="py-1 px-2 text-right font-semibold">
                    Received
                  </th>
                  <th className="py-1 pl-2 text-right font-semibold">
                    Invoiced
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {po.lines.map((line: PurchaseOrderLineView) => (
                  <tr key={line.id}>
                    <td className="py-1.5 pr-2">
                      <p className="text-foreground">{line.description}</p>
                      {line.materialName ? (
                        <p className="text-[11px] text-muted-foreground">
                          {line.materialName}
                        </p>
                      ) : null}
                    </td>
                    <td className="py-1.5 px-2 text-right tabular-nums text-foreground">
                      {line.quantity} {line.unit}
                      <span className="block text-[11px] text-muted-foreground">
                        {money(line.lineTotal, po.currency)}
                      </span>
                    </td>
                    <td className="py-1.5 px-2 text-right tabular-nums text-foreground">
                      {line.quantityReceived} {line.unit}
                    </td>
                    <td className="py-1.5 pl-2 text-right tabular-nums text-foreground">
                      {matchValue(line.invoicedAmount, po.currency, money)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Goods receipts</CardTitle>
            <CardDescription>
              What arrived, newest last. A receipt is never deleted — it is
              voided, offset by a signed movement.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 py-2">
            {detail && detail.receipts.length === 0 ? (
              <p className="py-2 text-[12.5px] text-muted-foreground">
                No receipts recorded.
              </p>
            ) : (
              detail?.receipts.map((receipt) => (
                <div
                  key={receipt.id}
                  className="flex items-center justify-between gap-2 border-b border-border py-2 last:border-b-0"
                >
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-[13px] font-medium text-foreground">
                      {receipt.grnNumber}
                      <Badge variant={grnStatusTone(receipt.status)}>
                        {receipt.status}
                      </Badge>
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {formatDate(receipt.receivedAt)} ·{" "}
                      {receipt.totalValue === null
                        ? "—"
                        : money(receipt.totalValue, po.currency)}{" "}
                      · {receipt.actorName}
                    </p>
                  </div>
                  {canEdit && receipt.status === "recorded" ? (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() =>
                        void runAction(() =>
                          procurementApi.voidGoodsReceipt(receipt.id),
                        )
                      }
                      disabled={action.saving}
                      aria-label={`Void ${receipt.grnNumber}`}
                    >
                      <Undo2 size={13} />
                    </Button>
                  ) : null}
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Invoices</CardTitle>
            <CardDescription>
              Vendor invoices pointing at this order — the payable leg, on the
              ordinary vendor ledger.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 py-2">
            {detail && detail.invoices.length === 0 ? (
              <p className="py-2 text-[12.5px] text-muted-foreground">
                No invoices linked.
              </p>
            ) : (
              detail?.invoices.map((invoice) => (
                <div
                  key={invoice.id}
                  className="flex items-center justify-between gap-2 border-b border-border py-2 last:border-b-0"
                >
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-foreground">
                      {orDash(invoice.reference)}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {invoice.vendorName} ·{" "}
                      {formatCurrency(invoice.amount, invoice.currency, {
                        maximumFractionDigits: 0,
                      })}
                      {invoice.fromGrnId ? " · from a receipt" : ""}
                    </p>
                  </div>
                  <Badge
                    variant={invoice.status === "void" ? "danger" : "neutral"}
                  >
                    {invoice.status}
                  </Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <GrnDialog
        open={receiving}
        onOpenChange={setReceiving}
        purchaseOrder={po}
        onSaved={() => {
          void resource.reload()
        }}
      />
    </div>
  )
}
