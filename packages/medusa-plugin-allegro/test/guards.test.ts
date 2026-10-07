/**
 * The route guards of the plugin: admin writes need JSON or the Koda header
 * (no cross-site form can arm a writer or disconnect the account), and a
 * shopper cannot put the keys that mean "an Allegro order" on a cart.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import middlewares from "../src/api/middlewares.ts"

type Mw = (req: any, res: any, next: () => void) => void

function run(matcher: string, req: Record<string, unknown>): { status: number | null; body: any; next: boolean } {
  const route = (middlewares as { routes: Array<{ matcher: string; middlewares: Mw[] }> }).routes.find((r) => r.matcher === matcher)
  assert.ok(route, `no middleware on ${matcher}`)
  const out = { status: null as number | null, body: null as any, next: false }
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
  for (const mw of route.middlewares) mw(req, res, () => (out.next = true))
  return out
}

test("guards: an admin write without JSON is refused, with JSON or the Koda header it passes, reads always pass", () => {
  assert.equal(run("/admin/allegro*", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" } }).status, 415)
  assert.equal(run("/admin/allegro*", { method: "POST", headers: { "content-type": "application/json" } }).next, true)
  assert.equal(run("/admin/allegro*", { method: "POST", headers: { "x-koda-request": "1" } }).next, true)
  assert.equal(run("/admin/allegro*", { method: "GET", headers: {} }).next, true)
})

test("guards: a shopper cannot set allegro_*, the marketplace reference or the demo marker; other metadata passes", () => {
  for (const key of ["allegro_payment_type", "ALLEGRO_checkout_form_id", "marketplace_order_ref", "koda_demo"]) {
    const r = run("/store/carts*", { method: "POST", body: { metadata: { [key]: "x" } } })
    assert.equal(r.status, 400, key)
    assert.equal(r.body.code, "reserved_metadata_key")
  }
  const items = run("/store/carts*", { method: "POST", body: { items: [{ metadata: { allegro_line_item_id: "x" } }] } })
  assert.equal(items.status, 400)
  /* A NIP typed at checkout is shopper input, not plugin state. */
  assert.equal(run("/store/carts*", { method: "POST", body: { metadata: { nip: "1234563218" } } }).next, true)
  assert.equal(run("/store/customers/me*", { method: "POST", body: { metadata: { marketplace_order_ref: "allegro:x" } } }).status, 400)
})

test("errors: a server failure answers a plain 500 and logs the masked details; Allegro's own refusal stays readable", async () => {
  const { sendError } = await import("../src/api/admin/allegro/helpers.ts")
  const { AllegroApiError } = await import("../src/modules/allegro/lib/client.ts")
  const logs: string[] = []
  const svc = { mask: (s: string) => s.replace("secret-value", "***"), getLogger: () => ({ error: (m: string) => logs.push(m) }) }
  const answer = () => {
    const out = { status: 0, body: null as any }
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
    return { out, res }
  }
  const sql = answer()
  sendError(sql.res as never, svc as never, new Error('relation "allegro_x" does not exist (secret-value)'), "test")
  assert.equal(sql.out.status, 500)
  assert.equal(sql.out.body.code, "server_error")
  assert.doesNotMatch(JSON.stringify(sql.out.body), /relation|secret/)
  assert.match(logs[0], /relation "allegro_x".*\*\*\*/)
  const oauth = answer()
  sendError(oauth.res as never, svc as never, new AllegroApiError(401, "Allegro OAuth: invalid_client", false, "invalid_client"), "test")
  assert.equal(oauth.out.status, 502)
  assert.equal(oauth.out.body.code, "invalid_client")
  assert.match(oauth.out.body.message, /clientId and clientSecret/)
})
