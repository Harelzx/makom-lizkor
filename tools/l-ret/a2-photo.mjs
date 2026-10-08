// L-RET E2 (a112): one synthetic place with a generated photo, so the export prune's photo branch can be watched on the
// real platform. create: submitted, photo attached, approved (published), so the next export copies its photo; withdraw
// (after that export, before the one after it): the place and its photo end, later manifests stop listing the copy,
// and the 35-staged-day prune deletes it while the copy younger manifests still list stays. The tracking link is kept
// in a private file of this scratchpad, never printed and never in the receipt.
//   MACHINE='{…}' NOTICE=… EXPECT_TAG=staging-<sha12> node tools/l-ret/a2-photo.mjs <base-url> create <receipt.json> <photo.jpg>
//   MACHINE='{…}' EXPECT_TAG=staging-<sha12> node tools/l-ret/a2-photo.mjs <base-url> withdraw <receipt.json>
import { readFileSync, writeFileSync } from "node:fs"

import { stagingRequester, stagingOrigin } from "./guards.mjs"

const [base, mode, out, photoPath] = process.argv.slice(2)
const machine = JSON.parse(process.env.MACHINE ?? "null")
const { NOTICE, EXPECT_TAG } = process.env
if (!base || !mode || !out || !machine?.["CF-Access-Client-Id"] || !EXPECT_TAG) throw new Error("usage: see the header")
const tokenFile = `${out}.token`
const key = () => crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "").slice(0, 8)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ask = stagingRequester(base, machine, EXPECT_TAG)
// Check the read-only endpoint before the first state-changing request.
if ((await ask("/api/v1/health")).status !== 200) throw new Error("Staging health check failed")

if (mode === "create") {
  if (!NOTICE || !photoPath) throw new Error("create needs NOTICE and the photo")
  const marker = `A2P-${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`
  const s = await ask("/api/v1/submissions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": key(), "Turnstile-Token": "XXXX.DUMMY.TOKEN.XXXX" },
    body: JSON.stringify({ kind: "bench", name_he: `[סינתטי] עם תמונה ${marker}`, lat: 31.41, lng: 34.48, consent_version: NOTICE }),
  })
  if (s.status !== 201) throw new Error(`submission answered ${s.status}`)
  const id = s.body.id
  writeFileSync(tokenFile, s.body.trackingToken, { mode: 0o600, flag: "wx" })
  const form = new FormData()
  form.set("photo", new File([readFileSync(photoPath)], "synthetic.jpg", { type: "image/jpeg" }))
  form.set("alt", `[סינתטי] תמונה מחוללת ${marker}`)
  const encoded = new Response(form)
  const bytes = new Uint8Array(await encoded.arrayBuffer())
  const p = await ask(`/api/v1/submissions/${id}/photo`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${s.body.trackingToken}`,
      "Content-Type": encoded.headers.get("Content-Type"),
      "Content-Length": String(bytes.length),
    },
    body: bytes,
  })
  if (p.status !== 200) throw new Error(`photo answered ${p.status} ${JSON.stringify(p.body)}`)
  let item
  for (let i = 0; i < 30 && !item; i++) {
    item = (await ask("/api/admin/queue")).body?.items?.find((x) => x.id === id)
    if (!item) await sleep(1000)
  }
  if (!item) throw new Error(`${id} never reached the queue`)
  const a = await ask(`/api/admin/places/${id}/transitions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Sec-Fetch-Site": "same-origin" },
    body: JSON.stringify({ action: "approve", revisionId: item.revisionId, expectedRev: item.rev }),
  })
  if (a.status !== 200) throw new Error(`approve answered ${a.status}`)
  const receipt = { marker, base, id, created: new Date().toISOString(), createdTag: EXPECT_TAG, approved: new Date().toISOString() }
  writeFileSync(out, JSON.stringify(receipt, null, 1))
  console.log(`photo place ${id} approved at ${receipt.approved}; marker ${marker}`)
} else if (mode === "withdraw") {
  const receipt = JSON.parse(readFileSync(out, "utf8"))
  if (stagingOrigin(receipt.base) !== stagingOrigin(base)) throw new Error("Receipt is not for staging")
  const w = await ask(`/api/v1/submissions/${receipt.id}/withdraw`, {
    method: "POST",
    headers: { Authorization: `Bearer ${readFileSync(tokenFile, "utf8").trim()}` },
  })
  if (w.status !== 200 || w.body?.status !== "withdrawn") throw new Error(`withdrawal answered ${w.status} ${JSON.stringify(w.body)}`)
  receipt.withdrawn = new Date().toISOString()
  receipt.withdrawnTag = EXPECT_TAG
  receipt.withdrawFiles = w.body.files ?? "erased"
  writeFileSync(out, JSON.stringify(receipt, null, 1))
  console.log(`photo place ${receipt.id} withdrawn at ${receipt.withdrawn} (files: ${receipt.withdrawFiles})`)
} else throw new Error(`unknown mode ${mode}`)
