// node --test scripts/release-retention-scale.test.mjs
import assert from "node:assert/strict"
import { test } from "node:test"
import { retentionScaleBlockers } from "./release-retention-scale.mjs"

// The staging-only retention day (worker/lib/durations.ts) never ships: a release refuses any value, as the Worker does
// outside staging.
test("a release refuses RETENTION_DAY_SECONDS in the deploy's vars, whatever its value", () => {
  // Whitespace too: the Worker treats only an exactly empty value as unset (L-RET-RELEASE-1, a89).
  for (const v of ["7200", "86400", "x", " ", "\t", "\n", " 7200"])
    assert.match(retentionScaleBlockers({ vars: { RETENTION_DAY_SECONDS: v } })[0], /RETENTION_DAY_SECONDS/)
  assert.deepEqual(retentionScaleBlockers({ vars: { RETENTION_DAY_SECONDS: "" } }), [])
  assert.deepEqual(retentionScaleBlockers({ vars: {} }), [])
})
