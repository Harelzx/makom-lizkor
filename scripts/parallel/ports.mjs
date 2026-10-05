// Ports per checkout. The main checkout keeps its fixed ports (5174 dev, 5190 e2e/preview, 4174 prod e2e).
// Each linked worktree gets its own slot, so Playwright's reuseExistingServer can never pick up another worktree's server.
import fs from "node:fs"
import path from "node:path"
import { checkout, config, stateDir, withLock } from "./lib.mjs"

export function checkoutPorts(dir = process.cwd()) {
  let co
  try {
    co = checkout(dir)
  } catch {
    return { ...config().ports.main, main: true } // not a git checkout (an exported copy): behave like the main checkout
  }
  const { ports } = config(co)
  if (co.isMain) return { ...ports.main, main: true }

  const state = stateDir(co)
  const file = path.join(state, "ports.json")
  const slot = withLock(path.join(state, "ports.lock"), () => {
    let registry = {}
    try {
      registry = JSON.parse(fs.readFileSync(file, "utf8"))
    } catch {
      /* first worktree */
    }
    // Free the slots of worktrees that no longer exist.
    for (const root of Object.keys(registry)) if (!fs.existsSync(root)) delete registry[root]
    if (!registry[co.root]) {
      const used = new Set(Object.values(registry))
      let s = 1
      while (used.has(s)) s++
      if (s > ports.maxSlots) throw new Error(`no free port slot (max ${ports.maxSlots} worktrees)`)
      registry[co.root] = s
      fs.writeFileSync(file, JSON.stringify(registry, null, 2))
    }
    return registry[co.root]
  })
  const base = ports.worktreeBase
  return { dev: base.dev + slot, e2e: base.e2e + slot, prod: base.prod + slot, main: false }
}
