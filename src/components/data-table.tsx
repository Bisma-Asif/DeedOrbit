import { useMemo, useState, type ReactNode } from "react"
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronsLeft,
  ChevronsRight,
  ChevronsUpDown,
  ListFilter,
  Search,
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export type SortDirection = "asc" | "desc"

export type DataTableSort = {
  key: string
  direction: SortDirection
}

/** Option shape shared by the table's filter selects. */
export type FilterOption = {
  value: string
  label: string
}

export type DataTableColumn<T,> = {
  key: string
  header: ReactNode
  cell: (row: T, index: number) => ReactNode
  /** Provide to make the column sortable. Omit for non-comparable columns. */
  sortValue?: (row: T) => string | number
  align?: "left" | "center" | "right"
  /** Applied to both the header and body cells. */
  className?: string
  headerClassName?: string
  width?: string
}

export type DataTableProps<T,> = {
  columns: Array<DataTableColumn<T>>
  rows: T[]
  rowKey: (row: T) => string
  /** Powers the built-in search box in the filter bar. */
  getRowSearchText?: (row: T) => string
  initialSort?: DataTableSort
  pageSize?: number
  pageSizeOptions?: number[]
  /** Owned by the caller so filter controls can live outside the table. */
  filters?: Record<string, string>
  onFilterChange?: (key: string, value: string) => void
  /** Bumped by the table's "Reset" button; callers can clear their own state. */
  resetToken?: number
  /** Rendered inside the filter bar, after the search box. */
  filterBar?: ReactNode
  /** Rendered at the right edge of the filter bar (exports, row actions). */
  toolbar?: ReactNode
  emptyState?: ReactNode
  /**
   * Shows skeleton rows instead of the empty state while the first load is in
   * flight. Without this a table renders "no records" and then pops, which
   * reads as an empty dataset rather than a pending request.
   */
  loading?: boolean
  loadingRowCount?: number
  /** Caps the scroll viewport. Required for the sticky header to take effect. */
  maxHeight?: string
  stickyHeader?: boolean
  showFilterBar?: boolean
  caption?: string
  onRowClick?: (row: T) => void
  className?: string
}

const alignClass = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
} as const

function NoMatchState() {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center px-6 py-8 text-center">
      <ListFilter size={18} className="text-muted-foreground" />
      <p className="mt-2.5 text-[13px] font-medium text-foreground">
        No records match these filters
      </p>
      <p className="mt-1 max-w-sm text-[12px] leading-5 text-muted-foreground">
        Adjust or reset the filters above to see more results.
      </p>
    </div>
  )
}

function NoRecordsState() {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center px-6 py-8 text-center">
      <ListFilter size={18} className="text-muted-foreground" />
      <p className="mt-2.5 text-[13px] font-medium text-foreground">
        No records yet
      </p>
      <p className="mt-1 max-w-sm text-[12px] leading-5 text-muted-foreground">
        Records added to this module will appear here.
      </p>
    </div>
  )
}

function compare(a: string | number, b: string | number): number {
  if (typeof a === "number" && typeof b === "number") return a - b
  return String(a).localeCompare(String(b), undefined, {
    numeric: true,
    sensitivity: "base",
  })
}

/**
 * The single table used by every module. Provides client-side sorting,
 * pagination, a filter bar and a sticky header row so screens stay dense
 * without any module re-implementing table chrome.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  getRowSearchText,
  initialSort,
  pageSize = 25,
  pageSizeOptions = [25, 50, 100],
  filters = {},
  onFilterChange,
  resetToken = 0,
  filterBar,
  toolbar,
  emptyState,
  loading = false,
  loadingRowCount = 8,
  maxHeight,
  stickyHeader = true,
  showFilterBar = true,
  caption,
  onRowClick,
  className,
}: DataTableProps<T>) {
  const [query, setQuery] = useState("")
  const [sort, setSort] = useState<DataTableSort | null>(initialSort ?? null)
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(pageSize)
  const [seenResetToken, setSeenResetToken] = useState(resetToken)

  // Reset requested from outside the table (e.g. a "Clear filters" action).
  if (seenResetToken !== resetToken) {
    setSeenResetToken(resetToken)
    setPage(0)
  }

  const activeFilterCount = Object.values(filters).filter(Boolean).length
  const filtersActive = activeFilterCount > 0 || query.length > 0

  const searchedRows = useMemo(() => {
    if (!getRowSearchText) return rows
    const needle = query.trim().toLowerCase()
    if (!needle) return rows
    return rows.filter((row) =>
      getRowSearchText(row).toLowerCase().includes(needle),
    )
  }, [getRowSearchText, query, rows])

  const sortedRows = useMemo(() => {
    if (!sort) return searchedRows
    const column = columns.find((entry) => entry.key === sort.key)
    if (!column?.sortValue) return searchedRows
    const read = column.sortValue
    const factor = sort.direction === "asc" ? 1 : -1
    return [...searchedRows].sort((a, b) => compare(read(a), read(b)) * factor)
  }, [columns, searchedRows, sort])

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / rowsPerPage))
  const safePage = Math.min(page, totalPages - 1)
  const pageStart = safePage * rowsPerPage
  const visibleRows = sortedRows.slice(pageStart, pageStart + rowsPerPage)

  function toggleSort(key: string) {
    setPage(0)
    setSort((current) => {
      if (!current || current.key !== key) return { key, direction: "asc" }
      if (current.direction === "asc") return { key, direction: "desc" }
      return null
    })
  }

  function resetFilters() {
    setQuery("")
    setPage(0)
    const keys = Object.keys(filters)
    if (onFilterChange) keys.forEach((key) => onFilterChange(key, ""))
  }

  const columnCount = columns.length

  return (
    <div className={cn("flex min-w-0 flex-col", className)}>
      {showFilterBar && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
          {getRowSearchText && (
            <div className="relative w-full min-w-0 sm:w-56">
              <Search
                size={14}
                className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value)
                  setPage(0)
                }}
                placeholder="Search records"
                aria-label="Search records"
                className="pl-7.5"
              />
            </div>
          )}

          {filterBar}

          <div className="ml-auto flex items-center gap-2">
            {toolbar}
            {filtersActive && (
              <Button variant="ghost" size="sm" onClick={resetFilters}>
                <X size={13} />
                Reset
              </Button>
            )}
          </div>
        </div>
      )}

      <div
        className="scrollbar-slim relative w-full overflow-auto"
        style={maxHeight ? { maxHeight } : undefined}
      >
        <table className="w-full border-collapse text-[13px]">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead>
            <tr>
              {columns.map((column) => {
                const isActive = sort?.key === column.key
                const SortIcon = !isActive
                  ? ChevronsUpDown
                  : sort.direction === "asc"
                    ? ChevronUp
                    : ChevronDown
                return (
                  <th
                    key={column.key}
                    scope="col"
                    style={column.width ? { width: column.width } : undefined}
                    aria-sort={
                      isActive
                        ? sort.direction === "asc"
                          ? "ascending"
                          : "descending"
                        : "none"
                    }
                    className={cn(
                      "h-8 border-b border-border px-3 text-[10.5px] font-semibold tracking-[0.06em] whitespace-nowrap text-muted-foreground uppercase select-none",
                      stickyHeader && "sticky top-0 z-10 bg-muted",
                      alignClass[column.align ?? "left"],
                      column.headerClassName,
                    )}
                  >
                    {column.sortValue ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(column.key)}
                        className={cn(
                          "group inline-flex items-center gap-1 rounded-sm py-0.5 transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                          isActive && "text-foreground",
                          column.align === "right" && "flex-row-reverse",
                        )}
                      >
                        {column.header}
                        <SortIcon
                          size={12}
                          className={cn(
                            "shrink-0 text-muted-foreground/60 transition-colors group-hover:text-muted-foreground",
                            isActive && "text-primary",
                          )}
                        />
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                )
              })}
            </tr>
          </thead>

          <tbody>
            {loading ? (
              Array.from({ length: loadingRowCount }, (_, index) => (
                <tr
                  key={`skeleton-${index}`}
                  className="border-b border-border last:border-b-0"
                >
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={cn(
                        "h-9 px-3 align-middle",
                        alignClass[column.align ?? "left"],
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className="block h-3 w-full max-w-28 animate-pulse rounded bg-muted"
                        style={
                          index % 3 === 1 && column.align === "right"
                            ? { marginLeft: "auto" }
                            : undefined
                        }
                      />
                    </td>
                  ))}
                </tr>
              ))
            ) : visibleRows.length > 0 ? (
              visibleRows.map((row, index) => (
                <tr
                  key={rowKey(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn(
                    "border-b border-border last:border-b-0 transition-colors hover:bg-muted/50",
                    onRowClick && "cursor-pointer",
                  )}
                >
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={cn(
                        "h-9 px-3 align-middle text-foreground",
                        alignClass[column.align ?? "left"],
                        column.className,
                      )}
                    >
                      {column.cell(row, pageStart + index)}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={columnCount} className="p-0 align-middle">
                  {/* A custom empty state describes the module, not a filter
                      miss, so it only applies when nothing is being filtered. */}
                  {filtersActive ? (
                    <NoMatchState />
                  ) : (
                    (emptyState ?? <NoRecordsState />)
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border px-3 py-1.5">
        <p className="text-[11.5px] text-muted-foreground tabular-nums">
          {sortedRows.length === 0
            ? "0 records"
            : `Showing ${pageStart + 1}–${Math.min(pageStart + rowsPerPage, sortedRows.length)} of ${sortedRows.length.toLocaleString("en-US")}`}
        </p>

        <div className="flex items-center gap-3">
          <div className="hidden items-center gap-1.5 sm:flex">
            <span className="text-[11.5px] text-muted-foreground">Rows</span>
            <Select
              value={String(rowsPerPage)}
              onValueChange={(value) => {
                setRowsPerPage(Number(value))
                setPage(0)
              }}
            >
              <SelectTrigger
                size="sm"
                className="w-16"
                aria-label="Rows per page"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                {pageSizeOptions.map((option) => (
                  <SelectItem key={option} value={String(option)}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <nav className="flex items-center gap-1" aria-label="Pagination">
            <Button
              variant="outline"
              size="icon-sm"
              disabled={safePage === 0}
              onClick={() => setPage(0)}
              aria-label="First page"
            >
              <ChevronsLeft size={13} />
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              disabled={safePage === 0}
              onClick={() => setPage(safePage - 1)}
              aria-label="Previous page"
            >
              <ChevronLeft size={13} />
            </Button>
            <span className="px-1.5 text-[11.5px] text-muted-foreground tabular-nums">
              Page {safePage + 1} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="icon-sm"
              disabled={safePage >= totalPages - 1}
              onClick={() => setPage(safePage + 1)}
              aria-label="Next page"
            >
              <ChevronRight size={13} />
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              disabled={safePage >= totalPages - 1}
              onClick={() => setPage(totalPages - 1)}
              aria-label="Last page"
            >
              <ChevronsRight size={13} />
            </Button>
          </nav>
        </div>
      </div>
    </div>
  )
}

/** Compact labelled select for use inside a DataTable filter bar. */
export function TableFilter({
  label,
  value,
  placeholder,
  options,
  onValueChange,
  className,
}: {
  label: string
  value: string
  placeholder: string
  options: ReadonlyArray<FilterOption>
  onValueChange: (value: string) => void
  className?: string
}) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger
        size="sm"
        className={cn("w-auto gap-1.5", className)}
        aria-label={label}
      >
        <span className="text-muted-foreground">{label}:</span>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__all">{placeholder}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
