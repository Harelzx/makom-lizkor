import { validMailFrom } from "./mail-binding.ts"
import type { Mail } from "./mail"

export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.send"
export const GMAIL_SECRETS = ["GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET", "GMAIL_REFRESH_TOKEN"] as const
export type GmailSettings = {
  MAIL_FROM?: string
  GMAIL_ACCOUNT?: string
  GMAIL_CLIENT_ID?: string
  GMAIL_CLIENT_SECRET?: string
  GMAIL_REFRESH_TOKEN?: string
  GMAIL_OAUTH_STATUS?: string
}
export const gmailSenderReady = (env: GmailSettings) =>
  validMailFrom(env.MAIL_FROM) && /@gmail\.com$/i.test(env.MAIL_FROM) && env.MAIL_FROM.toLowerCase() === env.GMAIL_ACCOUNT?.toLowerCase()
export const gmailReady = (env: GmailSettings) =>
  gmailSenderReady(env) &&
  env.GMAIL_OAUTH_STATUS === "production" &&
  GMAIL_SECRETS.every((name) => typeof env[name] === "string" && !!env[name]?.trim())

function base64(text: string) {
  const bytes = new TextEncoder().encode(text)
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

// Each UTF-8 encoded word stays below RFC 2047's 75-character limit, including long Hebrew subjects.
function subjectHeader(subject: string) {
  const words: string[] = []
  let part = ""
  for (const character of subject) {
    if (new TextEncoder().encode(part + character).length > 42) {
      words.push(`=?UTF-8?B?${base64(part)}?=`)
      part = ""
    }
    part += character
  }
  if (part) words.push(`=?UTF-8?B?${base64(part)}?=`)
  return words.join("\r\n ")
}

/** Only text mail: callers cannot inject headers, recipients, HTML or attachments. */
export function gmailRaw(from: string, mail: Mail): string | null {
  if (
    !validMailFrom(from) ||
    !validMailFrom(mail.to) ||
    !mail.subject ||
    mail.subject.length > 500 ||
    Array.from(mail.subject).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) ||
    new TextEncoder().encode(mail.text).length > 64_000
  )
    return null
  const body =
    base64(mail.text.replace(/\r?\n|\r/g, "\r\n"))
      .match(/.{1,76}/g)
      ?.join("\r\n") ?? ""
  const mime = [
    `From: ${from}`,
    `To: ${mail.to}`,
    `Subject: ${subjectHeader(mail.subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    body,
    "",
  ].join("\r\n")
  return base64(mime).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

// Token and send responses are small. Bound both time and bytes; never retain or log Google's error bodies.
async function smallJson(response: Response): Promise<Record<string, unknown>> {
  if (!response.ok || !response.body) throw new Error("mail unavailable")
  const reader = response.body.getReader()
  let text = ""
  let size = 0
  const decoder = new TextDecoder()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 16_384) throw new Error("mail unavailable")
      text += decoder.decode(value, { stream: true })
    }
    text += decoder.decode()
    const json: unknown = JSON.parse(text)
    if (!json || typeof json !== "object" || Array.isArray(json)) throw new Error("mail unavailable")
    return json as Record<string, unknown>
  } finally {
    await reader.cancel()
  }
}

/** One refresh and one send. A lost acknowledgement must not cause an automatic resend or provider fallback. */
export async function gmailSend(env: GmailSettings, mail: Mail, request: typeof fetch = fetch): Promise<boolean> {
  if (!gmailReady(env)) return false
  const raw = gmailRaw(env.MAIL_FROM!, mail)
  if (!raw) return false
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 12_000)
  try {
    const token = await smallJson(
      await request("https://oauth2.googleapis.com/token", {
        method: "POST",
        // workerd supports follow/manual only. smallJson rejects every non-2xx response,
        // so manual refuses redirects without forwarding OAuth credentials.
        redirect: "manual",
        signal: controller.signal,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: env.GMAIL_CLIENT_ID!,
          client_secret: env.GMAIL_CLIENT_SECRET!,
          refresh_token: env.GMAIL_REFRESH_TOKEN!,
        }),
      }),
    )
    if (
      typeof token.access_token !== "string" ||
      !token.access_token.trim() ||
      typeof token.token_type !== "string" ||
      token.token_type.toLowerCase() !== "bearer" ||
      (token.scope !== undefined && token.scope !== GMAIL_SCOPE)
    )
      return false
    const receipt = await smallJson(
      await request("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
        method: "POST",
        redirect: "manual",
        signal: controller.signal,
        headers: { Authorization: `Bearer ${token.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ raw }),
      }),
    )
    return typeof receipt.id === "string" && !!receipt.id.trim()
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}
