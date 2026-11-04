const DEFAULT_CURRENCY = "USD"

function currencyFormatter(
  currency: string,
  options: Intl.NumberFormatOptions,
) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    ...options,
  })
}

export function formatCurrency(
  value: number,
  currency: string = DEFAULT_CURRENCY,
  options: Intl.NumberFormatOptions = {},
): string {
  return currencyFormatter(currency, {
    maximumFractionDigits: 2,
    ...options,
  }).format(value)
}

/** Whole-unit currency, for KPI tiles where cents are noise. */
export function formatCurrencyCompact(
  value: number,
  currency: string = DEFAULT_CURRENCY,
): string {
  return currencyFormatter(currency, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value)
}

/**
 * South-Asian money: crore (1e7) and lakh (1e5) scaling, the way Pakistani
 * real-estate figures are spoken — "PKR 4.25 Cr", "PKR 12.5 Lac", and plain
 * grouped thousands below a lakh. The compact form belongs on KPI cards; the
 * full grouped figure it was scaled from stays available via
 * `formatMoneyFull` for hover titles, so a rounded card never misquotes.
 */
export function formatMoneyLakh(
  value: number,
  currency: string = DEFAULT_CURRENCY,
): string {
  if (!Number.isFinite(value)) return "—"

  const sign = value < 0 ? "-" : ""

  const abs = Math.abs(value)

  const trim = (n: number) =>
    n.toFixed(2)
      .replace(/\.00$/, "")
      .replace(/(\.\d)0$/, "$1")

  if (abs >= 1e7) return `${sign}${currency} ${trim(abs / 1e7)} Cr`

  if (abs >= 1e5) return `${sign}${currency} ${trim(abs / 1e5)} Lac`

  return `${sign}${currency} ${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(abs)}`
}

/** The exact grouped figure behind a compact card, e.g. for a title. */
export function formatMoneyFull(
  value: number,
  currency: string = DEFAULT_CURRENCY,
): string {
  if (!Number.isFinite(value)) return "—"

  return `${currency} ${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(value)}`
}

export function formatNumber(
  value: number,
  options: Intl.NumberFormatOptions = {},
): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
    ...options,
  }).format(value)
}

export function formatPercent(value: number, fractionDigits = 1): string {
  return `${value.toFixed(fractionDigits)}%`
}

export function formatDate(value: string | number | Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value))
}

export function formatDateTime(value: string | number | Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value))
}

export function formatMonthYear(value: string | number | Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    month: "short",
    year: "numeric",
  }).format(new Date(value))
}

const RELATIVE_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * 24 * 60 * 60 * 1000],
  ["month", 30 * 24 * 60 * 60 * 1000],
  ["week", 7 * 24 * 60 * 60 * 1000],
  ["day", 24 * 60 * 60 * 1000],
  ["hour", 60 * 60 * 1000],
  ["minute", 60 * 1000],
]

/**
 * Compact "in 3 days" / "2 hours ago" phrasing for deadlines and activity.
 *
 * Deliberately not a countdown: expiry copy needs to read as urgency, not as a
 * ticking number. Returns a dash for a missing or unparseable value rather than
 * "Invalid Date", because these strings sit next to real timestamps.
 */
export function formatRelative(
  value: string | number | Date | null | undefined,
): string {
  if (value === null || value === undefined || value === "") return "—"

  const time = new Date(value).getTime()
  if (Number.isNaN(time)) return "—"

  const delta = time - Date.now()
  const magnitude = Math.abs(delta)
  const formatter = new Intl.RelativeTimeFormat("en-GB", { numeric: "auto" })

  for (const [unit, size] of RELATIVE_UNITS) {
    if (magnitude >= size) {
      return formatter.format(Math.round(delta / size), unit)
    }
  }
  return "just now"
}

/** Renders a dash for absent values, so a table never shows "null". */
export function orDash(value: string | number | null | undefined): string {
  return value === null || value === undefined || value === ""
    ? "—"
    : String(value)
}

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const

/**
 * Binary byte counts for plan-limit usage (documents store raw `size_bytes`).
 *
 * Binary steps because the limits themselves are written as powers of 1024 in
 * the plan catalogue; mixing decimal units into a binary comparison would make
 * a full bar read as under 100%. Returns a dash for a missing count rather
 * than "NaN B", and keeps one decimal only where it changes the reading.
 */
export function formatBytes(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—"
  }

  if (value < 0) return "—"

  let unit = 0

  let size = value

  while (size >= 1024 && unit < BYTE_UNITS.length - 1) {
    size /= 1024

    unit += 1
  }

  const digits = unit === 0 || size >= 100 ? 0 : 1

  return `${size.toFixed(digits)} ${BYTE_UNITS[unit]}`
}
