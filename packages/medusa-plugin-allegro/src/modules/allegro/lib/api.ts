/**
 * THE READS OF 0.2, one function per Allegro resource. Each one goes through
 * `apiGet` (token, refresh on 401, retries, rate limit, read-only barrier)
 * and returns the raw JSON; the parsers live next to the features. Every
 * path, parameter and media type here is verified in the official OpenAPI
 * file (see docs/allegro-api-notes.md).
 */

import type AllegroModuleService from "../service"
import { apiGet } from "./connection"
import { BETA_MEDIA_TYPE, EVENTS_PAGE_SIZE, ORDERS_PAGE_SIZE, REREAD_CHUNK } from "./constants"
import { offersFromApi, type AllegroOfferInput } from "./offers"

/** `GET /order/events?from=` : events after the given id, oldest first. */
export function getOrderEvents(svc: AllegroModuleService, from: string | null, limit = EVENTS_PAGE_SIZE): Promise<unknown> {
  const query: Record<string, string> = { limit: String(limit) }
  if (from) query.from = from
  return apiGet<unknown>(svc, "/order/events", query)
}

/** `GET /order/event-stats` : the newest event, the starting point of a fresh reader. */
export function getOrderEventStats(svc: AllegroModuleService): Promise<unknown> {
  return apiGet<unknown>(svc, "/order/event-stats", {})
}

/** `GET /order/checkout-forms/{id}` */
export function getCheckoutForm(svc: AllegroModuleService, id: string): Promise<unknown> {
  return apiGet<unknown>(svc, `/order/checkout-forms/${encodeURIComponent(id)}`, {})
}

/** One page of `GET /order/checkout-forms` by purchase date, for the operator import window. */
export function getCheckoutFormsByPurchase(
  svc: AllegroModuleService,
  from: Date,
  to: Date,
  offset: number,
): Promise<{ checkoutForms?: unknown[]; totalCount?: number }> {
  return apiGet(svc, "/order/checkout-forms", {
    "lineItems.boughtAt.gte": from.toISOString(),
    "lineItems.boughtAt.lte": to.toISOString(),
    status: "READY_FOR_PROCESSING",
    limit: String(ORDERS_PAGE_SIZE),
    offset: String(offset),
  })
}

/** `GET /order/checkout-forms/{id}/shipments` : parcels already on the order (also those added in the seller panel). */
export function getShipments(svc: AllegroModuleService, checkoutFormId: string): Promise<unknown> {
  return apiGet<unknown>(svc, `/order/checkout-forms/${encodeURIComponent(checkoutFormId)}/shipments`, {})
}

/** `GET /order/checkout-forms/{id}/invoices` : invoices already on the order. */
export function getInvoices(svc: AllegroModuleService, checkoutFormId: string): Promise<unknown> {
  return apiGet<unknown>(svc, `/order/checkout-forms/${encodeURIComponent(checkoutFormId)}/invoices`, {})
}

/** `GET /order/carriers` : carrier ids for parcels. */
export function getCarriers(svc: AllegroModuleService): Promise<unknown> {
  return apiGet<unknown>(svc, "/order/carriers", {})
}

/** `GET /order/customer-returns` (beta). */
export function getCustomerReturns(svc: AllegroModuleService, since: Date, offset: number, limit = 100): Promise<unknown> {
  return apiGet<unknown>(
    svc,
    "/order/customer-returns",
    { "createdAt.gte": since.toISOString(), limit: String(limit), offset: String(offset) },
    BETA_MEDIA_TYPE,
  )
}

/** `GET /sale/issues` (beta): disputes and claims, newest first. */
export function getIssues(svc: AllegroModuleService, offset: number, limit = 100): Promise<unknown> {
  return apiGet<unknown>(svc, "/sale/issues", { limit: String(limit), offset: String(offset) }, BETA_MEDIA_TYPE)
}

/** `GET /messaging/threads` : 20 threads per page, newest message first. */
export function getThreads(svc: AllegroModuleService, offset: number): Promise<unknown> {
  return apiGet<unknown>(svc, "/messaging/threads", { limit: "20", offset: String(offset) })
}

/** `GET /sale/products?phrase={ean}&mode=GTIN` : catalog products with this EAN. */
export function searchProductsByEan(svc: AllegroModuleService, ean: string): Promise<unknown> {
  return apiGet<unknown>(svc, "/sale/products", { phrase: ean, mode: "GTIN", language: "pl-PL" })
}

/**
 * Fresh state of the given offers, by `offer.id` (an array filter of
 * `GET /sale/offers`). Read right before a command, so a quantity or a price
 * that changed since the plan is planned again instead of overwritten.
 * Offers missing from the answer are simply missing: never assumed ended.
 */
export async function readOffersByIds(svc: AllegroModuleService, ids: readonly string[]): Promise<Map<string, AllegroOfferInput>> {
  const out = new Map<string, AllegroOfferInput>()
  for (let i = 0; i < ids.length; i += REREAD_CHUNK) {
    const chunk = ids.slice(i, i + REREAD_CHUNK)
    const res = await apiGet<{ offers?: unknown[] }>(svc, "/sale/offers", { "offer.id": [...chunk], limit: String(chunk.length) })
    for (const o of offersFromApi(Array.isArray(res.offers) ? res.offers : []).offers) out.set(o.allegroId, o)
  }
  return out
}
