import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { syncTracking } from "../workflows/vonhalsky/tracking"

/**
 * `shipment.created` (`{ id }` is the fulfillment): the tracking numbers of
 * an order imported from InPost Von Halsky go back to the marketplace (demo:
 * recorded locally). A no-op for every other order. Never throws: the
 * shipment in Medusa never fails because of the marketplace.
 */
export default async function vonHalskyShipmentCreated({ event, container }: SubscriberArgs<{ id: string }>): Promise<void> {
  const fulfillmentId = event.data?.id
  if (typeof fulfillmentId !== "string") return
  try {
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as any
    const { data } = await query.graph({ entity: "fulfillment", fields: ["id", "order.id"], filters: { id: fulfillmentId } })
    const orderId = (data as Array<{ order?: { id?: string | null } | null }>)[0]?.order?.id
    if (typeof orderId === "string") await syncTracking(container, orderId)
  } catch {
    /* the panel's "Send tracking again" covers what failed here */
  }
}

export const config: SubscriberConfig = {
  event: "shipment.created",
  context: { subscriberId: "vonhalsky-shipment-created" },
}
