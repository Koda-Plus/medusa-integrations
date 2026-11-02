/**
 * DPD in the koda.integration/1 contract: the shared conformance checks on
 * sample rows, then what DPD itself promises: the worst shipment of an order
 * speaks, the checkout's choice shows before any fulfillment, cash on
 * delivery is a payment fact, links stay inside the admin, the counters are
 * the Panel's, and nothing is read from order metadata.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { integrationEn, integrationPl } from "../src/modules/dpd/lib/integration-texts.ts"
import { shipmentLine } from "../src/modules/dpd/lib/integration.ts"
import { makeContext } from "../src/modules/dpd/lib/kit-routes.ts"
import { dpdIntegration } from "../src/workflows/dpd/integration.ts"
import { conformance } from "./kit-conformance.ts"
import { arm, order, SANDBOX, setup, type Row, type Setup } from "./helpers.ts"

const A = "order_01INTEGRATION0000000001"
const B = "order_01INTEGRATION0000000002"
const C = "order_01INTEGRATION0000000003"
const D = "order_01INTEGRATION0000000004"

function sample(): Setup {
  const s = setup({ ...SANDBOX, shipmentWriter: true }, [
    order({ id: A, display_id: 1001 }),
    order({ id: B, display_id: 1002 }),
    order({
      id: C,
      display_id: 1003,
      /* A shopper's metadata must change nothing. */
      metadata: { dpd_waybill: "99999999999999D", dpd_cod: true },
      shipping_methods: [{ id: "sm_c", name: "DPD Pickup, cash on delivery", data: { dpd_option: "dpd-pickup-cod", dpd_kind: "pickup", dpd_cod: true, dpd_pudo_id: "PL14509", dpd_country: "PL" } }],
    }),
    order({ id: D, display_id: 1004, metadata: { dpd_option: "dpd-courier-cod" }, shipping_methods: [{ id: "sm_d", name: "Manual", data: {} }] }),
  ])
  const base = { mode: "sandbox", kind: "outbound", option_id: "dpd-courier", currency: "PLN", attempts: 0, handed_over_at: null, stage: null, problems: null }
  s.shipments.insert({ ...base, order_id: A, display_id: 1001, fulfillment_id: "ful_a1", state: "labeled", stage: "delivered", waybills: ["99000000000001D"], last_checked_at: "2026-11-01T10:00:00Z", handed_over_at: "2026-10-31T10:00:00Z" })
  s.shipments.insert({ ...base, order_id: A, display_id: 1001, fulfillment_id: "ful_a2", state: "labeled", stage: "problem", waybills: ["99000000000002D"], last_checked_at: "2026-11-02T10:00:00Z", handed_over_at: "2026-10-31T10:00:00Z" })
  s.shipments.insert({ ...base, order_id: B, display_id: 1002, fulfillment_id: "ful_b1", option_id: "dpd-pickup-cod", pudo_id: "PL14509", state: "pending" })
  s.shipments.insert({ ...base, order_id: B, display_id: 1002, fulfillment_id: "ful_b2", state: "labeled", cod_minor: 12999, option_id: "dpd-courier-cod" })
  /* A demo row of the same order never shows in sandbox mode. */
  s.shipments.insert({ ...base, mode: "demo", order_id: B, display_id: 1002, state: "failed" })
  return s
}

function recordWrites(s: Setup): () => string[] {
  const calls: string[] = []
  const store = s.store as unknown as Record<string, unknown>
  for (const k of Object.keys(store)) {
    const fn = store[k]
    if (typeof fn !== "function" || k === "counts" || k === "list") continue
    store[k] = (...args: unknown[]) => {
      calls.push(`store.${k}`)
      return (fn as (...a: unknown[]) => unknown)(...args)
    }
  }
  const svc = s.container.resolve<Record<string, unknown>>("dpd")
  for (const k of Object.keys(svc)) {
    const fn = svc[k]
    if (typeof fn !== "function" || !/^(create|update|delete)/.test(k)) continue
    svc[k] = (...args: unknown[]) => {
      calls.push(`dpd.${k}`)
      return (fn as (...a: unknown[]) => unknown)(...args)
    }
  }
  const bus = s.container.resolve<{ emit: (...a: unknown[]) => unknown }>("event_bus")
  const emit = bus.emit
  bus.emit = (...args: unknown[]) => {
    calls.push("event_bus.emit")
    return emit(...args)
  }
  return () => calls
}

{
  const s = sample()
  conformance({ routes: dpdIntegration, scope: s.container, entity: "order", knownIds: [A, B, C, D], writes: recordWrites(s) })
}

test("the worst shipment of the order speaks, with the count of the others", async () => {
  const s = sample()
  const [a] = await dpdIntegration.build.summaries(makeContext({ scope: s.container, lang: "pl" }), "order", [A])
  assert.equal(a.state, "failed")
  assert.equal(a.title.key, "integration.order.problem")
  assert.equal(a.title.fallback, "Problem z doręczeniem")
  assert.equal(a.detail?.key, "integration.order.more")
  assert.equal(a.detail?.params?.count, 1)
  assert.equal(a.counts.shipments, 2)
  assert.equal(a.counts.delivered, 1)
  assert.equal(a.updatedAt, "2026-11-02T10:00:00.000Z")
  const delivery = a.facts.find((f) => f.slot === "delivery")
  assert.equal(delivery?.sub?.params?.number, "99000000000002D")
  assert.deepEqual(delivery?.link, { kind: "admin", href: "/dpd?q=1001" }, "links stay inside the admin")
  assert.equal(a.links[0].href, "/dpd?q=1001")
})

test("a pending shipment waits for a person and says when nobody armed the writer; cash on delivery is a payment fact", async () => {
  const s = sample()
  const [b] = await dpdIntegration.build.summaries(makeContext({ scope: s.container, lang: "en" }), "order", [B])
  assert.equal(b.state, "attention")
  assert.equal(b.title.fallback, "To ship to Pickup point PL14509")
  assert.equal(b.detail?.key, "integration.order.notArmed")
  assert.equal(b.counts.shipments, 2, "the demo row of the order does not count")
  const cod = b.facts.find((f) => f.slot === "payment")
  assert.equal(cod?.value.key, "integration.fact.codAmount")
  assert.match(String(cod?.value.params?.amount), /129[.,]99/)
  arm(s, "shipment")
  const [armed] = await dpdIntegration.build.summaries(makeContext({ scope: s.container }), "order", [B])
  assert.equal(armed.detail?.key, "integration.order.more", "armed: the other shipment is mentioned instead")
})

test("before any fulfillment the checkout's choice shows; metadata changes nothing", async () => {
  const s = sample()
  const [c, d] = await dpdIntegration.build.summaries(makeContext({ scope: s.container }), "order", [C, D])
  assert.equal(c.state, "none")
  assert.equal(c.title.key, "integration.order.chosenPickup")
  assert.equal(c.title.params?.point, "PL14509")
  assert.equal(c.facts.find((f) => f.slot === "payment")?.value.key, "integration.fact.codLater")
  assert.equal(c.facts.find((f) => f.slot === "delivery")?.sub, undefined, "a waybill in metadata is not a fact")
  assert.equal(d.state, "none")
  assert.equal(d.facts.length, 0, "an order without a DPD method says nothing, whatever its metadata")
})

test("several DPD methods (a claim after the checkout): the checkout's choice shows; option-shaped data alone is still DPD's", async () => {
  const E = "order_01INTEGRATION0000000005"
  const F = "order_01INTEGRATION0000000006"
  const claim = { id: "sm_claim", name: "DPD courier", shipping_option_id: "so_courier", data: { id: "dpd-courier", kind: "courier", cod: false } }
  const s = setup(SANDBOX, [
    order({
      id: E,
      display_id: 1005,
      shipping_methods: [claim, { id: "sm_e", name: "DPD Pickup", shipping_option_id: "so_pickup", data: { dpd_option: "dpd-pickup", dpd_kind: "pickup", dpd_cod: false, dpd_pudo_id: "PL14509", dpd_country: "PL" } }],
    }),
    order({ id: F, display_id: 1006, shipping_methods: [{ ...claim, data: { id: "dpd-courier-cod", kind: "courier", cod: true } }] }),
  ])
  const [e, f] = await dpdIntegration.build.summaries(makeContext({ scope: s.container }), "order", [E, F])
  assert.equal(e.title.key, "integration.order.chosenPickup")
  assert.equal(e.title.params?.point, "PL14509")
  assert.equal(f.state, "none")
  assert.equal(f.facts.find((x) => x.slot === "payment")?.value.key, "integration.fact.codLater", "a draft order or a claim with the option's own data")
})

test("board counters are the Panel's counts of the current mode", async () => {
  const s = sample()
  const a = await dpdIntegration.build.attention(makeContext({ scope: s.container }), ["orders"])
  const by = Object.fromEntries(a.items.map((c) => [c.key, c.count]))
  assert.deepEqual(by, { shipments_problems: 1, shipments_to_create: 1, shipments_labeled: 1 })
  assert.ok(a.items.every((c) => c.link.kind === "admin" && c.link.href.startsWith("/dpd?filter=")))
})

test("the manifest: mode, configuration, writers, problems of the sender", async () => {
  const s = sample()
  const m = await dpdIntegration.build.manifest(makeContext({ scope: s.container }))
  assert.equal(m.mode, "sandbox")
  assert.equal(m.configured, true)
  assert.deepEqual(m.writers, { armed: 0, total: 3 })
  assert.deepEqual(m.widgets, [{ id: "dpd.order", zone: "order.details" }])
  const off = setup({})
  const mo = await dpdIntegration.build.manifest(makeContext({ scope: off.container }))
  assert.equal(mo.mode, "off")
  assert.deepEqual(mo.problems.map((p) => p.key), ["integration.problem.not_configured", "integration.problem.sender"])
  const demo = await dpdIntegration.build.manifest(makeContext({ scope: setup({ demo: true }).container }))
  assert.equal(demo.mode, "demo")
  assert.deepEqual(demo.problems.map((p) => p.key), ["integration.problem.demo"])
})

test("one line per state: refusals red, waiting orange, under way blue, delivered green, canceled grey", () => {
  const row = (over: Row) =>
    ({ id: "x", kind: "outbound", mode: "live", option_id: "dpd-pickup", state: "labeled", stage: null, pudo_id: "PL14509", problems: null, handed_over_at: null, ...over }) as never
  const line = (over: Row) => {
    const l = shipmentLine(row(over))
    return `${l.state}:${l.title.key.replace("integration.order.", "")}`
  }
  assert.equal(line({ state: "failed" }), "failed:failed")
  assert.equal(line({ state: "ambiguous" }), "failed:unknown")
  assert.equal(line({ stage: "returned" }), "failed:returned")
  assert.equal(line({ state: "pending", problems: [{ code: "weight_missing" }] }), "attention:planProblems")
  assert.equal(line({ state: "created" }), "attention:toLabel")
  assert.equal(line({ state: "labeled" }), "active:labeled")
  assert.equal(line({ state: "labeled", handed_over_at: new Date() }), "active:handedOver")
  assert.equal(line({ stage: "in_point" }), "active:inPoint")
  assert.equal(line({ stage: "delivered" }), "ok:collected")
  assert.equal(line({ stage: "delivered", option_id: "dpd-courier" }), "ok:delivered")
  assert.equal(line({ state: "canceled" }), "none:canceled")
  assert.equal(line({ kind: "return", option_id: "dpd-return", stage: "in_transit" }), "active:returnOnTheWay")
  assert.equal(line({ kind: "return", option_id: "dpd-return", stage: "delivered" }), "ok:returnDelivered")
})

test("the Polish texts have every English key and full diacritics", () => {
  const keys = (o: object, p = ""): string[] => Object.entries(o).flatMap(([k, v]) => (typeof v === "string" ? [`${p}${k}`] : keys(v as object, `${p}${k}.`)))
  const pl = new Set(keys(integrationPl))
  for (const k of keys(integrationEn)) assert.ok(pl.has(k), k)
  assert.match(JSON.stringify(integrationPl), /[ąćęłńóśźż]/)
})
