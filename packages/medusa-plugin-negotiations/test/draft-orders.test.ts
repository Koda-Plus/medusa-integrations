/**
 * The draft order writer: pure input building, then the flow against the
 * in-memory outbox and a fake Medusa that counts every create.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  buildDraftOrderInput,
  draftAddress,
  pickRegion,
  simulatedDraftOrder,
  SIMULATED_CUSTOMER_ID,
  type DraftContext,
} from "../src/modules/negotiations/lib/draft-order.ts"
import { normalizeThread } from "../src/modules/negotiations/lib/thread.ts"
import type { ThreadRow } from "../src/modules/negotiations/lib/rows.ts"
import { draftPlan, queueDraftOrder, runDraftOrders, setWriter, writerStates } from "../src/workflows/negotiations/draft-orders.ts"
import { adminAccept, adminCounter, customerAccept, openNegotiation } from "../src/workflows/negotiations/threads.ts"
import { ActionError } from "../src/workflows/negotiations/runtime.ts"
import { setup, type Setup } from "./helpers.ts"

function accepted(over: Partial<ThreadRow> = {}) {
  return normalizeThread(
    {
      id: "neg_1",
      ref: "NEG-2026-1001",
      status: "accepted",
      customer_id: "cus_1",
      cart_id: null,
      order_id: null,
      product_id: "prod_1",
      variant_id: "variant_1",
      sku: "KS-1",
      qty: 24,
      assigned_to: null,
      metadata: null,
      created_at: "2026-10-06T10:00:00Z",
      updated_at: "2026-10-07T10:00:00Z",
      subject: "variant",
      title: "Drill 18V",
      currency_code: "pln",
      agreed_amount: 46950,
      price_amount: 46950,
      ...over,
    },
    { defaultCurrency: null, expiryDays: 14 },
  )
}

const ctx = (over: Partial<DraftContext> = {}): DraftContext => ({
  region: { id: "reg_pl", currencyCode: "pln" },
  salesChannelId: "sc_main",
  customer: { id: "cus_1", email: "anna@example.com", shippingAddress: { country_code: "pl", city: "Poznań" }, billingAddress: null },
  variant: { id: "variant_1", title: "Default", productTitle: "Drill 18V" },
  taxInclusive: false,
  ...over,
})

test("the draft order input: the customer, one line at the agreed unit price, a draft that sends nothing", () => {
  const r = buildDraftOrderInput(accepted(), ctx())
  assert.ok(r.ok)
  if (!r.ok) return
  assert.deepEqual(r.input, {
    region_id: "reg_pl",
    customer_id: "cus_1",
    email: "anna@example.com",
    currency_code: "pln",
    status: "draft",
    is_draft_order: true,
    no_notification: true,
    items: [
      {
        variant_id: "variant_1",
        title: "Drill 18V",
        quantity: 24,
        unit_price: 469.5,
        is_tax_inclusive: false,
        metadata: { negotiation_id: "neg_1", negotiation_ref: "NEG-2026-1001", agreed_price: "469.50" },
      },
    ],
    metadata: { negotiation_id: "neg_1", negotiation_ref: "NEG-2026-1001" },
    sales_channel_id: "sc_main",
    shipping_address: { country_code: "pl", city: "Poznań" },
  })
})

test("what cannot become a draft says why instead of guessing", () => {
  const reason = (t: ReturnType<typeof accepted>, c: DraftContext) => {
    const r = buildDraftOrderInput(t, c)
    return r.ok ? "ok" : r.reason
  }
  assert.equal(reason(accepted({ status: "open" }), ctx()), "not_accepted")
  assert.equal(reason(accepted({ subject: "cart", variant_id: null, cart_id: "cart_1" }), ctx()), "cart")
  assert.equal(reason(accepted({ subject: "product", variant_id: null }), ctx()), "no_variant")
  assert.equal(reason(accepted({ agreed_amount: null, price_amount: null }), ctx()), "no_price")
  assert.equal(reason(accepted(), ctx({ region: { id: "reg_eu", currencyCode: "eur" } })), "no_region")
  assert.equal(reason(accepted({ customer_id: null }), ctx()), "no_customer")
  assert.equal(reason(accepted(), ctx({ customer: { id: "cus_1", email: null, shippingAddress: null, billingAddress: null } })), "no_email")
  const simulated = buildDraftOrderInput(accepted({ customer_id: null }), ctx({ region: null, customer: null, simulate: true }))
  assert.ok(simulated.ok && simulated.input.customer_id === SIMULATED_CUSTOMER_ID, "demo mode simulates what a demo store lacks")
})

test("regions, addresses and simulated drafts", () => {
  const regions = [
    { id: "reg_b", name: "B", currency_code: "pln" },
    { id: "reg_a", name: "A", currency_code: "PLN" },
    { id: "reg_e", name: "E", currency_code: "eur" },
  ]
  assert.deepEqual(pickRegion(regions, "pln", null), { id: "reg_a", currencyCode: "pln" })
  assert.deepEqual(pickRegion(regions, "pln", "reg_b"), { id: "reg_b", currencyCode: "pln" })
  assert.deepEqual(pickRegion(regions, "pln", "reg_e"), { id: "reg_a", currencyCode: "pln" }, "a configured region in another currency is not used")
  assert.equal(pickRegion(regions, "usd", null), null)
  assert.equal(draftAddress({ city: "X" }), null, "no country, no address")
  assert.deepEqual(draftAddress({ country_code: "PL", city: " Poznań ", phone: "" }), { country_code: "pl", city: "Poznań" })
  assert.deepEqual(simulatedDraftOrder("neg_1"), simulatedDraftOrder("neg_1"))
  assert.notEqual(simulatedDraftOrder("neg_1").id, simulatedDraftOrder("neg_2").id)
})

async function acceptedThread(s: Setup) {
  const r = await openNegotiation(s.container, { customerId: "cus_anna", body: { variant_id: "variant_drill", quantity: 24, target_price: "469", message: "24 drills" }, salesChannelIds: [] })
  await adminCounter(s.container, { id: r.thread.id, actorId: "user_1", body: { price: "489" } })
  await customerAccept(s.container, { customerId: "cus_anna", id: r.thread.id, body: { price: "489" } })
  return r.thread.id
}

test("off by default: the option forbids arming, nothing is queued, a run is refused", async () => {
  const s = setup()
  assert.deepEqual((await writerStates(s.container)).draftOrders, { key: "draftOrders", allowed: false, on: false, armed: false, updatedBy: null, updatedAt: null })
  await assert.rejects(setWriter(s.container, "draftOrders", true, "user_1"), (e: unknown) => e instanceof ActionError && e.code === "writer_forbidden")
  await acceptedThread(s)
  assert.equal(s.memory.drafts.size, 0)
  await assert.rejects(runDraftOrders(s.container, { dryRun: false, trigger: "manual" }), (e: unknown) => e instanceof ActionError && e.code === "writer_off")
  assert.equal(s.created.length, 0)
})

test("allowed and armed: an accept is queued, the plan shows the exact input, a run creates the draft once", async () => {
  const s = setup({ writers: { draftOrders: true } })
  const old = await acceptedThread(s)
  assert.equal(s.memory.drafts.size, 0, "accepted before arming: arming never sweeps the history")
  const armed = await setWriter(s.container, "draftOrders", true, "user_1")
  assert.deepEqual([armed.armed, armed.updatedBy], [true, "user_1"])

  const fresh = await openNegotiation(s.container, { customerId: "cus_ben", body: { variant_id: "variant_gloves", quantity: 100, target_price: "7.50", message: "100 pairs" }, salesChannelIds: [] })
  await adminAccept(s.container, { id: fresh.thread.id, actorId: "user_1", body: {} })
  assert.equal(s.memory.drafts.size, 1)

  const plan = await draftPlan(s.container)
  assert.equal(plan.items.length, 1)
  assert.equal(plan.items[0].ready, true)
  assert.deepEqual((plan.items[0].input as { items: Array<{ unit_price: number; quantity: number }> }).items[0], {
    variant_id: "variant_gloves",
    title: "Coated gloves / Size 10",
    quantity: 100,
    unit_price: 7.5,
    is_tax_inclusive: false,
    metadata: { negotiation_id: fresh.thread.id, negotiation_ref: fresh.thread.ref, agreed_price: "7.50" },
  } as never)

  const dry = await runDraftOrders(s.container, { dryRun: true, trigger: "manual" })
  assert.equal(dry.run, null)
  assert.equal(s.created.length, 0, "a dry run writes nothing")

  const run = await runDraftOrders(s.container, { dryRun: false, trigger: "manual" })
  assert.equal(run.run?.counts.created, 1)
  assert.equal(s.created.length, 1)
  assert.equal(s.created[0].input.customer_id, "cus_ben")
  const again = await runDraftOrders(s.container, { dryRun: false, trigger: "schedule" })
  assert.equal(again.run?.counts.created, 0)
  assert.equal(s.created.length, 1, "exactly once")
  const record = [...s.memory.drafts.values()][0]
  assert.deepEqual([record.state, record.draft_order_id, record.display_id], ["created", "order_1", 101])
  assert.ok(s.memory.messages.some((m) => m.kind === "draft_order" && m.internal === true && m.negotiation_id === fresh.thread.id))

  /* The older thread: a person queues it on purpose. */
  await queueDraftOrder(s.container, old, "user_1")
  await runDraftOrders(s.container, { dryRun: false, trigger: "manual" })
  assert.equal(s.created.length, 2)
})

test("failures are kept with Medusa's message and retried; an interrupted create is looked up before a new one", async () => {
  const s = setup({ writers: { draftOrders: true } })
  await setWriter(s.container, "draftOrders", true, "user_1")
  const id = await acceptedThread(s)
  s.nextCreate.fail = "Variant does not have the required inventory"
  const failed = await runDraftOrders(s.container, { dryRun: false, trigger: "schedule" })
  assert.equal(failed.run?.status, "error")
  const row = [...s.memory.drafts.values()][0]
  assert.deepEqual([row.state, row.error, row.attempts], ["failed", "Variant does not have the required inventory", 1])
  await runDraftOrders(s.container, { dryRun: false, trigger: "schedule" })
  assert.equal(s.created.length, 1, "the retry created it")

  /* A process that died after Medusa created the order: the lease runs out, the lookup adopts it. */
  const t = setup({ writers: { draftOrders: true } })
  await setWriter(t.container, "draftOrders", true, null)
  const id2 = await acceptedThread(t)
  const draft = [...t.memory.drafts.values()][0]
  Object.assign(draft, { state: "creating", claim_token: "dead", claimed_at: new Date(Date.now() - 3_600_000), lease_until: new Date(Date.now() - 60_000) })
  t.catalog.orders.push({ id: "order_lost", display_id: 77, metadata: { negotiation_id: id2 }, is_draft_order: true })
  const adopted = await runDraftOrders(t.container, { dryRun: false, trigger: "schedule" })
  assert.equal(adopted.run?.counts.adopted, 1)
  assert.equal(t.created.length, 0, "found, not created again")
  assert.deepEqual([draft.state, draft.draft_order_id], ["created", "order_lost"])
  void id
})

test("blocked threads wait with the reason and go on once fixed", async () => {
  const s = setup({ writers: { draftOrders: true } }, { regions: [{ id: "reg_eu", name: "Europe", currency_code: "eur" }] })
  await setWriter(s.container, "draftOrders", true, null)
  await acceptedThread(s)
  const run = await runDraftOrders(s.container, { dryRun: false, trigger: "schedule" })
  assert.equal(run.run?.counts.blocked, 1)
  assert.equal(run.items[0].blocked, "no_region")
  assert.equal([...s.memory.drafts.values()][0].state, "blocked")
  s.catalog.regions.push({ id: "reg_pl", name: "Polska", currency_code: "pln" })
  await runDraftOrders(s.container, { dryRun: false, trigger: "schedule" })
  assert.equal(s.created.length, 1)
})

test("demo mode: allowed by default, simulated, nothing reaches Medusa", async () => {
  const s = setup({ demo: true })
  await setWriter(s.container, "draftOrders", true, "user_demo")
  await acceptedThread(s)
  const run = await runDraftOrders(s.container, { dryRun: false, trigger: "manual" })
  assert.equal(run.run?.counts.created, 1)
  assert.equal(s.created.length, 0)
  const row = [...s.memory.drafts.values()][0]
  assert.ok(row.draft_order_id?.startsWith("order_simulated_"))
  assert.equal(row.demo, true)
})
