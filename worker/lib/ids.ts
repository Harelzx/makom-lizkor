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
/** When a ULID was made, from its first 10 characters; NaN for anything that isn't one. */
export function ulidTime(id: string): number {
  if (!/^[0-9A-HJKMNP-TV-Z]{10}/.test(id)) return NaN
  let ms = 0
  for (const c of id.slice(0, 10)) ms = ms * 32 + B32.indexOf(c)
  return ms
}

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
 * The part of an address that names one visitor: an IPv4 address whole, an IPv6 address by its /64, since one
 * connection is usually given a whole /64 and could otherwise count as endless visitors. Written forms are normalized
 * (zeros, case, "::"), and an IPv4 address mapped into IPv6 is read as IPv4.
 */
function visitor(address: string): string {
  if (!address.includes(":")) return address
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)
  if (mapped) return mapped[1]
  // A zone (fe80::1%eth0) names an interface on this side, not the visitor.
  const bare = address.split("%")[0]
  const halves = bare.split("::")
  const parts = (s?: string) => (s ? s.split(":") : [])
  const known = [...parts(halves[0]), ...parts(halves[1])]
  // Anything that isn't a well-formed IPv6 address is counted as written: never an error, never merged with others.
  const wellFormed =
    halves.length <= 2 && known.every((g) => /^[0-9a-f]{1,4}$/i.test(g)) && (halves.length === 2 ? known.length <= 7 : known.length === 8)
  if (!wellFormed) return address
  const groups = halves.length === 2 ? [...parts(halves[0]), ...Array(8 - known.length).fill("0"), ...parts(halves[1])] : known
  return `${groups
    .slice(0, 4)
    .map((g) => parseInt(g, 16).toString(16))
    .join(":")}::/64`
}

/**
 * What the rate limiters count a visitor's address under: HMAC(secret, "rate:" + visitor), so Cloudflare's limiter
 * store never holds the address itself (its counters live per Cloudflare location, for an unpublished time).
 */
export async function rateKey(secret: string, address: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`rate:${visitor(address)}`)))
  return [...mac].map((b) => b.toString(16).padStart(2, "0")).join("")
}
