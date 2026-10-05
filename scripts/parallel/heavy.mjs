// scripts/heavy <command...>: runs one heavy command at a time across every worktree, and only when the machine has room.
// Exit 75 (EX_TEMPFAIL) means "not now": another session holds the lock, or the machine stayed overloaded.
import { spawn } from "node:child_process"
import os from "node:os"
import path from "node:path"
import { checkout, clearIfStale, config, git, load, readOwner, since, stateDir, topConsumers, tryLock, unlock } from "./lib.mjs"

const BUSY = 75
const co = checkout(import.meta.dirname) // the checkout this script lives in, whatever the cwd
const cfg = config(co)
const lockDir = path.join(stateDir(co), "heavy.lock")
const args = process.argv.slice(2)

const loadLine = (l) =>
  `load ${l.load1} (max ${cfg.maxLoad1}, ${l.cores} cores), free memory ${l.freeMemMB} MB (min ${cfg.minFreeMemMB} MB)`
const describe = (o) =>
  `${o.command}\n    since ${o.startedAt} (${since(o.startedAt)} ago), pid ${o.pid}\n    worktree ${o.worktree} on ${o.branch}`

if (args[0] === "--status") {
  clearIfStale(lockDir)
  const owner = readOwner(lockDir)
  console.log(owner ? `heavy lock held by:\n    ${describe(owner)}` : "heavy lock is free")
  console.log(loadLine(load()))
  process.exit(0)
}
if (!args.length || args[0] === "--help") {
  console.log(
    "usage: scripts/heavy <command...>   run a heavy command under the shared lock\n       scripts/heavy --status         show the lock holder and the machine's load",
  )
  process.exit(args.length ? 0 : 64)
}

const command = args.join(" ")
const refuseIfHeld = () => {
  clearIfStale(lockDir)
  const owner = readOwner(lockDir)
  if (!owner) return
  console.error(`heavy: not run, another session holds the heavy lock:\n    ${describe(owner)}`)
  console.error("heavy: do light work meanwhile, or ask that session to tell you when it is idle. Don't retry in a loop.")
  process.exit(BUSY)
}

refuseIfHeld()

// Wait for the machine to have room, rechecking, and say what is using it.
const overloaded = (l) => l.load1 > cfg.maxLoad1 || l.freeMemMB < cfg.minFreeMemMB
const deadline = Date.now() + cfg.waitSeconds * 1000
let l = load()
while (overloaded(l)) {
  if (Date.now() >= deadline) {
    console.error(`heavy: not run, the machine stayed overloaded for ${cfg.waitSeconds}s: ${loadLine(l)}`)
    console.error(`heavy: top consumers:\n${topConsumers()}`)
    process.exit(BUSY)
  }
  console.error(`heavy: waiting, machine busy: ${loadLine(l)}\n${topConsumers()}`)
  await new Promise((r) => setTimeout(r, cfg.recheckSeconds * 1000))
  refuseIfHeld()
  l = load()
}

let branch = "?"
try {
  branch = git(["rev-parse", "--abbrev-ref", "HEAD"], co.root)
} catch {
  /* detached or no git: keep "?" */
}
const owner = { pid: process.pid, command, worktree: co.root, branch, host: os.hostname(), startedAt: new Date().toISOString() }
if (!tryLock(lockDir, owner)) refuseIfHeld() // lost a race to another session between the check and mkdir

// From here on the lock is ours: release it however this process ends.
let released = false
const release = () => {
  if (released) return
  released = true
  if (readOwner(lockDir)?.pid === process.pid) unlock(lockDir)
}
process.on("exit", release)

const child = args.length === 1 ? spawn(args[0], { stdio: "inherit", shell: true }) : spawn(args[0], args.slice(1), { stdio: "inherit" })
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => child.kill(sig))
child.on("error", (e) => {
  console.error(`heavy: could not start: ${e.message}`)
  process.exit(127)
})
child.on("exit", (code, signal) => {
  release()
  process.exit(code ?? 128 + (os.constants.signals[signal] ?? 0))
})
