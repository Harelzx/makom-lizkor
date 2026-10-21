// A separate release mode for the existing workers.dev host. Legacy custom-domain gates remain unchanged.
// The live deployment controller must retrieve this exact application, policy and complete inventory immediately
// before deployment and before opening the public overrides; a local config or an old receipt cannot establish Access.
import { isDeepStrictEqual } from "node:util"
export const WORKERS_ACCESS = Object.freeze({
  host: "makom-lizkor.makom-staging.workers.dev",
  // The site's own domain since 18 October 2026: a second public destination with the same public paths.
  domain: "makomlizkor.org",
  app: "181c702f-44a3-4906-8c87-41999f7ab289",
  worker: "56bbe4d76b0e41c3bd44e8bc604a6f31",
  aud: "caaf96997451ebbdaa85e6bcf0aec39d94b58a3848bc4314a3bdb1274148f81e",
  owner: "harelzx41@gmail.com",
})
export const PUBLIC_PATHS = Object.freeze([
  "/",
  "/favicon.svg",
  "/og.png",
  "/assets/*",
  "/art/*",
  "/headlines/*",
  "/sound/*",
  "/licenses/fonts/",
  "/licenses/fonts/*",
  "/mail-connection/",
  "/mail-connection/privacy/",
  "/mail-connection/terms/",
  "/place/*",
  "/media/og/*/*",
  "/media/public/*/*",
  "/api/v1/version",
  "/api/v1/feed",
  "/api/v1/contact",
  "/api/v1/submissions",
  "/api/v1/submissions/*",
  // Only visitor tracking capabilities live below this subtree; the Worker checks their tokens.
  "/api/v1/submissions/*/*",
  "/api/v1/email/verify",
  "/api/v1/reports",
  "/api/v1/tributes",
  "/api/csp-report",
])

export function accessDestinations(phase = "protected") {
  if (!["protected", "public"].includes(phase)) throw new Error("Unknown Access phase")
  if (PUBLIC_PATHS.length > 25) throw new Error("Access supports at most 25 overrides per destination")
  const host = (uri) => ({
    type: "public",
    uri,
    ...(phase === "public" ? { overrides: PUBLIC_PATHS.map((path_pattern) => ({ path_pattern, behavior: "public" })) } : {}),
  })
  return [host(WORKERS_ACCESS.host), host(WORKERS_ACCESS.domain), { type: "worker", worker_id: WORKERS_ACCESS.worker }]
}

export function workersAccessProblems(raw, snapshot, { phase = "protected", now = Date.now() } = {}) {
  const out = []
  if (!["protected", "public"].includes(phase)) return ["Unknown Access phase"]
  if (
    raw.name !== "makom-lizkor" ||
    raw.vars?.ENVIRONMENT !== "production" ||
    raw.workers_dev !== true ||
    raw.vars?.PUBLIC_ORIGIN !== `https://${WORKERS_ACCESS.domain}` ||
    raw.vars?.ACCESS_AUD !== WORKERS_ACCESS.aud ||
    raw.vars?.ACCESS_TEAM_DOMAIN !== "makom-staging.cloudflareaccess.com" ||
    raw.vars?.MODERATORS !== WORKERS_ACCESS.owner
  )
    out.push("Production Worker, origin or identity configuration mismatch")
  if (raw.preview_urls !== false) out.push("Preview URLs must remain disabled")
  const at = Date.parse(snapshot?.observed_at)
  if (!Number.isFinite(at) || now - at > 300_000 || at > now + 5_000) out.push("Access snapshot is not fresh")
  for (const n of ["apps", "app", "policies"])
    if (snapshot?.[n]?.success !== true || snapshot[n].status !== 200) out.push(`${n}: API read did not succeed`)
  if (out.length) return out
  const a = snapshot.app.result,
    p = snapshot.policies.result,
    all = snapshot.apps.result,
    info = snapshot.apps.result_info
  if (
    a.id !== WORKERS_ACCESS.app ||
    a.aud !== WORKERS_ACCESS.aud ||
    a.type !== "self_hosted" ||
    a.domain !== WORKERS_ACCESS.host ||
    !isDeepStrictEqual(a.self_hosted_domains, [WORKERS_ACCESS.host, WORKERS_ACCESS.domain])
  )
    out.push("Access application identity mismatch")
  if (!isDeepStrictEqual(a.destinations, accessDestinations(phase)))
    out.push("Access must cover whole Worker with only the exact approved public paths")
  // 720h: the owner signs in once a month on each device (21 October 2026; it was 1h, a new code every hour).
  if (a.session_duration !== "720h" || a.options_preflight_bypass !== false || a.http_only_cookie_attribute !== true)
    out.push("Access session or preflight protection changed")
  if (
    !Array.isArray(p) ||
    p.length !== 1 ||
    p[0].decision !== "allow" ||
    !isDeepStrictEqual(p[0].include, [{ email: { email: WORKERS_ACCESS.owner } }]) ||
    !isDeepStrictEqual(p[0].exclude, []) ||
    !isDeepStrictEqual(p[0].require, []) ||
    (p[0].session_duration && p[0].session_duration !== "720h")
  )
    out.push("Only the named human owner may access protected paths")
  if (!isDeepStrictEqual(a.policies, p)) out.push("Policy readback mismatch")
  if (!Array.isArray(all) || info?.total_pages !== 1 || info?.total_count !== all.length || info?.count !== all.length)
    out.push("Access inventory is incomplete")
  else {
    if (
      !isDeepStrictEqual(
        all.filter((x) => x.id === a.id),
        [a],
      )
    )
      out.push("Inventory and application readback mismatch")
    for (const other of all.filter((x) => x.id !== a.id)) {
      const hosts = [
        other.domain,
        ...(other.self_hosted_domains ?? []),
        ...(other.destinations ?? []).filter((d) => d.type === "public").map((d) => d.uri),
      ].filter(Boolean)
      if (
        hosts.some((h) => {
          const host = h.split("/")[0].toLowerCase()
          return [WORKERS_ACCESS.host, WORKERS_ACCESS.domain].some(
            (ours) => host === ours || host === "*" || (host.startsWith("*.") && ours.endsWith(host.slice(1))),
          )
        }) ||
        (other.destinations ?? []).some(
          (d) =>
            ["all_workers", "all_preview_workers"].includes(d.type) ||
            (["worker", "preview_worker"].includes(d.type) && d.worker_id === WORKERS_ACCESS.worker),
        )
      )
        out.push(`Another application may shadow production: ${other.id}`)
    }
  }
  return out
}
