/**
 * ZAUFANE OPINIE ON THE SERVER: the consent row per cart and the
 * transaction payload for the order of a cart.
 */

import { CONSENT_KEEP_DAYS } from "../../modules/ceneo/lib/constants"
import type { CeneoTransactionResponse } from "../../modules/ceneo/lib/contract"
import { ceneoSvc, type CeneoServiceLike, type Row } from "../../modules/ceneo/lib/store"
import { buildTransaction, type OrderItemLite, type OrderLite, type TransactionResult } from "../../modules/ceneo/lib/transaction"
import { chunks, errorText, queryOf, type Scope } from "./runtime"

const CONSENT_FIELDS = ["id", "cart_id", "survey", "answered_at", "order_id", "transaction_at"]
const ORDER_FIELDS = ["id", "display_id", "email", "currency_code", "total", "created_at", "canceled_at", "status", "items.variant_id", "items.variant_sku", "items.quantity", "items.total"]

async function consentOf(svc: CeneoServiceLike, cartId: string): Promise<Row | undefined> {
  const [row] = await svc.listCeneoConsents({ cart_id: cartId }, { take: 1, select: CONSENT_FIELDS })
  return row
}

/** Writes the answer; a second request for the same cart at the same moment updates instead of failing. */
export async function saveConsent(svc: CeneoServiceLike, cartId: string, data: Record<string, unknown>): Promise<void> {
  const row = await consentOf(svc, cartId)
  if (row) {
    await svc.updateCeneoConsents([{ id: row.id, ...data }])
    return
  }
  try {
    await svc.createCeneoConsents([{ cart_id: cartId, ...data }])
  } catch (err) {
    const again = await consentOf(svc, cartId)
    if (!again) throw err
    await svc.updateCeneoConsents([{ id: again.id, ...data }])
  }
}

export async function cartExists(scope: Scope, cartId: string): Promise<boolean> {
  const { data } = await queryOf(scope).graph({ entity: "cart", fields: ["id"], filters: { id: cartId } })
  return data.length > 0
}

export type TransactionLookup = { ok: true; body: CeneoTransactionResponse } | { ok: false; status: number; code: string; message: string }

/**
 * The payload for the order placed from `cartId`. The cart id is the
 * shopper's secret (only their browser has it), so the route needs no
 * login; the payload has the e-mail only with their survey consent.
 */
export async function transactionForCart(scope: Scope, cartId: string, now = Date.now()): Promise<TransactionLookup> {
  const svc = ceneoSvc(scope)
  const o = svc.getOptions()
  const guid = o.reviews.accountGuid
  if (!guid) return { ok: false, status: 404, code: "reviews_off", message: "Zaufane Opinie are not configured (reviews.accountGuid)." }
  const query = queryOf(scope)
  const { data: links } = await query.graph({ entity: "order_cart", fields: ["order_id"], filters: { cart_id: cartId } })
  const orderId = (links[0] as { order_id?: unknown } | undefined)?.order_id
  if (typeof orderId !== "string") return { ok: false, status: 404, code: "order_not_found", message: "No order was placed from this cart (yet)." }
  const { data: orders } = await query.graph({ entity: "order", fields: ORDER_FIELDS, filters: { id: orderId } })
  const order = orders[0] as OrderLite | undefined
  if (!order) return { ok: false, status: 404, code: "order_not_found", message: "No order was placed from this cart (yet)." }

  const variantIds = [...new Set((order.items ?? []).map((i) => i?.variant_id).filter((v): v is string => typeof v === "string"))]
  const offerIds = new Map<string, string>()
  for (const part of chunks(variantIds, 200)) {
    const rows = await svc.listCeneoOffers({ variant_id: part, retired_at: null }, { take: null, select: ["variant_id", "offer_id"] })
    for (const r of rows) if (typeof r.variant_id === "string" && typeof r.offer_id === "string") offerIds.set(r.variant_id, r.offer_id)
  }
  /* A variant never built into the feed: the id the feed would give it. */
  const offerIdOf = (item: OrderItemLite): string | null => {
    if (!item.variant_id) return null
    return offerIds.get(item.variant_id) ?? (o.feed.offerId === "sku" ? (item.variant_sku ?? null) : item.variant_id)
  }

  const consent = await consentOf(svc, cartId)
  const survey = consent?.survey === true
  const result: TransactionResult = buildTransaction({ order, offerIdOf, survey, workDays: o.reviews.workDays, now })
  if (!result.ok) {
    const message = result.code === "order_canceled" ? "The order was canceled." : result.code === "order_expired" ? "The transaction is given only within 24 hours after the order." : "The order has no products Ceneo can match."
    return { ok: false, status: result.code === "order_empty" ? 404 : 410, code: result.code, message }
  }
  if (!consent?.transaction_at) {
    try {
      await saveConsent(svc, cartId, { order_id: order.id, transaction_at: new Date(now), ...(consent ? {} : { survey: false }) })
    } catch (err) {
      svc.getLogger().warn(`[ceneo] Could not note the Zaufane Opinie transaction of order ${order.id}: ${errorText(err)}`)
    }
  }
  return { ok: true, body: { account_guid: guid, order_id: order.id, survey, transaction: result.transaction } }
}

/** Removes consent rows older than CONSENT_KEEP_DAYS; returns how many. */
export async function pruneConsents(scope: Scope, now = Date.now()): Promise<number> {
  const svc = ceneoSvc(scope)
  const before = new Date(now - CONSENT_KEEP_DAYS * 24 * 60 * 60 * 1000)
  const rows = await svc.listCeneoConsents({ created_at: { $lt: before } }, { take: 5000, select: ["id"] })
  for (const part of chunks(rows.map((r) => r.id), 500)) await svc.deleteCeneoConsents(part)
  return rows.length
}
