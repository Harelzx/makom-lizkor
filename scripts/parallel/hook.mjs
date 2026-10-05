// One entry point for every Claude Code hook of the parallel-sessions setup: node hook.mjs <pretool|session|prompt|posttool>.
// Fails open: if anything here breaks, the session carries on with a warning and is never blocked by a bug in this file.
import fs from "node:fs"
import path from "node:path"
import { checkout, stateDir } from "./lib.mjs"
import { format, takeRecent, takeUnseen, watchMain } from "./milestones.mjs"

const event = process.argv[2]
let input = {}
try {
  input = JSON.parse(fs.readFileSync(0, "utf8") || "{}")
} catch {
  /* no stdin: run with defaults */
}

const context = (name, text) => {
  if (text) console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: name, additionalContext: text } }))
}

// Split a shell line into the commands it runs, so `cd x && npm run e2e` is judged by `npm run e2e`.
const segments = (cmd) =>
  cmd
    .split(/&&|\|\||;|\||\n/)
    .map((s) =>
      s
        .trim()
        .replace(/^[({]\s*/, "")
        .replace(/^(?:\w+=\S*\s+)+/, "")
        .replace(/^(?:time|exec|command|nice(?:\s+-n\s*\d+)?)\s+/, "")
        .trim(),
    )
    .filter(Boolean)

const viaWrapper = (seg) => /^(?:\S*\/)?scripts\/heavy(?:\s|$)/.test(seg) || /^node\s+\S*scripts\/parallel\/heavy\.mjs(?:\s|$)/.test(seg)

function pretool(co) {
  if (process.env.CLAUDE_PARALLEL_OFF === "1" || fs.existsSync(path.join(stateDir(co), "off"))) return
  const command = input.tool_input?.command
  if (typeof command !== "string") return
  const patterns = fs
    .readFileSync(path.join(co.root, ".claude", "heavy-commands.txt"), "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => new RegExp(l))
  const offending = segments(command).find((seg) => !viaWrapper(seg) && patterns.some((p) => p.test(seg)))
  if (!offending) return
  process.stderr.write(
    `Blocked: \`${offending}\` is a heavy command, and heavy commands run one at a time across all parallel sessions.\n` +
      `Rerun it through the wrapper, from the same directory: ${path.join(co.root, "scripts", "heavy")} ${offending}\n` +
      `If the wrapper exits 75, don't retry in a loop: do light work, or ask the session holding the lock to tell you when it is idle.`,
  )
  process.exit(2)
}

// Every checkout gets a preview entry on its own e2e port (5190 in the main checkout), so a worktree's preview and e2e
// never touch another worktree's server.
async function preparePreview(co) {
  const { checkoutPorts } = await import("./ports.mjs")
  const ports = checkoutPorts(co.root)
  const file = path.join(co.root, ".claude", "launch.json")
  const launch = {
    version: "0.0.1",
    configurations: [
      {
        name: "makom-lizkor-v2",
        runtimeExecutable: "npm",
        runtimeArgs: ["run", "dev", "--", "--port", String(ports.e2e), "--strictPort"],
        port: ports.e2e,
      },
    ],
  }
  const text = JSON.stringify(launch, null, 2) + "\n"
  if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== text) fs.writeFileSync(file, text)
  if (co.isMain) return ""
  const notes = [`This worktree's ports: dev ${ports.dev}, e2e and preview ${ports.e2e}, prod e2e ${ports.prod}.`]
  if (!fs.existsSync(path.join(co.root, "node_modules")))
    notes.push("node_modules is missing in this worktree: run `scripts/heavy npm ci` before building or testing.")
  return notes.join("\n")
}

// Claude may have cd'd outside the repo (to ../launch/tools, say), and a heavy command run from there is still ours to gate.
const resolveCheckout = () => {
  for (const dir of [input.cwd, process.env.CLAUDE_PROJECT_DIR, process.cwd()].filter(Boolean)) {
    try {
      return checkout(dir)
    } catch {
      /* not a checkout: try the next */
    }
  }
  throw new Error("not inside this repo")
}

try {
  const co = resolveCheckout()
  if (event === "pretool") pretool(co)
  else if (event === "session") {
    try {
      watchMain(co)
    } catch {
      /* no main branch yet: nothing to watch */
    }
    const recent = takeRecent(co)
    const parts = [await preparePreview(co)]
    if (recent.length) parts.push(`Recent milestones from parallel sessions (oldest first):\n${format(recent)}`)
    context("SessionStart", parts.filter(Boolean).join("\n\n"))
  } else if (event === "prompt" || event === "posttool") {
    if (event === "prompt")
      try {
        watchMain(co)
      } catch {
        /* no main branch yet */
      }
    const fresh = takeUnseen(co)
    if (fresh.length)
      context(
        event === "prompt" ? "UserPromptSubmit" : "PostToolUse",
        `New milestones from parallel sessions (act only if they affect your current work):\n${format(fresh)}`,
      )
  }
} catch (e) {
  process.stderr.write(`parallel-sessions hook (${event}) failed open: ${e.message}\n`)
  process.exit(1)
}
