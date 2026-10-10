import assert from "node:assert/strict"
import { after, test } from "node:test"
import { fileURLToPath } from "node:url"
import { build } from "esbuild"
import { Miniflare, convertV4MiniflareOptions } from "miniflare"

// Exercise native workerd fetch, not the injected transport used by the unit tests.
// Every outbound request stays in this synthetic service; Google is never contacted.
const entry = `import { gmailSend } from './worker/lib/gmail.ts';
export default {async fetch() {
  return Response.json(await gmailSend({
    MAIL_FROM:'fixture@gmail.com',GMAIL_ACCOUNT:'fixture@gmail.com',
    GMAIL_CLIENT_ID:'fixture-client',GMAIL_CLIENT_SECRET:'fixture-secret',
    GMAIL_REFRESH_TOKEN:'fixture-refresh',GMAIL_OAUTH_STATUS:'production'
  },{to:'fixture@gmail.com',subject:'Synthetic runtime check',text:'No live mail'}));
}};`
const bundle = await build({
  stdin: { contents: entry, resolveDir: fileURLToPath(new URL("../", import.meta.url)), sourcefile: "gmail-runtime.ts" },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
})
let mode = "success"
let calls = []
const mf = new Miniflare(
  convertV4MiniflareOptions({
    modules: true,
    script: bundle.outputFiles[0].text,
    compatibilityDate: "2026-10-01",
    outboundService: async (request) => {
      const path = new URL(request.url).pathname
      assert.ok(["/token", "/gmail/v1/users/me/messages/send"].includes(path), "no redirect or unexpected host")
      assert.ok(["oauth2.googleapis.com", "gmail.googleapis.com"].includes(new URL(request.url).hostname))
      calls.push({ path, method: request.method })
      assert.equal(request.method, "POST")
      if ((mode === "token_redirect" && path === "/token") || (mode === "send_redirect" && path !== "/token"))
        return new Response(null, { status: 302, headers: { Location: "https://unexpected.test/redirect" } })
      return Response.json(
        path === "/token"
          ? { access_token: "synthetic-access", token_type: "Bearer", scope: "https://www.googleapis.com/auth/gmail.send" }
          : { id: "synthetic-receipt" },
      )
    },
  }),
)
after(() => mf.dispose())
test("native Worker Gmail adapter refreshes once and sends once", async () => {
  calls = []
  mode = "success"
  assert.equal(await (await mf.dispatchFetch("https://fixture.test/")).json(), true)
  assert.deepEqual(
    calls.map((call) => call.path),
    ["/token", "/gmail/v1/users/me/messages/send"],
  )
})
test("native Worker refuses token redirect without forwarding credentials or sending", async () => {
  calls = []
  mode = "token_redirect"
  assert.equal(await (await mf.dispatchFetch("https://fixture.test/")).json(), false)
  assert.deepEqual(
    calls.map((call) => call.path),
    ["/token"],
  )
})
test("native Worker refuses send redirect without retrying or forwarding credentials", async () => {
  calls = []
  mode = "send_redirect"
  assert.equal(await (await mf.dispatchFetch("https://fixture.test/")).json(), false)
  assert.deepEqual(
    calls.map((call) => call.path),
    ["/token", "/gmail/v1/users/me/messages/send"],
  )
})
