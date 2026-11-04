/**
 * DeedOrbit brand registry — the single source of truth for the product name.
 *
 * Every user-visible place that shows the product name should read from here so
 * that a future rebrand is a one-line change. This lives in `shared/` because
 * both the browser client (`src/`) and the Node server (`server/`) import it:
 * the server needs it for the TOTP issuer, the startup banner, and generated
 * mail/notification copy; the client needs it for the logo, auth chrome, and
 * footers. `src/config/brand.ts` re-exports this for ergonomic `@/config/brand`
 * imports on the client.
 *
 * Keep the exact spelling and capitalization "DeedOrbit" (capital D, capital O,
 * no space) everywhere it is displayed.
 */

export const brand = {
  /** Full product name as shown in the UI. */

  name: "DeedOrbit",

  /** Compact name for tight spaces. Same as `name` — DeedOrbit is already short. */

  shortName: "DeedOrbit",

  /**
   * Sub-brand for the platform-operations console (the multi-tenant admin
   * surface), as opposed to a single tenant's workspace.
   */

  platformName: "DeedOrbit Platform",

  /**
   * Marketing tagline. No tagline existed before the rebrand, so this is a
   * neutral placeholder — replace it with official copy when available.
   */

  tagline: "Back-office for property sales & finance",

  /**
   * Support contact shown in transactional mail and help surfaces. Placeholder
   * domain — point this at the real mailbox before production.
   */

  supportEmail: "support@deedorbit.example",

  /** Copyright line for footers. Year kept here so it is updated in one place. */

  copyright: "© 2026 DeedOrbit",
} as const

export type Brand = typeof brand
