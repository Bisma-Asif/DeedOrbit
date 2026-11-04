/**
 * The Reports section.
 *
 * A left rail lists the eleven report types (the picker is the server catalog, so the
 * page can never drift from what the API can build). Choosing one and setting the
 * filters runs `GET /api/reports/:id`, which returns a generic `{ columns, rows,
 * totals, meta }` projection. The result renders in the shared `DataTable`, exports to
 * CSV and Excel verbatim, and prints to PDF through the same `data-document-print`
 * isolation the ledgers and receipts use — no charting, spreadsheet, or PDF library.
 *
 * Money is whole-unit integers in the tenant base currency. A report with no rows
 * under its filters shows an honest empty state, never a fabricated zero. Where a
 * report carries no branch attribution, the branch control is withheld with a note
 * rather than silently narrowing nothing.
 */

import { useMemo, useState } from "react"

import {
  AlarmClock,
  ArrowLeftRight,
  Ban,
  BadgeDollarSign,
  BarChart3,
  CalendarCheck,
  Download,
  FileSpreadsheet,
  HandCoins,
  Package,
  PieChart,
  Printer,
  Receipt,
  TrendingUp,
  UserCheck,
} from "lucide-react"

import type { LucideIcon } from "lucide-react"

import { Alert, AlertDescription } from "@/components/ui/alert"

import { Badge, type BadgeVariant } from "@/components/ui/badge"

import { Button } from "@/components/ui/button"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

import {
  DataTable,
  type DataTableColumn,
  type FilterOption,
} from "@/components/data-table"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

import { EmptyState } from "@/components/empty-state"

import { Field } from "@/components/field"

import { Input } from "@/components/ui/input"

import { Skeleton } from "@/components/ui/skeleton"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

import { PageHeader } from "@/components/page-header"

import { cn } from "@/lib/utils"

import { useSession } from "@/lib/session-context"

import { useAsyncResource } from "@/lib/use-async-resource"

import { formatCurrency, formatDate, formatNumber } from "@/lib/format"

import {
  exportRows,
  type ExportColumn,
  type ExportMetaLine,
} from "@/lib/export"

import { reportsApi, type ReportQuery } from "@/lib/reports-api"

import { projectsApi } from "@/lib/projects-api"

import type {
  ReportColumn,
  ReportFilter,
  ReportId,
  ReportResult,
  ReportRow,
} from "@shared/reports"

const REPORT_ICON_BY_NAME: Record<string, LucideIcon> = {
  TrendingUp,

  Package,

  CalendarCheck,

  HandCoins,

  AlarmClock,

  UserCheck,

  BadgeDollarSign,

  PieChart,

  Receipt,

  Ban,

  ArrowLeftRight,
}

const FALLBACK_ICON = BarChart3

function reportIcon(name: string): LucideIcon {
  return REPORT_ICON_BY_NAME[name] ?? FALLBACK_ICON
}

/** Reads a status-like cell into a design-system tone without inventing meaning. */

function toneForBadge(value: string): BadgeVariant {
  const key = value.toLowerCase()

  if (
    /confirmed|paid|approved|available|completed|closed|active|sold/.test(key)
  )
    return "success"

  if (/cancelled|canceled|rejected|overdue|defaulted|expired/.test(key))
    return "danger"

  if (/pending|draft|hold|reserved|open|due/.test(key)) return "pending"

  if (/booked|transferred/.test(key)) return "info"

  return "neutral"
}

function cellText(col: ReportColumn, row: ReportRow): string {
  const value = row[col.key]

  return value === null || value === undefined ? "" : String(value)
}

// --- Result panel (remounts on every query change so it reloads once) -------

interface ReportResultPanelProps {
  reportId: ReportId

  query: ReportQuery

  supportedFilters: ReportFilter[]
}

function ReportPrintDocument({ result }: { result: ReportResult }) {
  const render = (col: ReportColumn, value: ReportRow[string]): string => {
    if (value === null || value === undefined || value === "") return "—"

    if (col.type === "money")
      return formatCurrency(Number(value), result.currency, {
        maximumFractionDigits: 0,
      })

    if (col.type === "number") return formatNumber(Number(value))

    if (col.type === "date") return formatDate(String(value))

    return String(value)
  }

  return (
    <article
      className="bg-card text-foreground"
      style={{ fontFamily: "var(--font-sans)" }}
    >
      <header className="flex items-start justify-between gap-6 border-b border-border-strong pb-4">
        <div className="min-w-0">
          <p className="text-[15px] leading-5 font-semibold tracking-tight">
            {result.title}
          </p>

          <p className="mt-1 text-[12px] text-muted-foreground">
            Currency {result.currency}
          </p>
        </div>

        <div className="shrink-0 text-right">
          {result.meta.map((line) => (
            <p
              key={line.label}
              className="text-[11px] tabular-nums text-muted-foreground"
            >
              {line.label}: {line.value}
            </p>
          ))}
        </div>
      </header>

      <table className="mt-3 w-full border-collapse text-[12px]">
        <thead>
          <tr>
            {result.columns.map((col) => (
              <td
                key={col.key}
                className={cn(
                  "border-b border-border-strong py-1.5 text-[9.5px] font-semibold tracking-[0.08em] text-muted-foreground uppercase",

                  col.align === "right" ? "text-right" : "pr-3",
                )}
              >
                {col.label}
              </td>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row, index) => (
            <tr key={index} className="avoid-break-inside">
              {result.columns.map((col) => (
                <td
                  key={col.key}
                  className={cn(
                    "border-b border-border py-1.5 tabular-nums",

                    col.align === "right" ? "text-right" : "pr-3",
                  )}
                >
                  {render(col, row[col.key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            {result.columns.map((col, index) => (
              <td
                key={col.key}
                className={cn(
                  "border-t-2 border-border-strong py-2 text-[12.5px] font-semibold tabular-nums",

                  col.align === "right" ? "text-right" : "pr-3",
                )}
              >
                {index === 0
                  ? "Totals"
                  : result.totals[col.key] !== undefined
                    ? formatCurrency(result.totals[col.key], result.currency, {
                        maximumFractionDigits: 0,
                      })
                    : ""}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>

      <footer className="border-t border-border-strong pt-3 pb-1 text-[10px] leading-4 text-muted-foreground">
        {result.rows.length} row{result.rows.length === 1 ? "" : "s"} ·{" "}
        {result.meta

          .map((line) => `${line.label} ${line.value}`)

          .join(" · ")}
      </footer>
    </article>
  )
}

function ReportResultPanel({
  reportId,

  query,

  supportedFilters,
}: ReportResultPanelProps) {
  const [printing, setPrinting] = useState(false)

  const resource = useAsyncResource((signal) =>
    reportsApi.run(reportId, query, supportedFilters, signal),
  )

  const result = resource.data

  const currency = result?.currency ?? "AED"

  const columns = useMemo<Array<DataTableColumn<ReportRow>>>(() => {
    if (!result) return []

    return result.columns.map((col) => ({
      key: col.key,

      header: col.label,

      align: col.align,

      sortValue: (row: ReportRow) =>
        col.type === "money" || col.type === "number"
          ? typeof row[col.key] === "number"
            ? row[col.key] as number
            : 0
          : cellText(col, row),

      cell: (row: ReportRow) => {
        const value = row[col.key]

        if (value === null || value === undefined || value === "")
          return <span className="text-muted-foreground">—</span>

        switch (col.type) {
          case "money":
            return (
              <span className="tabular-nums">
                {formatCurrency(Number(value), currency, {
                  maximumFractionDigits: 0,
                })}
              </span>
            )

          case "number":
            return (
              <span className="tabular-nums">
                {formatNumber(Number(value))}
              </span>
            )

          case "date":
            return (
              <span className="whitespace-nowrap tabular-nums text-muted-foreground">
                {formatDate(String(value))}
              </span>
            )

          case "badge":
            return (
              <Badge variant={toneForBadge(String(value))}>
                {String(value)}
              </Badge>
            )

          default:
            return <span className="text-foreground">{String(value)}</span>
        }
      },
    }))
  }, [currency, result])

  const exportColumns = useMemo<ExportColumn<ReportRow>[]>(() => {
    if (!result) return []

    return result.columns.map((col) => ({
      header: col.label,

      value: (row: ReportRow): string | number => {
        const value = row[col.key]

        if (value === null || value === undefined) return ""

        if (col.type === "money" || col.type === "number")
          return typeof value === "number" ? value : ""

        if (col.type === "date") return String(value).slice(0, 10)

        return String(value)
      },
    }))
  }, [result])

  if (resource.error) {
    return (
      <Alert variant="danger">
        <AlertDescription>{resource.error}</AlertDescription>
      </Alert>
    )
  }

  if (resource.loading && !result) {
    return <Skeleton className="h-64 w-full" />
  }

  if (!result) return null

  const moneyTotals = result.columns.filter(
    (col) => col.type === "money" && result.totals[col.key] !== undefined,
  )

  function exportMeta(): ExportMetaLine[] {
    return [
      ...result!.meta.map((line) => ({
        label: line.label,

        value: line.value,
      })),

      ...moneyTotals.map((col) => ({
        label: `Total ${col.label}`,

        value: formatCurrency(result!.totals[col.key], currency, {
          maximumFractionDigits: 0,
        }),
      })),
    ]
  }

  function runExport(format: "csv" | "excel") {
    exportRows(format, {
      filenameStem: reportId,

      title: result!.title,

      columns: exportColumns,

      rows: result!.rows,

      meta: exportMeta(),
    })
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {moneyTotals.map((col) => (
            <span
              key={col.key}
              className="inline-flex items-baseline gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-1 text-[11.5px]"
            >
              <span className="text-muted-foreground">{col.label} total</span>

              <span className="text-foreground font-semibold tabular-nums">
                {formatCurrency(result.totals[col.key], currency, {
                  maximumFractionDigits: 0,
                })}
              </span>
            </span>
          ))}

          <span className="text-[11.5px] text-muted-foreground tabular-nums">
            {result.rows.length} row{result.rows.length === 1 ? "" : "s"}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => runExport("csv")}
            disabled={result.rows.length === 0}
          >
            <Download size={13} />
            CSV
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => runExport("excel")}
            disabled={result.rows.length === 0}
          >
            <FileSpreadsheet size={13} />
            Excel
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setPrinting(true)}
            disabled={result.rows.length === 0}
          >
            <Printer size={13} />
            PDF
          </Button>
        </div>
      </div>

      <div className="rounded-md border border-border">
        <DataTable<ReportRow>
          columns={columns}
          rows={result.rows}
          rowKey={(row) =>
            result.columns.map((col) => cellText(col, row)).join("\u241F")
          }
          getRowSearchText={(row) =>
            result.columns.map((col) => cellText(col, row)).join(" ")
          }
          loading={resource.loading}
          maxHeight="calc(100vh - 22rem)"
          caption={result.title}
          emptyState={
            <EmptyState
              icon={FALLBACK_ICON}
              size="sm"
              title="No rows under these filters"
              description="Widen the date range or clear the project and branch filters to see more."
            />
          }
        />
      </div>

      <Dialog open={printing} onOpenChange={setPrinting}>
        <DialogContent
          data-document-print=""
          className="flex w-[calc(100%-2rem)] max-w-[46rem] flex-col"
        >
          <DialogHeader className="print-hidden">
            <DialogTitle>{result.title}</DialogTitle>

            <DialogDescription>
              Review the report, then print or save it as a PDF.
            </DialogDescription>
          </DialogHeader>

          <div className="scrollbar-slim min-h-0 flex-1 overflow-y-auto border border-border bg-muted/20 p-3 sm:p-5">
            <div className="mx-auto max-w-[38rem] border border-border bg-card p-6 shadow-card sm:p-8">
              <ReportPrintDocument result={result} />
            </div>
          </div>

          <DialogFooter className="print-hidden">
            <Button
              variant="outline"
              data-no-print=""
              onClick={() => setPrinting(false)}
            >
              Close
            </Button>

            <Button onClick={() => window.print()}>
              <Printer size={13} />
              Print / Save as PDF
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// --- Page ------------------------------------------------------------------

interface FilterState {
  from: string

  to: string

  projectId: string

  branchId: string
}

const EMPTY_FILTERS: FilterState = {
  from: "",

  to: "",

  projectId: "",

  branchId: "",
}

export function ReportsPage() {
  const { can } = useSession()

  const canViewReports = can("reports", "view")

  const catalog = useAsyncResource(
    (signal) => reportsApi.catalog(signal),

    canViewReports,
  )

  const projects = useAsyncResource(
    (signal) => projectsApi.list(signal),

    canViewReports && can("projects", "view"),
  )

  const [selectedId, setSelectedId] = useState<ReportId>("sales")

  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS)

  const reports = useMemo(() => catalog.data?.reports ?? [], [catalog.data])

  const selected = reports.find((report) => report.id === selectedId)

  const supportedFilters = selected?.supportedFilters ?? []

  const supportsProject = supportedFilters.includes("project")

  const supportsBranch = supportedFilters.includes("branch")

  const branches = useMemo(
    () => catalog.data?.branches ?? [],

    [catalog.data],
  )

  const projectOptions = useMemo<FilterOption[]>(
    () =>
      (projects.data?.projects ?? []).map((project) => ({
        value: project.id,

        label: project.name,
      })),

    [projects.data],
  )

  const branchOptions = useMemo<FilterOption[]>(
    () => branches.map((branch) => ({ value: branch.id, label: branch.name })),

    [branches],
  )

  const query: ReportQuery = useMemo(
    () => ({
      from: filters.from || null,

      to: filters.to || null,

      projectId: supportsProject ? filters.projectId || null : null,

      branchId: supportsBranch ? filters.branchId || null : null,
    }),

    [
      filters.branchId,

      filters.from,

      filters.projectId,

      filters.to,

      supportsBranch,

      supportsProject,
    ],
  )

  // A key that changes with the report or any active filter remounts the result

  // panel, so it reloads exactly once per query without a manual effect.

  const panelKey = `${selectedId}|${query.from ?? ""}|${query.to ?? ""}|${
    query.projectId ?? ""
  }|${query.branchId ?? ""}`

  function patchFilters(next: Partial<FilterState>) {
    setFilters((current) => ({ ...current, ...next }))
  }

  function selectReport(id: ReportId) {
    setSelectedId(id)
  }

  if (!canViewReports) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader
          title="Reports"
          description="Financial and operational statements across the workspace."
        />

        <EmptyState
          icon={BarChart3}
          title="Reports not available"
          description="Your role does not have permission to read the reporting workspace."
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Reports"
        description="Generate a statement by period, project, and — where the data is attributed to a person — branch. Export to CSV or Excel, or print to PDF."
      />

      {catalog.error ? (
        <Alert variant="danger">
          <AlertDescription>{catalog.error}</AlertDescription>
        </Alert>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[16rem_1fr]">
          {/* Picker rail */}
          <Card className="h-fit">
            <CardHeader className="pb-2">
              <CardTitle className="text-[12px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
                Report type
              </CardTitle>
            </CardHeader>

            <CardContent className="p-1.5">
              {catalog.loading && reports.length === 0 ? (
                <div className="flex flex-col gap-1.5 p-1.5">
                  {Array.from({ length: 6 }, (_, index) => (
                    <Skeleton key={index} className="h-10 w-full" />
                  ))}
                </div>
              ) : (
                <ul className="flex flex-col gap-0.5">
                  {reports.map((report) => {
                    const Icon = reportIcon(report.icon)

                    const active = report.id === selectedId

                    return (
                      <li key={report.id}>
                        <button
                          type="button"
                          onClick={() => selectReport(report.id)}
                          aria-current={active ? "page" : undefined}
                          className={cn(
                            "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",

                            active
                              ? "bg-primary-subtle text-primary-subtle-foreground font-medium"
                              : "text-foreground hover:bg-muted/60",
                          )}
                        >
                          <Icon
                            size={15}
                            className={cn(
                              "shrink-0",

                              active ? "text-primary" : "text-muted-foreground",
                            )}
                          />

                          <span className="min-w-0 truncate">
                            {report.label}
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* Result column */}
          <div className="flex min-w-0 flex-col gap-3">
            <div className="rounded-md border border-border bg-card p-3">
              {selected && (
                <p className="mb-2.5 text-[12px] text-muted-foreground">
                  {selected.description}
                </p>
              )}

              <div className="flex flex-wrap items-end gap-2.5">
                <Field
                  label="From"
                  htmlFor="report-from"
                  className="w-[9.5rem]"
                >
                  <Input
                    id="report-from"
                    type="date"
                    value={filters.from}
                    max={filters.to || undefined}
                    onChange={(event) =>
                      patchFilters({ from: event.target.value })
                    }
                  />
                </Field>

                <Field label="To" htmlFor="report-to" className="w-[9.5rem]">
                  <Input
                    id="report-to"
                    type="date"
                    value={filters.to}
                    min={filters.from || undefined}
                    onChange={(event) =>
                      patchFilters({ to: event.target.value })
                    }
                  />
                </Field>

                {supportsProject ? (
                  <Field
                    label="Project"
                    htmlFor="report-project"
                    className="w-[12rem]"
                  >
                    <Select
                      value={filters.projectId || "__all"}
                      onValueChange={(value) =>
                        patchFilters({
                          projectId: value === "__all" ? "" : value,
                        })
                      }
                    >
                      <SelectTrigger id="report-project" size="sm">
                        <SelectValue placeholder="All projects" />
                      </SelectTrigger>

                      <SelectContent>
                        <SelectItem value="__all">All projects</SelectItem>

                        {projectOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                ) : null}

                {supportsBranch ? (
                  <Field
                    label="Branch"
                    htmlFor="report-branch"
                    className="w-[12rem]"
                  >
                    <Select
                      value={filters.branchId || "__all"}
                      onValueChange={(value) =>
                        patchFilters({
                          branchId: value === "__all" ? "" : value,
                        })
                      }
                    >
                      <SelectTrigger id="report-branch" size="sm">
                        <SelectValue placeholder="All branches" />
                      </SelectTrigger>

                      <SelectContent>
                        <SelectItem value="__all">All branches</SelectItem>

                        {branchOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                ) : (
                  <p className="flex items-end text-[11.5px] leading-4 text-muted-foreground">
                    Branch is not tracked against this data.
                  </p>
                )}

                {(filters.from ||
                  filters.to ||
                  filters.projectId ||
                  filters.branchId) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground"
                    onClick={() => setFilters(EMPTY_FILTERS)}
                  >
                    Clear
                  </Button>
                )}
              </div>
            </div>

            <ReportResultPanel
              key={panelKey}
              reportId={selectedId}
              query={query}
              supportedFilters={supportedFilters}
            />
          </div>
        </div>
      )}
    </div>
  )
}
