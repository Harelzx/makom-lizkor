// No curated place record in a production bundle (spec principle 2 and section 13): after a build, the client's files
// and the Worker's are searched for the opening words of each fixture's summary (field names won't do: the client
// still reads curated fields, from the feed). The fixtures are
// public information, but D1 is the one source of truth, and a copy in the bundle would outlive a takedown there.
// Their photos neither (P7-MEDIA-1): served as files, a copied address would still work after the photo is hidden.
// Nowhere in the build, About's landscapes included, and not by name only: a curated photo's or thumbnail's very
// bytes under another name fail too. About's landscapes are the site's own pictures, never a place's.
//   node scripts/bundle-check.mjs [dist-dir]
import { createHash } from "node:crypto"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
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

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex")

/** The hash of every curated photo and thumbnail the importer uploads (fixtures/photos), to know them by content. */
export function curatedContents(dir = new URL("../fixtures/photos/", import.meta.url)) {
  const hashes = new Set()
  for (const sub of ["", "thumb/"]) {
    const at = new URL(sub, dir)
    if (!existsSync(at)) continue
    for (const name of readdirSync(at)) if (name.endsWith(".webp")) hashes.add(sha256(readFileSync(new URL(name, at))))
  }
  return hashes
}

export function bundleProblems(dist, records, { contents = new Set() } = {}) {
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
      // The map's terrain tiles are the one exception: versioned by name instead of hashed (src/shared/tiles.ts), and under
      // /assets only because that is the one static path production's Access already lets through.
      if (
        dir === "client" &&
        rel.startsWith("client/assets/") &&
        !/[-_][A-Za-z0-9_-]{8,}\.[a-z0-9]+$/i.test(name) &&
        !/^terrain-[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+\.png$/.test(name)
      )
        problems.push(`${rel}: unhashed file in immutable asset namespace`)
      if (photos.has(name)) problems.push(`${rel}: a curated record's photo`)
      else if (contents.size && /\.(webp|jpe?g|png|avif|gif)$/i.test(name) && contents.has(sha256(readFileSync(file))))
        problems.push(`${rel}: a curated record's photo (same bytes)`)
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
  const problems = bundleProblems(dist, records, { contents: curatedContents() })
  if (problems.length) {
    console.error("Curated records in the production bundle:\n" + problems.map((p) => `  - ${p}`).join("\n"))
    process.exit(1)
  }
  console.log("No curated record in the production bundle.")
}
