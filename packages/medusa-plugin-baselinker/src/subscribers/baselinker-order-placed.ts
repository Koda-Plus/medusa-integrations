import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { isSkipped } from "../modules/baselinker/lib/order-payload"
import { canExportOrders } from "../modules/baselinker/lib/options"
import { exportVerdictOf } from "../workflows/baselinker/order-facts"
import { enqueueOrder, exportSkipCode, exportSkipReason, kickOrders, loadOrderHead } from "../workflows/baselinker/orders"
import { baselinkerService } from "../workflows/baselinker/runtime"

/**
 * A new order becomes a row of the outbox, and the send starts right away in
 * the background. It NEVER fails the order: BaseLinker being down only makes
 * the queue longer.
 *
 * ORDER MATTERS: first the cheap write to our own table, then the attempt.
 * The other way round, a crash before the write would lose the order without
 * a trace (the local event bus only logs a failed subscriber).
 *
 * Without configuration nothing is queued, so a store that installs the
 * plugin and configures it a week later does not flood BaseLinker with a
 * week of old orders. An order with `metadata.baselinker_skip = true` (the
 * key is configurable) gets a `skipped` row and never goes out: test orders.
 *
 * THE LOOP GUARD (0.2): an order this plugin imported from BaseLinker gets no
 * row at all (it lives in the imported orders); an order another plugin took
 * straight from a marketplace (`metadata.marketplace_order_ref` on an order
 * backend code created) gets a `skipped` row unless `exportMarketplaceOrders`
 * is on. "Imported" is the plugin's import table, never order metadata: a
 * shopper sets cart metadata, and Medusa copies it to the order.
 */
export default async function baselinkerOrderPlaced({ event: { data }, container }: SubscriberArgs<{ id: string }>): Promise<void> {
  const svc = baselinkerService(container)
  const o = svc.getOptions()
  if (!data?.id || !canExportOrders(o)) return
  try {
    const order = await loadOrderHead(container, data.id)
    if (!order || order.status === "canceled") return
    const verdict = await exportVerdictOf(container, order)
    if (!verdict.send && verdict.reason === "imported") return
    const skip = isSkipped(order.metadata, o.skipOrderMetadataKey)
    await enqueueOrder(container, {
      orderId: data.id,
      displayId: order.display_id ?? null,
      skipReason: !verdict.send
        ? exportSkipReason(verdict)
        : skip
          ? `order.metadata.${o.skipOrderMetadataKey} is true, so the order stays out of BaseLinker.`
          : null,
      skipCode: !verdict.send ? exportSkipCode(verdict) : skip ? "skip_key" : null,
    })
    if (verdict.send && !skip) kickOrders(container, "auto")
  } catch (err) {
    svc.getLogger().error(`[baselinker] order.placed ${data.id}: ${svc.mask((err as Error)?.message ?? String(err))}`)
  }
}

export const config: SubscriberConfig = {
  event: "order.placed",
  context: { subscriberId: "baselinker-order-placed" },
}
