/**
 * Demo mode next to a real account in one database: the demo writes only its
 * own rows. A demo plan or snapshot never replaces what a real account read
 * and planned (a real account switched on later starts clean instead).
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { replacePlan } from "../src/workflows/baselinker/plans.ts"
import { prepareDemo } from "../src/workflows/baselinker/demo.ts"
import { fakeService } from "./fakes.ts"
import { storeFixture } from "./store.ts"

const live = { apiToken: "t0ken-t0ken-t0ken", inventoryId: 1, warehouseId: "bl_1", orderStatusId: 1 }

test("a demo plan never replaces the plan of a real account; a live plan clears the demo one", async () => {
  const demo = fakeService({ demo: true })
  const real = fakeService(live)
  real.tables.PlanItems = demo.table("PlanItems")
  await replacePlan(real.svc, "cards", null, [{ itemKey: "var_a", action: "create", status: "planned" }])
  await replacePlan(demo.svc, "cards", null, [{ itemKey: "var_x", action: "create", status: "planned" }])
  assert.deepEqual(demo.table("PlanItems").rows.map((r) => `${r.item_key}:${r.demo}`).sort(), ["var_a:false", "var_x:true"])
  await replacePlan(real.svc, "cards", null, [{ itemKey: "var_b", action: "update", status: "planned" }])
  assert.deepEqual(demo.table("PlanItems").rows.map((r) => `${r.item_key}:${r.demo}`), ["var_b:false"])
})

test("the demo snapshot never removes the cards a real account read", async () => {
  const t = storeFixture({ demo: true })
  t.s.table("Products").create({ bl_product_id: "232696614", name: "Opona z konta", sku: "OP-A", variant_id: "var_a", demo: false })
  t.s.table("StockChanges").create({ variant_id: "var_a", bl_product_id: "232696614", inventory_item_id: "iitem_a", location_id: "sloc_1", bl_stock: 3, target: 4, delta: 1, kind: "update", demo: false })
  await prepareDemo(t.container)
  assert.ok(t.s.table("Products").rows.some((r) => r.demo === false && r.bl_product_id === "232696614"))
  assert.ok(t.s.table("Products").rows.some((r) => r.demo === true))
  assert.ok(t.s.table("StockChanges").rows.some((r) => r.demo === false), "the live stock plan stays")
})
