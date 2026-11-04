/**
 * The expenses list.
 *
 * Every spend the tenant has raised, filterable by project, category, status,
 * vendor, and date. The row links through to the detail page where an operator
 * submits into the maker-checker queue or marks an approved row paid. Nothing
 * on this page moves money — that lives behind the two explicit actions on the
 * detail page.
 */

import { useMemo, useState } from "react"

import { Plus, Receipt } from "lucide-react"

import { Alert, AlertDescription } from "@/components/ui/alert"

import { Badge } from "@/components/ui/badge"

import { Button } from "@/components/ui/button"

import { Card } from "@/components/ui/card"

import {
  DataTable,
  TableFilter,
  type DataTableColumn,
  type FilterOption,
} from "@/components/data-table"

import { EmptyState } from "@/components/empty-state"

import { Field } from "@/components/field"

import { SavedViewControls } from "@/components/saved-view-controls"

import { Input } from "@/components/ui/input"

import { PageHeader } from "@/components/page-header"

import { Skeleton } from "@/components/ui/skeleton"

import { ExpenseFormDialog } from "@/features/expenses/expense-form-dialog"

import { formatCurrency, formatDate, orDash } from "@/lib/format"

import { navigate } from "@/lib/router"

import { useSession } from "@/lib/session-context"

import { useAsyncResource } from "@/lib/use-async-resource"

import { projectsApi } from "@/lib/projects-api"

import { expensesApi, type ExpenseFilters } from "@/lib/expenses-api"

import {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_LABELS,
  EXPENSE_CATEGORY_TONES,
  EXPENSE_STATUSES,
  EXPENSE_STATUS_LABELS,
  EXPENSE_STATUS_TONES,
  type Expense,
  type ExpenseCategory,
  type ExpenseStatus,
} from "@shared/expenses"

const CATEGORY_OPTIONS: FilterOption[] = EXPENSE_CATEGORIES.map(
  (category: ExpenseCategory) => ({
    value: category,

    label: EXPENSE_CATEGORY_LABELS[category],
  }),
)

const STATUS_OPTIONS: FilterOption[] = EXPENSE_STATUSES.map(
  (status: ExpenseStatus) => ({
    value: status,

    label: EXPENSE_STATUS_LABELS[status],
  }),
)

export function ExpensesPage() {
  const session = useSession()

  const canView = session.can("expenses", "view")

  const canCreate = session.can("expenses", "create")

  const [filters, setFilters] = useState<ExpenseFilters>({})

  const [resetToken, setResetToken] = useState(0)

  function applySavedView(state: string) {
    const parsed = JSON.parse(state) as ExpenseFilters

    setFilters(parsed)

    setResetToken((token) => token + 1)
  }

  const [editing, setEditing] = useState<{
    open: boolean
    expense: Expense | null
  }>({ open: false, expense: null })

  const resource = useAsyncResource(
    (signal) => expensesApi.list(filters, signal),

    canView,
  )

  const projectOptions = useAsyncResource(
    (signal) => projectsApi.list(signal),

    canView,
  )

  const expenses = resource.data?.expenses ?? []

  const currency = resource.data?.currency ?? "AED"

  const projectList = projectOptions.data?.projects ?? []

  const projectFilterOptions: FilterOption[] = useMemo(
    () =>
      projectList.map((project) => ({
        value: project.id,
        label: project.name,
      })),

    [projectList],
  )

  const filtersActive = Boolean(
    filters.category ||
      filters.status ||
      filters.project ||
      filters.vendor ||
      filters.from ||
      filters.to,
  )

  const columns = useMemo<Array<DataTableColumn<Expense>>>(
    () => [
      {
        key: "occurred",

        header: "Date",

        width: "7rem",

        sortValue: (row) => row.occurredAt,

        cell: (row) => (
          <span className="whitespace-nowrap tabular-nums text-muted-foreground">
            {formatDate(row.occurredAt)}
          </span>
        ),
      },

      {
        key: "category",

        header: "Category",

        width: "8rem",

        sortValue: (row) => row.category,

        cell: (row) => (
          <Badge variant={EXPENSE_CATEGORY_TONES[row.category]}>
            {EXPENSE_CATEGORY_LABELS[row.category]}
          </Badge>
        ),
      },

      {
        key: "description",

        header: "Description",

        cell: (row) => (
          <button
            type="button"
            onClick={() => navigate(`/expenses/${row.id}`)}
            className="block max-w-full truncate text-left font-medium text-foreground hover:underline"
          >
            {row.description}
          </button>
        ),
      },

      {
        key: "project",

        header: "Project",

        width: "10rem",

        cell: (row) => (
          <span className="truncate">{orDash(row.projectName)}</span>
        ),
      },

      {
        key: "vendor",

        header: "Vendor",

        width: "10rem",

        cell: (row) => (
          <span className="truncate">{orDash(row.vendorName)}</span>
        ),
      },

      {
        key: "amount",

        header: "Amount",

        align: "right",

        width: "8.5rem",

        sortValue: (row) => row.amount,

        cell: (row) => (
          <span className="tabular-nums">
            {formatCurrency(row.amount, currency, { maximumFractionDigits: 0 })}
          </span>
        ),
      },

      {
        key: "status",

        header: "Status",

        width: "9rem",

        sortValue: (row) => row.status,

        cell: (row) => (
          <Badge variant={EXPENSE_STATUS_TONES[row.status]}>
            {EXPENSE_STATUS_LABELS[row.status]}
          </Badge>
        ),
      },

      {
        key: "attachments",

        header: "Files",

        align: "center",

        width: "4.5rem",

        cell: (row) =>
          row.attachmentCount > 0 ? (
            <span className="tabular-nums text-foreground">
              {row.attachmentCount}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
    ],

    [currency],
  )

  if (!canView) {
    return (
      <EmptyState
        icon={Receipt}
        title="Expenses are not available to your role"
        description="Ask a workspace administrator for the expenses grant to view this page."
        tone="pending"
      />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Expenses"
        description="Project, office, marketing, and construction spend routed through the maker-checker queue before it becomes paid."
        actions={
          canCreate ? (
            <Button onClick={() => setEditing({ open: true, expense: null })}>
              <Plus size={14} />
              New expense
            </Button>
          ) : null
        }
      />

      <Card className="p-0">
        <div className="flex flex-wrap items-end gap-2 border-b border-border px-3 py-3">
          <Field
            label="From"
            htmlFor="expense-filter-from"
            className="w-[9.5rem]"
          >
            <Input
              id="expense-filter-from"
              type="date"
              value={filters.from ?? ""}
              max={filters.to || undefined}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  from: event.target.value,
                }))
              }
            />
          </Field>
          <Field label="To" htmlFor="expense-filter-to" className="w-[9.5rem]">
            <Input
              id="expense-filter-to"
              type="date"
              value={filters.to ?? ""}
              min={filters.from || undefined}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  to: event.target.value,
                }))
              }
            />
          </Field>
          <TableFilter
            label="Category"
            value={filters.category ?? ""}
            placeholder="All categories"
            options={CATEGORY_OPTIONS}
            onValueChange={(value) =>
              setFilters((current) => ({
                ...current,

                category: value as ExpenseCategory | "",
              }))
            }
          />
          <TableFilter
            label="Status"
            value={filters.status ?? ""}
            placeholder="All statuses"
            options={STATUS_OPTIONS}
            onValueChange={(value) =>
              setFilters((current) => ({
                ...current,

                status: value as ExpenseStatus | "",
              }))
            }
          />
          <TableFilter
            label="Project"
            value={filters.project ?? ""}
            placeholder="All projects"
            options={projectFilterOptions}
            onValueChange={(value) =>
              setFilters((current) => ({ ...current, project: value }))
            }
          />

          <SavedViewControls
            scope="expenses"
            serialize={() => JSON.stringify(filters)}
            onApply={applySavedView}
          />

          {filtersActive ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() => setFilters({})}
            >
              Clear
            </Button>
          ) : null}
        </div>

        {resource.error ? (
          <Alert variant="danger" className="m-3">
            <AlertDescription>{resource.error}</AlertDescription>
          </Alert>
        ) : resource.loading && !resource.data ? (
          <Skeleton className="m-3 h-40 w-auto" />
        ) : expenses.length === 0 ? (
          <EmptyState
            icon={Receipt}
            title="No expenses yet"
            description={
              filtersActive
                ? "No expense matches these filters. Widen the range or clear them."
                : "Raise the first draft and it will appear here."
            }
          />
        ) : (
          <DataTable<Expense>
            columns={columns}
            rows={expenses}
            rowKey={(row) => row.id}
            initialSort={{ key: "occurred", direction: "desc" }}
            resetToken={resetToken}
            showFilterBar={false}
            caption="Expenses"
          />
        )}
      </Card>

      <ExpenseFormDialog
        open={editing.open}
        expense={editing.expense}
        onOpenChange={(open) =>
          setEditing((current) => ({
            open,
            expense: open ? current.expense : null,
          }))
        }
        onSaved={(expense) => {
          void resource.reload()

          navigate(`/expenses/${expense.id}`)
        }}
      />
    </div>
  )
}
