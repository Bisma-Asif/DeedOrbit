// Dev helper: start the API server detached, logging to data/api.log.
// Not part of the app; used to verify the backend from a shell.
import { spawn } from "node:child_process"
import { openSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const out = openSync(join(root, "data", "api.log"), "a")

const child = spawn(process.execPath, ["server/index.ts"], {
  cwd: root,
  detached: true,
  stdio: ["ignore", out, out],
  env: { ...process.env, DEEDORBIT_EXPOSE_RESET_TOKEN: "1" },
})
child.unref()
console.log(child.pid)
