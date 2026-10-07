import { test } from "node:test"
import assert from "node:assert/strict"
import { createImportStore, createOutboxStore, ordersByRef, setClause, takeLease, takeRefreshLease } from "../src/modules/allegro/lib/store.ts"

function recorder(rows: unknown[] = [{ id: "x" }]) {
  const calls: Array<{ sql: string; bindings: readonly unknown[] }> = []
  return {
    calls,
    sql: {
      async raw(sql: string, bindings: readonly unknown[] = []) {
        calls.push({ sql: sql.replace(/\s+/g, " ").trim(), bindings })
        return { rows }
      },
    },
  }
}

test("store: a claim is ONE update, only from pending or unknown, only when due", async () => {
  const r = recorder()
  const store = createImportStore({ sql: r.sql, newId: () => "algimp_1" })
  await store.claim("algimp_1", { now: new Date(0), leaseUntil: new Date(1000), token: "tok" })
  const { sql, bindings } = r.calls[0]
  assert.match(sql, /^update "allegro_order_import" set "status" = 'importing', "claim_token" = \?/)
  assert.match(sql, /where "id" = \? and "status" in \('pending', 'unknown'\)/)
  assert.match(sql, /"next_attempt_at" is null or "next_attempt_at" <= \?/)
  assert.match(sql, /returning \*$/)
  assert.deepEqual(bindings, ["tok", new Date(1000), "algimp_1", new Date(0)])
})

test("store: only the claim's owner writes the result; unknown columns never reach the SQL", async () => {
  const r = recorder()
  const store = createImportStore({ sql: r.sql, newId: () => "id" })
  await store.finish("algimp_1", "tok", { status: "imported", total: { value: 1, currency: "PLN" }, evil: "x" } as never)
  const { sql, bindings } = r.calls[0]
  assert.match(sql, /"status" = \?, "total" = \?::jsonb, "updated_at" = now\(\), "claim_token" = null, "lease_until" = null/)
  assert.match(sql, /where "id" = \? and "status" = 'importing' and "claim_token" = \?/)
  assert.ok(!sql.includes("evil"))
  assert.deepEqual(bindings, ["imported", JSON.stringify({ value: 1, currency: "PLN" }), "algimp_1", "tok"])
  assert.deepEqual(setClause({ status: "x", nope: 1 }, ["status"]).bindings, ["x"])
})

test("store: progress writes the order id while the claim stays held, only for its owner", async () => {
  const r = recorder()
  const store = createImportStore({ sql: r.sql, newId: () => "id" })
  assert.equal(await store.progress("algimp_1", "tok", { order_id: "order_1", display_id: 12 }), true)
  const { sql, bindings } = r.calls[0]
  assert.match(sql, /set "order_id" = \?, "display_id" = \?, "updated_at" = now\(\) where "id" = \? and "status" = 'importing' and "claim_token" = \?/)
  assert.ok(!sql.includes('"claim_token" = null'), "the claim is not released")
  assert.deepEqual(bindings, ["order_1", 12, "algimp_1", "tok"])
  const lost = createImportStore({ sql: recorder([]).sql, newId: () => "id" })
  assert.equal(await lost.progress("algimp_1", "tok", { order_id: "order_1" }), false)
})

test("store: inserts ignore a conflict with the unique index, leases expire into unknown", async () => {
  const r = recorder([])
  const imports = createImportStore({ sql: r.sql, newId: () => "algimp_1" })
  assert.equal(await imports.insertIgnore({ checkout_form_id: "F", status: "pending", source: "events", demo: false }), null)
  assert.match(r.calls[0].sql, /on conflict do nothing returning \*$/)
  await imports.expireLeases(new Date(0))
  assert.match(r.calls[1].sql, /set "status" = 'unknown'.*where "status" = 'importing' and "lease_until" < \?/)
  const outbox = createOutboxStore({ sql: r.sql, newId: () => "algout_1" })
  await outbox.insertIgnore({ writer: "shipping", dedupeKey: "parcel:F:W", checkout_form_id: "F", order_id: null, payload: { waybill: "W" }, demo: false })
  assert.match(r.calls[2].sql, /insert into "allegro_outbox" \("id", "writer", "dedupe_key"/)
  await outbox.claim("algout_1", { now: new Date(0), leaseUntil: new Date(1), token: "t" })
  assert.match(r.calls[3].sql, /set "status" = 'sending'/)
})

test("store: run leases and the refresh lease are taken atomically", async () => {
  const r = recorder()
  assert.equal(await takeLease(r.sql, "stock", "owner-1", 60_000), true)
  assert.match(r.calls[0].sql, /on conflict \("id"\) do update .* where .*::timestamptz < now\(\) returning "id"$/)
  assert.equal(r.calls[0].bindings[0], "lease:stock")
  assert.equal(await takeRefreshLease(r.sql, "default", "owner-1", 45_000), true)
  assert.match(r.calls[1].sql, /"refresh_lease_until" is null or "refresh_lease_until" < now\(\)/)
  const none = recorder([])
  assert.equal(await takeLease(none.sql, "stock", "owner-2", 60_000), false)
})

test("store: the marketplace reference is looked up in every Medusa order, ours only by our own record", async () => {
  const r = recorder([{ id: "order_1", display_id: "12", ref: "allegro:F", ours: false, draft: true }])
  const rows = await ordersByRef(r.sql, ["allegro:F"])
  assert.deepEqual(rows, [{ id: "order_1", ref: "allegro:F", display_id: 12, ours: false, draft: true }])
  const sql = r.calls[0].sql.replace(/\s+/g, " ")
  assert.match(sql, /o\."metadata"->>'marketplace_order_ref' in \(\?\)/)
  /* A draft counts as existing: drafts left by a crash are finished, never created again. */
  assert.match(sql, /o\."status" = 'draft' or coalesce\(o\."is_draft_order", false\)/)
  /* Ours: an import row names the order (never a duplicate of another integration), or a draft no cart placed. */
  assert.match(sql, /exists \(select 1 from "allegro_order_import" i where i\."order_id" = o\."id" and i\."deleted_at" is null and i\."reason_code" is distinct from 'duplicate_ref'\)/)
  assert.match(sql, /not exists \(select 1 from "order_cart" oc where oc\."order_id" = o\."id"/)
  assert.doesNotMatch(sql, /\("metadata"->>'allegro_checkout_form_id'\) is not null as "ours"/)
  assert.deepEqual(await ordersByRef(r.sql, []), [])
})
