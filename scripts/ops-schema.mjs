// The /api/ops summary's JSON Schema, committed as worker/lib/ops-summary.schema.json: a Worker test fails when the
// schema and the snapshot differ, and the release manifest flags a change to the snapshot (spec 12.2: any change to
// what /api/ops returns is a review point). Run after changing worker/lib/ops-schema.ts: node scripts/ops-schema.mjs
import { writeFileSync } from "node:fs"
import { z } from "zod"
import { OpsSummary } from "../worker/lib/ops-schema.ts"

writeFileSync(new URL("../worker/lib/ops-summary.schema.json", import.meta.url), JSON.stringify(z.toJSONSchema(OpsSummary), null, 2) + "\n")
console.log("worker/lib/ops-summary.schema.json written")
