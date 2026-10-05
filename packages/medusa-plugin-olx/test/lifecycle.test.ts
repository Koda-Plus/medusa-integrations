import { test } from "node:test"
import assert from "node:assert/strict"
import { guardLimit, planLifecycle, type LifecycleVariant } from "../src/modules/olx/lib/lifecycle.ts"

const v = (id: string, over: Partial<LifecycleVariant> = {}): LifecycleVariant => ({
  id,
  productId: `prod_${id}`,
  sku: id.toUpperCase(),
  productTitle: id,
  productStatus: "published",
  stock: { kind: "tracked", available: 3 },
  ...over,
})

const a = (olxId: string, status: string, variantId: string | null) => ({ olxId, status, variantId, title: `Advert ${olxId}`, url: "https://www.olx.pl/d/x" })

const variants = new Map<string, LifecycleVariant>([
  ["sold", v("sold", { stock: { kind: "tracked", available: 0 } })],
  ["draft", v("draft", { productStatus: "draft" })],
  ["back", v("back")],
  ["fine", v("fine")],
  ["unknown", v("unknown", { stock: { kind: "unknown" } })],
])

test("deactivate live adverts of sold out or unpublished variants, finish sold out adverts over the limit", () => {
  const plan = planLifecycle({
    adverts: [a("10", "active", "sold"), a("11", "limited", "sold"), a("12", "active", "draft"), a("13", "active", "fine"), a("14", "active", "unknown"), a("15", "active", null)],
    variants,
    pausedByPlugin: new Set(),
    readComplete: true,
    stockComplete: true,
  })
  assert.equal(plan.skipped, null)
  assert.deepEqual(
    plan.actions.map((x) => [x.olxId, x.command, x.reason]),
    [
      ["10", "deactivate", "sold_out"],
      ["12", "deactivate", "unpublished"],
      ["11", "finish", "sold_out"],
    ],
  )
  assert.equal(plan.actions[0].toStatus, "removed_by_user")
})

test("only adverts the plugin paused come back, and only when sellable again", () => {
  const plan = planLifecycle({
    adverts: [a("20", "removed_by_user", "back"), a("21", "removed_by_user", "back"), a("22", "removed_by_user", "sold"), a("23", "outdated", "back")],
    variants,
    pausedByPlugin: new Set(["20", "22", "23"]),
    readComplete: true,
    stockComplete: true,
  })
  assert.deepEqual(plan.actions.map((x) => [x.olxId, x.command]), [["20", "activate"]], "21 was ended by a person, 22 is still sold out, 23 expired")
})

test("a paused advert that is live again was brought back by a person: the pause is forgotten", () => {
  const plan = planLifecycle({ adverts: [a("30", "active", "fine")], variants, pausedByPlugin: new Set(["30"]), readComplete: true, stockComplete: true })
  assert.deepEqual(plan.resumed, ["30"])
  assert.equal(plan.actions.length, 0)
})

test("an incomplete read or missing stock data plans nothing", () => {
  const input = { adverts: [a("10", "active", "sold")], variants, pausedByPlugin: new Set<string>() }
  assert.equal(planLifecycle({ ...input, readComplete: false, stockComplete: true }).skipped, "incomplete_read")
  assert.equal(planLifecycle({ ...input, readComplete: true, stockComplete: false }).skipped, "no_stock_data")
  assert.equal(planLifecycle({ ...input, readComplete: false, stockComplete: true }).actions.length, 0)
})

test("the mass guard holds a plan that ends more than max(10, 25 %) of the live linked adverts", () => {
  assert.equal(guardLimit(8), 10)
  assert.equal(guardLimit(100), 25)
  const many = new Map<string, LifecycleVariant>()
  const adverts = []
  for (let i = 0; i < 40; i += 1) {
    many.set(`v${i}`, v(`v${i}`, { stock: { kind: "tracked", available: i < 11 ? 0 : 5 } }))
    adverts.push(a(String(1000 + i), "active", `v${i}`))
  }
  const plan = planLifecycle({ adverts, variants: many, pausedByPlugin: new Set(), readComplete: true, stockComplete: true })
  assert.equal(plan.guard.liveLinked, 40)
  assert.equal(plan.guard.limit, 10)
  assert.equal(plan.guard.endings, 11)
  assert.equal(plan.guard.held, true)
  const fewer = planLifecycle({ adverts: adverts.slice(5), variants: many, pausedByPlugin: new Set(), readComplete: true, stockComplete: true })
  assert.equal(fewer.guard.endings, 6)
  assert.equal(fewer.guard.held, false)
})
