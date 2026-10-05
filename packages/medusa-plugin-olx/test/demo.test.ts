import { test } from "node:test"
import assert from "node:assert/strict"
import { advertsFromPartnerApi, compilePatterns } from "../src/modules/olx/lib/adverts.ts"
import { computeAlerts, type AlertVariant } from "../src/modules/olx/lib/alerts.ts"
import { applyLifecycle, applyPrices, publishOnce } from "../src/modules/olx/lib/apply.ts"
import { DEFAULT_SKU_PATTERNS } from "../src/modules/olx/lib/constants.ts"
import {
  DEMO_CATEGORY_ID,
  applyDemoWrites,
  buildDemoRawAdverts,
  demoCandidateMetadata,
  demoCategoryRaw,
  demoPublishDefaults,
  demoScenario,
  demoStatisticsRaw,
  demoThreadsRaw,
} from "../src/modules/olx/lib/demo.ts"
import { createDemoTransport } from "../src/modules/olx/lib/demo-transport.ts"
import { planLifecycle } from "../src/modules/olx/lib/lifecycle.ts"
import { matchAdverts } from "../src/modules/olx/lib/matching.ts"
import { resolveOptions } from "../src/modules/olx/lib/options.ts"
import { planPrices } from "../src/modules/olx/lib/pricing.ts"
import { parseAttributeDefs, parseCategory, planPublication, type PublishCandidate } from "../src/modules/olx/lib/publish.ts"
import { parseStatistics } from "../src/modules/olx/lib/stats.ts"
import { parseThreads, threadTotals } from "../src/modules/olx/lib/threads.ts"
import { reconcilePlan } from "../src/modules/olx/lib/writers.ts"
import { clock, memoryPlanStore, memoryPublicationStore, type Row } from "./helpers.ts"

/** The catalog of the public demo store (medusa.koda.plus), as of October 2026. */
const CATALOG = [
  { sku: "KS-BHP-KSK", title: "Kask ochronny z regulacją", price: 59 },
  { sku: "KS-BHP-RKW", title: "Rękawice robocze powlekane, 12 par", price: 49 },
  { sku: "KS-ELN-125", title: "Szlifierka kątowa 125 mm 900W", price: 299 },
  { sku: "KS-ELN-18V", title: "Wiertarko-wkrętarka 18V 2x2,0Ah", price: 349 },
  { sku: "KS-KLU-NAS", title: "Klucz nastawny 250 mm CrV", price: 189 },
  { sku: "KS-MLT-CIE", title: "Młotek ciesielski 600 g", price: 79 },
  { sku: "KS-TSM-5M", title: "Taśma miernicza 5 m / 19 mm", price: 29 },
  { sku: "KS-WKT-440", title: "Wkręty do drewna 4x40, op. 1000 szt.", price: 39 },
]
const ctx = { market: "pl", host: "www.olx.pl", now: new Date("2026-10-06T00:00:00Z") }
const patterns = compilePatterns(DEFAULT_SKU_PATTERNS)

test("the scenario: who gets an advert, who is kept back, what the simulation changes", () => {
  const s = demoScenario(CATALOG.map((c) => c.sku).reverse())
  assert.deepEqual(s.advertised, ["KS-BHP-KSK", "KS-BHP-RKW", "KS-ELN-125", "KS-ELN-18V", "KS-KLU-NAS"])
  assert.deepEqual(s.candidates, ["KS-MLT-CIE", "KS-TSM-5M", "KS-WKT-440"])
  assert.deepEqual(s.soldOut, ["KS-BHP-RKW", "KS-ELN-125"])
  assert.deepEqual(s.unpublished, ["KS-ELN-18V"])
  assert.deepEqual(s.paused, ["KS-KLU-NAS"])
  assert.deepEqual(s.stalePrice, ["KS-BHP-KSK"])
  assert.equal(s.missingAttribute, "KS-WKT-440")
  assert.deepEqual(demoScenario(["A", "B"]).candidates, [], "small catalogs keep nothing back")
  assert.equal(demoScenario([]).advertised.length, 0)
})

/** The whole demo story through the same planners and apply loops as a real account. */
test("the demo story: alerts, then every writer acting on the simulation", async () => {
  const scenario = demoScenario(CATALOG.map((c) => c.sku))
  const raw = buildDemoRawAdverts(
    CATALOG.map((c) => ({ sku: c.sku, productTitle: c.title, price: { value: c.price, currency: "PLN" } })),
    ctx,
  )
  const parsed = advertsFromPartnerApi(raw, patterns).adverts
  const variants = CATALOG.map((c, i) => ({ id: `variant_${i}`, sku: c.sku, productId: `prod_${i}`, productTitle: c.title }))
  const { matches } = matchAdverts(parsed, variants)
  const snapshot = parsed.map((a) => ({ ...a, variantId: matches.get(a.olxId)?.variant?.id ?? null }))

  /* Medusa side: in stock everywhere, except what the simulation changes. */
  const catalog = new Map<string, AlertVariant & { price: number }>()
  CATALOG.forEach((c, i) => {
    catalog.set(`variant_${i}`, {
      id: `variant_${i}`,
      productId: `prod_${i}`,
      sku: c.sku,
      productTitle: c.title,
      productStatus: scenario.unpublished.includes(c.sku) ? "draft" : "published",
      stock: scenario.soldOut.includes(c.sku) ? { kind: "tracked", available: 0 } : { kind: "tracked", available: 3 },
      price: c.price,
    })
  })

  const alerts = computeAlerts(
    snapshot.map((a) => ({ olxId: a.olxId, title: a.title, url: a.url, status: a.status, variantId: a.variantId })),
    catalog,
  )
  assert.deepEqual(alerts.counts, { live_sold_out: 1, live_unpublished: 1, stock_not_live: 1, stock_not_listed: 3 })

  const pausedAdvert = snapshot.find((a) => a.externalId === null && a.descriptionSku === "KS-KLU-NAS") ?? snapshot.find((a) => matches.get(a.olxId)?.variant?.sku === "KS-KLU-NAS")
  assert.equal(pausedAdvert?.status, "removed_by_user")
  const lifecycle = planLifecycle({
    adverts: snapshot.map((a) => ({ olxId: a.olxId, status: a.status, variantId: a.variantId, title: a.title, url: a.url })),
    variants: catalog,
    pausedByPlugin: new Set([pausedAdvert!.olxId]),
    readComplete: true,
    stockComplete: true,
  })
  assert.deepEqual(
    lifecycle.actions.map((x) => [x.sku, x.command, x.reason]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    [
      ["KS-BHP-RKW", "deactivate", "sold_out"],
      ["KS-ELN-125", "finish", "sold_out"],
      ["KS-ELN-18V", "deactivate", "unpublished"],
      ["KS-KLU-NAS", "activate", "back_in_stock"],
    ],
  )
  assert.deepEqual(
    lifecycle.actions.map((x) => x.command),
    ["deactivate", "deactivate", "finish", "activate"],
    "endings first, the way back last",
  )
  assert.equal(lifecycle.guard.held, false)

  const prices = planPrices({
    adverts: snapshot.map((a) => ({ olxId: a.olxId, status: a.status, variantId: a.variantId, title: a.title, price: a.price })),
    variants: catalog,
    currency: "PLN",
    maxChangePercent: 50,
    readComplete: true,
    catalogComplete: true,
  })
  assert.deepEqual(prices.actions.map((x) => [x.sku, x.from.value, x.to.value]), [["KS-BHP-KSK", 53, 59]])

  /* The writers act on the simulated account through the same apply loops. */
  const transport = createDemoTransport(
    snapshot.map((a) => ({ olxId: a.olxId, status: a.status, price: a.price, externalId: a.externalId, title: a.title, url: a.url })),
    { market: "pl", host: "www.olx.pl", now: clock.now },
  )
  const { creates } = reconcilePlan(
    [],
    lifecycle.actions.map((x) => ({ olxId: x.olxId, action: x.command, reason: x.reason, from: x.fromStatus, to: x.toStatus, held: false, variantId: x.variantId, productId: x.productId, sku: x.sku, title: x.title })),
    { now: clock.now() },
  )
  const rows = new Map<string, Row>(creates.map((c, i) => [`row_${i}`, { id: `row_${i}`, ...c, paused_at: null, demo: true }]))
  const report = await applyLifecycle([...rows.values()] as never, { ...clock, store: memoryPlanStore(rows), transport, isSuccess: false })
  assert.equal(report.succeeded, 4)
  const after = new Map(transport.state().map((a) => [a.olxId, a.status]))
  const bySku = (sku: string) => snapshot.find((a) => a.variantId && catalog.get(a.variantId)?.sku === sku && a.title === catalog.get(a.variantId)?.productTitle)!.olxId
  assert.equal(after.get(bySku("KS-BHP-RKW")), "removed_by_user")
  assert.equal(after.get(bySku("KS-KLU-NAS")), "active")

  const priceRows = new Map<string, Row>([
    ["p1", { id: "p1", olx_id: prices.actions[0].olxId, action: "price", state: "pending", attempts: 0, from_value: prices.actions[0].from, to_value: prices.actions[0].to, variant_id: prices.actions[0].variantId, demo: true }],
  ])
  const priceReport = await applyPrices([...priceRows.values()] as never, { ...clock, store: memoryPlanStore(priceRows), transport })
  assert.equal(priceReport.succeeded, 1)
  assert.deepEqual(transport.state().find((a) => a.olxId === prices.actions[0].olxId)?.price, { value: 59, currency: "PLN" })

  /* Publishing: two ready, the last candidate misses the brand the category requires. */
  const category = demoCategoryRaw("pl")
  const defs = new Map([[DEMO_CATEGORY_ID, { category: parseCategory(category.category), attributes: parseAttributeDefs(category.attributes), error: null }]])
  const d = demoPublishDefaults("pl")
  const options = { ...resolveOptions({ demo: true }).publish, location: d.location, contact: d.contact, attributes: d.attributes }
  const plan = scenario.candidates.map((sku) => {
    const i = CATALOG.findIndex((c) => c.sku === sku)
    const c: PublishCandidate = {
      variantId: `variant_${i}`,
      productId: `prod_${i}`,
      sku,
      productTitle: CATALOG[i].title,
      variantTitle: "Standard",
      multiVariant: false,
      description: `${CATALOG[i].title}. Solidne wykonanie, sprawdzone w warsztacie i na budowie, gotowe do wysyłki jeszcze dziś.`,
      images: ["https://images.example.com/a.jpg"],
      price: CATALOG[i].price,
      categoryIds: [],
      categoryHandles: [],
      productMetadata: demoCandidateMetadata(sku, scenario),
      variantMetadata: null,
    }
    return planPublication(c, { options, currency: "PLN", skuLabel: "Kod produktu", definitions: defs })
  })
  assert.deepEqual(plan.map((p) => [p.sku, p.ready]), [
    ["KS-MLT-CIE", true],
    ["KS-TSM-5M", true],
    ["KS-WKT-440", false],
  ])
  assert.deepEqual(plan[2].missing.map((m) => m.code), ["attribute_missing"])
  assert.match(plan[2].missing[0].detail ?? "", /brand/)

  const pubs = new Map<string, Row>(plan.filter((p) => p.ready).map((p, i) => [`pub_${i}`, { id: `pub_${i}`, variant_id: p.variantId, sku: p.sku, state: "planned", attempts: 0, payload: p.payload, demo: true }]))
  const published = await publishOnce([...pubs.values()] as never, { ...clock, store: memoryPublicationStore(pubs), transport })
  assert.equal(published.succeeded, 2)
  assert.ok([...pubs.values()].every((r) => r.state === "published" && r.olx_status === "new"), "new adverts start in moderation")
  const again = await transport.findByExternalId("KS-MLT-CIE")
  assert.equal(again.length, 1, "exactly one advert per variant")
})

test("demo writes are replayed onto the simulated account by the next read", () => {
  const raw = buildDemoRawAdverts(CATALOG.map((c) => ({ sku: c.sku, productTitle: c.title, price: { value: c.price, currency: "PLN" } })), ctx)
  const target = String(raw[1].id)
  const replayed = applyDemoWrites(
    raw,
    [
      { kind: "lifecycle", olxId: target, command: "deactivate" },
      { kind: "price", olxId: String(raw[0].id), price: { value: 59, currency: "PLN" } },
      { kind: "publish", olxId: "1912345678", title: "Młotek ciesielski 600 g", url: "https://www.olx.pl/oferty/q-mlotek/", externalId: "KS-MLT-CIE", price: { value: 79, currency: "PLN" }, createdAt: ctx.now },
    ],
    ctx,
  )
  assert.equal(replayed.length, raw.length + 1)
  assert.equal(replayed.find((r) => String(r.id) === target)?.status, "removed_by_user")
  assert.deepEqual(replayed[0].price, { value: 59, currency: "PLN" })
  const added = advertsFromPartnerApi(replayed, patterns).adverts.find((a) => a.olxId === "1912345678")
  assert.equal(added?.externalId, "KS-MLT-CIE")
  assert.equal(added?.status, "active", "moderation done by the next read")
  assert.equal(raw[1].status, "active", "the baseline itself is never changed")
})

test("simulated statistics and threads go through the real parsers", () => {
  const now = new Date("2026-10-06T12:00:00Z")
  const young = parseStatistics(demoStatisticsRaw("1511400468", "2026-10-05T00:00:00Z", now))
  const old = parseStatistics(demoStatisticsRaw("1511400468", "2026-09-01T00:00:00Z", now))
  assert.ok(young && old && (old.views ?? 0) > (young.views ?? 0), "views grow with the age of the advert")
  assert.deepEqual(demoStatisticsRaw("1", null, now), demoStatisticsRaw("1", null, now), "deterministic")

  const threads = parseThreads(
    demoThreadsRaw(
      [
        { olxId: "1511400468", status: "active", createdAt: null },
        { olxId: "1280194011", status: "active", createdAt: null },
        { olxId: "1871382414", status: "limited", createdAt: null },
      ],
      now,
    ),
  )
  const totals = threadTotals(threads)
  assert.ok(totals.unreadThreads >= 1 && totals.unreadMessages >= 2, JSON.stringify(totals))
  assert.equal(new Set(threads.map((t) => t.key)).size, threads.length)
  assert.ok(!threads.some((t) => t.advertId === "1871382414"), "no conversations about an invisible advert")
})

test("the demo transport answers like OLX: invalid commands are rejected, nothing is double created", async () => {
  const t = createDemoTransport([{ olxId: "1", status: "removed_by_user", price: null, externalId: "A", title: "Advert number one", url: "https://www.olx.pl/" }], {
    market: "pl",
    host: "www.olx.pl",
    now: clock.now,
  })
  await assert.rejects(() => t.command("1", "deactivate", false), /Ad has to be active/)
  await t.command("1", "activate", false)
  assert.equal((await t.read("1"))?.status, "active")
  await assert.rejects(() => t.command("missing", "activate", false), /404/)
  await assert.rejects(() => t.create({ title: "Short", external_id: "B" }), /too short/)
  const created = await t.create({ title: "Młotek ciesielski 600 g", external_id: "B", price: { value: 79, currency: "PLN" } })
  assert.equal(created.status, "new")
  assert.deepEqual((await t.findByExternalId("b")).map((a) => a.olxId), [created.olxId])
})
