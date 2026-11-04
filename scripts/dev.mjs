/**
 * Runs the API server and the Vite dev server together with one command.
 * No `concurrently` dependency — `child_process.spawn` is enough, and a shell
 * task runner would not work reliably on Windows anyway.
 */

import { spawn } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")

const children = []

function run(name, command, args) {
  const child = spawn(command, args, {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    // No `shell`. The command is an absolute path to node itself, so there is
    // nothing to look up on PATH, and a shell only gets in the way: on Windows
    // `cmd.exe` re-splits the command string on spaces, so the default install
    // path (`C:\Program Files\nodejs\node.exe`) arrived as `C:\Program` and the
    // child died with "not recognized as an internal or external command".
    env: { ...process.env, FORCE_COLOR: "1" },
  })

  const prefix = `[${name}]`
  child.stdout.on("data", (chunk) => {
    for (const line of String(chunk).split(/\r?\n/)) {
      if (line.trim()) console.log(`${prefix} ${line}`)
    }
  })
  child.stderr.on("data", (chunk) => {
    for (const line of String(chunk).split(/\r?\n/)) {
      if (line.trim()) console.error(`${prefix} ${line}`)
    }
  })

  child.on("exit", (code) => {
    console.log(`${prefix} exited with code ${code}`)
    shutdown(code ?? 0)
  })

  children.push(child)
  return child
}

/**
 * Kills a child and everything it started.
 *
 * `child.kill()` alone is not enough: `node --watch` runs the server as a
 * grandchild, so on Windows the API would survive a Ctrl+C still holding port
 * 8444, and the next `pnpm dev` would fail to bind. `taskkill /T` takes the
 * whole tree down; on POSIX a plain signal is sufficient here because nothing
 * extra is spawned.
 */
function killTree(child) {
  if (!child.pid) return

  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
    })
    return
  }

  try {
    child.kill("SIGTERM")
  } catch {
    /* already gone */
  }
}

function shutdown(code) {
  for (const child of children) {
    if (!child.killed) killTree(child)
  }
  process.exit(code)
}

process.on("SIGINT", () => shutdown(0))
process.on("SIGTERM", () => shutdown(0))

run("api", process.execPath, ["--watch", "server/index.ts"])
run("web", process.execPath, ["node_modules/vite/bin/vite.js"])
