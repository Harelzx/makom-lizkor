// A conservative allowlist: anything unknown keeps the full gate. Compare to the last verified ancestor, not just
// the last commit, so a cosmetic follow-up cannot hide an unverified server change.
import { execFileSync } from "node:child_process"
import { pathToFileURL } from "node:url"

export const POLICY = 1
export const GROUPS = {
  form: [
    "location-feedback",
    "phone-followup",
    "ux-refinements",
    "ux-experience",
    "submission-recovery",
    "backend-flow",
    "a11y",
    "a11y-phone",
  ],
  layout: ["panel", "mobile-sheet", "mobile-link", "ux-experience", "phone-followup", "a11y", "a11y-phone", "routing"],
  opening: ["montage", "three-years", "sound", "routing"],
}
const docs = (p) => /^(docs\/.*\.md|README\.md|CLAUDE\.md)$/.test(p)
const visual = (p) => {
  if (p === "src/components/form-flower.tsx" || /^public\/art\/.*\.(webp|png|svg)$/.test(p)) return ["form"]
  if (p === "src/index.css") return ["layout", "form", "opening"]
  return null
}
export function classify(changes, { baseline = null, sha = null } = {}) {
  const common = { policy: POLICY, sha, baseline, files: changes.map((c) => c.path), groups: [] }
  if (!baseline) return { ...common, mode: "full", reason: "No verified ancestor; full validation required." }
  if (changes.every((c) => c.status === "M" && docs(c.path))) return { ...common, mode: "docs", reason: "Only non-runtime documentation." }
  const groups = new Set()
  for (const { status, path } of changes) {
    if (status !== "M") return { ...common, mode: "full", reason: `Added, removed or renamed path: ${path}` }
    if (docs(path)) continue
    const affected = visual(path)
    if (!affected) return { ...common, mode: "full", reason: `Not a presentation-only allowlisted path: ${path}` }
    affected.forEach((group) => groups.add(group))
  }
  return {
    ...common,
    mode: "preview",
    groups: [...groups].sort(),
    reason: "Known presentation paths; full regression follows in the background.",
  }
}
export function gitChanges(base, sha, cwd = process.cwd()) {
  const raw = execFileSync("git", ["diff", "--no-renames", "--name-status", "-z", base, sha], { cwd, encoding: "utf8" }).split("\0")
  const changes = []
  for (let i = 0; i + 1 < raw.length; i += 2) changes.push({ status: raw[i], path: raw[i + 1] })
  return changes
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [base, sha] = process.argv.slice(2)
  console.log(JSON.stringify(classify(base ? gitChanges(base, sha) : [], { baseline: base || null, sha }), null, 2))
}
