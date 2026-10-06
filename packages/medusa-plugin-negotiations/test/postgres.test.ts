/**
 * THE SQL AGAINST A REAL POSTGRES, when one is given. Skipped otherwise, so
 * `npm test` needs no database.
 *
 *   NEGOTIATIONS_TEST_PG_URL=postgres://user:pass@localhost:5432/scratch npm test
 *
 * Everything happens in a schema of its own (`neg_test_<random>`, dropped at
 * the end), never in the tables of the database it connects to:
 *
 *   1. the tables of the Koda Plus app module, as its three migrations left
 *      them, with rows like the demo store's;
 *   2. the plugin migration, twice: it must be idempotent and keep the rows;
 *   3. moves, guards, the expiry CTE, the demo story, settings, runs and the
 *      draft order outbox, statement by statement.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { Migration20261007100000 } from "../src/modules/negotiations/migrations/Migration20261007100000.ts"
import { createDraftOrderStore, createSettingStore, createThreadStore } from "../src/modules/negotiations/lib/store.ts"
import { normalizeThread } from "../src/modules/negotiations/lib/thread.ts"
import { buildDemoStory } from "../src/modules/negotiations/lib/demo.ts"

const url = process.env.NEGOTIATIONS_TEST_PG_URL

const LEGACY = `
  CREATE TABLE IF NOT EXISTS "negotiation" (
    "id" TEXT NOT NULL, "customer_id" TEXT NULL, "cart_id" TEXT NULL, "order_id" TEXT NULL, "product_id" TEXT NULL,
    "variant_id" TEXT NULL, "sku" TEXT NULL, "qty" INTEGER NOT NULL DEFAULT 1, "target_price" NUMERIC NULL,
    "status" TEXT NOT NULL DEFAULT 'open', "ref" TEXT NOT NULL, "assigned_to" TEXT NULL, "metadata" JSONB NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(), "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(), "deleted_at" TIMESTAMPTZ NULL,
    CONSTRAINT "negotiation_pkey" PRIMARY KEY ("id"));
  CREATE INDEX IF NOT EXISTS "IDX_negotiation_status" ON "negotiation" ("status");
  CREATE TABLE IF NOT EXISTS "negotiation_message" (
    "id" TEXT NOT NULL, "negotiation_id" TEXT NOT NULL, "author_type" TEXT NOT NULL DEFAULT 'system', "author_id" TEXT NULL,
    "body" TEXT NOT NULL, "attachments" JSONB NULL, "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(), "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "deleted_at" TIMESTAMPTZ NULL, CONSTRAINT "negotiation_message_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "FK_negotiation_message_neg" FOREIGN KEY ("negotiation_id") REFERENCES "negotiation"("id") ON DELETE CASCADE);
  ALTER TABLE IF EXISTS "negotiation" ADD COLUMN IF NOT EXISTS "raw_target_price" JSONB NULL;
`

test("the migration and every statement on a real Postgres", { skip: url ? false : "set NEGOTIATIONS_TEST_PG_URL to run it" }, async () => {
  const require = createRequire(import.meta.url)
  const knexFactory = require("knex")
  const schema = `neg_test_${Math.random().toString(36).slice(2, 10)}`
  const admin = knexFactory({ client: "pg", connection: url })
  await admin.raw(`create schema "${schema}"`)
  const db = knexFactory({ client: "pg", connection: url, searchPath: [schema] })
  const ago = (h: number) => new Date(Date.now() - h * 3_600_000)
  try {
    await db.raw(LEGACY)
    await db("negotiation").insert({ id: "neg_l1", ref: "NEG-2026-0409", status: "counter_offered", customer_id: "cus_1", product_id: "p", variant_id: "v", sku: "S", qty: 120, target_price: 38.5, created_at: ago(28), updated_at: ago(21) })
    await db("negotiation_message").insert([
      { id: "m1", negotiation_id: "neg_l1", author_type: "customer", body: "36?", created_at: ago(28) },
      { id: "m2", negotiation_id: "neg_l1", author_type: "system", author_id: "Remik", body: "Kontroferta: 38.5", created_at: ago(21) },
    ])

    const statements: string[] = []
    const migration = Object.create(Migration20261007100000.prototype) as { addSql(s: string): void; up(): Promise<void> }
    migration.addSql = (s: string) => statements.push(s)
    await migration.up()
    for (let round = 0; round < 2; round += 1) {
      await db.transaction(async (trx: { raw(s: string): Promise<unknown> }) => {
        for (const s of statements) await trx.raw(s)
      })
    }

    const [old] = await db("negotiation").where("id", "neg_l1")
    assert.deepEqual([old.waiting_for, old.message_count, old.subject, old.demo, String(old.target_price)], ["customer", 2, "variant", false, "38.5"])
    const t = normalizeThread(old, { defaultCurrency: "pln", expiryDays: 14 })
    assert.deepEqual([t.legacy, t.offered], [true, 3850])

    const threads = createThreadStore(db)
    assert.equal(await threads.nextRefNumber(), 1001)
    const accepted = await threads.act({
      id: "neg_l1",
      demo: false,
      from: ["counter_offered"],
      guard: { maxMessages: 200 },
      patch: { status: "accepted", waiting_for: null, agreed_amount: 3850, price_amount: 3850, currency_code: "pln" },
      countMessage: true,
      message: { id: "m3", negotiation_id: "neg_l1", author_type: "customer", author_id: "cus_1", kind: "accepted", body: "", amount: 3850, internal: false, metadata: null, created_at: new Date() },
      now: new Date(),
    })
    assert.equal(accepted?.thread.status, "accepted")
    assert.equal(await threads.act({ id: "neg_l1", demo: false, from: ["counter_offered"], patch: {}, countMessage: false, message: null, now: new Date() }), null)

    await db("negotiation").insert({ id: "neg_l2", ref: "NEG-2026-0410", status: "open", qty: 1, demo: false, last_activity_at: ago(24 * 20), waiting_for: "team" })
    const expired = await threads.expireDue({
      demo: false,
      now: new Date(),
      cutoff: ago(24 * 14),
      limit: 10,
      message: (r) => ({ id: `e_${r.id}`, negotiation_id: r.id, author_type: "system", author_id: null, kind: "expired", body: "x", amount: null, internal: false, metadata: null, created_at: new Date() }),
    })
    assert.deepEqual(expired.map((e) => [e.thread.id, e.previousStatus]), [["neg_l2", "open"]])

    const story = buildDemoStory({ variants: [{ variantId: "v", productId: "p", sku: "S", productTitle: "Drill", variantTitle: null, amount: 54900 }], customers: [], currency: "pln", now: new Date() })
    await threads.replaceDemoStory(story.threads, story.messages)
    await threads.replaceDemoStory(story.threads, story.messages)
    assert.equal(await threads.countDemoStory(), 9)
    assert.equal((await threads.listThreads({ demo: true, excludeDemoStory: true, limit: 10, offset: 0 })).count, 0)
    assert.ok((await threads.statusCounts(false)).length > 0)
    assert.equal((await threads.lastMessages(["neg_l1"]))[0]?.id, "m3")

    const settings = createSettingStore(db, (p) => `${p}_${Math.random().toString(36).slice(2, 10)}`)
    await settings.put("live:writer:draftOrders", { on: true }, "a", new Date())
    await settings.put("live:writer:draftOrders", { on: false }, "b", new Date())
    assert.deepEqual((await settings.get(["live:writer:draftOrders"]))[0].value, { on: false })
    await settings.recordRun({ id: "r1", kind: "expire", trigger: "manual", status: "ok", demo: false, counts: { expired: 1 }, message: null, started_at: new Date(), finished_at: new Date(), duration_ms: 1 }, 50)
    assert.equal((await settings.lastRuns(false))[0].id, "r1")

    const drafts = createDraftOrderStore(db)
    assert.ok(await drafts.queue({ id: "d1", negotiation_id: "neg_l1", demo: false, requested_by: null, now: new Date() }))
    assert.equal(await drafts.queue({ id: "d2", negotiation_id: "neg_l1", demo: false, requested_by: null, now: new Date() }), null)
    assert.equal((await drafts.claim("d1", { now: new Date(), leaseUntil: new Date(), token: "t" }))?.state, "creating")
    assert.equal(await drafts.finish("d1", "t", { state: "created", draft_order_id: "order_1", payload: { a: 1 } }, new Date()), true)
    assert.deepEqual(await drafts.counts(false), { created: 1 })
  } finally {
    await db.destroy()
    await admin.raw(`drop schema "${schema}" cascade`)
    await admin.destroy()
  }
})
