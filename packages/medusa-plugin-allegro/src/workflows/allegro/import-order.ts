/**
 * ONE ALLEGRO ORDER INTO MEDUSA: created as a draft, then placed and paid,
 * the same two-step path the BaseLinker plugin of Koda Plus takes, so every
 * marketplace order in the store looks the same to the rest of it.
 *
 * WHICH CORE WORKFLOWS AND WHY (Medusa 2.12 to 2.15, read in core-flows
 * 2.15.3):
 *
 *   `createOrderWorkflow` ("create-orders") is documented for exactly this
 *   case, "a workflow that imports orders from an external system". It takes
 *   our own unit prices (`unit_price` with `is_tax_inclusive`: Allegro prices
 *   are gross), checks the inventory, computes tax lines when the region has
 *   automatic taxes and keeps the shipping method we give it. It does not
 *   reserve inventory and emits no event. Earlier 2.x releases named it
 *   `createOrdersWorkflow`; 2.15 keeps that name as a deprecated alias, so
 *   the function is picked at load time (the peer range is ^2.12).
 *
 *   The order is created as a DRAFT and placed with
 *   `convertDraftOrderWorkflow`, which is what the Medusa admin does with
 *   draft orders: reservations through `reserveInventoryStep` in a stock
 *   location of the order's sales channel, the status `pending`, then
 *   `order.placed`. Not `completeCartWorkflow`: it needs a cart, a payment
 *   session and shipping options the marketplace order never had.
 *
 * `order.placed` IS EMITTED ON PURPOSE: invoicing (the Fakturownia plugin
 * issues the invoice the Allegro invoice writer then attaches), the ERP
 * (Subiekt nexo creates its document) and the store's stock follow-ups must
 * see Allegro orders like any other. Imported orders carry
 * `no_notification: true` and `metadata.marketplace_order_ref`; the store's
 * own confirmation e-mail must skip such orders, because Allegro talks to its
 * buyer (the README says how). Medusa's `payment.captured` fires for a paid
 * order as well.
 *
 * What the core does not do, this file adds, every step checked before it
 * runs so a retry finishes a draft an earlier attempt left and never repeats
 * a finished step:
 *   the buyer e-mail goes on the draft itself, before it is placed: passing
 *   it to `createOrderWorkflow` would find or create a guest customer, and a
 *   store that greets new customers would mail an Allegro buyer;
 *   tax lines for whatever the core left without them (a region with
 *   automatic taxes off), computed with `force_tax_calculation`, and never a
 *   second set where the core already made them: `updateOrderTaxLinesWorkflow`
 *   adds lines, it does not replace them;
 *   one payment collection for the order total, marked paid (captured) when
 *   Allegro holds the money, left not paid for cash on delivery.
 */

import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"
import * as coreFlows from "@medusajs/medusa/core-flows"
import type { Money } from "../../modules/allegro/lib/checkout"
import { untaxedIds, type MedusaOrderInput, type TaxedRecord } from "../../modules/allegro/lib/import"
import type { QueryLike } from "./catalog"

/* The singular name on 2.15 (and the releases that have it), the deprecated plural otherwise. */
const createOrderFlow: typeof coreFlows.createOrderWorkflow =
  (coreFlows as unknown as { createOrderWorkflow?: typeof coreFlows.createOrderWorkflow }).createOrderWorkflow ??
  (coreFlows as unknown as { createOrdersWorkflow: typeof coreFlows.createOrderWorkflow }).createOrdersWorkflow

export interface ImportOrderResult {
  orderId: string
  displayId: number | null
  total: Money | null
}

interface OrderHead {
  id: string
  status: string
  is_draft_order?: boolean | null
  email?: string | null
  display_id?: number | string | null
  total?: unknown
  currency_code?: string | null
  items?: Array<TaxedRecord | null> | null
  shipping_methods?: Array<TaxedRecord | null> | null
  payment_collections?: Array<{ id: string; status?: string | null } | null> | null
}

/*
 * TWO READS ON PURPOSE. Query computes the order total from the items it
 * loads: asked for "total" together with a few item fields ("items.id"),
 * it loads the items without their quantities and the total comes out as
 * the shipping alone (seen on Medusa 2.15.3). So the state (status, tax
 * lines, payments) and the totals are read separately, the totals with no
 * item field at all.
 */
async function head(container: MedusaContainer, orderId: string): Promise<OrderHead | null> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY) as unknown as QueryLike
  const { data } = await query.graph({
    entity: "order",
    fields: [
      "id",
      "status",
      "is_draft_order",
      "email",
      "items.id",
      "items.tax_lines.id",
      "shipping_methods.id",
      "shipping_methods.tax_lines.id",
      "payment_collections.id",
      "payment_collections.status",
    ],
    filters: { id: orderId },
  })
  const order = ((data as OrderHead[])[0] ?? null) as OrderHead | null
  if (!order) return null
  const { data: sums } = await query.graph({ entity: "order", fields: ["id", "display_id", "total", "currency_code"], filters: { id: orderId } })
  const totals = (sums as Array<Pick<OrderHead, "display_id" | "total" | "currency_code">>)[0]
  return { ...order, display_id: totals?.display_id ?? null, total: totals?.total, currency_code: totals?.currency_code ?? null }
}

function resultOf(order: OrderHead): ImportOrderResult {
  const total = Number(order.total)
  return {
    orderId: order.id,
    displayId: order.display_id === null || order.display_id === undefined ? null : Number(order.display_id),
    total: Number.isFinite(total) ? { value: total, currency: String(order.currency_code ?? "").toUpperCase() } : null,
  }
}

/** Creates the order as a draft: nothing reserved, nothing announced, no customer. */
export async function createAllegroDraft(container: MedusaContainer, order: MedusaOrderInput): Promise<{ orderId: string; displayId: number | null }> {
  const { result } = await createOrderFlow(container).run({ input: order as unknown as Parameters<typeof createOrderFlow.runAsStep>[0]["input"] })
  const created = result as unknown as { id: string; display_id?: number | string | null }
  return { orderId: created.id, displayId: created.display_id === null || created.display_id === undefined ? null : Number(created.display_id) }
}

/**
 * Brings an imported order to its final state. Safe to run again at any
 * point: a placed order is not placed twice, a payment collection is not
 * created twice, a paid one is not marked twice, a cancelled order is left
 * alone.
 */
export async function completeAllegroOrder(container: MedusaContainer, orderId: string, args: { email: string | null; paid: boolean }): Promise<ImportOrderResult> {
  let order = await head(container, orderId)
  if (!order) throw new MedusaError(MedusaError.Types.NOT_FOUND, `Medusa order ${orderId} of this Allegro import no longer exists.`)

  if (order.status === "draft" || order.is_draft_order === true) {
    if (args.email && !order.email) {
      const orders = container.resolve(Modules.ORDER)
      await orders.updateOrders([{ id: orderId, email: args.email }])
    }
    const itemIds = untaxedIds(order.items)
    const shippingIds = untaxedIds(order.shipping_methods)
    if (itemIds.length > 0 || shippingIds.length > 0) {
      await coreFlows.updateOrderTaxLinesWorkflow(container).run({
        input: { order_id: orderId, item_ids: itemIds, shipping_method_ids: shippingIds, force_tax_calculation: true },
      })
    }
    /* Reservations, the status `pending` and `order.placed`. */
    await coreFlows.convertDraftOrderWorkflow(container).run({ input: { id: orderId } })
    order = (await head(container, orderId)) ?? order
  }

  if (order.status !== "canceled") {
    let collection = (order.payment_collections ?? []).find((c): c is { id: string; status?: string | null } => Boolean(c)) ?? null
    if (!collection) {
      const { result } = await coreFlows.createOrderPaymentCollectionWorkflow(container).run({
        input: { order_id: orderId, amount: Number(order.total) || 0 },
      })
      collection = (result as unknown as Array<{ id: string; status?: string | null }>)[0] ?? null
    }
    if (args.paid && collection && (collection.status ?? "not_paid") === "not_paid") {
      await coreFlows.markPaymentCollectionAsPaid(container).run({ input: { order_id: orderId, payment_collection_id: collection.id } })
    }
    order = (await head(container, orderId)) ?? order
  }
  return resultOf(order)
}
