// The release manifest (spec 14.2, 12.2): what a release changes since the last one, the SQL of its new migrations as
// they will run, and the risk flags the owner reads before pressing Run workflow. It is deterministic (no times, sorted
// lists), so release.yml rebuilds it for the commit it deploys and refuses unless the attachment to the draft release
// is the same, field by field (a hash it merely declares proves nothing, a51): the manifest, the CI run, the checkout
// and the deploy all name one commit (adviser a49).
//   node scripts/release-manifest.mjs <to> [<from>] [--json | --hash]
//   node scripts/release-manifest.mjs <to> [<from>] --verify <attached.json> [--tag <release-tag>]
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { isDeepStrictEqual } from "node:util"
import { pathToFileURL } from "node:url"

const git = (cwd, args) =>
  execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] })
const show = (cwd, rev, path) => {
  try {
    return git(cwd, ["show", `${rev}:${path}`])
  } catch {
    return null
  }
}

/** Files whose change the owner must read before releasing: each flag names why. */
const FLAGS = [
  ["data_access", /^worker\/db\//, "the code that reads and writes the database"],
  ["github", /^\.github\//, "workflows: what CI and the release run, and with which secrets"],
  ["dependencies", /^(package\.json|package-lock\.json|patches\/)/, "dependencies and their patches"],
  ["agent_settings", /^\.claude\/settings[^/]*\.json$/, "the agents' permission rules and hooks"],
  ["platform_config", /^wrangler\.jsonc$/, "bindings, schedules and what the deploy ships"],
]
export const OPS_SCHEMA = "worker/lib/ops-summary.schema.json"

/** Hosts written into the code (fetch targets, the page policy's hosts, links), outside the curated data and the tests. */
function hosts(cwd, rev) {
  if (!rev) return new Set()
  let out = ""
  try {
    out = git(cwd, [
      "grep",
      "-o",
      "-I",
      "-E",
      "https?://[A-Za-z0-9.-]+",
      rev,
      "--",
      "worker",
      "src",
      ":!src/data",
      ":!worker/test",
      ":!*.test.*",
    ])
  } catch {
    // git grep exits 1 when nothing matches.
  }
  // Each line is rev:path:match; the match is the line's end.
  return new Set(out.split("\n").flatMap((l) => (l.match(/https?:\/\/[A-Za-z0-9.-]+$/) ?? []).map((h) => h.toLowerCase())))
}

/**
 * What a field added to the /api/ops schema can hold: a count, a flag, a date or a code (the schema's own code pattern,
 * or a fixed list) is fine; anything else may carry text or an id, and needs the privacy session's review before merge
 * (its rule, 2026-10-06). A union whose branches disagree counts as the wider one; null is no kind of its own.
 */
const DATE = "\\d{4}-\\d{2}-\\d{2}"
const CODE = "^[a-z][a-z0-9_]{0,47}$"
function classify(node) {
  if (node.enum || "const" in node) return "code"
  const types = [].concat(node.type ?? []).filter((t) => t !== "null")
  if (types.length !== 1) return "text_or_id"
  const [type] = types
  if (type === "integer" || type === "number") return "count"
  if (type === "boolean") return "flag"
  if (type === "string" && node.pattern === CODE) return "code"
  if (type === "string" && typeof node.pattern === "string" && node.pattern.includes(DATE)) return "date"
  return "text_or_id"
}
function fields(node, path, out) {
  if (!node || typeof node !== "object") return out
  const branches = node.anyOf ?? node.oneOf
  if (branches) {
    for (const branch of branches) fields(branch, path, out)
    return out
  }
  const types = [].concat(node.type ?? [])
  if (types.length === 1 && types[0] === "null") return out
  if (types.includes("object") || node.properties) {
    for (const [k, v] of Object.entries(node.properties ?? {})) fields(v, path ? `${path}.${k}` : k, out)
    if (node.additionalProperties && typeof node.additionalProperties === "object") {
      fields(node.additionalProperties, `${path}.*`, out)
      // A record's keys can carry text as easily as its values.
      out.set(`${path}.<key>`, node.propertyNames ? classify(node.propertyNames) : "text_or_id")
    }
  } else if (types.includes("array")) fields(node.items, `${path}[]`, out)
  else {
    const kind = classify(node)
    const before = out.get(path)
    out.set(path, before && before !== kind ? "text_or_id" : kind)
  }
  return out
}
export function opsFieldsAdded(before, after) {
  const was = fields(before ? JSON.parse(before) : {}, "", new Map())
  const now = fields(after ? JSON.parse(after) : {}, "", new Map())
  return [...now].filter(([path, kind]) => was.get(path) !== kind).map(([path, kind]) => ({ path, kind }))
}

export function manifest({ cwd = process.cwd(), to, from = null }) {
  const sha = git(cwd, ["rev-parse", `${to}^{commit}`]).trim()
  const base = from ? git(cwd, ["rev-parse", `${from}^{commit}`]).trim() : null
  const files = (
    base
      ? git(cwd, ["diff", "--name-status", "--no-renames", base, sha])
      : git(cwd, ["ls-tree", "-r", "--name-only", sha]).replace(/^/gm, "A\t")
  )
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const [status, path] = l.split("\t")
      return { status, path }
    })
    .sort((a, b) => a.path.localeCompare(b.path))
  const commits = git(cwd, ["log", "--reverse", "--format=%H %s", base ? `${base}..${sha}` : sha])
    .split("\n")
    .filter(Boolean)
  const migrations = files
    .filter((f) => f.path.startsWith("migrations/") && f.path.endsWith(".sql") && f.status !== "D")
    .map((f) => ({ file: f.path, status: f.status, sql: show(cwd, sha, f.path) }))
  const risks = []
  for (const [flag, pattern, why] of FLAGS) {
    const hit = files.filter((f) => pattern.test(f.path)).map((f) => f.path)
    if (hit.length) risks.push({ flag, why, files: hit })
  }
  // An applied migration must never change: D1 won't run it again, so production and the file would disagree.
  const edited = migrations.filter((m) => m.status !== "A").map((m) => m.file)
  if (edited.length) risks.push({ flag: "migration_edited", why: "a migration already released was changed or removed", files: edited })
  const before = hosts(cwd, base)
  const added = [...hosts(cwd, sha)].filter((h) => !before.has(h)).sort()
  if (base && added.length)
    risks.push({ flag: "new_hosts", why: "hosts newly written into the code: fetch targets, page policy, links", files: added })
  if (files.some((f) => f.path === OPS_SCHEMA)) {
    const changed = opsFieldsAdded(base && show(cwd, base, OPS_SCHEMA), show(cwd, sha, OPS_SCHEMA))
    const textOrId = changed.filter((c) => c.kind === "text_or_id")
    risks.push({
      flag: "ops_output",
      why: textOrId.length
        ? "what the diagnostic agent sees changed, and a field may hold text or an id: the privacy session's review is required before merge"
        : "what the diagnostic agent sees changed (counts, dates and codes only)",
      files: [OPS_SCHEMA],
      fields: changed,
      privacy_review: textOrId.length > 0,
    })
  }
  return { to: sha, from: base, commits, files, migrations, risks }
}

export const manifestHash = (m) => createHash("sha256").update(JSON.stringify(m)).digest("hex")

/**
 * Why an attached manifest isn't this commit's: each top-level field that differs from the one rebuilt here (its hash
 * included), and a release tag that already exists at another commit (rollback finds a release by its tag, and GitHub
 * publishes an existing tag as it is, whatever the draft's target). Empty when it is.
 */
export function attachedProblems({ cwd = process.cwd(), to, from = null, attached, tag = null }) {
  const m = manifest({ cwd, to, from })
  const expected = { ...m, hash: manifestHash(m) }
  const fields = [...new Set([...Object.keys(expected), ...Object.keys(attached ?? {})])].filter(
    (k) => !isDeepStrictEqual(expected[k], attached?.[k]),
  )
  const problems = fields.length ? [`the attached manifest differs from this commit's: ${fields.join(", ")}`] : []
  if (tag) {
    let at = null
    try {
      at = git(cwd, ["rev-parse", "-q", "--verify", `refs/tags/${tag}^{commit}`]).trim()
    } catch {
      // No such tag yet: publishing makes it at the target.
    }
    const sha = git(cwd, ["rev-parse", `${to}^{commit}`]).trim()
    if (at && at !== sha) problems.push(`the tag ${tag} names ${at}, not ${sha}`)
  }
  return problems
}

export function render(m) {
  const lines = [
    `# Release manifest`,
    "",
    `- To: \`${m.to}\``,
    `- From: ${m.from ? `\`${m.from}\`` : "the first release"}`,
    `- Hash: \`${manifestHash(m)}\``,
    "",
  ]
  lines.push("## Risk flags", "")
  if (!m.risks.length) lines.push("None.")
  for (const r of m.risks) {
    lines.push(`- **${r.flag}**: ${r.why}`)
    for (const f of r.files) lines.push(`  - \`${f}\``)
    for (const f of r.fields ?? []) lines.push(`  - field \`${f.path}\`: ${f.kind}`)
  }
  lines.push("", "## Migrations", "")
  if (!m.migrations.length) lines.push("None.")
  for (const g of m.migrations) lines.push(`### ${g.file}`, "", "```sql", (g.sql ?? "").trimEnd(), "```", "")
  lines.push("", `## Commits (${m.commits.length})`, "", ...m.commits.map((c) => `- ${c}`), "", `## Files (${m.files.length})`, "")
  lines.push(...m.files.map((f) => `- ${f.status} \`${f.path}\``))
  return lines.join("\n") + "\n"
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2)
  const option = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : null)
  const args = argv.filter((a, i) => !a.startsWith("--") && !["--verify", "--tag"].includes(argv[i - 1]))
  if (!args[0]) {
    console.error("usage: node scripts/release-manifest.mjs <to> [<from>] [--json | --hash | --verify <file> [--tag <tag>]]")
    process.exit(2)
  }
  if (option("--verify")) {
    const attached = JSON.parse(readFileSync(option("--verify"), "utf8"))
    const problems = attachedProblems({ to: args[0], from: args[1] ?? null, attached, tag: option("--tag") })
    if (problems.length) {
      console.error("Release manifest refused:\n" + problems.map((p) => `  - ${p}`).join("\n"))
      process.exit(1)
    }
    console.log("The attached manifest is this commit's.")
    process.exit(0)
  }
  const m = manifest({ to: args[0], from: args[1] ?? null })
  if (process.argv.includes("--hash")) console.log(manifestHash(m))
  else process.stdout.write(process.argv.includes("--json") ? JSON.stringify({ ...m, hash: manifestHash(m) }, null, 2) + "\n" : render(m))
}
