// No curated place record in a production bundle (spec principle 2 and section 13): after a build, the client's files
// and the Worker's are searched for the opening words of each fixture's summary (field names won't do: the client
// still reads curated fields, from the feed). The fixtures are
// public information, but D1 is the one source of truth, and a copy in the bundle would outlive a takedown there.
//   node scripts/bundle-check.mjs [dist-dir]
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

/** What only a curated record carries: each summary's opening words. */
export function markers(records) {
  const summaries = records.map((r) => r.summary_he.slice(0, 40))
  // A bundler may keep Hebrew as it is or write it as \u escapes.
  const escaped = summaries.map((s) =>
    JSON.stringify(s)
      .slice(1, -1)
      .replace(/[\u0080-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`),
  )
  return [...new Set([...summaries, ...escaped])]
}

const files = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : /\.(js|mjs|json|html|map)$/.test(name) ? [path] : []
  })

export function bundleProblems(dist, records) {
  const wanted = markers(records)
  const problems = []
  for (const dir of ["client", "makom_lizkor"]) {
    let list
    try {
      list = files(join(dist, dir))
    } catch {
      problems.push(`${dir}: not built`)
      continue
    }
    for (const file of list) {
      const text = readFileSync(file, "utf8")
      const found = wanted.filter((m) => text.includes(m)).length
      if (found) problems.push(`${file.slice(dist.length + 1)}: ${found} marker(s) of curated records`)
    }
  }
  return problems
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dist = process.argv[2] ?? "dist"
  const records = JSON.parse(readFileSync(new URL("../src/data/places.json", import.meta.url), "utf8"))
  const problems = bundleProblems(dist, records)
  if (problems.length) {
    console.error("Curated records in the production bundle:\n" + problems.map((p) => `  - ${p}`).join("\n"))
    process.exit(1)
  }
  console.log("No curated record in the production bundle.")
}
