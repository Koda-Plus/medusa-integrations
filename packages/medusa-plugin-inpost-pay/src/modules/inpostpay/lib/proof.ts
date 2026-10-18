import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import type { ResolvedInpostPayOptions } from "./options"

/**
 * THE PROOF ON A PAYMENT SESSION. The Store API lets a shopper create a
 * payment session for any enabled provider, with any `data`. So the
 * provider authorizes only a session the plugin itself created: its data
 * carries an HMAC of the basket, the cart and the amount, keyed by a secret
 * that never leaves the server. A session made through the Store API has no
 * valid proof and is never authorized.
 *
 * The secret: `sessionSecret` when set, else derived from `clientSecret`,
 * else (demo without keys) a random value of this process. The module and
 * the provider resolve the same options, so they agree.
 */

const PROCESS_SECRET = randomBytes(32).toString("hex")

export function proofSecret(o: Pick<ResolvedInpostPayOptions, "sessionSecret" | "clientSecret">): string {
  const base = o.sessionSecret || (o.clientSecret ? createHash("sha256").update(`inpostpay-session:${o.clientSecret}`).digest("hex") : "")
  return base || PROCESS_SECRET
}

export interface ProofInput {
  basket_id: string
  cart_id: string
  amount_minor: number
  demo: boolean
}

export function sessionProof(secret: string, input: ProofInput): string {
  return createHmac("sha256", secret).update(`${input.basket_id}|${input.cart_id}|${input.amount_minor}|${input.demo ? "demo" : "live"}`).digest("hex")
}

/** Whether the session data was written by this plugin for this basket, cart and amount. */
export function proofValid(secret: string, data: Record<string, unknown> | null | undefined): boolean {
  if (!data || typeof data !== "object") return false
  const basket = typeof data.basket_id === "string" ? data.basket_id : ""
  const cart = typeof data.cart_id === "string" ? data.cart_id : ""
  const amount = typeof data.amount_minor === "number" ? data.amount_minor : NaN
  const given = typeof data.proof === "string" ? data.proof : ""
  if (!basket || !cart || !Number.isInteger(amount) || !/^[0-9a-f]{64}$/.test(given)) return false
  const expected = sessionProof(secret, { basket_id: basket, cart_id: cart, amount_minor: amount, demo: data.demo === true })
  return timingSafeEqual(Buffer.from(given), Buffer.from(expected))
}
