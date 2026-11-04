import { useState } from "react"
import { Columns3, Download, PackageOpen, Plus } from "lucide-react"
import type { NavItem } from "@/lib/navigation"
import { cn } from "@/lib/utils"
import { formatCurrency, formatDate } from "@/lib/format"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  DataTable,
  TableFilter,
  type DataTableColumn,
  type FilterOption,
} from "@/components/data-table"
import { EmptyState } from "@/components/empty-state"
import { PageHeader } from "@/components/page-header"
import { StatCard } from "@/components/stat-card"

type Row = Record<string, string | number>

type ColumnSpec = {
  key: string
  header: string
  align?: "left" | "right"
  width?: string
  kind?: "text" | "strong" | "money" | "date" | "badge"
}

const statusTone: Record<string, "neutral" | "success" | "pending" | "danger" | "info"> =
  {
    active: "success",
    sold: "info",
    booked: "info",
    confirmed: "success",
    available: "success",
    reserved: "pending",
    pending: "pending",
    due: "pending",
    overdue: "danger",
    cancelled: "neutral",
    draft: "neutral",
    qualified: "info",
    contact: "neutral",
    negotiating: "pending",
    completed: "success",
    failed: "danger",
  }

function renderCell(value: Row[string], kind: ColumnSpec["kind"]) {
  if (value === undefined || value === null || value === "") {
    return <span className="text-muted-foreground/60">—</span>
  }

  switch (kind) {
    case "strong":
      return (
        <span className="font-medium text-foreground">{String(value)}</span>
      )
    case "money":
      return (
        <span className="tabular-nums">
          {formatCurrency(Number(value), "USD", { maximumFractionDigits: 0 })}
        </span>
      )
    case "date":
      return (
        <span className="tabular-nums whitespace-nowrap">
          {formatDate(String(value))}
        </span>
      )
    case "badge": {
      const key = String(value).toLowerCase()
      return (
        <Badge variant={statusTone[key] ?? "neutral"}>{String(value)}</Badge>
      )
    }
    default:
      return <span className="truncate">{String(value)}</span>
  }
}

/** Column specs are declarative; the DataTable owns sorting and pagination. */
function buildColumns(specs: ColumnSpec[]): Array<DataTableColumn<Row>> {
  return specs.map((spec) => ({
    key: spec.key,
    header: spec.header,
    align: spec.align ?? "left",
    width: spec.width,
    sortValue: (row) => String(row[spec.key] ?? ""),
    cell: (row) => renderCell(row[spec.key], spec.kind),
  }))
}

type ModuleLayout = {
  kpis: string[]
  columns: ColumnSpec[]
  filters: {
    label: string
    options: FilterOption[]
  }[]
  emptyTitle: string
  emptyDescription: string
}

const statusOptions = (values: string[]) =>
  values.map((value) => ({
    value,
    label: value.charAt(0).toUpperCase() + value.slice(1),
  }))

const projectOptions = [
  { value: "p1", label: "Harbour Point Residences" },
  { value: "p2", label: "Northgate Business Park" },
  { value: "p3", label: "The Foundry" },
]

const moduleLayouts: Partial<Record<NavItem["id"], ModuleLayout>> = {
  projects: {
    kpis: ["Active projects", "Total units", "Units sold", "Contracted value"],
    columns: [
      { key: "reference", header: "Reference", width: "7rem", kind: "strong" },
      { key: "name", header: "Project", kind: "strong" },
      { key: "location", header: "Location", width: "12rem" },
      { key: "phase", header: "Phase", width: "8rem" },
      { key: "units", header: "Units", align: "right", width: "5.5rem" },
      { key: "sold", header: "Sold", align: "right", width: "5.5rem" },
      {
        key: "value",
        header: "Contracted value",
        align: "right",
        kind: "money",
      },
      { key: "status", header: "Status", width: "7rem", kind: "badge" },
    ],
    filters: [
      {
        label: "Status",
        options: statusOptions(["active", "draft", "completed"]),
      },
      { label: "Location", options: projectOptions },
    ],
    emptyTitle: "No projects yet",
    emptyDescription:
      "Create a project to define its phases, tower mix, and commercial terms. Units are published to Inventory from here.",
  },
  inventory: {
    kpis: ["Total units", "Available", "Reserved", "Inventory value"],
    columns: [
      { key: "unit", header: "Unit", width: "7rem", kind: "strong" },
      { key: "project", header: "Project", kind: "strong" },
      { key: "type", header: "Type", width: "8rem" },
      { key: "area", header: "Area", align: "right", width: "7rem" },
      { key: "price", header: "List price", align: "right", kind: "money" },
      { key: "reservedFor", header: "Reserved for", width: "11rem" },
      { key: "status", header: "Status", width: "8rem", kind: "badge" },
    ],
    filters: [
      {
        label: "Status",
        options: statusOptions(["available", "reserved", "sold", "draft"]),
      },
      { label: "Project", options: projectOptions },
    ],
    emptyTitle: "No inventory published",
    emptyDescription:
      "Publish units from a project phase to make them visible to the sales team and available for booking.",
  },
  leads: {
    kpis: ["Open leads", "Pipeline value", "New this month", "Conversion rate"],
    columns: [
      { key: "reference", header: "Reference", width: "7rem", kind: "strong" },
      { key: "contact", header: "Contact", kind: "strong" },
      { key: "source", header: "Source", width: "9rem" },
      { key: "project", header: "Project", width: "12rem" },
      { key: "budget", header: "Budget", align: "right", kind: "money" },
      { key: "stage", header: "Stage", width: "8rem", kind: "badge" },
      { key: "owner", header: "Owner", width: "10rem" },
      { key: "updated", header: "Updated", align: "right", kind: "date" },
    ],
    filters: [
      {
        label: "Stage",
        options: statusOptions([
          "contact",
          "qualified",
          "negotiating",
          "booked",
        ]),
      },
      { label: "Project", options: projectOptions },
    ],
    emptyTitle: "No leads in the pipeline",
    emptyDescription:
      "Capture enquiries from brokers, walk-ins, and campaigns. Leads convert into customers and bookings.",
  },
  bookings: {
    kpis: [
      "Bookings this period",
      "Contracted value",
      "Awaiting payment",
      "Handovers due",
    ],
    columns: [
      { key: "reference", header: "Reference", width: "7rem", kind: "strong" },
      { key: "unit", header: "Unit", width: "7rem" },
      { key: "customer", header: "Customer", kind: "strong" },
      { key: "project", header: "Project", width: "12rem" },
      { key: "amount", header: "Amount", align: "right", kind: "money" },
      { key: "bookedOn", header: "Booked on", align: "right", kind: "date" },
      { key: "handover", header: "Handover", align: "right", kind: "date" },
      { key: "status", header: "Status", width: "7rem", kind: "badge" },
    ],
    filters: [
      {
        label: "Status",
        options: statusOptions(["pending", "confirmed", "cancelled"]),
      },
      { label: "Project", options: projectOptions },
    ],
    emptyTitle: "No bookings recorded",
    emptyDescription:
      "Confirmed allocations generate a payment schedule in Payments and reserve the unit in Inventory.",
  },
  payments: {
    kpis: ["Collected this period", "Outstanding", "Overdue", "Next due date"],
    columns: [
      { key: "receipt", header: "Receipt", width: "7.5rem", kind: "strong" },
      { key: "customer", header: "Customer", kind: "strong" },
      { key: "booking", header: "Booking", width: "7rem" },
      { key: "dueDate", header: "Due date", align: "right", kind: "date" },
      { key: "amount", header: "Amount", align: "right", kind: "money" },
      { key: "method", header: "Method", width: "8rem" },
      { key: "status", header: "Status", width: "7rem", kind: "badge" },
    ],
    filters: [
      {
        label: "Status",
        options: statusOptions(["due", "pending", "overdue", "completed"]),
      },
      { label: "Project", options: projectOptions },
    ],
    emptyTitle: "No payment activity",
    emptyDescription:
      "Instalment schedules are generated from confirmed bookings. Receipts posted here update customer ledgers immediately.",
  },
  customers: {
    kpis: [
      "Total customers",
      "Active accounts",
      "Outstanding balance",
      "Overdue accounts",
    ],
    columns: [
      { key: "account", header: "Account", width: "8rem", kind: "strong" },
      { key: "name", header: "Customer", kind: "strong" },
      { key: "type", header: "Type", width: "7rem" },
      { key: "project", header: "Primary project", width: "12rem" },
      { key: "bookings", header: "Bookings", align: "right", width: "5.5rem" },
      {
        key: "outstanding",
        header: "Outstanding",
        align: "right",
        kind: "money",
      },
      {
        key: "lastActivity",
        header: "Last activity",
        align: "right",
        kind: "date",
      },
    ],
    filters: [
      {
        label: "Type",
        options: statusOptions(["individual", "company", "joint"]),
      },
      { label: "Project", options: projectOptions },
    ],
    emptyTitle: "No customer accounts",
    emptyDescription:
      "Customer records hold the buyer, co-buyers, contract documents, and the full payment ledger.",
  },
  reports: {
    kpis: ["Saved reports", "Scheduled runs", "Failed runs", "Last export"],
    columns: [
      { key: "name", header: "Report", kind: "strong" },
      { key: "category", header: "Category", width: "11rem" },
      { key: "scope", header: "Scope", width: "11rem" },
      { key: "owner", header: "Owner", width: "11rem" },
      { key: "lastRun", header: "Last run", align: "right", kind: "date" },
      { key: "modified", header: "Modified", align: "right", kind: "date" },
    ],
    filters: [
      {
        label: "Category",
        options: statusOptions([
          "financial",
          "sales",
          "inventory",
          "compliance",
        ]),
      },
      { label: "Owner", options: statusOptions(["me", "my team"]) },
    ],
    emptyTitle: "No reports configured",
    emptyDescription:
      "Build financial and operational statements once, then schedule them for finance to run at the end of each period.",
  },
}

const fallbackLayout: ModuleLayout = {
  kpis: ["Total records", "Added this period", "Updated", "Archived"],
  columns: [
    { key: "reference", header: "Reference", width: "8rem", kind: "strong" },
    { key: "name", header: "Name", kind: "strong" },
    { key: "status", header: "Status", width: "8rem", kind: "badge" },
    { key: "updated", header: "Updated", align: "right", kind: "date" },
  ],
  filters: [
    {
      label: "Status",
      options: statusOptions(["active", "pending", "cancelled"]),
    },
  ],
  emptyTitle: "Nothing here yet",
  emptyDescription:
    "This module is part of the application shell and will be wired up next.",
}

export function ModulePage({ module }: { module: NavItem }) {
  const layout = moduleLayouts[module.id] ?? fallbackLayout
  const allColumns = buildColumns(layout.columns)
  const [columns, setColumns] = useState(allColumns)
  const [filters, setFilters] = useState<Record<string, string>>({})
  const [resetToken, setResetToken] = useState(0)

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={module.label}
        description={module.description}
        actions={
          <>
            <Button variant="outline">
              <Download size={13} />
              Export
            </Button>
            <Button>
              <Plus size={13} />
              {module.primaryAction}
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {layout.kpis.map((label) => (
          <StatCard key={label} label={label} />
        ))}
      </div>

      <Card>
        <DataTable<Row>
          columns={columns}
          rows={[]}
          rowKey={(row) => String(row.reference ?? row.id ?? row.name)}
          getRowSearchText={(row) => Object.values(row).join(" ")}
          filters={filters}
          onFilterChange={(key, value) =>
            setFilters((current) => ({ ...current, [key]: value }))
          }
          resetToken={resetToken}
          filterBar={layout.filters.map((filter) => (
            <TableFilter
              key={filter.label}
              label={filter.label}
              value={filters[filter.label] ?? "__all"}
              placeholder="All"
              options={filter.options}
              onValueChange={(value) =>
                setFilters((current) => ({
                  ...current,
                  [filter.label]: value === "__all" ? "" : value,
                }))
              }
            />
          ))}
          toolbar={
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm">
                  <Columns3 size={13} />
                  Columns
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-56 p-2">
                <p className="px-1 pb-1.5 text-[10.5px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                  Visible columns
                </p>
                <div className="flex flex-col gap-0.5">
                  {allColumns.map((column, index) => {
                    const visible = columns.some(
                      (entry) => entry.key === column.key,
                    )
                    return (
                      <label
                        key={column.key}
                        className={cn(
                          "flex h-7 items-center gap-2 rounded px-1 text-[12.5px]",
                          index === 0
                            ? "cursor-not-allowed opacity-55"
                            : "cursor-pointer",
                        )}
                      >
                        <Checkbox
                          checked={visible}
                          disabled={index === 0}
                          onCheckedChange={(checked) =>
                            setColumns((current) =>
                              checked
                                ? allColumns.filter(
                                    (entry) =>
                                      entry.key === column.key ||
                                      current.some(
                                        (shown) => shown.key === entry.key,
                                      ),
                                  )
                                : current.filter(
                                    (entry) => entry.key !== column.key,
                                  ),
                            )
                          }
                        />
                        {column.header}
                      </label>
                    )
                  })}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-1 w-full justify-start"
                  onClick={() => {
                    setColumns(allColumns)
                    setResetToken((token) => token + 1)
                  }}
                >
                  Reset view
                </Button>
              </PopoverContent>
            </Popover>
          }
          maxHeight="max(18rem, calc(100dvh - 25rem))"
          emptyState={
            <EmptyState
              icon={PackageOpen}
              title={layout.emptyTitle}
              description={layout.emptyDescription}
            />
          }
        />
      </Card>
    </div>
  )
}
