/**
 * Fakturownia in the koda.integration/1 contract: the shared conformance
 * checks on sample rows, then what Fakturownia itself promises: the worst
 * document of an order speaks (red, orange, blue, green), the document and
 * buyer facts come from the plugin's rows, an order whose trigger is met
 * without a document is "to issue", a customer's line is the worst of their
 * orders, the counters are the lengths of the lists they link to, and
 * nothing is read from order metadata.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { fakturowniaIntegration } from "../src/workflows/fakturownia/integration.ts"
import { makeContext } from "../src/modules/fakturownia/lib/kit-routes.ts"
import { writerSettingKey } from "../src/modules/fakturownia/lib/writers.ts"
import { addDays, warsawDate } from "../src/modules/fakturownia/lib/dates.ts"
import { GET as documentsRoute } from "../src/api/admin/fakturownia/documents/route.ts"
import { conformance } from "./kit-conformance.ts"
import { LIVE, order, setup, unpaid, type Row, type Setup } from "./helpers.ts"

const A = "order_01INTEGRATION0000000000A"
const B = "order_01INTEGRATION0000000000B"
const C = "order_01INTEGRATION0000000000C"
const D = "order_01INTEGRATION0000000000D"
const E = "order_01INTEGRATION0000000000E"
const F = "order_01INTEGRATION0000000000F"
const G = "order_01INTEGRATION0000000000G"
const H = "order_01INTEGRATION0000000000H"

const today = warsawDate(new Date())
const daysAgo = (n: number) => addDays(today, -n)

function sample(options = LIVE): Setup {
  const s = setup(options, [
    order({ id: A, display_id: 1001, customer_id: "cus_1" }),
    order({ id: B, display_id: 1002, customer_id: "cus_1" }),
    unpaid({ id: C, display_id: 1003 }),
    order({ id: D, display_id: 1004, customer_id: "cus_2" }),
    unpaid({ id: E, display_id: 1005 }),
    /* A shopper's metadata (the Store API takes any): it must change nothing. */
    unpaid({ id: F, display_id: 1006, metadata: { fakturownia_document: { number: "FV 99/10/2026", status: "issued" }, fakturownia_status: "issued", nip: "1234563218" } }),
    order({ id: G, display_id: 1007 }),
    order({ id: H, display_id: 1008 }),
  ])
  const base = { demo: Boolean(options.demo), deleted_at: null, paid: false, gov_status: null, gov_id: null, error_code: null, email_status: null, buyer_warning: null, converted_at: null, cancel_requested_at: null, from_fakturownia_id: null }
  const at = (minutes: number) => new Date(Date.now() - minutes * 60_000)
  const rows: Row[] = [
    { id: "fkdoc_a", order_id: A, display_id: 1001, kind: "vat", status: "issued", number: "FV 1/10/2026", fakturownia_id: "11", paid: true, gov_status: "ok", gov_id: "1234563218-20261007-0123456789AB", buyer_type: "company", issue_date: today, issued_at: at(30) },
    { id: "fkdoc_b", order_id: B, display_id: 1002, kind: "vat", status: "issued", number: "FV 2/10/2026", fakturownia_id: "12", gov_status: "send_error", email_status: "failed", buyer_type: "person", buyer_warning: { code: "invalid_nip", reason: "checksum", source: "order.metadata.nip" }, issue_date: today, issued_at: at(20) },
    { id: "fkdoc_c1", order_id: C, display_id: 1003, kind: "proforma", status: "issued", number: "PRO 1/09/2026", fakturownia_id: "13", gov_status: "not_applicable", buyer_type: "person", issue_date: daysAgo(20), issued_at: at(20 * 24 * 60) },
    { id: "fkdoc_c2", order_id: C, display_id: 1003, kind: "vat", status: "pending", number: null, fakturownia_id: null, next_attempt_at: at(-60) },
    { id: "fkdoc_g", order_id: G, display_id: 1007, kind: "vat", status: "unknown", number: null, fakturownia_id: null, error_code: "unknown_result" },
    { id: "fkdoc_h1", order_id: H, display_id: 1008, kind: "vat", status: "issued", number: "FV 3/10/2026", fakturownia_id: "14", paid: true, gov_status: "ok", gov_id: null, buyer_type: "person", issue_date: today, issued_at: at(10) },
    { id: "fkdoc_h2", order_id: H, display_id: 1008, kind: "correction", status: "pending", number: null, fakturownia_id: null, error_code: "waiting_for_writer", corrects_document_id: "fkdoc_h1" },
  ]
  for (const [i, r] of rows.entries()) s.documents.rows.push({ ...base, created_at: new Date(Date.now() - (100 - i) * 1000), updated_at: new Date(), ...r })
  s.plans.rows.push({ id: "fkcor_b", order_id: B, display_id: 1002, document_id: "fkdoc_b", demo: Boolean(options.demo), status: "draft", revision: 1, deleted_at: null, created_at: new Date() })
  s.plans.rows.push({ id: "fkcor_h", order_id: H, display_id: 1008, document_id: "fkdoc_h1", demo: Boolean(options.demo), status: "approved", revision: 1, correction_document_id: "fkdoc_h2", deleted_at: null, created_at: new Date() })
  return s
}

function recordWrites(s: Setup) {
  const calls: string[] = []
  for (const [name, target] of [
    ["store", s.store],
    ["planStore", s.planStore],
  ] as const) {
    const t = target as unknown as Record<string, unknown>
    for (const k of Object.keys(t)) {
      const fn = t[k]
      if (typeof fn !== "function") continue
      t[k] = (...args: unknown[]) => {
        calls.push(`${name}.${k}`)
        return (fn as (...a: unknown[]) => unknown)(...args)
      }
    }
  }
  const svc = s.container.resolve("fakturownia") as Record<string, unknown>
  for (const k of Object.keys(svc)) {
    const fn = svc[k]
    if (typeof fn !== "function" || !/^(create|update|delete|softDelete|restore|upsert)/.test(k)) continue
    svc[k] = (...args: unknown[]) => {
      calls.push(`service.${k}`)
      return (fn as (...a: unknown[]) => unknown)(...args)
    }
  }
  const bus = s.container.resolve("event_bus")
  const emit = bus.emit
  bus.emit = (...args: unknown[]) => {
    calls.push("event_bus.emit")
    return emit(...args)
  }
  return () => calls
}

{
  const s = sample()
  conformance({ routes: fakturowniaIntegration, scope: s.container, entity: "order", knownIds: [A, B, C, D, E, F, G, H], writes: recordWrites(s) })
}

const summaries = async (s: Setup, ids: string[], lang: "en" | "pl" = "en", entity: "order" | "customer" = "order") =>
  fakturowniaIntegration.build.summaries(makeContext({ scope: s.container, lang }), entity, ids)

test("an issued, accepted invoice is green, with the document and buyer facts from the row", async () => {
  const s = sample()
  const [a] = await summaries(s, [A])
  assert.deepEqual([a.state, a.tone, a.title.fallback], ["ok", "green", "VAT invoice FV 1/10/2026"])
  assert.equal(a.widget, "fakturownia.order")
  assert.deepEqual(a.links[0], { kind: "admin", href: "/fakturownia?q=1001" })
  const doc = a.facts.find((f) => f.slot === "document")!
  assert.deepEqual([doc.priority, doc.value.fallback, doc.sub?.fallback, doc.tone, doc.link?.href], [80, "VAT invoice FV 1/10/2026", "KSeF 1234563218-20261007-0123456789AB", "green", "/fakturownia?doc=fkdoc_a"])
  const buyer = a.facts.find((f) => f.slot === "buyer")!
  assert.deepEqual([buyer.priority, buyer.value.fallback], [60, "Company, NIP on the invoice"])
  const [pl] = await summaries(s, [A], "pl")
  assert.equal(pl.title.fallback, "Faktura VAT FV 1/10/2026")
  assert.equal(pl.facts.find((f) => f.slot === "buyer")?.value.fallback, "Firma, NIP na fakturze")
})

test("the worst signal speaks: a KSeF rejection over a plan to approve and a failed e-mail, with how many more", async () => {
  const s = sample()
  const [b] = await summaries(s, [B])
  assert.deepEqual([b.state, b.tone, b.title.key], ["failed", "red", "integration.order.ksefRejected"])
  assert.equal(b.detail?.key, "integration.order.more")
  assert.equal(b.detail?.params?.count, 3, "a plan to approve, a failed e-mail, a NIP to check")
  const doc = b.facts.find((f) => f.slot === "document")!
  assert.deepEqual([doc.tone, doc.sub?.key], ["red", "integration.fact.ksefRejected"])
  assert.equal(b.facts.find((f) => f.slot === "buyer")?.value.key, "integration.fact.buyerInvalidNip")
})

test("orange, blue, red: an unpaid proforma past the reminder age, a document being issued, a lost answer", async () => {
  const s = sample()
  const [c, g] = await summaries(s, [C, G])
  assert.deepEqual([c.state, c.title.key], ["attention", "integration.order.unpaidOverdue"])
  assert.match(String(c.title.params?.date), /\d/)
  assert.deepEqual([g.state, g.title.key], ["failed", "integration.order.unknown"])
  assert.equal(g.facts.find((f) => f.slot === "document")?.value.key, "integration.fact.documentUnknown")
})

test("an order whose trigger is met without a document is to issue; one waiting for the payment is not", async () => {
  const s = sample()
  const [d, e] = await summaries(s, [D, E])
  assert.deepEqual([d.state, d.title.key], ["attention", "integration.order.toIssue"])
  const fact = d.facts.find((f) => f.slot === "document")!
  assert.deepEqual([fact.value.key, fact.tone, fact.link?.href], ["integration.fact.documentToIssue", "orange", "/fakturownia?q=1004"])
  assert.deepEqual([e.state, e.title.key, e.facts.length], ["none", "integration.order.waitingPayment", 0])
  const placed = sample({ ...LIVE, trigger: "order_placed" })
  const [e2] = await summaries(placed, [E])
  assert.equal(e2.title.key, "integration.order.toIssue", "with trigger order_placed an unpaid order is due")
})

test("order metadata changes nothing: no document, no number, no buyer from what a shopper typed", async () => {
  const s = sample()
  const [e, f] = await summaries(s, [E, F])
  assert.deepEqual({ state: f.state, title: f.title.key, facts: f.facts, counts: f.counts }, { state: e.state, title: e.title.key, facts: e.facts, counts: e.counts })
  assert.ok(!JSON.stringify(f).includes("FV 99/10/2026"))
})

test("an approved correction waits for a person while the writer is off, and is under way once it is on", async () => {
  const s = sample()
  const [h] = await summaries(s, [H])
  assert.deepEqual([h.state, h.title.key], ["attention", "integration.order.correctionWaitsWriter"])
  assert.equal(h.counts.documents, 1)
  await s.planStore.setSetting(writerSettingKey("corrections", false), { on: true }, "user_1")
  const [armed] = await summaries(s, [H])
  assert.deepEqual([armed.state, armed.title.key], ["active", "integration.order.issuing"])
})

test("a customer: the worst of their orders speaks; the last document and its buyer are the facts", async () => {
  const s = sample()
  const [one, two, nobody] = await summaries(s, ["cus_1", "cus_2", "cus_none"], "en", "customer")
  assert.deepEqual([one.state, one.title.fallback], ["failed", "1 order with a document problem"])
  assert.deepEqual(one.counts, { orders: 2, documents: 2, unpaid: 1 })
  assert.equal(one.facts.find((f) => f.slot === "document")?.value.fallback, "Last: VAT invoice FV 2/10/2026")
  assert.deepEqual(one.links[0], { kind: "admin", href: "/fakturownia?customer=cus_1" })
  assert.equal(one.widget, null)
  assert.deepEqual([two.state, two.title.fallback], ["attention", "1 order waits for a person"])
  assert.equal(nobody.state, "none")
  const [pl] = await summaries(s, ["cus_1"], "pl", "customer")
  assert.equal(pl.title.fallback, "1 zamówienie z problemem dokumentu")
})

test("the counters are the lengths of the lists their links open", async () => {
  const s = sample()
  const a = await fakturowniaIntegration.build.attention(makeContext({ scope: s.container }), ["orders"])
  const by = Object.fromEntries(a.items.map((c) => [c.key, c]))
  assert.deepEqual(Object.keys(by).sort(), ["corrections_to_approve", "documents_attention", "ksef_problems", "to_issue"])
  assert.deepEqual([by.documents_attention.tone, by.ksef_problems.tone, by.corrections_to_approve.tone, by.to_issue.tone], ["red", "red", "orange", "orange"])
  assert.equal(by.corrections_to_approve.count, 1)
  assert.equal(by.corrections_to_approve.link.href, "/fakturownia?plans=open")
  assert.deepEqual(by.corrections_to_approve.ids, [B])
  for (const key of ["documents_attention", "ksef_problems", "to_issue"]) {
    const counter = by[key]
    const filter = new URL(`https://x${counter.link.href}`).searchParams.get("filter")!
    const res: Row = { status: () => res, json: (body: Row) => (res.body = body), setHeader: () => undefined }
    await documentsRoute({ scope: s.container, query: { filter, limit: "100" }, params: {} } as never, res as never)
    assert.equal(counter.count, res.body.count, `${key} counts its list (${filter})`)
    assert.ok(counter.count > 0, key)
  }
})

test("not configured and demo: the manifest says so, the lines too", async () => {
  const off = sample({ account: "mojafirma" })
  const m = await fakturowniaIntegration.build.manifest(makeContext({ scope: off.container }))
  assert.deepEqual([m.mode, m.configured, m.problems[0]?.key], ["off", false, "integration.problem.not_configured"])
  assert.deepEqual(m.widgets, [{ id: "fakturownia.order", zone: "order.details" }])
  assert.deepEqual(m.entities, ["order", "customer"])
  const [e] = await summaries(off, [E])
  assert.deepEqual([e.state, e.title.key], ["off", "integration.order.notConfigured"])

  const demo = sample({ demo: true })
  const dm = await fakturowniaIntegration.build.manifest(makeContext({ scope: demo.container }))
  assert.deepEqual([dm.mode, dm.problems[0]?.key], ["demo", "integration.problem.demo"])
  const [a] = await summaries(demo, [A])
  assert.equal(a.detail?.key, "integration.order.demo")
  const live = await fakturowniaIntegration.build.manifest(makeContext({ scope: sample().container }))
  assert.deepEqual([live.mode, live.configured, live.writers], ["live", true, { armed: 0, total: 3 }])
})
