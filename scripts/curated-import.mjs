// The curated importer (phase 7, task 2): a client of the moderators' route, never SQL (adviser a50, P7-IMPORT-1).
// Each record goes through POST /api/admin/places as a moderator's create would, with its validation, source rule,
// idempotency and ledger; a place that already exists is skipped whole, so a second run never touches a place since
// hidden or edited. The same code seeds the dev server, the e2e state and the Worker's tests (in process, through
// app.fetch), and, once Harel approves the selection, production.

/**
 * @param {{
 *   fetch: (url: string, init?: RequestInit) => Promise<Response>,
 *   base: string,
 *   records: any[],
 *   readPhoto: (file: string) => Promise<{ file: Uint8Array, thumb: Uint8Array, name: string }>,
 *   headers: Record<string, string>,
 * }} options
 */
export async function importCurated({ fetch, base, records, readPhoto, headers }) {
  const auth = { ...headers, "Sec-Fetch-Site": "same-origin" }
  const exists = async (id) => {
    const res = await fetch(`${base}/api/admin/places/${encodeURIComponent(id)}`, { headers: auth })
    if (res.status === 200) return true
    if (res.status === 404) return false
    throw new Error(`${id}: ${res.status} ${await res.text()}`)
  }
  const created = []
  const skipped = []
  for (const record of records) {
    // Asked first, so a place that exists costs no upload: its photos would only wait in quarantine to be swept.
    if (await exists(record.id)) {
      skipped.push(record.id)
      continue
    }
    const photos = []
    for (const { file, ...meta } of record.photos) {
      const bytes = await readPhoto(file)
      const form = new FormData()
      form.set("place_id", record.id)
      form.set("file", new File([bytes.file], bytes.name))
      form.set("thumb", new File([bytes.thumb], `thumb-${bytes.name}`))
      const res = await fetch(`${base}/api/admin/curated-photos`, { method: "POST", body: form, headers: auth })
      if (res.status !== 201) throw new Error(`${record.id}: ${res.status} ${await res.text()}`)
      photos.push({ ...meta, ...(await res.json()) })
    }
    // A fresh key each attempt: a retry after a lost answer finds the place made (409 at rev 0) and skips it.
    const res = await fetch(`${base}/api/admin/places`, {
      method: "POST",
      body: JSON.stringify({ ...record, expectedRev: 0, photos }),
      headers: { ...auth, "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID().replaceAll("-", "") },
    })
    if (res.status === 201) created.push(record.id)
    else if (res.status === 409 && (await exists(record.id))) skipped.push(record.id)
    else throw new Error(`${record.id}: ${res.status} ${await res.text()}`)
  }
  return { created, skipped }
}
