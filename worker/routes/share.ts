import { Hono, type Context } from "hono"
import type { AppEnv } from "../index"
import { publicPlace } from "../db/places"
import { ogState } from "../lib/og"
import { plainDashes } from "@/lib/display-text"

export const share = new Hono<AppEnv>()

// `<` written as its JSON escape, so a name can never close the script that carries it (built here, not typed, so the
// escape survives every editor and tool).
const LT = `${String.fromCharCode(92)}u003c`
const DESCRIPTION_MAX = 200

/**
 * A place's share page (spec 2.6): the site's own page, with the place's name and words in the preview tags a
 * messenger reads, and an approved contribution's public fields in the page, so the link opens at once. The site
 * then runs as usual and reads the place from the address (src/store.ts turns /place/<id> into #/place/<id>).
 */
share.get("/place/:id", (c) => sharePage(c, c.req.param("id")))
share.get("/place/:id/", (c) => sharePage(c, c.req.param("id")))
// Every /place/ address reaches the Worker; one that names no place is the site's own 404 page, not an API error.
share.get("/place/*", (c) => sharePage(c, null))

async function sharePage(c: Context<AppEnv>, id: string | null) {
  const found = !id ? ({ kind: "none" } as const) : await publicPlace(c.env.DB, id)
  const site = await c.env.ASSETS.fetch(new Request(new URL("/", c.req.url)))
  // The page's own headers (any security headers the assets carry) stay; the length and validators no longer fit it,
  // nor does the static file's cache status: this page is the Worker's answer, built now, never a cache's (C-CACHE).
  const headers = (set: Record<string, string>) => {
    const h = new Headers(site.headers)
    for (const k of ["Content-Length", "ETag", "Last-Modified", "CF-Cache-Status", "Age"]) h.delete(k)
    for (const [k, v] of Object.entries(set)) h.set(k, v)
    return h
  }
  // Absolute addresses come from the configured origin only; locally, from the request (http included).
  const origin = c.env.ENVIRONMENT === "development" ? new URL(c.req.url).origin : c.env.PUBLIC_ORIGIN || ""
  const url = origin && id ? `${origin}/place/${encodeURIComponent(id)}` : ""

  if (found.kind !== "published") {
    // Never public, or taken back: nothing of it in the page, not indexed, not kept anywhere.
    const gone = found.kind === "gone"
    const page = new HTMLRewriter()
      .on("head", {
        element: (head) => {
          head.append('<meta name="robots" content="noindex" />', { html: true })
          // Read by the site (src/store.ts), which opens the overview rather than a card that can't come.
          head.append(`<meta name="place-status" content="${gone ? "gone" : "none"}" />`, { html: true })
        },
      })
      .transform(site)
    return new Response(page.body, {
      status: gone ? 410 : 404,
      headers: headers({ "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" }),
    })
  }

  const place = found.place
  // The place's own image, named by the hash of what it shows now; the general one if it can't be projected.
  const og = await ogState(c.env.DB, id!)
  const image = og ? `${origin}/media/og/${encodeURIComponent(id!)}/${og.hash}.png` : `${origin}/og.png`
  // Cut by characters, not UTF-16 units, so an emoji at the edge isn't split into a broken glyph.
  const words = Array.from(plainDashes(place.summary_he || place.place_he || "מקום לזכור"))
    .slice(0, DESCRIPTION_MAX)
    .join("")
  // The tag is written whole, escaped here: the rewriter's own setAttribute leaves < and > bare in the value, which a
  // browser reads safely but a careless preview scraper may not.
  const content = (value: string) => ({
    element: (el: Element) => {
      const key = el.hasAttribute("property") ? "property" : "name"
      el.replace(`<meta ${key}="${attr(el.getAttribute(key) ?? "")}" content="${attr(value)}" />`, { html: true })
    },
  })
  const rewriter = new HTMLRewriter()
    .on("title", { element: (el) => void el.setInnerContent(`${plainDashes(place.name_he)} · מקום לזכור`) })
    .on('meta[name="description"]', content(words))
    .on('meta[property="og:title"]', content(plainDashes(place.name_he)))
    .on('meta[property="og:description"]', content(words))
    .on('meta[property="og:image"]', origin ? content(image) : {})
    .on("head", {
      element: (head) => {
        if (url) {
          head.append(`<meta property="og:url" content="${attr(url)}" />`, { html: true })
          head.append(`<link rel="canonical" href="${attr(url)}" />`, { html: true })
        }
        // The place's public fields come with its page, so its card opens before the feed.
        if ("id" in place)
          head.append(`<script type="application/json" id="place-data">${JSON.stringify(place).replace(/</g, LT)}</script>`, {
            html: true,
          })
      },
    })
  return new Response(rewriter.transform(site).body, {
    status: 200,
    headers: headers({
      "Content-Type": "text/html; charset=utf-8",
      // The browser checks back each time; the edge keeps it a minute, under the place's tag (spec 5; staging).
      "Cache-Control": "no-cache",
      "Cloudflare-CDN-Cache-Control": "max-age=60",
      "Cache-Tag": `place:${id}`,
    }),
  })
}

/** A value inside a double-quoted attribute, with every character that could end it or start a tag escaped. */
const attr = (v: string) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
