// No curated place record in a production bundle (spec principle 2 and section 13): after a build, the client's files
// and the Worker's are searched for the opening words of each fixture's summary (field names won't do: the client
// still reads curated fields, from the feed). The fixtures are
// public information, but D1 is the one source of truth, and a copy in the bundle would outlive a takedown there.
// Their photos neither (P7-MEDIA-1): served as files, a copied address would still work after the photo is hidden.
// About's landscapes are the site's own pictures, not records, so a file it lists may stay (in public/landscapes).
//   node scripts/bundle-check.mjs [dist-dir]
import { readdirSync, readFileSync, statSync } from "node:fs"
import { basename, join } from "node:path"
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
  readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const path = join(dir, name)
      return statSync(path).isDirectory() ? files(path) : [path]
    })

export function bundleProblems(dist, records, { landscapes = [] } = {}) {
  const wanted = markers(records)
  const photos = new Set(records.flatMap((r) => (r.photos ?? []).map((p) => p.file)))
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
      const rel = file.slice(dist.length + 1)
      const name = basename(file)
      if (photos.has(name) && !(rel.startsWith("client/landscapes/") && landscapes.includes(name)))
        problems.push(`${rel}: a curated record's photo`)
      if (!/\.(js|mjs|json|html|map)$/.test(name)) continue
      const text = readFileSync(file, "utf8")
      const found = wanted.filter((m) => text.includes(m)).length
      if (found) problems.push(`${rel}: ${found} marker(s) of curated records`)
    }
  }
  return problems
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dist = process.argv[2] ?? "dist"
  const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"))
  const records = read("../src/data/places.json")
  const problems = bundleProblems(dist, records, { landscapes: read("../src/data/landscapes.json").map((l) => l.file) })
  if (problems.length) {
    console.error("Curated records in the production bundle:\n" + problems.map((p) => `  - ${p}`).join("\n"))
    process.exit(1)
  }
  console.log("No curated record in the production bundle.")
}
