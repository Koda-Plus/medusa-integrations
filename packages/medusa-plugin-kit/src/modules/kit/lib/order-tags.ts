import type { KitClient } from "./client"
import { prefixOf, type KitSettings } from "./store"

/**
 * TAGS FOR BUYERS: after an order, a person who is ALREADY an active
 * subscriber gets the buyer tags (and, when switched on, one tag per bought
 * product). Nobody is subscribed here: an order is not a newsletter consent,
 * so an address that is not on the list, or waits for confirmation, is left
 * alone. Tagging answers 200 when the tag is already there, so a repeated
 * event changes nothing.
 */

export interface BuyerTagsPlan {
  tagIds: number[]
  productTagNames: string[]
}

/** What one order should apply, before asking Kit anything. */
export function planBuyerTags(settings: Pick<KitSettings, "buyer_tags" | "product_tags" | "product_tag_prefix">, productTitles: string[]): BuyerTagsPlan {
  const names = settings.product_tags
    ? [...new Set(productTitles.map((t) => t.trim()).filter(Boolean))].map((t) => `${prefixOf(settings.product_tag_prefix)}${t}`.slice(0, 120))
    : []
  return { tagIds: [...new Set(settings.buyer_tags)], productTagNames: names }
}

export type BuyerTagsResult =
  | { done: false; reason: "nothing_to_do" | "not_subscribed" | "not_active" }
  | { done: true; subscriberId: number; tagIds: number[] }

export async function tagBuyer(client: KitClient, email: string, plan: BuyerTagsPlan): Promise<BuyerTagsResult> {
  if (plan.tagIds.length === 0 && plan.productTagNames.length === 0) return { done: false, reason: "nothing_to_do" }
  const subscriber = await client.subscriberByEmail(email.trim().toLowerCase())
  if (!subscriber) return { done: false, reason: "not_subscribed" }
  if (subscriber.state !== "active") return { done: false, reason: "not_active" }

  const ids = [...plan.tagIds]
  for (const name of plan.productTagNames) {
    try {
      const tag = await client.createTag(name)
      if (tag.id) ids.push(tag.id)
    } catch {
      /* one product tag that fails must not stop the others */
    }
  }
  const applied: number[] = []
  for (const tagId of [...new Set(ids)]) {
    try {
      await client.tagSubscriber(subscriber.id, tagId)
      applied.push(tagId)
    } catch {
      /* a tag deleted in Kit - the rest still applies */
    }
  }
  return { done: true, subscriberId: subscriber.id, tagIds: applied }
}
