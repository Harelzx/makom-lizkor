import { env, exports } from "cloudflare:workers"
import { SignJWT } from "jose"

export async function devToken(email: string) {
  return new SignJWT({ email })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("dev-access")
    .setAudience("makom-dev")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(env.DEV_ACCESS_SECRET))
}

export async function submit(name = "ספסל דמו") {
  const res = await exports.default.fetch("http://local/api/v1/submissions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID().replaceAll("-", "") },
    body: JSON.stringify({ kind: "bench", name_he: name, lat: 31.42, lng: 34.49, consent_version: "notice.submission@2026-10-2" }),
  })
  return res.json<{ id: string; trackingToken: string }>()
}

export const admin = async (path: string, init: RequestInit = {}, email = "dev@example.test") =>
  exports.default.fetch(`http://local${path}`, {
    ...init,
    headers: {
      "Cf-Access-Jwt-Assertion": await devToken(email),
      "Content-Type": "application/json",
      "Idempotency-Key": crypto.randomUUID().replaceAll("-", ""),
      "Sec-Fetch-Site": "same-origin",
      ...init.headers,
    },
  })

export async function approve(id: string) {
  const { items } = await (await admin("/api/admin/queue")).json<{ items: { id: string; rev: number; revisionId: string }[] }>()
  const item = items.find((i) => i.id === id)!
  return admin(`/api/admin/places/${id}/transitions`, {
    method: "POST",
    body: JSON.stringify({ action: "approve", revisionId: item.revisionId, expectedRev: item.rev }),
  })
}
