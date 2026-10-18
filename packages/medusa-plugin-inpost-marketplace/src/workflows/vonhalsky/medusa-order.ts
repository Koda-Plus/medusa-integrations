/**
 * ONE MARKETPLACE ORDER INTO MEDUSA: created as a draft, then placed and
 * paid, the path the Allegro and BaseLinker plugins of Koda Plus take, so
 * every marketplace order looks the same to the rest of the store.
 *
 *   `createOrderWorkflow` (Medusa documents it for importing orders from an
 *   external system) takes our gross unit prices and the shipping method;
 *   2.12 to 2.14 name it `createOrdersWorkflow`, so the function is picked at
 *   load time. The order is created as a DRAFT and placed with
 *   `convertDraftOrderWorkflow`, as the admin does with draft orders:
 *   reservations, the status `pending`, then `order.placed`.
 *
 *   The payment is PROVIDER NEUTRAL: one payment collection for the order
 *   total, marked paid with `markPaymentCollectionAsPaid` (Medusa's system
 *   provider) when the marketplace collected the money; left not paid for
 *   cash on delivery. No payment provider of this plugin is involved.
 *
 * The buyer e-mail goes on the draft itself, before it is placed (passing it
 * to `createOrderWorkflow` would create a guest customer). Tax lines are
 * added only where the core left none: Medusa adds tax lines, it does not
 * replace them, so a second calculation would double the VAT.
 *
 * Every step is checked before it runs, so a retry finishes a draft an
 * earlier attempt left and never repeats a finished step.
 *
 * DEMO ORDERS ARE REAL ORDERS in the "InPost Von Halsky (demo)" sales
 * channel with `metadata.koda_demo`: placed (they reserve stock, so the
 * demo can fulfil and ship them) and paid like a real import, without any
 * call outside. Imported orders carry `no_notification: true`.
 */

import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"
import * as coreFlows from "@medusajs/medusa/core-flows"
import type { MedusaOrderInput } from "../../modules/vonhalsky/lib/orders"

const createOrderFlow: typeof coreFlows.createOrderWorkflow =
  (coreFlows as unknown as { createOrderWorkflow?: typeof coreFlows.createOrderWorkflow }).createOrderWorkflow ??
  (coreFlows as unknown as { createOrdersWorkflow: typeof coreFlows.createOrderWorkflow }).createOrdersWorkflow

interface Taxed {
  id: string
  tax_lines?: Array<{ id?: string } | null> | null
}

interface OrderHead {
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

export function untaxedIds(list: ReadonlyArray<Taxed | null> | null | undefined): string[] {
  return (list ?? []).filter((x): x is Taxed => Boolean(x) && (x?.tax_lines ?? []).filter(Boolean).length === 0).map((x) => x.id)
}

/*
 * TWO READS ON PURPOSE (as in the Allegro plugin): asked for "total" with a
 * few item fields, Query computes the total from items without quantities.
 */
async function head(container: MedusaContainer, orderId: string): Promise<OrderHead | null> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY) as any
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

export interface PlacedOrder {
  orderId: string
  displayId: number | null
  totalMinor: number | null
  paid: boolean
}

function resultOf(order: OrderHead): PlacedOrder {
  const total = Number(order.total)
  const collection = (order.payment_collections ?? []).find(Boolean)
  return {
    orderId: order.id,
    displayId: order.display_id === null || order.display_id === undefined ? null : Number(order.display_id),
    totalMinor: Number.isFinite(total) ? Math.round(total * 100) : null,
    paid: collection?.status === "paid" || collection?.status === "authorized",
  }
}

/** Creates the order as a draft: nothing reserved, nothing announced, no customer. */
export async function createDraft(container: MedusaContainer, order: MedusaOrderInput): Promise<{ orderId: string; displayId: number | null }> {
  const { result } = await createOrderFlow(container).run({ input: order as unknown as Parameters<typeof createOrderFlow.runAsStep>[0]["input"] })
  const created = result as unknown as { id: string; display_id?: number | string | null }
  return { orderId: created.id, displayId: created.display_id === null || created.display_id === undefined ? null : Number(created.display_id) }
}

/** Brings an imported order to its final state. Safe to run again at any point. */
export async function completeOrder(container: MedusaContainer, orderId: string, args: { email: string | null; paid: boolean }): Promise<PlacedOrder> {
  let order = await head(container, orderId)
  if (!order) throw new MedusaError(MedusaError.Types.NOT_FOUND, `Medusa order ${orderId} of this marketplace import no longer exists.`)

  if (order.status === "draft" || order.is_draft_order === true) {
    if (args.email && !order.email) {
      const orders = container.resolve(Modules.ORDER)
      await orders.updateOrders([{ id: orderId, email: args.email }])
    }
    const itemIds = untaxedIds(order.items)
    const shippingIds = untaxedIds(order.shipping_methods)
    if (itemIds.length > 0 || shippingIds.length > 0) {
      await coreFlows.updateOrderTaxLinesWorkflow(container).run({ input: { order_id: orderId, item_ids: itemIds, shipping_method_ids: shippingIds, force_tax_calculation: true } })
    }
    await coreFlows.convertDraftOrderWorkflow(container).run({ input: { id: orderId } })
    order = (await head(container, orderId)) ?? order
  }

  if (order.status !== "canceled") {
    let collection = (order.payment_collections ?? []).find((c): c is { id: string; status?: string | null } => Boolean(c)) ?? null
    if (!collection) {
      const { result } = await coreFlows.createOrderPaymentCollectionWorkflow(container).run({ input: { order_id: orderId, amount: Number(order.total) || 0 } })
      collection = (result as unknown as Array<{ id: string; status?: string | null }>)[0] ?? null
    }
    if (args.paid && collection && (collection.status ?? "not_paid") === "not_paid") {
      await coreFlows.markPaymentCollectionAsPaid(container).run({ input: { order_id: orderId, payment_collection_id: collection.id } })
    }
    order = (await head(container, orderId)) ?? order
  }
  return resultOf(order)
}

/** The display id of an order, for the panel. */
export async function displayIdOf(container: MedusaContainer, orderId: string): Promise<number | null> {
  try {
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as any
    const { data } = await query.graph({ entity: "order", fields: ["id", "display_id"], filters: { id: orderId } })
    const n = Number((data as any[])[0]?.display_id)
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}
