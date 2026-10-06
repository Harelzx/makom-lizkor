import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { expect, test } from "@playwright/test"

// scripts/edge-check.mjs, the check release.yml runs on production after a deploy, run here against the preview of
// the production build: what the preview has must pass, and what needs the edge (cache, workers.dev, purge timing)
// must say it was skipped, never passed. Signed in through the development stand-in, as a moderator and a stranger.
test.skip(!process.env.E2E_PROD, "the production build's runtime (npm run e2e:prod)")

test("the edge check passes on the production build, and skips only what needs the real edge", async ({ baseURL }) => {
  const { stdout } = await promisify(execFile)("node", ["scripts/edge-check.mjs", baseURL!, "--dev"])
  const lines = Object.fromEntries(
    stdout
      .trim()
      .split("\n")
      .map((l) => [l.split(/\s+/)[1].replace(/:$/, ""), l.split(/\s+/)[0]]),
  )
  expect(lines).toEqual({
    headers: "pass",
    private_no_store: "pass",
    no_shared_hit: "skip",
    purge_freshness: "skip",
    workers_dev_closed: "skip",
  })
})
