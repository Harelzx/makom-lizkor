import { test, expect } from "./fixtures"
import { readFileSync } from "node:fs"
const curated = JSON.parse(readFileSync(new URL("../fixtures/curated.json", import.meta.url), "utf8")) as {
  places: { kind: string; name_he: string; lat: number; lng: number }[]
}
const communities = curated.places.filter((p) => p.kind === "community").slice(0, 4)
test.use({ reducedMotion: "reduce" })

// A community's dot is its place on the map; its name sits beside it. The whole label used to be centered on the
// point, which moved every dot east by half its name (about 3 km at the envelope's zoom).
for (const width of [390, 1280])
  test(`a community's dot sits on its own point at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    await page.goto("/")
    await page.getByRole("button", { name: "דילוג", exact: true }).click()
    await expect(page.locator(".mk-community.is-open").first()).toBeVisible()
    for (const c of communities) {
      const dot = page.getByRole("button", { name: `${c.name_he}, קהילה`, exact: true }).locator(".mk-community-dot")
      await expect(dot).toHaveCount(1)
      await expect
        .poll(async () =>
          dot.evaluate(
            (el, at) => {
              const map = (
                window as unknown as { __map: { project(p: [number, number]): { x: number; y: number }; getContainer(): HTMLElement } }
              ).__map
              const box = map.getContainer().getBoundingClientRect()
              const p = map.project(at)
              const r = el.getBoundingClientRect()
              return Math.round(Math.hypot(r.x + r.width / 2 - box.x - p.x, r.y + r.height / 2 - box.y - p.y))
            },
            [c.lng, c.lat] as [number, number],
          ),
        )
        .toBeLessThanOrEqual(2)
    }
  })
