// The site's own places into the development server's database (phase 7): the curated importer, as the e2e seed and
// production use it, signed in with the development stand-in, which exists nowhere else. Insert-only, so a second run
// leaves every place as it is.
//   node scripts/seed-dev.mjs [origin]    (npm run db:seed:local; default the dev server, http://localhost:5174)
import { readFile } from "node:fs/promises"
import { importCurated } from "./curated-import.mjs"

const base = process.argv[2] ?? "http://localhost:5174"
const login = await fetch(`${base}/__dev/login`, {
  method: "POST",
  body: JSON.stringify({ email: "dev@example.test" }),
  headers: { "Content-Type": "application/json" },
}).catch(() => null)
const cookie = (login?.headers.get("set-cookie") ?? "").split(";")[0]
if (!login?.ok || !cookie.startsWith("CF_Authorization=")) {
  console.error(`No development sign-in at ${base}${login ? ` (${login.status})` : ""}: is the dev server running?`)
  process.exit(1)
}
const { places } = JSON.parse(await readFile(new URL("../fixtures/curated.json", import.meta.url), "utf8"))
const photo = (path) => readFile(new URL(`../fixtures/photos/${path}`, import.meta.url))
const { created, skipped } = await importCurated({
  fetch,
  base,
  records: places,
  readPhoto: async (file) => ({ file: await photo(file), thumb: await photo(`thumb/${file}`), name: file }),
  headers: { Cookie: cookie },
})
console.log(`${created.length} places imported, ${skipped.length} already there.`)
