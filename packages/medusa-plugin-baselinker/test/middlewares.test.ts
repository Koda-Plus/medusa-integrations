/**
 * The guards the plugin registers: writes to /admin/baselinker need a JSON
 * body or the x-koda-request header, and a shopper may not set the plugin's
 * metadata keys (every `baselinker_*` key, the shared marketplace reference
 * and the skip key) on the store routes. Shopper input such as a tax id stays
 * allowed.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import config from "../src/api/middlewares.ts"
import { fakeContainer, fakeService } from "./fakes.ts"

type Mw = (req: unknown, res: unknown, next: () => void) => void

function run(matcher: string, req: Record<string, unknown>): { status: number; passed: boolean; body: unknown } {
  const route = (config as { routes: Array<{ matcher: string; middlewares: Mw[] }> }).routes.find((r) => r.matcher === matcher)
  assert.ok(route, `no middleware for ${matcher}`)
  const out = { status: 200, passed: false, body: undefined as unknown }
  const res = {
    status(code: number) {
      out.status = code
      return res
    },
    json(body: unknown) {
      out.body = body
      return res
    },
  }
  for (const mw of route.middlewares) mw(req, res, () => void (out.passed = true))
  return out
}

const scope = fakeContainer({ baselinker: fakeService({ skipOrderMetadataKey: "test_order" }).svc })

test("admin writes need JSON or the x-koda-request header; reads pass", () => {
  assert.equal(run("/admin/baselinker*", { method: "POST", headers: { "content-type": "text/plain" } }).status, 415)
  assert.equal(run("/admin/baselinker*", { method: "POST", headers: { "content-type": "application/json" } }).passed, true)
  assert.equal(run("/admin/baselinker*", { method: "POST", headers: { "x-koda-request": "1" } }).passed, true)
  assert.equal(run("/admin/baselinker*", { method: "GET", headers: {} }).passed, true)
})

test("a shopper may not set the plugin's keys on a cart; a tax id and other notes pass", () => {
  const cart = (metadata: Record<string, unknown>) => run("/store/carts*", { method: "POST", scope, body: { metadata }, headers: {} })
  for (const key of ["baselinker_imported", "BaseLinker_Order_Id", "marketplace_order_ref", "test_order"]) {
    const out = cart({ [key]: true })
    assert.equal(out.status, 400, key)
    assert.equal((out.body as { code: string }).code, "reserved_metadata_key")
  }
  assert.equal(cart({ invoice_nip: "1234563218", customer_note: "Proszę dzwonić" }).passed, true)
  const line = run("/store/carts*", { method: "POST", scope, body: { items: [{ metadata: { baselinker_skip: true } }] }, headers: {} })
  assert.equal(line.status, 400, "line item metadata too")
})
