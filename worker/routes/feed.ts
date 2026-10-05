import { Hono } from "hono"
import { readFeed } from "../db/places"

export const feed = new Hono<{ Bindings: Env }>()

// The browser never keeps these (no-store), so its HTTP cache can't bring a hidden place back; the edge keeps
// them briefly, under a tag that a takedown purges (phase 4).
const edge = (seconds: number, tag: string) => ({
  "Cache-Control": "no-store",
  "Cloudflare-CDN-Cache-Control": `max-age=${seconds}`,
  "Cache-Tag": tag,
})

feed.get("/version", async (c) => {
  const n = await c.env.DB.prepare("SELECT n FROM feed_state WHERE id = 1").first<number>("n")
  return c.json({ v: `${c.env.EPOCH}.${n ?? 0}` }, 200, edge(10, "feed"))
})

// The version is part of the address, so an edge copy is never a mix of two moments; asking for an old one gets
// the current version back instead of old content.
feed.get("/feed", async (c) => {
  const current = await readFeed(c.env.DB, c.env.EPOCH)
  if (c.req.query("v") !== current.v) return c.json({ code: "stale_version", v: current.v }, 409, { "Cache-Control": "no-store" })
  return c.json(current, 200, edge(60, "feed"))
})
