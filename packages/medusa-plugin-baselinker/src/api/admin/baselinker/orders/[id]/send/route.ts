import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { SendResponse } from "../../../../../../modules/baselinker/lib/contract"
import { toOrderDto, type OrderRow } from "../../../../../../modules/baselinker/lib/dto"
import { isSkipped } from "../../../../../../modules/baselinker/lib/order-payload"
import { canExportOrders } from "../../../../../../modules/baselinker/lib/options"
import { exportVerdictOf } from "../../../../../../workflows/baselinker/order-facts"
import { enqueueOrder, exportSkipReason, findOrderRow, loadOrderHead, sendOrderNow } from "../../../../../../workflows/baselinker/orders"
import { baselinkerService, guarded } from "../../../helpers"

/**
 * POST /admin/baselinker/orders/:id/send
 *
 * "Send to BaseLinker now" on the order page and "Send again" on a failed
 * row. `:id` is the Medusa order id (or the outbox row id). Attempts reset,
 * the send starts in the background, the answer is 202.
 *
 * SAFE TO CLICK TWICE: a row with a BaseLinker id is refused here, and the
 * send itself scans for the order marker before writing, so an order that
 * reached BaseLinker without an answer is adopted, not duplicated.
 */
export const POST = guarded(async (req: MedusaRequest, res: MedusaResponse): Promise<void> => {
  const svc = baselinkerService(req.scope)
  const o = svc.getOptions()
  if (!canExportOrders(o)) {
    res.status(409).json({
      message: o.exportOrders ? `Missing plugin options: ${svc.missingOptions().join(", ")}.` : "Order export is off (exportOrders: false).",
    })
    return
  }

  let orderId = req.params.id
  if (orderId.startsWith("blord_")) {
    const rows = (await svc.listBaseLinkerOrders({ id: orderId } as never, { take: 1 } as never)) as unknown as OrderRow[]
    if (!rows[0]) {
      res.status(404).json({ message: "Outbox row not found." })
      return
    }
    orderId = rows[0].order_id
  }

  const order = await loadOrderHead(req.scope, orderId)
  if (!order) {
    res.status(404).json({ message: "Order not found." })
    return
  }
  if (order.status === "canceled") {
    res.status(409).json({ message: "The order is canceled." })
    return
  }
  if (isSkipped(order.metadata, o.skipOrderMetadataKey)) {
    res.status(409).json({ message: `order.metadata.${o.skipOrderMetadataKey} is true: remove it to send this order.` })
    return
  }
  /* The loop guard: an order that came from BaseLinker, or straight from a marketplace, is never sent there. */
  const verdict = await exportVerdictOf(req.scope, order)
  if (!verdict.send) {
    res.status(409).json({ message: exportSkipReason(verdict) })
    return
  }
  const existing = await findOrderRow(svc, orderId)
  if (existing && (existing.status === "sent" || existing.bl_order_id)) {
    res.status(409).json({ message: `The order is already in BaseLinker as ${existing.bl_order_id}.` })
    return
  }

  const row = await enqueueOrder(req.scope, { orderId, displayId: order.display_id ?? null, force: true })
  setImmediate(() => {
    sendOrderNow(req.scope, orderId).catch((err: unknown) => {
      svc.getLogger().error(`[baselinker] send ${orderId}: ${svc.mask((err as Error)?.message ?? String(err))}`)
    })
  })
  const body: SendResponse = { order: toOrderDto(row) }
  res.status(202).json(body)
})
