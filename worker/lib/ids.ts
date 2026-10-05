const B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

/** A ULID: 10 characters of time, then 16 of randomness, so ids sort by creation. */
export function ulid(ms = Date.now()): string {
  let t = ""
  for (let i = 0, x = ms; i < 10; i++, x = Math.floor(x / 32)) t = B32[x % 32] + t
  let r = ""
  for (const b of crypto.getRandomValues(new Uint8Array(16))) r += B32[b % 32]
  return t + r
}
export const placeId = (ms?: number) => `p_${ulid(ms)}`

/** 128 random bits, base64url: the submitter's tracking capability. Only its hash is stored. */
export function newToken(): string {
  const b = crypto.getRandomValues(new Uint8Array(16))
  return btoa(String.fromCharCode(...b))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
}
export async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("")
}
/** Constant time, so the comparison doesn't leak how much of a hash matched. */
export async function sameHash(a: string, b: string): Promise<boolean> {
  const x = new TextEncoder().encode(a)
  const y = new TextEncoder().encode(b)
  return x.byteLength === y.byteLength && crypto.subtle.timingSafeEqual(x, y)
}

/**
 * What the rate limiters count a visitor's address under: HMAC(secret, "rate:" + address), so Cloudflare's limiter
 * store never holds the address itself (its counters live per Cloudflare location, for an unpublished time).
 */
export async function rateKey(secret: string, address: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`rate:${address}`)))
  return [...mac].map((b) => b.toString(16).padStart(2, "0")).join("")
}
