// One-time owner consent on this Mac. No public OAuth endpoint, test mail, secret output or change to a Worker.
import { createServer } from "node:http"
import { createHash, randomBytes, timingSafeEqual } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { resolve } from "node:path"
import { GMAIL_SCOPE, gmailSenderReady } from "../worker/lib/gmail.ts"

export function installedClient(document) {
  const client = document?.installed
  if (
    !client ||
    typeof client.client_id !== "string" ||
    !client.client_id.endsWith(".apps.googleusercontent.com") ||
    typeof client.client_secret !== "string" ||
    !client.client_secret.trim()
  )
    throw new Error("Use a downloaded Google Desktop OAuth client for this local owner-consent tool.")
  return client
}

export function consentUrl(client, account, redirectUri, state, verifier) {
  if (!gmailSenderReady({ MAIL_FROM: account, GMAIL_ACCOUNT: account })) throw new Error("A Gmail sender account is required.")
  const redirect = new URL(redirectUri)
  if (redirect.protocol !== "http:" || redirect.hostname !== "127.0.0.1" || redirect.pathname !== "/gmail/oauth" || !redirect.port)
    throw new Error("Consent must return to the local loopback listener.")
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth")
  url.search = new URLSearchParams({
    client_id: client.client_id,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GMAIL_SCOPE,
    access_type: "offline",
    prompt: "consent select_account",
    include_granted_scopes: "false",
    login_hint: account,
    state,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  }).toString()
  return url.href
}

export function callbackCode(requestUrl, state, redirectUri) {
  const url = new URL(requestUrl, redirectUri)
  const expected = new URL(redirectUri)
  if (url.origin !== expected.origin || url.pathname !== expected.pathname) return null
  if (["state", "code", "error"].some((name) => url.searchParams.getAll(name).length > 1)) return null
  const returned = Buffer.from(url.searchParams.get("state") ?? "")
  const original = Buffer.from(state)
  if (returned.length !== original.length || !timingSafeEqual(returned, original)) return null
  if (url.searchParams.has("error")) throw new Error("Google authorization was not granted.")
  const code = url.searchParams.get("code")
  return code && code.length <= 2048 && !/[\x00-\x20\x7f]/.test(code) ? code : null
}

export function credentialsFromGrant(client, grant) {
  if (
    grant?.scope !== GMAIL_SCOPE ||
    grant?.token_type?.toLowerCase() !== "bearer" ||
    typeof grant?.access_token !== "string" ||
    !grant.access_token.trim() ||
    typeof grant?.refresh_token !== "string" ||
    !grant.refresh_token.trim()
  )
    throw new Error("Google did not return a fresh send-only refresh grant. Nothing was saved.")
  return { GMAIL_CLIENT_ID: client.client_id, GMAIL_CLIENT_SECRET: client.client_secret, GMAIL_REFRESH_TOKEN: grant.refresh_token }
}

async function connect(clientPath, account) {
  const client = installedClient(JSON.parse(await readFile(clientPath, "utf8")))
  if (!gmailSenderReady({ MAIL_FROM: account, GMAIL_ACCOUNT: account })) throw new Error("A Gmail sender account is required.")
  const directory = resolve(import.meta.dirname, "../../.production-private/gmail")
  const output = resolve(directory, "secrets.json")
  const state = randomBytes(32).toString("base64url")
  const verifier = randomBytes(48).toString("base64url")
  let redirectUri
  let busy = false
  const server = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store")
    res.setHeader("Referrer-Policy", "no-referrer")
    res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
    res.setHeader("Content-Type", "text/plain; charset=utf-8")
    if (busy || req.method !== "GET" || req.headers.host !== new URL(redirectUri).host) {
      res.writeHead(400).end("Invalid request")
      return
    }
    try {
      const code = callbackCode(req.url, state, redirectUri)
      if (!code) {
        res.writeHead(400).end("Invalid authorization response")
        return
      }
      busy = true
      const response = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(12_000),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: client.client_id,
          client_secret: client.client_secret,
          code,
          code_verifier: verifier,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }),
      })
      if (!response.ok) throw new Error("Authorization exchange failed. Nothing was saved.")
      const grant = await readGrant(response)
      const credentials = credentialsFromGrant(client, grant)
      await mkdir(directory, { recursive: true, mode: 0o700 })
      // Refuse an overwrite; a reconnect must deliberately move the previous credentials aside first.
      await writeFile(output, JSON.stringify(credentials), { mode: 0o600, flag: "wx" })
      await writeFile(
        resolve(directory, "consent-receipt.json"),
        JSON.stringify(
          {
            at: new Date().toISOString(),
            scope: GMAIL_SCOPE,
            owner_selected_sender: account,
            account_requires_owner_confirmation: true,
            sent_mail: false,
            uploaded_to_worker: false,
          },
          null,
          2,
        ),
        { mode: 0o600, flag: "wx" },
      )
      res.end("ההרשאה נשמרה במחשב. אפשר לסגור את החלון. עדיין לא נשלח דואר ולא בוצעה פריסה.")
      console.log("Send-only credentials saved privately outside Git. No email sent; no Worker modified.")
    } catch {
      busy = true
      res.writeHead(400).end("החיבור לא הושלם. אין לשלוח סודות או קודים בצ׳אט.")
      console.error("Gmail connection not completed. No provider response or credentials logged.")
      process.exitCode = 1
    } finally {
      if (busy) {
        clearTimeout(deadline)
        server.close()
      }
    }
  })
  await new Promise((done, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", done)
  })
  const address = server.address()
  redirectUri = `http://127.0.0.1:${address.port}/gmail/oauth`
  const deadline = setTimeout(() => {
    console.error("Consent window expired; no automatic retry.")
    server.close()
    process.exitCode = 1
  }, 10 * 60_000)
  console.log(consentUrl(client, account, redirectUri, state, verifier))
  console.log("Authorize with the project Gmail account in your normal browser. Only gmail.send is requested.")
}

export async function readGrant(response) {
  if (!response.body) throw new Error("No authorization grant.")
  const reader = response.body.getReader()
  const chunks = []
  let bytes = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > 16_384) throw new Error("Authorization response too large.")
      chunks.push(value)
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"))
  } finally {
    await reader.cancel()
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [clientPath, account] = process.argv.slice(2)
  if (!clientPath || !account || process.argv.length !== 4) {
    console.error("Usage: node scripts/gmail-connect.mjs /private/path/google-desktop-client.json project@gmail.com")
    process.exitCode = 2
  } else {
    try {
      await connect(clientPath, account)
    } catch {
      console.error("Gmail connection could not start. No credentials logged.")
      process.exitCode = 1
    }
  }
}
