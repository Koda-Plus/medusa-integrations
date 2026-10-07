/**
 * Allegro in the koda.integration/1 contract: the shared conformance checks on
 * sample rows (orders, products and variants), then what Allegro itself
 * promises: only orders this plugin imported have a line, and ownership is the
 * import row, never metadata; the row speaks (a total that differs or a
 * change after the import red, held orange, imported green); the facts carry
 * the channel and payment codes; offers with a stock problem make a product
 * orange; links open the plugin page with a filter it reads, or the offer on
 * allegro.pl.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { allegroIntegration } from "../src/workflows/allegro/integration.ts"
import { makeContext } from "../src/modules/allegro/lib/kit-routes.ts"
import { resolveOptions, type AllegroPluginOptions } from "../src/modules/allegro/lib/options.ts"
import { deepLinkOf } from "../src/admin/lib/allegro-links.ts"
import { conformance } from "./kit-conformance.ts"

type Row = Record<string, any>

const LIVE: AllegroPluginOptions = { clientId: "client-test", clientSecret: "secret-for-tests-only", encryptionKey: Buffer.alloc(32, 3).toString("base64") }

function time(v: unknown): number {
  return v instanceof Date ? v.getTime() : new Date(v as string).getTime()
}

function matches(row: Row, filter: Record<string, unknown>): boolean {
  for (const [key, cond] of Object.entries(filter ?? {})) {
    if (key === "$or") {
      if (!(cond as Array<Record<string, unknown>>).some((f) => matches(row, f))) return false
      continue
    }
    const v = row[key]
    if (Array.isArray(cond)) {
      if (!cond.includes(v)) return false
    } else if (cond === null) {
      if (v !== null && v !== undefined) return false
    } else if (cond && typeof cond === "object" && !(cond instanceof Date)) {
      const c = cond as Record<string, unknown>
      if ("$ne" in c && (c.$ne === null ? v === null || v === undefined : v === c.$ne)) return false
      if ("$in" in c && !(c.$in as unknown[]).includes(v)) return false
      if ("$lte" in c && !(v !== null && v !== undefined && time(v) <= time(c.$lte))) return false
    } else if (v !== cond) return false
  }
  return true
}

function setup(options: AllegroPluginOptions) {
  const o = resolveOptions(options)
  const tables: Record<string, Row[]> = { imports: [], offers: [], issues: [], runs: [], writers: [], connections: [] }
  const writes: string[] = []
  const list = (t: string) => async (filter: Record<string, unknown> = {}, cfg: { take?: number | null } = {}) => {
    const rows = tables[t].filter((r) => matches(r, filter))
    return cfg.take ? rows.slice(0, cfg.take) : rows
  }
  const listAndCount = (t: string) => async (filter: Record<string, unknown> = {}, cfg: { take?: number | null } = {}) => {
    const rows = tables[t].filter((r) => matches(r, filter))
    return [cfg.take ? rows.slice(0, cfg.take) : rows, rows.length]
  }
  const write = (name: string) => async () => {
    writes.push(name)
    return []
  }
  const svc: Record<string, unknown> = {
    getOptions: () => o,
    isDemo: () => o.demo,
    isConfigured: () => true,
    missingOptions: () => [],
    mask: (s: string) => s,
    getLogger: () => ({ info() {}, warn() {}, error() {} }),
    listAllegroOrderImports: list("imports"),
    listAndCountAllegroOrderImports: listAndCount("imports"),
    listAllegroOffers: list("offers"),
    listAndCountAllegroOffers: listAndCount("offers"),
    listAllegroIssues: list("issues"),
    listAndCountAllegroIssues: listAndCount("issues"),
    listAllegroSyncRuns: list("runs"),
    listAllegroWriters: list("writers"),
    listAllegroConnections: list("connections"),
  }
  for (const entity of ["AllegroOrderImports", "AllegroOffers", "AllegroIssues", "AllegroSyncRuns", "AllegroWriters", "AllegroConnections", "AllegroStates", "AllegroOutboxes", "AllegroPlanItems"]) {
    for (const verb of ["create", "update", "delete", "softDelete", "upsert"]) svc[`${verb}${entity}`] = write(`${verb}${entity}`)
  }
  const bus = { emit: async () => void writes.push("event_bus.emit") }
  const container = {
    resolve(key: string) {
      if (key === "allegro") return svc
      if (key === "event_bus") return bus
      throw new Error(`no ${key} in this container`)
    },
  }
  return { o, tables, writes, container }
}

const A = "order_01ALLEGRO00000000000001"
const B = "order_01ALLEGRO00000000000002"
const C = "order_01ALLEGRO00000000000003"
const D = "order_01ALLEGRO00000000000004"
const E = "order_01ALLEGRO00000000000005"
const P1 = "prod_01ALLEGRO000000000000001"
const P2 = "prod_01ALLEGRO000000000000002"
const P3 = "prod_01ALLEGRO000000000000003"
const V1 = "variant_01ALLEGRO000000000001"

function imp(over: Row): Row {
  return {
    id: `algimp_${over.order_id ?? over.checkout_form_id}`,
    checkout_form_id: `form-${over.order_id ?? "x"}`,
    status: "imported",
    source: "events",
    reason_code: null,
    reason: null,
    order_id: null,
    display_id: 1,
    allegro_status: "READY_FOR_PROCESSING",
    fulfillment_status: "NEW",
    payment_type: "ONLINE",
    paid: true,
    total: { value: 129.99, currency: "PLN" },
    medusa_total: { value: 129.99, currency: "PLN" },
    total_mismatch: false,
    line_count: 2,
    attention: null,
    details: { buyer_login: "kupujacy_1", delivery_method: "Allegro Paczkomaty InPost", pickup_point_id: "WAW22A", pickup_point_name: "WAW22A" },
    demo: false,
    updated_at: "2026-10-07T10:00:00Z",
    ...over,
  }
}

function offer(over: Row): Row {
  return {
    id: `algof_${over.allegro_id}`,
    allegro_id: "7700000001",
    name: "Kubek",
    status: "ACTIVE",
    match_key: "KUBEK-1",
    variant_id: V1,
    product_id: P1,
    sku: "KUBEK-1",
    product_title: "Kubek",
    is_primary: true,
    price: { value: 49.99, currency: "PLN" },
    available: 5,
    stock_state: "ok",
    demo: false,
    updated_at: "2026-10-07T09:00:00Z",
    ...over,
  }
}

function sample(options: AllegroPluginOptions = LIVE) {
  const s = setup(options)
  s.tables.imports.push(
    imp({ order_id: A }),
    imp({ order_id: B, status: "held", reason_code: "workflow_error", reason: "Medusa refused the order" }),
    imp({ order_id: C, payment_type: "CASH_ON_DELIVERY", paid: false, total_mismatch: true, medusa_total: { value: 139.99, currency: "PLN" } }),
    imp({ order_id: D, attention: "Cancelled on Allegro after the order was fulfilled in Medusa." }),
    /* 0.2 wrote another integration's order into order_id: never ours. */
    imp({ order_id: E, status: "skipped", reason_code: "duplicate_ref", checkout_form_id: "form-dup" }),
    imp({ checkout_form_id: "form-held-no-order", status: "held", order_id: null }),
  )
  s.tables.offers.push(
    offer({ allegro_id: "7700000001" }),
    offer({ allegro_id: "7700000002", status: "ENDED", is_primary: false, stock_state: null }),
    offer({ allegro_id: "7700000003", product_id: P2, variant_id: "variant_p2", sku: "LAMP-2", stock_state: "oversell", available: 9 }),
    offer({ allegro_id: "7700000004", product_id: P3, variant_id: "variant_p3", sku: "OLD-3", status: "ENDED", stock_state: "ended_in_stock" }),
  )
  s.tables.issues.push({ id: "algiss_1", is_open: true, demo: false }, { id: "algiss_2", is_open: true, demo: false }, { id: "algiss_3", is_open: false, demo: false })
  return s
}

{
  const s = sample()
  conformance({ routes: allegroIntegration, scope: s.container, entity: "order", knownIds: [A, B, C, D, E], writes: () => s.writes })
}
{
  const s = sample()
  conformance({ routes: allegroIntegration, scope: s.container, entity: "product", knownIds: [P1, P2, P3], writes: () => s.writes })
}

test("orders: the import row speaks, red over orange over green; another integration's order has no line", async () => {
  const s = sample()
  const [a, b, c, d, e] = await allegroIntegration.build.summaries(makeContext({ scope: s.container, lang: "en" }), "order", [A, B, C, D, E])
  assert.equal(a.state, "ok")
  assert.equal(a.title.key, "integration.order.imported")
  assert.equal(b.state, "attention")
  assert.equal(b.title.key, "integration.order.held")
  assert.equal(c.state, "failed")
  assert.equal(c.title.key, "integration.order.mismatch")
  assert.match(c.detail?.fallback ?? "", /129[.,]99.*139[.,]99/)
  assert.equal(d.state, "failed")
  assert.equal(d.title.key, "integration.order.attention")
  assert.equal(e.state, "none")
  assert.equal(e.facts.length, 0)
  assert.equal(a.widget, "allegro.order")
  assert.equal(a.links[0].href, `/allegro?filter=imported&q=form-${A}`)
  assert.equal(c.links[0].href, `/allegro?filter=attention&q=form-${C}`)
})

test("orders: channel, payment, delivery and buyer facts from the import row, with codes and priorities", async () => {
  const s = sample()
  const [a, c] = await allegroIntegration.build.summaries(makeContext({ scope: s.container, lang: "pl" }), "order", [A, C])
  const slot = (x: typeof a, name: string) => x.facts.find((f) => f.slot === name)
  assert.deepEqual([slot(a, "channel")?.code, slot(a, "channel")?.priority, slot(a, "channel")?.value.fallback, slot(a, "channel")?.sub?.fallback], ["allegro", 80, "Allegro", "kupujacy_1"])
  assert.deepEqual([slot(a, "payment")?.code, slot(a, "payment")?.priority], ["paid", 70])
  assert.deepEqual([slot(c, "payment")?.code, slot(c, "payment")?.value.key], ["cod", "integration.fact.cod"])
  assert.equal(slot(a, "delivery")?.priority, 60)
  assert.equal(slot(a, "delivery")?.value.fallback, "Allegro Paczkomaty InPost")
  assert.match(slot(a, "delivery")?.sub?.fallback ?? "", /WAW22A/)
  assert.deepEqual([slot(a, "buyer")?.priority, slot(a, "buyer")?.value.fallback], [60, "kupujacy_1"])
})

test("orders: metadata changes nothing, ownership is the import table only", async () => {
  const s = sample()
  /* The summary never reads the order, so a shopper's allegro_* metadata cannot make one. */
  const [x] = await allegroIntegration.build.summaries(makeContext({ scope: s.container }), "order", ["order_01SHOPPERWITHMETADATA0001"])
  assert.equal(x.state, "none")
  assert.equal(x.facts.length, 0)
})

test("products and variants: a stock problem is orange, live offers green, ended grey; the listing links the offer on allegro.pl", async () => {
  const s = sample()
  const [p1, p2, p3] = await allegroIntegration.build.summaries(makeContext({ scope: s.container, lang: "en" }), "product", [P1, P2, P3])
  assert.equal(p1.state, "ok")
  assert.equal(p1.title.fallback, "Live on Allegro")
  assert.equal(p1.counts.offers, 2)
  const listing = p1.facts.find((f) => f.slot === "listing")
  assert.equal(listing?.link?.href, "https://allegro.pl/oferta/7700000001")
  assert.equal(p2.state, "attention")
  assert.equal(p2.title.key, "integration.product.oversell")
  assert.equal(p2.links[0].href, "/allegro?filter=stock&q=7700000003")
  assert.equal(p3.state, "none")
  assert.equal(p3.detail?.key, "integration.product.endedInStock")
  const [v] = await allegroIntegration.build.summaries(makeContext({ scope: s.container }), "variant", [V1])
  assert.equal(v.state, "ok")
  assert.equal(v.widget, "allegro.product")
})

test("products: sandbox links the sandbox host, demo offers link the plugin page", async () => {
  const sandbox = sample({ ...LIVE, environment: "sandbox" })
  const [p] = await allegroIntegration.build.summaries(makeContext({ scope: sandbox.container }), "product", [P1])
  assert.equal(p.facts[0].link?.href, "https://allegro.pl.allegrosandbox.pl/oferta/7700000001")
  const demo = setup({ demo: true })
  demo.tables.offers.push(offer({ demo: true }))
  const [d] = await allegroIntegration.build.summaries(makeContext({ scope: demo.container }), "product", [P1])
  assert.equal(d.facts[0].link?.kind, "admin")
  const m = await allegroIntegration.build.manifest(makeContext({ scope: demo.container }))
  assert.equal(m.mode, "demo")
  assert.deepEqual(allegroIntegration.definition.externalHosts, ["allegro.pl", "allegro.pl.allegrosandbox.pl"])
  assert.deepEqual(m.widgets, [
    { id: "allegro.order", zone: "order.details" },
    { id: "allegro.product", zone: "product.details" },
  ])
})

test("counters: held orange, attention red, stock problems and open issues orange, each opening a list the page reads", async () => {
  const s = sample()
  const a = await allegroIntegration.build.attention(makeContext({ scope: s.container }), ["orders", "products"])
  const by = Object.fromEntries(a.items.map((c) => [c.key, c]))
  assert.deepEqual([by.imports_held.count, by.imports_held.tone], [2, "orange"])
  assert.deepEqual([by.imports_attention.count, by.imports_attention.tone], [2, "red"])
  assert.deepEqual([by.offers_stock_problem.count, by.offers_stock_problem.tone, by.offers_stock_problem.scope], [1, "orange", "products"])
  assert.deepEqual([by.issues_open.count, by.issues_open.tone], [2, "orange"])
  for (const c of a.items) {
    const url = new URL(c.link.href, "https://admin.example.com")
    assert.equal(url.pathname, "/allegro")
    const link = deepLinkOf(url.searchParams)
    assert.ok(link, `${c.key} opens a list`)
  }
  assert.deepEqual(deepLinkOf(new URL(by.imports_held.link.href, "https://x.example.com").searchParams), { list: "imports", filter: "held", q: "" })
  assert.deepEqual(deepLinkOf(new URL(by.imports_attention.link.href, "https://x.example.com").searchParams), { list: "imports", filter: "attention", q: "" })
  assert.deepEqual(deepLinkOf(new URL(by.offers_stock_problem.link.href, "https://x.example.com").searchParams), { list: "offers", filter: "stock", q: "" })
  assert.deepEqual(deepLinkOf(new URL(by.issues_open.link.href, "https://x.example.com").searchParams), { list: "issues", filter: "open", q: "" })
})

test("deep links: filters, searches and the explicit list", () => {
  const read = (q: string) => deepLinkOf(new URLSearchParams(q))
  assert.equal(read(""), null)
  assert.deepEqual(read("filter=all&q=KUBEK-1"), { list: "offers", filter: "all", q: "KUBEK-1" })
  assert.deepEqual(read("filter=imported&q=form-1"), { list: "imports", filter: "imported", q: "form-1" })
  assert.deepEqual(read("list=orders&filter=held"), { list: "orders", filter: "held", q: "" })
  assert.deepEqual(read("filter=needs_reply"), { list: "issues", filter: "needs_reply", q: "" })
  assert.deepEqual(read("filter=nonsense&q=abc"), { list: "offers", filter: "all", q: "abc" })
})
