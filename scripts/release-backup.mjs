// The nightly export holds contact details and requests' text, so a public build needs it sealed to real keys and
// restorable (docs/database-definitions.md, "שחזור"). Only what wrangler.jsonc says can be checked here; the bucket's
// lock, its lifecycle rule and the drill's secret are on the go-live checklist.
export function backupBlockers(raw) {
  const blockers = []
  let keys
  try {
    keys = JSON.parse(raw.vars?.EXPORT_PUBLIC_KEYS || "[]")
  } catch {
    return ["EXPORT_PUBLIC_KEYS in wrangler.jsonc is not a JSON list of keys"]
  }
  if (!Array.isArray(keys)) return ["EXPORT_PUBLIC_KEYS in wrangler.jsonc is not a JSON list of keys"]
  const rsa = keys.filter((k) => k && typeof k === "object" && k.kty === "RSA")
  // A private key in a deploy var would let anyone who reads the config open every export.
  if (keys.some((k) => k && typeof k === "object" && ("d" in k || "p" in k || "q" in k)))
    blockers.push("EXPORT_PUBLIC_KEYS holds a private key: only public keys belong in wrangler.jsonc")
  else if (rsa.length < 2)
    blockers.push(
      "EXPORT_PUBLIC_KEYS needs the owner's public key and the drill's: exports can't be opened for a restore, or drilled, without them",
    )
  if (!(raw.d1_databases ?? []).some((d) => d.binding === "DRILL_DB"))
    blockers.push("no DRILL_DB binding in wrangler.jsonc: the weekly restore drill can't run")
  const exportsBucket = (raw.r2_buckets ?? []).find((b) => b.binding === "EXPORTS")
  if (!exportsBucket) blockers.push("no EXPORTS bucket in wrangler.jsonc: nothing is backed up")
  else if (exportsBucket.jurisdiction !== "eu") blockers.push("the EXPORTS bucket isn't in the EU jurisdiction, as the privacy notice says")
  return blockers
}
