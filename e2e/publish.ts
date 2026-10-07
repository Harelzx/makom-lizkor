import { expect, test, type Browser, type BrowserContext } from "@playwright/test"

/** A contribution published through the API: Cloudflare's dummy token passes the development test secret. */
// Each demo place comes from its own sender (a documentation address, synthetic), so the server's per-address limit on
// submissions never stops a spec that publishes several.
let senders = Date.now() % 200

export async function published(browser: Browser, name: string) {
  // How long each step took, kept with the test's results: the tributes spec's "ten taps" has timed out after a full
  // run's earlier specs with this helper and the page both slow (a53: diagnose on the Phase 7 tree; cause not yet known).
  const t0 = Date.now()
  const marks: string[] = []
  const mark = (step: string) => marks.push(`${((Date.now() - t0) / 1000).toFixed(2)}s ${step}`)
  const ctx = await browser.newContext()
  const res = await ctx.request.post("/api/v1/submissions", {
    headers: {
      "Idempotency-Key": crypto.randomUUID().replaceAll("-", ""),
      "Turnstile-Token": "XXXX.DUMMY.TOKEN.XXXX",
      "CF-Connecting-IP": `203.0.113.${senders++ % 250}`,
    },
    data: { kind: "garden", name_he: name, lat: 31.4234, lng: 34.4987, consent_version: "notice.submission@2026-10-9" },
  })
  if (res.status() !== 201) throw new Error(`demo submission refused: ${res.status()} ${await res.text()}`)
  const { id, trackingToken } = (await res.json()) as { id: string; trackingToken: string }
  mark("submitted")
  await ctx.request.post("/__dev/login", { data: { email: "dev@example.test" } })
  const { items } = (await (await ctx.request.get("/api/admin/queue")).json()) as {
    items: { id: string; rev: number; revisionId: string }[]
  }
  const item = items.find((i) => i.id === id)!
  const approved = await ctx.request.post(`/api/admin/places/${id}/transitions`, {
    headers: { "Sec-Fetch-Site": "same-origin" },
    data: { action: "approve", revisionId: item.revisionId, expectedRev: item.rev },
  })
  // A refused approval (changed meanwhile, the ledger or the bucket unavailable) would leave a spec waiting for a card
  // that can't come: say what the server said instead.
  if (approved.status() !== 200) throw new Error(`demo approval refused: ${approved.status()} ${await approved.text()}`)
  mark("approved")
  let polls = 0
  // Public once the feed lists it: what every visitor's page reads.
  await expect
    .poll(async () => {
      polls++
      const { v } = (await (await ctx.request.get("/api/v1/version")).json()) as { v: string }
      const feed = await ctx.request.get(`/api/v1/feed?v=${encodeURIComponent(v)}`)
      return feed.ok() && ((await feed.json()) as { places: { id: string }[] }).places.some((p) => p.id === id)
    })
    .toBe(true)
  mark(`in the feed after ${polls} poll(s)`)
  await ctx.close()
  await test.info().attach(`published ${id}`, { body: marks.join("\n"), contentType: "text/plain" })
  return { id, trackingToken }
}

/**
 * A browser that sends places from its own address (a documentation range, synthetic), as the request specs' visitors
 * do. The server's cap of a few submissions a minute per address has its own tests (worker/test/rate-key.test.ts,
 * src/lib/submit-place.test.ts); without this, specs that run quickly add up past it across tests from one machine.
 * Only the submission requests carry it: the map's tile servers would refuse an unknown header. A test's own route on
 * the page still comes first.
 */
let addresses = Date.now() % 200
const own = new WeakMap<BrowserContext, string>()
export async function ownAddress(ctx: BrowserContext) {
  const address = `192.0.2.${addresses++ % 250}`
  own.set(ctx, address)
  await ctx.route("**/api/v1/submissions**", (route) => route.fallback({ headers: from(ctx, route.request().headers()) }))
  return ctx
}
/**
 * Headers with the context's own address, for the requests routing doesn't reach: `ctx.request`, `page.request`, and
 * a test's own page route that fetches or continues the request itself (a page route runs before the context's).
 */
export const from = (ctx: BrowserContext, headers: Record<string, string> = {}) => {
  const address = own.get(ctx)
  if (!address) throw new Error("this context has no address of its own: ownAddress first")
  return { ...headers, "cf-connecting-ip": address }
}
