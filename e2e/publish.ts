import type { Browser } from "@playwright/test"

/** A contribution published through the API: Cloudflare's dummy token passes the development test secret. */
export async function published(browser: Browser, name: string) {
  const ctx = await browser.newContext()
  const res = await ctx.request.post("/api/v1/submissions", {
    headers: { "Idempotency-Key": crypto.randomUUID().replaceAll("-", ""), "Turnstile-Token": "XXXX.DUMMY.TOKEN.XXXX" },
    data: { kind: "garden", name_he: name, lat: 31.4234, lng: 34.4987, consent_version: "notice.submission@2026-10-9" },
  })
  const { id, trackingToken } = (await res.json()) as { id: string; trackingToken: string }
  await ctx.request.post("/__dev/login", { data: { email: "dev@example.test" } })
  const { items } = (await (await ctx.request.get("/api/admin/queue")).json()) as {
    items: { id: string; rev: number; revisionId: string }[]
  }
  const item = items.find((i) => i.id === id)!
  await ctx.request.post(`/api/admin/places/${id}/transitions`, {
    headers: { "Sec-Fetch-Site": "same-origin" },
    data: { action: "approve", revisionId: item.revisionId, expectedRev: item.rev },
  })
  await ctx.close()
  return { id, trackingToken }
}
