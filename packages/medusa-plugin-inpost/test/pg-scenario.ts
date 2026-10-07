/**
 * THE SQL AGAINST A REAL POSTGRES, as one scenario any runner can drive (not
 * a test itself: the runner picks up `*.test.ts` only). `postgres.test.ts`
 * runs it on a scratch schema when `INPOST_TEST_PG_URL` is set.
 *
 *   1. the migration, twice: the tables, their columns as the models define
 *      them, the unique indexes;
 *   2. every statement of the store with the rules it exists for: one row per
 *      fulfillment, one claim, a finish only for the claim's owner, state
 *      transitions only from the allowed states, the compare and set of a
 *      status, one purchase, one pickup, one mark, expired leases, deduped
 *      history rows, settings written once or upserted, the counters.
 */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { Migration20261007120000 } from "../src/modules/inpost/migrations/Migration20261007120000.ts"
import { createSqlStore, type NewParcel, type SqlRunner } from "../src/modules/inpost/lib/store.ts"

export interface PgScenarioDeps {
  sql: SqlRunner & { raw(sql: string, bindings?: readonly unknown[]): Promise<unknown> }
  reset(): Promise<void>
}

const rows = <T>(result: unknown): T[] => ((result as { rows?: T[] }).rows ?? []) as T[]

/** The column names a model file defines, read from its source. */
function modelColumns(file: string): string[] {
  const text = readFileSync(new URL(`../src/modules/inpost/models/${file}`, import.meta.url), "utf8")
  return [...text.matchAll(/^\s+([a-z_]+): model\./gm)].map((m) => m[1])
}

async function migrate(sql: PgScenarioDeps["sql"]): Promise<void> {
  const statements: string[] = []
  await Migration20261007120000.prototype.up.call({ addSql: (s: string) => statements.push(s) })
  for (const s of statements) await sql.raw(s)
}

function parcel(over: Partial<NewParcel> = {}): NewParcel {
  return {
    order_id: "order_1",
    display_id: 1042,
    fulfillment_id: "ful_1",
    demo: false,
    option_id: "inpost-paczkomat-cod",
    kind: "locker",
    cod: true,
    service: "inpost_locker_standard",
    locker_code: "KSP01M",
    locker_name: "Paczkomat KSP01M",
    locker_address: { line1: "ul. Narzędziowa 12", line2: "00-950 Warszawa", city: "Warszawa", post_code: "00-950" },
    parcel_size: "small",
    parcel_no: 1,
    currency: "PLN",
    state: "pending",
    ...over,
  }
}

export async function pgScenario(deps: PgScenarioDeps): Promise<void> {
  const { sql } = deps
  await deps.reset()

  /* 1. The migration, twice, and the columns of the models. */
  await migrate(sql)
  await migrate(sql)
  for (const [table, file] of [
    ["inpost_parcel", "inpost-parcel.ts"],
    ["inpost_parcel_event", "inpost-parcel-event.ts"],
    ["inpost_setting", "inpost-setting.ts"],
  ] as const) {
    const columns = rows<{ column_name: string }>(
      await sql.raw(`select column_name from information_schema.columns where table_schema = current_schema() and table_name = ?`, [table]),
    ).map((r) => r.column_name)
    for (const c of [...modelColumns(file), "created_at", "updated_at", "deleted_at"]) assert.ok(columns.includes(c), `${table}.${c}`)
  }

  let n = 0
  const store = createSqlStore({ sql, newId: (prefix) => `${prefix}_${String(++n).padStart(4, "0")}` })

  /* 2. One row per fulfillment and mode. */
  const row = await store.insertIgnore(parcel({ problems: [{ code: "locker_missing" }] }))
  assert.ok(row)
  assert.equal(row.state, "pending")
  assert.deepEqual(row.locker_address, { line1: "ul. Narzędziowa 12", line2: "00-950 Warszawa", city: "Warszawa", post_code: "00-950" })
  assert.deepEqual(row.problems, [{ code: "locker_missing" }])
  assert.equal(await store.insertIgnore(parcel()), null, "the unique index refuses a second row for the fulfillment")
  const demoRow = await store.insertIgnore(parcel({ demo: true }))
  assert.ok(demoRow, "a demo row of the same fulfillment is another row")

  /* One claim, a finish only for its owner. */
  const now = new Date()
  const lease = new Date(now.getTime() + 120_000)
  const claimed = await store.claim(row.id, { token: "t1", now, leaseUntil: lease })
  assert.equal(claimed?.state, "creating")
  assert.equal(claimed?.attempts, 1)
  assert.equal(await store.claim(row.id, { token: "t2", now, leaseUntil: lease }), null, "a second claim gets nothing")
  assert.equal(await store.finish(row.id, "t2", { state: "created" }), false, "only the owner of the claim finishes")
  assert.equal(
    await store.finish(row.id, "t1", { state: "created", shipment_id: "1001", status: "created", status_at: now, cod_minor: 19999, reference: "Order 1042", problems: null, offer: null }),
    true,
  )

  /* The compare and set of a status. */
  const first = await store.applyStatus(row.id, "created", { status: "offers_prepared", offer: { id: "7", rate: 13.99 }, at: now })
  assert.equal(first?.status, "offers_prepared")
  assert.deepEqual(first?.offer, { id: "7", rate: 13.99 })
  assert.equal(await store.applyStatus(row.id, "created", { status: "offers_prepared", at: now }), null, "a stale reader changes nothing")
  assert.equal(await store.applyStatus(row.id, "offers_prepared", { status: "offers_prepared", at: now }), null, "the same status is no change")

  /* One purchase per ten minutes. */
  assert.ok(await store.claimBuy(row.id, now))
  assert.equal(await store.claimBuy(row.id, new Date(now.getTime() + 60_000)), null)
  assert.ok(await store.claimBuy(row.id, new Date(now.getTime() + 11 * 60_000)), "a later try may buy again")
  const confirmed = await store.applyStatus(row.id, "offers_prepared", { status: "confirmed", tracking_number: "600000000000000000001042", at: now })
  assert.equal(confirmed?.tracking_number, "600000000000000000001042")
  assert.deepEqual(confirmed?.offer, { id: "7", rate: 13.99 }, "no offer in the update keeps the last one")

  /* One pickup per shipment. */
  assert.deepEqual(await store.claimDispatch([row.id, demoRow.id], now), [row.id], "only confirmed shipments")
  assert.deepEqual(await store.claimDispatch([row.id], now), [], "never two pickups")
  await store.transition(row.id, ["created"], { dispatch_state: "failed", dispatch_error: "x" })
  assert.deepEqual(await store.claimDispatch([row.id], now), [row.id], "a failed pickup may be ordered again")

  /* One mark per fulfillment, released with its error. */
  assert.equal(await store.claimMark(row.id, "shipped_marked_at", now), true)
  assert.equal(await store.claimMark(row.id, "shipped_marked_at", now), false)
  await store.releaseMark(row.id, "shipped_marked_at", "Medusa refused")
  assert.equal(await store.claimMark(row.id, "shipped_marked_at", now), true)

  /* Transitions only from the allowed states; the counters. */
  assert.equal(await store.transition(row.id, ["pending"], { state: "skipped" }), null)
  assert.equal((await store.transition(demoRow.id, ["pending", "failed"], { state: "skipped", skip_reason: "manual" }))?.state, "skipped")
  await store.touch(row.id, now)
  const live = await store.counts(false)
  assert.deepEqual(live, [{ state: "created", status: "confirmed", count: 1 }])
  assert.deepEqual(await store.counts(true), [{ state: "skipped", status: null, count: 1 }])

  /* Expired leases become unknown, never pending. */
  const stuck = await store.insertIgnore(parcel({ fulfillment_id: "ful_2" }))
  assert.ok(stuck)
  await store.claim(stuck.id, { token: "t3", now, leaseUntil: new Date(now.getTime() - 1000) })
  assert.equal(await store.expireLeases(now, true), 0, "the other mode is left alone")
  assert.equal(await store.expireLeases(now, false), 1)
  assert.equal((await store.transition(stuck.id, ["unknown"], { error_code: "adopted" }))?.state, "unknown")

  /* History rows, deduplicated; pruning. */
  const event = { parcel_id: row.id, order_id: "order_1", shipment_id: "1001", kind: "webhook", status: "confirmed", source: "webhook", data: { event: "shipment_confirmed" }, dedupe_key: "webhook:1", demo: false }
  const receipt = await store.insertEvent(event)
  assert.deepEqual(receipt?.data, { event: "shipment_confirmed" })
  assert.equal(await store.insertEvent(event), null, "a repeated delivery is one row")
  assert.ok(await store.insertEvent({ ...event, dedupe_key: null }))
  assert.ok(await store.insertEvent({ ...event, dedupe_key: null }), "rows without a key are never deduplicated")
  await store.insertEvent({ ...event, dedupe_key: null, occurred_at: new Date(now.getTime() - 200 * 86_400_000) })
  assert.equal(await store.pruneEvents(new Date(now.getTime() - 120 * 86_400_000)), 1)

  /* Settings: upserted with who, or claimed once. */
  const s1 = await store.setSetting("live:writer:shipment", { on: true }, "user_1")
  const s2 = await store.setSetting("live:writer:shipment", { on: false }, "user_2")
  assert.equal(s1?.id, s2?.id, "one row per key")
  assert.deepEqual(s2?.value, { on: false })
  assert.equal(s2?.updated_by, "user_2")
  assert.equal(await store.claimSetting("demo:seeded", { orders: 16 }), true)
  assert.equal(await store.claimSetting("demo:seeded", { orders: 16 }), false, "the demo is seeded once")
}
