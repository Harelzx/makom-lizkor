import { Hono } from "hono"
import type { AppEnv } from "../index"
import { publicPlace } from "../db/places"
import { curatedPlace } from "../lib/curated"

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
share.get("/place/:id", async (c) => {
  const id = c.req.param("id")
  const found = id.startsWith("p_") ? await publicPlace(c.env.DB, id) : curatedPlace(id)
  const site = await c.env.ASSETS.fetch(new Request(new URL("/", c.req.url)))
  // Absolute addresses come from the configured origin only; locally, from the request (http included).
  const origin = c.env.ENVIRONMENT === "development" ? new URL(c.req.url).origin : c.env.PUBLIC_ORIGIN || ""
  const url = origin ? `${origin}/place/${encodeURIComponent(id)}` : ""

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
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
    })
  }

  const place = found.place
  const words = (place.summary_he || place.place_he || "מקום לזכור").slice(0, DESCRIPTION_MAX)
  // The tag is written whole, escaped here: the rewriter's own setAttribute leaves < and > bare in the value, which a
  // browser reads safely but a careless preview scraper may not.
  const content = (value: string) => ({
    element: (el: Element) => {
      const key = el.hasAttribute("property") ? "property" : "name"
      el.replace(`<meta ${key}="${attr(el.getAttribute(key) ?? "")}" content="${attr(value)}" />`, { html: true })
    },
  })
  const rewriter = new HTMLRewriter()
    .on("title", { element: (el) => void el.setInnerContent(`${place.name_he} · מקום לזכור`) })
    .on('meta[name="description"]', content(words))
    .on('meta[property="og:title"]', content(place.name_he))
    .on('meta[property="og:description"]', content(words))
    .on('meta[property="og:image"]', origin ? content(`${origin}/og.png`) : {})
    .on("head", {
      element: (head) => {
        if (url) {
          head.append(`<meta property="og:url" content="${attr(url)}" />`, { html: true })
          head.append(`<link rel="canonical" href="${attr(url)}" />`, { html: true })
        }
        // The site already ships its own places; an approved contribution's fields come with its page.
        if ("id" in place && id.startsWith("p_"))
          head.append(`<script type="application/json" id="place-data">${JSON.stringify(place).replace(/</g, LT)}</script>`, {
            html: true,
          })
      },
    })
  return new Response(rewriter.transform(site).body, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // The browser checks back each time; the edge keeps it a minute, under the place's tag (spec 5; staging).
      "Cache-Control": "no-cache",
      "Cloudflare-CDN-Cache-Control": "max-age=60",
      "Cache-Tag": `place:${id}`,
    },
  })
})

/** A value inside a double-quoted attribute, with every character that could end it or start a tag escaped. */
const attr = (v: string) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
