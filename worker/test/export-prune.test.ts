import { env } from "cloudflare:workers"
import { describe, expect, it, vi } from "vitest"
import { EXPORT_KEEP_DAYS, pruneExports } from "../db/exports"
import { ulid } from "../lib/ids"

// The 35-day end under a bucket lock (L-RET-LOCK-1, adviser 20261007T175317Z-e8136b2a): a deletion the bucket refuses
// (a copy still under its lock) must not stop the pass, or one young file would hold back every expired file after it,
// night after night. The refused file is counted in the log and left for the nightly check to report; an export is
// recorded deleted only once all its files are.

const DAY = 86_400_000

/** The exports bucket with a lock on some keys: deleting one of them throws, as a locked object's deletion does. */
const locked = (keys: Set<string>) =>
  new Proxy(env.EXPORTS, {
    get(target, prop) {
      if (prop === "delete")
        return async (key: string | string[]) => {
          if ([key].flat().some((k) => keys.has(k))) throw new Error("object locked")
          return target.delete(key)
        }
      const v = Reflect.get(target, prop)
      return typeof v === "function" ? v.bind(target) : v
    },
  })

describe("the 35-day end when the bucket refuses a deletion (L-RET-LOCK-1)", () => {
  it("deletes every other expired export and unlisted copy, logs the refusals by count, and keeps the refused export's record open", async () => {
    const now = Date.now()
    const old = now - (EXPORT_KEEP_DAYS + 2) * DAY
    // Two expired exports; the first, in listing order, has a file the bucket refuses to delete.
    const stuck = `ex_${ulid(old)}`
    const done = `ex_${ulid(old + 1000)}`
    for (const id of [stuck, done]) {
      await env.DB.prepare("INSERT INTO exports (id, created_at, retention_run, ok) VALUES (?, ?, 'rr_test', 1)")
        .bind(id, new Date(old).toISOString())
        .run()
      for (const name of ["manifest.json", "data.sealed"]) await env.EXPORTS.put(`exports/${id}/${name}`, "x")
    }
    // Two photo copies no manifest lists, both a day old by the pass's clock; the first, in listing order, is locked.
    const young = `photos/${"0".repeat(64)}`
    const orphan = `photos/${"f".repeat(64)}`
    for (const key of [young, orphan]) await env.EXPORTS.put(key, "y")

    const warn = vi.spyOn(console, "warn")
    const refused = new Set([`exports/${stuck}/data.sealed`, young])
    await expect(pruneExports({ db: env.DB, exports: locked(refused) }, new Date(now + 2 * DAY))).resolves.not.toThrow()
    const lines = warn.mock.calls.map((c) => JSON.parse(String(c[0]))).filter((l) => l.event === "export_prune_refused")
    warn.mockRestore()

    expect(await env.EXPORTS.head(`exports/${done}/manifest.json`)).toBeNull()
    expect(await env.EXPORTS.head(`exports/${done}/data.sealed`)).toBeNull()
    expect(await env.EXPORTS.head(orphan)).toBeNull()
    // What the bucket refused is still there, and said so.
    expect(await env.EXPORTS.head(`exports/${stuck}/data.sealed`)).not.toBeNull()
    expect(await env.EXPORTS.head(young)).not.toBeNull()
    expect(lines).toEqual([{ level: "warn", event: "export_prune_refused", counts: { exports: 1, photos: 1 } }])
    const deleted = async (id: string) =>
      (await env.DB.prepare("SELECT deleted_at AS d FROM exports WHERE id = ?").bind(id).first<string | null>("d")) !== null
    expect(await deleted(done)).toBe(true)
    expect(await deleted(stuck)).toBe(false)

    // Once the lock lets go, the next pass finishes the export and records it.
    await pruneExports({ db: env.DB, exports: env.EXPORTS }, new Date(now + 3 * DAY))
    expect(await env.EXPORTS.head(`exports/${stuck}/data.sealed`)).toBeNull()
    expect(await env.EXPORTS.head(young)).toBeNull()
    expect(await deleted(stuck)).toBe(true)
  })
})
