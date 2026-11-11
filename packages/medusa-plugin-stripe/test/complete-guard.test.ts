/**
 * The completion guard: a Stripe cart completes only when its PaymentIntent
 * is paid, and every doubt lets the request through.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { decideByStatus, pendingStripeIntent } from "../src/modules/stripe/lib/complete-guard.ts"
import { stripeCompleteGuard } from "../src/api/stripe/complete-guard.ts"

test("statuses: paid goes on, in progress and unpaid stop", () => {
  assert.equal(decideByStatus("succeeded").allow, true)
  assert.equal(decideByStatus("requires_capture").allow, true)
  assert.equal(decideByStatus(null).allow, true)
  const processing = decideByStatus("processing")
  assert.equal(processing.allow, false)
  assert.equal(!processing.allow && processing.code, "payment_processing")
  for (const s of ["requires_action", "requires_payment_method", "requires_confirmation", "canceled"]) {
    const d = decideByStatus(s)
    assert.equal(!d.allow && d.code, "payment_not_completed", s)
  }
})

test("the newest live Stripe session is the one checked", () => {
  assert.equal(pendingStripeIntent(null), null)
  assert.equal(pendingStripeIntent([{ provider_id: "pp_system_default", data: { id: "pi_x" } }]), null)
  assert.equal(
    pendingStripeIntent([
      { provider_id: "pp_stripe_stripe", status: "pending", data: { id: "pi_old" }, created_at: "2026-11-01T10:00:00Z" },
      { provider_id: "pp_stripe_stripe", status: "pending", data: { id: "pi_new" }, created_at: "2026-11-02T10:00:00Z" },
      { provider_id: "pp_stripe_stripe", status: "canceled", data: { id: "pi_gone" }, created_at: "2026-11-03T10:00:00Z" },
    ]),
    "pi_new",
  )
  assert.equal(pendingStripeIntent([{ provider_id: "pp_stripe_stripe", data: { id: "../balance" } }]), null)
})

function run(opts: { status?: string; demo?: boolean; completed?: boolean; fail?: boolean; sessions?: unknown[] }) {
  const logs: string[] = []
  const svc = {
    getOptions: () => ({ demo: opts.demo ?? false, apiKey: "rk_test_x", requestsPerSecond: 5, timeoutMs: 1000 }),
    getLogger: () => ({ info: (m: string) => logs.push(m), warn: (m: string) => logs.push(m) }),
  }
  const client = {
    get: async () => {
      if (opts.fail) throw new Error("stripe down")
      return { status: opts.status }
    },
    list: async () => ({ data: [] }),
  }
  const scope = {
    resolve: (key: string) => {
      if (key === "kodaStripeClient") return client
      if (key === "query")
        return {
          graph: async () => ({
            data: [
              {
                completed_at: opts.completed ? new Date() : null,
                payment_collection: { payment_sessions: opts.sessions ?? [{ provider_id: "pp_stripe_stripe", status: "pending", data: { id: "pi_123" } }] },
              },
            ],
          }),
        }
      return svc
    },
  }
  let nextCalled = false
  let statusCode = 0
  let body: any = null
  const res = { status: (c: number) => ((statusCode = c), res), json: (b: unknown) => ((body = b), res) }
  return stripeCompleteGuard()({ scope, params: { id: "cart_01ABC" } } as any, res as any, (() => (nextCalled = true)) as any).then(() => ({ nextCalled, statusCode, body, logs }))
}

test("middleware: a paid cart completes", async () => {
  const r = await run({ status: "succeeded" })
  assert.equal(r.nextCalled, true)
})

test("middleware: a payment in progress is stopped before Medusa takes a number", async () => {
  const r = await run({ status: "processing" })
  assert.equal(r.nextCalled, false)
  assert.equal(r.statusCode, 409)
  assert.equal(r.body.code, "payment_processing")
})

test("middleware: 3-D Secure not done is stopped", async () => {
  const r = await run({ status: "requires_action" })
  assert.equal(r.statusCode, 409)
  assert.equal(r.body.code, "payment_not_completed")
})

test("middleware: demo, completed carts, other providers and Stripe errors pass through", async () => {
  assert.equal((await run({ status: "processing", demo: true })).nextCalled, true)
  assert.equal((await run({ status: "processing", completed: true })).nextCalled, true)
  assert.equal((await run({ status: "processing", sessions: [{ provider_id: "pp_system_default", data: {} }] })).nextCalled, true)
  const down = await run({ fail: true })
  assert.equal(down.nextCalled, true)
  assert.match(down.logs.join(" "), /let the request through/)
})
