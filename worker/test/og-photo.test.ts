import { beforeAll, describe, expect, it } from "vitest"
import { OG_TEMPLATE_VERSION, renderOg, type OgProjection } from "../lib/og"
import { pixels } from "./png"

// Template 5 intentionally uses fixed brand art, regardless of place photos or their formats.

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

describe("uniform sharing art", () => {
  let fixed: Uint8Array
  beforeAll(async () => {
    fixed = await renderOg(projection, null)
  })
  // One real render per case: every former input remains covered under the unchanged test deadline.
  it.each([
    ["lossless WebP", RED_WEBP_LOSSLESS],
    ["lossy WebP", BLUE_WEBP_LOSSY],
    ["PNG", YELLOW_PNG],
    ["JPEG", GREEN_JPEG],
    ["unreadable bytes", new TextEncoder().encode("<svg/>")],
  ])("keeps identical rendered bytes with %s", async (_format, bytes) => {
    expect(await renderOg(projection, bytes as Uint8Array)).toEqual(fixed)
  })
  it("renders the botanical mark on the cream background without a photo", async () => {
    const at = await pixels(fixed)
    expect(at(40, 40)).toEqual([249, 247, 242])
    // Real pixels in the botanical mark must differ from the cream background.
    expect(at(195, 220)).not.toEqual([249, 247, 242])
  })
  it("keeps each place identifiable rather than turning every link into the same card", async () => {
    expect(await renderOg({ ...projection, name_he: "ספסל אחר" }, null)).not.toEqual(fixed)
  })
})
