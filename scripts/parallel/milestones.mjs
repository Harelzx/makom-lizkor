// The milestones log: an append-only JSONL file in the shared state folder. Sessions pull what is new to them
// through hooks, so nobody broadcasts and an idle session never wakes up for news.
import { spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { config, git, stateDir, withLock, worktreeKey } from "./lib.mjs"

const files = (co) => {
  const dir = stateDir(co)
  return {
    log: path.join(dir, "milestones.jsonl"),
    watch: path.join(dir, "watch.json"),
    lock: path.join(dir, "log.lock"),
    offset: path.join(dir, "read", `${worktreeKey(co.root)}.offset`),
  }
}

const readJson = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"))
  } catch {
    return fallback
  }
}

export function readEntries(co) {
  try {
    return fs
      .readFileSync(files(co).log, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line))
  } catch {
    return []
  }
}

// The most-changed folders, two levels deep, so a reader sees where a change landed at a glance.
export function topPaths(names, n = 6) {
  const counts = new Map()
  for (const name of names.filter(Boolean)) {
    const key = name.split("/").slice(0, 2).join("/")
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([p]) => p)
}

export function append(co, entry) {
  const f = files(co)
  withLock(f.lock, () => fs.appendFileSync(f.log, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n"))
}

// Fetch in the background at most every few minutes; a hook never waits on the network.
function maybeFetch(co, f) {
  const every = config(co).fetchIntervalMinutes * 60_000
  const due = (w) => Date.now() - (w.lastFetch ?? 0) >= every
  if (!due(readJson(f.watch, {}))) return
  const claimed = withLock(f.lock, () => {
    const watch = readJson(f.watch, {})
    if (!due(watch)) return false // another session claimed this fetch first
    fs.writeFileSync(f.watch, JSON.stringify({ ...watch, lastFetch: Date.now() }))
    return true
  })
  if (claimed) spawn("git", ["fetch", "-q", "origin"], { cwd: co.root, detached: true, stdio: "ignore" }).unref()
}

// Log one entry per new merge into main (local or origin). Merge commits become one entry each; a fast-forward
// batch becomes one entry. Commits already logged from the other ref are skipped, so nothing is logged twice.
export function watchMain(co) {
  const f = files(co)
  const refs = Object.fromEntries(
    git(["for-each-ref", "--format=%(refname) %(objectname)", "refs/heads/main", "refs/remotes/origin/main"], co.root)
      .split("\n")
      .filter(Boolean)
      .map((l) => l.split(" ")),
  )
  if (refs["refs/remotes/origin/main"]) maybeFetch(co, f)
  const quick = readJson(f.watch, {})
  if (Object.entries(refs).every(([ref, sha]) => quick.tips?.[ref] === sha)) return

  withLock(f.lock, () => {
    const watch = readJson(f.watch, {}) // re-read under the lock: another session may have just logged this
    watch.tips ??= {}
    const logged = new Set(watch.logged ?? [])
    for (const [ref, tip] of Object.entries(refs)) {
      const prev = watch.tips[ref]
      watch.tips[ref] = tip
      if (!prev || prev === tip) continue // first sight of this ref: start watching from here
      const rows = git(["log", "--first-parent", "--format=%H%x09%P%x09%s", `${prev}..${tip}`], co.root)
        .split("\n")
        .filter(Boolean)
        .map((l) => l.split("\t"))
        .filter(([sha]) => !logged.has(sha))
        .reverse()
      const ff = []
      const flush = () => {
        if (!ff.length) return
        const names = git(
          ["diff", "--name-only", ff[0][1] || git(["hash-object", "-t", "tree", "/dev/null"], co.root), ff.at(-1)[0]],
          co.root,
        ).split("\n")
        const subjects = ff.map((r) => r[2])
        const summary =
          ff.length === 1 ? subjects[0] : `${ff.length} commits: ${subjects.slice(0, 4).join("; ")}${ff.length > 4 ? "; …" : ""}`
        fs.appendFileSync(
          f.log,
          JSON.stringify({
            ts: new Date().toISOString(),
            kind: "merge",
            branch: "main",
            summary,
            paths: topPaths(names),
            commit: ff.at(-1)[0].slice(0, 9),
          }) + "\n",
        )
        ff.length = 0
      }
      for (const row of rows) {
        const [sha, parents, subject] = row
        logged.add(sha)
        const ps = parents.split(" ")
        if (ps.length < 2) {
          ff.push(row)
          continue
        }
        flush()
        const names = git(["diff", "--name-only", ps[0], sha], co.root).split("\n")
        const branch = subject.match(/Merge (?:branch|pull request #\d+ from) '?([^'\s]+)'?/)?.[1] ?? "?"
        const body = git(["log", "--format=%s", `${ps[0]}..${ps[1]}`, "-n", "3"], co.root)
          .split("\n")
          .filter(Boolean)
        const summary = body.length ? `${subject} (${body.join("; ")})` : subject
        fs.appendFileSync(
          f.log,
          JSON.stringify({
            ts: new Date().toISOString(),
            kind: "merge",
            branch,
            summary,
            paths: topPaths(names),
            commit: sha.slice(0, 9),
          }) + "\n",
        )
      }
      flush()
    }
    watch.logged = [...logged].slice(-500)
    fs.writeFileSync(f.watch, JSON.stringify(watch))
  })
}

const readOffset = (co) => Number(readJson(files(co).offset, 0)) || 0
const writeOffset = (co, n) => {
  const file = files(co).offset
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, String(n))
}

// Entries this worktree hasn't seen yet, minus the ones it wrote itself. Reading marks them seen.
export function takeUnseen(co) {
  const all = readEntries(co)
  const from = readOffset(co)
  if (from >= all.length) return []
  writeOffset(co, all.length)
  return all.slice(from).filter((e) => e.worktree !== co.root)
}

export function takeRecent(co, n = 5) {
  const all = readEntries(co)
  writeOffset(co, all.length)
  return all.slice(-n)
}

export const format = (entries) =>
  entries
    .map((e) => `- ${e.ts.slice(0, 16).replace("T", " ")} [${e.branch}] ${e.summary}${e.paths?.length ? ` (${e.paths.join(", ")})` : ""}`)
    .join("\n")
