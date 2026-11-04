/**
 * Client-facing brand config. The canonical definition lives in
 * `shared/brand.ts` (so the server can use it too); this re-export gives the
 * app a stable `@/config/brand` import path. Import `brand` from here in any
 * screen that displays the product name.
 */

export { brand } from "@shared/brand"

export type { Brand } from "@shared/brand"
