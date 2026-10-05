/**
 * ONE ORDER JOURNAL RUN: read the Allegro orders changed since the last
 * complete read (or sample orders in demo mode), link every line to its
 * product and upsert them. READ ONLY and WITHOUT PERSONAL DATA: the journal
 * shows what was sold on Allegro next to the store; orders stay in Allegro.
 *
 * The cursor is the start of the last complete run minus an overlap, not a
 * stored id: an order changed while we were reading comes back next time, and
 * a failed run simply leaves the cursor where it was.
 */

import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type AllegroModuleService from "../../modules/allegro/service"
import { isConnected, readOrdersSince, type OrdersRead } from "../../modules/allegro/lib/connection"
import { ALLEGRO_MODULE, ORDERS_FIRST_READ_DAYS, ORDERS_KEEP_DAYS, ORDERS_OVERLAP_MS } from "../../modules/allegro/lib/constants"
import { buildDemoRawOrders } from "../../modules/allegro/lib/demo"
import { sameJson, toRunDto, type OrderRow, type RunRow } from "../../modules/allegro/lib/dto"
import { normalizeKey } from "../../modules/allegro/lib/matching"
import { linkLines, ordersFromApi, type AllegroOrderInput, type LineVariant } from "../../modules/allegro/lib/orders"
import { loadCatalog, type QueryLike } from "./catalog"
import { chunks, demoDay, demoOffersRaw, pruneRuns, type SyncInput, type SyncResult, type SyncTrigger } from "./run-offers"

const RUNNING_KEY = Symbol.for("koda.allegro.ordersRunning")
type Holder = typeof globalThis & { [RUNNING_KEY]?: boolean }

export function isOrdersSyncRunning(): boolean {
  return Boolean((globalThis as Holder)[RUNNING_KEY])
}

function setRunning(value: boolean): void {
  ;(globalThis as Holder)[RUNNING_KEY] = value
}

/** Where to start reading: the last complete run minus the overlap, or a week back. */
async function cursor(svc: AllegroModuleService): Promise<Date> {
  const runs = (await svc.listAllegroSyncRuns({ kind: "orders", complete: true, source: "api" } as never, {
    take: 1,
    order: { started_at: "DESC" },
    select: ["started_at"],
  })) as unknown as Array<{ started_at: Date | string }>
  if (runs[0]) return new Date(new Date(runs[0].started_at).getTime() - ORDERS_OVERLAP_MS)
  return new Date(Date.now() - ORDERS_FIRST_READ_DAYS * 24 * 60 * 60 * 1000)
}

type OrderData = Omit<OrderRow, "id">

function desiredRow(order: AllegroOrderInput, byOffer: Map<string, LineVariant>, bySku: Map<string, LineVariant>, demo: boolean): OrderData {
  const linked = linkLines(order.lines, byOffer, bySku)
  return {
    allegro_id: order.allegroId,
    status: order.status,
    fulfillment_status: order.fulfillmentStatus,
    total: order.total,
    bought_at: order.boughtAt ? new Date(order.boughtAt) : null,
    allegro_updated_at: order.updatedAt ? new Date(order.updatedAt) : null,
    delivery_method: order.deliveryMethod,
    line_count: order.lines.length,
    unmatched_lines: linked.unmatched,
    lines: linked.lines,
    demo,
  }
}

function sameRow(row: OrderRow, want: OrderData): boolean {
  const t = (v: Date | string | null) => (v ? new Date(v).getTime() : null)
  return (
    row.status === want.status &&
    (row.fulfillment_status ?? null) === (want.fulfillment_status ?? null) &&
    (row.delivery_method ?? null) === (want.delivery_method ?? null) &&
    row.line_count === want.line_count &&
    row.unmatched_lines === want.unmatched_lines &&
    Boolean(row.demo) === want.demo &&
    t(row.bought_at) === t(want.bought_at) &&
    t(row.allegro_updated_at) === t(want.allegro_updated_at) &&
    sameJson(row.total, want.total) &&
    sameJson(row.lines, want.lines)
  )
}

async function linkMaps(svc: AllegroModuleService, query: QueryLike, demo: boolean) {
  const offers = (await svc.listAllegroOffers({ demo, variant_id: { $ne: null } } as never, {
    take: null,
    select: ["allegro_id", "variant_id", "product_id", "sku", "product_title"],
  })) as unknown as Array<{ allegro_id: string; variant_id: string; product_id: string; sku: string; product_title: string | null }>
  const byOffer = new Map<string, LineVariant>(
    offers.map((o) => [o.allegro_id, { id: o.variant_id, productId: o.product_id, sku: o.sku, productTitle: o.product_title }]),
  )
  const bySku = new Map<string, LineVariant>()
  for (const v of await loadCatalog(query, [])) {
    const k = normalizeKey(v.sku)
    if (k && !bySku.has(k)) bySku.set(k, { id: v.id, productId: v.productId, sku: v.sku, productTitle: v.productTitle })
  }
  return { byOffer, bySku }
}

export async function runAllegroOrdersSync(container: MedusaContainer, input: SyncInput = {}): Promise<SyncResult> {
  if (isOrdersSyncRunning()) return { run: null, skipped: "running" }
  setRunning(true)
  const svc = container.resolve<AllegroModuleService>(ALLEGRO_MODULE)
  const o = svc.getOptions()
  const trigger: SyncTrigger = input.trigger ?? "manual"
  const source = o.demo ? "demo" : "api"
  const startedAt = new Date()
  try {
    if (!o.ordersEnabled) return { run: null, skipped: "disabled" }
    if (!o.demo) {
      if (!svc.isConfigured()) return { run: null, skipped: "not_configured" }
      if (!(await isConnected(svc))) return { run: null, skipped: "not_connected" }
    }
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as unknown as QueryLike

    let read: OrdersRead
    if (o.demo) {
      const raw = buildDemoRawOrders(await demoOffersRaw(query, await loadCatalog(query, o.stockLocationIds)), demoDay())
      read = { orders: ordersFromApi(raw), complete: true, pages: 1, reason: null }
    } else {
      read = await readOrdersSince(svc, await cursor(svc))
    }

    const { byOffer, bySku } = await linkMaps(svc, query, o.demo)
    const ids = read.orders.map((x) => x.allegroId)
    const stored = ids.length
      ? ((await svc.listAllegroOrders({ allegro_id: ids } as never, { take: null })) as unknown as OrderRow[])
      : []
    const byId = new Map(stored.map((r) => [r.allegro_id, r]))

    const creates: OrderData[] = []
    const updates: Array<OrderData & { id: string }> = []
    let unmatched = 0
    for (const order of read.orders) {
      const want = desiredRow(order, byOffer, bySku, o.demo)
      unmatched += want.unmatched_lines
      const row = byId.get(order.allegroId)
      if (!row) creates.push(want)
      else if (!sameRow(row, want)) updates.push({ id: row.id, ...want })
    }

    /* Demo orders are a complete picture of "today": yesterday's samples go.
     * Real orders never disappear by absence, only by age. */
    const removeIds: string[] = []
    if (o.demo) {
      const demoRows = (await svc.listAllegroOrders({ demo: true } as never, { take: null, select: ["id", "allegro_id"] })) as unknown as Array<{ id: string; allegro_id: string }>
      const keep = new Set(ids)
      for (const r of demoRows) if (!keep.has(r.allegro_id)) removeIds.push(r.id)
    } else {
      const demoRows = (await svc.listAllegroOrders({ demo: true } as never, { take: null, select: ["id"] })) as unknown as Array<{ id: string }>
      removeIds.push(...demoRows.map((r) => r.id))
    }
    const cutoff = new Date(Date.now() - ORDERS_KEEP_DAYS * 24 * 60 * 60 * 1000)
    const old = (await svc.listAllegroOrders({ bought_at: { $lt: cutoff } } as never, { take: 1000, select: ["id"] })) as unknown as Array<{ id: string }>
    removeIds.push(...old.map((r) => r.id))

    for (const part of chunks([...new Set(removeIds)], 500)) await svc.deleteAllegroOrders(part)
    for (const part of chunks(creates, 200)) await svc.createAllegroOrders(part as never)
    for (const part of chunks(updates, 200)) await svc.updateAllegroOrders(part as never)

    const statuses: Record<string, number> = {}
    for (const x of read.orders) statuses[x.status] = (statuses[x.status] ?? 0) + 1
    const status = read.complete ? "ok" : read.pages === 0 ? "error" : "partial"
    const finishedAt = new Date()
    const created = (await svc.createAllegroSyncRuns({
      kind: "orders",
      source,
      trigger,
      status,
      complete: read.complete,
      pages: read.pages,
      items: read.orders.length,
      statuses,
      issues: unmatched,
      created_count: creates.length,
      updated_count: updates.length,
      removed_count: removeIds.length,
      message: read.complete ? null : read.reason,
      duration_ms: finishedAt.getTime() - startedAt.getTime(),
      started_at: startedAt,
      finished_at: finishedAt,
    } as never)) as unknown as RunRow
    await pruneRuns(svc, "orders")
    if (creates.length || updates.length || !read.complete) {
      svc
        .getLogger()
        .info(
          `[allegro] orders ${source}/${trigger} ${status}: read=${read.orders.length} created=${creates.length} ` +
            `updated=${updates.length} lines_without_product=${unmatched}` +
            (read.complete ? "" : ` incomplete: ${read.reason ?? "unknown reason"}`),
        )
    }
    return { run: toRunDto(created), skipped: null }
  } catch (err) {
    const message = svc.mask(err instanceof Error ? err.message : String(err))
    svc.getLogger().error(`[allegro] orders ${source}/${trigger} failed: ${message}`)
    const finishedAt = new Date()
    const failed = (await svc
      .createAllegroSyncRuns({
        kind: "orders",
        source,
        trigger,
        status: "error",
        complete: false,
        message,
        duration_ms: finishedAt.getTime() - startedAt.getTime(),
        started_at: startedAt,
        finished_at: finishedAt,
      } as never)
      .catch(() => null)) as unknown as RunRow | null
    return { run: failed ? toRunDto(failed) : null, skipped: null }
  } finally {
    setRunning(false)
  }
}
