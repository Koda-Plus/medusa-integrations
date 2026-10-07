import { test } from "node:test"
import assert from "node:assert/strict"
import { buildDemoRawOffers } from "../src/modules/allegro/lib/demo.ts"
import {
  dayIndex,
  demoCheckoutFormRaw,
  demoEan,
  demoEventsRaw,
  demoFormSeeds,
  demoIssuesRaw,
  demoOffersFromRaw,
  demoSeedsUntil,
  demoThreadsRaw,
  demoWaybill,
} from "../src/modules/allegro/lib/demo-stream.ts"
import { checkoutFormFromApi } from "../src/modules/allegro/lib/checkout.ts"
import { eventsFromApi } from "../src/modules/allegro/lib/events.ts"
import { planImport } from "../src/modules/allegro/lib/import.ts"
import { issuesFromApi, returnsFromApi, unreadThreads } from "../src/modules/allegro/lib/issues.ts"
import { validGtin } from "../src/modules/allegro/lib/publish.ts"

const catalog = Array.from({ length: 14 }, (_, i) => ({
  sku: `KS-T-${String(i).padStart(2, "0")}`,
  productTitle: `Narzędzie ${i}`,
  price: { value: 100 + i * 7, currency: "PLN" },
  available: 20,
}))
const day = new Date("2026-10-06T00:00:00.000Z")
const offers = demoOffersFromRaw(buildDemoRawOffers(catalog, day))

test("demo stream: three to five purchases a day, never more, the same every time", () => {
  for (let d = 0; d < 30; d += 1) {
    const seeds = demoFormSeeds(offers, new Date(day.getTime() + d * 86_400_000))
    assert.ok(seeds.length >= 3 && seeds.length <= 5, `day ${d}: ${seeds.length}`)
  }
  assert.deepEqual(
    demoFormSeeds(offers, day).map((s) => s.id),
    demoFormSeeds(offers, day).map((s) => s.id),
  )
})

test("demo stream: buyers are fictional with example.com addresses only", () => {
  const seeds = Array.from({ length: 10 }, (_, d) => demoFormSeeds(offers, new Date(day.getTime() + d * 86_400_000))).flat()
  for (const s of seeds) {
    const raw = JSON.stringify(demoCheckoutFormRaw(s, new Date(day.getTime() + 20 * 86_400_000)))
    const emails = raw.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g) ?? []
    assert.ok(emails.length > 0)
    for (const e of emails) assert.match(e, /@example\.com$/)
  }
})

test("demo stream: the forms go through the real parser and the real import plan", () => {
  const seeds = demoFormSeeds(offers, day)
  const noon = new Date("2026-10-06T23:00:00.000Z")
  const byOffer = new Map<string, { id: string; productId: string; sku: string; productTitle: string | null }>()
  for (const o of offers) {
    if (o.external && !/-KPL2$|-B$/.test(o.external)) byOffer.set(o.id, { id: `v-${o.external}`, productId: `p-${o.external}`, sku: o.external, productTitle: o.name })
  }
  let created = 0
  for (const s of seeds) {
    const form = checkoutFormFromApi(demoCheckoutFormRaw(s, noon))
    assert.ok(form)
    const d = planImport(form, { regionId: "reg", currency: "pln", salesChannelId: "sc", byOffer, bySku: new Map(), shippingOptionId: null, shippingOptions: {}, demo: true })
    if (d.kind === "create") {
      created += 1
      assert.equal(d.order.metadata.allegro_demo, true)
      assert.match(String(d.email), /@example\.com$/)
    } else {
      assert.ok(["hold", "skip"].includes(d.kind), d.kind)
    }
  }
  assert.ok(created >= 2)
})

test("demo stream: before the payment the form is BOUGHT, after it READY_FOR_PROCESSING, cancelled forms say so", () => {
  const seeds = Array.from({ length: 4 }, (_, d) => demoFormSeeds(offers, new Date(day.getTime() + d * 86_400_000))).flat()
  const s = seeds[0]
  assert.equal(checkoutFormFromApi(demoCheckoutFormRaw(s, new Date(s.boughtAt.getTime() + 60_000)))?.status, "BOUGHT")
  assert.equal(checkoutFormFromApi(demoCheckoutFormRaw(s, new Date(s.readyAt.getTime() + 60_000)))?.status, "READY_FOR_PROCESSING")
  const cancelled = seeds.find((x) => x.cancelAt)
  assert.ok(cancelled, "a cancellation every other day")
  assert.equal(checkoutFormFromApi(demoCheckoutFormRaw(cancelled, new Date((cancelled.cancelAt as Date).getTime() + 1)))?.status, "CANCELLED")
  const cod = seeds.find((x) => x.cod)
  assert.equal(checkoutFormFromApi(demoCheckoutFormRaw(cod as never, new Date(day.getTime() + 5 * 86_400_000)))?.payment.paidAmount, null)
})

test("demo events: ids grow with time across days, only what already happened", () => {
  const days = [day, new Date(day.getTime() + 86_400_000)]
  const now = new Date(day.getTime() + 86_400_000 + 12 * 3_600_000)
  const seeds = demoSeedsUntil(offers, days, now)
  const events = eventsFromApi({ events: demoEventsRaw(seeds, now) })
  assert.ok(events.length >= 6)
  /* Only the simulator reads its own ids: fixed width, so their text order is their time order. */
  for (let i = 1; i < events.length; i += 1) assert.ok(events[i].id > events[i - 1].id)
  assert.ok(events.every((e) => e.occurredAt && Date.parse(e.occurredAt) <= now.getTime()))
  assert.ok(dayIndex(day) > 0)
})

test("demo issues and threads come from the same purchases, with no personal data", () => {
  const days = Array.from({ length: 7 }, (_, i) => new Date(day.getTime() - (6 - i) * 86_400_000))
  const seeds = demoSeedsUntil(offers, days, new Date(day.getTime() + 20 * 3_600_000))
  const raw = demoIssuesRaw(seeds, new Date(day.getTime() + 20 * 3_600_000))
  const returns = returnsFromApi(raw.returns)
  const issues = issuesFromApi(raw.issues)
  assert.equal(returns.length, 2)
  assert.ok(issues.some((i) => i.kind === "dispute" && i.needsReply))
  assert.ok(issues.some((i) => i.kind === "claim" && i.dueAt))
  assert.deepEqual(unreadThreads([demoThreadsRaw(day)]), { unread: 2, scanned: 9 })
  assert.match(demoWaybill("x"), /^\d{24}$/)
  assert.equal(validGtin(demoEan("KS-T-01")), demoEan("KS-T-01"))
})
