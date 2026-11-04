/**
 * The expense detail page.
 *
 * Everything the finance desk does with one row lives here: read the shape, edit
 * the draft while it is still a draft (or a rejected row returning for a second
 * pass), attach a receipt, submit into the maker-checker queue, and — once an
 * approver has signed off — mark it paid, which is the moment the money leaves
 * and the vendor ledger receives a matching negative row.
 *
 * The status timeline is intentionally plain: the row's own timestamps and the
 * linked approval are enough to explain what happened, and stitching a separate
 * event log here would drift from the audit trail the server writes.
 */

import { useMemo, useState } from "react"

import { ArrowLeft, CheckCircle2, Paperclip, Send } from "lucide-react"

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

import { ExpenseAttachmentsDialog } from "@/features/expenses/expense-attachments-dialog"

import { ExpenseFormDialog } from "@/features/expenses/expense-form-dialog"

import {
  formatCurrency,
  formatDate,
  formatDateTime,
  orDash,
} from "@/lib/format"

import { navigate } from "@/lib/router"

import { useSession } from "@/lib/session-context"

import { useAsyncResource } from "@/lib/use-async-resource"

import { expensesApi } from "@/lib/expenses-api"

import { useSave } from "@/features/organization/use-save"

import {
  EXPENSE_CATEGORY_LABELS,
  EXPENSE_CATEGORY_TONES,
  EXPENSE_STATUS_LABELS,
  EXPENSE_STATUS_TONES,
} from "@shared/expenses"

interface ExpenseDetailPageProps {
  expenseId: string
}

export function ExpenseDetailPage({ expenseId }: ExpenseDetailPageProps) {
  const session = useSession()

  const canView = session.can("expenses", "view")

  const canEdit = session.can("expenses", "edit")

  const resource = useAsyncResource(
    (signal) => expensesApi.read(expenseId, signal),

    canView,
  )

  const [editing, setEditing] = useState(false)

  const [attaching, setAttaching] = useState(false)

  const action = useSave()

  const expense = resource.data?.expense ?? null

  const attachments = resource.data?.attachments ?? []

  const money = useMemo(
    () =>
      expense
        ? formatCurrency(expense.amount, expense.currency, {
            maximumFractionDigits: 0,
          })
        : "",

    [expense],
  )

  if (!canView) {
    return (
      <EmptyState
        icon={Paperclip}
        title="Expense not available"
        description="Your role cannot read the expenses module."
        tone="pending"
      />
    )
  }

  async function runSubmit() {
    if (!expense) return

    const done = await action.run(async () => {
      await expensesApi.submit(expense.id)
    })

    if (done) await resource.reload()
  }

  async function runMarkPaid() {
    if (!expense) return

    const done = await action.run(async () => {
      await expensesApi.markPaid(expense.id)
    })

    if (done) await resource.reload()
  }

  if (resource.loading && !expense) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-52 w-full" />
      </div>
    )
  }

  if (!expense) {
    return (
      <EmptyState
        icon={Paperclip}
        title="That expense does not exist"
        description="It may have been removed, or the link is wrong."
      />
    )
  }

  const actions = (
    <>
      <Button variant="ghost" size="sm" onClick={() => navigate("/expenses")}>
        <ArrowLeft size={13} />
        Back
      </Button>
      {canEdit &&
      (expense.status === "draft" || expense.status === "rejected") ? (
        <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
          Edit draft
        </Button>
      ) : null}
      {expense.canSubmit ? (
        <Button
          size="sm"
          onClick={() => void runSubmit()}
          disabled={action.saving}
        >
          <Send size={13} />
          {action.saving ? "Submitting…" : "Submit for approval"}
        </Button>
      ) : null}
      {expense.canMarkPaid ? (
        <Button
          size="sm"
          onClick={() => void runMarkPaid()}
          disabled={action.saving}
        >
          <CheckCircle2 size={13} />
          {action.saving ? "Marking…" : "Mark paid"}
        </Button>
      ) : null}
    </>
  )

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={expense.description}
        description={`Raised by ${expense.createdByName} · ${formatDate(expense.createdAt)}`}
        actions={actions}
      />

      {action.error ? (
        <Alert variant="danger">
          <AlertDescription>{action.error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Expense</CardTitle>
            <CardDescription>
              The spend itself, its status, and the links to the approvals
              trail.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 py-2">
            <div className="flex flex-wrap gap-2">
              <Badge variant={EXPENSE_CATEGORY_TONES[expense.category]}>
                {EXPENSE_CATEGORY_LABELS[expense.category]}
              </Badge>
              <Badge variant={EXPENSE_STATUS_TONES[expense.status]}>
                {EXPENSE_STATUS_LABELS[expense.status]}
              </Badge>
            </div>

            <p className="text-[22px] font-semibold tabular-nums text-foreground">
              {money}
            </p>

            <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Detail label="Occurred" value={formatDate(expense.occurredAt)} />
              <Detail
                label="Project"
                value={
                  expense.projectName
                    ? `${expense.projectName}${
                        expense.projectCode ? ` · ${expense.projectCode}` : ""
                      }`
                    : "—"
                }
              />
              <Detail
                label="Vendor"
                value={
                  expense.vendorId ? (
                    <button
                      type="button"
                      onClick={() => navigate(`/vendors/${expense.vendorId}`)}
                      className="text-foreground underline-offset-2 hover:underline"
                    >
                      {orDash(expense.vendorName)}
                    </button>
                  ) : (
                    "—"
                  )
                }
              />
              <Detail
                label="Attachments"
                value={
                  <button
                    type="button"
                    onClick={() => setAttaching(true)}
                    className="text-foreground underline-offset-2 hover:underline"
                  >
                    {attachments.length === 0
                      ? "None yet"
                      : `${attachments.length} file${
                          attachments.length === 1 ? "" : "s"
                        }`}
                  </button>
                }
              />
              <Detail
                label="Approval"
                value={
                  expense.approvalId ? (
                    <button
                      type="button"
                      onClick={() =>
                        navigate(`/approvals/${expense.approvalId}`)
                      }
                      className="font-mono text-[12px] text-foreground underline-offset-2 hover:underline"
                    >
                      {expense.approvalId}
                    </button>
                  ) : (
                    "—"
                  )
                }
              />
              <Detail
                label="Paid on"
                value={expense.paidAt ? formatDateTime(expense.paidAt) : "—"}
              />
            </dl>

            <div className="border-t border-border pt-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                Description
              </p>
              <p className="mt-1 text-[13px] text-foreground">
                {expense.description}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Lifecycle</CardTitle>
            <CardDescription>
              An expense always needs a second signature before it becomes paid.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 py-2 text-[12.5px]">
            <TimelineItem
              label="Draft created"
              at={expense.createdAt}
              by={expense.createdByName}
              active={expense.status !== "draft"}
            />
            <TimelineItem
              label="Submitted for approval"
              at={
                expense.status === "pending_approval" ||
                expense.status === "approved" ||
                expense.status === "paid" ||
                expense.status === "rejected"
                  ? expense.updatedAt
                  : null
              }
              by={null}
              active={
                expense.status === "approved" ||
                expense.status === "paid" ||
                expense.status === "rejected"
              }
            />
            <TimelineItem
              label={
                expense.status === "rejected"
                  ? "Rejected by approver"
                  : "Approved"
              }
              at={
                expense.status === "approved" || expense.status === "paid"
                  ? expense.updatedAt
                  : expense.status === "rejected"
                    ? expense.updatedAt
                    : null
              }
              by={null}
              tone={expense.status === "rejected" ? "danger" : "info"}
              active={expense.status === "paid"}
            />
            <TimelineItem
              label="Paid"
              at={expense.paidAt}
              by={null}
              tone="success"
              active={expense.status === "paid"}
            />
          </CardContent>
        </Card>
      </div>

      <ExpenseFormDialog
        open={editing}
        expense={expense}
        onOpenChange={setEditing}
        onSaved={() => {
          void resource.reload()
        }}
      />

      <ExpenseAttachmentsDialog
        open={attaching}
        onOpenChange={setAttaching}
        expense={expense}
        onChanged={() => {
          void resource.reload()
        }}
      />
    </div>
  )
}

interface DetailProps {
  label: string
  value: React.ReactNode
}

function Detail({ label, value }: DetailProps) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-0.5 text-[13px] text-foreground">{value}</dd>
    </div>
  )
}

function TimelineItem({
  label,

  at,

  by,

  tone = "outline",

  active,
}: {
  label: string

  at: string | null

  by: string | null

  tone?: "outline" | "info" | "success" | "danger"

  active: boolean
}) {
  return (
    <div className="flex items-start gap-2">
      <Badge variant={active ? tone : "outline"}>{active ? "•" : "○"}</Badge>
      <div className="min-w-0">
        <p className="text-[12.5px] font-medium text-foreground">{label}</p>
        <p className="text-[11.5px] text-muted-foreground">
          {at ? formatDateTime(at) : "—"}
          {by ? ` · ${by}` : ""}
        </p>
      </div>
    </div>
  )
}
