/**
 * Bulk import for units — a spreadsheet in, validated rows out.
 *
 * The browser reads the file and the server decides what is true, so this dialog never
 * guesses whether "Corner Shop" is a variant this workspace offers or whether a marla
 * is 225 or 242 square feet. It sends the rows and shows the answer.
 *
 * Two behaviours are deliberate:
 *
 *  * Valid rows land even when others fail. A sheet with three typos in two hundred
 *    rows is normal, and refusing the whole file would mean re-typing the good ones —
 *    which is how people start keeping units in a spreadsheet instead.
 *
 *  * Row numbers are the file's own, header line included, because that is the number
 *    a person can find again. A report that counted from the first data row would send
 *    somebody to the wrong line every single time.
 */

import { useRef, useState } from "react"

import { AlertTriangle, Download, Upload, X } from "lucide-react"

import { Alert, AlertDescription } from "@/components/ui/alert"

import { Badge } from "@/components/ui/badge"

import { Button } from "@/components/ui/button"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

import {
  projectInventoryApi,
  type UnitImportFailure,
  type UnitImportResponse,
} from "@/lib/project-inventory-api"

import {
  UNIT_IMPORT_COLUMNS,
  UNIT_IMPORT_REQUIRED_COLUMNS,
  parseUnitImportFile,
  unitImportTemplateCsv,
  type ParsedUnitImport,
} from "@/lib/unit-import"

import { downloadTextFile } from "@/lib/export"

import { UNIT_IMPORT_MAX_ROWS } from "@shared/inventory-categories"

interface UnitImportDialogProps {
  open: boolean

  projectId: string

  projectName: string

  onClose: () => void

  /** Called after any row landed, so the table and the counts reload. */

  onImported: () => Promise<void> | void
}

/** Nothing parsed yet — the dialog shows instructions rather than results. */

const EMPTY_PARSED: ParsedUnitImport = {
  rows: [],

  headerFound: false,

  unknownColumns: [],

  localIssues: [],
}

export function UnitImportDialog({
  open,

  projectId,

  projectName,

  onClose,

  onImported,
}: UnitImportDialogProps) {
  const fileInput = useRef<HTMLInputElement | null>(null)

  const [fileName, setFileName] = useState("")

  const [parsed, setParsed] = useState<ParsedUnitImport>(EMPTY_PARSED)

  const [reading, setReading] = useState(false)

  const [importing, setImporting] = useState(false)

  const [result, setResult] = useState<UnitImportResponse | null>(null)

  const [error, setError] = useState<string | null>(null)

  const [showColumns, setShowColumns] = useState(false)

  function reset() {
    setFileName("")

    setParsed(EMPTY_PARSED)

    setResult(null)

    setError(null)

    setShowColumns(false)

    if (fileInput.current !== null) fileInput.current.value = ""
  }

  async function chooseFile(file: File | undefined) {
    if (file === undefined) return

    setReading(true)

    setResult(null)

    setError(null)

    setFileName(file.name)

    try {
      setParsed(parseUnitImportFile(await file.text()))
    } catch {
      setParsed(EMPTY_PARSED)

      setError("That file could not be read as text. Save it as CSV or TSV.")
    } finally {
      setReading(false)
    }
  }

  async function runImport() {
    setImporting(true)

    setError(null)

    try {
      const response = await projectInventoryApi.importUnits(
        projectId,
        parsed.rows,
      )

      setResult(response)

      if (response.created > 0) await onImported()
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The import could not be sent.",
      )
    } finally {
      setImporting(false)
    }
  }

  /** Rows this module refused plus rows the server refused, newest step first. */

  const localIssues = parsed.localIssues

  const failures: UnitImportFailure[] = result?.failures ?? []

  const blocked = localIssues.length > 0 && parsed.rows.length === 0

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          reset()

          onClose()
        }
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import units</DialogTitle>

          <DialogDescription>
            Add units to {projectName} from a CSV or a tab-separated export.
            Sizes, property types and amenities must be words this workspace
            already offers. Every row is checked on its own: rows that pass are
            added even when others in the same file are refused, and each
            refusal names the row number and the column. Nothing is written
            until you press Import.
          </DialogDescription>
        </DialogHeader>

        {result === null ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  downloadTextFile(
                    "unit-import-template.csv",

                    "text/csv",

                    unitImportTemplateCsv(),
                  )
                }
              >
                <Download size={13} />
                Download template
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={() => fileInput.current?.click()}
              >
                <Upload size={13} />
                Choose a file
              </Button>

              <input
                ref={fileInput}
                type="file"
                accept=".csv,.tsv,.txt"
                className="sr-only"
                aria-label="Unit sheet to import"
                onChange={(event) => void chooseFile(event.target.files?.[0])}
              />

              {fileName !== "" ? (
                <Badge variant="outline" className="max-w-64 truncate">
                  {fileName}
                </Badge>
              ) : null}
            </div>

            <button
              type="button"
              onClick={() => setShowColumns((current) => !current)}
              className="mt-2 self-start text-[11.5px] font-medium text-emerald-700 underline underline-offset-2"
            >
              {showColumns
                ? "Hide the column reference"
                : "Which columns does the importer read?"}
            </button>

            {showColumns ? (
              <div className="mt-2 max-h-56 overflow-y-auto rounded-md border border-border bg-muted/20 p-2.5">
                <p className="mb-2 text-[11.5px] text-muted-foreground">
                  Column names are matched loosely, so{" "}
                  <span className="font-mono">Floor Number</span> and{" "}
                  <span className="font-mono">floor_number</span> are the same
                  column. Required: {UNIT_IMPORT_REQUIRED_COLUMNS.join(", ")}.
                </p>

                <ul className="flex flex-col gap-1">
                  {UNIT_IMPORT_COLUMNS.map((column) => (
                    <li
                      key={column.key}
                      className="flex gap-2 text-[11.5px] leading-4"
                    >
                      <span
                        className={`w-36 shrink-0 font-medium ${
                          column.required
                            ? "text-foreground"
                            : "text-muted-foreground"
                        }`}
                      >
                        {column.column}
                        {column.required ? " *" : ""}
                      </span>

                      <span className="text-muted-foreground">
                        {column.hint}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {reading ? (
              <p className="mt-3 text-[12px] text-muted-foreground">
                Reading the sheet…
              </p>
            ) : null}

            {error !== null && (
              <div className="mt-3">
                <Alert variant="danger">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              </div>
            )}

            {fileName !== "" && !reading && !parsed.headerFound ? (
              <div className="mt-3">
                <Alert variant="pending">
                  <AlertDescription>
                    No column in this file is one the importer reads. Check the
                    header row against the template.
                  </AlertDescription>
                </Alert>
              </div>
            ) : null}

            {parsed.headerFound ? (
              <div className="mt-3 flex flex-col gap-2.5">
                <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
                  <span className="font-medium text-foreground">
                    {parsed.rows.length}{" "}
                    {parsed.rows.length === 1 ? "row" : "rows"} ready to import
                  </span>

                  {localIssues.length > 0 ? (
                    <Badge variant="pending">
                      {localIssues.length}{" "}
                      {localIssues.length === 1 ? "row" : "rows"} held back
                    </Badge>
                  ) : null}
                </div>

                {parsed.unknownColumns.length > 0 ? (
                  <p className="text-[11.5px] text-muted-foreground">
                    Ignored columns not in the template:{" "}
                    {parsed.unknownColumns.join(", ")}.
                  </p>
                ) : null}

                {localIssues.length > 0 ? (
                  <RowIssueTable issues={localIssues} />
                ) : null}

                {parsed.rows.length > UNIT_IMPORT_MAX_ROWS ? (
                  <p className="text-[11.5px] text-warning">
                    Only the first {UNIT_IMPORT_MAX_ROWS} rows are sent.
                  </p>
                ) : null}
              </div>
            ) : null}
          </>
        ) : (
          <UnitImportResult result={result} failures={failures} />
        )}

        <DialogFooter>
          {result === null ? (
            <Button variant="outline" onClick={onClose} disabled={importing}>
              Cancel
            </Button>
          ) : (
            <Button variant="outline" onClick={onClose} disabled={importing}>
              Close
            </Button>
          )}

          {result === null ? (
            <Button
              onClick={() => void runImport()}
              disabled={
                importing || reading || parsed.rows.length === 0 || blocked
              }
            >
              {importing
                ? "Importing…"
                : `Import ${
                    parsed.rows.length === 0 ? "" : parsed.rows.length
                  } ${parsed.rows.length === 1 ? "unit" : "units"}`.trim()}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** The rows the server refused, after an import attempt. */

function UnitImportResult({
  result,

  failures,
}: {
  result: UnitImportResponse

  failures: UnitImportFailure[]
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={result.created > 0 ? "success" : "neutral"}>
          {result.created} {result.created === 1 ? "unit" : "units"} created
        </Badge>

        {result.failed > 0 ? (
          <Badge variant="danger">{result.failed} rows refused</Badge>
        ) : null}
      </div>

      <p className="text-[12px] leading-5 text-muted-foreground">
        {result.failed === 0
          ? "Every row passed. The units are in the table now."
          : "The rows that passed are in the table; the ones below were not, and nothing else in the file was touched. Correct the sheet and re-import only the rows that failed — re-sending a row that already landed comes back as a duplicate unit code."}
      </p>

      {failures.length > 0 ? <RowIssueTable issues={failures} /> : null}
    </div>
  )
}

/**
 * One table for both kinds of refusal.
 *
 * Rows this module held back and rows the server refused are the same shape — a file
 * line and a reason per field — so they share a renderer instead of teaching the user
 * two layouts of the same bad news.
 */

function RowIssueTable({ issues }: { issues: readonly UnitImportFailure[] }) {
  return (
    <div className="rounded-md border border-border bg-card-subtle/40">
      <div className="flex items-center gap-1.5 border-b border-border px-3 py-2">
        <AlertTriangle size={13} className="text-amber-600" />

        <span className="text-[11.5px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
          Rows held back
        </span>
      </div>

      <ul className="flex flex-col divide-y divide-border">
        {issues.map((issue) => (
          <li
            key={`${issue.row}-${issue.unitCode ?? "blank"}`}
            className="flex gap-3 px-3 py-2"
          >
            <span className="w-14 shrink-0 font-mono text-[11.5px] text-muted-foreground">
              Row {issue.row}
            </span>

            <div className="min-w-0 flex-1">
              {issue.unitCode !== null ? (
                <p className="text-[12px] font-medium text-foreground">
                  {issue.unitCode}
                </p>
              ) : null}

              <ul className="mt-0.5 flex flex-col gap-0.5">
                {Object.entries(issue.errors).map(([field, message]) => (
                  <li
                    key={field}
                    className="flex items-start gap-1.5 text-[11.5px] leading-4 text-muted-foreground"
                  >
                    <X size={11} className="mt-0.5 shrink-0 text-danger" />

                    <span>
                      <span className="font-medium text-foreground">
                        {field}:
                      </span>{" "}
                      {message}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
