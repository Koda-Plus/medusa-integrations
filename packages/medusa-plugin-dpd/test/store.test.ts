/**
 * The atomic store: the SQL checked as text with a recording runner (each
 * decision is one statement with the condition that makes it safe when two
 * processes race, only known column names reach the SQL), the Panel group in
 * SQL checked branch by branch against groupOf, the claims with a token and
 * a lease (stage 2), and the memory store of the tests held to the same
 * rules.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { COURIER_LEASE_MS, PROTOCOL_LEASE_MS, SHIPMENT_STAGES, SHIPMENT_STATES, STATUS_MAX_AGE_DAYS } from "../src/modules/dpd/lib/constants.ts"
import { DISPATCH_ATTENTION_CODES, groupOf } from "../src/modules/dpd/lib/contract.ts"
import { countsOf, rowGroup } from "../src/modules/dpd/lib/dto.ts"
import {
  attentionClause,
  createSqlStore,
  DISPATCH_PATCHABLE_COLUMNS,
  dispatchExpectClause,
  dispatchSetClause,
  GROUP_SQL,
  RETURN_DONE_SQL,
  LABEL_LEASE_EXPIRED_ERROR,
  LEASE_EXPIRED_ERROR,
  like,
  PATCHABLE_COLUMNS,
  expectClause,
  searchClause,
  setClause,
  type NewDispatch,
  type NewShipment,
  type SqlRunner,
} from "../src/modules/dpd/lib/store.ts"
import { clip, jsonText, wellFormed } from "../src/modules/dpd/lib/text.ts"
import { DISPATCH_DEFAULTS, matches, memoryStore, Table, SHIPMENT_DEFAULTS, type Row } from "./helpers.ts"

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

test("transition with expect: only while the row still has the point and the boxes a plan read; the memory store keeps the same rule", async () => {
  const { calls, store } = recorder()
  await store.transition("dpdshp_1", ["pending"], { problems: null }, { pudo_id: "PL14509", boxes: { edited: true, items: [] } })
  assert.match(calls[0].sql, /where "id" = \? and "state" in \(\?\) and "deleted_at" is null and "pudo_id" is not distinct from \? and "boxes" is not distinct from \?::jsonb returning \*$/)
  assert.deepEqual(calls[0].bindings.slice(-4), ["dpdshp_1", "pending", "PL14509", '{"edited":true,"items":[]}'])
  await store.transition("dpdshp_1", ["pending"], { problems: null }, { pudo_id: null, boxes: null })
  assert.deepEqual(calls[1].bindings.slice(-2), [null, null], "null matches a null column (is not distinct from)")
  await store.transition("dpdshp_1", ["pending"], { problems: null }, {})
  assert.match(calls[2].sql, /"deleted_at" is null returning \*$/, "a key left out is not compared")

  const shipments = new Table("dpdshp", SHIPMENT_DEFAULTS)
  const mem = memoryStore(shipments, new Table("dpdevt"), new Table("dpdset"))
  const row = await mem.insertIgnore(NEW)
  assert.ok(row)
  const id = String(row.id)
  assert.equal(await mem.transition(id, ["pending"], { problems: [{ code: "pudo_inactive" }] }, { pudo_id: "PL0SBX03" }), null, "the point moved: nothing written")
  assert.deepEqual(shipments.rows[0].problems, [{ code: "weight_missing" }])
  assert.equal(await mem.transition(id, ["pending"], { problems: null }, { pudo_id: "PL14509", boxes: { edited: true } }), null, "other boxes: nothing written")
  const moved = await mem.transition(id, ["pending"], { problems: null }, { pudo_id: "PL14509", boxes: null })
  assert.equal(moved?.problems, null)
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
  assert.equal(searchClause("PL14509")?.bindings.length, 6, "a text is not an order number")
})

test("the search also matches the waybills of the tracking, a repinned one too, and only their waybill field", () => {
  const clause = searchClause("0000000000201S")
  assert.ok(clause)
  assert.ok(clause.sql.includes(`exists (select 1 from jsonb_array_elements(case when jsonb_typeof("tracking") = 'array' then "tracking" else '[]'::jsonb end) as "e" where "e"->>'waybill' ilike ?)`))
  assert.ok(!clause.sql.includes(`"tracking"::text`), "a description in the tracking never matches")
  assert.equal(clause.sql.split("?").length - 1, clause.bindings.length, "one binding per placeholder")
  assert.equal(clause.bindings[4], "%0000000000201S%")
})

/**
 * The CASE of GROUP_SQL, evaluated on one row: each `when` is a
 * conjunction-free test on one column, apart from the returnDone branch,
 * whose RETURN_DONE_SQL is read as the flag `done` (E61).
 */
function sqlGroup(row: { kind: string; state: string; stage: string | null; handed_over_at: Date | null }, done = false): string {
  const values: Record<string, string | null> = { kind: row.kind, state: row.state, stage: row.stage, handed_over_at: row.handed_over_at ? "x" : null }
  const branches = [...GROUP_SQL.matchAll(/when (.+?) then '([a-z_]+)'\n/g)]
  for (const [, cond, group] of branches) {
    if (cond === `"stage" = 'returned' and ${RETURN_DONE_SQL}`) {
      if (values.stage === "returned" && done) return group
      continue
    }
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

test("the group in SQL is groupOf, for every kind, state, stage, handover and returnDone", () => {
  let checked = 0
  const now = new Date("2026-11-04T12:00:00.000Z")
  const recent = new Date("2026-11-03T12:00:00.000Z")
  const back = [
    { waybill: "0000000000101S", box: 0, role: "outbound", stage: "in_transit", supersededBy: "0000000000102R" },
    { waybill: "0000000000102R", box: 0, role: "return", stage: "delivered", supersededBy: null, from: "0000000000101S" },
  ]
  for (const kind of ["outbound", "return"])
    for (const state of SHIPMENT_STATES)
      for (const stage of [null, ...SHIPMENT_STAGES])
        for (const handed of [null, recent])
          for (const done of [false, true]) {
            const row = { kind, state, stage, handed_over_at: handed, created_at: recent, waybills: [done ? "0000000000102R" : "0000000000101S"], tracking: done ? back : null }
            const want = groupOf({ kind: kind as "outbound" | "return", state, stage, handedOver: Boolean(handed), returnDone: stage === "returned" && done })
            assert.equal(sqlGroup(row, stage === "returned" && done), want, JSON.stringify(row))
            assert.equal(rowGroup(row, now), want, JSON.stringify(row))
            checked += 1
          }
  assert.equal(checked, 2 * SHIPMENT_STATES.length * (SHIPMENT_STAGES.length + 1) * 2 * 2)
})

test("RETURN_DONE_SQL is returnDone: the age of 6.5 and a live delivered return entry, with no placeholder (E61)", () => {
  assert.ok(GROUP_SQL.includes(`when "stage" = 'returned' and ${RETURN_DONE_SQL} then 'returns'`))
  assert.ok(GROUP_SQL.indexOf("then 'returns'\n  when \"stage\" in ('problem', 'returned')") > 0, "before the problems branch")
  assert.ok(!RETURN_DONE_SQL.includes("?"), "GROUP_SQL is used with the bindings of counts and list")
  assert.ok(RETURN_DONE_SQL.includes(`coalesce("handed_over_at", "created_at") <= now() - interval '${STATUS_MAX_AGE_DAYS} days'`))
  for (const part of [`"r"->>'role' = 'return'`, `"r"->>'stage' = 'delivered'`, `coalesce("r"->>'supersededBy', '') = ''`, `"waybills" @> jsonb_build_array("r"->>'waybill')`]) {
    assert.ok(RETURN_DONE_SQL.includes(part), part)
  }
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

test("claim: one statement from the given states, the token, the lease and attempts + 1; state in the patch is ignored", async () => {
  const { calls, store } = recorder()
  const lease = new Date("2026-11-02T10:03:00Z")
  await store.claim("dpdshp_1", ["pending", "failed"], { token: "tok_1", leaseUntil: lease, to: "creating", patch: { state: "labeled", plan_hash: "h1", boxes: { edited: false, items: [] }, ["claim_token" as never]: "x" } as never })
  assert.match(
    calls[0].sql,
    /^update "dpd_shipment" set "boxes" = \?::jsonb, "plan_hash" = \?, "updated_at" = now\(\), "state" = \?, "claim_token" = \?, "lease_until" = \?, "attempts" = "attempts" \+ 1 where "id" = \? and "state" in \(\?, \?\) and "deleted_at" is null returning \*$/,
  )
  assert.deepEqual(calls[0].bindings, ['{"edited":false,"items":[]}', "h1", "creating", "tok_1", lease, "dpdshp_1", "pending", "failed"])
  assert.equal(await store.claim("dpdshp_1", [], { token: "t", leaseUntil: lease, to: "creating" }), null, "no state, no statement")
  assert.equal(calls.length, 1)
})

test("claim with expect: only while the row still has the point and the boxes the plan read, checked before the patch writes; the memory store keeps the same rule", async () => {
  const { calls, store } = recorder()
  const lease = new Date("2026-11-02T10:03:00Z")
  const boxes = { edited: false, items: [] }
  await store.claim("dpdshp_1", ["pending", "failed"], { token: "tok_1", leaseUntil: lease, to: "creating", patch: { boxes: { edited: false, items: [{ weightKg: 1 }] } }, expect: { pudo_id: "PL14509", boxes } })
  assert.match(calls[0].sql, /where "id" = \? and "state" in \(\?, \?\) and "deleted_at" is null and "pudo_id" is not distinct from \? and "boxes" is not distinct from \?::jsonb returning \*$/)
  assert.deepEqual(calls[0].bindings.slice(-5), ["dpdshp_1", "pending", "failed", "PL14509", '{"edited":false,"items":[]}'])
  await store.claim("dpdshp_1", ["pending"], { token: "tok_2", leaseUntil: lease, to: "creating", expect: { pudo_id: null, boxes: null } })
  assert.deepEqual(calls[1].bindings.slice(-2), [null, null], "null matches a null column")

  const shipments = new Table("dpdshp", SHIPMENT_DEFAULTS)
  const mem = memoryStore(shipments, new Table("dpdevt"), new Table("dpdset"))
  const id = String((await mem.insertIgnore(NEW))?.id)
  const later = new Date(Date.now() + 60_000)
  const edited = { edited: true, items: [{ weightKg: 19, lengthCm: 40, widthCm: 30, heightCm: 20, reference: null, waybill: null }] }
  shipments.rows[0].boxes = edited
  const sent = { edited: false, items: [{ weightKg: 1.5, lengthCm: null, widthCm: null, heightCm: null, reference: null, waybill: null }] }
  assert.equal(await mem.claim(id, ["pending"], { token: "a", leaseUntil: later, to: "creating", patch: { boxes: sent }, expect: { pudo_id: "PL14509", boxes: null } }), null, "other boxes: not claimed")
  assert.equal(await mem.claim(id, ["pending"], { token: "a", leaseUntil: later, to: "creating", patch: { boxes: sent }, expect: { pudo_id: "PL0SBX03", boxes: edited } }), null, "another point: not claimed")
  assert.deepEqual(shipments.rows[0].boxes, edited, "the boxes set by hand stay")
  assert.equal(shipments.rows[0].state, "pending")
  assert.equal(shipments.rows[0].attempts, 0)
  const won = await mem.claim(id, ["pending"], { token: "a", leaseUntil: later, to: "creating", patch: { boxes: sent }, expect: { pudo_id: "PL14509", boxes: edited } })
  assert.equal(won?.state, "creating")
  assert.deepEqual(won?.boxes, sent, "the expect is checked before the patch writes")
})

test("finish: only the owner of the claim (creating or labeling, the same token) writes; the token and the lease are cleared", async () => {
  const { calls, store } = recorder()
  await store.finish("dpdshp_1", "tok_1", { state: "created", waybills: ["0000899000001Q"], error: null })
  assert.match(
    calls[0].sql,
    /^update "dpd_shipment" set "waybills" = \?::jsonb, "state" = \?, "error" = \?, "updated_at" = now\(\), "claim_token" = null, "lease_until" = null where "id" = \? and "state" in \('creating', 'labeling'\) and "claim_token" = \? and "deleted_at" is null returning \*$/,
  )
  assert.deepEqual(calls[0].bindings, ['["0000899000001Q"]', "created", null, "dpdshp_1", "tok_1"])
  const { store: empty } = recorder([])
  assert.equal(await empty.finish("dpdshp_1", "tok_2", { state: "created" }), null, "a lost claim writes nothing")
})

test("expireLeases: creating past its lease becomes unknown, labeling becomes created, per mode", async () => {
  const { calls, store } = recorder([{ id: "dpdshp_1", state: "unknown" }])
  const now = new Date("2026-11-02T10:10:00Z")
  const rows = await store.expireLeases("sandbox", now)
  assert.equal(rows.length, 2, "the rows of both statements")
  assert.match(calls[0].sql, /set "state" = 'unknown', "error_code" = 'lease_expired', "error" = \?, "claim_token" = null, "lease_until" = null, "updated_at" = now\(\) where "mode" = \? and "state" = 'creating' and "lease_until" < \? and "deleted_at" is null returning \*$/)
  assert.deepEqual(calls[0].bindings, [LEASE_EXPIRED_ERROR, "sandbox", now])
  assert.match(calls[1].sql, /set "state" = 'created', "error_code" = 'label_lease_expired', "error" = \?, .* where "mode" = \? and "state" = 'labeling' and "lease_until" < \?/)
  assert.deepEqual(calls[1].bindings, [LABEL_LEASE_EXPIRED_ERROR, "sandbox", now])
})

test("the memory store claims and finishes like the SQL: one winner, the owner only, leases taken back per mode", async () => {
  const shipments = new Table("dpdshp", SHIPMENT_DEFAULTS)
  const store = memoryStore(shipments, new Table("dpdevt"), new Table("dpdset"))
  const row = await store.insertIgnore(NEW)
  const id = String(row?.id)
  const lease = new Date(Date.now() + 60_000)
  const won = await store.claim(id, ["pending", "failed"], { token: "a", leaseUntil: lease, to: "creating", patch: { state: "labeled", plan_hash: "h1", ["mode" as never]: "live" } as never })
  assert.equal(won?.state, "creating", "state in the patch is ignored")
  assert.equal(won?.plan_hash, "h1")
  assert.equal(won?.mode, "sandbox")
  assert.equal(won?.attempts, 1)
  assert.equal(won?.claim_token, "a")
  assert.equal(await store.claim(id, ["pending", "failed"], { token: "b", leaseUntil: lease, to: "creating" }), null, "the second claim loses")
  assert.equal(await store.finish(id, "b", { state: "created" }), null, "not the owner")
  const done = await store.finish(id, "a", { state: "created", waybills: ["w1"] })
  assert.equal(done?.state, "created")
  assert.equal(done?.claim_token, null)
  assert.equal(done?.lease_until, null)
  assert.equal(await store.finish(id, "a", { state: "labeled" }), null, "a finished claim is gone")

  const label = await store.claim(id, ["created"], { token: "c", leaseUntil: new Date(Date.now() - 1), to: "labeling" })
  assert.equal(label?.attempts, 2)
  const other = await store.insertIgnore({ ...NEW, fulfillment_id: "ful_2" })
  await store.claim(String(other?.id), ["pending"], { token: "d", leaseUntil: new Date(Date.now() - 1), to: "creating" })
  const live = await store.insertIgnore({ ...NEW, fulfillment_id: "ful_3", mode: "live" })
  await store.claim(String(live?.id), ["pending"], { token: "e", leaseUntil: new Date(Date.now() - 1), to: "creating" })
  const expired = await store.expireLeases("sandbox", new Date())
  assert.deepEqual(expired.map((r) => [r.state, r.error_code]).sort(), [["created", "label_lease_expired"], ["unknown", "lease_expired"]])
  assert.equal(await store.finish(id, "c", { state: "labeled" }), null, "a claim whose lease was taken back writes nothing")
  assert.equal(shipments.rows.find((r) => r.id === live?.id)?.state, "creating", "another mode keeps its lease")
})

test("finish with unsent: a claim the pacing refused gives its count back (attempts - 1, never below 0) and may keep the clock", async () => {
  const { calls, store } = recorder()
  await store.finish("dpdshp_1", "tok_1", { state: "pending", error_code: "rate_limited" }, { unsent: {} })
  assert.match(
    calls[0].sql,
    /^update "dpd_shipment" set "state" = \?, "error_code" = \?, "updated_at" = now\(\), "claim_token" = null, "lease_until" = null, "attempts" = greatest\("attempts" - 1, 0\) where "id" = \? and "state" in \('creating', 'labeling'\) and "claim_token" = \? and "deleted_at" is null returning \*$/,
  )
  assert.deepEqual(calls[0].bindings, ["pending", "rate_limited", "dpdshp_1", "tok_1"])
  const kept = new Date("2026-11-02T10:00:00Z")
  await store.finish("dpdshp_1", "tok_2", { state: "unknown" }, { unsent: { updatedAt: kept } })
  assert.match(calls[1].sql, /set "state" = \?, "updated_at" = \?, "claim_token" = null, "lease_until" = null, "attempts" = greatest\("attempts" - 1, 0\) where/)
  assert.deepEqual(calls[1].bindings, ["unknown", kept, "dpdshp_1", "tok_2"])
  await store.finish("dpdshp_1", "tok_3", { state: "created" })
  assert.ok(!calls[2].sql.includes(`"attempts"`), "a claim that sent something keeps its count")

  const shipments = new Table("dpdshp", SHIPMENT_DEFAULTS)
  const memory = memoryStore(shipments, new Table("dpdevt"), new Table("dpdset"))
  const id = String((await memory.insertIgnore(NEW))?.id)
  const lease = new Date(Date.now() + 60_000)
  await memory.claim(id, ["pending"], { token: "a", leaseUntil: lease, to: "creating" })
  assert.equal((await memory.finish(id, "a", { state: "pending" }, { unsent: { updatedAt: kept } }))?.attempts, 0)
  assert.equal(shipments.rows[0].updated_at, kept)
  await memory.claim(id, ["pending"], { token: "b", leaseUntil: lease, to: "creating" })
  assert.equal((await memory.finish(id, "b", { state: "created" }))?.attempts, 1)
})

test("the memory filters behave like the SQL of the list methods: a NULL column matches no comparison", () => {
  const row: Row = { state: "pending", error_code: null, attempts: 3, created_at: new Date("2026-11-02T10:00:00Z") }
  assert.equal(matches(row, { error_code: { $ne: "rate_limited_manual" } }), false, "null != 'x' is not true in SQL")
  assert.equal(matches(row, { error_code: { $ne: null } }), false)
  assert.equal(matches({ ...row, error_code: "x" }, { error_code: { $ne: null } }), true)
  assert.equal(matches(row, { error_code: null, problems: null }), true)
  assert.equal(matches(row, { error_code: ["a", "b"] }), false)
  assert.equal(matches({ ...row, error_code: "b" }, { error_code: { $in: ["a", "b"] } }), true)
  assert.equal(matches(row, { attempts: { $lte: 3 } }), true, "numbers compare as numbers")
  assert.equal(matches(row, { attempts: { $lt: 3 } }), false)
  assert.equal(matches(row, { attempts: { $gt: 2, $lte: 5 } }), true)
  assert.equal(matches(row, { created_at: { $gte: new Date("2026-11-02T09:00:00Z") } }), true)
  assert.equal(matches(row, { created_at: { $gte: new Date("2026-11-02T11:00:00Z") } }), false)
  assert.equal(matches({ ...row, created_at: null }, { created_at: { $gte: new Date(0) } }), false)
})

/* Stage 4 (spec 5.1.6, E1, E20, O17, O19): the dispatch statements as text. */

const NEW_DISPATCH: NewDispatch = {
  mode: "sandbox",
  location_id: null,
  sender: { address: { city: "Warszawa" } },
  params: { doxCount: 0, parcel: { count: 1, weight: 1, maxWeight: 1, maxHeight: 10, maxWidth: 10, maxDepth: 10 } },
  problems: null,
  plan_hash: "0123456789abcdef01234567",
  order_type: "DOMESTIC",
  created_by: "user_1",
}

test("createDispatch pins the shipments or returns null when one is taken", async () => {
  const { calls, store } = recorder([{ dispatch: { id: "dpddsp_1", state: "pending" }, shipments: [{ id: "dpdshp_1" }, { id: "dpdshp_2" }] }])
  const out = await store.createDispatch(NEW_DISPATCH, ["dpdshp_1", "dpdshp_2", "dpdshp_1"])
  assert.equal(calls.length, 1, "one statement")
  const sql = calls[0].sql
  assert.match(sql, /^with "picked" as \( select "id" from "dpd_shipment" where "id" in \(\?, \?\) and "mode" = \? and "kind" = 'outbound' and "state" = 'labeled' and \("session_type" is null or "session_type" = 'DOMESTIC'\) and "dispatch_id" is null and "handed_over_at" is null and "deleted_at" is null for update \)/)
  assert.match(sql, /"created" as \( insert into "dpd_dispatch" .* select \?, \?, 'pending', .* where \(select count\(\*\) from "picked"\) = \? returning \* \)/)
  assert.match(sql, /"pinned" as \( update "dpd_shipment" set "dispatch_id" = \(select "id" from "created"\), "updated_at" = now\(\) where "id" in \(select "id" from "picked"\) and exists \(select 1 from "created"\) returning \* \)/)
  assert.deepEqual(calls[0].bindings, [
    "dpdshp_1", "dpdshp_2", "sandbox",
    "dpddsp_1", "sandbox", null, '{"address":{"city":"Warszawa"}}', JSON.stringify(NEW_DISPATCH.params), null, "0123456789abcdef01234567", '["dpdshp_1","dpdshp_2"]', "DOMESTIC", "user_1",
    2,
  ], "the ids deduped; the count to match is the number of ids")
  assert.deepEqual(out?.dispatch.id, "dpddsp_1")
  assert.deepEqual(out?.shipments.map((s) => s.id), ["dpdshp_1", "dpdshp_2"])
  const { store: lost } = recorder([{ dispatch: null, shipments: [] }])
  assert.equal(await lost.createDispatch(NEW_DISPATCH, ["dpdshp_1"]), null, "a shipment taken meanwhile: nothing written")
  const { calls: none, store: empty } = recorder()
  assert.equal(await empty.createDispatch(NEW_DISPATCH, []), null)
  assert.equal(none.length, 0, "no ids, no statement")
})

test("transitionDispatch checks the expected states and the expected plan_hash", async () => {
  const { calls, store } = recorder()
  await store.transitionDispatch("dpddsp_1", ["pending", "printing", "printed"], { state: "canceled", problems: [{ code: "x" }] }, { plan_hash: "h1" })
  assert.match(calls[0].sql, /^update "dpd_dispatch" set "state" = \?, "problems" = \?::jsonb, "updated_at" = now\(\) where "id" = \? and "state" in \(\?, \?\) and "deleted_at" is null and "plan_hash" is not distinct from \? returning \*$/)
  assert.deepEqual(calls[0].bindings, ["canceled", '[{"code":"x"}]', "dpddsp_1", "pending", "printed", "h1"], "printing is a claimed state: dropped from from")
  await store.transitionDispatch("dpddsp_1", ["pending"], { problems: null }, { plan_hash: null })
  assert.deepEqual(calls[1].bindings.slice(-1), [null], "a null hash matches a null column")
  assert.equal(await store.transitionDispatch("dpddsp_1", ["printing", "ordering", "updating"], { state: "pending" }), null)
  assert.equal(calls.length, 2, "only claimed states: no statement")
  assert.deepEqual(dispatchExpectClause({}), { sql: "", bindings: [] })
  const set = dispatchSetClause({ check_sum: "12345678", ["claim_token" as never]: "stolen" } as never)
  assert.equal(set.sql, `"check_sum" = ?, "updated_at" = now()`, "a column outside DISPATCH_PATCHABLE_COLUMNS never reaches the SQL")
  for (const locked of ["id", "mode", "claim_token", "lease_until", "attempts", "created_by"]) assert.ok(!DISPATCH_PATCHABLE_COLUMNS.includes(locked), locked)
})

test("transitionDispatch checks expected error_code, order_number and check_sum presence", async () => {
  const { calls, store } = recorder()
  await store.transitionDispatch("dpddsp_1", ["ordered"], { error_code: null, error: null }, { error_code: "update_unclear", order_number: "2026000001", check_sum_set: true })
  assert.match(calls[0].sql, /and "error_code" is not distinct from \? and "order_number" is not distinct from \? and "check_sum" is not null returning \*$/)
  assert.deepEqual(calls[0].bindings.slice(-3), ["ordered", "update_unclear", "2026000001"], "the checkSum value is never bound")
  await store.transitionDispatch("dpddsp_1", ["unknown"], { state: "pending" }, { error_code: null, order_number: null, check_sum_set: false })
  assert.match(calls[1].sql, /and "error_code" is not distinct from \? and "order_number" is not distinct from \? and "check_sum" is null returning \*$/)
  assert.deepEqual(calls[1].bindings.slice(-2), [null, null], "null matches a null column")
})

test("claim and finish of a dispatch with a 180 s lease", async () => {
  const { calls, store } = recorder()
  const lease = new Date(Date.parse("2026-11-03T09:00:00Z") + PROTOCOL_LEASE_MS)
  assert.equal(PROTOCOL_LEASE_MS, 180_000)
  assert.equal(COURIER_LEASE_MS, 180_000)
  await store.claimDispatch("dpddsp_1", ["pending", "printing"], { token: "tok_1", leaseUntil: lease, to: "printing", patch: { state: "ordered", error_code: "protocol_unclear", error: null } })
  assert.match(calls[0].sql, /^update "dpd_dispatch" set "error" = \?, "error_code" = \?, "updated_at" = now\(\), "state" = \?, "claim_token" = \?, "lease_until" = \?, "attempts" = "attempts" \+ 1 where "id" = \? and "state" in \(\?\) and "deleted_at" is null returning \*$/)
  assert.deepEqual(calls[0].bindings, [null, "protocol_unclear", "printing", "tok_1", lease, "dpddsp_1", "pending"], "state in the patch ignored; a claimed state never in from")
  assert.equal(await store.claimDispatch("dpddsp_1", ["ordering"], { token: "t", leaseUntil: lease, to: "ordering", patch: {} }), null)
  assert.equal(calls.length, 1)
  await store.claimDispatch("dpddsp_1", ["ordered"], { token: "tok_e", leaseUntil: lease, to: "updating", patch: { error_code: "update_unclear" }, expect: { error_code: null } })
  assert.match(String(calls.at(-1)?.sql), /where "id" = \? and "state" in \(\?\) and "deleted_at" is null and "error_code" is not distinct from \? returning \*$/, "the claim holds the error_code the step read (P10)")
  assert.deepEqual(calls.at(-1)?.bindings, ["update_unclear", "updating", "tok_e", lease, "dpddsp_1", "ordered", null])
  calls.pop()
  await store.finishDispatch("dpddsp_1", "tok_1", { state: "printed", protocol_at: lease, error: null })
  assert.match(calls[1].sql, /^update "dpd_dispatch" set "state" = \?, "protocol_at" = \?, "error" = \?, "updated_at" = now\(\), "claim_token" = null, "lease_until" = null where "id" = \? and "state" in \('printing', 'ordering', 'updating'\) and "claim_token" = \? and "deleted_at" is null returning \*$/)
  assert.deepEqual(calls[1].bindings, ["printed", lease, null, "dpddsp_1", "tok_1"])
  const kept = new Date("2026-11-03T08:59:00Z")
  await store.finishDispatch("dpddsp_1", "tok_2", { state: "pending" }, { unsent: { updatedAt: kept } })
  assert.match(calls[2].sql, /set "state" = \?, "updated_at" = \?, "claim_token" = null, "lease_until" = null, "attempts" = greatest\("attempts" - 1, 0\) where/)
  assert.deepEqual(calls[2].bindings, ["pending", kept, "dpddsp_1", "tok_2"])
  const { store: empty } = recorder([])
  assert.equal(await empty.finishDispatch("dpddsp_1", "tok_3", { state: "printed" }), null, "a lost claim writes nothing")
})

test("a failed dispatch write that binds the checkSum never carries it: no statement, no bindings, no cause; other writes keep their error", async () => {
  const checkSum = "a1b2c3d4e5f6"
  /* Like knex without compileSqlOnError false: the statement with its bindings goes into the message. */
  const failing: SqlRunner = {
    async raw(text, bindings = []) {
      let i = 0
      const err = new Error(`${text.replace(/\?/g, () => `'${String(bindings[i++])}'`)} - canceling statement due to statement timeout`)
      Object.assign(err, { code: "57014" })
      throw err
    },
  }
  const store = createSqlStore({ sql: failing, newId: (p) => p })
  const lease = new Date("2026-11-03T09:03:00Z")
  const writes: Array<[string, () => Promise<unknown>]> = [
    ["finishDispatch", () => store.finishDispatch("dpddsp_1", "tok", { state: "ordered", order_number: "ORD-1", check_sum: checkSum, error: null })],
    ["transitionDispatch", () => store.transitionDispatch("dpddsp_1", ["ordered"], { check_sum: checkSum })],
    ["claimDispatch", () => store.claimDispatch("dpddsp_1", ["ordered"], { token: "tok", leaseUntil: lease, to: "updating", patch: { check_sum: checkSum } })],
  ]
  for (const [name, write] of writes) {
    await assert.rejects(write(), (err: unknown) => {
      assert.ok(err instanceof Error, name)
      assert.equal(err.message.includes(checkSum), false, name)
      assert.equal(String(err.stack).includes(checkSum), false, name)
      assert.equal(err.cause, undefined, name)
      assert.match(err.message, /\(57014\)/, name)
      return true
    })
  }
  await assert.rejects(store.finishDispatch("dpddsp_1", "tok", { state: "printed", check_sum: null }), /canceling statement/, "nothing to hide: the error stays as it was")
})

test("expired printing goes back to ordered, printed or pending", async () => {
  const { calls, store } = recorder([{ id: "dpddsp_1" }])
  const now = new Date("2026-11-03T09:10:00Z")
  const rows = await store.expireDispatchLeases("live", now)
  assert.equal(calls.length, 3)
  assert.equal(rows.length, 3, "the rows of the three statements")
  assert.match(calls[0].sql, /^update "dpd_dispatch" set "state" = case when "ordered_at" is not null then 'ordered' when "protocol_at" is not null then 'printed' else 'pending' end, "claim_token" = null, "lease_until" = null, "updated_at" = now\(\) where "mode" = \? and "state" = 'printing' and "lease_until" < \? and "deleted_at" is null returning \*$/)
  assert.match(calls[1].sql, /set "state" = 'unknown', "claim_token" = null, "lease_until" = null, "updated_at" = now\(\) where "mode" = \? and "state" = 'ordering' and "lease_until" < \?/)
  assert.match(calls[2].sql, /set "state" = 'ordered', "claim_token" = null, "lease_until" = null, "updated_at" = now\(\) where "mode" = \? and "state" = 'updating' and "lease_until" < \?/)
  for (const c of calls) {
    assert.deepEqual(c.bindings, ["live", now])
    assert.ok(!/"error(_code)?" =/.test(c.sql), "error and error_code stay as the claim set them")
  }
})

test("claimExpiredFirstPrints takes only expired first prints, keeps printing and error_code, sets the pass token", async () => {
  const { calls, store } = recorder([{ id: "dpddsp_1", state: "printing" }])
  const now = new Date("2026-11-03T09:10:00Z")
  const leaseUntil = new Date(now.getTime() + PROTOCOL_LEASE_MS)
  const rows = await store.claimExpiredFirstPrints("sandbox", now, { token: "tok_x", leaseUntil })
  assert.equal(rows.length, 1)
  assert.match(calls[0].sql, /^update "dpd_dispatch" set "claim_token" = \?, "lease_until" = \?, "updated_at" = now\(\) where "mode" = \? and "state" = 'printing' and "lease_until" < \? and "protocol_at" is null and "ordered_at" is null and "deleted_at" is null returning \*$/)
  assert.deepEqual(calls[0].bindings, ["tok_x", leaseUntil, "sandbox", now])
  assert.ok(!/"state" =\s*\?|"attempts"/.test(calls[0].sql.split(" where ")[0]), "state and attempts unchanged")
})

test("transition with expect dispatch_id null refuses a pinned shipment", async () => {
  const { calls, store } = recorder()
  await store.transition("dpdshp_1", ["labeled"], { state: "excluded" }, { dispatch_id: null })
  assert.match(calls[0].sql, /and "dispatch_id" is not distinct from \? returning \*$/)
  assert.deepEqual(calls[0].bindings.slice(-1), [null])
  await store.transition("dpdshp_1", ["labeled"], { state: "excluded" }, { dispatch_id: "dpddsp_1" })
  assert.deepEqual(calls[1].bindings.slice(-1), ["dpddsp_1"])
  await store.transition("dpdshp_1", ["labeled"], { state: "excluded" }, {})
  assert.ok(!calls[2].sql.includes("dispatch_id"), "a key left out is not compared")
})

test("dispatchCounts: open and attention", async () => {
  const { calls, store } = recorder([{ open: "4", attention: 2 }])
  assert.deepEqual(await store.dispatchCounts("live"), { open: 4, attention: 2 })
  assert.deepEqual([...DISPATCH_ATTENTION_CODES].sort(), ["cancel_unclear", "checksum", "order_not_found", "order_number", "order_status", "update_unclear"])
  assert.match(calls[0].sql, /^select count\(\*\) filter \(where "state" <> 'canceled'\)::int as "open", count\(\*\) filter \(where \("state" = 'unknown' or \("state" = 'ordered' and "error_code" in \(\?, \?, \?, \?, \?, \?\)\)\)\)::int as "attention" from "dpd_dispatch" where "mode" = \? and "deleted_at" is null$/)
  assert.deepEqual(calls[0].bindings, [...DISPATCH_ATTENTION_CODES, "live"])
  assert.ok(!calls[0].sql.includes("check_sum"), "an ordered row without a check_sum is not attention (O16)")
  assert.deepEqual(attentionClause().bindings, [...DISPATCH_ATTENTION_CODES])
  const { store: empty } = recorder([])
  assert.deepEqual(await empty.dispatchCounts("sandbox"), { open: 0, attention: 0 })
})

test("listDispatches filters and newest first", async () => {
  const { calls, store } = recorder([{ id: "dpddsp_1", count: 7 }])
  const out = await store.listDispatches({ mode: "sandbox", filter: "attention", offset: 20, limit: 10 })
  assert.equal(out.count, 7)
  assert.match(calls[0].sql, /^select \* from "dpd_dispatch" where "mode" = \? and "deleted_at" is null and \("state" = 'unknown' or .*\) order by "created_at" desc, "id" desc limit \? offset \?$/)
  assert.deepEqual(calls[0].bindings, ["sandbox", ...DISPATCH_ATTENTION_CODES, 10, 20])
  assert.match(calls[1].sql, /^select count\(\*\)::int as "count" from "dpd_dispatch" where "mode" = \? and "deleted_at" is null and \("state" = 'unknown'/)
  assert.deepEqual(calls[1].bindings, ["sandbox", ...DISPATCH_ATTENTION_CODES])
  await store.listDispatches({ mode: "live", filter: "open", offset: 0, limit: 5 })
  assert.match(calls[2].sql, /where "mode" = \? and "deleted_at" is null and "state" <> 'canceled' order by/)
  assert.deepEqual(calls[2].bindings, ["live", 5, 0])
  await store.listDispatches({ mode: "live", filter: "all", offset: 0, limit: 5 })
  assert.match(calls[4].sql, /where "mode" = \? and "deleted_at" is null order by/)
})

test("releaseShipments clears dispatch_id and handed_over_at", async () => {
  const { calls, store } = recorder([{ id: "dpdshp_1" }])
  await store.releaseShipments("dpddsp_1", null)
  assert.match(
    calls[0].sql,
    /^update "dpd_shipment" set "dispatch_id" = null, "handed_over_at" = null, "stage" = case when "stage" is null or "stage" = 'ready' then 'preparing' else "stage" end, "updated_at" = now\(\) where "dispatch_id" = \? and "deleted_at" is null returning \*$/,
  )
  assert.deepEqual(calls[0].bindings, ["dpddsp_1"])
  await store.releaseShipments("dpddsp_1", ["dpdshp_1", "dpdshp_2"])
  assert.match(calls[1].sql, /where "dispatch_id" = \? and "id" in \(\?, \?\) and "deleted_at" is null/)
  assert.deepEqual(calls[1].bindings, ["dpddsp_1", "dpdshp_1", "dpdshp_2"])
  assert.deepEqual(await store.releaseShipments("dpddsp_1", []), [])
  assert.equal(calls.length, 2)
  const at = new Date("2026-11-03T09:00:00Z")
  await store.markHandedOver("dpddsp_1", at)
  assert.match(
    calls[2].sql,
    /^update "dpd_shipment" set "handed_over_at" = \?, "stage" = case when "stage" is null or "stage" = 'preparing' then 'ready' else "stage" end, "updated_at" = now\(\) where "dispatch_id" = \? and "handed_over_at" is null and "deleted_at" is null returning \*$/,
  )
  assert.deepEqual(calls[2].bindings, [at, "dpddsp_1"])
})

test("GROUP_SQL puts excluded with canceled, like groupOf", () => {
  assert.ok((SHIPMENT_STATES as readonly string[]).includes("excluded"))
  assert.equal(sqlGroup({ kind: "outbound", state: "excluded", stage: null, handed_over_at: null }), "canceled")
  assert.equal(groupOf({ kind: "outbound", state: "excluded", stage: null, handedOver: false }), "canceled")
  assert.equal(sqlGroup({ kind: "outbound", state: "excluded", stage: "delivered", handed_over_at: new Date() }), "canceled", "before the stage and the handover")
})

test("the memory store keeps the dispatch rules of the SQL: expect dispatch_id, error_code, order_number and check_sum presence; attention without check_sum", async () => {
  const shipments = new Table("dpdshp", SHIPMENT_DEFAULTS)
  const dispatches = new Table("dpddsp", DISPATCH_DEFAULTS)
  const store = memoryStore(shipments, new Table("dpdevt"), new Table("dpdset"), dispatches)
  const row = await store.insertIgnore({ ...NEW, pudo_id: null })
  const id = String(row?.id)
  shipments.rows[0].state = "labeled"
  shipments.rows[0].dispatch_id = "dpddsp_9"
  assert.equal(await store.transition(id, ["labeled"], { state: "excluded" }, { dispatch_id: null }), null, "a pinned shipment refuses dispatch_id null (E20)")
  assert.equal((await store.transition(id, ["labeled"], { state: "labeled" }, { dispatch_id: "dpddsp_9" }))?.dispatch_id, "dpddsp_9", "the same dispatch matches")
  shipments.rows[0].dispatch_id = null
  assert.equal((await store.transition(id, ["labeled"], { state: "excluded" }, { dispatch_id: null }))?.state, "excluded", "null matches null")

  const ordered = dispatches.insert({ mode: "sandbox", state: "ordered", order_number: "SBX00000000001", check_sum: "12345678", error_code: "update_unclear" })
  const did = String(ordered.id)
  assert.equal(await store.transitionDispatch(did, ["ordered"], { error_code: null }, { error_code: "cancel_unclear", order_number: "SBX00000000001", check_sum_set: true }), null, "another error_code")
  assert.equal(await store.transitionDispatch(did, ["ordered"], { error_code: null }, { error_code: "update_unclear", order_number: "SBX00000000002", check_sum_set: true }), null, "another order_number")
  assert.equal(await store.transitionDispatch(did, ["ordered"], { error_code: null }, { error_code: "update_unclear", order_number: "SBX00000000001", check_sum_set: false }), null, "check_sum present, absence expected")
  assert.deepEqual(await store.dispatchCounts("sandbox"), { open: 1, attention: 1 })
  const resolved = await store.transitionDispatch(did, ["ordered"], { error_code: null }, { error_code: "update_unclear", order_number: "SBX00000000001", check_sum_set: true })
  assert.equal(resolved?.error_code, null, "every expected value holds (O19)")
  assert.deepEqual(await store.dispatchCounts("sandbox"), { open: 1, attention: 0 })

  for (const code of DISPATCH_ATTENTION_CODES) {
    dispatches.rows[0].error_code = code
    assert.equal((await store.dispatchCounts("sandbox")).attention, 1, code)
  }
  Object.assign(dispatches.rows[0], { error_code: null, check_sum: null })
  assert.deepEqual(await store.dispatchCounts("sandbox"), { open: 1, attention: 0 }, "ordered without a check_sum and without a code is not attention (O16)")
  dispatches.rows[0].state = "unknown"
  assert.equal((await store.dispatchCounts("sandbox")).attention, 1)
  assert.equal((await store.listDispatches({ mode: "sandbox", filter: "attention", offset: 0, limit: 10 })).count, 1)
})

/* ------------------------------------------------------------------ */
/* Stage 5: the status statements                                      */
/* ------------------------------------------------------------------ */

const DUE = { mode: "sandbox" as const, now: new Date("2026-11-03T12:00:00.000Z"), limit: 25, maxAgeDays: 30, spacingMin: 30, spacingBeforeHandoverMin: 120, writerBacklog: true, markStaleMs: 900_000 }
const ago = (ms: number) => new Date(DUE.now.getTime() - ms)

test("pickDueForStatus: one statement with status_due and writer_due, prev_checked_at and due_kind, the 15 bindings in order", async () => {
  const { calls, store } = recorder([{ id: "dpdshp_1", prev_checked_at: null, due_kind: "status" }])
  const rows = await store.pickDueForStatus(DUE)
  assert.deepEqual(rows, [{ id: "dpdshp_1", prev_checked_at: null, due_kind: "status" }])
  assert.equal(calls.length, 1)
  const sql = calls[0].sql
  assert.match(sql, /^with "status_due" as \( select "id", "last_checked_at" as "prev_checked_at", 'status' as "due_kind" from "dpd_shipment" where "mode" = \? and "deleted_at" is null and "kind" = 'outbound' and "state" in \('created', 'labeled'\)/)
  assert.ok(sql.includes(`jsonb_typeof("waybills") = 'array' and jsonb_array_length("waybills") > 0`))
  assert.ok(sql.includes(`coalesce("stage", '') not in ('delivered', 'canceled')`))
  assert.ok(sql.includes(`and not ("mode" = 'demo' and "fulfillment_id" is null)`))
  assert.ok(sql.includes(`when "handed_over_at" is not null or coalesce("stage", '') in ('in_transit', 'in_point', 'problem', 'returned') then ?::timestamptz else ?::timestamptz end`))
  assert.ok(sql.includes(`"writer_due" as ( select "id", "last_checked_at" as "prev_checked_at", 'writer' as "due_kind" from "dpd_shipment" where ?::boolean and "mode" = ? and "mode" <> 'demo'`))
  assert.ok(sql.includes(`"fulfillment_id" is not null and "order_id" is not null and "stage" = 'delivered'`))
  assert.ok(sql.includes(`"e"->>'possession' = 'true'`))
  assert.ok(sql.includes(`"last_checked_at" < "shipped_marked_at" + (?::int * interval '1 millisecond')`))
  assert.ok(sql.includes(`"last_checked_at" < "delivered_marked_at" + (?::int * interval '1 millisecond')`))
  assert.equal(sql.match(/order by "last_checked_at" asc nulls first, "id" asc limit \? for update skip locked/g)?.length, 2, "each part its own limit")
  assert.match(sql, /update "dpd_shipment" as "s" set "last_checked_at" = \?, "updated_at" = now\(\) from \(select \* from "status_due" union all select \* from "writer_due"\) as "due" where "s"\."id" = "due"\."id" returning "s"\.\*, "due"\."prev_checked_at", "due"\."due_kind"$/)
  const day = 86_400_000
  assert.deepEqual(calls[0].bindings, [
    "sandbox",
    ago(30 * day),
    ago(30 * 60_000),
    ago(120 * 60_000),
    25,
    true,
    "sandbox",
    ago(30 * day),
    ago(30 * 60_000),
    ago(900_000),
    900_000,
    ago(900_000),
    900_000,
    25,
    DUE.now,
  ])
  assert.equal((sql.match(/\?/g) ?? []).length, 15)
  await store.pickDueForStatus({ ...DUE, writerBacklog: false })
  assert.equal(calls[1].bindings[5], false, "writerBacklog bound as ?::boolean")
})

test("unclaimStatus gives prev_checked_at back only while last_checked_at is still the claim", async () => {
  const { calls, store } = recorder([{ id: "dpdshp_1" }])
  const at = new Date("2026-11-03T12:00:00Z")
  const prev = new Date("2026-11-03T11:00:00Z")
  const n = await store.unclaimStatus([{ id: "dpdshp_1", prev_checked_at: prev }, { id: "dpdshp_2", prev_checked_at: null }], at)
  assert.equal(n, 2)
  assert.equal(calls.length, 2)
  assert.equal(calls[0].sql, `update "dpd_shipment" set "last_checked_at" = ?, "updated_at" = now() where "id" = ? and "last_checked_at" = ? and "deleted_at" is null returning "id"`)
  assert.deepEqual(calls[0].bindings, [prev, "dpdshp_1", at])
  assert.deepEqual(calls[1].bindings, [null, "dpdshp_2", at])
  const none = recorder([])
  assert.equal(await none.store.unclaimStatus([{ id: "dpdshp_1", prev_checked_at: null }], at), 0)
})

test("applyTracking checks waybills, the handover and state: the bindings are id, stage, status, status_at, tracking, waybills, handed_over_at", async () => {
  const { calls, store } = recorder([{ id: "dpdshp_1" }])
  const statusAt = new Date("2026-11-02T14:00:00Z")
  const prevAt = new Date("2026-11-01T14:00:00Z")
  const tracking = [{ waybill: "0000000000101S" }]
  const prevTracking = [{ waybill: "0000000000101S", stage: null }]
  const handedAt = new Date("2026-11-01T10:00:00Z")
  const row = await store.applyTracking("dpdshp_1", { tracking, stage: "in_transit", status: "170101", status_at: statusAt }, { stage: "ready", status: "040101", status_at: prevAt, tracking: prevTracking, waybills: ["0000000000101S"], handed_over_at: handedAt })
  assert.deepEqual(row, { id: "dpdshp_1" })
  assert.equal(
    calls[0].sql,
    `update "dpd_shipment" set "tracking" = ?::jsonb, "stage" = ?, "status" = ?, "status_at" = ?, "updated_at" = now() where "id" = ? and "deleted_at" is null and coalesce("stage", '') = ? and coalesce("status", '') = ? and "status_at" is not distinct from ? and "tracking" is not distinct from ?::jsonb and "waybills" is not distinct from ?::jsonb and "handed_over_at" is not distinct from ? and "state" in ('created', 'labeled') returning *`,
  )
  assert.deepEqual(calls[0].bindings, [JSON.stringify(tracking), "in_transit", "170101", statusAt, "dpdshp_1", "ready", "040101", prevAt, JSON.stringify(prevTracking), JSON.stringify(["0000000000101S"]), handedAt])
  /* A repin writes waybills and boxes; a manual refresh writes last_checked_at. */
  const checked = new Date("2026-11-03T12:00:00Z")
  await store.applyTracking("dpdshp_1", { tracking, stage: "returned", status: "230403", status_at: statusAt, waybills: ["0000000000302R"], boxes: { edited: false, items: [] }, last_checked_at: checked }, { stage: null, status: null, status_at: null, tracking: null, waybills: ["0000000000301S"], handed_over_at: null })
  assert.match(calls[1].sql, /^update "dpd_shipment" set "tracking" = \?::jsonb, "stage" = \?, "status" = \?, "status_at" = \?, "waybills" = \?::jsonb, "boxes" = \?::jsonb, "last_checked_at" = \?, "updated_at" = now\(\) where/)
  assert.deepEqual(calls[1].bindings.slice(4, 7), [JSON.stringify(["0000000000302R"]), JSON.stringify({ edited: false, items: [] }), checked])
  assert.equal(await recorder([]).store.applyTracking("dpdshp_1", { tracking, stage: null, status: null, status_at: null }, { stage: null, status: null, status_at: null, tracking: null, waybills: null, handed_over_at: null }), null, "a lost compare and set")
})

test("applyTracking binds an empty string for a null stage and status", async () => {
  const { calls, store } = recorder([{ id: "dpdshp_1" }])
  await store.applyTracking("dpdshp_1", { tracking: [], stage: "preparing", status: "030103", status_at: null }, { stage: null, status: null, status_at: null, tracking: null, waybills: null, handed_over_at: null })
  assert.deepEqual(calls[0].bindings.slice(4), ["dpdshp_1", "", "", null, null, null, null])
})

test("no lone surrogate reaches a jsonb binding or a cut text: Postgres would refuse the statement on every pass", async () => {
  const high = "\uD83D"
  const low = "\uDE9A"
  const loneEscape = /\\ud[89a-f][0-9a-f]{2}/i
  /* clip never keeps half of a pair; wellFormed replaces a lone half by U+FFFD and keeps pairs. */
  assert.equal(clip("ab" + high + low, 3), "ab")
  assert.equal(clip("ab" + high + low, 4), "ab" + high + low)
  assert.equal(clip("abc", 2), "ab")
  assert.equal(clip("abc", 0), "")
  assert.equal(wellFormed(`a${high}b${low}c${high}${low}`), "a�b�c" + high + low)
  assert.equal(jsonText({ a: [high, "ok"] }), JSON.stringify({ a: ["�", "ok"] }))
  /* The tracking, the expected tracking and a patch column are written through jsonText. */
  const { calls, store } = recorder([{ id: "dpdshp_1" }])
  const tracking = [{ waybill: "0000000000101S", description: "a" + high }]
  await store.applyTracking("dpdshp_1", { tracking, stage: "in_transit", status: "170101", status_at: null }, { stage: null, status: null, status_at: null, tracking, waybills: null, handed_over_at: null })
  for (const b of calls[0].bindings) if (typeof b === "string") assert.doesNotMatch(b, loneEscape)
  assert.equal(calls[0].bindings[0], JSON.stringify([{ waybill: "0000000000101S", description: "a�" }]))
  assert.doesNotMatch(String(setClause({ tracking: [{ waybill: "0000000000101S", depotName: low }] }).bindings[0]), loneEscape)
  /* The history: data (jsonb) made well formed, the message cut at 2000 without splitting a pair. */
  await store.insertEvent({ shipment_id: "dpdshp_1", order_id: "order_1", kind: "status", message: "x".repeat(1999) + high + low, data: { depotName: "d" + high }, mode: "live" })
  assert.equal(calls[1].bindings[9], "x".repeat(1999))
  assert.equal(calls[1].bindings[10], JSON.stringify({ depotName: "d�" }))
})

test("claimMark, releaseMark and notePendingMark: one statement each, the column only from MarkColumn", async () => {
  const { calls, store } = recorder([{ id: "dpdshp_1" }])
  const at = new Date("2026-11-03T12:00:00Z")
  assert.equal(await store.claimMark("dpdshp_1", "shipped_marked_at", at), true)
  assert.equal(calls[0].sql, `update "dpd_shipment" set "shipped_marked_at" = ?, "status_writer_error" = null, "updated_at" = now() where "id" = ? and "shipped_marked_at" is null and "deleted_at" is null returning "id"`)
  assert.deepEqual(calls[0].bindings, [at, "dpdshp_1"])
  const long = "x".repeat(800)
  /* Only the mark the caller claimed or found stale: a fresh claim of another caller stays. */
  assert.equal(await store.releaseMark("dpdshp_1", "delivered_marked_at", long, at), true)
  assert.equal(calls[1].sql, `update "dpd_shipment" set "delivered_marked_at" = null, "status_writer_error" = ?, "updated_at" = now() where "id" = ? and "delivered_marked_at" = ? and "deleted_at" is null returning "id"`)
  assert.deepEqual(calls[1].bindings, ["x".repeat(500), "dpdshp_1", at])
  assert.equal(await store.notePendingMark("dpdshp_1", "delivered_marked_at", long), true)
  assert.equal(calls[2].sql, `update "dpd_shipment" set "status_writer_error" = ?, "updated_at" = now() where "id" = ? and "delivered_marked_at" is null and "status_writer_error" is null and "deleted_at" is null returning "id"`)
  assert.deepEqual(calls[2].bindings, ["x".repeat(500), "dpdshp_1"])
  const lost = recorder([])
  assert.equal(await lost.store.claimMark("dpdshp_1", "shipped_marked_at", at), false)
  assert.equal(await lost.store.releaseMark("dpdshp_1", "shipped_marked_at", "e", at), false)
  assert.equal(await lost.store.notePendingMark("dpdshp_1", "shipped_marked_at", "e"), false)
  await assert.rejects(store.claimMark("dpdshp_1", `shipped_marked_at" = now(), "state` as never, at), /Unknown writer mark column/)
  assert.equal(calls.length, 3, "an unknown column never reaches the SQL")
})

test("pruneStatusEvents deletes status events of rows no longer asked for, never action or run events", async () => {
  const { calls, store } = recorder([{ count: 4 }])
  const before = new Date("2026-07-06T12:00:00Z")
  const now = new Date("2026-11-03T12:00:00Z")
  assert.equal(await store.pruneStatusEvents("live", before, now), 4)
  const sql = calls[0].sql
  assert.match(sql, /^with "deleted" as \( delete from "dpd_event" where "kind" = 'status' and "mode" = \? and "occurred_at" < \? and "shipment_id" in \( select "id" from "dpd_shipment" where "mode" = \? and \(/)
  assert.ok(sql.includes(`"deleted_at" is not null or "kind" <> 'outbound' or "state" not in ('created', 'labeled') or coalesce("stage", '') in ('delivered', 'canceled') or coalesce("handed_over_at", "created_at") <= ?`))
  assert.ok(sql.includes(`"e"->>'role' = 'return' and "e"->>'stage' = 'delivered' and "e"->>'supersededBy' is null`))
  assert.match(sql, /returning 1 \) select count\(\*\)::int as "count" from "deleted"$/)
  assert.ok(!/'action'|'run'/.test(sql))
  assert.deepEqual(calls[0].bindings, ["live", before, "live", new Date(now.getTime() - 30 * 86_400_000)])
  assert.equal(await recorder([]).store.pruneStatusEvents("live", before, now), 0)
})

test("statusCounts counts the rows of one mode with a writer error", async () => {
  const { calls, store } = recorder([{ count: "3" }])
  assert.deepEqual(await store.statusCounts("sandbox"), { writerErrors: 3 })
  assert.equal(calls[0].sql, `select count(*)::int as "count" from "dpd_shipment" where "mode" = ? and "deleted_at" is null and "status_writer_error" is not null`)
  assert.deepEqual(calls[0].bindings, ["sandbox"])
  assert.deepEqual(await recorder([]).store.statusCounts("live"), { writerErrors: 0 })
})

test("list with writerFailed adds the writer error condition to the group and the search", async () => {
  const { calls, store } = recorder([{ id: "dpdshp_1", count: 1 }])
  await store.list({ mode: "live", filter: "in_transit", q: "1042", offset: 0, limit: 10, writerFailed: true })
  assert.match(calls[0].sql, /and \("order_id" = \? .*\) and "status_writer_error" is not null order by/)
  assert.match(calls[1].sql, /and "status_writer_error" is not null$/)
  await store.list({ mode: "live", filter: "all", offset: 0, limit: 10 })
  assert.ok(!calls[2].sql.includes("status_writer_error"))
})

test("expectClause with stage: is not distinct from, null included; absent is not checked", async () => {
  assert.deepEqual(expectClause({ stage: "ready" }), { sql: ` and "stage" is not distinct from ?`, bindings: ["ready"] })
  assert.deepEqual(expectClause({ stage: null }), { sql: ` and "stage" is not distinct from ?`, bindings: [null] })
  assert.deepEqual(expectClause({ dispatch_id: null }), { sql: ` and "dispatch_id" is not distinct from ?`, bindings: [null] })
  const { calls, store } = recorder([{ id: "dpdshp_1" }])
  await store.transition("dpdshp_1", ["labeled"], { state: "excluded" }, { dispatch_id: null, stage: "ready" })
  assert.match(calls[0].sql, /where "id" = \? and "state" in \(\?\) and "deleted_at" is null and "dispatch_id" is not distinct from \? and "stage" is not distinct from \? returning \*$/)
  assert.deepEqual(calls[0].bindings.slice(-4), ["dpdshp_1", "labeled", null, "ready"])
})

test("expectClause with tracking and shipped_marked_at: jsonb and time, null included", async () => {
  const tracking = [{ waybill: "0000000000101S", possession: false }]
  const at = new Date("2026-11-02T10:00:00Z")
  assert.deepEqual(expectClause({ tracking }), { sql: ` and "tracking" is not distinct from ?::jsonb`, bindings: [JSON.stringify(tracking)] })
  assert.deepEqual(expectClause({ tracking: null }), { sql: ` and "tracking" is not distinct from ?::jsonb`, bindings: [null] })
  assert.deepEqual(expectClause({ shipped_marked_at: null }), { sql: ` and "shipped_marked_at" is not distinct from ?::timestamptz`, bindings: [null] })
  assert.deepEqual(expectClause({ shipped_marked_at: at }), { sql: ` and "shipped_marked_at" is not distinct from ?::timestamptz`, bindings: [at] })
  const { calls, store } = recorder([{ id: "dpdshp_1" }])
  await store.transition("dpdshp_1", ["labeled"], { state: "excluded" }, { dispatch_id: null, stage: "problem", tracking, shipped_marked_at: null })
  assert.match(calls[0].sql, /and "stage" is not distinct from \? and "tracking" is not distinct from \?::jsonb and "shipped_marked_at" is not distinct from \?::timestamptz returning \*$/)
  assert.deepEqual(calls[0].bindings.slice(-3), ["problem", JSON.stringify(tracking), null])
})

test("markHandedOver sets ready only from null or preparing", async () => {
  const { calls, store } = recorder([{ id: "dpdshp_1" }])
  await store.markHandedOver("dpddsp_1", new Date())
  assert.ok(calls[0].sql.includes(`"stage" = case when "stage" is null or "stage" = 'preparing' then 'ready' else "stage" end`))
})

test("releaseShipments turns ready and null back into preparing and keeps a stage past ready", async () => {
  const { calls, store } = recorder([{ id: "dpdshp_1" }])
  await store.releaseShipments("dpddsp_1", null)
  assert.ok(calls[0].sql.includes(`"stage" = case when "stage" is null or "stage" = 'ready' then 'preparing' else "stage" end`))
})

test("the three status columns are patchable; tracking is jsonb", () => {
  for (const c of ["tracking", "status_at", "status_writer_error"]) assert.ok(PATCHABLE_COLUMNS.includes(c), c)
  const at = new Date("2026-11-03T12:00:00Z")
  assert.deepEqual(setClause({ tracking: [{ waybill: "0000000000101S" }], status_at: at, status_writer_error: null }), {
    sql: `"tracking" = ?::jsonb, "status_at" = ?, "status_writer_error" = ?, "updated_at" = now()`,
    bindings: [JSON.stringify([{ waybill: "0000000000101S" }]), at, null],
  })
})
