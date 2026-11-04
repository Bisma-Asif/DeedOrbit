/**
 * Dependency-free export helpers for tables the finance desk hands off.
 *
 * The platform ships no spreadsheet encoder and will not add a dependency for
 * one, so "export to Excel" is the standard browser trick: a `text/html` table
 * document served with an `.xls` name that Excel and LibreOffice open directly,
 * and "export to CSV" is a UTF-8 byte-order-marked comma file that spreadsheets
 * and accounting imports both read cleanly. Numbers are written as raw values,
 * never as formatted currency strings, so the receiving system can total them.
 *
 * Everything here is presentation-agnostic: a caller describes its columns as a
 * header plus a value getter, and these helpers turn that into bytes and a
 * download. No column here knows about money or dates — that mapping stays in
 * the feature so the shape of an export never drifts from the shape of a row.
 */

/** One exportable column: the header text and how to read the cell's raw value. */

export interface ExportColumn<T> {
  header: string

  /** A number stays numeric in the sheet; a string is quoted as needed. */

  value: (row: T) => string | number
}

/** A free-text line placed above the table (title, account, period, filters). */

export interface ExportMetaLine {
  label: string

  value: string
}

/** Wrap a CSV field in quotes and escape any quote inside it. */

function csvCell(value: string | number): string {
  const text = typeof value === "number" ? String(value) : value

  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`

  return text
}

/** Escape a value for the HTML table export so a name with `<` cannot break it. */

function htmlCell(value: string | number): string {
  return String(value)

    .replace(/&/g, "&amp;")

    .replace(/</g, "&lt;")

    .replace(/>/g, "&gt;")
}

/** Left-to-right number formatting is not wanted here: exports stay as-is. */

function metaLinesToCsv(meta: ExportMetaLine[]): string[] {
  return meta.map((line) => `${csvCell(line.label)},${csvCell(line.value)}`)
}

/**
 * Build a comma-separated document with a UTF-8 byte-order mark.
 *
 * Optional meta lines run above a blank separator so a statement carries its
 * account and period, then the header row, then one row per record.
 */

export function buildCsv<T>(
  columns: ExportColumn<T>[],

  rows: T[],

  meta: ExportMetaLine[] = [],
): string {
  const lines: string[] = []

  if (meta.length > 0) {
    lines.push(...metaLinesToCsv(meta))

    lines.push("")
  }

  lines.push(columns.map((column) => csvCell(column.header)).join(","))

  for (const row of rows) {
    lines.push(columns.map((column) => csvCell(column.value(row))).join(","))
  }

  return `${lines.join("\r\n")}`
}

/**
 * Build an Excel-readable HTML table document.
 *
 * The `<html>` wrapper with an Excel workbook namespace and a charset meta is
 * what lets a `.xls` download open as a spreadsheet rather than a text file.
 * Numbers keep their type through `mso-number-format`, so a total row adds up.
 */

export function buildExcelHtml<T>(
  columns: ExportColumn<T>[],

  rows: T[],

  title: string,

  meta: ExportMetaLine[] = [],
): string {
  const metaRows = meta

    .map(
      (line) =>
        `<tr><td><b>${htmlCell(line.label)}</b></td><td>${htmlCell(
          line.value,
        )}</td></tr>`,
    )

    .join("")

  const headerCells = columns

    .map(
      (column) =>
        `<th style="background:#0f172a;color:#fff;border:1px solid #cbd5e1;padding:4px 8px;white-space:nowrap">${htmlCell(
          column.header,
        )}</th>`,
    )

    .join("")

  const bodyRows = rows

    .map((row) => {
      const cells = columns

        .map((column) => {
          const value = column.value(row)

          const numeric = typeof value === "number"

          return `<td style="border:1px solid #e2e8f0;padding:4px 8px;${
            numeric ? "mso-number-format:'\\#\\,\\#0';text-align:right" : ""
          }">${htmlCell(value)}</td>`
        })

        .join("")

      return `<tr>${cells}</tr>`
    })

    .join("")

  return [
    `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">`,

    `<head><meta charset="utf-8" />`,

    `<!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet>`,

    `<x:Name>${htmlCell(title).slice(0, 28) || "Sheet1"}</x:Name>`,

    `<x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>`,

    `</x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->`,

    `</head><body>`,

    meta.length > 0
      ? `<table style="margin-bottom:12px">${metaRows}</table>`
      : "",

    `<table><thead><tr>${headerCells}</tr></thead><tbody>${bodyRows}</tbody></table>`,

    `</body></html>`,
  ].join("")
}

/** Drive a browser download of a text payload and release its object URL. */

export function downloadTextFile(
  filename: string,

  mime: string,

  content: string,
): void {
  // A UTF-8 byte-order mark makes Excel read a BOM'd .csv as UTF-8, not ANSI.

  const body = mime.startsWith("text/csv") ? `${content}` : content

  const blob = new Blob([body], { type: `${mime};charset=utf-8` })

  const url = URL.createObjectURL(blob)

  const anchor = document.createElement("a")

  anchor.href = url

  anchor.download = filename

  document.body.appendChild(anchor)

  anchor.click()

  document.body.removeChild(anchor)

  URL.revokeObjectURL(url)
}

/** Sanitize a label for use as a filename stem (no path or control characters). */

export function safeFilename(stem: string): string {
  return (
    stem

      .toLowerCase()

      .replace(/[^a-z0-9]+/g, "-")

      .replace(/^-+|-+$/g, "")

      .slice(0, 60) || "export"
  )
}

/** Everything a feature supplies to turn its rows into a downloaded file. */

export interface ExportRequest<T> {
  filenameStem: string

  title: string

  columns: ExportColumn<T>[]

  rows: T[]

  meta?: ExportMetaLine[]
}

/**
 * The two exports a finance table offers, from one column definition.
 *
 * A feature supplies the columns, the rows, a filename stem, a document title,
 * and any meta lines to print above the table; this decides the encoding and the
 * MIME and drops the file. Kept together so a CSV and an Excel of the same
 * ledger can never diverge in shape.
 */

export function exportRows<T>(
  format: "csv" | "excel",

  options: ExportRequest<T>,
): void {
  const { filenameStem, title, columns, rows, meta = [] } = options

  const stem = safeFilename(
    `${filenameStem}-${new Date().toISOString().slice(0, 10)}`,
  )

  if (format === "csv") {
    downloadTextFile(
      `${stem}.csv`,

      "text/csv",

      buildCsv(columns, rows, meta),
    )

    return
  }

  downloadTextFile(
    `${stem}.xls`,

    "application/vnd.ms-excel",

    buildExcelHtml(columns, rows, title, meta),
  )
}
