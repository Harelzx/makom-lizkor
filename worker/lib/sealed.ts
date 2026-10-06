// An export is sealed to public keys only: a fresh AES-256-GCM key encrypts it, and that key is wrapped with RSA-OAEP
// for each recipient (the owner, whose private half stays offline, and the drill). Nothing that can open it lives
// next to it, and a recipient is found by its key id, not by trying every one.

/** Where the sealed data is, its checksum, and what opens it: none of it reveals what it holds. */
export type Sealed = { key: string; sha256: string; size: number; iv: string; recipients: { kid: string; wrapped: string }[] }
/** Stored beside each export, unencrypted: counts and checksums from one moment, never a value from a row. */
export type Manifest = {
  format: 1
  id: string
  created_at: string
  retention_run: string
  /** The last migration applied when it was taken, so an import knows which schema it is. */
  schema: string | null
  tables: Record<string, { rows: number; sha256: string }>
  data: Sealed
  files: { key: string; sha256: string; size: number }[]
}

const RSA = { name: "RSA-OAEP", hash: "SHA-256" }
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
export const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")
export const sha256 = async (bytes: Uint8Array) => hex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))

/** A recipient's id: from the public modulus and exponent, the same for its public and private halves. */
export async function keyId(jwk: JsonWebKey) {
  return (await sha256(new TextEncoder().encode(`${jwk.n}.${jwk.e}`))).slice(0, 16)
}

/** The configured recipients (a JSON array of public JWKs); none, or anything unreadable, is none. */
export function publicKeys(config: string | undefined): JsonWebKey[] {
  try {
    const keys = JSON.parse(config || "[]") as unknown
    return Array.isArray(keys) ? keys.filter((k): k is JsonWebKey => !!k && typeof k === "object" && (k as JsonWebKey).kty === "RSA") : []
  } catch {
    return []
  }
}

export async function seal(data: Uint8Array, recipients: JsonWebKey[]) {
  const key = (await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"])) as CryptoKey
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data))
  const raw = new Uint8Array((await crypto.subtle.exportKey("raw", key)) as ArrayBuffer)
  const wrapped = await Promise.all(
    recipients.map(async (jwk) => {
      const pub = await crypto.subtle.importKey("jwk", { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RSA-OAEP-256" }, RSA, false, ["encrypt"])
      return { kid: await keyId(jwk), wrapped: b64(new Uint8Array(await crypto.subtle.encrypt(RSA, pub, raw))) }
    }),
  )
  return { ciphertext, iv: b64(iv), recipients: wrapped }
}

export async function unseal(data: Uint8Array, sealed: Pick<Sealed, "iv" | "recipients">, privateJwk: JsonWebKey): Promise<Uint8Array> {
  const kid = await keyId(privateJwk)
  const mine = sealed.recipients.find((r) => r.kid === kid)
  if (!mine) throw new Error("not_a_recipient")
  // Whatever usages the key was saved with, it is imported here only to unwrap.
  const priv = await crypto.subtle.importKey(
    "jwk",
    { ...privateJwk, key_ops: undefined, ext: undefined, alg: "RSA-OAEP-256" },
    RSA,
    false,
    ["decrypt"],
  )
  const raw = await crypto.subtle.decrypt(RSA, priv, unb64(mine.wrapped))
  const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"])
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(sealed.iv) }, key, data))
}

export async function gzip(bytes: Uint8Array) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer())
}
