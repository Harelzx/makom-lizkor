// One entry point for local/CI browser selection, exact planned-vs-executed coverage, and timing evidence.
import { execFileSync, spawnSync } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { GROUPS } from "./ci-plan.mjs"
export const CORE = [
  "submission",
  "api-down",
  "lost-receipt",
  "retry-feedback",
  "withdrawal",
  "photo",
  "family",
  "private",
  "share",
  "artwork",
  "sheet",
  "form-a11y",
  "headers",
  "csp",
  "edge",
]
export function selection(scope, groups = []) {
  if (scope === "full") return ["--grep-invert", "keeps the frame rate"]
  if (scope === "compatibility") return ["--grep", "a11y.*\\.spec\\.ts|@phone"]
  if (scope === "webkit") return ["--grep", "@phone"]
  if (scope === "dev") return ["--grep", "@core-api-down|@core-share"]
  if (scope !== "core" || groups.some((g) => !(g in GROUPS))) throw new Error("Unknown browser scope/group")
  return [
    "--grep",
    ["@core-", ...new Set(groups.flatMap((g) => GROUPS[g]).map((f) => `${f}\\.spec\\.ts`))].join("|"),
    "--grep-invert",
    "keeps the frame rate",
  ]
}
export function entries(report) {
  const found = []
  const walk = (suite) => {
    for (const spec of suite.specs ?? [])
      for (const t of spec.tests ?? [])
        found.push({
          id: t.projectName + ":" + spec.id,
          project: t.projectName,
          title: spec.title,
          tags: spec.tags ?? [],
          test: t,
          file: spec.file,
        })
    for (const s of suite.suites ?? []) walk(s)
  }
  walk(report)
  return found
}
export function validateReport(planned, actual) {
  const expected = entries(planned),
    got = entries(actual)
  if (!expected.some((t) => t.project !== "seed")) throw new Error("No browser tests selected")
  const ids = (xs) => xs.map((x) => x.id).sort()
  if (JSON.stringify(ids(expected)) !== JSON.stringify(ids(got))) throw new Error("Executed tests differ from the plan")
  if ((actual.errors ?? []).length) throw new Error("Browser runner errors")
  for (const row of got) {
    const results = row.test.results ?? []
    if (row.test.expectedStatus !== "passed" || row.test.status !== "expected" || results.length !== 1 || results[0].status !== "passed")
      throw new Error(`Not a first-attempt pass: ${row.file} ${row.title}`)
  }
  return got.map((row) => ({ id: row.id, project: row.project, title: row.title, file: row.file, ms: row.test.results[0].duration }))
}
function checkCore(report) {
  const tags = new Set(entries(report).flatMap((r) => r.tags))
  for (const id of CORE) if (!tags.has(`core-${id}`)) throw new Error(`Missing core scenario ${id}`)
}
const read = (p) => JSON.parse(readFileSync(p, "utf8"))
function configArgs(scope) {
  return scope === "webkit"
    ? ["-c", "playwright.browsers.config.ts", "--project=webkit-phone"]
    : scope === "compatibility"
      ? ["-c", "playwright.browsers.config.ts"]
      : []
}
function environment(scope, out) {
  return {
    ...process.env,
    E2E_PROD: scope === "dev" ? "" : "1",
    PLAYWRIGHT_JSON_OUTPUT_FILE: out,
    E2E_GLOBAL_TIMEOUT_MS: String((scope === "webkit" ? 10 : scope === "dev" ? 5 : 35) * 60_000),
    CI: process.env.CI || "",
  }
}
function list(scope, groups, shard) {
  const args = [
    "playwright",
    "test",
    ...configArgs(scope),
    ...selection(scope, groups),
    ...(shard ? [`--shard=${shard}`] : []),
    "--list",
    "--reporter=json",
  ]
  const env = environment(scope, "")
  delete env.PLAYWRIGHT_JSON_OUTPUT_FILE
  return JSON.parse(execFileSync("npx", args, { encoding: "utf8", env, maxBuffer: 16 * 1024 * 1024 }))
}
export function verifyShards(expected, receipts) {
  if (
    receipts.length !== 2 ||
    new Set(receipts.map((r) => r.shard)).size !== 2 ||
    !receipts.every((r) => ["1/2", "2/2"].includes(r.shard) && r.scope === "full")
  )
    throw new Error("Two distinct full shards are required")
  const planned = entries(expected)
    .filter((r) => r.project !== "seed")
    .map((r) => r.id)
    .sort()
  const executed = receipts.flatMap((r) => r.tests.filter((t) => t.project !== "seed").map((t) => t.id)).sort()
  if (new Set(executed).size !== executed.length || JSON.stringify(planned) !== JSON.stringify(executed))
    throw new Error("Full shard coverage is missing or duplicated")
  if (!receipts.every((r) => r.tests.some((t) => t.project === "seed"))) throw new Error("Every shard needs its own seed")
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, scope, shard] = process.argv.slice(2)
  const dir = resolve(process.env.CI_BROWSER_DIR || "ci-results")
  const groups = JSON.parse(process.env.CI_GROUPS || "[]")
  if (command === "list") console.log(JSON.stringify(list(scope, groups, shard), null, 2))
  else if (command === "run") {
    mkdirSync(dir, { recursive: true })
    const planned = list(scope, groups, shard)
    if (scope === "core" || (scope === "full" && !shard)) checkCore(planned)
    writeFileSync(join(dir, "planned.json"), JSON.stringify(planned))
    const started = Date.now()
    const result = spawnSync(
      "npx",
      [
        "playwright",
        "test",
        ...configArgs(scope),
        ...selection(scope, groups),
        ...(shard ? [`--shard=${shard}`] : []),
        "--reporter=list,json",
      ],
      { stdio: "inherit", env: environment(scope, join(dir, "actual.json")) },
    )
    if (result.status !== 0) process.exit(result.status || 1)
    const tests = validateReport(planned, read(join(dir, "actual.json")))
    const receipt = {
      sha: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
      dirty: !!execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim(),
      scope,
      shard: shard || null,
      tests,
      elapsed_ms: Date.now() - started,
    }
    writeFileSync(join(dir, "receipt.json"), JSON.stringify(receipt, null, 2))
    const slowest = [...tests].sort((a, b) => b.ms - a.ms).slice(0, 8)
    const summary =
      `## Browser ${scope} ${shard || ""}\n${tests.length} first-attempt passes; ${Math.round(receipt.elapsed_ms / 1000)} seconds.\n\n` +
      slowest.map((t) => `- ${Math.round(t.ms / 1000)}s: ${t.title}`).join("\n") +
      "\n"
    if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, summary, { flag: "a" })
  } else if (command === "verify-full") {
    const expected = list("full", [], null)
    checkCore(expected)
    const receipts = readdirSync(dir)
      .filter((f) => f.startsWith("browser-full-"))
      .map((f) => read(join(dir, f, "receipt.json")))
    const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()
    if (receipts.some((r) => r.sha !== sha || r.dirty)) throw new Error("Shard SHA mismatch")
    verifyShards(expected, receipts)
    console.log(`Complete same-SHA coverage: ${entries(expected).length} planned tests (seed duplicated intentionally).`)
  } else throw new Error("Use run/list <core|full|webkit|dev> [shard] or verify-full")
}
