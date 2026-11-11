/**
 * ONE KUP TERAZ ORDER INTO MEDUSA: created as a draft, then placed and (for
 * a prepaid order) paid. The same path the Allegro plugin of Koda Plus takes,
 * so every marketplace order looks the same to the rest of the store.
 *
 * CORE WORKFLOWS (Medusa 2.12 to 2.15, read in core-flows 2.15.3):
 *   `createOrderWorkflow` ("create-orders", documented for importing orders
 *   from an external system; `createOrdersWorkflow` before 2.15) with our own
 *   gross unit prices, as a DRAFT: nothing reserved, no event, no customer.
 *   `updateOrderTaxLinesWorkflow` only for lines the core left untaxed
 *   (it adds lines, it does not replace them).
 *   `convertDraftOrderWorkflow`: reservations, status `pending`, `order.placed`
 *   (invoicing and the ERP must see Ceneo orders like any other; the order has
 *   `no_notification` and `metadata.marketplace_order_ref`, so the store's own
 *   confirmation e-mail can skip it, see the README).
 *   `createOrderPaymentCollectionWorkflow` and `markPaymentCollectionAsPaid`
 *   for a prepaid order.
 * Every step is checked before it runs: a retry finishes a draft an earlier
 * attempt left and never repeats a finished step.
 *
 * DEMO ORDERS ARE NEVER PLACED OR PAID: from draft straight to `pending` in
 * the order module, so no reservation takes real stock and no event reaches
 * invoicing, the ERP or e-mails. A demo cancellation is quiet too.
 */

import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"
import * as coreFlows from "@medusajs/medusa/core-flows"
import type { MedusaOrderInput } from "../../modules/ceneo/lib/order-input"
import type { QueryLike } from "./runtime"

const createOrderFlow: typeof coreFlows.createOrderWorkflow =
  (coreFlows as unknown as { createOrderWorkflow?: typeof coreFlows.createOrderWorkflow }).createOrderWorkflow ??
  (coreFlows as unknown as { createOrdersWorkflow: typeof coreFlows.createOrderWorkflow }).createOrdersWorkflow

type Taxed = { id: string; tax_lines?: Array<{ id: string } | null> | null }

function untaxedIds(list: ReadonlyArray<Taxed | null> | null | undefined): string[] {
  return (list ?? []).filter((x): x is Taxed => Boolean(x) && (x?.tax_lines ?? []).filter(Boolean).length === 0).map((x) => x.id)
}

export interface OrderHead {
  id: string
  status: string
  is_draft_order?: boolean | null
  email?: string | null
  display_id?: number | string | null
  total?: unknown
  items?: Array<Taxed | null> | null
  shipping_methods?: Array<Taxed | null> | null
  payment_collections?: Array<{ id: string; status?: string | null } | null> | null
}

/*
 * TWO READS ON PURPOSE: asked for "total" together with item fields, Query
 * loads the items without quantities and the total comes out as the shipping
 * alone (Medusa 2.15.3). State and totals are read separately.
 */
export async function orderHead(container: MedusaContainer, orderId: string): Promise<OrderHead | null> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY) as unknown as QueryLike
  const { data } = await query.graph({
    entity: "order",
    fields: ["id", "status", "is_draft_order", "email", "items.id", "items.tax_lines.id", "shipping_methods.id", "shipping_methods.tax_lines.id", "payment_collections.id", "payment_collections.status"],
    filters: { id: orderId },
  })
  const order = ((data as OrderHead[])[0] ?? null) as OrderHead | null
  if (!order) return null
  const { data: sums } = await query.graph({ entity: "order", fields: ["id", "display_id", "total"], filters: { id: orderId } })
  const totals = (sums as Array<Pick<OrderHead, "display_id" | "total">>)[0]
  return { ...order, display_id: totals?.display_id ?? null, total: totals?.total }
}

export async function createCeneoDraft(container: MedusaContainer, order: MedusaOrderInput): Promise<string> {
  const { result } = await createOrderFlow(container).run({ input: order as unknown as Parameters<typeof createOrderFlow.runAsStep>[0]["input"] })
  return (result as unknown as { id: string }).id
}

async function taxLines(container: MedusaContainer, order: OrderHead): Promise<void> {
  const itemIds = untaxedIds(order.items)
  const shippingIds = untaxedIds(order.shipping_methods)
  if (itemIds.length === 0 && shippingIds.length === 0) return
  await coreFlows.updateOrderTaxLinesWorkflow(container).run({ input: { order_id: order.id, item_ids: itemIds, shipping_method_ids: shippingIds, force_tax_calculation: true } })
}

/** Brings an imported order to its final state. Safe to run again at any point. */
export async function completeCeneoOrder(container: MedusaContainer, orderId: string, args: { email: string | null; paid: boolean; demo: boolean }): Promise<OrderHead> {
  let order = await orderHead(container, orderId)
  if (!order) throw new MedusaError(MedusaError.Types.NOT_FOUND, `Medusa order ${orderId} of this Ceneo import no longer exists.`)
  const orders = container.resolve(Modules.ORDER)
  const draft = order.status === "draft" || order.is_draft_order === true
  if (draft) {
    /* On the draft itself: passing the e-mail to createOrderWorkflow would create a guest customer. */
    if (args.email && !order.email) await orders.updateOrders([{ id: orderId, email: args.email }])
    await taxLines(container, order)
    if (args.demo) {
      await orders.updateOrders([{ id: orderId, status: "pending" as never, is_draft_order: false }])
      return (await orderHead(container, orderId)) ?? order
    }
    await coreFlows.convertDraftOrderWorkflow(container).run({ input: { id: orderId } })
    order = (await orderHead(container, orderId)) ?? order
  }
  if (args.demo || order.status === "canceled") return order
  let collection = (order.payment_collections ?? []).find((c): c is { id: string; status?: string | null } => Boolean(c)) ?? null
  if (!collection) {
    const { result } = await coreFlows.createOrderPaymentCollectionWorkflow(container).run({ input: { order_id: orderId, amount: Number(order.total) || 0 } })
    collection = (result as unknown as Array<{ id: string; status?: string | null }>)[0] ?? null
  }
  if (args.paid && collection && (collection.status ?? "not_paid") === "not_paid") {
    await coreFlows.markPaymentCollectionAsPaid(container).run({ input: { order_id: orderId, payment_collection_id: collection.id } })
  }
  return (await orderHead(container, orderId)) ?? order
}

/** Cancels an imported order: the core workflow (stock released, `order.canceled`) or, for a demo order, quietly. */
export async function cancelCeneoOrder(container: MedusaContainer, orderId: string, demo: boolean): Promise<void> {
  if (demo) {
    const orders = container.resolve(Modules.ORDER) as unknown as { cancel(id: string): Promise<unknown> }
    await orders.cancel(orderId)
    return
  }
  await coreFlows.cancelOrderWorkflow(container).run({ input: { order_id: orderId, no_notification: true } })
}

/** Status and whether anything was fulfilled, for a set of Medusa orders. */
export async function orderStatuses(query: QueryLike, ids: string[]): Promise<Map<string, { status: string | null; fulfilled: boolean; displayId: string | null }>> {
  const out = new Map<string, { status: string | null; fulfilled: boolean; displayId: string | null }>()
  if (ids.length === 0) return out
  const { data } = await query.graph({ entity: "order", fields: ["id", "status", "display_id", "fulfillments.id", "fulfillments.canceled_at"], filters: { id: ids } })
  for (const o of data as Array<{ id: string; status?: string | null; display_id?: number | string | null; fulfillments?: Array<{ id: string; canceled_at?: unknown } | null> | null }>) {
    out.set(o.id, {
      status: o.status ?? null,
      fulfilled: (o.fulfillments ?? []).some((f) => Boolean(f) && !f?.canceled_at),
      displayId: o.display_id === null || o.display_id === undefined ? null : String(o.display_id),
    })
  }
  return out
}
