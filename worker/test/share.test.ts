import { env } from "cloudflare:workers"
import { describe, expect, it } from "vitest"
import { call } from "./app"
import { decide, queued, rev, revise, send, upload } from "./submission-helpers"

// The site's page as the static assets serve it: the share route rewrites a copy of it.
const SITE = `<!doctype html><html lang="he"><head><meta charset="UTF-8" /><title>מקום לזכור</title>
<meta name="description" content="תיאור האתר" /><meta property="og:title" content="מקום לזכור · שלוש שנים" />
<meta property="og:description" content="תיאור האתר" /><meta property="og:image" content="/og.png" />
</head><body><div id="root"></div></body></html>`
const withSite = {
  ...env,
  ASSETS: { fetch: async () => new Response(SITE, { headers: { "Content-Type": "text/html" } }) } as unknown as Fetcher,
}
const page = (id: string, e: Env = withSite) => call(`http://local/place/${encodeURIComponent(id)}`, {}, e)
const meta = (html: string, key: string) => new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)"`).exec(html)?.[1]

describe("a place's share page", () => {
  it("names a published contribution in its preview, and carries its public fields for an instant open", async () => {
    const { id } = await send("ספסל דמו לשיתוף", { story_he: "סיפור קצר על הספסל", email: `s${Date.now()}@example.test` })
    await decide(id, await queued(id), "approve")
    const res = await page(id)
    expect(res.status).toBe(200)
    expect(res.headers.get("Cache-Control")).toBe("no-cache")
    const html = await res.text()
    expect(html).toContain("<title>ספסל דמו לשיתוף · מקום לזכור</title>")
    expect(meta(html, "og:title")).toBe("ספסל דמו לשיתוף")
    expect(meta(html, "og:description")).toBe("סיפור קצר על הספסל")
    expect(meta(html, "og:image")).toBe("http://local/og.png")
    expect(meta(html, "og:url")).toBe(`http://local/place/${id}`)
    expect(html).toContain(`<link rel="canonical" href="http://local/place/${id}"`)
    const data = JSON.parse(/<script type="application\/json" id="place-data">([^<]*)<\/script>/.exec(html)![1])
    expect(data).toMatchObject({ id, name_he: "ספסל דמו לשיתוף" })
    // Public fields only: nothing of the sender.
    expect(html).not.toContain("example.test")
  })

  it("carries the published text only, never a correction or photo still waiting for review", async () => {
    const { id, trackingToken } = await send("ספסל דמו שפורסם")
    await decide(id, await queued(id), "approve")
    expect((await revise(id, trackingToken, await rev(id, trackingToken), "ספסל דמו בתיקון שממתין")).ok).toBe(true)
    expect((await upload(id, trackingToken)).status).toBeLessThan(300)
    const html = await (await page(id)).text()
    const data = JSON.parse(/id="place-data">([^<]*)<\/script>/.exec(html)![1])
    expect(data.name_he).toBe("ספסל דמו שפורסם")
    expect(data.photo ?? null).toBeNull()
    expect(html).not.toContain("בתיקון")
    expect(html).not.toContain("quarantine")
  })

  it("names one of the site's own places too, without carrying its data (it ships with the site)", async () => {
    const html = await (await page("nova-memorial-reim")).text()
    expect(meta(html, "og:title")).toBeTruthy()
    expect(meta(html, "og:title")).not.toBe("מקום לזכור · שלוש שנים")
    expect(html).not.toContain('id="place-data"')
  })

  it("keeps a hostile name from breaking the page or running anything", async () => {
    const name = 'ספסל "דמו" </script><img src=x onerror=alert(1)>'
    const { id } = await send(name)
    await decide(id, await queued(id), "approve")
    const html = await (await page(id)).text()
    expect(html).not.toContain("<img src=x")
    expect(html.match(/<\/script>/g)).toHaveLength(1)
    expect(JSON.parse(/id="place-data">([^<]*)<\/script>/.exec(html)![1]).name_he).toBe(name.replace("</script>", "</script>"))
  })

  it("is the site's page at any /place/ address: a trailing slash names the place, a deeper path is a 404 page", async () => {
    const slash = await call("http://local/place/nova-memorial-reim/", {}, withSite)
    expect(slash.status).toBe(200)
    expect(meta(await slash.text(), "og:title")).not.toBe("מקום לזכור · שלוש שנים")
    const deep = await call("http://local/place/nova-memorial-reim/x", {}, withSite)
    expect(deep.status).toBe(404)
    expect(deep.headers.get("Content-Type")).toContain("text/html")
    expect(await deep.text()).toContain('<meta name="place-status" content="none"')
  })

  it("is 404, unindexed and uncached for a place that was never public, and says nothing of it", async () => {
    const { id } = await send("ספסל דמו שעוד ממתין")
    for (const unknown of [id, "p_01ZZZZZZZZZZZZZZZZZZZZZZZZ", "no-such-place"]) {
      const res = await page(unknown)
      expect(res.status).toBe(404)
      expect(res.headers.get("Cache-Control")).toBe("no-store")
      const html = await res.text()
      expect(html).toContain('<meta name="robots" content="noindex"')
      expect(html).toContain('<meta name="place-status" content="none"')
      expect(html).not.toContain("ממתין")
      expect(html).not.toContain('id="place-data"')
    }
  })

  it("is 410 for a place that was taken back, unindexed, uncached and empty of it", async () => {
    const { id, trackingToken } = await send("ספסל דמו שנמשך אחרי פרסום")
    await decide(id, await queued(id), "approve")
    await call(`http://local/api/v1/submissions/${id}/withdraw`, { method: "POST", headers: { Authorization: `Bearer ${trackingToken}` } })
    const res = await page(id)
    expect(res.status).toBe(410)
    expect(res.headers.get("Cache-Control")).toBe("no-store")
    const html = await res.text()
    expect(html).toContain('<meta name="robots" content="noindex"')
    expect(html).toContain('<meta name="place-status" content="gone"')
    expect(html).not.toContain("שנמשך")
  })

  it("in production, builds its addresses only from the configured origin, never from the request", async () => {
    const { id } = await send("ספסל דמו כתובת מוגדרת")
    await decide(id, await queued(id), "approve")
    const prod = { ...withSite, ENVIRONMENT: "production", PUBLIC_ORIGIN: "https://makom.example" }
    const html = await (await call(`http://evil.test/place/${id}`, {}, prod)).text()
    expect(meta(html, "og:url")).toBe(`https://makom.example/place/${id}`)
    expect(html).not.toContain("evil.test")
    // With no origin configured, a production page carries no absolute address at all rather than a guessed one.
    const bare = await (await call(`http://evil.test/place/${id}`, {}, { ...prod, PUBLIC_ORIGIN: "" })).text()
    expect(bare).not.toContain("evil.test")
    expect(meta(bare, "og:url")).toBeUndefined()
  })
})
