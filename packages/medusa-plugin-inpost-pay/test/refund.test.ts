/**
 * Refunds through InPost Pay: the signature gives the hashes of both
 * examples of InPost's "Ordering a refund" page, the night window is closed,
 * the paid transaction of an order is picked and never guessed, the client
 * signs and sends the command id, and the provider refunds, records or
 * refuses as the options say.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { MedusaError } from "@medusajs/framework/utils"
import { pickTransaction, refundCommandId, refundSignature, refundWindowOpen, uuidFrom, type InpostTransaction } from "../src/modules/inpostpay/lib/refund.ts"
import { createBasketAppClient, InpostPayApiError, type BasketAppClient, type RefundResult, type TransactionFilters } from "../src/modules/inpostpay/lib/client.ts"
import { createDemoBasketAppClient } from "../src/modules/inpostpay/lib/demo.ts"
import { refundMode, resolveOptions } from "../src/modules/inpostpay/lib/options.ts"
import { eventIsNew } from "../src/workflows/inpostpay/payments.ts"
import InpostPayPaymentProvider from "../src/providers/inpostpay/service.ts"

const SECRET = "0051db3ab9ea4351bfebbcbe1adcc045"
const COMMAND = "f3daf649-30bd-4578-a3bc-89ee822e2887"
const TX = "c50c3756-7ca1-431d-8b4e-4fc322b18548"

test("refund signature: example 1 of InPost's page (amount, refund id, nested data)", () => {
  const body = { refund_amount: 1.23, external_refund_id: "0b374857-2096-46e0-a9d6-26f313073d32", additional_business_data: { key1: "value1", key2: "value2" } }
  assert.equal(
    refundSignature({ commandId: COMMAND, transactionId: TX, body, merchantSecret: SECRET }),
    "cc0db3ef7457fdf741af4a6423874415ef77ec9b2cdb7684d8ff7d0e73bcdfd215030ab7a53725dd00e6382bc1a6a9b7aa19294b86b07615c1ebcf039c20a83f",
  )
})

test("refund signature: example 2 of InPost's page (nulls are empty)", () => {
  assert.equal(
    refundSignature({ commandId: COMMAND, transactionId: TX, body: { refund_amount: null, external_refund_id: null }, merchantSecret: SECRET }),
    "186c45bb02603c37325233a8e5471adda94eed27caeb27f3289c678c48a496367db1937d045d8421d914b94502d92d3a9a2fe52e566fbcb8a2e6330add4a663c",
  )
})

test("refund command id: a UUID, the same for a retry, new for the next refund", () => {
  const a = refundCommandId("ipbsk_1", 0, 1000)
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  assert.equal(refundCommandId("ipbsk_1", 0, 1000), a)
  assert.notEqual(refundCommandId("ipbsk_1", 1, 1000), a)
  assert.notEqual(refundCommandId("ipbsk_1", 0, 999), a)
  assert.equal(uuidFrom("x").length, 36)
})

test("refund window: closed from 23:00 to 6:30 Polish time, winter and summer", () => {
  assert.equal(refundWindowOpen(new Date("2026-11-03T21:59:00Z")), true, "22:59 CET")
  assert.equal(refundWindowOpen(new Date("2026-11-03T22:00:00Z")), false, "23:00 CET")
  assert.equal(refundWindowOpen(new Date("2026-11-04T05:29:00Z")), false, "6:29 CET")
  assert.equal(refundWindowOpen(new Date("2026-11-04T05:30:00Z")), true, "6:30 CET")
  assert.equal(refundWindowOpen(new Date("2026-07-01T20:59:00Z")), true, "22:59 CEST")
  assert.equal(refundWindowOpen(new Date("2026-07-01T21:00:00Z")), false, "23:00 CEST")
})

const tx = (id: string, status: string, order: string): InpostTransaction => ({ transaction_id: id, status, amount: 10, order_id: order, created_date: null })

test("pick transaction: the paid one of the order, never another order's, never a guess", () => {
  const items = [tx("t0", "DECLINED", "order_A|x1"), tx("t1", "CAPTURED", "order_A|x1"), tx("t2", "CAPTURED", "order_AB|x2")]
  assert.deepEqual(pickTransaction(items, "order_A"), { ok: true, transaction: items[1] })
  assert.deepEqual(pickTransaction(items, "order_C"), { ok: false, reason: "none" })
  assert.deepEqual(pickTransaction([tx("t1", "REFUNDED", "order_A|x")], "order_A"), { ok: false, reason: "refunded" })
  assert.deepEqual(pickTransaction([tx("t1", "CAPTURED", "order_A|x"), tx("t2", "CAPTURED", "order_A|y")], "order_A"), { ok: false, reason: "ambiguous" })
  assert.equal(pickTransaction([tx("t1", "AUTHORIZED", "order_A|x"), tx("t2", "CAPTURED", "order_A|y")], "order_A").ok, true, "the captured one wins over an authorization")
  assert.equal(pickTransaction([tx("t1", "PARTIALLY_REFUNDED", "order_A")], "order_A").ok, true, "a plain merchant id matches too")
})

test("live client: a refund is signed, carries X-Command-ID and the transaction list reads its filters", async () => {
  const calls: Array<{ url: string; method: string; headers: Record<string, string>; body?: string }> = []
  const fetch = async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body })
    const body = url.endsWith("/token")
      ? { access_token: "tok", expires_in: 300 }
      : url.includes("/refund")
        ? { external_refund_id: "r1", refund_amount: 12.5, status: "PENDING", description: "queued" }
        : { items: [{ transaction_id: "t1", status: "CAPTURED", amount: 12.5, order_id: "order_1|abc" }, { status: "CAPTURED" }], count: 1 }
    return { status: 200, ok: true, text: async () => JSON.stringify(body) }
  }
  const c = createBasketAppClient({ mode: "sandbox", apiUrl: "https://sandbox-api.inpost.pl", tokenUrl: "https://t/token", clientId: "c", clientSecret: "s", timeoutMs: 5000, merchantSecret: SECRET, fetch })
  const list = await c.transactions({ date_from: "2026-11-01", page: 0, per_page: 100 })
  assert.deepEqual(list.items.map((t) => t.transaction_id), ["t1"], "an item without an id is dropped")
  assert.equal(list.count, 1)
  const r = await c.refund("t1", { commandId: COMMAND, body: { external_refund_id: "r1", refund_amount: 12.5 } })
  assert.deepEqual(r, { external_refund_id: "r1", refund_amount: 12.5, status: "PENDING", description: "queued" })
  const get = calls.find((x) => x.method === "GET")!
  assert.equal(get.url, "https://sandbox-api.inpost.pl/v1/izi/transaction?date_from=2026-11-01&page=0&per_page=100")
  const post = calls.find((x) => x.url.endsWith("/v1/izi/transaction/t1/refund"))!
  assert.equal(post.headers["X-Command-ID"], COMMAND)
  const sent = JSON.parse(post.body ?? "{}")
  assert.equal(sent.signature, refundSignature({ commandId: COMMAND, transactionId: "t1", body: { external_refund_id: "r1", refund_amount: 12.5 }, merchantSecret: SECRET }))
  assert.equal(sent.refund_amount, 12.5)

  const unsigned = createBasketAppClient({ mode: "sandbox", apiUrl: "https://x", tokenUrl: "https://t/token", clientId: "c", clientSecret: "s", timeoutMs: 5000, fetch })
  await assert.rejects(() => unsigned.refund("t1", { commandId: COMMAND, body: {} }), InpostPayApiError)
})

test("demo client: refunds succeed without fetch", async () => {
  const c = createDemoBasketAppClient()
  assert.deepEqual(await c.transactions({}), { items: [], count: 0 })
  assert.equal((await c.refund("t", { commandId: COMMAND, body: { refund_amount: 1 } })).status, "SUCCESS")
})

test("refund mode: InPost with the merchant secret, recorded only on request, refused otherwise", () => {
  const keys = { clientId: "c", clientSecret: "s", merchantClientId: "m", sandbox: true }
  assert.equal(refundMode(resolveOptions({ demo: true })), "demo")
  assert.equal(refundMode(resolveOptions({ ...keys, merchantSecret: "x" })), "inpost")
  assert.equal(refundMode(resolveOptions({ ...keys, manualRefunds: "true" })), "manual")
  assert.equal(refundMode(resolveOptions(keys)), "off")
  assert.equal(refundMode(resolveOptions({ merchantSecret: "x" })), "off", "a secret without the keys refunds nothing")
  assert.equal(resolveOptions({ ...keys, merchantSecret: "x" }).autoCapture, true, "capture is automatic when refunds work")
  assert.equal(resolveOptions({ ...keys, manualRefunds: true }).autoCapture, true)
  assert.equal(resolveOptions(keys).autoCapture, false, "without refunds a captured payment could not be canceled")
  assert.equal(resolveOptions({ ...keys, autoCapture: "true" }).autoCapture, true)
  assert.equal(resolveOptions({ ...keys, merchantSecret: "x", autoCapture: "false" }).autoCapture, false)
})

test("InPost events: a repeat or an older event is not applied", () => {
  const events = [{ at: "2026-11-03T10:00:00Z", kind: "payment", message: "", data: { event_id: "e1", event_time: "2026-11-03T10:00:00.000Z" } }]
  assert.deepEqual(eventIsNew(events, "e1", Date.parse("2026-11-03T11:00:00Z")), { ok: false, reason: "duplicate" })
  assert.deepEqual(eventIsNew(events, "e2", Date.parse("2026-11-03T09:00:00Z")), { ok: false, reason: "stale" })
  assert.deepEqual(eventIsNew(events, "e3", Date.parse("2026-11-03T10:00:00Z")), { ok: true })
  assert.deepEqual(eventIsNew(events, "e4", null), { ok: true }, "an event without a time is applied")
  assert.deepEqual(eventIsNew([], "e1", 0), { ok: true })
})

/* The provider over a fake Basket App. */

class FakeApp {
  transactionsSeen: TransactionFilters[] = []
  refunds: Array<{ id: string; commandId: string; amount: number | null | undefined }> = []
  list: InpostTransaction[] = [tx("t-old", "DECLINED", "order_1|i1"), tx("t-paid", "CAPTURED", "order_1|i1")]
  answer: () => Promise<RefundResult> = async () => ({ external_refund_id: null, refund_amount: null, status: "SUCCESS", description: null })
  client(): BasketAppClient {
    const app = this
    const demo = createDemoBasketAppClient()
    return {
      ...demo,
      mode: "sandbox",
      async transactions(f) {
        app.transactionsSeen.push(f)
        const items = f.transaction_id ? app.list.filter((t) => t.transaction_id === f.transaction_id) : app.list
        return { items, count: items.length }
      },
      async refund(id, input) {
        app.refunds.push({ id, commandId: input.commandId, amount: input.body.refund_amount })
        return app.answer()
      },
    }
  }
}

const DAY = new Date("2026-11-03T10:00:00Z")
const silent = { info() {}, warn() {}, error() {} }
const KEYS = { clientId: "c", clientSecret: "s", merchantClientId: "m", sandbox: true, sessionSecret: "x" }

function providerWith(app: FakeApp, options: Record<string, unknown>, at = DAY) {
  class TestProvider extends InpostPayPaymentProvider {
    protected refundClient() {
      return app.client()
    }
    protected now() {
      return at
    }
  }
  return new TestProvider({ logger: silent } as never, { ...KEYS, ...options })
}

const paid = { inpostpay: true, basket_id: "ipbsk_1", order_id: "order_1", authorized_at: "2026-11-02T12:00:00Z", inpost_payment_type: "BLIK_CODE" }

test("provider refund: InPost returns the money, the transaction is kept for the next refund", async () => {
  const app = new FakeApp()
  const p = providerWith(app, { merchantSecret: SECRET })
  const out = await p.refundPayment({ data: paid, amount: { value: "25.50", precision: 20 } })
  assert.deepEqual(app.refunds, [{ id: "t-paid", commandId: refundCommandId("ipbsk_1", 0, 2550), amount: 25.5 }])
  assert.equal(app.transactionsSeen[0].date_from, "2026-11-01", "from a day before the authorization")
  assert.equal(out.data?.transaction_id, "t-paid")
  const entry = (out.data?.refunds as Array<Record<string, unknown>>)[0]
  assert.equal(entry.amount, "25.50")
  assert.equal(entry.status, "SUCCESS")

  const second = await p.refundPayment({ data: out.data, amount: 10 })
  assert.equal(app.refunds[1].id, "t-paid")
  assert.equal(app.transactionsSeen.length, 1, "the saved transaction is not looked up again")
  assert.equal(app.refunds[1].commandId, refundCommandId("ipbsk_1", 1, 1000))
  assert.equal((second.data?.refunds as unknown[]).length, 2)
})

test("provider refund: a retry after an unclear answer sends the same command id, the next refund a new one", async () => {
  const app = new FakeApp()
  const p = providerWith(app, { merchantSecret: SECRET })
  const data = { ...paid, basket_id: "ipbsk_retry" }
  app.answer = async () => {
    throw new InpostPayApiError(0, "unavailable", "InPost did not answer within 15000 ms")
  }
  await assert.rejects(() => p.refundPayment({ data, amount: 5 }), MedusaError)
  app.answer = async () => ({ external_refund_id: null, refund_amount: null, status: "SUCCESS", description: null })
  const out = await p.refundPayment({ data, amount: 5 })
  assert.equal(app.refunds[0].commandId, app.refunds[1].commandId, "the retry of the unclear refund is the same command")
  await p.refundPayment({ data: out.data, amount: 5 })
  assert.notEqual(app.refunds[2].commandId, app.refunds[1].commandId, "a new refund of the same amount is a new command")
})

test("provider refund: two refunds of one amount made together are two commands", async () => {
  const app = new FakeApp()
  const p = providerWith(app, { merchantSecret: SECRET })
  const data = { ...paid, basket_id: "ipbsk_together" }
  await Promise.all([p.refundPayment({ data, amount: 5 }), p.refundPayment({ data, amount: 5 })])
  assert.equal(app.refunds.length, 2)
  assert.notEqual(app.refunds[0].commandId, app.refunds[1].commandId)
})

test("provider refund: the payment reference of InPost's event is tried first", async () => {
  const app = new FakeApp()
  const p = providerWith(app, { merchantSecret: SECRET })
  await p.refundPayment({ data: { ...paid, payment_reference: "t-paid" }, amount: 5 })
  assert.deepEqual(app.transactionsSeen, [{ transaction_id: "t-paid" }])
})

const rejectsWith = (type: string, pattern: RegExp) => (e: unknown) => {
  assert.ok(e instanceof MedusaError, String(e))
  assert.equal(e.type, type)
  assert.match(e.message, pattern)
  return true
}

test("provider refund: a refusal, an unclear answer or a missing transaction fails the refund in Medusa", async () => {
  const app = new FakeApp()
  const p = providerWith(app, { merchantSecret: SECRET })
  app.answer = async () => ({ external_refund_id: null, refund_amount: null, status: "FAILED", description: "insufficient balance" })
  await assert.rejects(() => p.refundPayment({ data: paid, amount: 5 }), rejectsWith(MedusaError.Types.NOT_ALLOWED, /insufficient balance/))
  app.answer = async () => {
    throw new InpostPayApiError(0, "unavailable", "InPost did not answer within 15000 ms")
  }
  await assert.rejects(() => p.refundPayment({ data: paid, amount: 5 }), rejectsWith(MedusaError.Types.UNEXPECTED_STATE, /may have gone through/))
  app.answer = async () => {
    throw new InpostPayApiError(400, "invalid", "InPost answered 400: amount too high")
  }
  await assert.rejects(() => p.refundPayment({ data: paid, amount: 5 }), rejectsWith(MedusaError.Types.NOT_ALLOWED, /amount too high/))
  const other = new FakeApp()
  other.list = [tx("t9", "CAPTURED", "order_2|i2")]
  await assert.rejects(() => providerWith(other, { merchantSecret: SECRET }).refundPayment({ data: paid, amount: 5 }), rejectsWith(MedusaError.Types.NOT_ALLOWED, /no paid transaction/))
  await assert.rejects(() => p.refundPayment({ data: { ...paid, order_id: undefined }, amount: 5 }), rejectsWith(MedusaError.Types.NOT_ALLOWED, /order id/))
})

test("provider refund: refused at night, without the merchant secret, recorded for manual, COD and demo", async () => {
  const app = new FakeApp()
  await assert.rejects(() => providerWith(app, { merchantSecret: SECRET }, new Date("2026-11-03T23:30:00Z")).refundPayment({ data: paid, amount: 5 }), rejectsWith(MedusaError.Types.NOT_ALLOWED, /23:00 and 6:30/))
  await assert.rejects(() => providerWith(app, {}).refundPayment({ data: paid, amount: 5 }), rejectsWith(MedusaError.Types.NOT_ALLOWED, /merchantSecret/))
  const manual = await providerWith(app, { manualRefunds: true }).refundPayment({ data: paid, amount: 5 })
  assert.equal((manual.data?.refunds as Array<Record<string, unknown>>)[0].manual, true)
  const cod = await providerWith(app, { merchantSecret: SECRET }).refundPayment({ data: { ...paid, inpost_payment_type: "CASH_ON_DELIVERY" }, amount: 5 })
  assert.equal((cod.data?.refunds as Array<Record<string, unknown>>)[0].cash_on_delivery, true)
  const demo = await providerWith(app, { merchantSecret: SECRET }).refundPayment({ data: { ...paid, demo: true }, amount: 5 })
  assert.equal((demo.data?.refunds as Array<Record<string, unknown>>)[0].demo, true)
  assert.equal(app.refunds.length, 0, "none of these reached InPost")
})
