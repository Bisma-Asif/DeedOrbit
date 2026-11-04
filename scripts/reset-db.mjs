/**
 * Deletes the local database so the next API boot reseeds from scratch.
 *
 * A running API keeps the SQLite file open, and on Windows that makes the delete
 * fail with a bare EPERM. Left unhandled the developer only sees a raw Node
 * stack trace, so translate it into the actual instruction: stop the API first.
 */

import { rmSync, existsSync, readdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const dir = join(root, "data")

if (!existsSync(dir)) {
  console.log("[db] nothing to remove")
  process.exit(0)
}

try {
  rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
} catch (error) {
  const code = error?.code
  if (code === "EPERM" || code === "EBUSY") {
    // Name the files that survived so it is obvious what is holding them.
    let held = []
    try {
      held = readdirSync(dir)
    } catch {
      held = []
    }
    console.error("[db] cannot delete data/ — the API is probably still running.")
    console.error(`[db] locked: ${held.join(", ") || "unknown"}`)
    console.error("[db] stop the API (Ctrl+C in the dev:all terminal), then rerun this command.")
    process.exit(1)
  }
  throw error
}

console.log("[db] removed data/ — the next API boot will reseed")
