import { expect, test } from "./fixtures"
test.use({ reducedMotion: "reduce" })
test.skip(!process.env.E2E_PROD, "final static headers and Worker image variants")

test("hashed assets are immutable while HTML/API revalidate or remain private", async ({ request }) => {
  const html = await request.get("/")
  expect(html.headers()["cache-control"]).toBe("no-cache")
  const assets = [...(await html.text()).matchAll(/(?:src|href)="(\/assets\/[^"?]+)"/g)].map((m) => m[1])
  expect(assets.length).toBeGreaterThan(1)
  for (const asset of assets) {
    const response = await request.get(asset)
    expect(response.headers()["cache-control"]).toBe("public, max-age=31536000, immutable")
  }
  for (const path of ["/api/v1/version", "/api/v1/feed?v=0.0", "/api/v1/contact", "/api/v1/submissions/not-a-place"]) {
    const res = await request.get(path)
    expect(res.headers()["cache-control"]).toContain("no-store")
  }
})

test("the actual gallery picks medium images and holds off distant originals under enforced CSP", { tag: "@phone" }, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  // Browser event, rather than Chromium-only console wording, also covers WebKit.
  await page.addInitScript(() => {
    const seen: string[] = []
    Object.assign(window, { __galleryCspViolations: seen })
    document.addEventListener("securitypolicyviolation", (e) => seen.push(`${e.effectiveDirective} ${e.blockedURI}`))
  })
  await page.goto("/place/nahal-oz-observers-memorial")
  await expect(page.getByRole("heading", { name: "אנדרטת התצפיתניות", exact: true })).toBeVisible({ timeout: 20_000 })
  const strip = page.getByRole("group", { name: /תמונות. אפשר לעבור/ })
  await expect(strip).toBeVisible()
  const images = strip.locator("img")
  const count = await images.count()
  expect(count).toBeGreaterThan(2)
  await expect(images.first()).toHaveJSProperty("complete", true)
  await expect.poll(() => images.first().evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0)
  expect(await images.first().evaluate((img: HTMLImageElement) => img.currentSrc)).toMatch(/\?w=(640|960)$/)
  for (let i = 2; i < count; i++) expect(await images.nth(i).getAttribute("src")).toBeNull()
  await page.getByRole("button", { name: `תמונה ${count} מתוך ${count}`, exact: true }).click()
  await expect(images.last()).toHaveAttribute("src", /^\/media\/public\//)
  await expect(images.last()).toHaveJSProperty("complete", true)
  await expect.poll(() => images.last().evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0)
  expect(await page.evaluate(() => (window as unknown as { __galleryCspViolations: string[] }).__galleryCspViolations)).toEqual([])
})
