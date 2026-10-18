import { createHash } from "node:crypto"
import { InpostPayApiError, type BasketAppClient, type OrderEventInput } from "./client"

/**
 * DEMO MODE: the same client as the live one, over a Basket App kept in
 * memory. Nothing leaves the server, `fetch` is never called: binding keys
 * are derived from the basket id (idempotent, like InPost's), basket updates
 * and order events are only recorded in this process's copy (gone after a
 * restart). There are no signing keys: the Merchant API is not part of the
 * demo flow, the storefront confirms a basket with a simulation instead.
 * Only on the `demo` option.
 */

export interface DemoBasketApp extends BasketAppClient {
  /** What the simulated Basket App received, newest last (tests and the demo panel read it). */
  readonly log: Array<{ at: string; call: string; id: string; body?: unknown }>
}

export function demoBindingKey(basketId: string): string {
  return `demo_${createHash("sha256").update(`inpostpay-demo:${basketId}`).digest("hex").slice(0, 32)}`
}

export function createDemoBasketAppClient(): DemoBasketApp {
  const log: DemoBasketApp["log"] = []
  const bound = new Set<string>()
  const note = (call: string, id: string, body?: unknown) => {
    log.push({ at: new Date().toISOString(), call, id, body })
    if (log.length > 200) log.splice(0, log.length - 200)
  }
  return {
    mode: "demo",
    log,
    async check() {
      return { ok: true, expiresIn: null }
    },
    async bind(basketId) {
      bound.add(basketId)
      note("bind", basketId)
      return { basket_binding_api_key: demoBindingKey(basketId) }
    },
    async updateBasket(basketId, basket) {
      note("update", basketId, basket)
    },
    async bindingStatus(basketId) {
      return { basket_linked: bound.has(basketId), demo: true }
    },
    async unbind(basketId) {
      bound.delete(basketId)
      note("unbind", basketId)
    },
    async orderEvent(orderId: string, event: OrderEventInput) {
      note("order_event", orderId, event)
      return { demo: true }
    },
    async signingKey() {
      throw new InpostPayApiError(409, "invalid", "Demo mode has no signing keys: the Merchant API is not used by the demo")
    },
  }
}
