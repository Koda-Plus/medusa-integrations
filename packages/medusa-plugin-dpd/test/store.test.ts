/**
 * The atomic store: the SQL checked as text with a recording runner (each
 * decision is one statement with the condition that makes it safe when two
 * processes race, only known column names reach the SQL), the Panel group in
 * SQL checked branch by branch against groupOf, and the memory store of the
 * tests held to the same rules.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { SHIPMENT_STAGES, SHIPMENT_STATES } from "../src/modules/dpd/lib/constants.ts"
import { groupOf } from "../src/modules/dpd/lib/contract.ts"
import { countsOf, rowGroup } from "../src/modules/dpd/lib/dto.ts"
import { createSqlStore, GROUP_SQL, like, PATCHABLE_COLUMNS, searchClause, setClause, type NewShipment, type SqlRunner } from "../src/modules/dpd/lib/store.ts"
import { memoryStore, Table, SHIPMENT_DEFAULTS, type Row } from "./helpers.ts"

function recorder(rows: unknown[] = [{ id: "dpdshp_1" }]) {
  const calls: Array<{ sql: string; bindings: readonly unknown[] }> = []
  const sql: SqlRunner = {
    async raw(text, bindings = []) {
      calls.push({ sql: text.replace(/\s+/g, " ").trim(), bindings })
      return { rows }
    },
  }
  let n = 0
  return { calls, store: createSqlStore({ sql, newId: (p) => `${p}_${++n}` }) }
}

const NEW: NewShipment = {
  order_id: "order_1",
  display_id: 1042,
  fulfillment_id: "ful_1",
  return_id: null,
  kind: "outbound",
  mode: "sandbox",
  option_id: "dpd-pickup",
  service: null,
  pudo_id: "PL14509",
  country_code: "PL",
  session_type: null,
  cod_minor: null,
  currency: "PLN",
  reference: "ful_1",
  state: "pending",
  problems: [{ code: "weight_missing" }],
}

test("insert: one row per fulfillment, kind and mode, the unique index decides (on conflict do nothing)", async () => {
  const { calls, store } = recorder()
  await store.insertIgnore(NEW)
  assert.match(calls[0].sql, /^insert into "dpd_shipment" .* on conflict do nothing returning \*$/)
  assert.equal(calls[0].bindings[0], "dpdshp_1")
  assert.equal(calls[0].bindings[7], "dpd-pickup")
  assert.equal(calls[0].bindings.at(-1), '[{"code":"weight_missing"}]', "json columns go as JSON text")
  assert.ok(!/"(first_name|last_name|phone|email|address_1)"/.test(calls[0].sql), "no receiver data reaches the table")
})

test("transition: only from the given states, only known columns, JSON as jsonb, the reserved word quoted", async () => {
  const { calls, store } = recorder()
  await store.transition("dpdshp_1", ["pending", "failed"], { state: "canceled", references: ["ful_1"], ["claim_token" as never]: "stolen" } as never)
  assert.match(calls[0].sql, /^update "dpd_shipment" set "references" = \?::jsonb, "state" = \?, "updated_at" = now\(\) where "id" = \? and "state" in \(\?, \?\) and "deleted_at" is null returning \*$/)
  assert.deepEqual(calls[0].bindings, ['["ful_1"]', "canceled", "dpdshp_1", "pending", "failed"])
  assert.equal(await store.transition("dpdshp_1", [], { state: "x" }), null)
  const s = setClause({ state: "labeled", ["dropped_table" as never]: "x", attempts: 9 } as never)
  assert.equal(s.sql, `"state" = ?, "updated_at" = now()`, "a column outside the whitelist never reaches the SQL")
  assert.ok(PATCHABLE_COLUMNS.every((c) => /^[a-z_]+$/.test(c)))
  for (const locked of ["id", "order_id", "fulfillment_id", "kind", "mode", "option_id", "claim_token", "lease_until", "attempts"]) assert.ok(!PATCHABLE_COLUMNS.includes(locked), locked)
})

test("events are ignored on a repeated dedupe key; settings are one row per key; the seed key goes to the first caller", async () => {
  const { calls, store } = recorder()
  await store.insertEvent({ shipment_id: "dpdshp_1", order_id: "order_1", kind: "action", message: "x".repeat(3000), dedupe_key: "demo:seed:dpdshp_1", mode: "demo" })
  assert.match(calls[0].sql, /insert into "dpd_event" .* on conflict do nothing returning \*/)
  assert.equal(String(calls[0].bindings[9]).length, 2000, "messages are cut at 2000 characters")
  await store.setSetting("live:writer:shipment", { on: true }, "user_1")
  assert.match(calls[1].sql, /on conflict \("key"\) where "deleted_at" is null do update set "value" = excluded."value", "updated_by" = excluded."updated_by"/)
  await store.claimSetting("demo:seeded", {})
  assert.match(calls[2].sql, /on conflict \("key"\) where "deleted_at" is null do nothing returning "id"/, "the target names the partial unique index of the migration")
  await store.releaseSetting("demo:seeded")
  assert.equal(calls[3].sql, `delete from "dpd_setting" where "key" = ?`, "a hard delete: the next claim wins again")
  assert.deepEqual(calls[3].bindings, ["demo:seeded"])
})

test("counts and lists use one group expression, per mode, newest first, with an escaped search", async () => {
  const { calls, store } = recorder([{ group: "to_create", count: "3" }, { group: "bogus", count: 1 }])
  assert.deepEqual(await store.counts("live"), [{ group: "to_create", count: 3 }], "an unknown group is dropped")
  assert.ok(calls[0].sql.includes(GROUP_SQL.replace(/\s+/g, " ")))
  assert.deepEqual(calls[0].bindings, ["live"])
  await store.list({ mode: "sandbox", filter: "problems", q: "#1042", offset: 20, limit: 10 })
  assert.match(calls[1].sql, /where "mode" = \? and "deleted_at" is null and \(case .* end\) = \? and \("order_id" = \?.*"waybills"::text ilike \?.*"display_id" = \?\) order by "created_at" desc, "id" desc limit \? offset \?$/)
  assert.deepEqual(calls[1].bindings.slice(0, 2), ["sandbox", "problems"])
  assert.deepEqual(calls[1].bindings.slice(-3), [1042, 10, 20])
  assert.match(calls[2].sql, /^select count\(\*\)::int as "count" from "dpd_shipment" where "mode" = \?/)
  await store.list({ mode: "live", filter: "all", q: "", offset: 0, limit: 5 })
  assert.deepEqual(calls[3].bindings, ["live", 5, 0], "all and no search: the mode only")
  assert.equal(like("50%_a\\b"), "%50\\%\\_a\\\\b%")
  assert.equal(searchClause("  "), null)
  assert.equal(searchClause("PL14509")?.bindings.length, 5, "a text is not an order number")
})

/** The CASE of GROUP_SQL, evaluated on one row: each `when` is a conjunction-free test on one column. */
function sqlGroup(row: { kind: string; state: string; stage: string | null; handed_over_at: Date | null }): string {
  const values: Record<string, string | null> = { kind: row.kind, state: row.state, stage: row.stage, handed_over_at: row.handed_over_at ? "x" : null }
  const branches = [...GROUP_SQL.matchAll(/when (.+?) then '([a-z_]+)'/g)]
  for (const [, cond, group] of branches) {
    let m = cond.match(/^"(\w+)" in \((.+)\)$/)
    if (m) {
      const list = [...m[2].matchAll(/'([a-z_]+)'/g)].map((x) => x[1])
      if (values[m[1]] !== null && list.includes(values[m[1]] as string)) return group
      continue
    }
    m = cond.match(/^"(\w+)" = '([a-z_]+)'$/)
    if (m) {
      if (values[m[1]] === m[2]) return group
      continue
    }
    m = cond.match(/^"(\w+)" <> '([a-z_]+)'$/)
    if (m) {
      if (values[m[1]] !== null && values[m[1]] !== m[2]) return group
      continue
    }
    m = cond.match(/^"(\w+)" is not null$/)
    if (m) {
      if (values[m[1]] !== null) return group
      continue
    }
    throw new Error(`unread branch: ${cond}`)
  }
  return GROUP_SQL.match(/else '([a-z_]+)'/)?.[1] ?? "none"
}

test("the group in SQL is groupOf, for every kind, state, stage and handover", () => {
  let checked = 0
  for (const kind of ["outbound", "return"])
    for (const state of SHIPMENT_STATES)
      for (const stage of [null, ...SHIPMENT_STAGES])
        for (const handed of [null, new Date()]) {
          const row = { kind, state, stage, handed_over_at: handed }
          const want = groupOf({ kind: kind as "outbound" | "return", state, stage, handedOver: Boolean(handed) })
          assert.equal(sqlGroup(row), want, JSON.stringify(row))
          assert.equal(rowGroup(row), want)
          checked += 1
        }
  assert.equal(checked, 2 * SHIPMENT_STATES.length * (SHIPMENT_STAGES.length + 1) * 2)
})

test("the memory store keeps the rules: one row per fulfillment, kind and mode; transitions from given states; dedupe; one setting per key", async () => {
  const shipments = new Table("dpdshp", SHIPMENT_DEFAULTS)
  const events = new Table("dpdevt")
  const settings = new Table("dpdset")
  const store = memoryStore(shipments, events, settings)
  const first = await store.insertIgnore(NEW)
  assert.ok(first)
  assert.equal(await store.insertIgnore(NEW), null, "the same fulfillment, kind and mode")
  assert.ok(await store.insertIgnore({ ...NEW, mode: "live" }), "another mode is another row")
  assert.ok(await store.insertIgnore({ ...NEW, kind: "return" }), "a return of the same fulfillment is another row")
  assert.ok(await store.insertIgnore({ ...NEW, fulfillment_id: null }))
  assert.ok(await store.insertIgnore({ ...NEW, fulfillment_id: null }), "rows without a fulfillment never collide")
  assert.equal(await store.transition(String(first.id), ["labeled"], { state: "canceled" }), null)
  const moved = await store.transition(String(first.id), ["pending"], { state: "canceled", ["mode" as never]: "live" } as never)
  assert.equal(moved?.state, "canceled")
  assert.equal(moved?.mode, "sandbox", "a column outside the whitelist is never set")
  assert.ok(await store.insertEvent({ shipment_id: null, order_id: null, kind: "action", dedupe_key: "k", mode: "sandbox" }))
  assert.equal(await store.insertEvent({ shipment_id: null, order_id: null, kind: "action", dedupe_key: "k", mode: "sandbox" }), null)
  assert.ok(await store.insertEvent({ shipment_id: null, order_id: null, kind: "action", mode: "sandbox" }))
  assert.ok(await store.insertEvent({ shipment_id: null, order_id: null, kind: "action", mode: "sandbox" }), "no key, no dedupe")
  await store.setSetting("live:writer:shipment", { on: true }, "user_1")
  await store.setSetting("live:writer:shipment", { on: false }, "user_2")
  assert.equal(settings.rows.length, 1)
  assert.equal((settings.rows[0] as Row).updated_by, "user_2")
  assert.equal(await store.claimSetting("demo:seeded", {}), true)
  assert.equal(await store.claimSetting("demo:seeded", {}), false)
  await store.releaseSetting("demo:seeded")
  assert.equal(await store.claimSetting("demo:seeded", {}), true, "released, the key can be claimed again")
  ;(settings.rows[0] as Row).deleted_at = new Date()
  await store.setSetting("live:writer:shipment", { on: true }, "user_3")
  assert.equal(settings.rows.filter((r) => r.key === "live:writer:shipment").length, 2, "a deleted row does not hold its key, as with the partial index")
})

test("memory counts and lists: per mode, by group, searched, paged, newest first", async () => {
  const shipments = new Table("dpdshp", SHIPMENT_DEFAULTS)
  const store = memoryStore(shipments, new Table("dpdevt"), new Table("dpdset"))
  await store.insertIgnore({ ...NEW, fulfillment_id: "ful_a", display_id: 1001 })
  const labeled = await store.insertIgnore({ ...NEW, fulfillment_id: "ful_b", display_id: 1002, pudo_id: null })
  await store.transition(String(labeled?.id), ["pending"], { state: "labeled", waybills: ["99000000000001D"] })
  const failed = await store.insertIgnore({ ...NEW, fulfillment_id: "ful_c", display_id: 1003 })
  await store.transition(String(failed?.id), ["pending"], { state: "failed" })
  await store.insertIgnore({ ...NEW, fulfillment_id: "ful_d", mode: "live" })
  const counts = countsOf(await store.counts("sandbox"))
  assert.equal(counts.all, 3)
  assert.equal(counts.to_create, 1)
  assert.equal(counts.labeled, 1)
  assert.equal(counts.problems, 1)
  assert.equal(counts.attention, 2, "to create and problems ask a person")
  const all = await store.list({ mode: "sandbox", filter: "all", offset: 0, limit: 10 })
  assert.equal(all.count, 3)
  assert.equal(all.rows[0].fulfillment_id, "ful_c", "newest first")
  assert.equal((await store.list({ mode: "sandbox", filter: "labeled", offset: 0, limit: 10 })).rows[0].fulfillment_id, "ful_b")
  assert.equal((await store.list({ mode: "sandbox", filter: "all", q: "000001d", offset: 0, limit: 10 })).rows[0].fulfillment_id, "ful_b", "a waybill, any case")
  assert.equal((await store.list({ mode: "sandbox", filter: "all", q: "#1003", offset: 0, limit: 10 })).rows[0].fulfillment_id, "ful_c", "an order number")
  assert.equal((await store.list({ mode: "sandbox", filter: "all", q: "pl145", offset: 0, limit: 10 })).count, 2, "a Pickup point")
  const page = await store.list({ mode: "sandbox", filter: "all", offset: 2, limit: 2 })
  assert.equal(page.rows.length, 1)
  assert.equal(page.count, 3)
})
