import { readFile } from "node:fs/promises"
import { expect, test as setup } from "./fixtures"
import fixtures from "../fixtures/curated.json" with { type: "json" }
import { importCurated } from "../scripts/curated-import.mjs"

// The site's own places, put into this run's fresh database the way production gets them (phase 7): the importer,
// through the moderators' route, signed in with the development stand-in. Runs before every spec (playwright.config:
// the "seed" project), after the server is up. Insert-only, so a place already there stays as it is.
setup("the site's own places are imported through the moderators' route", async ({ baseURL, request }) => {
  setup.setTimeout(120_000)
  const login = await request.post("/__dev/login", { data: { email: "dev@example.test" } })
  expect(login.ok()).toBe(true)
  const cookie = (login.headers()["set-cookie"] ?? "").split(";")[0]
  expect(cookie).toMatch(/^CF_Authorization=/)
  const { created, skipped } = await importCurated({
    fetch: (url, init) => fetch(url, init),
    base: baseURL!,
    records: fixtures.places,
    readPhoto: async (file) => ({
      file: await readFile(`fixtures/photos/${file}`),
      thumb: await readFile(`fixtures/photos/thumb/${file}`),
      name: file,
    }),
    headers: { Cookie: cookie },
  })
  expect(created.length + skipped.length).toBe(fixtures.places.length)
})
