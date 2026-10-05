import { test } from "node:test"
import assert from "node:assert/strict"
import { resolveOptions, wantsWriteScope } from "../src/modules/olx/lib/options.ts"
import { fmtMonth, normalizeReferences, pickText, validSince } from "../src/modules/olx/lib/references.ts"

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
      since: "2026-04",
      metrics: [{ label: { en: "adverts", pl: "ogłoszeń" }, value: "1 900" }, { label: "broken" }],
      links: [{ label: "Product", url: "https://www.oponykola.pl/p/1" }, { label: "Insecure", url: "http://x.pl" }],
    },
    { name: "No URL" },
    { name: "Plain http", url: "http://shop.pl" },
    { name: "", url: "https://shop.pl" },
    { name: "Duplicate", url: "https://www.oponykola.pl" },
    "not an object",
    { name: "Bad since", url: "https://shop.example.com", since: "2026-13", description: "Same in both" },
  ])
  assert.equal(refs.length, 2)
  assert.equal(refs[0].since, "2026-04")
  assert.equal(refs[0].metrics.length, 1)
  assert.equal(refs[0].links.length, 1)
  assert.equal(refs[1].since, null)
  assert.deepEqual(refs[1].description, { en: "Same in both", pl: "Same in both" })
  assert.deepEqual(normalizeReferences("nope"), [])
  assert.deepEqual(normalizeReferences(undefined), [])
  assert.equal(resolveOptions({ references: [{ name: "A", url: "https://a.pl" }] }).references.length, 1)
})

test("references: the admin language with a fallback to the other one", () => {
  assert.equal(pickText({ en: "Tyres", pl: "Opony" }, "pl"), "Opony")
  assert.equal(pickText({ en: "Tyres", pl: "Opony" }, "en-US"), "Tyres")
  assert.equal(pickText({ en: "Only English" }, "pl"), "Only English")
  assert.equal(pickText({ pl: "Tylko polski" }, "en"), "Tylko polski")
  assert.equal(pickText(null, "pl"), "")
  assert.equal(validSince("2026-04"), "2026-04")
  assert.equal(validSince("2026-4"), null)
})

test("since: English month and year, Polish genitive for \"Od kwietnia 2026\"", () => {
  assert.equal(fmtMonth("2026-04", "en"), "April 2026")
  assert.equal(fmtMonth("2026-04", "pl"), "kwietnia 2026")
  assert.equal(fmtMonth("2026-09", "pl-PL"), "września 2026")
  assert.equal(fmtMonth("2026-01", "pl"), "stycznia 2026")
  assert.equal(fmtMonth("not a month", "pl"), "not a month")
  assert.equal(fmtMonth("2026-13", "en"), "2026-13")
})
