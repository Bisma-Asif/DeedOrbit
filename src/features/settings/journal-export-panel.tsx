/**
 * Journal export.
 *
 * Composes a flat, one-line-per-event statement over a date range and hands it
 * to an external accounting system as CSV, Excel, or a printed PDF. Nothing
 * here writes anything — it is a read of the ledger, the paid expenses, and the
 * vendor ledger, mapped through the tenant's chart-of-accounts. Where a source
 * has no mapped code the panel flags the row as `unmapped` and the export keeps
 * the empty cell, so the receiving accountant sees the gap rather than a
 * fabricated account.
 *
 * Reading needs `payments.view` — the same grant that opens the customer
 * ledger — because a journal is another reading of the same money flow.
 */

import { useMemo, useState } from "react"

import { Download, FileSpreadsheet, Printer, ScrollText } from "lucide-react"

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

import { DataTable, type DataTableColumn } from "@/components/data-table"

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

import { useSession } from "@/lib/session-context"

import { useAsyncResource } from "@/lib/use-async-resource"

import { formatCurrency, formatDate, orDash } from "@/lib/format"

import { journalApi } from "@/lib/journal-api"

import {
  exportRows,
  type ExportColumn,
  type ExportMetaLine,
} from "@/lib/export"

import type {
  JournalLine,
  JournalSourceType,
  JournalTotalsByAccount,
} from "@shared/journal"

const SOURCE_LABELS: Record<JournalSourceType, string> = {
  customer_ledger: "Customer",

  expense: "Expense",

  vendor_ledger: "Vendor",
}

const SOURCE_TONES: Record<JournalSourceType, "info" | "success" | "pending"> =
  {
    customer_ledger: "info",

    expense: "pending",

    vendor_ledger: "success",
  }

function firstOfThisMonth(): string {
  const now = new Date()

  const y = now.getUTCFullYear()

  const m = String(now.getUTCMonth() + 1).padStart(2, "0")

  return `${y}-${m}-01`
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

interface JournalDocumentProps {
  from: string

  to: string

  currency: string

  lines: JournalLine[]

  totals: JournalTotalsByAccount[]
}

/** The print-friendly statement. Kept inside a `data-document-print` dialog so the browser prints only this. */

function JournalStatementDocument({
  from,

  to,

  currency,

  lines,

  totals,
}: JournalDocumentProps) {
  const money = (value: number) =>
    formatCurrency(value, currency, { maximumFractionDigits: 0 })

  return (
    <article
      className="bg-card text-foreground"
      style={{ fontFamily: "var(--font-sans)" }}
    >
      <header className="flex items-start justify-between gap-6 border-b border-border-strong pb-4">
        <div className="min-w-0">
          <p className="text-[15px] leading-5 font-semibold tracking-tight">
            Journal Export
          </p>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Hand-off to the accounting system
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-[11px] tabular-nums text-muted-foreground">
            {from} — {to}
          </p>
          <p className="text-[11px] text-muted-foreground">
            Currency {currency}
          </p>
        </div>
      </header>

      <table className="mt-3 w-full border-collapse text-[12px]">
        <thead>
          <tr>
            {[
              "Date",

              "Account",

              "Reference",

              "Description",

              "Source",

              "Debit",

              "Credit",
            ].map((heading, index) => (
              <td
                key={heading}
                className={`border-b border-border-strong py-1.5 text-[9.5px] font-semibold tracking-[0.08em] text-muted-foreground uppercase ${
                  index >= 5 ? "text-right" : "pr-3"
                }`}
              >
                {heading}
              </td>
            ))}
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr
              key={`${line.sourceType}-${line.sourceId}`}
              className="avoid-break-inside"
            >
              <td className="border-b border-border py-1.5 pr-3 tabular-nums text-muted-foreground whitespace-nowrap">
                {formatDate(line.date)}
              </td>
              <td className="border-b border-border py-1.5 pr-3 font-mono text-[11px]">
                {line.account || (
                  <span className="text-muted-foreground italic">
                    — unmapped
                  </span>
                )}
              </td>
              <td className="border-b border-border py-1.5 pr-3 font-mono text-[11px]">
                {orDash(line.reference)}
              </td>
              <td className="border-b border-border py-1.5 pr-3 text-muted-foreground">
                {line.description}
              </td>
              <td className="border-b border-border py-1.5 pr-3">
                {SOURCE_LABELS[line.sourceType]}
              </td>
              <td className="border-b border-border py-1.5 pr-3 text-right tabular-nums">
                {line.debit > 0 ? money(line.debit) : ""}
              </td>
              <td className="border-b border-border py-1.5 text-right tabular-nums">
                {line.credit > 0 ? money(line.credit) : ""}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td
              colSpan={5}
              className="border-t-2 border-border-strong py-2 pr-3 text-[12.5px] font-semibold"
            >
              Totals by account
            </td>
            <td className="border-t-2 border-border-strong py-2 pr-3 text-right text-[13px] font-semibold tabular-nums">
              {money(totals.reduce((sum, row) => sum + row.debit, 0))}
            </td>
            <td className="border-t-2 border-border-strong py-2 text-right text-[13px] font-semibold tabular-nums">
              {money(totals.reduce((sum, row) => sum + row.credit, 0))}
            </td>
          </tr>
        </tfoot>
      </table>

      <footer className="border-t border-border-strong pt-3 pb-1 text-[10px] leading-4 text-muted-foreground">
        {lines.length} line{lines.length === 1 ? "" : "s"} exported. A single
        line per event; the receiving system supplies the contra side.
      </footer>
    </article>
  )
}

export function JournalExportPanel() {
  const session = useSession()

  const canRead = session.can("payments", "view")

  const [from, setFrom] = useState(firstOfThisMonth)

  const [to, setTo] = useState(today)

  const [printing, setPrinting] = useState(false)

  const [submitted, setSubmitted] = useState<{
    from: string
    to: string
  } | null>(() => ({ from: firstOfThisMonth(), to: today() }))

  const resource = useAsyncResource(
    (signal) =>
      submitted ? journalApi.read(submitted, signal) : Promise.resolve(null),

    canRead && submitted !== null,
  )

  const currency = resource.data?.currency ?? "AED"

  const money = useMemo(
    () => (value: number) =>
      formatCurrency(value, currency, { maximumFractionDigits: 0 }),

    [currency],
  )

  const lines = useMemo(() => resource.data?.lines ?? [], [resource.data])

  const totals = useMemo(
    () => resource.data?.totals ?? [],

    [resource.data],
  )

  const unmappedCount = useMemo(
    () => lines.filter((line) => line.unmapped).length,

    [lines],
  )

  const columns = useMemo<Array<DataTableColumn<JournalLine>>>(
    () => [
      {
        key: "date",

        header: "Date",

        width: "7rem",

        sortValue: (row) => row.date,

        cell: (row) => (
          <span className="whitespace-nowrap tabular-nums text-muted-foreground">
            {formatDate(row.date)}
          </span>
        ),
      },

      {
        key: "account",

        header: "Account",

        width: "8rem",

        sortValue: (row) => row.account,

        cell: (row) =>
          row.account ? (
            <span className="font-mono text-[11.5px] text-foreground">
              {row.account}
            </span>
          ) : (
            <Badge variant="outline">unmapped</Badge>
          ),
      },

      {
        key: "reference",

        header: "Reference",

        width: "9rem",

        cell: (row) => (
          <span className="font-mono text-[11px] text-foreground">
            {orDash(row.reference)}
          </span>
        ),
      },

      {
        key: "description",

        header: "Description",

        cell: (row) => (
          <span className="truncate text-muted-foreground">
            {row.description}
          </span>
        ),
      },

      {
        key: "source",

        header: "Source",

        width: "6.5rem",

        sortValue: (row) => row.sourceType,

        cell: (row) => (
          <Badge variant={SOURCE_TONES[row.sourceType]}>
            {SOURCE_LABELS[row.sourceType]}
          </Badge>
        ),
      },

      {
        key: "debit",

        header: "Debit",

        align: "right",

        width: "7.5rem",

        sortValue: (row) => row.debit,

        cell: (row) =>
          row.debit > 0 ? (
            <span className="tabular-nums">{money(row.debit)}</span>
          ) : (
            <span className="tabular-nums text-muted-foreground">—</span>
          ),
      },

      {
        key: "credit",

        header: "Credit",

        align: "right",

        width: "7.5rem",

        sortValue: (row) => row.credit,

        cell: (row) =>
          row.credit > 0 ? (
            <span className="tabular-nums">{money(row.credit)}</span>
          ) : (
            <span className="tabular-nums text-muted-foreground">—</span>
          ),
      },
    ],

    [money],
  )

  const exportColumns: ExportColumn<JournalLine>[] = useMemo(
    () => [
      { header: "Date", value: (row) => row.date },

      { header: "Account", value: (row) => row.account },

      { header: "Reference", value: (row) => row.reference },

      { header: "Description", value: (row) => row.description },

      { header: "Source", value: (row) => SOURCE_LABELS[row.sourceType] },

      { header: "Debit", value: (row) => row.debit },

      { header: "Credit", value: (row) => row.credit },

      { header: "Currency", value: (row) => row.currency },

      { header: "Unmapped", value: (row) => (row.unmapped ? "yes" : "") },
    ],

    [],
  )

  function exportMeta(): ExportMetaLine[] {
    return [
      { label: "Period", value: `${from} → ${to}` },

      { label: "Currency", value: currency },

      { label: "Lines", value: String(lines.length) },

      {
        label: "Unmapped",

        value: String(unmappedCount),
      },
    ]
  }

  function runExport(format: "csv" | "excel") {
    exportRows(format, {
      filenameStem: `journal-${from}-to-${to}`,

      title: "Journal",

      columns: exportColumns,

      rows: lines,

      meta: exportMeta(),
    })
  }

  function applyRange() {
    if (!from || !to) return

    setSubmitted({ from, to })
  }

  if (!canRead) {
    return (
      <EmptyState
        icon={ScrollText}
        title="Journal export is not available to your role"
        description="Your role cannot read the payments stream this export is built from."
        tone="pending"
      />
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Journal export</CardTitle>
        <CardDescription>
          One flat line per money event over a date range, mapped through the
          chart of accounts. Ready to hand to an external accounting system as
          CSV, Excel, or PDF.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 py-2">
        <div className="flex flex-wrap items-end gap-2">
          <Field label="From" htmlFor="journal-from" className="w-[10rem]">
            <Input
              id="journal-from"
              type="date"
              value={from}
              max={to || undefined}
              onChange={(event) => setFrom(event.target.value)}
            />
          </Field>
          <Field label="To" htmlFor="journal-to" className="w-[10rem]">
            <Input
              id="journal-to"
              type="date"
              value={to}
              min={from || undefined}
              onChange={(event) => setTo(event.target.value)}
            />
          </Field>
          <Button variant="secondary" size="sm" onClick={applyRange}>
            Refresh
          </Button>
          <span className="mx-2 h-6 w-px bg-border" aria-hidden />
          <Button
            variant="outline"
            size="sm"
            onClick={() => runExport("csv")}
            disabled={lines.length === 0}
          >
            <Download size={13} />
            CSV
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => runExport("excel")}
            disabled={lines.length === 0}
          >
            <FileSpreadsheet size={13} />
            Excel
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPrinting(true)}
            disabled={lines.length === 0}
          >
            <Printer size={13} />
            PDF
          </Button>
        </div>

        {resource.error ? (
          <Alert variant="danger">
            <AlertDescription>{resource.error}</AlertDescription>
          </Alert>
        ) : null}

        {unmappedCount > 0 ? (
          <Alert variant="pending">
            <AlertDescription>
              {unmappedCount} line{unmappedCount === 1 ? "" : "s"} carry no
              account code. Add the mapping in the Chart of accounts tab before
              handing this off, or the receiving accountant will have to.
            </AlertDescription>
          </Alert>
        ) : null}

        {resource.loading && !resource.data ? (
          <Skeleton className="h-40 w-full" />
        ) : lines.length === 0 ? (
          <EmptyState
            icon={ScrollText}
            size="sm"
            title="Nothing to export"
            description="No money events fall in the chosen range."
          />
        ) : (
          <div className="flex flex-col gap-2">
            <div className="rounded-md border border-border">
              <DataTable<JournalLine>
                columns={columns}
                rows={lines}
                rowKey={(row) => `${row.sourceType}-${row.sourceId}`}
                initialSort={{ key: "date", direction: "asc" }}
                maxHeight="24rem"
                showFilterBar={false}
                caption="Journal"
              />
            </div>

            <div className="rounded-md border border-border">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="px-3 py-1.5 text-left font-semibold text-muted-foreground uppercase text-[9.5px] tracking-[0.08em]">
                      Account
                    </th>
                    <th className="px-3 py-1.5 text-right font-semibold text-muted-foreground uppercase text-[9.5px] tracking-[0.08em]">
                      Debit
                    </th>
                    <th className="px-3 py-1.5 text-right font-semibold text-muted-foreground uppercase text-[9.5px] tracking-[0.08em]">
                      Credit
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {totals.map((row) => (
                    <tr
                      key={row.account || "unmapped"}
                      className="border-b border-border last:border-0"
                    >
                      <td className="px-3 py-1.5">
                        {row.account ? (
                          <span className="font-mono text-[11.5px]">
                            {row.account}
                          </span>
                        ) : (
                          <Badge variant="outline">unmapped</Badge>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {row.debit > 0 ? money(row.debit) : "—"}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {row.credit > 0 ? money(row.credit) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </CardContent>

      <Dialog open={printing} onOpenChange={setPrinting}>
        <DialogContent
          data-document-print=""
          className="flex w-[calc(100%-2rem)] max-w-[46rem] flex-col"
        >
          <DialogHeader className="print-hidden">
            <DialogTitle>
              Journal — {from} to {to}
            </DialogTitle>
            <DialogDescription>
              Review the export, then print or save it as a PDF.
            </DialogDescription>
          </DialogHeader>

          <div className="scrollbar-slim min-h-0 flex-1 overflow-y-auto border border-border bg-muted/20 p-3 sm:p-5">
            <div className="mx-auto max-w-[38rem] border border-border bg-card p-6 shadow-card sm:p-8">
              <JournalStatementDocument
                from={from}
                to={to}
                currency={currency}
                lines={lines}
                totals={totals}
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
    </Card>
  )
}
