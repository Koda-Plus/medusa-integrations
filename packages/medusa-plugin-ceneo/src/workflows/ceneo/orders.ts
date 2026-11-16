/**
 * KUP TERAZ, READ SIDE: the sync of Ceneo orders into `ceneo_order`, the
 * order detail for the admin and the API check. Nothing here writes to
 * Ceneo or creates a Medusa order (stage 6).
 *
 * Every run reads the orders of the last ORDERS_WINDOW_DAYS days (Ceneo
 * caches answers for 5 minutes and has no change feed), so a state change
 * of an open order arrives within one run. Items are fetched once, for a
 * new order; matching runs again on every read, so an item matched later
 * (the offer was built after the order) gets its variant.
 */

import { CeneoApiError, CeneoClient } from "../../modules/ceneo/lib/ceneo-client"
import { ORDERS_ITEMS_PER_RUN, ORDERS_MAX_PAGES, ORDERS_WINDOW_DAYS } from "../../modules/ceneo/lib/constants"
import type { ApiCheckResult, OrderSyncResult } from "../../modules/ceneo/lib/contract"
import { demoTransport, type DemoOffer } from "../../modules/ceneo/lib/demo-ceneo"
import { limitsOf, liveTransport, orderChanged, toOrderRow, type CeneoDictEntry, type CeneoItemRaw, type CeneoOrderRaw, type CeneoTransport, type OrderItemRow } from "../../modules/ceneo/lib/kup-teraz"
import { ceneoSvc, type CeneoServiceLike } from "../../modules/ceneo/lib/store"
import { chunks, errorText, withLock, type Scope } from "./runtime"

export const ORDER_FIELDS = [
  "id",
  "ceneo_order_id",
  "displayed_order_id",
  "shop_order_id",
  "state_id",
  "ordered_at",
  "amounts",
  "delivery_form",
  "payment_type_id",
  "payment_method_id",
  "items",
  "matched",
  "problems",
  "medusa_order_id",
  "demo",
  "synced_at",
]

/** The transport for the options: demo, live with the API key, or none. */
export async function transportOf(svc: CeneoServiceLike): Promise<CeneoTransport | null> {
  const o = svc.getOptions()
  if (o.demo) {
    const rows = await svc.listCeneoOffers({ retired_at: null, in_feed: true }, { take: 200, select: ["offer_id", "title", "price"], order: { offer_id: "ASC" } })
    const offers: DemoOffer[] = []
    for (const r of rows) {
      const amount = (r.price as { amount?: unknown } | null)?.amount
      if (typeof r.offer_id === "string" && typeof amount === "number") offers.push({ offerId: r.offer_id, title: String(r.title ?? r.offer_id), price: amount })
    }
    return demoTransport(offers)
  }
  if (!o.apiKey) return null
  return liveTransport(new CeneoClient({ apiKey: o.apiKey, timeoutMs: o.timeoutMs, logger: svc.getLogger() }))
}

/* The state dictionary, once an hour per process (a failure: 5 minutes). */
type StatesCache = { at: number; demo: boolean; states: CeneoDictEntry[] }
const STATES = Symbol.for("koda.ceneo.states")

export async function orderStates(t: CeneoTransport, now = Date.now()): Promise<CeneoDictEntry[]> {
  const h = globalThis as typeof globalThis & { [STATES]?: StatesCache }
  const hit = h[STATES]
  if (hit && hit.demo === t.demo && now - hit.at < (hit.states.length > 0 ? 3_600_000 : 300_000)) return hit.states
  try {
    const states = await t.states()
    h[STATES] = { at: now, demo: t.demo, states }
    return states
  } catch {
    /* Remembered as empty for 5 minutes: a page view never waits on a Ceneo that does not answer. */
    h[STATES] = { at: now, demo: t.demo, states: [] }
    return []
  }
}

function storedItems(v: unknown): CeneoItemRaw[] {
  if (!Array.isArray(v)) return []
  return (v as OrderItemRow[]).map((i) => ({ ShopProductId: i.shop_product_id, Name: i.name, Price: i.price, Count: i.quantity, TotalItemPrice: i.total, Returned: i.returned }))
}

/** Offer id to variant, retired rows included (an order may name an id the variant used before). */
async function variantsByOfferId(svc: CeneoServiceLike, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  for (const part of chunks([...new Set(ids)], 200)) {
    const rows = await svc.listCeneoOffers({ offer_id: part }, { take: null, select: ["offer_id", "variant_id", "retired_at"] })
    /* The active row (retired_at null) wins over an old one. */
    for (const r of rows) if (typeof r.offer_id === "string" && typeof r.variant_id === "string" && (!out.has(r.offer_id) || r.retired_at === null)) out.set(r.offer_id, r.variant_id)
  }
  return out
}

export async function runCeneoOrderSync(scope: Scope, input: { trigger?: string; now?: number } = {}): Promise<OrderSyncResult> {
  const svc = ceneoSvc(scope)
  const trigger = input.trigger ?? "schedule"
  const transport = await transportOf(svc)
  if (!transport) return { status: "off", reason: "missing_key" }
  const result = await withLock("orders", async (): Promise<OrderSyncResult> => {
    const started = Date.now()
    const now = input.now ?? started
    try {
      const from = new Date(now - ORDERS_WINDOW_DAYS * 86_400_000)
      const read: CeneoOrderRaw[] = []
      const seen = new Set<string>()
      let truncated = false
      for (let page = 0; ; page += 1) {
        if (page >= ORDERS_MAX_PAGES) {
          truncated = true
          break
        }
        const batch = await transport.orders({ createdFrom: from }, read.length)
        const fresh = batch.filter((o) => !seen.has(o.Id))
        /* A service that ignores $skip would send the first page forever. */
        if (fresh.length === 0) break
        for (const o of fresh) {
          seen.add(o.Id)
          read.push(o)
        }
      }

      const states = await orderStates(transport)
      const known = states.length > 0 ? new Set(states.map((x) => x.id)) : null
      const at = new Date(now)
      let created = 0
      let updated = 0
      let unmatched = 0
      let deferred = 0
      let budget = ORDERS_ITEMS_PER_RUN

      /* Chunk by chunk, oldest first: what was read is written before the next chunk asks Ceneo. */
      for (const part of chunks(read, 25)) {
        const existing = new Map<string, Record<string, unknown>>()
        for (const r of await svc.listCeneoOrders({ ceneo_order_id: part.map((o) => o.Id) }, { take: null, select: ORDER_FIELDS })) existing.set(String(r.ceneo_order_id), r)
        const items = new Map<string, CeneoItemRaw[]>()
        for (const o of part) {
          const prev = existing.get(o.Id)
          /* Items again when the state moved: a return or an edit shows there. */
          const fetch = !prev || prev.state_id !== (o.OrderStateId ?? null)
          if (fetch && budget > 0) {
            budget -= 1
            items.set(o.Id, await transport.items(o.Id))
          } else if (prev) items.set(o.Id, storedItems(prev.items))
          else deferred += 1
        }
        const variants = await variantsByOfferId(svc, [...items.values()].flat().map((i) => i.ShopProductId).filter((v): v is string => typeof v === "string"))
        const create: Record<string, unknown>[] = []
        const update: Record<string, unknown>[] = []
        for (const o of part) {
          const its = items.get(o.Id)
          if (!its) continue
          const row = toOrderRow(o, its, (id) => variants.get(id) ?? null, known, transport.demo)
          if (!row.matched) unmatched += 1
          const prev = existing.get(o.Id)
          if (!prev) create.push({ ...row, synced_at: at })
          else if (orderChanged(prev, row)) update.push({ id: prev.id, ...row, synced_at: at })
        }
        if (create.length > 0) {
          try {
            await svc.createCeneoOrders(create)
          } catch {
            /* Another process wrote some of them meanwhile: one by one, the existing ones become updates. */
            for (const row of create) {
              const [now2] = await svc.listCeneoOrders({ ceneo_order_id: row.ceneo_order_id }, { take: 1, select: ["id"] })
              if (now2) await svc.updateCeneoOrders([{ ...row, id: now2.id }])
              else await svc.createCeneoOrders([row])
            }
          }
        }
        if (update.length > 0) await svc.updateCeneoOrders(update)
        created += create.length
        updated += update.length
      }
      const out: OrderSyncResult = { status: "synced", read: read.length, created, updated, unmatched, deferred, truncated, demo: transport.demo, duration_ms: Date.now() - started }
      if (created > 0 || updated > 0 || truncated || deferred > 0) {
        svc.getLogger().info(`[ceneo] Kup Teraz (${trigger}): ${out.read} orders read, ${out.created} new, ${out.updated} changed, ${unmatched} with unmatched items${deferred > 0 ? `, ${deferred} left for the next run` : ""}${truncated ? `, stopped after ${ORDERS_MAX_PAGES} pages` : ""}.`)
      }
      return out
    } catch (err) {
      const error = errorText(err)
      svc.getLogger().warn(`[ceneo] Kup Teraz sync failed (${trigger}): ${error}`)
      return { status: "failed", error, status_code: err instanceof CeneoApiError ? err.status : null, duration_ms: Date.now() - started }
    }
  })
  return result ?? { status: "skipped", reason: "running" }
}

/** Token and limits: proof the key works, and how much is left. */
export async function checkCeneoApi(scope: Scope): Promise<ApiCheckResult> {
  const svc = ceneoSvc(scope)
  const o = svc.getOptions()
  if (o.demo) return { ok: true, mode: "demo", limits: [] }
  if (!o.apiKey) return { ok: false, mode: "missing_key", error: "No apiKey in the plugin options." }
  const client = new CeneoClient({ apiKey: o.apiKey, timeoutMs: o.timeoutMs, logger: svc.getLogger() })
  try {
    await client.token(true)
  } catch (err) {
    return { ok: false, mode: "live", error: errorText(err), status_code: err instanceof CeneoApiError ? err.status : null }
  }
  try {
    return { ok: true, mode: "live", limits: limitsOf(await client.limits()) }
  } catch (err) {
    return { ok: true, mode: "live", limits: [], limitsError: errorText(err) }
  }
}
