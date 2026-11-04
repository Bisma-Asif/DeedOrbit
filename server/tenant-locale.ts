/**
 * The three facts a workspace answers in its own terms, not the server's.
 *
 * Manual entry has to judge what an officer typed: is this date of birth in the future,
 * is this number a Pakistani number, is this instalment due today? None of those have an
 * answer until the record's own day, country and currency are known, and a workspace in
 * Karachi is not the same day as a server in UTC or a browser in London.
 *
 * `payments.ts` carried the first two privately until the customer form needed the third,
 * so they live here where the routes that write money and the routes that write people
 * both read the same one.
 */

import { get } from "./db.ts"

/** Currency column falls back to the platform's original default, never to a blank. */

const DEFAULT_CURRENCY = "AED"

const DEFAULT_TIMEZONE = "UTC"

interface TenantLocaleRow {
  currency: string

  timezone: string

  country_code: string | null
}

function readTenantLocale(tenantId: string): TenantLocaleRow | undefined {
  return get<TenantLocaleRow>(
    "SELECT currency, timezone, country_code FROM tenants WHERE id = ?",

    tenantId,
  )
}

export function tenantCurrency(tenantId: string): string {
  return readTenantLocale(tenantId)?.currency ?? DEFAULT_CURRENCY
}

/**
 * Today as a `YYYY-MM-DD` in the tenant's own time zone.
 *
 * A due date is compared to the day the workspace lives in, not to the server's UTC day
 * or the viewer's browser day, so a line is "due" on the same date for everyone in that
 * tenant. `en-CA` renders the ISO form; a bad time zone falls back to UTC rather than
 * throwing on a read.
 */

export function tenantToday(tenantId: string): string {
  const timezone = readTenantLocale(tenantId)?.timezone ?? DEFAULT_TIMEZONE

  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,

      year: "numeric",

      month: "2-digit",

      day: "2-digit",
    }).format(new Date())
  } catch {
    return new Date().toISOString().slice(0, 10)
  }
}

/** The tenant's ISO country code, uppercase, or null when it never set one. */

export function tenantCountryCode(tenantId: string): string | null {
  return readTenantLocale(tenantId)?.country_code?.toUpperCase() ?? null
}

/**
 * Whether this workspace keeps Pakistani records.
 *
 * The CNIC and mobile-number rules are Pakistani law, not a universal shape: a Dubai
 * workspace holding `+971` numbers must not be refused by them, and a Karachi one holding
 * `0300…` must not be accepted as "any plausible digits". The country the admin typed in
 * Settings is the only honest way to choose between the two.
 */

export function tenantIsPakistan(tenantId: string): boolean {
  return tenantCountryCode(tenantId) === "PK"
}
