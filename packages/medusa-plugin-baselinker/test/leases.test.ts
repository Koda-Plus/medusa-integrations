/**
 * Leases in `baselinker_setting`: one run of a job and one worker per record
 * across processes. Two processes are two callers on the same table (the
 * unique index on key and mode decides), a dead process is a lease whose time
 * ran out, and a failing store is an error, never a quiet "busy".
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { LockUnavailableError, leaseIsLive, releaseLease, renewLease, takeLease } from "../src/workflows/baselinker/leases.ts"
import { activeRunKinds, exclusive, isLockConflict, withLock } from "../src/workflows/baselinker/runtime.ts"
import { fakeContainer, fakeService } from "./fakes.ts"

const live = { apiToken: "t0ken-t0ken-t0ken", inventoryId: 1, warehouseId: "bl_1", orderStatusId: 1 }

test("two processes, one lease: the second waits until the first gives it back", async () => {
  const { svc, table } = fakeService(live)
  const a = await takeLease(svc, "lease:job:catalog")
  assert.ok(a)
  assert.equal(await takeLease(svc, "lease:job:catalog"), null)
  assert.equal(await renewLease(svc, a), true)
  await releaseLease(svc, a)
  assert.equal(table("Settings").rows.length, 0)
  assert.ok(await takeLease(svc, "lease:job:catalog"))
})

test("a lease whose process died is taken over; the old holder can no longer renew it", async () => {
  const { svc, table } = fakeService(live)
  const old = await takeLease(svc, "lease:lock:baselinker:order:order_1", 10)
  assert.ok(old)
  await new Promise((r) => setTimeout(r, 20))
  assert.equal(leaseIsLive(table("Settings").rows[0].value, new Date()), false)
  const fresh = await takeLease(svc, "lease:lock:baselinker:order:order_1")
  assert.ok(fresh)
  assert.notEqual(fresh.id, old.id)
  assert.equal(await renewLease(svc, old), false, "its row is gone")
  assert.equal(table("Settings").rows.length, 1)
})

test("leases of the demo and of a real account never meet", async () => {
  const demo = fakeService({ demo: true })
  const real = fakeService(live)
  /* One table for both, as in one database. */
  real.tables.Settings = demo.table("Settings")
  assert.ok(await takeLease(demo.svc, "lease:job:orders"))
  assert.ok(await takeLease(real.svc, "lease:job:orders"))
})

test("a store that does not answer is LockUnavailableError, never null", async () => {
  const { svc } = fakeService(live)
  svc.listBaseLinkerSettings = async () => {
    throw new Error("connection terminated")
  }
  await assert.rejects(() => takeLease(svc, "lease:job:orders"), LockUnavailableError)
})

test("exclusive: a failing lock store is an error run in the history and in the log; nothing runs", async () => {
  const f = fakeService(live)
  f.svc.listBaseLinkerSettings = async () => {
    throw new Error("connection terminated")
  }
  let ran = false
  const out = await exclusive(fakeContainer({ baselinker: f.svc }), "orders", async () => {
    ran = true
    return 1
  })
  assert.equal(out, null)
  assert.equal(ran, false)
  const run = f.table("SyncRuns").rows[0]
  assert.equal(run.status, "error")
  assert.match(String(run.message), /lock store did not answer/)
  assert.ok(f.logs.some((l) => l.startsWith("error") && l.includes("orders")))
})

test("the marketplace reference also goes through the Locking module: a holder there means busy, a failing provider is an error", async () => {
  const f = fakeService(live)
  const conflict = fakeContainer({
    baselinker: f.svc,
    locking: {
      acquire: async () => {
        throw new Error('Failed to acquire lock for key "marketplace-order-ref:allegro:x"')
      },
      release: async () => true,
    },
  })
  assert.equal(await withLock(conflict, "marketplace-order-ref:allegro:x", async () => "done"), null)
  assert.equal(f.table("Settings").rows.length, 0, "our lease is given back")

  const broken = fakeContainer({
    baselinker: f.svc,
    locking: {
      acquire: async () => {
        throw new Error("connect ECONNREFUSED 127.0.0.1:6379")
      },
      release: async () => true,
    },
  })
  await assert.rejects(() => withLock(broken, "marketplace-order-ref:allegro:x", async () => "done"), LockUnavailableError)

  let acquired = 0
  const free = fakeContainer({ baselinker: f.svc, locking: { acquire: async () => void (acquired += 1), release: async () => true } })
  assert.equal(await withLock(free, "marketplace-order-ref:allegro:x", async () => "done"), "done")
  assert.equal(await withLock(free, "baselinker:order:order_1", async () => "done"), "done")
  assert.equal(acquired, 1, "only the shared key goes through the Locking module")
})

test("lock conflicts of the in-memory, Redis and Postgres providers are told apart from failures", () => {
  assert.equal(isLockConflict(new Error('Failed to acquire lock for key "a"')), true)
  assert.equal(isLockConflict(new Error("Timed-out acquiring lock.")), true)
  assert.equal(isLockConflict(new Error("connect ECONNREFUSED 127.0.0.1:6379")), false)
  assert.equal(isLockConflict(new Error("relation \"locking\" does not exist")), false)
})

test("what runs right now comes from the live job leases of every process", async () => {
  const f = fakeService(live)
  f.table("Settings").create({ key: "lease:job:statuses", demo: false, value: { owner: "worker", until: new Date(Date.now() + 60_000).toISOString() } })
  f.table("Settings").create({ key: "lease:job:catalog", demo: false, value: { owner: "dead", until: new Date(Date.now() - 1).toISOString() } })
  f.table("Settings").create({ key: "lease:job:imports", demo: true, value: { owner: "demo", until: new Date(Date.now() + 60_000).toISOString() } })
  assert.deepEqual(await activeRunKinds(f.svc), ["statuses"])
})
