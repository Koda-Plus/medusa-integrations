/**
 * MARKETPLACE ORDERS FROM BASELINKER INTO MEDUSA, EXACTLY ONCE.
 *
 * DISCOVERY (always, while sources are configured): orders confirmed since
 * the cursor are read with `getOrders` (`date_confirmed_from`, confirmed
 * orders only, 100 per page), filtered by `lib/order-import.ts` (selected
 * sources, never our own exports) and written as `pending` rows, one per
 * BaseLinker order id. The admin shows them before anything is created: the
 * plan of the orders.
 *
 * IMPORT (only while the `orderImport` writer is armed), per row, holding a
 * lock on the BaseLinker id:
 *   1. the row's next attempt moves ten minutes ahead first (a dead process
 *      leaves a row that comes back by itself);
 *   2. an order older than `orderImportMaxAgeHours` is skipped, not imported;
 *   3. the order is read again from BaseLinker (the buyer's data is never
 *      stored by the plugin, only on the Medusa order);
 *   4. LOOKUPS BEFORE CREATE: a Medusa order with this BaseLinker id is
 *      adopted; a Medusa order with the same `marketplace_order_ref` (taken
 *      by another plugin) makes this one `skipped`;
 *   5. created as a draft with Medusa's own `createOrderWorkflow`, and the id
 *      is stored at once; then placed with `convertDraftOrderWorkflow`, which
 *      reserves the inventory and emits `order.placed`;
 *   6. a payment collection for the total, marked paid through Medusa's
 *      `markPaymentCollectionAsPaid` when BaseLinker has it paid in full.
 *
 * WHY THESE WORKFLOWS (Medusa 2.12 to 2.15, checked in core-flows 2.15.3):
 * `createOrderWorkflow` is documented for exactly this ("a workflow that
 * imports orders from an external system"): it takes our own unit prices
 * (`unit_price` with `is_tax_inclusive`, BaseLinker prices are gross),
 * confirms the inventory, computes tax lines from the region and keeps the
 * shipping method we give it. It does not reserve inventory and emits no
 * event, so the order is created as a draft and placed by
 * `convertDraftOrderWorkflow`, which is what the Medusa admin does with draft
 * orders: reservations through `reserveInventoryStep`, then `order.placed`.
 * The cart path (`completeCartWorkflow`) would need a payment session and
 * shipping options the marketplace order never had.
 *
 * `order.placed` is emitted for imported orders on purpose: invoices, ERP
 * documents and stock follow-ups of the store should see them. Imported
 * orders carry `no_notification: true` and `metadata.marketplace_order_ref`;
 * the store's own confirmation e-mail must skip such orders (the marketplace
 * talks to its buyer). Our own export never sends them back.
 */

import {
  cancelOrderWorkflow,
  convertDraftOrderWorkflow,
  createOrderFulfillmentWorkflow,
  createOrderPaymentCollectionWorkflow,
  createOrderWorkflow,
  markPaymentCollectionAsPaid,
} from "@medusajs/medusa/core-flows"
import type { IOrderModuleService } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import type BaseLinkerModuleService from "../../modules/baselinker/service"
import { planRetry } from "../../modules/baselinker/lib/backoff"
import {
  BACKOFF_SECONDS,
  IMPORT_FIRST_LOOKBACK_HOURS,
  IMPORT_LEASE_MS,
  IMPORT_PAGES_PER_PASS,
  IMPORTS_PER_PASS,
  MAX_ATTEMPTS,
  ORDER_METADATA,
  ORDERS_PAGE_SIZE,
  PLUGIN_EVENTS,
  STATUS_WINDOW_DAYS,
  STATUSES_PER_PASS,
} from "../../modules/baselinker/lib/constants"
import type { RunTrigger } from "../../modules/baselinker/lib/contract"
import { DEMO_SOURCE_ACCOUNTS, DEMO_STATUSES, DEMO_PRICE_GROUP } from "../../modules/baselinker/lib/demo"
import { demoMarketplaceOrderById, demoMarketplaceOrders, type DemoSellable } from "../../modules/baselinker/lib/demo-marketplace"
import { toMinor, type ImportRow, type OrderRow } from "../../modules/baselinker/lib/dto"
import { describeAnyError } from "../../modules/baselinker/lib/errors"
import { round, toNumber, toNumberOrNull } from "../../modules/baselinker/lib/numbers"
import { canImportOrders, type OrderSourceRule, type ResolvedBaseLinkerOptions } from "../../modules/baselinker/lib/options"
import {
  cancelDecision,
  ImportMappingError,
  importVerdict,
  mapOrder,
  marketplaceRef,
  nextCursor,
  orderLines,
  orderTotal,
  paymentState,
  tooOld,
  unseen,
  type BlOrder,
  type ImportCursor,
} from "../../modules/baselinker/lib/order-import"
import { carrierName, trackingUrl } from "../../modules/baselinker/lib/tracking"
import { writerState } from "../../modules/baselinker/lib/writers"
import { loadOrderHead } from "./orders"
import { orderCartId } from "./order-facts"
import { baselinkerService, clientFor, emitEvent, exclusive, patchOrderMetadata, queryOf, recordRun, withLock, type Scope } from "./runtime"
import { loadWriters, readSetting, writeSetting } from "./settings"

export const ORDERS_CURSOR = "cursor:orders"

/* ------------------------------------------------------------------ */
/* Options as the import uses them (the demo has its own sources)      */
/* ------------------------------------------------------------------ */

export function importRules(o: ResolvedBaseLinkerOptions): OrderSourceRule[] {
  if (o.orderImportSources.length > 0) return o.orderImportSources
  return o.demo
    ? [
        { type: "allegro", id: null },
        { type: "amazon", id: null },
      ]
    : []
}

export function importCancelIds(o: ResolvedBaseLinkerOptions): number[] {
  if (o.orderImportCancelStatusIds.length > 0) return o.orderImportCancelStatusIds
  return o.demo ? [DEMO_STATUSES[4].id] : []
}

function customSource(o: ResolvedBaseLinkerOptions): number | null {
  return o.customSourceId ?? (o.demo ? DEMO_SOURCE_ACCOUNTS.medusa : null)
}

/* ------------------------------------------------------------------ */
/* Rows                                                                */
/* ------------------------------------------------------------------ */

async function updateImport(svc: BaseLinkerModuleService, id: string, patch: Record<string, unknown>): Promise<void> {
  await svc.updateBaseLinkerImports({ id, ...patch } as never)
}

export async function findImportRow(svc: BaseLinkerModuleService, where: Record<string, unknown>): Promise<ImportRow | null> {
  const rows = (await svc.listBaseLinkerImports({ ...where, demo: svc.isDemo() } as never, { take: 1 } as never)) as unknown as ImportRow[]
  return rows[0] ?? null
}

/* ------------------------------------------------------------------ */
/* The simulated marketplaces                                          */
/* ------------------------------------------------------------------ */

function priceOf(price: unknown): number | null {
  if (!price || typeof price !== "object") return null
  const v = (price as Record<string, unknown>)[DEMO_PRICE_GROUP]
  return typeof v === "number" ? v : null
}

/** Cards the demo marketplaces sell: linked, conflict-free cards of the demo snapshot. */
async function demoSellables(svc: BaseLinkerModuleService): Promise<DemoSellable[]> {
  const rows = (await svc.listBaseLinkerProducts({ demo: true, conflict: null, variant_id: { $ne: null } } as never, {
    take: 60,
    order: { bl_product_id: "ASC" },
  } as never)) as unknown as Array<{ bl_product_id: string; sku: string | null; variant_sku: string | null; name: string; product_title: string | null; price: unknown }>
  return rows.map((r) => ({ blId: r.bl_product_id, sku: r.sku ?? r.variant_sku ?? r.bl_product_id, name: r.name || r.product_title || r.bl_product_id, price: priceOf(r.price) }))
}

/** Orders this plugin sent to the simulated account, as BaseLinker lists them (with our marker). */
async function demoOwnExports(svc: BaseLinkerModuleService, fromUnix: number): Promise<BlOrder[]> {
  const rows = (await svc.listBaseLinkerOrders({ demo: true, status: "sent" } as never, { take: 50, order: { sent_at: "DESC" } } as never)) as unknown as OrderRow[]
  return rows
    .filter((r) => r.bl_order_id && r.sent_at && new Date(r.sent_at).getTime() / 1000 >= fromUnix)
    .map((r) => ({
      order_id: Number(r.bl_order_id),
      order_source: "personal",
      order_source_id: DEMO_SOURCE_ACCOUNTS.medusa,
      confirmed: true,
      date_confirmed: Math.floor(new Date(r.sent_at as string).getTime() / 1000),
      admin_comments: `[medusa:${r.order_id}]`,
    }))
}

/** One BaseLinker order, read again (the plugin keeps no buyer data between runs). */
async function readBlOrder(svc: BaseLinkerModuleService, blOrderId: string): Promise<BlOrder | null> {
  if (svc.isDemo()) return demoMarketplaceOrderById(blOrderId, await demoSellables(svc), new Date())
  const orders = await clientFor(svc).getOrders({ order_id: Number(blOrderId), get_unconfirmed_orders: true })
  return (orders.find((x) => String(x.order_id) === String(blOrderId)) as BlOrder | undefined) ?? null
}

/* ------------------------------------------------------------------ */
/* Discovery                                                           */
/* ------------------------------------------------------------------ */

export interface DiscoverStats {
  pages: number
  read: number
  created: number
  known: number
  ownExport: number
  ownSource: number
  notSelected: number
  unconfirmed: number
}

async function discover(svc: BaseLinkerModuleService, stats: DiscoverStats): Promise<void> {
  const o = svc.getOptions()
  const rules = importRules(o)
  if (rules.length === 0) return
  const nowUnix = Math.floor(Date.now() / 1000)
  let cursor = (await readSetting<ImportCursor>(svc, ORDERS_CURSOR)) ?? {
    dateConfirmed: o.orderImportSince ?? nowUnix - IMPORT_FIRST_LOOKBACK_HOURS * 3600,
    seen: [],
  }
  const handle = async (page: BlOrder[]) => {
    for (const order of unseen(cursor, page)) {
      stats.read += 1
      const verdict = importVerdict(order, { rules, customSourceId: customSource(o) })
      if (!verdict.import) {
        if (verdict.reason === "own_export") stats.ownExport += 1
        else if (verdict.reason === "own_source") stats.ownSource += 1
        else if (verdict.reason === "unconfirmed") stats.unconfirmed += 1
        else stats.notSelected += 1
        continue
      }
      await upsertDiscovered(svc, order, stats)
    }
  }

  if (o.demo) {
    const now = new Date()
    const page = [...demoMarketplaceOrders({ now, days: 2, cards: await demoSellables(svc) }), ...(await demoOwnExports(svc, cursor.dateConfirmed))]
      .filter((x) => Number(x.date_confirmed) >= cursor.dateConfirmed)
      .sort((a, b) => Number(a.date_confirmed) - Number(b.date_confirmed))
    stats.pages = 1
    await handle(page)
    cursor = nextCursor(cursor, page, Number.MAX_SAFE_INTEGER).cursor
    await writeSetting(svc, ORDERS_CURSOR, cursor)
    return
  }

  const client = clientFor(svc)
  const single = rules.length === 1 ? rules[0] : null
  for (let p = 1; p <= IMPORT_PAGES_PER_PASS; p += 1) {
    const params: Record<string, unknown> = { date_confirmed_from: cursor.dateConfirmed, get_unconfirmed_orders: false }
    if (single) {
      params.filter_order_source = single.type
      if (single.id !== null) params.filter_order_source_id = single.id
    }
    const page = (await client.getOrders(params)) as BlOrder[]
    stats.pages += 1
    await handle(page)
    const next = nextCursor(cursor, page, ORDERS_PAGE_SIZE)
    cursor = next.cursor
    await writeSetting(svc, ORDERS_CURSOR, cursor)
    if (!next.more) break
  }
}

async function upsertDiscovered(svc: BaseLinkerModuleService, order: BlOrder, stats: DiscoverStats): Promise<void> {
  const blId = String(Number(order.order_id))
  const known = await findImportRow(svc, { bl_order_id: blId })
  if (known) {
    stats.known += 1
    return
  }
  const confirmed = toNumberOrNull(order.date_confirmed)
  try {
    await svc.createBaseLinkerImports({
      bl_order_id: blId,
      source: String(order.order_source ?? "").toLowerCase(),
      source_id: order.order_source_id !== undefined && order.order_source_id !== null ? String(order.order_source_id) : null,
      external_order_id: typeof order.external_order_id === "string" && order.external_order_id ? order.external_order_id : null,
      marketplace_ref: marketplaceRef(order),
      status: "pending",
      attempts: 0,
      next_attempt_at: new Date(),
      confirmed_at: confirmed ? new Date(confirmed * 1000) : null,
      total_minor: toMinor(orderTotal(order)),
      currency: String(order.currency ?? "").toUpperCase() || null,
      lines: orderLines(order).length,
      payment_state: null,
      bl_status_id: toNumberOrNull(order.order_status_id),
      demo: svc.isDemo(),
    } as never)
    stats.created += 1
  } catch {
    /* Another pass wrote it a moment ago: the unique index kept one row. */
    stats.known += 1
  }
}

/* ------------------------------------------------------------------ */
/* Medusa lookups                                                      */
/* ------------------------------------------------------------------ */

interface OrderHit {
  id: string
  display_id?: number | null
  status?: string | null
  metadata?: Record<string, unknown> | null
}

const SCAN_PAGE = 200
const SCAN_MAX = 5000

/**
 * Medusa orders whose `metadata[key]` equals `value` (case-insensitive).
 * First a JSON filter, verified in code; when the filter fails or is ignored,
 * a scan of the orders created since `sinceUnix`. A scan that hits its
 * ceiling without an answer throws: "not found" would mean "create it".
 */
export async function findOrdersByMetadata(scope: Scope, key: string, value: string, sinceUnix: number | null): Promise<OrderHit[]> {
  const query = queryOf(scope)
  const want = value.toLowerCase()
  const matches = (o: OrderHit) => String(o.metadata?.[key] ?? "").toLowerCase() === want
  try {
    const { data } = await query.graph({
      entity: "order",
      fields: ["id", "display_id", "status", "metadata"],
      filters: { metadata: { [key]: value } },
      pagination: { take: 5, skip: 0 },
    })
    const rows = data as OrderHit[]
    const hits = rows.filter(matches)
    if (hits.length > 0 || rows.length === 0) return hits
  } catch {
    /* fall through to the scan */
  }
  const since = new Date(Math.max(0, (sinceUnix ?? Math.floor(Date.now() / 1000)) - 14 * 24 * 3600) * 1000)
  const hits: OrderHit[] = []
  for (let skip = 0; skip < SCAN_MAX; skip += SCAN_PAGE) {
    const { data } = await query.graph({
      entity: "order",
      fields: ["id", "display_id", "status", "metadata"],
      filters: { created_at: { $gte: since } },
      pagination: { take: SCAN_PAGE, skip, order: { created_at: "ASC" } },
    })
    hits.push(...(data as OrderHit[]).filter(matches))
    if (data.length < SCAN_PAGE) return hits
  }
  if (hits.length > 0) return hits
  throw Object.assign(new Error(`Could not settle whether a Medusa order already has ${key} ${value}: more than ${SCAN_MAX} orders to scan. Nothing was created.`), {
    code: "lookup_ceiling",
    retryable: true,
  })
}

/**
 * The Medusa order an earlier attempt of THIS row created (the recovery after
 * a crash between creating the order and storing its id). A hit by the
 * BaseLinker number counts only when it carries this row's id
 * (`metadata.baselinker_import_id`, a plugin id nobody can guess) or was
 * created by backend code (no cart): a shopper who copies a BaseLinker number
 * into cart metadata takes nothing over.
 */
async function findImportedOrder(scope: Scope, row: ImportRow, sinceUnix: number | null): Promise<OrderHit | null> {
  const hits = await findOrdersByMetadata(scope, ORDER_METADATA.orderId, row.bl_order_id, sinceUnix)
  for (const h of hits) {
    const imported = h.metadata?.[ORDER_METADATA.imported] === true || h.metadata?.[ORDER_METADATA.imported] === "true"
    if (!imported) continue
    if (h.metadata?.[ORDER_METADATA.importId] === row.id) return h
    if ((await orderCartId(scope, h.id)) === null) return h
  }
  return null
}

/**
 * A Medusa order that already holds this marketplace reference, written by
 * backend code (another marketplace plugin, or this one). A reference on an
 * order placed from a cart came from a shopper and blocks nothing.
 */
async function orderWithRef(scope: Scope, ref: string, sinceUnix: number | null): Promise<OrderHit | null> {
  for (const h of await findOrdersByMetadata(scope, ORDER_METADATA.marketplaceRef, ref, sinceUnix)) {
    if (typeof (await orderCartId(scope, h.id)) !== "string") return h
  }
  return null
}

/* ------------------------------------------------------------------ */
/* Context of the Medusa order                                         */
/* ------------------------------------------------------------------ */

async function regionFor(scope: Scope, configured: string, currency: string): Promise<string> {
  if (configured) return configured
  const { data } = await queryOf(scope).graph({ entity: "region", fields: ["id", "currency_code"], filters: { currency_code: currency.toLowerCase() } })
  const region = (data as Array<{ id: string }>)[0]
  if (!region) {
    throw new ImportMappingError("no_region", `No Medusa region uses ${currency.toUpperCase()}: create one, or set orderImportRegionId.`)
  }
  return region.id
}

async function salesChannelFor(scope: Scope, configured: string): Promise<string | null> {
  if (configured) return configured
  try {
    const { data } = await queryOf(scope).graph({ entity: "store", fields: ["id", "default_sales_channel_id"], pagination: { take: 1, skip: 0 } })
    return ((data[0] as { default_sales_channel_id?: string | null } | undefined)?.default_sales_channel_id ?? null) || null
  } catch {
    return null
  }
}

/** Card links of the order's lines: BaseLinker card id to Medusa variant id. */
async function linksFor(svc: BaseLinkerModuleService, order: BlOrder): Promise<Map<string, string>> {
  const ids = new Set<string>()
  for (const l of orderLines(order)) {
    for (const v of [l.product_id, l.variant_id]) {
      const t = String(v ?? "").trim()
      if (/^\d+$/.test(t) && Number(t) > 0) ids.add(String(Number(t)))
    }
  }
  const out = new Map<string, string>()
  if (ids.size === 0) return out
  const rows = (await svc.listBaseLinkerProducts({ bl_product_id: [...ids], demo: svc.isDemo() } as never, { take: ids.size * 2 } as never)) as unknown as Array<{
    bl_product_id: string
    variant_id: string | null
    conflict: string | null
  }>
  for (const r of rows) if (r.variant_id && !r.conflict) out.set(r.bl_product_id, r.variant_id)
  return out
}

/* ------------------------------------------------------------------ */
/* Medusa's order workflows, behind one seam                           */
/* ------------------------------------------------------------------ */

interface CollectionRecord {
  id: string
  status?: string | null
}

/**
 * Every write the import makes in Medusa, each one Medusa's own workflow (or
 * module call). Kept in one object so the unit tests can stand in for
 * Medusa; production never replaces it.
 */
export interface OrderOps {
  create(scope: Scope, input: Record<string, unknown>): Promise<{ id: string; display_id?: number | null }>
  setEmail(scope: Scope, orderId: string, email: string): Promise<void>
  place(scope: Scope, orderId: string): Promise<void>
  paymentCollections(scope: Scope, orderId: string): Promise<CollectionRecord[]>
  createPaymentCollection(scope: Scope, orderId: string, amount: number): Promise<CollectionRecord>
  markPaid(scope: Scope, orderId: string, paymentCollectionId: string): Promise<void>
  cancel(scope: Scope, orderId: string): Promise<void>
  fulfill(scope: Scope, orderId: string, items: Array<{ id: string; quantity: number }>, blOrderId: string): Promise<void>
}

const medusaOps: OrderOps = {
  async create(scope, input) {
    const { result } = await createOrderWorkflow(scope as never).run({ input: input as never })
    return result as unknown as { id: string; display_id?: number | null }
  },
  async setEmail(scope, orderId, email) {
    const orders = (scope as { resolve<T>(k: string): T }).resolve<IOrderModuleService>(Modules.ORDER)
    await orders.updateOrders(orderId, { email })
  },
  async place(scope, orderId) {
    await convertDraftOrderWorkflow(scope as never).run({ input: { id: orderId } })
  },
  async paymentCollections(scope, orderId) {
    const { data } = await queryOf(scope).graph({ entity: "order", fields: ["id", "payment_collections.id", "payment_collections.status"], filters: { id: orderId } })
    return ((data[0] as { payment_collections?: CollectionRecord[] | null } | undefined)?.payment_collections ?? []).filter(Boolean)
  },
  async createPaymentCollection(scope, orderId, amount) {
    const { result } = await createOrderPaymentCollectionWorkflow(scope as never).run({ input: { order_id: orderId, amount } })
    return (result as CollectionRecord[])[0]
  },
  async markPaid(scope, orderId, paymentCollectionId) {
    await markPaymentCollectionAsPaid(scope as never).run({ input: { order_id: orderId, payment_collection_id: paymentCollectionId } })
  },
  async cancel(scope, orderId) {
    await cancelOrderWorkflow(scope as never).run({ input: { order_id: orderId, no_notification: true } })
  },
  async fulfill(scope, orderId, items, blOrderId) {
    await createOrderFulfillmentWorkflow(scope as never).run({
      input: { order_id: orderId, items, no_notification: true, metadata: { source: "baselinker", baselinker_order_id: blOrderId } },
    })
  },
}

let ops: OrderOps = medusaOps

/** Tests only: stand in for Medusa's order workflows (null restores them). */
export function setOrderOpsForTests(replacement: Partial<OrderOps> | null): void {
  ops = replacement ? { ...medusaOps, ...replacement } : medusaOps
}

/** One payment collection for the total; marked paid when BaseLinker has the order paid in full. Never twice. */
async function recordPayment(scope: Scope, orderId: string, total: number, state: string): Promise<void> {
  let collection = (await ops.paymentCollections(scope, orderId))[0]
  if (!collection) collection = await ops.createPaymentCollection(scope, orderId, total)
  if (state === "paid" && collection && (collection.status ?? "not_paid") === "not_paid") {
    await ops.markPaid(scope, orderId, collection.id)
  }
}

/* ------------------------------------------------------------------ */
/* One order                                                           */
/* ------------------------------------------------------------------ */

export interface ImportOutcome {
  status: "imported" | "adopted" | "skipped" | "retry" | "failed" | "busy"
  blOrderId: string
  orderId: string | null
  code: string | null
  message: string | null
}

async function skip(svc: BaseLinkerModuleService, row: ImportRow, code: string, message: string): Promise<ImportOutcome> {
  await updateImport(svc, row.id, { status: "skipped", next_attempt_at: null, last_error: message, last_error_code: code })
  return { status: "skipped", blOrderId: row.bl_order_id, orderId: row.order_id, code, message }
}

async function importOne(scope: Scope, row: ImportRow, opts: { force?: boolean } = {}): Promise<ImportOutcome> {
  const svc = baselinkerService(scope)
  const o = svc.getOptions()
  const now = new Date()
  const attempts = (row.attempts ?? 0) + 1
  await updateImport(svc, row.id, { attempts, next_attempt_at: new Date(now.getTime() + IMPORT_LEASE_MS) })
  const confirmedUnix = row.confirmed_at ? Math.floor(new Date(row.confirmed_at).getTime() / 1000) : null
  let adopted = false

  try {
    if (!opts.force && !row.order_id && tooOld(confirmedUnix, o.orderImportMaxAgeHours, now)) {
      return await skip(
        svc,
        row,
        "too_old",
        `Confirmed more than ${o.orderImportMaxAgeHours} hours before the import reached it, so it was not imported. Import it by hand (Retry) if this store still has to ship it.`,
      )
    }
    const order = await readBlOrder(svc, row.bl_order_id)
    if (!order) return await skip(svc, row, "not_in_baselinker", "BaseLinker no longer returns this order.")

    let orderId = row.order_id
    let displayId = row.display_id
    if (!orderId) {
      const existing = await findImportedOrder(scope, row, confirmedUnix)
      if (existing) {
        orderId = existing.id
        displayId = existing.display_id ?? null
        adopted = true
      }
    }
    if (!orderId) {
      const ref = marketplaceRef(order)
      const duplicateOf = async (): Promise<ImportOutcome | null> => {
        if (!ref) return null
        const other = await orderWithRef(scope, ref, confirmedUnix)
        if (!other) return null
        return skip(
          svc,
          row,
          "duplicate_marketplace_ref",
          `Medusa already has this marketplace order (${ref}) as #${other.display_id ?? other.id}, taken by another plugin or by hand. Not imported twice.`,
        )
      }
      const early = await duplicateOf()
      if (early) return early
      if (o.demo && !o.demoCreatesOrders) {
        return await skip(
          svc,
          row,
          "demo_no_orders",
          "Demo mode creates no Medusa orders from simulated marketplace orders unless demoCreatesOrders is on.",
        )
      }
      const mapped = mapOrder(order, {
        importId: row.id,
        demo: o.demo,
        regionId: await regionFor(scope, o.orderImportRegionId, String(order.currency ?? "")),
        salesChannelId: await salesChannelFor(scope, o.orderImportSalesChannelId),
        shippingOptionId: o.orderImportShippingOptionId || null,
        links: await linksFor(svc, order),
      })
      /*
       * The lock every importer of this marketplace order takes (the other
       * Koda Plus marketplace plugins use the same key), and the reference
       * looked up again INSIDE it: whoever comes second sees the order the
       * first one created, so two plugins never both create it.
       */
      type Attempt = { kind: "duplicate"; outcome: ImportOutcome } | { kind: "created"; order: { id: string; display_id?: number | null } }
      const locked = await withLock<Attempt>(scope, `marketplace-order-ref:${ref ?? `baselinker:${row.bl_order_id}`}`, async () => {
        const late = await duplicateOf()
        return late ? { kind: "duplicate", outcome: late } : { kind: "created", order: await ops.create(scope, mapped.input) }
      })
      if (!locked) {
        await updateImport(svc, row.id, { next_attempt_at: new Date(Date.now() + 60_000) })
        return { status: "busy", blOrderId: row.bl_order_id, orderId: null, code: "busy", message: "Another process imports this marketplace order right now." }
      }
      if (locked.kind === "duplicate") return locked.outcome
      const created = locked.order
      orderId = created.id
      displayId = created.display_id ?? null
      /* The id is stored the moment the order exists: a retry finds it, never makes a second one. */
      await updateImport(svc, row.id, {
        order_id: orderId,
        display_id: displayId,
        lines: mapped.lines,
        unlinked_lines: mapped.unlinked.length,
        total_minor: toMinor(mapped.total),
        currency: mapped.currency.toUpperCase(),
      })
    }

    const head = await loadOrderHead(scope, orderId)
    if (!head) throw new ImportMappingError("order_gone", `Medusa order ${orderId} of this import no longer exists.`)
    if (displayId === null || displayId === undefined) displayId = head.display_id ?? null
    if (head.status === "draft") {
      /* The e-mail goes on the order itself, never through a (guest) customer, before the order is placed. */
      const email = typeof order.email === "string" && order.email.trim() ? order.email.trim() : null
      if (email) await ops.setEmail(scope, orderId, email)
      await ops.place(scope, orderId)
    }

    const state = paymentState(order)
    if (!row.payment_state) await recordPayment(scope, orderId, orderTotal(order), state)

    await updateImport(svc, row.id, {
      status: "imported",
      order_id: orderId,
      display_id: displayId,
      payment_state: state,
      imported_at: row.imported_at ?? new Date(),
      next_attempt_at: null,
      last_error: adopted ? "This order was already in Medusa: adopted, nothing created." : null,
      last_error_code: adopted ? "adopted" : null,
      bl_status_id: toNumberOrNull(order.order_status_id),
    })
    await emitEvent(scope, PLUGIN_EVENTS.orderImported, {
      order_id: orderId,
      display_id: displayId,
      baselinker_order_id: row.bl_order_id,
      source: row.source,
      marketplace_order_ref: marketplaceRef(order),
      payment_state: state,
      adopted,
      demo: o.demo,
    })
    svc.getLogger().info(`[baselinker] BaseLinker order ${row.bl_order_id} (${row.source}) ${adopted ? "adopted as" : "imported as"} #${displayId ?? orderId}`)
    return { status: adopted ? "adopted" : "imported", blOrderId: row.bl_order_id, orderId, code: null, message: null }
  } catch (err) {
    const d = err instanceof ImportMappingError ? { code: err.code, message: err.message, retryable: false } : describeAnyError(err)
    const plan = planRetry({ attempts, retryable: d.retryable, maxAttempts: MAX_ATTEMPTS, steps: BACKOFF_SECONDS, now: new Date() })
    const message = svc.mask(d.message).slice(0, 2000)
    await updateImport(svc, row.id, { status: plan.status, next_attempt_at: plan.nextAttemptAt, last_error: message, last_error_code: d.code })
    if (plan.status === "failed") {
      await emitEvent(scope, PLUGIN_EVENTS.orderImportFailed, { baselinker_order_id: row.bl_order_id, code: d.code, message, attempts, demo: o.demo })
      return { status: "failed", blOrderId: row.bl_order_id, orderId: row.order_id, code: d.code, message }
    }
    return { status: "retry", blOrderId: row.bl_order_id, orderId: row.order_id, code: d.code, message }
  }
}

/** Imports one row now (the admin's "Import now" and "Retry"): resets attempts, ignores the age limit. */
export async function importOrderNow(scope: Scope, rowId: string): Promise<ImportOutcome> {
  const svc = baselinkerService(scope)
  const row = await findImportRow(svc, { id: rowId })
  if (!row) return { status: "failed", blOrderId: "", orderId: null, code: "not_found", message: "Import row not found." }
  if (row.status === "imported") return { status: "imported", blOrderId: row.bl_order_id, orderId: row.order_id, code: null, message: null }
  await updateImport(svc, row.id, { status: "pending", attempts: 0, next_attempt_at: new Date(), last_error: null, last_error_code: null })
  const fresh = (await findImportRow(svc, { id: rowId })) as ImportRow
  const out = await withLock(scope, `baselinker:import:${row.bl_order_id}`, () => importOne(scope, fresh, { force: true }))
  return out ?? { status: "busy", blOrderId: row.bl_order_id, orderId: null, code: "busy", message: "The order is being imported right now." }
}

/* ------------------------------------------------------------------ */
/* The pass                                                            */
/* ------------------------------------------------------------------ */

export interface ImportPassStats extends DiscoverStats {
  armed: boolean
  imported: number
  adopted: number
  skipped: number
  retry: number
  failed: number
  busy: number
  waiting: number
}

function emptyPass(): ImportPassStats {
  return {
    pages: 0,
    read: 0,
    created: 0,
    known: 0,
    ownExport: 0,
    ownSource: 0,
    notSelected: 0,
    unconfirmed: 0,
    armed: false,
    imported: 0,
    adopted: 0,
    skipped: 0,
    retry: 0,
    failed: 0,
    busy: 0,
    waiting: 0,
  }
}

/**
 * Discovery, then (when armed) the import of due rows. One pass per process
 * at a time; null when a pass already runs. Quiet when nothing happened.
 */
export async function runOrderImport(scope: Scope, trigger: RunTrigger): Promise<ImportPassStats | null> {
  return exclusive(scope, "imports", async () => {
    const svc = baselinkerService(scope)
    const o = svc.getOptions()
    const stats = emptyPass()
    if (!canImportOrders(o) || importRules(o).length === 0) return stats
    const startedAt = new Date()
    let error: string | null = null
    try {
      await discover(svc, stats)
    } catch (err) {
      error = `discovery: ${svc.mask(describeAnyError(err).message)}`
    }

    const { writers } = await loadWriters(svc)
    stats.armed = writerState(writers, "orderImport").live
    if (stats.armed) {
      const due = (await svc.listBaseLinkerImports({ status: "pending", demo: o.demo, next_attempt_at: { $lte: new Date() } } as never, {
        take: IMPORTS_PER_PASS,
        order: { next_attempt_at: "ASC", created_at: "ASC" },
      } as never)) as unknown as ImportRow[]
      for (const row of due) {
        /* Read again under the lock: a row another process imported or leased a moment ago gets no extra attempt. */
        const out = await withLock(scope, `baselinker:import:${row.bl_order_id}`, async () => {
          const fresh = await findImportRow(svc, { id: row.id })
          const dueAt = fresh?.next_attempt_at ? new Date(fresh.next_attempt_at).getTime() : 0
          if (!fresh || fresh.status !== "pending" || dueAt > Date.now()) return null
          return importOne(scope, fresh)
        })
        if (!out || out.status === "busy") stats.busy += 1
        else if (out.status === "imported") stats.imported += 1
        else if (out.status === "adopted") stats.adopted += 1
        else if (out.status === "skipped") stats.skipped += 1
        else if (out.status === "retry") stats.retry += 1
        else stats.failed += 1
      }
    } else {
      const [, waiting] = (await svc.listAndCountBaseLinkerImports({ status: "pending", demo: o.demo } as never, { take: 1, select: ["id"] } as never)) as unknown as [
        unknown[],
        number,
      ]
      stats.waiting = waiting
    }

    const happened = stats.created + stats.imported + stats.adopted + stats.skipped + stats.retry + stats.failed > 0
    if (happened || error || trigger === "manual") {
      await recordRun(svc, {
        kind: "imports",
        trigger,
        status: error ? (stats.created > 0 || stats.imported > 0 ? "partial" : "error") : stats.failed > 0 || stats.retry > 0 ? "partial" : "ok",
        complete: !error,
        startedAt,
        counts: { ...stats },
        message:
          error ??
          (stats.armed
            ? `${stats.created} new, ${stats.imported} imported, ${stats.skipped} skipped, ${stats.failed} need attention.`
            : `${stats.created} new order(s) found; ${stats.waiting} wait for the order import writer.`),
      })
    }
    return stats
  })
}

/* ------------------------------------------------------------------ */
/* The way back for imported orders                                    */
/* ------------------------------------------------------------------ */

export interface ImportedStatusStats {
  candidates: number
  read: number
  changed: number
  canceled: number
  flagged: number
  paid: number
  fulfilled: number
  errors: string[]
}

async function fulfilledQuantity(scope: Scope, orderId: string): Promise<{ fulfilled: number; status: string | null; items: Array<{ id: string; quantity: number }> }> {
  const { data } = await queryOf(scope).graph({ entity: "order", fields: ["id", "status", "items.*", "items.detail.*"], filters: { id: orderId } })
  const order = data[0] as
    | { status?: string | null; items?: Array<{ id: string; quantity?: unknown; detail?: { quantity?: unknown; fulfilled_quantity?: unknown } | null }> | null }
    | undefined
  let fulfilled = 0
  const items: Array<{ id: string; quantity: number }> = []
  for (const i of order?.items ?? []) {
    const done = Math.round(toNumber(i.detail?.fulfilled_quantity))
    fulfilled += done
    const left = Math.round(toNumber(i.detail?.quantity ?? i.quantity)) - done
    if (left > 0) items.push({ id: i.id, quantity: left })
  }
  return { fulfilled, status: order?.status ?? null, items }
}

/**
 * Status, parcel, payment and cancellation of imported orders. `onlyBlIds`
 * limits the read (the journal names the orders that changed).
 */
export async function syncImportedStatuses(scope: Scope, trigger: RunTrigger, onlyBlIds?: string[]): Promise<ImportedStatusStats | null> {
  return exclusive(scope, "imports_statuses", async () => {
    const svc = baselinkerService(scope)
    const o = svc.getOptions()
    const stats: ImportedStatusStats = { candidates: 0, read: 0, changed: 0, canceled: 0, flagged: 0, paid: 0, fulfilled: 0, errors: [] }
    const since = new Date(Date.now() - STATUS_WINDOW_DAYS * 24 * 3600 * 1000)
    const where: Record<string, unknown> = { status: "imported", demo: o.demo, imported_at: { $gte: since }, canceled_at: null, order_id: { $ne: null } }
    if (onlyBlIds) where.bl_order_id = onlyBlIds
    if (o.closedStatusIds.length > 0) where.$or = [{ bl_status_id: null }, { bl_status_id: { $nin: o.closedStatusIds } }]
    /* Chosen by the database: never checked first, then the oldest check. */
    const never = (await svc.listBaseLinkerImports({ ...where, status_checked_at: null } as never, {
      take: STATUSES_PER_PASS,
      order: { imported_at: "ASC" },
    } as never)) as unknown as ImportRow[]
    const checked =
      never.length < STATUSES_PER_PASS
        ? ((await svc.listBaseLinkerImports({ ...where, status_checked_at: { $ne: null } } as never, {
            take: STATUSES_PER_PASS - never.length,
            order: { status_checked_at: "ASC" },
          } as never)) as unknown as ImportRow[])
        : []
    const rows = [...never, ...checked].filter((r) => r.order_id && !(r.bl_status_id !== null && o.closedStatusIds.includes(r.bl_status_id)))
    stats.candidates = rows.length
    if (rows.length === 0) return stats

    let names = new Map<number, string>(DEMO_STATUSES.map((s) => [s.id, s.name]))
    if (!o.demo) {
      try {
        names = await clientFor(svc).getOrderStatusList()
      } catch (err) {
        stats.errors.push(`getOrderStatusList: ${svc.mask(describeAnyError(err).message)}`)
      }
    }
    const cancelIds = importCancelIds(o)
    const now = new Date()
    for (const row of rows) {
      let order: BlOrder | null = null
      try {
        order = await readBlOrder(svc, row.bl_order_id)
      } catch (err) {
        if (stats.errors.length < 10) stats.errors.push(`${row.bl_order_id}: ${svc.mask(describeAnyError(err).message)}`)
        continue
      }
      if (!order) {
        await updateImport(svc, row.id, { status_checked_at: now })
        continue
      }
      stats.read += 1
      const statusId = toNumberOrNull(order.order_status_id)
      const number = typeof order.delivery_package_nr === "string" && order.delivery_package_nr.trim() ? order.delivery_package_nr.trim() : null
      const module = typeof order.delivery_package_module === "string" && order.delivery_package_module.trim() ? order.delivery_package_module.trim() : null
      const name = statusId !== null ? names.get(statusId) ?? null : null
      const patch: Record<string, unknown> = { status_checked_at: now }
      const changed = statusId !== row.bl_status_id || number !== (row.tracking_number ?? null)
      if (changed) {
        stats.changed += 1
        Object.assign(patch, { bl_status_id: statusId, bl_status_name: name, tracking_number: number, tracking_url: trackingUrl(module, number), carrier: carrierName(module) })
        await patchOrderMetadata(scope, row.order_id as string, {
          [ORDER_METADATA.statusId]: statusId,
          [ORDER_METADATA.statusName]: name,
          [ORDER_METADATA.trackingNumber]: number,
          [ORDER_METADATA.trackingUrl]: trackingUrl(module, number),
          [ORDER_METADATA.carrier]: carrierName(module),
        }).catch(() => false)
        /* The same event as for sent orders, so code that follows statuses sees marketplace orders too. */
        await emitEvent(scope, PLUGIN_EVENTS.orderStatusChanged, {
          order_id: row.order_id,
          display_id: row.display_id,
          baselinker_order_id: row.bl_order_id,
          status_id: statusId,
          status_name: name,
          previous_status_id: row.bl_status_id ?? null,
          tracking_number: number,
          tracking_url: trackingUrl(module, number),
          carrier: carrierName(module),
          imported: true,
          demo: o.demo,
        })
      }

      try {
        /* Cancelled in BaseLinker: cancel in Medusa only while nothing is fulfilled. */
        const facts = await fulfilledQuantity(scope, row.order_id as string)
        const decision = cancelDecision({ statusId, cancelIds, fulfilledQuantity: facts.fulfilled, alreadyCanceled: facts.status === "canceled" })
        if (decision === "cancel") {
          await ops.cancel(scope, row.order_id as string)
          patch.canceled_at = now
          patch.flag = null
          stats.canceled += 1
        } else if (decision === "flag" && row.flag !== "cancel_blocked") {
          patch.flag = "cancel_blocked"
          patch.last_error = "Cancelled in BaseLinker, but already fulfilled in Medusa: cancel or return it in Medusa by hand."
          stats.flagged += 1
        }
        /* Paid later (a transfer, cash on delivery collected): the payment follows. */
        if (decision !== "cancel" && row.payment_state !== "paid" && paymentState(order) === "paid") {
          await recordPayment(scope, row.order_id as string, orderTotal(order), "paid")
          patch.payment_state = "paid"
          stats.paid += 1
        }
        /* A closing status fulfills the rest, when imported orders have a shipping option to fulfill with. */
        if (
          decision === "none" &&
          !row.fulfilled_at &&
          o.orderImportShippingOptionId &&
          statusId !== null &&
          o.fulfillOnStatusIds.includes(statusId) &&
          facts.items.length > 0 &&
          !o.demo
        ) {
          await ops.fulfill(scope, row.order_id as string, facts.items, row.bl_order_id)
          patch.fulfilled_at = now
          stats.fulfilled += 1
        }
      } catch (err) {
        if (stats.errors.length < 10) stats.errors.push(`${row.bl_order_id}: ${svc.mask(describeAnyError(err).message)}`)
      }
      await updateImport(svc, row.id, patch)
    }

    if (stats.changed + stats.canceled + stats.flagged + stats.paid + stats.fulfilled > 0 || stats.errors.length > 0 || trigger === "manual") {
      await recordRun(svc, {
        kind: "imports",
        trigger,
        status: stats.errors.length > 0 ? "partial" : "ok",
        complete: stats.errors.length === 0,
        startedAt: now,
        counts: { statuses: true, ...stats },
        message: `Imported orders: ${stats.read} read, ${stats.changed} changed, ${stats.canceled} cancelled, ${stats.flagged} flagged, ${stats.paid} paid.`,
      })
    }
    return stats
  })
}

/** Rounded total of a row for display (minor units back to a number). */
export function rowTotal(row: Pick<ImportRow, "total_minor">): number | null {
  return typeof row.total_minor === "number" ? round(row.total_minor / 100, 2) : null
}
