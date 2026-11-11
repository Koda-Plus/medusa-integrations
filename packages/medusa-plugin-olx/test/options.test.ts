import { test } from "node:test"
import assert from "node:assert/strict"
import { resolveOptions, wantsWriteScope } from "../src/modules/olx/lib/options.ts"

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
