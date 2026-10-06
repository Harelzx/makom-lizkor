import { env } from "cloudflare:workers"
import { call } from "./app"
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
  const res = await call("http://local/api/v1/submissions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID().replaceAll("-", ""), "Turnstile-Token": "pass" },
    body: JSON.stringify({ kind: "bench", name_he: name, lat: 31.42, lng: 34.49, consent_version: "notice.submission@2026-10-2" }),
  })
  return res.json<{ id: string; trackingToken: string }>()
}

export const admin = async (path: string, init: RequestInit = {}, email = "dev@example.test", e: Env = env) =>
  call(
    `http://local${path}`,
    {
      ...init,
      headers: {
        "Cf-Access-Jwt-Assertion": await devToken(email),
        "Content-Type": "application/json",
        "Idempotency-Key": crypto.randomUUID().replaceAll("-", ""),
        "Turnstile-Token": "pass",
        "Sec-Fetch-Site": "same-origin",
        ...init.headers,
      },
    },
    e,
  )

export async function approve(id: string) {
  const { items } = await (await admin("/api/admin/queue")).json<{ items: { id: string; rev: number; revisionId: string }[] }>()
  const item = items.find((i) => i.id === id)!
  return admin(`/api/admin/places/${id}/transitions`, {
    method: "POST",
    body: JSON.stringify({ action: "approve", revisionId: item.revisionId, expectedRev: item.rev }),
  })
}

// The site's page as the static assets serve it: the share route rewrites a copy of it.
const SITE = `<!doctype html><html lang="he"><head><meta charset="UTF-8" /><title>מקום לזכור</title>
<meta name="description" content="תיאור האתר" /><meta property="og:title" content="מקום לזכור · שלוש שנים" />
<meta property="og:description" content="תיאור האתר" /><meta property="og:image" content="/og.png" />
</head><body><div id="root"></div></body></html>`
/** The bindings with a stand-in for the built site, which the Worker tests don't have. */
export const withSite: Env = {
  ...env,
  ASSETS: { fetch: async () => new Response(SITE, { headers: { "Content-Type": "text/html" } }) } as unknown as Fetcher,
}
