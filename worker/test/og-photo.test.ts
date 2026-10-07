import { describe, expect, it } from "vitest"
import { OG_TEMPLATE_VERSION, renderOg, type OgProjection } from "../lib/og"
import { pixels } from "./png"

// The photo in a share image is drawn from its own bytes, whatever their format (P7-OG-1): the site's own places carry
// WebP photos, which resvg can't decode, and a photo labelled with another type drew nothing (a black panel). Each
// test renders a small photo of one colour and reads the rendered pixels back: the photo panel (x < 440) must be that
// colour, and the text side the background.

const b = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
const RED_WEBP_LOSSLESS = b("UklGRh4AAABXRUJQVlA4TBEAAAAvD8ADAAdQiprXo/+BiOh/AAA=")
const BLUE_WEBP_LOSSY = b("UklGRj4AAABXRUJQVlA4IDIAAADwAQCdASoQABAAAMASJaACdLoB+AAETAAA/vz5Vf/h/38Un/h/3/w/7/52DYl2vAAAAA==")
const YELLOW_PNG = b(
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAI0lEQVR4nGP8cEKEgRTARJJqhlENxAEmItXBwagGYgDJoQQAsl8B7HSQO18AAAAASUVORK5CYII=",
)
const GREEN_JPEG = b(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAIBAQEBAQIBAQECAgICAgQDAgICAgUEBAMEBgUGBgYFBgYGBwkIBgcJBwYGCAsICQoKCgoKBggLDAsKDAkKCgr/2wBDAQICAgICAgUDAwUKBwYHCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgr/wAARCAAQABADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwAooor+Nz/Ms//Z",
)
const projection: OgProjection = { v: OG_TEMPLATE_VERSION, kind: "grove", name_he: "חורשת דמו", place_he: "יישוב דמו", photo: "public/x" }

const near = (got: number[], want: number[]) => got.every((v, i) => Math.abs(v - want[i]) <= 24)

describe("a share image's photo", () => {
  for (const [what, bytes, colour] of [
    ["a lossless WebP", RED_WEBP_LOSSLESS, [230, 20, 30]],
    ["a lossy WebP", BLUE_WEBP_LOSSY, [20, 40, 230]],
    ["a PNG", YELLOW_PNG, [240, 200, 20]],
    ["a JPEG", GREEN_JPEG, [20, 200, 40]],
  ] as const) {
    it(`is drawn from ${what}`, async () => {
      const at = await pixels(await renderOg(projection, bytes))
      for (const [x, y] of [
        [40, 40],
        [220, 315],
        [400, 600],
      ])
        expect(near(at(x, y), [...colour]), `${what} at ${x},${y}: ${at(x, y)}`).toBe(true)
      // The text side keeps the background, not the photo.
      expect(near(at(700, 40), [0x16, 0x13, 0x1c])).toBe(true)
    })
  }

  it("is refused, not drawn as an empty panel, when its bytes are no picture the renderer reads", async () => {
    await expect(renderOg(projection, new TextEncoder().encode("<svg/>"))).rejects.toThrow(/photo_format/)
  })
})
