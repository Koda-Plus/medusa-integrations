import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { ceneoSvc } from "../modules/ceneo/lib/store"
import { queueShipment } from "../workflows/ceneo/import-orders"
import { errorText } from "../workflows/ceneo/runtime"

/**
 * A shipment (`{ id }` is the fulfillment) of an order imported from Ceneo:
 * the parcel number and "sent" wait for the status writer (the next run of
 * the 5-minute job). A no-op for any other order. Never throws.
 */
export default async function ceneoShipmentCreated({ event: { data }, container }: SubscriberArgs<{ id: string }>): Promise<void> {
  if (!data?.id) return
  try {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data: rows } = await query.graph({ entity: "fulfillment", fields: ["id", "order.id"], filters: { id: data.id } })
    const orderId = (rows as Array<{ order?: { id?: string | null } | null }>)[0]?.order?.id
    if (orderId) await queueShipment(container, orderId)
  } catch (err) {
    ceneoSvc(container).getLogger().error(`[ceneo] shipment.created ${data.id}: ${errorText(err)}`)
  }
}

export const config: SubscriberConfig = {
  event: "shipment.created",
  context: { subscriberId: "ceneo-shipment-created" },
}
