/**
 * THE LIFECYCLE PLAN: WHICH ADVERTS TO END AND WHICH TO BRING BACK. Pure.
 *
 * Commands of `POST /adverts/{id}/commands` (developer.olx.pl):
 *
 *   deactivate   an `active` advert whose variant sold out, or whose product
 *                is no longer published. OLX sets it to `removed_by_user`.
 *   finish       a `limited` advert (over the package limit, invisible) whose
 *                variant sold out: moved to the finished section.
 *   activate     an advert THIS PLUGIN deactivated (`removed_by_user`), when
 *                its variant is back in stock and published.
 *
 * WHAT IS NEVER TOUCHED. Adverts without a variant, adverts a person ended by
 * hand (the plugin reactivates only what it paused itself), adverts in any
 * other status (new, moderated, blocked, outdated), and everything when the
 * last advert read or the stock read was incomplete: absence is not evidence.
 *
 * THE MASS GUARD. Ending more than max(10, 25 % of the live linked adverts)
 * in one plan looks like a broken stock import, not like a good sales day.
 * Such a plan is held: the scheduled writer ends nothing until a person runs
 * it deliberately from the admin.
 */

import { MASS_GUARD_MIN, MASS_GUARD_SHARE } from "./constants"
import { hasStock, isPublished, isSoldOut, type StockState } from "./stock"

export type LifecycleCommand = "deactivate" | "activate" | "finish"
export type LifecycleReason = "sold_out" | "unpublished" | "back_in_stock"

export interface LifecycleAdvert {
  olxId: string
  status: string
  variantId: string | null
  title: string
  url: string
}

export interface LifecycleVariant {
  id: string
  productId: string
  sku: string | null
  productTitle: string | null
  productStatus: string | null
  stock: StockState
}

export interface LifecycleAction {
  olxId: string
  command: LifecycleCommand
  reason: LifecycleReason
  fromStatus: string
  /** The status the advert is expected to have once the command went through. */
  toStatus: string
  variantId: string
  productId: string
  sku: string | null
  title: string
}

export interface LifecycleGuard {
  held: boolean
  endings: number
  liveLinked: number
  limit: number
}

export interface LifecyclePlan {
  skipped: null | "incomplete_read" | "no_stock_data"
  actions: LifecycleAction[]
  /** Adverts the plugin paused that are live again: a person brought them back, the pause is forgotten. */
  resumed: string[]
  guard: LifecycleGuard
}

/** Expected status after a command (deactivate is documented to end in `removed_by_user`). */
export const COMMAND_TARGET: Record<LifecycleCommand, string> = {
  deactivate: "removed_by_user",
  activate: "active",
  finish: "finished",
}

const ORDER: Record<LifecycleCommand, number> = { deactivate: 0, finish: 1, activate: 2 }

export function guardLimit(liveLinked: number, min = MASS_GUARD_MIN, share = MASS_GUARD_SHARE): number {
  return Math.max(min, Math.ceil(liveLinked * share))
}

export function planLifecycle(input: {
  adverts: readonly LifecycleAdvert[]
  variants: ReadonlyMap<string, LifecycleVariant>
  /** Olx ids of adverts this plugin deactivated and has not reactivated since. */
  pausedByPlugin: ReadonlySet<string>
  readComplete: boolean
  stockComplete: boolean
  guardMin?: number
  guardShare?: number
}): LifecyclePlan {
  const emptyGuard: LifecycleGuard = { held: false, endings: 0, liveLinked: 0, limit: 0 }
  if (!input.readComplete) return { skipped: "incomplete_read", actions: [], resumed: [], guard: emptyGuard }
  if (!input.stockComplete) return { skipped: "no_stock_data", actions: [], resumed: [], guard: emptyGuard }

  const actions: LifecycleAction[] = []
  const resumed: string[] = []
  let liveLinked = 0

  for (const a of input.adverts) {
    if (!a.variantId) continue
    const v = input.variants.get(a.variantId)
    if (!v) continue
    const published = isPublished(v.productStatus)
    const soldOut = isSoldOut(v.stock)
    const base = { olxId: a.olxId, fromStatus: a.status, variantId: v.id, productId: v.productId, sku: v.sku, title: a.title }

    if (a.status === "active") {
      liveLinked += 1
      if (input.pausedByPlugin.has(a.olxId)) resumed.push(a.olxId)
      if (!published) actions.push({ ...base, command: "deactivate", reason: "unpublished", toStatus: COMMAND_TARGET.deactivate })
      else if (soldOut) actions.push({ ...base, command: "deactivate", reason: "sold_out", toStatus: COMMAND_TARGET.deactivate })
      continue
    }
    if (a.status === "limited") {
      if (soldOut || !published) {
        actions.push({ ...base, command: "finish", reason: soldOut ? "sold_out" : "unpublished", toStatus: COMMAND_TARGET.finish })
      }
      continue
    }
    if (a.status === "removed_by_user" && input.pausedByPlugin.has(a.olxId) && published && hasStock(v.stock)) {
      actions.push({ ...base, command: "activate", reason: "back_in_stock", toStatus: COMMAND_TARGET.activate })
    }
  }

  actions.sort((x, y) => ORDER[x.command] - ORDER[y.command] || x.olxId.localeCompare(y.olxId))
  const endings = actions.filter((x) => x.command !== "activate").length
  const limit = guardLimit(liveLinked, input.guardMin, input.guardShare)
  return { skipped: null, actions, resumed, guard: { held: endings > limit, endings, liveLinked, limit } }
}
