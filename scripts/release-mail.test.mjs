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
