// node --test scripts/security-headers.test.mjs
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { CSP, SECURITY_HEADERS, developmentPreamble } from "../worker/lib/security-headers.ts"
import react from "@vitejs/plugin-react"
import { FILE, headersFile } from "./security-headers.mjs"

test("public/_headers carries the Worker's headers, for every path", () => {
  const text = readFileSync(FILE, "utf8")
  assert.equal(text, headersFile(), "public/_headers is stale: run node scripts/security-headers.mjs")
  const lines = text.split("\n").filter((l) => l && !l.startsWith("#"))
  assert.equal(lines[0], "/*")
  const set = Object.fromEntries(
    lines.slice(1, lines.indexOf("/")).map((l) => [l.trim().slice(0, l.trim().indexOf(":")), l.trim().slice(l.trim().indexOf(":") + 2)]),
  )
  assert.deepEqual(set, { ...SECURITY_HEADERS, "Content-Security-Policy": CSP })
})
test("the policy enforces, static HTML revalidates and only hashed asset namespace is immutable", () => {
  const text = readFileSync(FILE, "utf8")
  assert.match(text, /^\s*Content-Security-Policy:/m)
  assert.ok(!/^\s*Content-Security-Policy-Report-Only:/m.test(text))
  assert.match(text, /\/assets\/\*\n  Cache-Control: public, max-age=31536000, immutable/)
  assert.ok(!text.includes("/api/" + "*\n"))
  assert.match(CSP, /report-uri \/api\/csp-report/)
  assert.equal(SECURITY_HEADERS["X-Frame-Options"], "DENY")
})

test("the actual installed Vite preamble gets its exact development-only hash", async () => {
  const code = react.preambleCode.replace("__BASE__", "/")
  const page = await developmentPreamble(new Response(`<script type="module">${code}</script>`), "development")
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code)))
  assert.ok(page.headers.get("Content-Security-Policy").includes(`'sha256-${btoa(String.fromCharCode(...digest))}'`))
})
