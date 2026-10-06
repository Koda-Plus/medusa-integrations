import { test } from "node:test"
import assert from "node:assert/strict"
import { resolveOptions, wantsWriteScope } from "../src/modules/olx/lib/options.ts"
import { normalizeReferences, normalizeReview, pickText } from "../src/modules/olx/lib/references.ts"

test("writers: off by default in live mode, on in demo mode, explicit false always wins", () => {
  const live = resolveOptions({ clientId: "x" })
  assert.deepEqual(live.writers, { lifecycle: false, price: false, publish: false })
  assert.equal(wantsWriteScope(live), false)

  const armedLive = resolveOptions({ lifecycleWriter: true })
  assert.deepEqual(armedLive.writers, { lifecycle: true, price: false, publish: false })
  assert.equal(wantsWriteScope(armedLive), true)

  const demo = resolveOptions({ demo: true })
  assert.deepEqual(demo.writers, { lifecycle: true, price: true, publish: true })

  const demoOff = resolveOptions({ demo: true, priceWriter: false })
  assert.equal(demoOff.writers.price, false)
  assert.equal(demoOff.writers.lifecycle, true)

  /* Anything but a real boolean true is not an opt-in. */
  assert.equal(resolveOptions({ publishWriter: "true" as unknown as boolean }).writers.publish, false)
})

test("caps, limits and toggles fall back to defaults instead of throwing", () => {
  const o = resolveOptions({ maxLifecycleActionsPerRun: -5, maxPriceUpdatesPerRun: "abc" as unknown as number, maxPublishPerRun: 3, statsPerRun: 0 })
  assert.equal(o.caps.lifecycle, 1)
  assert.equal(o.caps.price, 20)
  assert.equal(o.caps.publish, 3)
  assert.equal(o.statsPerRun, 1)
  assert.equal(resolveOptions({}).caps.publish, 5)
  assert.equal(resolveOptions({}).statsEnabled, true)
  assert.equal(resolveOptions({ messagesEnabled: false }).messagesEnabled, false)
  assert.equal(resolveOptions({}).deactivateAsSold, false)
  assert.equal(resolveOptions({}).maxPriceChangePercent, 50)
  assert.equal(resolveOptions({}).salesChannelId, null)
  assert.equal(resolveOptions(null).market, "pl")
})

test("publish options: broken mappings are dropped, location and contact need their key field", () => {
  const o = resolveOptions({
    publish: {
      categories: [
        { medusaCategory: "pcat_tools", olxCategoryId: 1559, attributes: { state: "new", tags: ["a", "b"], bad: { x: 1 } as unknown as string } },
        { medusaCategory: "", olxCategoryId: 10 },
        { medusaCategory: "wheels", olxCategoryId: -3 },
      ],
      location: { cityId: 0 },
      contact: { phone: "123" },
      advertiserType: "private",
    },
  })
  assert.equal(o.publish.categories.length, 1)
  assert.deepEqual(o.publish.categories[0], { medusaCategory: "pcat_tools", olxCategoryId: 1559, attributes: { state: "new", tags: ["a", "b"] } })
  assert.equal(o.publish.location, null)
  assert.equal(o.publish.contact, null)
  assert.equal(o.publish.advertiserType, "private")

  const ok = resolveOptions({ publish: { location: { cityId: 5659, latitude: 54.36 }, contact: { name: " Sklep ", phone: " " } } })
  assert.deepEqual(ok.publish.location, { cityId: 5659, districtId: null, latitude: 54.36, longitude: null })
  assert.deepEqual(ok.publish.contact, { name: "Sklep", phone: null })
  assert.equal(ok.publish.advertiserType, "business")
})

test("references: entries without a name or an https URL are dropped, parts are cleaned, nothing throws", () => {
  const refs = normalizeReferences([
    {
      name: "Opony Koła",
      url: "https://www.oponykola.pl",
      description: { en: "Tyres and wheels", pl: "Opony i felgi" },
      metrics: [{ label: { en: "adverts", pl: "ogłoszeń" }, value: "1 900" }, { label: "broken" }],
      links: [{ label: "Product", url: "https://www.oponykola.pl/p/1" }, { label: "Insecure", url: "http://x.pl" }],
    },
    { name: "No URL" },
    { name: "Plain http", url: "http://shop.pl" },
    { name: "", url: "https://shop.pl" },
    { name: "Duplicate", url: "https://www.oponykola.pl" },
    "not an object",
    { name: "Same text", url: "https://shop.example.com", description: "Same in both" },
  ])
  assert.equal(refs.length, 2)
  assert.equal(refs[0].soon, false)
  assert.equal(refs[0].metrics.length, 1)
  assert.equal(refs[0].links.length, 1)
  assert.deepEqual(refs[1].description, { en: "Same in both", pl: "Same in both" })
  assert.deepEqual(normalizeReferences("nope"), [])
  assert.deepEqual(normalizeReferences(undefined), [])
  assert.equal(resolveOptions({ references: [{ name: "A", url: "https://a.pl" }] }).references.length, 1)
})

test("references: a review needs a positive rating and a source, never exceeds its scale, links only over https", () => {
  const review = normalizeReview({ rating: "4,8", source: "Clutch", url: "https://clutch.co/review/1", icon: "javascript:alert(1)", quote: { pl: "Polecam" } })
  assert.deepEqual(review, { rating: 4.8, scale: 5, source: "Clutch", url: "https://clutch.co/review/1", icon: null, quote: { pl: "Polecam" }, author: null })
  assert.equal(normalizeReview({ rating: 9, source: "Clutch" })?.rating, 5)
  assert.equal(normalizeReview({ rating: 9, scale: 10, source: "Google" })?.scale, 10)
  assert.equal(normalizeReview({ rating: 5, source: "Clutch", url: "http://clutch.co" })?.url, null)
  assert.equal(normalizeReview({ rating: 0, source: "Clutch" }), null)
  assert.equal(normalizeReview({ rating: 5 }), null)
  assert.equal(normalizeReview("5 stars"), null)
  const [withReview, without] = normalizeReferences([
    { name: "A", url: "https://a.pl", review: { rating: 5, source: "Clutch" } },
    { name: "B", url: "https://b.pl", review: { rating: "great" } },
  ])
  assert.equal(withReview.review?.rating, 5)
  assert.equal(without.review, null)
})

test("references: the admin language with a fallback to the other one", () => {
  assert.equal(pickText({ en: "Tyres", pl: "Opony" }, "pl"), "Opony")
  assert.equal(pickText({ en: "Tyres", pl: "Opony" }, "en-US"), "Tyres")
  assert.equal(pickText({ en: "Only English" }, "pl"), "Only English")
  assert.equal(pickText({ pl: "Tylko polski" }, "en"), "Tylko polski")
  assert.equal(pickText(null, "pl"), "")
})

test("references: a store that starts soon needs only its name, a live one still needs an https URL", () => {
  const refs = normalizeReferences([
    { name: "Soon, no address", soon: true, description: "Opens in spring" },
    { name: "Soon, with an address", soon: true, url: "https://soon.example.com" },
    { name: "Soon, insecure address", soon: true, url: "http://soon.example.com" },
    { name: "Live, no address" },
    { name: "Live, insecure address", url: "http://live.example.com" },
    { name: "Not a boolean", soon: "yes" },
    { soon: true },
  ])
  assert.deepEqual(
    refs.map((r) => ({ name: r.name, soon: r.soon, url: r.url })),
    [
      { name: "Soon, no address", soon: true, url: null },
      { name: "Soon, with an address", soon: true, url: "https://soon.example.com/" },
      { name: "Soon, insecure address", soon: true, url: null },
    ],
  )
  assert.deepEqual(refs[0].description, { en: "Opens in spring", pl: "Opens in spring" })
  assert.equal(normalizeReferences(Array.from({ length: 15 }, (_, i) => ({ name: `Store ${i}`, soon: true }))).length, 12)
  assert.deepEqual(resolveOptions({ references: [{ name: "Soon", soon: true }] }).references.map((r) => r.soon), [true])
})

test("references: the since date of an older config is ignored, never an error", () => {
  const refs = normalizeReferences([
    { name: "Live", url: "https://a.pl", since: "2026-04" },
    { name: "Soon", soon: true, since: { not: "a month" } },
  ])
  assert.equal(refs.length, 2)
  for (const r of refs) assert.equal("since" in r, false)
  assert.equal(refs[0].url, "https://a.pl/")
  assert.equal(refs[1].soon, true)
})
