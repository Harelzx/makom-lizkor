import { expect, test } from "./fixtures"
import { CSP, SECURITY_HEADERS } from "../worker/lib/security-headers"

// Spec 11 (adviser a49): the production build's own runtime carries the security headers on the page, a static file,
// a share page, the moderators' page and the API, and its report collector is shown to catch a violation made on
// purpose before a run with none counts as evidence. The dev server isn't what ships, so this runs on the build only.
test.skip(!process.env.E2E_PROD, "the production build's headers (npm run e2e:prod)")
test.use({ reducedMotion: "reduce" })

const PAGES = ["/", "/favicon.svg", "/place/car-wall-tkuma", "/place/not-a-place", "/admin/", "/api/v1/health"]

test("every kind of address carries the enforced policy", { tag: "@core-headers" }, async ({ request }) => {
  for (const path of PAGES) {
    const res = await request.get(path, { maxRedirects: 0 })
    expect(res.status(), path).toBeLessThan(500)
    const h = res.headers()
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) expect(h[name.toLowerCase()], `${path} ${name}`).toBe(value)
    expect(h["content-security-policy-report-only"], path).toBeUndefined()
    expect(h["content-security-policy"], path).toBe(CSP)
  }
})

test(
  "a violation made on purpose is the only one the page reports, and the collector answers it",
  { tag: ["@core-csp", "@phone"] },
  async ({ page }) => {
    const consoled: string[] = []
    const reports: string[] = []
    page.on("console", (m) => consoled.push(m.text()))
    page.on("request", (r) => {
      if (!r.url().endsWith("/api/csp-report")) return
      const v = JSON.parse(r.postData() ?? "{}")["csp-report"] ?? {}
      reports.push(`${v["effective-directive"]} ${v["blocked-uri"]}`)
    })
    // The day's own work first: the feed read and parsed under the policy, so anything it breaks is reported before the
    // control is.
    const fed = page.waitForResponse((r) => r.url().includes("/api/v1/feed"))
    await page.goto("/place/car-wall-tkuma")
    await expect(page.getByRole("heading", { name: "קיר המכוניות ליד תקומה" })).toBeVisible({ timeout: 20_000 })
    await fed
    const answered = page.waitForResponse((r) => r.url().endsWith("/api/csp-report") && !!r.request().postData()?.includes("csp-control"))
    // Positive control: the policy must actively block execution of an inline script, not merely report it.
    await page.evaluate(() => {
      const script = document.createElement("script")
      script.textContent = "window.__cspUnsafeExecuted = true"
      document.body.append(script)
    })
    expect(await page.evaluate(() => (window as unknown as { __cspUnsafeExecuted?: boolean }).__cspUnsafeExecuted)).toBeUndefined()
    // A forbidden image is blocked and reported. Its network request must never leave the browser.
    let networkAttempted = false
    await page.route("https://csp-control.invalid/**", async (route) => {
      networkAttempted = true
      await route.abort()
    })
    await page.evaluate(() => {
      const img = document.createElement("img")
      img.src = "https://csp-control.invalid/positive-control.png"
      document.body.append(img)
    })
    expect((await answered).status()).toBe(204)
    expect(consoled.some((t) => t.includes("Content Security Policy") && t.includes("csp-control.invalid"))).toBe(true)
    expect(reports).toContain("img-src https://csp-control.invalid/positive-control.png")
    expect(reports.filter((r) => !r.includes("inline"))).toEqual(["img-src https://csp-control.invalid/positive-control.png"])
    expect(networkAttempted).toBe(false)
  },
)
