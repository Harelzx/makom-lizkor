import { describe, expect, it } from "vitest"
import { clientErrorReport, errorKind } from "./error-report"

const origin = "https://makom.example"

describe("a browser error report", () => {
  it("names the error's class and the site's own file, without its hash, and nothing else", () => {
    const error = new TypeError("cannot read x of visitor@example.test")
    error.stack = `TypeError: cannot read x\n    at f (${origin}/assets/map-canvas-B3xk9_aQ.js:1:200)\n    at g (${origin}/assets/index-Cd2_x8Lp.js:3:10)`
    const body = clientErrorReport({ error, filename: `${origin}/assets/map-canvas-B3xk9_aQ.js` }, origin)
    expect(JSON.parse(body!)).toEqual([{ type: "client-error", body: { name: "TypeError", chunk: "map-canvas", kind: "other" } }])
    expect(body).not.toContain("visitor")
  })

  it("finds the file in the stack when the event has none (a rejected promise)", () => {
    const error = new RangeError("out of range")
    error.stack = `RangeError: out of range\n    at h (${origin}/assets/intro-Zz9_1aBc.js:2:5)`
    expect(JSON.parse(clientErrorReport({ error }, origin)!)[0].body).toEqual({ name: "RangeError", chunk: "intro", kind: "other" })
  })

  it("stays quiet about errors that aren't the site's own: an extension, another origin, or an opaque 'Script error.'", () => {
    expect(clientErrorReport({ error: new Error("x"), filename: "chrome-extension://abc/content.js" }, origin)).toBeNull()
    expect(clientErrorReport({ error: new Error("x"), filename: "https://other.example/assets/a-12345678.js" }, origin)).toBeNull()
    expect(clientErrorReport({ error: null, filename: "" }, origin)).toBeNull()
  })
})

describe("a visitor's issue", () => {
  it("is sent by kind only, once a page per kind", async () => {
    const sent: string[] = []
    Object.defineProperty(globalThis, "navigator", {
      value: {
        sendBeacon: (_url: string, blob: Blob) => {
          void blob.text().then((t) => sent.push(t))
          return true
        },
      },
      configurable: true,
    })
    const { reportIssue } = await import("./error-report")
    reportIssue("map_tiles")
    reportIssue("map_tiles")
    reportIssue("image")
    await new Promise((r) => setTimeout(r, 10))
    expect(sent.map((t) => JSON.parse(t)[0])).toEqual([
      { type: "client-issue", body: { kind: "map_tiles" } },
      { type: "client-issue", body: { kind: "image" } },
    ])
  })

  it("is not sent once the page is loading again for a newer build: the failure is the old tab leaving", async () => {
    const sent: string[] = []
    Object.defineProperty(globalThis, "navigator", {
      value: {
        sendBeacon: (_url: string, blob: Blob) => {
          void blob.text().then((t) => sent.push(t))
          return true
        },
      },
      configurable: true,
    })
    const { reportIssue, leaving } = await import("./error-report")
    reportIssue("stale_bundle")
    leaving()
    reportIssue("crash")
    await new Promise((r) => setTimeout(r, 10))
    expect(sent.map((t) => JSON.parse(t)[0])).toEqual([{ type: "client-issue", body: { kind: "stale_bundle" } }])
  })
})

describe("an error's kind", () => {
  const named = (name: string, message: string) => Object.assign(new Error(message), { name })
  it("reads the network, a JSON answer and a missing file from the browsers' own words, and nothing else", () => {
    expect(errorKind(named("TypeError", "Failed to fetch"))).toBe("network")
    expect(errorKind(named("TypeError", "Load failed"))).toBe("network")
    expect(errorKind(named("TimeoutError", "signal timed out"))).toBe("network")
    expect(errorKind(named("SyntaxError", "Unexpected token '<', \"<!DOCTYPE \"... is not valid JSON"))).toBe("json")
    expect(errorKind(named("SyntaxError", "The string did not match the expected pattern."))).toBe("json")
    expect(errorKind(named("TypeError", "Importing a module script failed."))).toBe("chunk")
    expect(errorKind(named("TypeError", "Failed to fetch dynamically imported module: /assets/x.js"))).toBe("chunk")
    expect(errorKind(named("TypeError", "cannot read properties of undefined"))).toBe("other")
  })
})
