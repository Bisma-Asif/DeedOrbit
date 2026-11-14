import {
  LEAD_IMPORT_COLUMNS,
  LEAD_IMPORT_MAX_ROWS,
  type LeadImportFailure,
  type LeadImportRowInput,
} from "../../shared/leads.ts"

import { parseDelimitedText } from "./delimited-text.ts"

export interface ParsedLeadImport {
  rows: LeadImportRowInput[]

  headerFound: boolean

  unknownColumns: string[]

  localIssues: LeadImportFailure[]
}

interface ColumnMapping {
  index: number

  key: string
}

const FIELD_BY_COLUMN = new Map(
  LEAD_IMPORT_COLUMNS.map((column) => [
    normalizeColumn(column.column),

    column.key,
  ]),
)

const ALIASES = new Map<string, string>([
  ["fullname", "name"],

  ["leadname", "name"],

  ["phonenumber", "phone"],

  ["minbudget", "budgetMin"],

  ["maxbudget", "budgetMax"],
])

function normalizeColumn(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
}

function isBlank(cells: readonly string[]): boolean {
  return cells.every((cell) => cell.trim() === "")
}

function numericCell(value: string): string | number {
  const trimmed = value.trim()

  if (trimmed === "") return ""

  const normalized = trimmed.replace(/[,\s]/g, "")

  if (!/^\d+$/.test(normalized)) return trimmed

  const amount = Number(normalized)

  return Number.isSafeInteger(amount) ? amount : trimmed
}

const EMPTY: ParsedLeadImport = {
  rows: [],

  headerFound: false,

  unknownColumns: [],

  localIssues: [],
}

export function parseLeadImportFile(text: string): ParsedLeadImport {
  const grid = parseDelimitedText(text).filter((cells) => !isBlank(cells))

  if (grid.length === 0) return EMPTY

  const header = grid[0].map((cell) => cell.trim())

  const mappings: ColumnMapping[] = []

  const unknownColumns: string[] = []

  header.forEach((column, index) => {
    if (column === "") return

    const normalized = normalizeColumn(column)

    const key = FIELD_BY_COLUMN.get(normalized) ?? ALIASES.get(normalized)

    if (key === undefined) {
      unknownColumns.push(column)

      return
    }

    if (!mappings.some((mapping) => mapping.key === key)) {
      mappings.push({ index, key })
    }
  })

  const mappedKeys = new Set(mappings.map((mapping) => mapping.key))

  if (!mappedKeys.has("name") || !mappedKeys.has("phone")) {
    return { ...EMPTY, unknownColumns }
  }

  const rows: LeadImportRowInput[] = []

  const localIssues: LeadImportFailure[] = []

  for (let index = 1; index < grid.length; index += 1) {
    const cells = grid[index]

    const values: Record<string, unknown> = {}

    for (const mapping of mappings) {
      const raw = cells[mapping.index] ?? ""

      if (raw.trim() === "") continue

      values[mapping.key] =
        mapping.key === "budgetMin" || mapping.key === "budgetMax"
          ? numericCell(raw)
          : raw.trim()
    }

    rows.push({ row: index + 1, values })
  }

  if (rows.length > LEAD_IMPORT_MAX_ROWS) {
    const overflow = rows.splice(LEAD_IMPORT_MAX_ROWS)

    localIssues.push({
      row: overflow[0]?.row ?? LEAD_IMPORT_MAX_ROWS + 2,

      errors: {
        row: `Only the first ${LEAD_IMPORT_MAX_ROWS} rows are sent. Import the rest in another file.`,
      },
    })
  }

  return { rows, headerFound: true, unknownColumns, localIssues }
}

export function leadImportTemplateCsv(): string {
  return [
    LEAD_IMPORT_COLUMNS.map((column) => column.column).join(","),

    "Aisha Khan,+971500000009,aisha@example.com,Marina Apartment,500000,900000",
  ].join("\r\n")
}
