import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { notifyInpost } from "../workflows/inpostpay/orders"

/**
 * `shipment.created`: send InPost Pay the parcel numbers of the shipment
 * (`delivery_references_list`), so the app can show the tracking. Only
 * orders that came through InPost Pay, only with `sendOrderEvents`
 * (simulated in demo mode). Never throws.
 */
export default async function inpostPayShipmentCreated({ event, container }: SubscriberArgs<{ id: string }>): Promise<void> {
  const fulfillmentId = event.data?.id
  if (typeof fulfillmentId !== "string") return
  try {
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as any
    const { data } = await query.graph({ entity: "fulfillment", fields: ["id", "labels.tracking_number", "order.id"], filters: { id: fulfillmentId } })
    const f = (data as any[])[0]
    const orderId = f?.order?.id
    if (typeof orderId !== "string") return
    const references = ((f.labels ?? []) as Array<{ tracking_number?: string | null }>).map((l) => String(l?.tracking_number ?? "").trim()).filter(Boolean)
    await notifyInpost(container, orderId, { kind: "shipped", references })
  } catch {
    /* the shipment in Medusa never fails because of InPost */
  }
}

export const config: SubscriberConfig = {
  event: "shipment.created",
  context: { subscriberId: "inpostpay-shipment-created" },
}
