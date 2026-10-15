import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { clientOf, optionsOf, settingsOf } from "../api/kit/helpers"
import { maskKitSecrets } from "../modules/kit/lib/client"
import { planBuyerTags, tagBuyer } from "../modules/kit/lib/order-tags"

/**
 * After an order, an address that is ALREADY an active subscriber gets the
 * buyer tags from the admin (and product tags when switched on). Nobody is
 * subscribed by an order. It NEVER fails the order: Kit being down only
 * means the tags are missing, and the log row says so.
 */
export default async function kitOrderPlaced({ event: { data }, container }: SubscriberArgs<{ id: string }>): Promise<void> {
  const o = optionsOf(container)
  if (!data?.id || !o.apiKey) return
  const settings = await settingsOf(container)
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as { warn: (m: string) => void }
  const svc = container.resolve("kit") as any

  let email = ""
  try {
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as any
    const { data: orders } = await query.graph({
      entity: "order",
      fields: ["id", "email", "status", "items.product_title", "items.title"],
      filters: { id: data.id },
    })
    const order = orders?.[0]
    if (!order?.email || order.status === "canceled") return
    email = String(order.email)

    const titles = (order.items ?? []).map((i: any) => String(i?.product_title ?? i?.title ?? ""))
    const plan = planBuyerTags(settings, titles)
    const result = await tagBuyer(clientOf(container), email, plan)
    if (!result.done) return

    try {
      await svc.createKitSubscriberLogs({
        email: email.toLowerCase(),
        first_name: null,
        kit_subscriber_id: result.subscriberId,
        state: "active",
        tags: result.tagIds,
        source: "order",
        status: "ok",
      })
    } catch {
      /* the log is best-effort */
    }
  } catch (err) {
    const message = maskKitSecrets(String((err as Error)?.message ?? err), o.apiKey).slice(0, 500)
    logger.warn(`[kit] order.placed ${data.id}: buyer tags not applied (${message})`)
    try {
      if (email) {
        await svc.createKitSubscriberLogs({ email: email.toLowerCase(), first_name: null, kit_subscriber_id: null, state: null, tags: [], source: "order", status: "failed", error: message })
      }
    } catch {
      /* the log is best-effort */
    }
  }
}

export const config: SubscriberConfig = {
  event: "order.placed",
}
