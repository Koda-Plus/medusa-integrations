/**
 * ABANDONED CART REMINDERS, every hour, OFF until the `cart.abandoned`
 * template is turned on (in the admin, or `templates: { "cart.abandoned":
 * true }`).
 *
 * A cart gets one reminder at most: it has an e-mail address and products,
 * no order, and it has been idle between `afterHours` (24) and
 * `maxAgeHours` (72). Older carts are never mailed, so turning the job on
 * does not wake up months of old carts. At most `maxPerRun` (50) per run.
 * The key `emails:cart.abandoned:<cart id>` is checked in the send log
 * before anything is sent. Nothing in Medusa is written: no cart metadata.
 *
 * Reminders can count as marketing where you sell: check your consent basis
 * before you turn them on.
 */

import { TEMPLATES } from "../../modules/emails/lib/constants"
import { cartData, type CartRecord } from "../../modules/emails/lib/data"
import { eventKey, retryNotificationKey } from "../../modules/emails/lib/keys"
import { isEmail } from "../../modules/emails/lib/security"
import type { HandlerOptions, HandlerOutcome } from "./events"
import { emailsService, exclusive, graphList, graphOne, storeFor, templateStateOf, type Scope } from "./runtime"
import { recordPreSend, sendTemplate } from "./send-template"

export const CART_FIELDS: readonly string[] = [
  "id",
  "email",
  "currency_code",
  "created_at",
  "updated_at",
  "completed_at",
  "metadata",
  "customer_id",
  "item_total",
  "total",
  "items.*",
  "shipping_address.first_name",
  "shipping_address.country_code",
  "customer.first_name",
  "customer.metadata",
]

export const CART_OPTIONAL_FIELDS: readonly string[] = ["locale"]

function usable(cart: CartRecord | null): cart is CartRecord {
  return Boolean(cart && !cart.completed_at && isEmail(String(cart.email ?? "").trim()) && Array.isArray(cart.items) && cart.items.length > 0)
}

/** One cart's reminder (the job, or a person's retry with its id). */
export async function sendAbandonedCart(scope: Scope, cartOrId: CartRecord | string, opts: HandlerOptions = {}): Promise<HandlerOutcome> {
  const template = TEMPLATES.cartAbandoned
  const svc = emailsService(scope)
  try {
    const cart = typeof cartOrId === "string" ? await graphOne<CartRecord>(scope, "cart", CART_FIELDS, CART_OPTIONAL_FIELDS, { id: cartOrId }) : cartOrId
    if (!usable(cart)) return { status: "skipped", reason: "the cart is gone, completed, or has no address or products" }
    const key = eventKey(template, cart.id)
    const outcome = await sendTemplate(scope, {
      template,
      to: String(cart.email).trim(),
      data: cartData(cart, svc.getOptions()) as unknown as Record<string, unknown>,
      key,
      trigger: "emails-abandoned-carts",
      kind: "job",
      resource: { type: "cart", id: cart.id },
      receiverId: cart.customer_id ?? null,
      ...(opts.retry ? { retry: true, requestedBy: opts.requestedBy ?? null, notificationKey: retryNotificationKey(key, opts.rotation ?? 1) } : {}),
    })
    if (outcome.status === "queued") return { status: "sent" }
    if (outcome.status === "failed") return { status: "failed", reason: outcome.error }
    if (outcome.status === "skipped") return { status: "skipped", reason: outcome.reason }
    return { status: outcome.status }
  } catch (err) {
    const reason = svc.mask((err as Error)?.message ?? String(err))
    svc.getLogger().warn(`[emails] cart.abandoned: ${reason}`)
    const cartId = typeof cartOrId === "string" ? cartOrId : cartOrId?.id
    if (cartId && !opts.retry) {
      const to = typeof cartOrId === "string" ? "" : String(cartOrId.email ?? "")
      await recordPreSend(scope, { template, to, data: {}, key: eventKey(template, cartId), trigger: "emails-abandoned-carts", kind: "job", resource: { type: "cart", id: cartId } }, "PRE_SEND", reason)
    }
    return { status: "failed", reason }
  }
}

/** Pages of carts one run reads at most (`maxPerRun * 3` carts each), so a busy window is reached past its first page. */
const MAX_PAGES = 10

export interface AbandonedRun {
  checked: number
  sent: number
  skipped: number
  failed: number
  off: boolean
}

export async function runAbandonedCarts(scope: Scope, now: Date = new Date()): Promise<AbandonedRun | null> {
  return exclusive("abandoned-carts", async () => {
    const svc = emailsService(scope)
    const o = svc.getOptions()
    const state = await templateStateOf(scope, TEMPLATES.cartAbandoned)
    if (!state?.enabled) return { checked: 0, sent: 0, skipped: 0, failed: 0, off: true }
    const before = new Date(now.getTime() - o.abandonedCart.afterHours * 3600 * 1000)
    const after = new Date(now.getTime() - o.abandonedCart.maxAgeHours * 3600 * 1000)
    const pageSize = Math.min(500, o.abandonedCart.maxPerRun * 3)
    const run: AbandonedRun = { checked: 0, sent: 0, skipped: 0, failed: 0, off: false }
    const seen = new Set<string>()
    /* Only carts with an address, page after page, until the run has sent its share or the window ends. */
    for (let page = 0; page < MAX_PAGES && run.sent < o.abandonedCart.maxPerRun; page++) {
      const carts = await graphList<CartRecord>(
        scope,
        "cart",
        CART_FIELDS,
        CART_OPTIONAL_FIELDS,
        { completed_at: null, email: { $ne: null }, updated_at: { $lt: before, $gt: after } },
        { take: pageSize, skip: page * pageSize, order: { updated_at: "DESC" } },
      )
      run.checked += carts.length
      const candidates = carts.filter((c) => usable(c) && !seen.has(c.id))
      for (const c of candidates) seen.add(c.id)
      const done = await storeFor(scope)
        .existingKeys(
          candidates.map((c) => eventKey(TEMPLATES.cartAbandoned, c.id)),
          o.demo,
        )
        .catch(() => new Set<string>())
      for (const cart of candidates) {
        if (run.sent >= o.abandonedCart.maxPerRun) break
        if (done.has(eventKey(TEMPLATES.cartAbandoned, cart.id))) {
          run.skipped += 1
          continue
        }
        const r = await sendAbandonedCart(scope, cart)
        if (r.status === "sent") run.sent += 1
        else if (r.status === "failed") run.failed += 1
        else run.skipped += 1
      }
      if (carts.length < pageSize) break
    }
    if (run.sent > 0 || run.failed > 0) svc.getLogger().info(`[emails] Abandoned carts: ${run.sent} reminders, ${run.failed} failed, ${run.checked} carts checked.`)
    return run
  })
}
