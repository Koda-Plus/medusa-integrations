/**
 * Demo mode never touches the store's money or stock: a simulated Allegro
 * order is moved out of draft in the order module itself (no placing, so no
 * reservation, no `order.placed`, no payment and no `payment.captured`), and
 * a cancellation on the simulated account cancels it the same quiet way.
 * The read routes never start a flow: the demo data comes from a job or a
 * POST.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { cancelDemoOrder, completeAllegroOrder } from "../src/workflows/allegro/import-order.ts"
import { demoSeedKinds, missingDemoKinds } from "../src/workflows/allegro/demo-seed.ts"

function fakeContainer(order: Record<string, any>) {
  const calls: string[] = []
  const container = {
    resolve(key: string) {
      if (key === "query") {
        return { graph: async () => ({ data: [order] }) }
      }
      if (key === "order") {
        return {
          updateOrders: async (list: Array<Record<string, unknown>>) => {
            calls.push(`updateOrders:${JSON.stringify(list[0])}`)
            Object.assign(order, list[0])
            return list
          },
          cancel: async (id: string) => {
            calls.push(`cancel:${id}`)
            order.status = "canceled"
            return order
          },
        }
      }
      /* Anything else (workflows, the event bus, payments) is not here: touching it fails the test. */
      throw new Error(`resolve(${key}) is not allowed in demo`)
    },
  }
  return { container, calls }
}

const draft = () => ({
  id: "order_demo_1",
  status: "draft",
  is_draft_order: true,
  email: null,
  display_id: 501,
  total: 129.99,
  currency_code: "pln",
  items: [{ id: "item_1", tax_lines: [{ id: "tl_1" }] }],
  shipping_methods: [{ id: "sm_1", tax_lines: [{ id: "tl_2" }] }],
  payment_collections: [],
})

test("demo order: pending in the order module, never placed, reserved or paid", async () => {
  const order = draft()
  const { container, calls } = fakeContainer(order)
  const result = await completeAllegroOrder(container as never, order.id, { email: "kupujacy@example.com", paid: true, demo: true })
  assert.equal(order.status, "pending")
  assert.equal(order.is_draft_order, false)
  assert.equal(order.email, "kupujacy@example.com")
  assert.deepEqual(order.payment_collections, [], "no payment collection, nothing marked paid")
  assert.equal(calls.length, 1)
  assert.equal(result.displayId, 501)
  /* Run again: nothing more happens. */
  await completeAllegroOrder(container as never, order.id, { email: "kupujacy@example.com", paid: true, demo: true })
  assert.equal(calls.length, 1)
})

test("demo order: a cancellation goes through the order module only", async () => {
  const order = { ...draft(), status: "pending", is_draft_order: false }
  const { container, calls } = fakeContainer(order)
  await cancelDemoOrder(container as never, order.id)
  assert.deepEqual(calls, [`cancel:${order.id}`])
  assert.equal(order.status, "canceled")
})

test("reads never seed: GET /admin/allegro and its helper start no flow, the demo data has its own job and route", () => {
  const route = readFileSync(new URL("../src/api/admin/allegro/route.ts", import.meta.url), "utf8")
  const helpers = readFileSync(new URL("../src/api/admin/allegro/helpers.ts", import.meta.url), "utf8")
  for (const source of [route, helpers]) {
    assert.doesNotMatch(source, /\.run\(/)
    assert.doesNotMatch(source, /seedDemo|ensureDemoSnapshot/)
  }
  const job = readFileSync(new URL("../src/jobs/allegro-demo-seed.ts", import.meta.url), "utf8")
  assert.match(job, /name: "allegro-demo-seed"/)
  assert.match(job, /if \(!svc\.isDemo\(\)\) return/)
  const post = readFileSync(new URL("../src/api/admin/allegro/demo/seed/route.ts", import.meta.url), "utf8")
  assert.match(post, /export async function POST/)
  assert.doesNotMatch(post, /export async function GET/)
})

test("demo data: the kinds still missing come from the last runs, the journal only when it is on", () => {
  assert.deepEqual(demoSeedKinds({ ordersEnabled: true }), ["offers", "orders", "stock", "prices", "issues", "publish"])
  assert.deepEqual(demoSeedKinds({ ordersEnabled: false }), ["offers", "stock", "prices", "issues", "publish"])
  assert.deepEqual(missingDemoKinds({ ordersEnabled: true }, { offers: {}, stock: {}, prices: null }), ["orders", "prices", "issues", "publish"])
})
