import { useRef, useState } from "react"

import { AlertTriangle, Download, Upload } from "lucide-react"

import { Alert, AlertDescription } from "@/components/ui/alert"

import { Badge } from "@/components/ui/badge"

import { Button } from "@/components/ui/button"

import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

import { downloadTextFile } from "@/lib/export"

import {
  leadImportTemplateCsv,
  parseLeadImportFile,
  type ParsedLeadImport,
} from "@/lib/lead-import"

import { leadsApi } from "@/lib/leads-api"

import { navigate } from "@/lib/router"

import {
  LEAD_IMPORT_COLUMNS,
  LEAD_IMPORT_MAX_ROWS,
  type LeadImportFailure,
  type LeadImportResponse,
} from "@shared/leads"

interface CampaignLeadImportDialogProps {
  open: boolean

  campaignId: string

  campaignName: string

  onClose: () => void

  onImported: () => Promise<void> | void
}

const MAX_FILE_BYTES = 256 * 1024

const EMPTY_PARSED: ParsedLeadImport = {
  rows: [],

  headerFound: false,

  unknownColumns: [],

  localIssues: [],
}

export function CampaignLeadImportDialog({
  open,

  campaignId,

  campaignName,

  onClose,

  onImported,
}: CampaignLeadImportDialogProps) {
  const fileInput = useRef<HTMLInputElement | null>(null)

  const [fileName, setFileName] = useState("")

  const [parsed, setParsed] = useState(EMPTY_PARSED)

  const [reading, setReading] = useState(false)

  const [importing, setImporting] = useState(false)

  const [result, setResult] = useState<LeadImportResponse | null>(null)

  const [error, setError] = useState<string | null>(null)

  function reset() {
    setFileName("")

    setParsed(EMPTY_PARSED)

    setResult(null)

    setError(null)

    if (fileInput.current !== null) fileInput.current.value = ""
  }

  function close() {
    reset()

    onClose()
  }

  async function chooseFile(file: File | undefined) {
    if (file === undefined) return

    setFileName(file.name)

    setResult(null)

    setError(null)

    if (!/\.(csv|tsv|txt)$/i.test(file.name)) {
      setParsed(EMPTY_PARSED)

      setError("Choose a CSV or tab-separated text file.")

      return
    }

    if (file.size > MAX_FILE_BYTES) {
      setParsed(EMPTY_PARSED)

      setError(`Keep the file under ${MAX_FILE_BYTES / 1024} KB.`)

      return
    }

    setReading(true)

    try {
      setParsed(parseLeadImportFile(await file.text()))
    } catch {
      setParsed(EMPTY_PARSED)

      setError(
        "That file could not be read. Save it as CSV or TSV and try again.",
      )
    } finally {
      setReading(false)
    }
  }

  async function runImport() {
    setImporting(true)

    setError(null)

    try {
      const imported = await leadsApi.importCampaign(
        campaignId,

        parsed.rows,
      )

      setResult({
        ...imported,

        failed: imported.failed + parsed.localIssues.length,

        failures: [...imported.failures, ...parsed.localIssues],
      })

      if (imported.created > 0) await onImported()
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

  const localIssues = parsed.localIssues

  const blocked = localIssues.length > 0 && parsed.rows.length === 0

  const failures = result?.failures ?? []

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close()
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import leads to {campaignName}</DialogTitle>
          <DialogDescription>
            Choose a CSV or tab-separated file. Full Name and Phone are
            required; campaign and source are filled from this campaign. Leads
            start in the New stage. Import each file only once to avoid
            duplicates.
          </DialogDescription>
        </DialogHeader>

        {result === null ? (
          <DialogBody className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  downloadTextFile(
                    "campaign-leads-template.csv",

                    "text/csv",

                    leadImportTemplateCsv(),
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
                Choose file
              </Button>
              <input
                ref={fileInput}
                type="file"
                accept=".csv,.tsv,.txt"
                className="sr-only"
                aria-label="Campaign leads file"
                onChange={(event) => void chooseFile(event.target.files?.[0])}
              />
              {fileName !== "" ? (
                <Badge variant="outline" className="max-w-64 truncate">
                  {fileName}
                </Badge>
              ) : null}
            </div>

            <div className="rounded-md border border-border bg-muted/20 p-2.5">
              <p className="mb-2 text-[11.5px] text-muted-foreground">
                Required columns are marked with *. At most{" "}
                {LEAD_IMPORT_MAX_ROWS} rows are imported at once. Unrecognized
                columns are ignored.
              </p>
              <ul className="grid gap-1 sm:grid-cols-2">
                {LEAD_IMPORT_COLUMNS.map((column) => (
                  <li
                    key={column.key}
                    className="text-[11.5px] text-muted-foreground"
                  >
                    <span className="font-medium text-foreground">
                      {column.column}
                      {column.required ? " *" : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            {reading ? (
              <p className="text-[12px] text-muted-foreground">
                Reading the file…
              </p>
            ) : null}
            {error ? (
              <Alert variant="danger">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            {fileName !== "" && !reading && !parsed.headerFound ? (
              <Alert variant="pending">
                <AlertDescription>
                  The header row must contain Full Name and Phone columns.
                  Download the template to see the accepted column names.
                </AlertDescription>
              </Alert>
            ) : null}
            {parsed.headerFound ? (
              <div className="flex flex-col gap-2">
                <p className="text-[12.5px] font-medium text-foreground">
                  {parsed.rows.length}{" "}
                  {parsed.rows.length === 1 ? "row" : "rows"} ready to import
                </p>
                {parsed.unknownColumns.length > 0 ? (
                  <p className="text-[11.5px] text-muted-foreground">
                    Ignored columns: {parsed.unknownColumns.join(", ")}.
                  </p>
                ) : null}
                {localIssues.length > 0 ? (
                  <LeadImportIssues issues={localIssues} />
                ) : null}
              </div>
            ) : null}
          </DialogBody>
        ) : (
          <DialogBody className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={result.created > 0 ? "success" : "neutral"}>
                {result.created} {result.created === 1 ? "lead" : "leads"}{" "}
                imported
              </Badge>
              {result.failed > 0 ? (
                <Badge variant="danger">
                  {result.failed} rows need correction
                </Badge>
              ) : null}
            </div>
            <p className="text-[12px] leading-5 text-muted-foreground">
              {result.failed === 0
                ? "Imported leads are available on the Leads screen."
                : "Valid rows are imported and attributed to this campaign. Correct the refused rows below and import them again."}
            </p>
            {failures.length > 0 ? (
              <LeadImportIssues issues={failures} />
            ) : null}
          </DialogBody>
        )}

        <DialogFooter>
          {result === null ? (
            <>
              <Button variant="outline" onClick={close} disabled={importing}>
                Cancel
              </Button>
              <Button
                onClick={() => void runImport()}
                disabled={
                  importing ||
                  reading ||
                  parsed.rows.length === 0 ||
                  blocked ||
                  !parsed.headerFound
                }
              >
                {importing
                  ? "Importing…"
                  : `Import ${parsed.rows.length} leads`}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={close}>
                Close
              </Button>
              <Button
                onClick={() => {
                  close()

                  navigate("/leads")
                }}
              >
                View leads
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function LeadImportIssues({
  issues,
}: {
  issues: readonly LeadImportFailure[]
}) {
  return (
    <div className="max-h-48 overflow-y-auto rounded-md border border-border">
      <div className="flex items-center gap-1.5 border-b border-border px-3 py-2">
        <AlertTriangle size={13} className="text-amber-600" />
        <span className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          Rows to check
        </span>
      </div>
      <ul className="divide-y divide-border">
        {issues.map((issue) => (
          <li key={issue.row} className="flex gap-3 px-3 py-2">
            <span className="w-14 shrink-0 font-mono text-[11.5px] text-muted-foreground">
              Row {issue.row}
            </span>
            <span className="text-[11.5px] text-danger">
              {Object.values(issue.errors).join(" ")}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
