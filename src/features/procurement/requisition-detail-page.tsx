/**
 * One purchase requisition in detail.
 *
 * The lines and the estimate are shown as recorded — an estimate is a dash when
 * any line is unpriced, never a guess. The actions follow the maker-checker
 * rule: a draft can be edited and submitted into the approvals queue; the
 * approve/reject decision happens there, not here; and only once approved may
 * it be converted into a purchase order against a chosen supplier. Converting
 * creates a draft PO and takes you to it, so the PO then runs its own submit →
 * approve → send trail.
 */

import { useMemo, useState } from "react"

import { ArrowLeft, FileText, Pencil, Send, ShoppingCart } from "lucide-react"

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
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

import { EmptyState } from "@/components/empty-state"

import { Field } from "@/components/field"

import { PageHeader } from "@/components/page-header"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

import { Skeleton } from "@/components/ui/skeleton"

import { RequisitionFormDialog } from "@/features/procurement/requisition-form-dialog"

import { requisitionStatusTone } from "@/features/procurement/procurement-bits"

import { procurementApi } from "@/lib/procurement-api"

import { vendorsApi } from "@/lib/vendors-api"

import { formatCurrency, formatDate, orDash } from "@/lib/format"

import { navigate } from "@/lib/router"

import { useSession } from "@/lib/session-context"

import { useAsyncResource } from "@/lib/use-async-resource"

import { useSave } from "@/features/organization/use-save"

interface RequisitionDetailPageProps {
  requisitionId: string
}

export function RequisitionDetailPage({
  requisitionId,
}: RequisitionDetailPageProps) {
  const session = useSession()

  const canView = session.can("procurement", "view")

  const resource = useAsyncResource(
    (signal) => procurementApi.getRequisition(requisitionId, signal),

    canView,
  )

  const [editing, setEditing] = useState(false)

  const [converting, setConverting] = useState(false)

  const [vendorId, setVendorId] = useState("")

  const action = useSave()

  const vendors = useAsyncResource(
    (signal) => vendorsApi.list({}, signal),

    canView,
  )

  const vendorOptions = useMemo(
    () => vendors.data?.vendors ?? [],

    [vendors.data],
  )

  const requisition = resource.data?.requisition ?? null

  const canEdit = resource.data?.canEdit ?? false

  const canConvert = resource.data?.canConvert ?? false

  if (!canView) {
    return (
      <EmptyState
        icon={FileText}
        title="Procurement is not available to your role"
        description="Ask a workspace administrator for the procurement grant."
        tone="pending"
      />
    )
  }

  async function runSubmit() {
    if (!requisition) return

    const done = await action.run(async () => {
      await procurementApi.submitRequisition(requisition.id)
    })

    if (done) await resource.reload()
  }

  async function runConvert() {
    if (!requisition || vendorId === "") return

    const done = await action.run(async () => {
      const result = await procurementApi.convertRequisition(
        requisition.id,

        vendorId,
      )

      navigate(`/procurement/po/${result.purchaseOrder.id}`)
    })

    if (done) setConverting(false)
  }

  if (resource.loading && !requisition) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-52 w-full" />
      </div>
    )
  }

  if (!requisition) {
    return (
      <EmptyState
        icon={FileText}
        title="That requisition does not exist"
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
      {canEdit ? (
        <>
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            <Pencil size={13} />
            Edit draft
          </Button>
          <Button
            size="sm"
            onClick={() => void runSubmit()}
            disabled={action.saving}
          >
            <Send size={13} />
            {action.saving ? "Submitting…" : "Submit for approval"}
          </Button>
        </>
      ) : null}
      {canConvert ? (
        <Button
          size="sm"
          onClick={() => {
            setVendorId("")

            setConverting(true)
          }}
        >
          <ShoppingCart size={13} />
          Convert to PO
        </Button>
      ) : null}
    </>
  )

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={requisition.reference}
        description={`Requisition · raised by ${requisition.createdBy} · ${formatDate(requisition.createdAt)}`}
        scope={
          <Badge variant={requisitionStatusTone(requisition.status)}>
            {requisition.statusLabel}
          </Badge>
        }
        actions={actions}
      />

      {action.error ? (
        <Alert variant="danger">
          <AlertDescription>{action.error}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Requisition</CardTitle>
          <CardDescription>
            What is needed and why. The estimate is only a number when every
            line is priced.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 py-2">
          <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Detail label="Justification" value={requisition.justification} />
            <Detail
              label="Needed by"
              value={
                requisition.neededBy ? formatDate(requisition.neededBy) : "—"
              }
            />
            <Detail label="Project" value={orDash(requisition.projectName)} />
            <Detail
              label="Estimated total"
              value={
                requisition.estimatedAmount === null
                  ? "— (some lines unpriced)"
                  : formatCurrency(
                      requisition.estimatedAmount,

                      requisition.currency,

                      { maximumFractionDigits: 0 },
                    )
              }
            />
          </dl>

          <div className="overflow-x-auto border-t border-border pt-3">
            <table className="w-full text-left text-[12.5px]">
              <thead>
                <tr className="text-[10.5px] uppercase tracking-[0.06em] text-muted-foreground">
                  <th className="py-1 pr-2 font-semibold">Description</th>
                  <th className="py-1 px-2 text-right font-semibold">Qty</th>
                  <th className="py-1 px-2 font-semibold">Unit</th>
                  <th className="py-1 pl-2 text-right font-semibold">
                    Unit price
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {requisition.lines.map((line, index) => (
                  <tr key={index}>
                    <td className="py-1.5 pr-2 text-foreground">
                      {line.description}
                    </td>
                    <td className="py-1.5 px-2 text-right tabular-nums text-foreground">
                      {line.quantity}
                    </td>
                    <td className="py-1.5 px-2 text-muted-foreground">
                      {line.unit}
                    </td>
                    <td className="py-1.5 pl-2 text-right tabular-nums text-foreground">
                      {line.unitPrice === null
                        ? "—"
                        : formatCurrency(line.unitPrice, requisition.currency, {
                            maximumFractionDigits: 0,
                          })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {requisition.approvalId ? (
            <p className="text-[12px] text-muted-foreground">
              Approval:{" "}
              <button
                type="button"
                onClick={() => navigate(`/approvals/${requisition.approvalId}`)}
                className="font-mono text-[12px] text-foreground underline-offset-2 hover:underline"
              >
                {requisition.approvalId}
              </button>
            </p>
          ) : null}
        </CardContent>
      </Card>

      <RequisitionFormDialog
        open={editing}
        requisition={requisition}
        onOpenChange={setEditing}
        onSaved={() => {
          void resource.reload()
        }}
      />

      <Dialog open={converting} onOpenChange={setConverting}>
        <DialogContent className="max-w-[30rem]">
          <DialogHeader>
            <DialogTitle>Convert to purchase order</DialogTitle>
            <DialogDescription>
              Creates a draft PO against the supplier you choose. The PO carries
              the requisition's lines and then runs its own approval trail.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Field label="Supplier" htmlFor="convert-vendor" required>
              <Select
                value={vendorId || "__none"}
                onValueChange={(value) =>
                  setVendorId(value === "__none" ? "" : value)
                }
              >
                <SelectTrigger id="convert-vendor">
                  <SelectValue placeholder="Choose a supplier" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none" disabled>
                    Choose a supplier
                  </SelectItem>
                  {vendorOptions.map((vendor) => (
                    <SelectItem key={vendor.id} value={vendor.id}>
                      {vendor.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {action.fields.vendorId ? (
              <p className="mt-2 text-[11.5px] font-medium text-danger">
                {action.fields.vendorId}
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConverting(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => void runConvert()}
              disabled={action.saving || vendorId === ""}
            >
              {action.saving ? "Creating…" : "Create draft PO"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function Detail({
  label,

  value,
}: {
  label: string

  value: React.ReactNode
}) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-0.5 text-[13px] text-foreground">{value}</dd>
    </div>
  )
}
