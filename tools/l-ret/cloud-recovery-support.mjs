import assert from "node:assert/strict"

// Count statements, not network batches. Leave enough budget to clean every allocated resource.
export function recoveryBudget() {
  return {
    sql: 0,
    http: 0,
    cleaning: false,
    photos: 0,
    reservePhotos(n) {
      assert.ok(Number.isInteger(n) && n >= 0 && n <= 20)
      this.photos = n
    },
    request() {
      assert.ok(this.http + 1 <= 1000 - (this.cleaning ? 0 : 40 + 2 * this.photos), "HTTP cleanup reserve")
      this.http++
    },
    statements(body) {
      const list = body.batch ?? [body]
      assert.ok(list.length && list.every((x) => typeof x.sql === "string" && !x.sql.includes(";")), "One SQL statement per entry")
      assert.ok(this.sql + list.length <= 1000 - (this.cleaning ? 0 : 30), "SQL cleanup reserve")
      this.sql += list.length
    },
  }
}
export function cloudD1(execute) {
  const prepare = (sql, params = []) => ({
    sql,
    params,
    bind(...values) {
      return prepare(sql, values)
    },
    async all() {
      return (await execute({ sql, params }))[0]
    },
    async run() {
      return this.all()
    },
    async first(column) {
      const row = (await this.all()).results[0] ?? null
      return column ? (row?.[column] ?? null) : row
    },
  })
  return { prepare, batch: (statements) => execute({ batch: statements.map(({ sql, params }) => ({ sql, params })) }) }
}
export function queryResults(reply, count) {
  assert.ok(
    reply.success &&
      Array.isArray(reply.result) &&
      reply.result.length === count &&
      reply.result.every((x) => x.success && Array.isArray(x.results)),
    "D1 batch response refused or incomplete",
  )
  return reply.result
}
// Deliberately conservative: reserve two pages per row plus one per index, and duplicate all row bytes per index.
export function targetSizeUpperBound(base, tables, indexes) {
  return (
    base +
    Object.entries(tables).reduce(
      (sum, [name, rows]) =>
        sum + rows.reduce((n, row) => n + Buffer.byteLength(JSON.stringify(row)) * (1 + indexes[name]) + 4096 * (2 + indexes[name]), 0),
      0,
    )
  )
}
export async function cleanupRecovery({ db, tables, allocated, remove, absent, mayContainExercise, wasEmpty, save = () => {} }) {
  const result = { database: wasEmpty && !mayContainExercise ? "empty" : "unverified", media: [], errors: [] }
  if (mayContainExercise) {
    try {
      await db.batch([...tables].reverse().map((t) => db.prepare(`DELETE FROM ${t}`)))
    } catch {
      result.errors.push("database_delete")
    }
    try {
      const counts = await db.batch(tables.map((t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`)))
      result.database = counts.every((r) => r.results[0]?.n === 0) ? "empty" : "not_empty"
    } catch {
      result.errors.push("database_check")
    }
  }
  await save(result)
  for (const key of allocated) {
    let state = "unresolved"
    try {
      await remove(key)
    } catch {
      result.errors.push("media_delete")
    }
    try {
      if (await absent(key)) state = "absent"
    } catch {
      result.errors.push("media_check")
    }
    result.media.push({ key, state })
    await save(result)
  }
  result.complete = result.database === "empty" && result.media.every((x) => x.state === "absent")
  await save(result)
  return result
}
