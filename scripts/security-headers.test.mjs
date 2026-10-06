// node --test scripts/security-headers.test.mjs
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { CSP, SECURITY_HEADERS } from "../worker/lib/security-headers.ts"
import { FILE, headersFile } from "./security-headers.mjs"

test("public/_headers carries the Worker's headers, for every path", () => {
  const text = readFileSync(FILE, "utf8")
  assert.equal(text, headersFile(), "public/_headers is stale: run node scripts/security-headers.mjs")
  const lines = text.split("\n").filter((l) => l && !l.startsWith("#"))
  assert.equal(lines[0], "/*")
  const set = Object.fromEntries(
    lines.slice(1).map((l) => [l.trim().slice(0, l.trim().indexOf(":")), l.trim().slice(l.trim().indexOf(":") + 2)]),
  )
  assert.deepEqual(set, { ...SECURITY_HEADERS, "Content-Security-Policy-Report-Only": CSP })
})
test("the policy reports and doesn't enforce yet, and frames are refused meanwhile", () => {
  const text = readFileSync(FILE, "utf8")
  assert.ok(!/^\s*Content-Security-Policy:/m.test(text))
  assert.match(CSP, /report-uri \/api\/csp-report/)
  assert.equal(SECURITY_HEADERS["X-Frame-Options"], "DENY")
})
