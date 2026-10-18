// A bounded external read-only check. No cookies, credentials, retries, writes or private response bodies.
import { pathToFileURL } from "node:url"
export const PUBLIC_ORIGIN = "https://makomlizkor.org"
async function bytes(response, max) {
  if (!response.body) throw new Error("missing_body")
  const reader = response.body.getReader()
  const chunks = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > max) throw new Error("body_limit")
      chunks.push(value)
    }
  } finally {
    await reader.cancel()
    reader.releaseLock()
  }
  return Buffer.concat(chunks).toString("utf8")
}
export async function publicSmoke(fetcher = fetch) {
  const checks = []
  const signal = AbortSignal.timeout(30_000)
  const get = async (path) => {
    const response = await fetcher(PUBLIC_ORIGIN + path, { redirect: "manual", signal })
    checks.push({ path: path.split("?")[0], status: response.status })
    return response
  }
  const root = await get("/")
  if (root.status !== 200 || !(root.headers.get("content-type") || "").includes("text/html")) throw new Error("root_unavailable")
  if (!(root.headers.get("content-security-policy") || "").includes("object-src 'none'")) throw new Error("csp_missing")
  if (!(await bytes(root, 128 * 1024)).includes('lang="he"')) throw new Error("wrong_document")
  const version = await get("/api/v1/version")
  if (version.status !== 200 || version.headers.get("cache-control") !== "no-store") throw new Error("version_unavailable")
  const v = JSON.parse(await bytes(version, 4096)).v
  if (typeof v !== "string" || v.length > 128) throw new Error("version_invalid")
  let feed = await get("/api/v1/feed?v=" + encodeURIComponent(v))
  // One fresh public version handoff is allowed if publication changed between the two requests.
  if (feed.status === 409) {
    const next = JSON.parse(await bytes(feed, 4096)).v
    if (typeof next !== "string" || next.length > 128) throw new Error("version_invalid")
    feed = await get("/api/v1/feed?v=" + encodeURIComponent(next))
  }
  if (feed.status !== 200 || feed.headers.get("cache-control") !== "no-store") throw new Error("feed_unavailable")
  const data = JSON.parse(await bytes(feed, 2 * 1024 * 1024))
  if (!Array.isArray(data.places) || !data.places.length) throw new Error("feed_empty")
  for (const path of ["/admin/", "/api/admin/pending", "/api/ops", "/api/health"]) {
    const response = await get(path)
    const location = response.headers.get("location")
    await response.body?.cancel()
    if (![302, 303].includes(response.status) || !location) throw new Error("private_boundary_failed")
    const login = new URL(location)
    if (login.protocol !== "https:" || !login.hostname.endsWith(".cloudflareaccess.com")) throw new Error("private_boundary_failed")
  }
  return { ok: true, checks, public_count: data.places.length }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(JSON.stringify(await publicSmoke()))
  } catch {
    // A provider's exception text or redirect never becomes a CI log entry.
    console.error("Public availability or privacy boundary check failed; inspect the live public endpoints and Access policy.")
    process.exitCode = 1
  }
}
