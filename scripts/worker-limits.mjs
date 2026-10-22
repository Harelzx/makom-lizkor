// The production Worker's invocations that Cloudflare stopped at a limit (CPU or memory: "exceededResources") or that
// threw past the app's own handlers, over the last hours. Only totals by status: nothing about a request or a visitor.
// Read-only (a token with Account Analytics: Read alone), and independent of the Worker and of the site's mail: a
// failed run reaches the owner through GitHub's own notification.
//   CF_ANALYTICS_READ=… CF_ACCOUNT_ID=… node scripts/worker-limits.mjs
import { pathToFileURL } from "node:url"

export const SCRIPT = "makom-lizkor"
// The schedule is six-hourly; an hour more covers analytics that arrive late and a run that starts late.
export const WINDOW_HOURS = 7
export const STOPPED = ["exceededResources", "scriptThrewException"]
const QUERY = `query ($account: string!, $script: string!, $since: Time!) {
  viewer {
    accounts(filter: { accountTag: $account }) {
      workersInvocationsAdaptive(limit: 100, filter: { scriptName: $script, datetime_geq: $since }) {
        dimensions { status }
        sum { requests }
      }
    }
  }
}`

export async function workerLimits({ token, account, now = Date.now(), fetcher = fetch }) {
  if (!token || !account) throw new Error("credentials_missing")
  const since = new Date(now - WINDOW_HOURS * 3_600_000).toISOString()
  const response = await fetcher("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ query: QUERY, variables: { account, script: SCRIPT, since } }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error("analytics_unavailable")
  const body = await response.json()
  const rows = body?.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive
  if (body?.errors?.length || !Array.isArray(rows)) throw new Error("analytics_unreadable")
  const counts = {}
  for (const row of rows) {
    const status = String(row?.dimensions?.status ?? "")
    const requests = Number(row?.sum?.requests)
    if (!/^[a-zA-Z]{1,40}$/.test(status) || !Number.isFinite(requests)) throw new Error("analytics_unreadable")
    counts[status] = (counts[status] ?? 0) + requests
  }
  const stopped = STOPPED.reduce((n, s) => n + (counts[s] ?? 0), 0)
  return { ok: stopped === 0, since, stopped, counts }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await workerLimits({ token: process.env.CF_ANALYTICS_READ, account: process.env.CF_ACCOUNT_ID })
    console.log(JSON.stringify(result))
    if (!result.ok)
      console.error(
        `The Worker was stopped or threw ${result.stopped} times since ${result.since}; see the Worker's Metrics > Errors in Cloudflare.`,
      )
    process.exitCode = result.ok ? 0 : 1
  } catch (error) {
    // Only our own error codes: the token never reaches the log.
    console.error(`Worker limits could not be read (${/^[a-z_]+$/.test(error?.message) ? error.message : "request_failed"}).`)
    process.exitCode = 1
  }
}
