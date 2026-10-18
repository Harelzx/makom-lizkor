import { describe, expect, it } from "vitest"
import { call } from "./app"
import { OLD_HOST } from "../index"
import { withSite } from "./helpers"
import { decide, queued, rev, revise, send, upload } from "./submission-helpers"
import { seedCurated } from "./curated-helpers"

const page = (id: string, e: Env = withSite) => call(`http://local/place/${encodeURIComponent(id)}`, {}, e)
const meta = (html: string, key: string) => new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)"`).exec(html)?.[1]

describe("a place's share page", () => {
  it("never passes on the static page's cache status as its own: the page is the Worker's answer, built each time (C-CACHE)", async () => {
    // Staging, 7 October: the site's page came from the static assets with CF-Cache-Status HIT, and the share page
    // copied it, so a fresh answer named a cache it never came from.
    const fromCache: Env = {
      ...withSite,
      ASSETS: {
        fetch: async () =>
          new Response("<!doctype html><html><head><title>x</title></head><body></body></html>", {
            headers: { "Content-Type": "text/html", "CF-Cache-Status": "HIT", Age: "42" },
          }),
      } as unknown as Fetcher,
    }
    const { id } = await send("ספסל דמו בלי מטמון")
    await decide(id, await queued(id), "approve")
    for (const [place, status] of [
      [id, 200],
      ["p_00000000000000000000000000", 404],
    ] as const) {
      const res = await page(place, fromCache)
      expect(res.status).toBe(status)
      expect(res.headers.get("CF-Cache-Status")).toBeNull()
      expect(res.headers.get("Age")).toBeNull()
    }
  })

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
    // Its own image (L4), named by the hash of what it shows now.
    expect(meta(html, "og:image")).toMatch(new RegExp(`^http://local/media/og/${id}/[0-9a-f]{64}\\.png$`))
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

  it("names one of the site's own places too, from the database, with its data and its own image (phase 7)", async () => {
    await seedCurated(["nova-memorial-reim"])
    const html = await (await page("nova-memorial-reim")).text()
    expect(meta(html, "og:title")).toBe("אתר ההנצחה לנרצחי פסטיבל נובה")
    expect(JSON.parse(/id="place-data">([^<]*)<\/script>/.exec(html)![1])).toMatchObject({ id: "nova-memorial-reim", kind: "monument" })
    expect(meta(html, "og:image")).toMatch(/^http:\/\/local\/media\/og\/nova-memorial-reim\/[0-9a-f]{64}\.png$/)
  })

  it("keeps the preview's words to two or three lines: the first sentence, or whole words and an ellipsis", async () => {
    // WhatsApp, 14 October: the Nova memorial's 200 characters filled the preview and ended mid-word («לנרצח»).
    await seedCurated(["nova-memorial-reim"])
    const nova = meta(await (await page("nova-memorial-reim")).text(), "og:description")!
    expect(nova).toBe("אתר זיכרון רחב ידיים במתחם שבו התקיים פסטיבל נובה, ובו עמודי הנצחה אישיים לכל אחד מהנרצחים לצד מיצגים נוספים.")

    const long = "ספסל עץ פשוט מול השדות שבו ישבו החברים בכל ערב שישי אחרי העבודה ודיברו על הכול ועל כלום עד שהשמש שקעה מאחורי הגבעה הרחוקה"
    const { id } = await send("ספסל דמו ארוך", { story_he: long })
    await decide(id, await queued(id), "approve")
    const cut = meta(await (await page(id)).text(), "og:description")!
    expect(Array.from(cut).length).toBeLessThanOrEqual(121)
    expect(cut.endsWith("…")).toBe(true)
    // Whole words only: what stands before the ellipsis is the start of the story, ending at a word's end.
    expect(long.startsWith(cut.slice(0, -1))).toBe(true)
    expect(long[cut.length - 1]).toBe(" ")

    // A short first sentence brings the next whole one with it, rather than a preview of a few words.
    const two =
      "ספסל דמו קצר. " +
      "הוא עומד מול השדות שבהם עבדו החברים, ולידו עץ זית שנשתל בשנה שאחרי. " +
      "משפט שלישי ארוך שכבר לא נכנס לתצוגה ונשאר רק בעמוד המקום עצמו."
    const second = await send("ספסל דמו בשני משפטים", { story_he: two })
    await decide(second.id, await queued(second.id), "approve")
    expect(meta(await (await page(second.id)).text(), "og:description")).toBe(
      "ספסל דמו קצר. הוא עומד מול השדות שבהם עבדו החברים, ולידו עץ זית שנשתל בשנה שאחרי.",
    )
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
    await seedCurated(["nova-memorial-reim"])
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

  it("replaces the site page's own address and canonical with the place's, rather than adding a second of each", async () => {
    const { id } = await send("ספסל דמו כתובת אחת")
    await decide(id, await queued(id), "approve")
    const withHome: Env = {
      ...withSite,
      ENVIRONMENT: "production",
      PUBLIC_ORIGIN: "https://makom.example",
      ASSETS: {
        fetch: async () =>
          new Response(
            '<!doctype html><html><head><title>x</title><meta property="og:image" content="https://makom.example/og.png" /><meta property="og:url" content="https://makom.example/" /><link rel="canonical" href="https://makom.example/" /></head><body></body></html>',
            { headers: { "Content-Type": "text/html" } },
          ),
      } as unknown as Fetcher,
    }
    const html = await (await call(`https://makom.example/place/${id}`, {}, withHome)).text()
    expect(html.match(/property="og:url"/g)).toHaveLength(1)
    expect(html.match(/rel="canonical"/g)).toHaveLength(1)
    expect(meta(html, "og:url")).toBe(`https://makom.example/place/${id}`)
    expect(html).toContain(`<link rel="canonical" href="https://makom.example/place/${id}"`)
  })

  it("sends a place's link on the old workers.dev address to the same place on the site's own domain", async () => {
    const prod = { ...withSite, ENVIRONMENT: "production", PUBLIC_ORIGIN: "https://makom.example" }
    const res = await call(`https://${OLD_HOST}/place/nova-memorial-reim?x=1`, { redirect: "manual" }, prod)
    expect(res.status).toBe(301)
    expect(res.headers.get("Location")).toBe("https://makom.example/place/nova-memorial-reim?x=1")
    // Without a domain configured there is nowhere to send it, so the old address keeps serving the page.
    const stay = await call(`https://${OLD_HOST}/place/nova-memorial-reim`, { redirect: "manual" }, { ...prod, PUBLIC_ORIGIN: "" })
    expect(stay.status).not.toBe(301)
  })
})
