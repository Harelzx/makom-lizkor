import assert from "node:assert/strict"
import { test } from "node:test"
import { installedClient, consentUrl, callbackCode, credentialsFromGrant, readGrant } from "./gmail-connect.mjs"
import { GMAIL_SCOPE } from "../worker/lib/gmail.ts"

const client = { client_id: "synthetic.apps.googleusercontent.com", client_secret: "synthetic-secret" }
const redirect = "http://127.0.0.1:18765/gmail/oauth"
const state = "synthetic-state"
test("local consent requests exactly send scope, offline refresh, PKCE and no accumulated scopes", () => {
  assert.equal(installedClient({ installed: client }), client)
  const url = new URL(consentUrl(client, "synthetic@gmail.com", redirect, state, "synthetic-verifier"))
  assert.equal(url.origin, "https://accounts.google.com")
  assert.equal(url.searchParams.get("scope"), GMAIL_SCOPE)
  assert.equal(url.searchParams.get("include_granted_scopes"), "false")
  assert.equal(url.searchParams.get("access_type"), "offline")
  assert.equal(url.searchParams.get("code_challenge_method"), "S256")
  assert.ok(url.searchParams.get("code_challenge"))
  assert.equal(url.searchParams.get("state"), state)
  assert.equal(url.searchParams.has("client_secret"), false)
  assert.equal(url.searchParams.has("code_verifier"), false)
})
test("authorization responses are byte-bounded and never accepted as malformed JSON", async () => {
  assert.deepEqual(await readGrant(Response.json({ synthetic: true })), { synthetic: true })
  await assert.rejects(readGrant(new Response("x".repeat(16_385))))
  await assert.rejects(readGrant(new Response("{")))
})
test("cannot accept a remote callback, injected sender, or wrong client type", () => {
  for (const r of ["https://site.org/gmail/oauth", "http://0.0.0.0:8765/gmail/oauth", "http://127.0.0.1:8765/other"])
    assert.throws(() => consentUrl(client, "synthetic@gmail.com", r, state, "v"))
  assert.throws(() => consentUrl(client, "x@gmail.com\nBcc: y@gmail.com", redirect, state, "v"))
  assert.throws(() => installedClient({ web: client }))
})
test("the callback requires matching state, path, origin and one code", () => {
  assert.equal(callbackCode(`/gmail/oauth?state=${state}&code=synthetic-code`, state, redirect), "synthetic-code")
  for (const path of [
    "/other?state=synthetic-state&code=x",
    "/gmail/oauth?state=wrong&code=x",
    "/gmail/oauth?state=synthetic-state&code=x&code=y",
    "https://evil.org/gmail/oauth?state=synthetic-state&code=x",
    "/gmail/oauth?state=synthetic-state&code=x%0Ay",
  ])
    assert.equal(callbackCode(path, state, redirect), null)
  assert.throws(() => callbackCode("/gmail/oauth?state=synthetic-state&error=access_denied", state, redirect))
})
test("save only an exact send-only refresh grant; no bearer access token stored", () => {
  const grant = { scope: GMAIL_SCOPE, token_type: "Bearer", access_token: "short-lived", refresh_token: "synthetic-refresh" }
  assert.deepEqual(credentialsFromGrant(client, grant), {
    GMAIL_CLIENT_ID: client.client_id,
    GMAIL_CLIENT_SECRET: client.client_secret,
    GMAIL_REFRESH_TOKEN: "synthetic-refresh",
  })
  for (const bad of [
    { ...grant, scope: GMAIL_SCOPE + " openid" },
    { ...grant, refresh_token: "" },
    { ...grant, token_type: "unknown" },
    {},
  ])
    assert.throws(() => credentialsFromGrant(client, bad))
})
