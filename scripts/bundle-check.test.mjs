// node --test scripts/bundle-check.test.mjs
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, test } from "node:test"
import { bundleProblems } from "./bundle-check.mjs"

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
  writeFileSync(join(d, "client/assets/main.js"), client)
  writeFileSync(join(d, "makom_lizkor/index.js"), worker)
  return d
}

test("a build without the records passes, even with the curated field names the client still reads", () => {
  assert.deepEqual(bundleProblems(dist("const p = place.coord_source_url", "export default {}"), records), [])
})
test("a summary in the client or the Worker fails, as text or as \\u escapes", () => {
  const plain = `var s=${JSON.stringify(records)}`
  const escaped = `var s="${records[0].summary_he.replace(/[\u0080-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`)}"`
  assert.deepEqual(bundleProblems(dist(plain, "x"), records), ["client/assets/main.js: 2 marker(s) of curated records"])
  assert.deepEqual(bundleProblems(dist("x", escaped), records), ["makom_lizkor/index.js: 1 marker(s) of curated records"])
})
test("a missing build fails rather than passing", () => {
  const d = mkdtempSync(join(tmpdir(), "bundle-check-"))
  dirs.push(d)
  assert.deepEqual(bundleProblems(d, records), ["client: not built", "makom_lizkor: not built"])
})

test("a curated record's photo in the client build fails, unless it is one of About's own landscapes (P7-MEDIA-1)", () => {
  const d = dist("x", "x")
  mkdirSync(join(d, "client/photos/thumb"), { recursive: true })
  writeFileSync(join(d, "client/photos/thumb/nova-trees.webp"), "")
  mkdirSync(join(d, "client/landscapes"), { recursive: true })
  writeFileSync(join(d, "client/landscapes/zikim-beach.webp"), "")
  assert.deepEqual(bundleProblems(d, records, { landscapes: ["zikim-beach.webp"] }), [
    "client/photos/thumb/nova-trees.webp: a curated record's photo",
  ])
  // The same file as a landscape is About's picture, served apart from the place; anywhere else it is the record's.
  assert.deepEqual(bundleProblems(d, records), [
    "client/landscapes/zikim-beach.webp: a curated record's photo",
    "client/photos/thumb/nova-trees.webp: a curated record's photo",
  ])
})
