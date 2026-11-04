/**
 * One approval request, read in full, and decided.
 *
 * The approver sees the whole payload the deferred action will replay — the booking
 * it would make, or the cancellation it would apply — then signs it off or refuses
 * it with a reason. Nothing here mutates the target directly: approving hands the
 * stored payload to the same apply path an unheld action would have taken, so an
 * approved booking is exactly what an immediate one would have been.
 *
 * Maker-checker is honoured in the interface as it is enforced on the server: the
 * controls are hidden from the person who raised the request, so an approver never
 * stares at a button the backend would only refuse. A decision is final — the queue
 * keeps its history honest rather than offering a second bite.
 */

import { useState } from "react"

import { ArrowLeft, CheckCircle2, ShieldCheck, XCircle } from "lucide-react"

import { Alert, AlertDescription } from "@/components/ui/alert"

import { Badge } from "@/components/ui/badge"

import { Button } from "@/components/ui/button"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

import { EmptyState } from "@/components/empty-state"

import { Field } from "@/components/field"

import { PageHeader } from "@/components/page-header"

import { Textarea } from "@/components/ui/textarea"

import { useSave } from "@/features/organization/use-save"

import {
  APPROVAL_ACTION_LABELS,
  APPROVAL_NOTE_MAX,
  APPROVAL_STATUS_LABELS,
  APPROVAL_STATUS_TONES,
  type BookingApprovalPayload,
  type CancellationApprovalPayload,
} from "@shared/approvals"

import { formatCurrency, formatDate, formatDateTime } from "@/lib/format"

import { href, navigate } from "@/lib/router"

import { useSession } from "@/lib/session-context"

import { approvalsApi, type ApprovalItem } from "@/lib/approvals-api"

import { useAsyncResource } from "@/lib/use-async-resource"

interface ApprovalDetailPageProps {
  approvalId: string
}

/** One label/value line. An absent value renders a dash, never a blank or a zero. */

function Detail({
  label,

  value,
}: {
  label: string

  value: React.ReactNode
}) {
  return (
    <div className="grid grid-cols-3 items-baseline gap-x-3 py-1.5">
      <dt className="col-span-1 text-[11.5px] text-muted-foreground">
        {label}
      </dt>
      <dd className="col-span-2 min-w-0 text-[12.5px] text-foreground">
        {value === null || value === undefined || value === "" ? "—" : value}
      </dd>
    </div>
  )
}

function isBookingPayload(
  payload: ApprovalItem["payload"],
): payload is BookingApprovalPayload {
  return payload !== null && "unitId" in payload
}

function isCancellationPayload(
  payload: ApprovalItem["payload"],
): payload is CancellationApprovalPayload {
  return payload !== null && "bookingId" in payload
}

export default function ApprovalDetailPage({
  approvalId,
}: ApprovalDetailPageProps) {
  const { can, data: session } = useSession()

  const { data, loading, error, reload } = useAsyncResource((signal) =>
    approvalsApi.read(approvalId, signal),
  )

  const [note, setNote] = useState("")

  const decision = useSave()

  const approval = data?.approval ?? null

  const currency = data?.currency ?? "AED"

  const canApprove = can("approvals", "approve")

  const raisedByMe =
    session !== null &&
    approval !== null &&
    approval.requestedByUserId === session.user.id

  const pending = approval?.status === "pending"

  const showControls = pending && canApprove && !raisedByMe

  async function submit(approve: boolean) {
    const done = await decision.run(async () => {
      if (approve) {
        await approvalsApi.approve(approvalId, note)
      } else {
        await approvalsApi.reject(approvalId, note)
      }
    })

    if (done) {
      setNote("")

      decision.clear()

      await reload()
    }
  }

  const header = (
    <PageHeader
      scope={
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2 h-6 px-2 text-[11.5px]"
          onClick={() => navigate("/approvals")}
        >
          <ArrowLeft size={12} />
          Approvals
        </Button>
      }
      title={
        approval
          ? `${APPROVAL_ACTION_LABELS[approval.actionKey]} request`
          : "Approval request"
      }
      description={approval?.summary ?? undefined}
      actions={
        approval ? (
          <Badge variant={APPROVAL_STATUS_TONES[approval.status]}>
            {APPROVAL_STATUS_LABELS[approval.status]}
          </Badge>
        ) : null
      }
    />
  )

  if (error)
    return (
      <div className="flex flex-col gap-4">
        {header}
        <Alert variant="danger">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    )

  if (!approval)
    return (
      <div className="flex flex-col gap-4">
        {header}
        <Card>
          <CardContent className="py-8">
            <EmptyState
              icon={ShieldCheck}
              title={loading ? "Loading request…" : "Request not found"}
              description={
                loading
                  ? undefined
                  : "The request may have been removed or belongs to another workspace."
              }
              action={
                !loading ? (
                  <Button
                    variant="outline"
                    onClick={() => navigate("/approvals")}
                  >
                    Back to approvals
                  </Button>
                ) : undefined
              }
            />
          </CardContent>
        </Card>
      </div>
    )

  return (
    <div className="flex flex-col gap-4">
      {header}

      {decision.error ? (
        <Alert variant="danger">
          <AlertDescription>{decision.error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Request</CardTitle>
          </CardHeader>
          <CardContent className="py-2">
            <dl>
              <Detail
                label="Type"
                value={APPROVAL_ACTION_LABELS[approval.actionKey]}
              />
              <Detail label="Raised by" value={approval.requestedByName} />
              <Detail
                label="Raised on"
                value={formatDateTime(approval.requestedAt)}
              />
            </dl>
          </CardContent>
        </Card>

        {isBookingPayload(approval.payload) ? (
          <Card>
            <CardHeader>
              <CardTitle>Booking to be made</CardTitle>
            </CardHeader>
            <CardContent className="py-2">
              <dl>
                <Detail
                  label="Unit"
                  value={
                    <a
                      href={href(`/projects/${approval.payload.projectId}`)}
                      className="font-mono text-[12px] text-primary underline-offset-2 hover:underline"
                    >
                      {approval.payload.unitCode}
                    </a>
                  }
                />
                <Detail
                  label="Customer"
                  value={
                    <a
                      href={href(`/customers/${approval.payload.customerId}`)}
                      className="text-primary underline-offset-2 hover:underline"
                    >
                      {approval.payload.customerName}
                    </a>
                  }
                />
                <Detail
                  label="Amount"
                  value={formatCurrency(
                    approval.payload.bookingAmount,

                    currency,

                    { maximumFractionDigits: 0 },
                  )}
                />
                <Detail
                  label="Booking date"
                  value={formatDate(approval.payload.bookingDate)}
                />
              </dl>
            </CardContent>
          </Card>
        ) : isCancellationPayload(approval.payload) ? (
          <Card>
            <CardHeader>
              <CardTitle>Cancellation to apply</CardTitle>
            </CardHeader>
            <CardContent className="py-2">
              <dl>
                <Detail
                  label="Booking"
                  value={
                    <a
                      href={href(`/bookings/${approval.payload.bookingId}`)}
                      className="font-mono text-[12px] text-primary underline-offset-2 hover:underline"
                    >
                      {approval.payload.reference}
                    </a>
                  }
                />
                <Detail
                  label="Customer"
                  value={approval.payload.customerName}
                />
              </dl>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Request</CardTitle>
            </CardHeader>
            <CardContent className="py-2">
              <p className="text-[12.5px] text-muted-foreground">
                This request carries no displayable detail for the current
                build.
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      {approval.status !== "pending" ? (
        <Card>
          <CardHeader>
            <CardTitle>Decision</CardTitle>
          </CardHeader>
          <CardContent className="py-2">
            <dl>
              <Detail
                label={
                  approval.status === "approved" ? "Approved by" : "Rejected by"
                }
                value={approval.decidedByName}
              />
              <Detail
                label="Decided on"
                value={
                  approval.decidedAt ? formatDateTime(approval.decidedAt) : null
                }
              />
              <Detail label="Comment" value={approval.decisionNote} />
              {approval.resultEntityId ? (
                <Detail
                  label="Result"
                  value={
                    <a
                      href={href(
                        `/${approval.entityType ?? "bookings"}/${approval.resultEntityId}`,
                      )}
                      className="font-mono text-[12px] text-primary underline-offset-2 hover:underline"
                    >
                      {approval.resultEntityId}
                    </a>
                  }
                />
              ) : null}
            </dl>
          </CardContent>
        </Card>
      ) : showControls ? (
        <Card>
          <CardHeader>
            <CardTitle>Decide</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 py-2.5">
            <Field
              label="Comment"
              htmlFor="approval-note"
              error={decision.fields.decisionNote}
              hint={`Optional to approve, required to reject. ${note.length}/${APPROVAL_NOTE_MAX} characters.`}
            >
              <Textarea
                id="approval-note"
                rows={3}
                maxLength={APPROVAL_NOTE_MAX}
                value={note}
                onChange={(event) => {
                  setNote(event.target.value)

                  decision.clear()
                }}
                placeholder="Why this is being signed off, or the reason it is refused."
              />
            </Field>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="danger"
                onClick={() => void submit(false)}
                disabled={decision.saving || note.trim() === ""}
              >
                <XCircle size={13} />
                Reject
              </Button>
              <Button
                onClick={() => void submit(true)}
                disabled={decision.saving}
              >
                <CheckCircle2 size={13} />
                Approve
              </Button>
            </div>

            <p className="text-[11.5px] leading-4 text-muted-foreground">
              Approving applies the request now and cannot be undone. Rejecting
              records the decision and takes no effect.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-4">
            <p className="text-[12px] text-muted-foreground">
              {raisedByMe
                ? "You raised this request. A different approver with the right to sign it off must decide it."
                : "You do not have the approve right for this workspace, so this request is shown read-only."}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
