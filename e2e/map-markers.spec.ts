import { test, expect } from "./fixtures"
test.use({ reducedMotion: "reduce" })

// A community's dot is its place on the map; its name sits beside it. MapLibre puts a marker element's center on its
// point (anchor "center"), so the dot is on its point when it is that center. The whole label used to be that box,
// which moved every dot east by half its name (19-29 px, about 3 km at the envelope's zoom). Read from the page alone,
// so it holds on the production build too, where the map instance is not exposed.
for (const width of [390, 1280])
  test(`a community's dot sits on its own point at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    await page.goto("/")
    await page.getByRole("button", { name: "דילוג", exact: true }).click()
    await expect(page.locator(".mk-community.is-open").first()).toBeVisible()
    const offsets = await page.locator(".maplibregl-marker:has(.mk-community)").evaluateAll((markers) =>
      markers.map((m) => {
        const box = m.getBoundingClientRect()
        const dot = m.querySelector(".mk-community-dot")!.getBoundingClientRect()
        return Math.hypot(dot.x + dot.width / 2 - (box.x + box.width / 2), dot.y + dot.height / 2 - (box.y + box.height / 2))
      }),
    )
    expect(offsets.length).toBeGreaterThan(10)
    expect(Math.max(...offsets)).toBeLessThanOrEqual(1)
  })
