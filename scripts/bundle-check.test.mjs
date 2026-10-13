// node --test scripts/bundle-check.test.mjs
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, test } from "node:test"
import { bundleProblems, curatedContents } from "./bundle-check.mjs"

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex")
const placesJson = JSON.parse(readFileSync("src/data/places.json", "utf8"))
const landscapesJson = JSON.parse(readFileSync("src/data/landscapes.json", "utf8"))

const records = [
  { summary_he: "אתר זיכרון רחב ידיים במתחם שבו התקיים פסטיבל, עם עצים ושלטים", photos: [{ file: "nova-trees.webp" }] },
  { summary_he: "Lookout over the fields, with a bench", photos: [{ file: "zikim-beach.webp" }] },
]
const dirs = []
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })))
const dist = (client, worker) => {
  const d = mkdtempSync(join(tmpdir(), "bundle-check-"))
  dirs.push(d)
  mkdirSync(join(d, "client/assets"), { recursive: true })
  mkdirSync(join(d, "makom_lizkor"), { recursive: true })
  writeFileSync(join(d, "client/assets/main-TEST1234.js"), client)
  writeFileSync(join(d, "makom_lizkor/index.js"), worker)
  return d
}

test("a build without the records passes, even with the curated field names the client still reads", () => {
  assert.deepEqual(bundleProblems(dist("const p = place.coord_source_url", "export default {}"), records), [])
})
test("a summary in the client or the Worker fails, as text or as \\u escapes", () => {
  const plain = `var s=${JSON.stringify(records)}`
  const escaped = `var s="${records[0].summary_he.replace(/[\u0080-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`)}"`
  assert.deepEqual(bundleProblems(dist(plain, "x"), records), ["client/assets/main-TEST1234.js: 2 marker(s) of curated records"])
  assert.deepEqual(bundleProblems(dist("x", escaped), records), ["makom_lizkor/index.js: 1 marker(s) of curated records"])
})
test("a missing build fails rather than passing", () => {
  const d = mkdtempSync(join(tmpdir(), "bundle-check-"))
  dirs.push(d)
  assert.deepEqual(bundleProblems(d, records), ["client: not built", "makom_lizkor: not built"])
})

test("a curated record's photo or its thumbnail fails anywhere in the build, About's landscapes included (P7-MEDIA-1)", () => {
  const d = dist("x", "x")
  mkdirSync(join(d, "client/photos/thumb"), { recursive: true })
  writeFileSync(join(d, "client/photos/thumb/nova-trees.webp"), "a")
  mkdirSync(join(d, "client/landscapes/thumb"), { recursive: true })
  writeFileSync(join(d, "client/landscapes/zikim-beach.webp"), "b")
  writeFileSync(join(d, "client/landscapes/thumb/zikim-beach.webp"), "c")
  // A static copy outlives a hide whatever directory it is in: there is no exception for landscapes any more.
  assert.deepEqual(bundleProblems(d, records), [
    "client/landscapes/thumb/zikim-beach.webp: a curated record's photo",
    "client/landscapes/zikim-beach.webp: a curated record's photo",
    "client/photos/thumb/nova-trees.webp: a curated record's photo",
  ])
})

test("a curated photo's very bytes under another name fail too, and a different landscape passes (P7-MEDIA-1)", () => {
  const d = dist("x", "x")
  mkdirSync(join(d, "client/landscapes/thumb"), { recursive: true })
  writeFileSync(join(d, "client/landscapes/renamed.webp"), "the photo's bytes")
  writeFileSync(join(d, "client/landscapes/thumb/renamed.webp"), "the thumbnail's bytes")
  writeFileSync(join(d, "client/landscapes/shokeda.webp"), "another picture")
  const contents = new Set([sha("the photo's bytes"), sha("the thumbnail's bytes")])
  assert.deepEqual(bundleProblems(d, records, { contents }), [
    "client/landscapes/renamed.webp: a curated record's photo (same bytes)",
    "client/landscapes/thumb/renamed.webp: a curated record's photo (same bytes)",
  ])
})

test("the committed landscapes share no file or bytes with a curated photo (P7-MEDIA-1)", () => {
  const curated = new Set(placesJson.flatMap((r) => (r.photos ?? []).map((p) => p.file)))
  for (const l of landscapesJson) assert.ok(!curated.has(l.file), `${l.file} is a curated photo`)
  const contents = curatedContents()
  for (const dir of ["public/landscapes", "public/landscapes/thumb"])
    for (const name of readdirSync(dir).filter((n) => n.endsWith(".webp")))
      assert.ok(!contents.has(sha(readFileSync(join(dir, name)))), `${dir}/${name} has a curated photo's bytes`)
})

test("immutable assets must be hashed while HTML and non-asset paths may revalidate", () => {
  const d = dist("x", "y")
  writeFileSync(join(d, "client/assets/unhashed.js"), "x")
  writeFileSync(join(d, "client/index.html"), "<html></html>")
  assert.deepEqual(bundleProblems(d, records), ["client/assets/unhashed.js: unhashed file in immutable asset namespace"])
})
