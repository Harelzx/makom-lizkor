// Shared plumbing for parallel Claude Code sessions: every worktree of this repo reads and writes one state
// folder inside the common git dir, so nothing lands in a working tree.
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

// Resolve the checkout from the filesystem alone: hooks run on every prompt and tool call, and spawning git costs more than reading two files.
export function checkout(start = process.cwd()) {
  let dir = path.resolve(start)
  for (;;) {
    const dotGit = path.join(dir, ".git")
    let stat
    try {
      stat = fs.statSync(dotGit)
    } catch {
      const up = path.dirname(dir)
      if (up === dir) throw new Error(`not inside a git checkout: ${start}`)
      dir = up
      continue
    }
    if (stat.isDirectory()) return { root: dir, commonDir: dotGit, isMain: true }
    // A linked worktree's .git is a file pointing at .git/worktrees/<name>, whose commondir points back at the shared .git.
    const gitDir = path.resolve(
      dir,
      fs
        .readFileSync(dotGit, "utf8")
        .replace(/^gitdir:\s*/, "")
        .trim(),
    )
    const common = path.resolve(gitDir, fs.readFileSync(path.join(gitDir, "commondir"), "utf8").trim())
    return { root: dir, commonDir: common, isMain: false }
  }
}

export function stateDir(co = checkout()) {
  const dir = path.join(co.commonDir, "claude-parallel")
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

// A short stable key per worktree, for per-worktree files in the shared state folder.
export const worktreeKey = (root) => createHash("sha1").update(root).digest("hex").slice(0, 12)

const defaults = {
  maxLoad1: 9,
  minFreeMemMB: 1500,
  waitSeconds: 300,
  recheckSeconds: 10,
  fetchIntervalMinutes: 5,
  ports: { main: { dev: 5174, e2e: 5190, prod: 4174 }, worktreeBase: { dev: 5400, e2e: 5500, prod: 5600 }, maxSlots: 99 },
}

export function config(co = checkout()) {
  try {
    return { ...defaults, ...JSON.parse(fs.readFileSync(path.join(co.root, ".claude", "parallel.json"), "utf8")) }
  } catch {
    return defaults
  }
}

export const alive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return e.code === "EPERM"
  }
}

// mkdir is atomic: exactly one caller creates the directory, so there is never a check-then-create race.
export function tryLock(dir, owner) {
  try {
    fs.mkdirSync(dir)
  } catch (e) {
    if (e.code === "EEXIST") return false
    throw e
  }
  fs.writeFileSync(path.join(dir, "owner.json"), JSON.stringify(owner, null, 2))
  return true
}

export function readOwner(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, "owner.json"), "utf8"))
  } catch {
    return null
  }
}

// A lock is stale when its owner process is gone, or when it never got an owner file (a crash between mkdir and write).
export function clearIfStale(dir) {
  let stat
  try {
    stat = fs.statSync(dir)
  } catch {
    return false
  }
  const owner = readOwner(dir)
  const stale = owner ? !alive(owner.pid) : Date.now() - stat.mtimeMs > 30_000
  if (stale) fs.rmSync(dir, { recursive: true, force: true })
  return stale
}

export const unlock = (dir) => fs.rmSync(dir, { recursive: true, force: true })

// A short-lived lock for small critical sections (log appends, port registry). Spins briefly; stale holders are cleared.
export function withLock(dir, fn, timeoutMs = 3000) {
  const until = Date.now() + timeoutMs
  while (!tryLock(dir, { pid: process.pid, at: new Date().toISOString() })) {
    if (clearIfStale(dir)) continue
    if (Date.now() > until) throw new Error(`timed out waiting for ${dir}`)
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20)
  }
  try {
    return fn()
  } finally {
    unlock(dir)
  }
}

// Available memory as the OS means it. On macOS os.freemem() counts only truly free pages, which is
// near zero on a healthy machine, so read the kernel's own availability level instead.
export function freeMemMB() {
  const total = os.totalmem()
  try {
    if (process.platform === "darwin") {
      const level = Number(execFileSync("sysctl", ["-n", "kern.memorystatus_level"], { encoding: "utf8" }))
      if (level > 0) return Math.round((total * level) / 100 / 2 ** 20)
    }
    if (process.platform === "linux") {
      const m = fs.readFileSync("/proc/meminfo", "utf8").match(/MemAvailable:\s+(\d+)/)
      if (m) return Math.round(Number(m[1]) / 1024)
    }
  } catch {
    /* fall through */
  }
  return Math.round(os.freemem() / 2 ** 20)
}

export function load() {
  return { load1: Number(os.loadavg()[0].toFixed(2)), cores: os.cpus().length, freeMemMB: freeMemMB() }
}

export function topConsumers(n = 5) {
  if (process.platform === "win32") return ""
  try {
    const out = execFileSync("ps", ["-Ao", "pid=,pcpu=,rss=,comm="], { encoding: "utf8" })
    return out
      .trim()
      .split("\n")
      .map((l) => l.trim().split(/\s+/))
      .map(([pid, cpu, rss, ...cmd]) => ({ pid, cpu: Number(cpu), mb: Math.round(Number(rss) / 1024), cmd: path.basename(cmd.join(" ")) }))
      .sort((a, b) => b.cpu - a.cpu)
      .slice(0, n)
      .map((p) => `    ${String(p.cpu).padStart(5)}% cpu ${String(p.mb).padStart(6)} MB  ${p.cmd} (pid ${p.pid})`)
      .join("\n")
  } catch {
    return ""
  }
}

export function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()
}

export const since = (iso) => {
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000)
  return s < 90 ? `${s}s` : s < 5400 ? `${Math.round(s / 60)}m` : `${(s / 3600).toFixed(1)}h`
}
