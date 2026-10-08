// The actual transport is bundled without a runtime or network. Every provider/database below is a local stub.
import assert from "node:assert/strict"
import { test, mock } from "node:test"
import { fileURLToPath } from "node:url"
import { build } from "esbuild"

const bundled = await build({
  entryPoints: [fileURLToPath(new URL("../worker/lib/mail.ts", import.meta.url))],
  bundle: true,
  write: false,
  format: "esm",
  platform: "neutral",
})
const { sendMail } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`)
const message = { to: "recipient@example.invalid", subject: "אישור כתובת", text: "קישור בדיקה סינתטי" }
const sender = "notifications@makom-lizkor.org"

test("production sends the exact structured message and accepts the provider's message id", async () => {
  const calls = []
  const binding = {
    async send(value) {
      assert.equal(this, binding)
      calls.push(value)
      return { messageId: "synthetic-message" }
    },
  }
  assert.equal(await sendMail({ ENVIRONMENT: "production", MAIL_FROM: sender, MAIL: binding }, message), true)
  assert.deepEqual(calls, [{ from: sender, ...message }])
})

test("missing or invalid production sender and missing binding never call the provider", async () => {
  const send = mock.fn(async () => ({ messageId: "synthetic" }))
  for (const from of [
    undefined,
    "",
    "[sender]",
    "bad",
    "mail@example.org",
    "mail@example.invalid",
    ".mail@site.org",
    "mail..box@site.org",
    "mail@-site.org",
    "mail@site..org",
    "mail@site.org\r\nBcc: other@site.org",
  ]) {
    assert.equal(await sendMail({ ENVIRONMENT: "production", MAIL_FROM: from, MAIL: { send } }, message), false)
  }
  assert.equal(send.mock.callCount(), 0)
  assert.equal(await sendMail({ ENVIRONMENT: "production", MAIL_FROM: sender }, message), false)
})

test("staging and unknown environments never send even if a production binding and sender are copied in", async () => {
  const send = mock.fn(async () => ({ messageId: "synthetic" }))
  for (const ENVIRONMENT of ["staging", "preview", "", undefined])
    assert.equal(await sendMail({ ENVIRONMENT, MAIL_FROM: sender, MAIL: { send } }, message), false)
  assert.equal(send.mock.callCount(), 0)
})

test("provider exceptions and missing acknowledgements return false without logging personal data", async () => {
  const error = mock.method(console, "error", () => {})
  const log = mock.method(console, "log", () => {})
  try {
    const fail = {
      async send() {
        throw new Error("recipient@example.invalid / private tracking link")
      },
    }
    assert.equal(await sendMail({ ENVIRONMENT: "production", MAIL_FROM: sender, MAIL: fail }, message), false)
    for (const result of [undefined, null, {}, { messageId: "" }, { messageId: " " }])
      assert.equal(
        await sendMail(
          {
            ENVIRONMENT: "production",
            MAIL_FROM: sender,
            MAIL: {
              async send() {
                return result
              },
            },
          },
          message,
        ),
        false,
      )
    assert.equal(error.mock.callCount(), 0)
    assert.equal(log.mock.callCount(), 0)
  } finally {
    error.mock.restore()
    log.mock.restore()
  }
})

test("development still writes only the local outbox, even with a configured live binding", async () => {
  const calls = []
  const send = mock.fn(async () => ({ messageId: "should-not-send" }))
  const DB = {
    prepare(sql) {
      return {
        bind(...values) {
          return {
            async run() {
              calls.push({ sql, values })
            },
          }
        },
      }
    },
  }
  assert.equal(await sendMail({ ENVIRONMENT: "development", DB, MAIL_FROM: sender, MAIL: { send } }, message), true)
  assert.equal(send.mock.callCount(), 0)
  assert.match(calls[0].sql, /INSERT INTO dev_outbox/)
  assert.deepEqual(calls[0].values.slice(2), [message.to, message.subject, message.text])
})
