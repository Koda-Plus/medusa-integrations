import { test } from "node:test"
import assert from "node:assert/strict"
import { TtlCache } from "../src/modules/stripe/lib/cache.ts"

function clock() {
  let t = 0
  return { now: () => t, advance: (ms: number) => (t += ms) }
}

test("a fresh value is served from memory; an old one is read again", async () => {
  const c = clock()
  const cache = new TtlCache(c)
  let loads = 0
  const load = async () => ++loads
  assert.deepEqual(await cache.get("k", load, { ttlMs: 1000 }), { value: 1, at: 0, fresh: true })
  c.advance(999)
  assert.deepEqual(await cache.get("k", load, { ttlMs: 1000 }), { value: 1, at: 0, fresh: false })
  c.advance(1)
  assert.equal((await cache.get("k", load, { ttlMs: 1000 })).value, 2)
})

test("ten callers at once cause one read", async () => {
  const cache = new TtlCache(clock())
  let loads = 0
  let release: () => void = () => undefined
  const gate = new Promise<void>((r) => (release = r))
  const load = async () => {
    loads += 1
    await gate
    return "value"
  }
  const all = Promise.all(Array.from({ length: 10 }, () => cache.get("k", load, { ttlMs: 1000 })))
  release()
  const hits = await all
  assert.equal(loads, 1)
  assert.ok(hits.every((h) => h.value === "value"))
})

test("a forced refresh is honoured only once the value is old enough", async () => {
  const c = clock()
  const cache = new TtlCache(c)
  let loads = 0
  const load = async () => ++loads
  await cache.get("k", load, { ttlMs: 60_000 })
  c.advance(10_000)
  assert.equal((await cache.get("k", load, { ttlMs: 60_000, force: true, forceMinMs: 30_000 })).value, 1)
  c.advance(25_000)
  const forced = await cache.get("k", load, { ttlMs: 60_000, force: true, forceMinMs: 30_000 })
  assert.equal(forced.value, 2)
  assert.equal(forced.fresh, true)
})

test("a failed read is kept shorter, a thrown error is not kept", async () => {
  const c = clock()
  const cache = new TtlCache(c)
  let loads = 0
  const failing = async () => ({ failed: true, n: ++loads })
  const opts = { ttlMs: 300_000, errorTtlMs: 60_000, isFailure: (v: { failed: boolean }) => v.failed }
  await cache.get("k", failing, opts)
  c.advance(59_000)
  assert.equal((await cache.get("k", failing, opts)).value.n, 1)
  c.advance(1_000)
  assert.equal((await cache.get("k", failing, opts)).value.n, 2)
  await assert.rejects(cache.get("x", async () => Promise.reject(new Error("boom")), { ttlMs: 1000 }))
  assert.equal(cache.peek("x"), null)
})

test("memory is bounded: the oldest entry goes first", async () => {
  const cache = new TtlCache(clock(), 3)
  for (const k of ["a", "b", "c", "d"]) await cache.get(k, async () => k, { ttlMs: 1000 })
  assert.equal(cache.size, 3)
  assert.equal(cache.peek("a"), null)
  assert.equal(cache.peek<string>("d")?.value, "d")
})
