/**
 * The Audit Log — a read-only, tenant-wide event trail.
 *
 * Every booking, payment, price change, cancellation, transfer, document action,
 * and access attempt already writes a row to `audit_log`; this screen never adds
 * or edits one. It reads them back through `GET /api/audit-log`, filtered by
 * module, actor, and date range, and presents the values the action recorded —
 * a genuine before/after where the trail happens to carry one, otherwise the
 * recorded fields. Nothing is invented: an entry with no detail shows a dash, and
 * a window that exceeds the fetch cap says so rather than passing itself off as
 * the whole history.
 *
 * The module and actor dropdowns are fed by the server's facet counts, so they
 * only offer what is actually in range. The shared `DataTable` sorts, searches,
 * and pages the returned set; exports reuse `export.ts` (CSV, Excel) and the same
 * `data-document-print` isolation every other ledger uses for PDF.
 */

import { useCallback, useEffect, useMemo, useState } from "react"

import { Download, FileSpreadsheet, History, Printer } from "lucide-react"

import { Alert, AlertDescription } from "@/components/ui/alert"

import { Badge, type BadgeVariant } from "@/components/ui/badge"

import { Button } from "@/components/ui/button"

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

import { PageHeader } from "@/components/page-header"

import { Skeleton } from "@/components/ui/skeleton"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

import { useSession } from "@/lib/session-context"

import { useAsyncResource } from "@/lib/use-async-resource"

import { formatDateTime, orDash } from "@/lib/format"

import {
  exportRows,
  type ExportColumn,
  type ExportMetaLine,
} from "@/lib/export"

import { auditApi, type AuditQuery } from "@/lib/audit-api"

import {
  AUDIT_MODULE_IDS,
  AUDIT_MODULE_LABELS,
  describeAuditChanges,
  type AuditChange,
  type AuditEntryView,
  type AuditFacet,
  type AuditModuleId,
} from "@shared/audit"

const PAGE_LIMIT = 500

interface FilterState {
  module: string

  actorEmail: string

  from: string

  to: string
}

const EMPTY_FILTERS: FilterState = {
  module: "",

  actorEmail: "",

  from: "",

  to: "",
}

/** The trailing segment of a dotted action, shown as the change verb. */

function actionVerb(action: string): string {
  const parts = action.split(".")

  const last = parts[parts.length - 1] ?? action

  return last.replace(/_/g, " ")
}

/** A calm ledger colour: red only for loss, amber only for pending, blue for upkeep. */

function toneForAction(action: string): BadgeVariant {
  const key = action.toLowerCase()

  if (
    /cancel|delete|void|reject|denied|revoke|remove|archive|archived/.test(key)
  )
    return "danger"

  if (/requested|deferred|waiver|hold|awaiting|assigned|pending/.test(key))
    return "pending"

  if (/created|recorded|approved|confirmed|uploaded/.test(key)) return "success"

  if (/updated|commented|rotated|closed|access_updated/.test(key)) return "info"

  return "neutral"
}

function shortId(id: string | null): string {
  if (!id) return ""

  return id.length > 10 ? `${id.slice(0, 10)}…` : id
}

function targetText(row: AuditEntryView): string {
  if (!row.targetType && !row.targetId) return ""

  if (row.targetType && row.targetId)
    return `${row.targetType} · ${shortId(row.targetId)}`

  return row.targetType ?? shortId(row.targetId)
}

function rowSearchText(row: AuditEntryView): string {
  const detail = row.detail ? JSON.stringify(row.detail) : ""

  return [
    row.moduleLabel,

    row.action,

    row.actorEmail ?? "",

    targetText(row),

    detail,
  ].join(" ")
}

/** One change flattened to text for the CSV/Excel and print "Values" column. */

function changeToText(change: AuditChange): string {
  if (change.from !== null || change.to !== null)
    return `${change.label}: ${change.from ?? "—"} → ${change.to ?? "—"}`

  return `${change.label}: ${change.value ?? "—"}`
}

function valuesText(row: AuditEntryView): string {
  const changes = describeAuditChanges(row.detail)

  return changes.map(changeToText).join("; ")
}

function periodText(query: AuditQuery): string {
  if (query.from && query.to) return `${query.from} → ${query.to}`

  if (query.from) return `From ${query.from}`

  if (query.to) return `Up to ${query.to}`

  return "All time"
}

// --- Detail dialog ---------------------------------------------------------

interface AuditDetailDialogProps {
  row: AuditEntryView | null

  open: boolean

  onOpenChange: (open: boolean) => void
}

function AuditDetailDialog({
  row,

  open,

  onOpenChange,
}: AuditDetailDialogProps) {
  const changes = row ? describeAuditChanges(row.detail) : []

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] w-[calc(100%-2rem)] max-w-[38rem] flex-col">
        <DialogHeader>
          <DialogTitle>Audit event</DialogTitle>

          <DialogDescription>
            The recorded action and the values captured when it happened.
          </DialogDescription>
        </DialogHeader>

        {row ? (
          <div className="scrollbar-slim min-h-0 flex-1 overflow-y-auto">
            <dl className="grid grid-cols-[7.5rem_1fr] gap-x-4 gap-y-2 text-[13px]">
              <dt className="text-muted-foreground">When</dt>

              <dd className="tabular-nums text-foreground">
                {formatDateTime(row.createdAt)}
              </dd>

              <dt className="text-muted-foreground">Module</dt>

              <dd>
                <Badge variant="neutral">{row.moduleLabel}</Badge>
              </dd>

              <dt className="text-muted-foreground">Event</dt>

              <dd className="font-mono text-[12px] text-foreground break-all">
                {row.action}
              </dd>

              <dt className="text-muted-foreground">Actor</dt>

              <dd className="text-foreground">{orDash(row.actorEmail)}</dd>

              <dt className="text-muted-foreground">Target</dt>

              <dd className="text-foreground">{orDash(targetText(row))}</dd>

              <dt className="text-muted-foreground">Source IP</dt>

              <dd className="text-foreground">{orDash(row.ip)}</dd>
            </dl>

            <p className="mt-5 mb-1.5 text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
              Recorded values
            </p>

            {changes.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">
                No values were recorded on this event.
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {changes.map((change) => (
                  <li
                    key={change.label}
                    className="flex items-baseline justify-between gap-3 rounded-md border border-border bg-muted/30 px-2.5 py-1.5 text-[13px]"
                  >
                    <span className="shrink-0 text-muted-foreground">
                      {change.label}
                    </span>

                    {change.from !== null || change.to !== null ? (
                      <span className="min-w-0 text-right tabular-nums text-foreground">
                        <span className="text-muted-foreground line-through">
                          {change.from ?? "—"}
                        </span>

                        <span className="mx-1.5 text-muted-foreground">→</span>

                        <span>{change.to ?? "—"}</span>
                      </span>
                    ) : (
                      <span className="min-w-0 break-all text-right text-foreground">
                        {change.value ?? "—"}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// --- Print document --------------------------------------------------------

interface AuditPrintDocumentProps {
  rows: AuditEntryView[]

  query: AuditQuery
}

function AuditPrintDocument({ rows, query }: AuditPrintDocumentProps) {
  return (
    <article
      className="bg-card text-foreground"
      style={{ fontFamily: "var(--font-sans)" }}
    >
      <header className="flex items-start justify-between gap-6 border-b border-border-strong pb-4">
        <div className="min-w-0">
          <p className="text-[15px] leading-5 font-semibold tracking-tight">
            Audit log
          </p>

          <p className="mt-1 text-[12px] text-muted-foreground">
            Read-only event trail
          </p>
        </div>

        <div className="shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
          <p>Period: {periodText(query)}</p>

          <p>
            Module:{" "}
            {query.module
              ? AUDIT_MODULE_LABELS[(query.module as AuditModuleId)]
              : "All modules"}
          </p>

          <p>Actor: {query.actorEmail ?? "All users"}</p>

          <p>Generated: {formatDateTime(new Date().toISOString())}</p>
        </div>
      </header>

      <table className="w-full border-collapse text-[11px]">
        <thead>
          <tr className="text-left">
            {["When", "Module", "Event", "Actor", "Target", "Values"].map(
              (head) => (
                <th
                  key={head}
                  className="border-b border-border-strong py-1.5 pr-3 font-semibold"
                >
                  {head}
                </th>
              ),
            )}
          </tr>
        </thead>

        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="avoid-break-inside align-top">
              <td className="border-b border-border py-1.5 pr-3 whitespace-nowrap tabular-nums">
                {formatDateTime(row.createdAt)}
              </td>

              <td className="border-b border-border py-1.5 pr-3">
                {row.moduleLabel}
              </td>

              <td className="border-b border-border py-1.5 pr-3 break-all">
                {row.action}
              </td>

              <td className="border-b border-border py-1.5 pr-3">
                {orDash(row.actorEmail)}
              </td>

              <td className="border-b border-border py-1.5 pr-3">
                {orDash(targetText(row))}
              </td>

              <td className="border-b border-border py-1.5 pr-3">
                {valuesText(row) || "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <footer className="border-t border-border-strong pt-3 pb-1 text-[10px] leading-4 text-muted-foreground">
        {rows.length} entr{rows.length === 1 ? "y" : "ies"}
      </footer>
    </article>
  )
}

// --- Results (remounts on every filter change so it reloads once) ----------

interface AuditResultsProps {
  query: AuditQuery

  onFacets: (modules: AuditFacet[], actors: AuditFacet[]) => void
}

function AuditResults({ query, onFacets }: AuditResultsProps) {
  const resource = useAsyncResource((signal) => auditApi.list(query, signal))

  const [printing, setPrinting] = useState(false)

  const [detailRow, setDetailRow] = useState<AuditEntryView | null>(null)

  const data = resource.data

  useEffect(() => {
    if (data) onFacets(data.moduleFacets, data.actorFacets)
  }, [data, onFacets])

  const rows = useMemo(() => data?.entries ?? [], [data])

  const columns = useMemo<Array<DataTableColumn<AuditEntryView>>>(
    () => [
      {
        key: "when",

        header: "When",

        width: "11rem",

        sortValue: (row) => row.createdAt,

        cell: (row) => (
          <span className="whitespace-nowrap tabular-nums text-muted-foreground">
            {formatDateTime(row.createdAt)}
          </span>
        ),
      },

      {
        key: "module",

        header: "Module",

        width: "10rem",

        sortValue: (row) => row.moduleLabel,

        cell: (row) => <Badge variant="neutral">{row.moduleLabel}</Badge>,
      },

      {
        key: "event",

        header: "Event",

        sortValue: (row) => row.action,

        cell: (row) => (
          <span title={row.action} className="inline-flex items-center gap-2">
            <Badge variant={toneForAction(row.action)}>
              {actionVerb(row.action)}
            </Badge>

            <span className="hidden font-mono text-[11px] text-muted-foreground xl:inline">
              {row.action}
            </span>
          </span>
        ),
      },

      {
        key: "actor",

        header: "Actor",

        width: "13rem",

        sortValue: (row) => row.actorEmail ?? "",

        cell: (row) => (
          <span className="truncate text-foreground">
            {orDash(row.actorEmail)}
          </span>
        ),
      },

      {
        key: "target",

        header: "Target",

        width: "10rem",

        sortValue: (row) => targetText(row),

        cell: (row) => (
          <span className="text-muted-foreground">
            {orDash(targetText(row))}
          </span>
        ),
      },

      {
        key: "values",

        header: "Recorded values",

        cell: (row) => {
          const changes = describeAuditChanges(row.detail)

          if (changes.length === 0)
            return <span className="text-muted-foreground">—</span>

          const preview = changes.slice(0, 2).map(changeToText).join(" · ")

          return (
            <span className="text-foreground">
              {preview}
              {changes.length > 2 ? (
                <span className="text-muted-foreground">
                  {" "}
                  +{changes.length - 2} more
                </span>
              ) : null}
            </span>
          )
        },
      },
    ],

    [],
  )

  const exportColumns = useMemo<ExportColumn<AuditEntryView>[]>(
    () => [
      { header: "When", value: (row) => row.createdAt },

      { header: "Module", value: (row) => row.moduleLabel },

      { header: "Event", value: (row) => row.action },

      { header: "Actor", value: (row) => row.actorEmail ?? "" },

      { header: "Target", value: (row) => targetText(row) },

      { header: "Source IP", value: (row) => row.ip ?? "" },

      { header: "Values", value: (row) => valuesText(row) },
    ],

    [],
  )

  if (resource.error) {
    return (
      <Alert variant="danger">
        <AlertDescription>{resource.error}</AlertDescription>
      </Alert>
    )
  }

  if (resource.loading && !data) {
    return <Skeleton className="h-64 w-full" />
  }

  if (!data) return null

  function exportMeta(): ExportMetaLine[] {
    return [
      { label: "Report", value: "Audit log" },

      { label: "Period", value: periodText(query) },

      {
        label: "Module",

        value: query.module
          ? AUDIT_MODULE_LABELS[(query.module as AuditModuleId)]
          : "All modules",
      },

      { label: "Actor", value: query.actorEmail ?? "All users" },

      { label: "Generated", value: formatDateTime(new Date().toISOString()) },
    ]
  }

  function runExport(format: "csv" | "excel") {
    exportRows(format, {
      filenameStem: "audit-log",

      title: "Audit log",

      columns: exportColumns,

      rows,

      meta: exportMeta(),
    })
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11.5px] text-muted-foreground tabular-nums">
          {rows.length} entr{rows.length === 1 ? "y" : "ies"}
          {data.truncated ? (
            <span className="ml-1.5">
              · most recent {data.limit} in range — narrow the filters to see
              more
            </span>
          ) : null}
        </span>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => runExport("csv")}
            disabled={rows.length === 0}
          >
            <Download size={13} />
            CSV
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => runExport("excel")}
            disabled={rows.length === 0}
          >
            <FileSpreadsheet size={13} />
            Excel
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setPrinting(true)}
            disabled={rows.length === 0}
          >
            <Printer size={13} />
            PDF
          </Button>
        </div>
      </div>

      <div className="rounded-md border border-border">
        <DataTable<AuditEntryView>
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          getRowSearchText={rowSearchText}
          loading={resource.loading}
          initialSort={{ key: "when", direction: "desc" }}
          maxHeight="calc(100vh - 24rem)"
          caption="Audit log"
          onRowClick={(row) => setDetailRow(row)}
          emptyState={
            <EmptyState
              icon={History}
              size="sm"
              title="No events under these filters"
              description="Widen the date range, or clear the module and actor filters, to see the trail."
            />
          }
        />
      </div>

      <AuditDetailDialog
        row={detailRow}
        open={detailRow !== null}
        onOpenChange={(open) => {
          if (!open) setDetailRow(null)
        }}
      />

      <Dialog open={printing} onOpenChange={setPrinting}>
        <DialogContent
          data-document-print=""
          className="flex w-[calc(100%-2rem)] max-w-[52rem] flex-col"
        >
          <DialogHeader className="print-hidden">
            <DialogTitle>Audit log</DialogTitle>

            <DialogDescription>
              Review the trail, then print or save it as a PDF.
            </DialogDescription>
          </DialogHeader>

          <div className="scrollbar-slim min-h-0 flex-1 overflow-y-auto border border-border bg-muted/20 p-3 sm:p-5">
            <div className="mx-auto max-w-[46rem] border border-border bg-card p-6 shadow-card sm:p-8">
              <AuditPrintDocument rows={rows} query={query} />
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

export function AuditLogPage() {
  const { can } = useSession()

  const canView = can("audit", "view")

  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS)

  const [moduleCounts, setModuleCounts] = useState<Record<string, number>>({})

  const [actorOptions, setActorOptions] = useState<AuditFacet[]>([])

  const handleFacets = useCallback(
    (modules: AuditFacet[], actors: AuditFacet[]) => {
      const nextCounts: Record<string, number> = {}

      for (const facet of modules) nextCounts[facet.value] = facet.count

      setModuleCounts(nextCounts)

      setActorOptions(actors)
    },

    [],
  )

  const query: AuditQuery = useMemo(
    () => ({
      module: (filters.module || null) as AuditModuleId | null,

      actorEmail: filters.actorEmail || null,

      from: filters.from || null,

      to: filters.to || null,

      limit: PAGE_LIMIT,
    }),

    [filters],
  )

  const panelKey = `${filters.module}|${filters.actorEmail}|${filters.from}|${filters.to}`

  const moduleOptions = useMemo<FilterOption[]>(
    () =>
      AUDIT_MODULE_IDS.map((id) => {
        const count = moduleCounts[id] ?? 0

        return {
          value: id,

          label:
            count > 0
              ? `${AUDIT_MODULE_LABELS[id]} (${count})`
              : AUDIT_MODULE_LABELS[id],
        }
      }),

    [moduleCounts],
  )

  const actorFilterOptions = useMemo<FilterOption[]>(() => {
    const seen = new Set<string>()

    const options: FilterOption[] = []

    for (const facet of actorOptions) {
      if (seen.has(facet.value)) continue

      seen.add(facet.value)

      options.push({
        value: facet.value,

        label: `${facet.value} (${facet.count})`,
      })
    }

    if (filters.actorEmail && !seen.has(filters.actorEmail)) {
      options.unshift({ value: filters.actorEmail, label: filters.actorEmail })
    }

    return options
  }, [actorOptions, filters.actorEmail])

  function patchFilters(next: Partial<FilterState>) {
    setFilters((current) => ({ ...current, ...next }))
  }

  const filtersActive =
    filters.module !== "" ||
    filters.actorEmail !== "" ||
    filters.from !== "" ||
    filters.to !== ""

  if (!canView) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader
          title="Audit log"
          description="The read-only trail of privileged actions across the workspace."
        />

        <EmptyState
          icon={History}
          title="Audit log not available"
          description="Your role does not have permission to review the workspace event trail."
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Audit log"
        description="Every booking, payment, price change, cancellation, transfer, document, and access event, with the actor, timestamp, and recorded values. Filterable by module, user, and date."
      />

      <div className="rounded-md border border-border bg-card p-3">
        <div className="flex flex-wrap items-end gap-2.5">
          <Field label="Module" htmlFor="audit-module" className="w-[13rem]">
            <Select
              value={filters.module || "__all"}
              onValueChange={(value) =>
                patchFilters({ module: value === "__all" ? "" : value })
              }
            >
              <SelectTrigger id="audit-module" size="sm">
                <SelectValue placeholder="All modules" />
              </SelectTrigger>

              <SelectContent>
                <SelectItem value="__all">All modules</SelectItem>

                {moduleOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="User" htmlFor="audit-actor" className="w-[15rem]">
            <Select
              value={filters.actorEmail || "__all"}
              onValueChange={(value) =>
                patchFilters({ actorEmail: value === "__all" ? "" : value })
              }
            >
              <SelectTrigger id="audit-actor" size="sm">
                <SelectValue placeholder="All users" />
              </SelectTrigger>

              <SelectContent>
                <SelectItem value="__all">All users</SelectItem>

                {actorFilterOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="From" htmlFor="audit-from" className="w-[9.5rem]">
            <Input
              id="audit-from"
              type="date"
              value={filters.from}
              max={filters.to || undefined}
              onChange={(event) => patchFilters({ from: event.target.value })}
            />
          </Field>

          <Field label="To" htmlFor="audit-to" className="w-[9.5rem]">
            <Input
              id="audit-to"
              type="date"
              value={filters.to}
              min={filters.from || undefined}
              onChange={(event) => patchFilters({ to: event.target.value })}
            />
          </Field>

          {filtersActive ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() => setFilters(EMPTY_FILTERS)}
            >
              Clear
            </Button>
          ) : null}
        </div>
      </div>

      <AuditResults key={panelKey} query={query} onFacets={handleFacets} />
    </div>
  )
}

export default AuditLogPage
