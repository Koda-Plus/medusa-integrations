/**
 * The demo of 0.2.0: seeded once per store, from the store's own orders,
 * without a request: KSeF histories, a correction plan (simulated when the
 * store has nothing to correct), reminders and a second month for the summary.
 */
import { afterEach, test } from "node:test"
import assert from "node:assert/strict"
import { ensureDemoDocuments, issueDue } from "../src/workflows/fakturownia/documents.ts"
import { ensureDemoExtras } from "../src/workflows/fakturownia/demo.ts"
import { approvePlan, planCorrections } from "../src/workflows/fakturownia/corrections.ts"
import { resendToKsef } from "../src/workflows/fakturownia/ksef.ts"
import { DEMO_KSEF_REJECTION, decodeDemoId } from "../src/modules/fakturownia/lib/demo.ts"
import { simulatedReturn } from "../src/modules/fakturownia/lib/corrections.ts"
import { writerSettingKey } from "../src/modules/fakturownia/lib/writers.ts"
import { order, setup } from "./helpers.ts"

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

test("the simulated return takes one unit of the first product line at the price paid", () => {
  const p = simulatedReturn([
    { name: "Krem, 50 ml", code: "KREM-50", quantity: 2, unit: "szt.", gross: 123, tax: "23" },
    { name: "Dostawa", code: null, quantity: 1, unit: "szt.", gross: 20, tax: "23" },
  ])
  assert.deepEqual(p?.map((x) => [x.code, x.before.quantity, x.after.quantity, x.delta.gross]), [["KREM-50", 2, 1, -61.5]])
  assert.equal(simulatedReturn([]), null)
})

test("demo seed: once, from the store's own documents, nothing leaves Medusa", async () => {
  const orders = Array.from({ length: 6 }, (_, i) =>
    order({ id: `order_demo_${i}`, display_id: 300 + i, created_at: new Date(Date.UTC(2026, 9, 1 + i)).toISOString() }),
  )
  const s = setup({}, orders)
  globalThis.fetch = (async () => {
    throw new Error("demo mode must not call the network")
  }) as typeof fetch
  await ensureDemoDocuments(s.container)
  await ensureDemoExtras(s.container)
  await ensureDemoExtras(s.container)
  assert.equal(s.settings.rows.filter((r) => r.key === "demo:seeded:0.2.0").length, 1)

  const vat = s.documents.rows.filter((r) => r.kind === "vat" && (r.status === "issued" || r.status === "needs_correction"))
  const resolved = vat.find((r) => s.ksef.rows.some((k) => k.document_id === r.id && k.source === "resend"))!
  assert.equal(resolved.gov_status, "ok")
  assert.deepEqual(
    s.ksef.rows.filter((k) => k.document_id === resolved.id).map((k) => k.gov_status),
    ["processing", "send_error", "processing", "ok"],
  )
  const rejected = vat.find((r) => r.gov_status === "send_error")!
  assert.deepEqual(rejected.gov_errors, [DEMO_KSEF_REJECTION])

  const plan = s.plans.rows[0]
  assert.deepEqual([s.plans.rows.length, plan.status, plan.simulated, plan.reasons], [1, "draft", true, ["return"]])
  assert.ok(plan.delta_gross < 0)
  await planCorrections(s.container, plan.order_id, null, { force: true })
  assert.equal(s.plans.rows.length, 1, "a simulated plan is never recomputed away")

  const backdated = vat.filter((r) => r.issue_date !== vat[0].issue_date || r.issued_at < new Date(Date.now() - 2 * 86_400_000))
  assert.ok(backdated.length >= 1)
  for (const d of backdated) {
    assert.equal(d.paid, false)
    assert.equal(decodeDemoId(d.fakturownia_id)?.number, d.number, "the simulated id still carries the number")
    assert.equal(d.number.split(" ")[1].split("/")[1], d.issue_date.slice(5, 7), "numbered for its month")
  }

  await s.planStore.setSetting(writerSettingKey("corrections", true), { on: true }, "user_1")
  await approvePlan(s.container, plan.id, { revision: plan.revision, actorId: "user_1" })
  await issueDue(s.container, "schedule")
  const correction = s.documents.rows.find((r) => r.kind === "correction")!
  assert.equal(correction.status, "issued")
  assert.equal(s.plans.rows[0].status, "issued")

  await s.planStore.setSetting(writerSettingKey("ksef", true), { on: true }, "user_1")
  await resendToKsef(s.container, rejected.id, "user_1")
  assert.equal(rejected.gov_status, "processing")
})

test("demo seed waits for documents: a store without enough of them is not marked seeded", async () => {
  const s = setup({}, [order()])
  await ensureDemoDocuments(s.container)
  await ensureDemoExtras(s.container)
  assert.equal(s.settings.rows.length, 0)
})
