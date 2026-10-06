// node --test scripts/release-backup.test.mjs
import assert from "node:assert/strict"
import { test } from "node:test"
import { backupBlockers } from "./release-backup.mjs"

const pub = { kty: "RSA", n: "synthetic", e: "AQAB" }
const ready = (over = {}) => ({
  vars: { EXPORT_PUBLIC_KEYS: JSON.stringify([pub, pub]) },
  d1_databases: [{ binding: "DB" }, { binding: "DRILL_DB" }],
  r2_buckets: [{ binding: "EXPORTS", jurisdiction: "eu" }],
  ...over,
})

test("two public keys, the drill's database and an EU export bucket pass", () => {
  assert.deepEqual(backupBlockers(ready()), [])
})
test("no keys, one key, or something that isn't a list blocks", () => {
  for (const k of ["", "[]", JSON.stringify([pub]), "{", JSON.stringify(pub)])
    assert.equal(backupBlockers(ready({ vars: { EXPORT_PUBLIC_KEYS: k } })).length, 1, k)
})
test("a private key in the deploy vars blocks", () => {
  const blockers = backupBlockers(ready({ vars: { EXPORT_PUBLIC_KEYS: JSON.stringify([pub, { ...pub, d: "secret" }]) } }))
  assert.equal(blockers.length, 1)
  assert.match(blockers[0], /private key/)
})
test("no drill database, no export bucket, or a bucket outside the EU blocks", () => {
  assert.equal(backupBlockers(ready({ d1_databases: [{ binding: "DB" }] })).length, 1)
  assert.equal(backupBlockers(ready({ r2_buckets: [] })).length, 1)
  assert.equal(backupBlockers(ready({ r2_buckets: [{ binding: "EXPORTS" }] })).length, 1)
})
