// Submitting, uploading and deciding as the browser and the moderator do, shared by the submission tests.
import { env } from "cloudflare:workers"
import { CURRENT_SUBMISSION_NOTICE } from "@/shared/contract"
import { call } from "./app"
import { admin } from "./helpers"

export const seg = (marker: number, payload: number[]) => [0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 0xff, ...payload]
export const jpeg = (fill = 0x55) =>
  new Uint8Array([
    0xff,
    0xd8,
    ...seg(0xc0, [8, 0, 16, 0, 16, 1, 1, 0x11, 0]),
    ...seg(0xda, [1, 1, 0, 0, 63, 0]),
    ...new Array(32).fill(fill),
    0xff,
    0xd9,
  ])
export const send = async (name: string, extra: Record<string, unknown> = {}, key = crypto.randomUUID().replaceAll("-", "")) => {
  const res = await call("http://local/api/v1/submissions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": key, "Turnstile-Token": "pass" },
    body: JSON.stringify({ kind: "bench", name_he: name, lat: 31.42, lng: 34.49, consent_version: CURRENT_SUBMISSION_NOTICE, ...extra }),
  })
  return { status: res.status, ...(await res.json<{ id: string; trackingToken: string }>()) }
}
export const upload = (id: string, token: string, bytes = jpeg(), headers: Record<string, string> = {}) => {
  const form = new FormData()
  form.append("photo", new File([bytes], "p.jpg", { type: "image/jpeg" }))
  form.append("alt", "תיאור דמו")
  form.append("credit", "צלם דמו")
  return sendForm(`http://local/api/v1/submissions/${id}/photo`, token, form, headers)
}
export type Item = { id: string; rev: number; revisionId: string } & Record<string, unknown>
export const queued = async (id: string) =>
  ((await (await admin("/api/admin/queue")).json<{ items: Item[] }>()).items as Item[]).find((i) => i.id === id)!
export const decide = (id: string, item: Item, action: string, note?: string, e: Env = env) =>
  admin(
    `/api/admin/places/${id}/transitions`,
    { method: "POST", body: JSON.stringify({ action, revisionId: item.revisionId, expectedRev: item.rev, ...(note ? { note } : {}) }) },
    undefined,
    e,
  )
export const objects = async (id: string) => (await env.MEDIA.list()).objects.map((o) => o.key).filter((k) => k.includes(id))
export const feed = async () => {
  const v = (await (await call("http://local/api/v1/version")).json<{ v: string }>()).v
  return (await (await call(`http://local/api/v1/feed?v=${v}`)).json<{ places: Record<string, unknown>[] }>()).places
}
export const revise = (id: string, token: string, rev: number, name: string) =>
  call(`http://local/api/v1/submissions/${id}/revisions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "Turnstile-Token": "pass-revise" },
    body: JSON.stringify({ expectedRev: rev, name_he: name, consent_version: CURRENT_SUBMISSION_NOTICE }),
  })
export const rev = async (id: string, token: string) =>
  (await (await call(`http://local/api/v1/submissions/${id}`, { headers: { Authorization: `Bearer ${token}` } })).json<{ rev: number }>())
    .rev

/** A form sent as a browser sends it: serialised, with its Content-Length. */
export async function sendForm(url: string, token: string, form: FormData, headers: Record<string, string> = {}) {
  const encoded = new Request(url, { method: "PUT", body: form })
  const body = await encoded.arrayBuffer()
  return call(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": encoded.headers.get("Content-Type")!,
      "Content-Length": String(body.byteLength),
      ...headers,
    },
    body,
  })
}
