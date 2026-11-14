/**
 * Reading a unit sheet, client-side, for the bulk importer.
 *
 * The browser has the file and the server has the judgement, so the split is: this module
 * turns a `.csv` / `.tsv` into rows the importer's endpoint already understands, and the
 * server decides which rows are good. Nothing here validates a property type or a price
 * against the tenant's vocabulary — that is exactly the part the server does better, and
 * duplicating it here would be a second set of rules to fall out of step.
 *
 * Two decisions worth stating:
 *
 *  * Column names are matched loosely (`Floor Number`, `floor_number` and `floornumber`
 *    are one column) because the file comes out of somebody's tracker, not out of an API.
 *    An importer that only accepted the exact template header would be a template nobody
 *    uses twice.
 *
 *  * Only thousands separators are stripped from the numeric columns; a value that is not
 *    a number is sent as typed and refused by the server, in the row report, where the
 *    user can see which row and which column.
 */

import {
  UNIT_IMPORT_FIELDS,
  UNIT_IMPORT_MAX_ROWS,
  unitImportTemplateHeader,
  unitImportTemplateRows,
} from "@shared/inventory-categories"

import type {
  UnitImportFailure,
  UnitImportRowInput,
} from "./project-inventory-api"
import { parseDelimitedText } from "./delimited-text.ts"

/** What a parsed file carries to the dialog. */

export interface ParsedUnitImport {
  /** The rows worth sending. Empty alongside `headerFound: false` means a bad file. */

  rows: UnitImportRowInput[]

  /** False when no row in the file carried a column the importer reads. */

  headerFound: boolean

  /** Headers the importer does not read, so the dialog can say they were ignored. */

  unknownColumns: string[]

  /** Rows this module refused before the request — a blank code, or a file over the cap. */

  localIssues: UnitImportFailure[]
}

/** One recognised header cell and the payload field it fills. */

interface SheetColumnMapping {
  index: number

  key: string
}

/** Normalise a header cell so `Block / Floor` and `block-floor` are the same column. */

function normalizeColumn(value: string): string {
  return value

    .trim()

    .toLowerCase()

    .replace(/[^a-z0-9]+/g, "")
}

/** The template's column word → the JSON field the server reads. Built once. */

const FIELD_BY_COLUMN: Map<string, string> = new Map(
  UNIT_IMPORT_FIELDS.map((field) => [normalizeColumn(field.column), field.key]),
)

/** The fields whose cells are treated as numbers rather than text. */

const NUMERIC_KEYS = new Set(
  UNIT_IMPORT_FIELDS.filter(
    (field) => field.kind === "integer" || field.kind === "decimal",
  ).map((field) => field.key),
)

const MAX_COLUMNS = UNIT_IMPORT_FIELDS.length + 8

/** `1,850,000` is the same number as `1850000`, and a tracker writes it that way. */

function readNumericCell(value: string): string {
  const stripped = value.replace(/[,\s]/g, "")

  return stripped === "" ? "" : stripped
}

function isBlank(cells: readonly string[]): boolean {
  return cells.every((cell) => cell.trim() === "")
}

/**
 * Parse a unit sheet.
 *
 * Rows are numbered the way the sheet numbers them — header line included — because that
 * is the number a person can find again. `row` on each entry is therefore the file's own
 * line number, which is exactly what the server echoes back in its failure report.
 */

export function parseUnitImportFile(text: string): ParsedUnitImport {
  const grid = parseDelimitedText(text).filter((cells) => !isBlank(cells))

  const empty: ParsedUnitImport = {
    rows: [],

    headerFound: false,

    unknownColumns: [],

    localIssues: [],
  }

  if (grid.length === 0) return empty

  const header = grid[0].map((cell) => cell.trim())

  // Which columns the importer recognises, and where each one goes in the payload.

  const mapping: SheetColumnMapping[] = []

  const unknownColumns: string[] = []

  header.forEach((cell, index) => {
    if (cell === "") return

    const key = FIELD_BY_COLUMN.get(normalizeColumn(cell))

    if (key === undefined) {
      unknownColumns.push(cell)

      return
    }

    if (!mapping.some((entry) => entry.key === key)) {
      mapping.push({ index, key })
    }
  })

  if (mapping.length === 0) return empty

  const rows: UnitImportRowInput[] = []

  const localIssues: UnitImportFailure[] = []

  for (let index = 1; index < grid.length; index++) {
    const cells = grid[index]

    const rowNumber = index + 1

    if (cells.length > MAX_COLUMNS) {
      localIssues.push({
        row: rowNumber,

        unitCode: null,

        errors: {
          row: `This row has ${cells.length} columns; the template has ${UNIT_IMPORT_FIELDS.length}. Check for a stray delimiter.`,
        },
      })

      continue
    }

    const values: Record<string, unknown> = {}

    for (const entry of mapping) {
      const raw = (cells[entry.index] ?? "").trim()

      if (raw === "") continue

      values[entry.key] = NUMERIC_KEYS.has(entry.key)
        ? readNumericCell(raw)
        : raw
    }

    const unitCode = typeof values.unitCode === "string" ? values.unitCode : ""

    if (unitCode === "") {
      localIssues.push({
        row: rowNumber,

        unitCode: null,

        errors: { unitCode: "Every row needs a Unit Code." },
      })

      continue
    }

    rows.push({ row: rowNumber, values })
  }

  if (rows.length > UNIT_IMPORT_MAX_ROWS) {
    const overflow = rows.splice(UNIT_IMPORT_MAX_ROWS)

    localIssues.push({
      row: overflow[0]?.row ?? 0,

      unitCode: null,

      errors: {
        row: `Only the first ${UNIT_IMPORT_MAX_ROWS} rows are sent. Import the rest in a second file.`,
      },
    })
  }

  return {
    rows,

    headerFound: true,

    unknownColumns,

    localIssues,
  }
}

/**
 * The downloadable template: the header the importer reads, then one worked example.
 *
 * The example row is real data in the shape the importer wants — a corner shop sized in
 * marla, with amenities and a photo link — because a template of empty columns gets
 * filled in by guesswork, and the size unit column is where everyone guesses. The per-
 * column hints are not written into the file (a CSV has no comments, and a hint row would
 * be read as a bad data row); the dialog shows them beside the column list instead.
 */

export function unitImportTemplateCsv(): string {
  return [unitImportTemplateHeader(), ...unitImportTemplateRows()].join("\r\n")
}

/** The columns a unit sheet must carry, for the dialog's instructions. */

export const UNIT_IMPORT_REQUIRED_COLUMNS: string[] = UNIT_IMPORT_FIELDS.filter(
  (field) => field.required,
).map((field) => field.column)

/** One row of the dialog's column reference: what to call it, and what goes in it. */

export interface UnitImportColumnInfo {
  column: string

  key: string

  required: boolean

  hint: string
}

/**
 * Every column the importer reads, in template order, with whether it is required.
 *
 * Derived from `UNIT_IMPORT_FIELDS` rather than written out again here, so the dialog
 * cannot document a column the server does not read — which is how a template ends up
 * teaching people to write a file that silently drops a column.
 */

export const UNIT_IMPORT_COLUMNS: UnitImportColumnInfo[] =
  UNIT_IMPORT_FIELDS.map((field) => ({
    column: field.column,

    key: field.key,

    required: field.required,

    hint: field.hint,
  }))
