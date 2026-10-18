/**
 * MARKETPLACE ORDERS INTO MEDUSA, the flow around the pure decisions of
 * `lib/orders.ts`:
 *
 *   1. one row per marketplace order id (unique), written before anything
 *      else, under an in-process lock on that id: a second import of the
 *      same order waits, then finds the row and creates nothing;
 *   2. the Medusa order is created as a draft and its id is written on the
 *      row at once; placing and paying come after, each step checked, so a
 *      retry finishes a draft and never makes a second order;
 *   3. a line that matches none of our offers holds the order with the
 *      reason (never an invented product).
 *
 * `simulateOrder` (demo mode only) builds a sample marketplace order from
 * the listed offers and imports it through the same path.
 */

import { randomUUID } from "node:crypto"
import type { MedusaContainer } from "@medusajs/framework/types"
import * as coreFlows from "@medusajs/medusa/core-flows"
import { isPending, type MarketplaceOrder } from "../../modules/vonhalsky/lib/client"
import { DEMO_SALES_CHANNEL } from "../../modules/vonhalsky/lib/constants"
import { demoOrder } from "../../modules/vonhalsky/lib/demo"
import { importAction, planImport, type ImportContext, type OfferRef } from "../../modules/vonhalsky/lib/orders"
import { shippingOptionFor } from "../../modules/vonhalsky/lib/shipping"
import { logSync, readSettings, toOrderDto, vonHalskySvc, withEvent, type Scope } from "../../modules/vonhalsky/lib/store"
import type { MarketplaceOrderDto } from "../../modules/vonhalsky/lib/contract"
import { completeOrder, createDraft } from "./medusa-order"
import { VonHalskyFlowError, demoClientOf, errorText, optionsOf, queryOf, requireClient, withLock, type QueryLike } from "./runtime"

type Row = Record<string, any>

/* ------------------------------------------------------------------ */
/* Where imported orders land                                          */
/* ------------------------------------------------------------------ */

export interface Target {
  regionId: string | null
  regionName: string | null
  currency: string | null
  salesChannelId: string | null
  salesChannelName: string | null
  /** Why the channel is what it is: "setting", "named", "default", "demo", or null when none. */
  channelNote: string | null
}

async function channelLocationIds(query: QueryLike, channelId: string): Promise<string[]> {
  const { data } = await query.graph({ entity: "sales_channel", fields: ["id", "stock_locations.id"], filters: { id: channelId } })
  return ((data as Array<{ stock_locations?: Array<{ id: string } | null> | null }>)[0]?.stock_locations ?? []).filter(Boolean).map((l) => l!.id)
}

/**
 * The demo sales channel, created on first use and linked to the stock
 * locations of the store's default channel (or every location), so a
 * simulated order reserves stock where the store keeps it.
 */
async function ensureDemoChannel(container: MedusaContainer, query: QueryLike): Promise<{ id: string; name: string } | null> {
  const { data } = await query.graph({ entity: "sales_channel", fields: ["id", "name"], filters: { name: DEMO_SALES_CHANNEL } })
  const found = (data as Array<{ id: string; name: string }>)[0]
  if (found) return found
  const { result } = await coreFlows.createSalesChannelsWorkflow(container).run({
    input: { salesChannelsData: [{ name: DEMO_SALES_CHANNEL, description: "Simulated InPost Von Halsky orders of the demo (InPost Von Halsky by Koda Plus)." }] },
  })
  const channel = (result as Array<{ id: string; name: string }>)[0]
  if (!channel) return null
  const { data: stores } = await query.graph({ entity: "store", fields: ["id", "default_sales_channel_id"], pagination: { take: 1 } })
  const def = (stores as Array<{ default_sales_channel_id?: string | null }>)[0]?.default_sales_channel_id ?? null
  let locations = def ? await channelLocationIds(query, def) : []
  if (locations.length === 0) {
    const { data: all } = await query.graph({ entity: "stock_location", fields: ["id"], pagination: { take: 20 } })
    locations = (all as Array<{ id: string }>).map((l) => l.id)
  }
  for (const id of locations) await coreFlows.linkSalesChannelsToStockLocationWorkflow(container).run({ input: { id, add: [channel.id] } })
  return channel
}

/** The region and sales channel of imported orders. `create`: make the demo channel when it is missing. */
export async function resolveTarget(container: MedusaContainer, create = false): Promise<Target> {
  const o = optionsOf(container)
  const settings = await readSettings(container)
  const query = queryOf(container)
  const { data: regions } = await query.graph({ entity: "region", fields: ["id", "name", "currency_code"], pagination: { take: 100 } })
  const list = regions as Array<{ id: string; name?: string | null; currency_code?: string | null }>
  const region = (settings.orders.regionId ? list.find((r) => r.id === settings.orders.regionId) : undefined) ?? list.find((r) => String(r.currency_code ?? "").toLowerCase() === "pln") ?? null
  const { data: channels } = await query.graph({ entity: "sales_channel", fields: ["id", "name"], pagination: { take: 200 } })
  const all = channels as Array<{ id: string; name: string }>
  let channel: { id: string; name: string } | null = null
  let note: string | null = null
  if (settings.orders.salesChannelId) {
    channel = all.find((c) => c.id === settings.orders.salesChannelId) ?? null
    note = channel ? "setting" : null
  }
  if (!channel && o.demo) {
    channel = all.find((c) => c.name === DEMO_SALES_CHANNEL) ?? (create ? await ensureDemoChannel(container, query) : null)
    note = channel ? "demo" : "demo_pending"
  }
  if (!channel && !o.demo) {
    channel = all.find((c) => c.name.trim().toLowerCase() === "inpost von halsky") ?? null
    note = channel ? "named" : null
    if (!channel) {
      const { data: stores } = await query.graph({ entity: "store", fields: ["id", "default_sales_channel_id"], pagination: { take: 1 } })
      const def = (stores as Array<{ default_sales_channel_id?: string | null }>)[0]?.default_sales_channel_id ?? null
      channel = all.find((c) => c.id === def) ?? null
      note = channel ? "default" : null
    }
  }
  return {
    regionId: region?.id ?? null,
    regionName: region?.name ?? null,
    currency: region ? String(region.currency_code ?? "").toLowerCase() : null,
    salesChannelId: channel?.id ?? null,
    salesChannelName: channel?.name ?? (note === "demo_pending" ? DEMO_SALES_CHANNEL : null),
    channelNote: note,
  }
}

/** The first shipping option of the store: the demo's fallback, so a simulated order can be fulfilled. */
async function firstShippingOption(query: QueryLike): Promise<string | null> {
  try {
    const { data } = await query.graph({ entity: "shipping_option", fields: ["id"], pagination: { take: 1, order: { created_at: "ASC" } } })
    return (data as Array<{ id: string }>)[0]?.id ?? null
  } catch {
    return null
  }
}

async function offerRefs(scope: Scope): Promise<OfferRef[]> {
  const svc = vonHalskySvc(scope)
  const rows = ((await svc.listVonHalskyOffers({ status: ["listed", "closed", "draft"] }, { take: 5000, select: ["id", "remote_id", "variant_id", "sku", "title"] })) ?? []) as Row[]
  return rows.map((r) => ({ remoteId: r.remote_id ?? null, variantId: String(r.variant_id), sku: r.sku ?? null, title: r.title ?? null }))
}

/* ------------------------------------------------------------------ */
/* One import                                                          */
/* ------------------------------------------------------------------ */

export interface ImportOutcome {
  kind: "imported" | "already" | "held" | "busy"
  order: MarketplaceOrderDto
}

async function rowOf(scope: Scope, marketplaceOrderId: string): Promise<Row | null> {
  const [row] = ((await vonHalskySvc(scope).listVonHalskyOrders({ marketplace_order_id: marketplaceOrderId }, { take: 1 })) ?? []) as Row[]
  return row ?? null
}

/** Imports one marketplace order. Idempotent by the marketplace order id. */
export async function importMarketplaceOrder(container: MedusaContainer, order: MarketplaceOrder, source: "demo" | "api" | "retry" = "api"): Promise<ImportOutcome> {
  if (!order.id) throw new VonHalskyFlowError(400, "no_id", "The marketplace order has no id.")
  const o = optionsOf(container)
  const svc = vonHalskySvc(container)
  return withLock(`order:${order.id}`, async () => {
    let row = await rowOf(container, order.id)
    const action = importAction(row ? { status: row.status, order_id: row.order_id ?? null, updated_at: row.updated_at } : null)
    if (action.kind === "already") return { kind: "already" as const, order: toOrderDto(row!) }
    if (action.kind === "busy") return { kind: "busy" as const, order: toOrderDto(row!) }

    const base = {
      remote_status: order.status,
      delivery_type: order.delivery.type === "UNKNOWN" ? null : order.delivery.type,
      delivery_point: order.delivery.point,
      payment_type: order.paymentType,
      currency_code: order.currency.toLowerCase(),
      total_minor: order.totalMinor,
      placed_at: order.createdAt ? new Date(order.createdAt) : null,
    }
    if (!row) {
      row = await svc.createVonHalskyOrders({
        marketplace_order_id: order.id,
        status: "importing",
        demo: o.demo,
        attempts: 1,
        ...base,
        events: withEvent([], { kind: "received", message: source === "demo" ? "Simulated marketplace order received (demo)" : "Marketplace order received", ...(o.demo ? { demo: true } : {}) }),
      })
    } else {
      row = await svc.updateVonHalskyOrders({ id: row.id, status: "importing", attempts: (Number(row.attempts) || 0) + 1, ...base })
    }
    const id = row!.id as string

    const hold = async (reason: string, code: string): Promise<ImportOutcome> => {
      const updated = await svc.updateVonHalskyOrders({ id, status: "held", error: reason.slice(0, 800), events: withEvent(row!.events, { kind: "held", message: reason.slice(0, 300), ...(o.demo ? { demo: true } : {}) }) })
      await logSync(container, { area: "orders", action: "import", outcome: "error", message: `Order ${order.id} held (${code}): ${reason}`, demo: o.demo, refs: { marketplace_order_id: order.id } })
      return { kind: "held", order: toOrderDto(updated) }
    }

    try {
      let orderId = action.kind === "finish" ? action.orderId : null
      let lines = row!.lines ?? null
      let email: string | null = order.buyer.email
      if (!orderId) {
        const target = await resolveTarget(container, true)
        const settings = await readSettings(container)
        const fallback = o.demo ? await firstShippingOption(queryOf(container)) : null
        const shippingOptionId = shippingOptionFor(order.delivery.type, settings.shipping, fallback)
        const ctx: ImportContext = { regionId: target.regionId, currency: target.currency, salesChannelId: target.salesChannelId, shippingOptionId, offers: await offerRefs(container), demo: o.demo }
        const decision = planImport(order, ctx)
        if (decision.kind === "hold") return hold(decision.reason, decision.code)
        email = decision.email
        lines = decision.lines
        const draft = await createDraft(container, decision.order)
        orderId = draft.orderId
        /* The id is on the row the moment the order exists: a retry finds it, never makes a second one. */
        row = await svc.updateVonHalskyOrders({ id, order_id: draft.orderId, display_id: draft.displayId, shipping_option_id: shippingOptionId, lines })
      }
      const placed = await completeOrder(container, orderId!, { email, paid: order.paid })
      const updated = await svc.updateVonHalskyOrders({
        id,
        status: "imported",
        order_id: placed.orderId,
        display_id: placed.displayId,
        imported_at: new Date(),
        error: null,
        events: withEvent(row!.events, {
          kind: "imported",
          message: `Imported as Medusa order${placed.displayId !== null ? ` #${placed.displayId}` : ""}${order.paid ? ", paid by the marketplace" : ", cash on delivery"}`,
          ...(o.demo ? { demo: true } : {}),
        }),
      })
      await logSync(container, {
        area: "orders",
        action: source === "demo" ? "simulate" : "import",
        message: `Order ${order.id} imported as #${placed.displayId ?? placed.orderId}${o.demo ? " (demo simulation)" : ""}.`,
        count: 1,
        demo: o.demo,
        refs: { marketplace_order_id: order.id, order_id: placed.orderId },
      })
      /* Accept on the marketplace (demo: noted by the simulated client). Never undoes the import. */
      const client = requireClient(container)
      await client.acceptOrder(order.id).catch(async (err) => {
        await logSync(container, { area: "orders", action: "accept", outcome: isPending(err) ? "warning" : "error", message: errorText(err, container), demo: o.demo })
      })
      return { kind: "imported", order: toOrderDto(updated) }
    } catch (err) {
      return hold(`Medusa refused the order: ${errorText(err, container)}`, "workflow_error")
    }
  })
}

/* ------------------------------------------------------------------ */
/* Entry points                                                        */
/* ------------------------------------------------------------------ */

/** DEMO MODE ONLY: a sample marketplace order from the listed offers, imported like a real one. */
export async function simulateOrder(container: MedusaContainer): Promise<ImportOutcome> {
  const o = optionsOf(container)
  const demo = demoClientOf(container)
  if (!o.demo || !demo) throw new VonHalskyFlowError(404, "not_demo", "Simulated orders exist only in demo mode.")
  const svc = vonHalskySvc(container)
  const listed = ((await svc.listVonHalskyOffers({ status: "listed" }, { take: 200 })) ?? []) as Row[]
  if (listed.length === 0) throw new VonHalskyFlowError(409, "no_listed_offers", "List a few offers first: the simulated buyer buys from listed offers.")
  const [, count] = await svc.listAndCountVonHalskyOrders({ demo: true }, { take: 1 })
  const id = `demo-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${randomUUID().slice(0, 8)}`
  const order = demoOrder(
    id,
    listed.map((r) => ({ remoteId: String(r.remote_id ?? ""), variantId: String(r.variant_id), sku: r.sku ?? null, ean: r.ean ?? null, title: String(r.title ?? r.sku ?? ""), priceMinor: Number(r.price_minor) || 0, stock: Number(r.stock) || 0 })),
    Number(count) || 0,
  )
  if (!order) throw new VonHalskyFlowError(409, "no_priced_offers", "None of the listed offers has a price.")
  demo.remember(order)
  return importMarketplaceOrder(container, order, "demo")
}

/** Imports what the marketplace has new (the scheduled job and the "Import now" button). */
export async function importNewOrders(container: MedusaContainer): Promise<{ imported: number; held: number; seen: number }> {
  const o = optionsOf(container)
  const client = requireClient(container)
  if (o.demo) {
    await logSync(container, { area: "orders", action: "import", message: "Demo: the simulated marketplace has no buyers of its own; use Simulate an order.", demo: true })
    return { imported: 0, held: 0, seen: 0 }
  }
  try {
    const { orders } = await client.listNewOrders(null)
    let imported = 0
    let held = 0
    for (const order of orders.slice(0, 50)) {
      const r = await importMarketplaceOrder(container, order, "api")
      if (r.kind === "imported") imported += 1
      if (r.kind === "held") held += 1
    }
    return { imported, held, seen: orders.length }
  } catch (err) {
    const message = errorText(err, container)
    await logSync(container, { area: "orders", action: "import", outcome: isPending(err) ? "warning" : "error", message })
    if (isPending(err)) throw new VonHalskyFlowError(501, "api_pending", message)
    throw new VonHalskyFlowError(502, "import_failed", message)
  }
}

/** Retries a held import: the order is read again from the marketplace (demo: from the simulated one). */
export async function retryOrder(container: MedusaContainer, rowId: string): Promise<ImportOutcome> {
  const svc = vonHalskySvc(container)
  const [row] = ((await svc.listVonHalskyOrders({ id: rowId }, { take: 1 })) ?? []) as Row[]
  if (!row) throw new VonHalskyFlowError(404, "not_found", "Marketplace order not found.")
  if (row.status === "imported") return { kind: "already", order: toOrderDto(row) }
  const client = requireClient(container)
  let order: MarketplaceOrder | null
  try {
    order = await client.getOrder(String(row.marketplace_order_id))
  } catch (err) {
    const message = errorText(err, container)
    if (isPending(err)) throw new VonHalskyFlowError(501, "api_pending", message)
    throw new VonHalskyFlowError(502, "fetch_failed", message)
  }
  if (!order) throw new VonHalskyFlowError(410, "order_gone", row.demo ? "The simulated order is no longer in memory (the server restarted): simulate a new one." : "The marketplace does not know this order any more.")
  return importMarketplaceOrder(container, order, "retry")
}
