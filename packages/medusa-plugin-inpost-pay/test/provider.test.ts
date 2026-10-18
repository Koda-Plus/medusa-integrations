/**
 * The payment provider: a session made by the plugin (with its proof) is
 * authorized, in demo at once; a session a shopper makes through the Store
 * API is never authorized; a changed amount drops the proof.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import InpostPayPaymentProvider from "../src/providers/inpostpay/service.ts"
import { proofSecret, sessionProof } from "../src/modules/inpostpay/lib/proof.ts"
import { resolveOptions } from "../src/modules/inpostpay/lib/options.ts"

const silent = { info() {}, warn() {}, error() {} }
const OPTIONS = { demo: true, sessionSecret: "test-secret" }

function provider() {
  return new InpostPayPaymentProvider({ logger: silent } as never, OPTIONS)
}

function sessionData(amountMinor = 13599) {
  const data = { inpostpay: true, basket_id: "ipbsk_1", cart_id: "cart_1", amount_minor: amountMinor, demo: true, mode: "demo" }
  return { ...data, proof: sessionProof(proofSecret(resolveOptions(OPTIONS)), data) }
}

test("provider: the identifier names the provider pp_inpost-pay_<id>", () => {
  assert.equal(InpostPayPaymentProvider.identifier, "inpost-pay")
})

test("provider: the plugin's own session is authorized", async () => {
  const p = provider()
  const init = await p.initiatePayment({ amount: 135.99, currency_code: "pln", data: sessionData() })
  assert.equal(init.status, "pending")
  assert.match(init.id, /^ippay_/)
  const auth = await p.authorizePayment({ data: init.data })
  assert.equal(auth.status, "authorized")
  assert.equal(auth.data?.demo, true)
  assert.ok(auth.data?.authorized_at)
  assert.equal((await p.getPaymentStatus({ data: auth.data })).status, "authorized")
  const captured = await p.capturePayment({ data: auth.data })
  assert.equal((await p.getPaymentStatus({ data: captured.data })).status, "captured")
})

test("provider: a Store API session is never authorized", async () => {
  const p = provider()
  const forged = { inpostpay: true, basket_id: "ipbsk_1", cart_id: "cart_1", amount_minor: 13599, demo: true, proof: "0".repeat(64) }
  const init = await p.initiatePayment({ amount: 135.99, currency_code: "pln", data: forged })
  assert.equal(init.data?.untrusted, true)
  assert.equal((await p.authorizePayment({ data: init.data })).status, "error")
  assert.equal((await p.authorizePayment({ data: forged })).status, "error")
  assert.equal((await p.authorizePayment({ data: {} })).status, "error")
})

test("provider: another amount than the proof says is not trusted", async () => {
  const p = provider()
  const init = await p.initiatePayment({ amount: 10, currency_code: "pln", data: sessionData() })
  assert.equal(init.data?.untrusted, true)
  const updated = await p.updatePayment({ amount: 99, currency_code: "pln", data: sessionData() })
  assert.equal(updated.data?.proof, null)
  assert.equal((await p.authorizePayment({ data: updated.data })).status, "error")
})

test("provider: InPost reports through the Merchant API, not the payment webhook", async () => {
  assert.deepEqual(await provider().getWebhookActionAndData({ data: {}, rawData: "", headers: {} }), { action: "not_supported" })
})
