import { test } from "node:test"
import assert from "node:assert/strict"
import { createPlanItemStore, createPublicationStore, setClause, PLAN_PATCHABLE } from "../src/modules/olx/lib/store.ts"

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

test("a claim is one conditional update: only from pending or failed, with a token and a lease", async () => {
  const r = recorder()
  const store = createPlanItemStore(r.sql)
  const now = new Date("2026-10-06T12:00:00Z")
  await store.claim("olxpi_1", { now, leaseUntil: new Date(now.getTime() + 600_000), token: "t1" })
  const { sql, bindings } = r.calls[0]
  assert.match(sql, /^update "olx_plan_item" set "state" = 'applying', "claim_token" = \?, "lease_until" = \?/)
  assert.match(sql, /where "id" = \? and "state" in \('pending', 'failed'\) and "deleted_at" is null returning \*$/)
  assert.deepEqual(bindings.slice(2), [now, "olxpi_1"])
})

test("the result is written only by the claim's owner, transitions only from the given states", async () => {
  const r = recorder()
  const store = createPlanItemStore(r.sql)
  await store.finish("olxpi_1", "t1", { state: "done", attempts: 0, to_value: { value: 1, currency: "PLN" }, not_a_column: "x" })
  assert.match(r.calls[0].sql, /where "id" = \? and "state" = 'applying' and "claim_token" = \?/)
  assert.ok(!r.calls[0].sql.includes("not_a_column"), "only whitelisted columns reach the SQL")
  assert.ok(r.calls[0].sql.includes(`"to_value" = ?::jsonb`))
  await store.transition("olxpi_1", ["held"], { state: "pending" })
  assert.match(r.calls[1].sql, /"state" in \(\?\)/)
  assert.deepEqual(r.calls[1].bindings.slice(-2), ["olxpi_1", "held"])
  assert.equal(await store.transition("olxpi_1", [], { state: "pending" }), null)
  await store.expireLeases(new Date(), true)
  assert.match(r.calls[2].sql, /set "state" = 'unknown'.*where "state" = 'applying' and "lease_until" < \? and "demo" = \?/)
})

test("one publication per variant: the insert ignores a conflict, and only unsent rows can be deleted", async () => {
  const r = recorder([])
  const store = createPublicationStore(r.sql, () => "olxpub_1")
  const row = await store.insertIgnore({
    variant_id: "variant_1",
    product_id: "prod_1",
    sku: "SKU-1",
    title: "Advert",
    olx_category_id: 1559,
    state: "planned",
    payload: { title: "Advert" },
    missing: [],
    warnings: [],
    demo: false,
    planned_at: new Date(),
  })
  assert.equal(row, null, "a conflicting insert returns nothing")
  assert.match(r.calls[0].sql, /^insert into "olx_publication" .* on conflict do nothing returning \*$/)
  await store.deleteUnsent(["olxpub_1", "olxpub_2"])
  assert.match(r.calls[1].sql, /^delete from "olx_publication" where "id" in \(\?, \?\) and "state" in \(\?, \?, \?, \?\) returning "id"$/)
  assert.deepEqual(r.calls[1].bindings, ["olxpub_1", "olxpub_2", "planned", "blocked", "failed", "quarantined"])
  assert.equal(await store.deleteUnsent([]), 0)
  await store.claim("olxpub_1", { now: new Date(), leaseUntil: new Date(), token: "t" })
  assert.match(r.calls[2].sql, /set "state" = 'publishing'.*"state" in \('planned', 'failed'\)/)
})

test("set clause: whitelisted columns, jsonb casts, updated_at always", () => {
  const set = setClause({ state: "done", from_value: null, attempts: undefined }, PLAN_PATCHABLE)
  assert.equal(set.sql, `"from_value" = ?::jsonb, "state" = ?, "updated_at" = now()`)
  assert.deepEqual(set.bindings, [null, "done"])
})
