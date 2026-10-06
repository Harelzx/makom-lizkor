// The site's public address, as the Worker writes it into share pages (og:url, canonical, og:image). Development uses
// the request's own origin; a deploy uses only PUBLIC_ORIGIN, so an unset or wrong one would publish pages that point
// nowhere, or somewhere else.
export function originBlockers(raw) {
  const origin = raw.vars?.PUBLIC_ORIGIN ?? ""
  if (!origin) return ["PUBLIC_ORIGIN is unset in wrangler.jsonc: share pages would carry no address of the site"]
  let url
  try {
    url = new URL(origin)
  } catch {
    return [`PUBLIC_ORIGIN (${origin}) is not an address`]
  }
  if (
    url.protocol !== "https:" ||
    url.origin !== origin ||
    /(^|\.)(example|test|localhost|invalid|example\.(com|net|org)|workers\.dev)$/.test(url.hostname) ||
    url.hostname === "localhost"
  )
    return [`PUBLIC_ORIGIN (${origin}) must be the site's own https origin, with no path or trailing slash`]
  return []
}
