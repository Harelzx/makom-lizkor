// node --test scripts/release-mail.test.mjs
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { experimental_readRawConfig } from "wrangler"
import { mailBlockers } from "./release-mail.mjs"

const parse = (jsonc) => {
  const file = join(mkdtempSync(join(tmpdir(), "release-mail-")), "wrangler.jsonc")
  writeFileSync(file, jsonc)
  return experimental_readRawConfig({ config: file }).rawConfig
}
const ready = { binding: "MAIL", sends: true }
const sender = '"vars": { "MAIL_FROM": "notifications@makom-lizkor.org" }'

test("a production binding under the adapter's name, with an adapter that sends, passes", () => {
  assert.deepEqual(mailBlockers(parse(`{ "name": "x", ${sender}, "send_email": [{ "name": "MAIL" }] }`), ready), [])
})
test("no binding at all blocks", () => {
  assert.equal(mailBlockers(parse(`{ "name": "x", ${sender} }`), ready).length, 1)
})
test("a commented-out binding blocks", () => {
  assert.equal(mailBlockers(parse(`{ "name": "x", ${sender},\n // "send_email": [{ "name": "MAIL" }]\n }`), ready).length, 1)
})
test("a binding only in another environment blocks", () => {
  assert.equal(
    mailBlockers(parse(`{ "name": "x", ${sender}, "env": { "staging": { "send_email": [{ "name": "MAIL" }] } } }`), ready).length,
    1,
  )
})
test("a binding under another name blocks", () => {
  assert.equal(mailBlockers(parse(`{ "name": "x", ${sender}, "send_email": [{ "name": "EMAIL" }] }`), ready).length, 1)
})
test("an adapter that doesn't send blocks even with the binding", () => {
  assert.equal(
    mailBlockers(parse(`{ "name": "x", ${sender}, "send_email": [{ "name": "MAIL" }] }`), { binding: "MAIL", sends: false }).length,
    1,
  )
})

test("the implemented adapter still blocks release without a real configured production sender", () => {
  for (const from of [
    undefined,
    "",
    "[sender]",
    "not-an-address",
    "mail@example.org",
    "mail@example.invalid",
    "x@site.org\r\nBcc: y@site.org",
  ]) {
    const raw = { send_email: [{ name: "MAIL" }], vars: { MAIL_FROM: from } }
    assert.match(mailBlockers(raw, ready).join("\n"), /MAIL_FROM/)
  }
})

test("a staging sender cannot satisfy production's sender requirement", () => {
  const raw = { send_email: [{ name: "MAIL" }], env: { staging: { vars: { MAIL_FROM: "mail@makom-lizkor.org" } } } }
  assert.match(mailBlockers(raw, ready).join("\n"), /MAIL_FROM/)
})

const gmail = {
  vars: { MAIL_PROVIDER: "gmail", MAIL_FROM: "project@gmail.com", GMAIL_ACCOUNT: "project@gmail.com", GMAIL_OAUTH_STATUS: "production" },
  secrets: { required: ["GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET", "GMAIL_REFRESH_TOKEN"] },
}
test("Gmail needs its own authorized account and declared secrets, not a bought domain or Cloudflare binding", () => {
  assert.deepEqual(mailBlockers(gmail, ready), [])
  assert.match(mailBlockers({ ...gmail, vars: { ...gmail.vars, GMAIL_OAUTH_STATUS: "testing" } }, ready).join("\n"), /seven days/)
  for (const secret of gmail.secrets.required) {
    assert.match(
      mailBlockers({ ...gmail, secrets: { required: gmail.secrets.required.filter((s) => s !== secret) } }, ready).join("\n"),
      new RegExp(secret),
    )
    assert.match(mailBlockers({ ...gmail, vars: { ...gmail.vars, [secret]: "must-not-be-a-var" } }, ready).join("\n"), /must be a secret/)
  }
})
test("Gmail rejects mismatched sender, staging-only configuration and a non-sending adapter", () => {
  assert.match(mailBlockers({ ...gmail, vars: { ...gmail.vars, MAIL_FROM: "other@gmail.com" } }, ready).join("\n"), /GMAIL_ACCOUNT/)
  assert.ok(mailBlockers({ env: { staging: gmail } }, ready).length)
  assert.match(mailBlockers(gmail, { ...ready, sends: false }).join("\n"), /doesn't send/)
  assert.match(mailBlockers({ vars: { MAIL_PROVIDER: "unknown" } }, ready).join("\n"), /unknown/)
})
