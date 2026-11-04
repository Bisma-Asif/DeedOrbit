/**
 * The customer's complete account ledger: every money event, oldest first, with
 * the running balance the server folds in at read — now filterable and exportable.
 *
 * The trail itself is unchanged and stays honest: a row is only ever appended, and
 * the balance is the signed running sum over the *whole* account, so a filtered
 * reading never fakes a total. That is why the date and type filters here slice the
 * already-loaded rows rather than re-querying a subtotal — every visible row keeps
 * the balance the account actually reached, and a filtered view shows the opening
 * balance carried in from before the window so the statement still foots.
 *
 * Export is the finance desk's hand-off: CSV and Excel of the rows currently in
 * view (raw numbers, dated by occurrence), and a print-to-PDF statement that reuses
 * the same `@media print` isolation the receipt and quotation documents use. Nothing
 * here adds a dependency or a new number kind; it is the ledger, seen through a
 * filter, on paper or in a spreadsheet.
 */

import { useEffect, useMemo, useRef, useState } from "react"

import { Download, FileSpreadsheet, Printer, Wallet } from "lucide-react"

import { Alert, AlertDescription } from "@/components/ui/alert"

import { Badge } from "@/components/ui/badge"

import { Button } from "@/components/ui/button"

import {
  DataTable,
  TableFilter,
  type DataTableColumn,
  type FilterOption,
} from "@/components/data-table"

import { EmptyState } from "@/components/empty-state"

import { Field } from "@/components/field"

import { Input } from "@/components/ui/input"

import { Skeleton } from "@/components/ui/skeleton"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

import { useSession } from "@/lib/session-context"

import { useAsyncResource } from "@/lib/use-async-resource"

import { formatCurrency, formatDate, orDash } from "@/lib/format"

import { paymentsApi } from "@/lib/payments-api"

import {
  exportRows,
  type ExportColumn,
  type ExportMetaLine,
} from "@/lib/export"

import type { LedgerEntry, LedgerKind } from "@shared/ledger"

import {
  LEDGER_KINDS,
  LEDGER_KIND_LABELS,
  LEDGER_KIND_TONES,
} from "@shared/ledger"

interface CustomerLedgerProps {
  customerId: string

  /** The account name, shown on the statement header and used for the file title. */

  customerName: string

  /** Bumped by the parent after a money mutation so the ledger refetches. */

  reloadToken?: number
}

/** The leading date of an entry as `YYYY-MM-DD`, so string compare orders it. */

function entryDate(entry: LedgerEntry): string {
  return entry.occurredAt.slice(0, 10)
}

const KIND_OPTIONS: FilterOption[] = LEDGER_KINDS.map((kind: LedgerKind) => ({
  value: kind,

  label: LEDGER_KIND_LABELS[kind],
}))

/**
 * The printed statement — the same ledger, laid out for paper.
 *
 * It carries a compact letterhead-style header (account, period, currency), the
 * filters it was drawn under, an opening-balance line, the dated rows with their
 * true running balance, and a closing balance. It lives inside the dialog marked
 * `data-document-print`, so the browser prints this alone.
 */

interface LedgerStatementProps {
  customerName: string

  currency: string

  from: string

  to: string

  kind: string

  openingBalance: number

  closingBalance: number

  entries: LedgerEntry[]
}

function LedgerStatementDocument({
  customerName,

  currency,

  from,

  to,

  kind,

  openingBalance,

  closingBalance,

  entries,
}: LedgerStatementProps) {
  const money = (value: number) =>
    formatCurrency(value, currency, { maximumFractionDigits: 0 })

  const period =
    from || to
      ? `${from ? formatDate(from) : "Start"} — ${
          to ? formatDate(to) : "Today"
        }`
      : "All time"

  return (
    <article
      className="bg-card text-foreground"
      style={{ fontFamily: "var(--font-sans)" }}
    >
      <header className="flex items-start justify-between gap-6 border-b border-border-strong pb-4">
        <div className="min-w-0">
          <p className="text-[15px] leading-5 font-semibold tracking-tight">
            Account Statement
          </p>

          <p className="mt-1 text-[12px] text-muted-foreground">
            {customerName}
          </p>
        </div>

        <div className="shrink-0 text-right">
          <p className="text-[11px] tabular-nums text-muted-foreground">
            {period}
          </p>

          <p className="text-[11px] text-muted-foreground">
            Currency {currency}
          </p>
        </div>
      </header>

      <section className="border-b border-border py-3 text-[11px] text-muted-foreground">
        {kind
          ? `Filtered to ${LEDGER_KIND_LABELS[(kind as LedgerKind)]} entries`
          : "All transaction types"}
        {from || to ? " · date range applied" : ""}
      </section>

      <table className="mt-3 w-full border-collapse text-[12px]">
        <thead>
          <tr>
            {["Date", "Type", "Reference", "Note", "Amount", "Balance"].map(
              (heading, index) => (
                <td
                  key={heading}
                  className={`border-b border-border-strong py-1.5 text-[9.5px] font-semibold tracking-[0.08em] text-muted-foreground uppercase ${
                    index >= 4 ? "text-right" : "pr-3"
                  }`}
                >
                  {heading}
                </td>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          <tr className="avoid-break-inside">
            <td colSpan={4} className="py-1.5 pr-3 text-[11.5px] font-semibold">
              Opening balance
            </td>
            <td className="py-1.5 pr-3" />
            <td className="py-1.5 text-right font-semibold tabular-nums">
              {money(openingBalance)}
            </td>
          </tr>

          {entries.map((entry) => (
            <tr key={entry.id} className="avoid-break-inside">
              <td className="border-b border-border py-1.5 pr-3 tabular-nums text-muted-foreground whitespace-nowrap">
                {formatDate(entry.occurredAt)}
              </td>
              <td className="border-b border-border py-1.5 pr-3">
                {LEDGER_KIND_LABELS[entry.kind]}
              </td>
              <td className="border-b border-border py-1.5 pr-3 font-mono text-[11px]">
                {orDash(entry.reference ?? entry.bookingReference)}
              </td>
              <td className="border-b border-border py-1.5 pr-3 text-muted-foreground">
                {orDash(entry.note)}
              </td>
              <td className="border-b border-border py-1.5 pr-3 text-right tabular-nums">
                {money(entry.amount)}
              </td>
              <td className="border-b border-border py-1.5 text-right tabular-nums">
                {money(entry.balanceAfter)}
              </td>
            </tr>
          ))}

          <tr className="avoid-break-inside">
            <td
              colSpan={4}
              className="border-b-2 border-border-strong py-2 pr-3 text-[12.5px] font-semibold"
            >
              Closing balance
            </td>
            <td className="border-b-2 border-border-strong py-2 pr-3" />
            <td className="border-b-2 border-border-strong py-2 text-right text-[13px] font-semibold tabular-nums">
              {money(closingBalance)}
            </td>
          </tr>
        </tbody>
      </table>

      <footer className="border-t border-border-strong pt-3 pb-1 text-[10px] leading-4 text-muted-foreground">
        {entries.length} entr{entries.length === 1 ? "y" : "ies"} shown.
        Balances are the account's running totals, so a filtered statement still
        foots to the closing balance above.
      </footer>
    </article>
  )
}

export function CustomerLedger({
  customerId,

  customerName,

  reloadToken = 0,
}: CustomerLedgerProps) {
  const { can } = useSession()

  const canViewMoney = can("payments", "view")

  const ledger = useAsyncResource(
    (signal) => paymentsApi.ledger(customerId, signal),

    canViewMoney,
  )

  // A money mutation elsewhere in the section bumps `reloadToken`; refetch so the

  // new row and its balance appear without a manual refresh. The first run is the

  // resource's own mount load, so it is skipped.

  const mounted = useRef(false)

  const reload = ledger.reload

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true

      return
    }

    void reload()
  }, [reloadToken, reload])

  const [from, setFrom] = useState("")

  const [to, setTo] = useState("")

  const [kind, setKind] = useState("")

  const [printing, setPrinting] = useState(false)

  const currency = ledger.data?.currency ?? "AED"

  const money = useMemo(
    () => (value: number) =>
      formatCurrency(value, currency, { maximumFractionDigits: 0 }),

    [currency],
  )

  const allEntries = useMemo(() => ledger.data?.entries ?? [], [ledger.data])

  // The opening balance is the account total carried in from before the window:

  // the running balance of the last entry that predates `from`. Kind never moves

  // it, because the balance is a property of the whole account, not one type.

  const openingBalance = useMemo(() => {
    if (!from) return 0

    let balance = 0

    for (const entry of allEntries) {
      if (entryDate(entry) < from) balance = entry.balanceAfter
      else break
    }

    return balance
  }, [allEntries, from])

  const visibleEntries = useMemo(
    () =>
      allEntries.filter((entry) => {
        const date = entryDate(entry)

        if (from && date < from) return false

        if (to && date > to) return false

        if (kind && entry.kind !== kind) return false

        return true
      }),

    [allEntries, from, kind, to],
  )

  const closingBalance =
    visibleEntries.length > 0
      ? visibleEntries[visibleEntries.length - 1].balanceAfter
      : openingBalance

  const filtersActive = Boolean(from || to || kind)

  const columns = useMemo<Array<DataTableColumn<LedgerEntry>>>(
    () => [
      {
        key: "date",

        header: "Date",

        width: "8.5rem",

        sortValue: (row) => row.occurredAt,

        cell: (row) => (
          <span className="whitespace-nowrap tabular-nums text-muted-foreground">
            {formatDate(row.occurredAt)}
          </span>
        ),
      },

      {
        key: "kind",

        header: "Entry",

        width: "11rem",

        sortValue: (row) => row.kind,

        cell: (row) => (
          <Badge variant={LEDGER_KIND_TONES[row.kind]}>
            {LEDGER_KIND_LABELS[row.kind]}
          </Badge>
        ),
      },

      {
        key: "reference",

        header: "Reference",

        width: "10rem",

        cell: (row) => (
          <span className="font-mono text-[11.5px] text-foreground">
            {orDash(row.reference ?? row.bookingReference)}
          </span>
        ),
      },

      {
        key: "note",

        header: "Note",

        cell: (row) => (
          <span className="truncate text-muted-foreground">
            {orDash(row.note)}
          </span>
        ),
      },

      {
        key: "amount",

        header: "Amount",

        align: "right",

        width: "8.5rem",

        sortValue: (row) => row.amount,

        cell: (row) => (
          <span
            className={
              row.amount <= 0
                ? "tabular-nums text-success"
                : "tabular-nums text-danger"
            }
          >
            {row.amount <= 0 ? "" : "+"}
            {money(row.amount)}
          </span>
        ),
      },

      {
        key: "balance",

        header: "Balance",

        align: "right",

        width: "9rem",

        sortValue: (row) => row.balanceAfter,

        cell: (row) => (
          <span className="tabular-nums">{money(row.balanceAfter)}</span>
        ),
      },
    ],

    [money],
  )

  function clearFilters() {
    setFrom("")

    setTo("")

    setKind("")
  }

  const exportColumns: ExportColumn<LedgerEntry>[] = useMemo(
    () => [
      { header: "Date", value: (row) => entryDate(row) },

      { header: "Type", value: (row) => LEDGER_KIND_LABELS[row.kind] },

      {
        header: "Reference",
        value: (row) => row.reference ?? row.bookingReference ?? "",
      },

      { header: "Booking", value: (row) => row.bookingReference ?? "" },

      { header: "Note", value: (row) => row.note ?? "" },

      { header: "Amount", value: (row) => row.amount },

      { header: "Running Balance", value: (row) => row.balanceAfter },
    ],

    [],
  )

  function exportMeta(): ExportMetaLine[] {
    return [
      { label: "Account", value: customerName },

      { label: "Currency", value: currency },

      {
        label: "Period",

        value:
          from || to ? `${from || "start"} → ${to || "today"}` : "All time",
      },

      {
        label: "Type filter",

        value: kind ? LEDGER_KIND_LABELS[(kind as LedgerKind)] : "All",
      },

      { label: "Opening balance", value: money(openingBalance) },

      { label: "Closing balance", value: money(closingBalance) },
    ]
  }

  function runExport(format: "csv" | "excel") {
    exportRows(format, {
      filenameStem: `ledger-${customerName}`,

      title: "Customer Ledger",

      columns: exportColumns,

      rows: visibleEntries,

      meta: exportMeta(),
    })
  }

  if (!canViewMoney) {
    return (
      <EmptyState
        icon={Wallet}
        size="sm"
        title="Account history not available"
        description="Your role cannot read the customer ledger or receipts."
      />
    )
  }

  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-[13px] font-semibold text-foreground">
          Account ledger
          {ledger.data ? (
            <span className="ml-2 text-[12px] font-normal text-muted-foreground">
              balance {money(ledger.data.balance)}
            </span>
          ) : null}
        </p>

        <div className="flex flex-wrap items-end gap-2">
          <Field label="From" htmlFor="ledger-from" className="w-[9.5rem]">
            <Input
              id="ledger-from"
              type="date"
              value={from}
              max={to || undefined}
              onChange={(event) => setFrom(event.target.value)}
            />
          </Field>

          <Field label="To" htmlFor="ledger-to" className="w-[9.5rem]">
            <Input
              id="ledger-to"
              type="date"
              value={to}
              min={from || undefined}
              onChange={(event) => setTo(event.target.value)}
            />
          </Field>

          <TableFilter
            label="Type"
            value={kind}
            placeholder="All types"
            options={KIND_OPTIONS}
            onValueChange={setKind}
          />

          <Button
            variant="outline"
            size="sm"
            onClick={() => runExport("csv")}
            disabled={visibleEntries.length === 0}
          >
            <Download size={13} />
            CSV
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => runExport("excel")}
            disabled={visibleEntries.length === 0}
          >
            <FileSpreadsheet size={13} />
            Excel
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setPrinting(true)}
            disabled={visibleEntries.length === 0}
          >
            <Printer size={13} />
            PDF
          </Button>

          {filtersActive ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={clearFilters}
            >
              Clear
            </Button>
          ) : null}
        </div>
      </div>

      {ledger.error ? (
        <Alert variant="danger">
          <AlertDescription>{ledger.error}</AlertDescription>
        </Alert>
      ) : ledger.loading && !ledger.data ? (
        <Skeleton className="h-40 w-full" />
      ) : allEntries.length === 0 ? (
        <EmptyState
          icon={Wallet}
          size="sm"
          title="No ledger entries"
          description="Money events on this account will appear here."
        />
      ) : (
        <div className="flex flex-col gap-2">
          {filtersActive ? (
            <p className="text-[11.5px] text-muted-foreground">
              Showing {visibleEntries.length} of {allEntries.length} entries
              {from || to ? ` · opening balance ${money(openingBalance)}` : ""}
            </p>
          ) : null}

          {visibleEntries.length === 0 ? (
            <EmptyState
              icon={Wallet}
              size="sm"
              title="No entries match these filters"
              description="Widen the date range or clear the type filter to see more."
            />
          ) : (
            <div className="rounded-md border border-border">
              <DataTable<LedgerEntry>
                columns={columns}
                rows={visibleEntries}
                rowKey={(row) => row.id}
                initialSort={{ key: "date", direction: "asc" }}
                maxHeight="24rem"
                showFilterBar={false}
                caption="Account ledger"
              />
            </div>
          )}
        </div>
      )}

      <Dialog open={printing} onOpenChange={(open) => setPrinting(open)}>
        <DialogContent
          data-document-print=""
          className="flex w-[calc(100%-2rem)] max-w-[46rem] flex-col"
        >
          <DialogHeader className="print-hidden">
            <DialogTitle>Account statement — {customerName}</DialogTitle>

            <DialogDescription>
              Review the statement, then print or save it as a PDF.
            </DialogDescription>
          </DialogHeader>

          <div className="scrollbar-slim min-h-0 flex-1 overflow-y-auto border border-border bg-muted/20 p-3 sm:p-5">
            <div className="mx-auto max-w-[38rem] border border-border bg-card p-6 shadow-card sm:p-8">
              <LedgerStatementDocument
                customerName={customerName}
                currency={currency}
                from={from}
                to={to}
                kind={kind}
                openingBalance={openingBalance}
                closingBalance={closingBalance}
                entries={visibleEntries}
              />
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
    </section>
  )
}
