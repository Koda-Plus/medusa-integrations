/**
 * What the plugin knows for certain about a Medusa order: from its own
 * tables and from Medusa records read by id, never from order metadata
 * alone. A shopper sets cart metadata through the Store API and Medusa copies
 * it to the order, so a metadata key may decide nothing by itself:
 *
 *   - "this plugin imported it" is a row of `baselinker_import`;
 *   - the shared marketplace reference counts only on an order backend code
 *     created (no cart behind it), the way marketplace plugins create them.
 */

import type BaseLinkerModuleService from "../../modules/baselinker/service"
import { exportVerdict, metadataRef, type ExportFacts, type ExportVerdict } from "../../modules/baselinker/lib/order-import"
import { baselinkerService, queryOf, type Scope } from "./runtime"

/**
 * The cart an order was placed from: its id, null when backend code created
 * the order, undefined when Medusa could not tell (the order is gone, or the
 * order and cart link is not readable).
 */
export async function orderCartId(scope: Scope, orderId: string): Promise<string | null | undefined> {
  try {
    const { data } = await queryOf(scope).graph({ entity: "order", fields: ["id", "cart.id"], filters: { id: orderId } })
    const row = data[0] as { cart?: { id?: string | null } | null } | undefined
    if (!row) return undefined
    return typeof row.cart?.id === "string" && row.cart.id ? row.cart.id : null
  } catch {
    return undefined
  }
}

/** Orders this plugin created from BaseLinker orders, in any mode: they never go back. */
export async function importedOrderIds(svc: BaseLinkerModuleService, orderIds: readonly string[]): Promise<Set<string>> {
  const ids = [...new Set(orderIds.filter(Boolean))]
  if (ids.length === 0) return new Set()
  const rows = (await svc.listBaseLinkerImports({ order_id: ids } as never, {
    take: ids.length * 2,
    select: ["order_id"],
  } as never)) as unknown as Array<{ order_id: string | null }>
  return new Set(rows.map((r) => r.order_id).filter((id): id is string => Boolean(id)))
}

/**
 * The marketplace reference of an order when it is a fact: written by
 * backend code (no cart). On an order placed from a cart it came from the
 * shopper and counts for nothing. When Medusa cannot tell, it counts: the
 * order is then held back and shown as skipped, which a person sees,
 * instead of reaching BaseLinker a second time.
 */
export async function trustedMarketplaceRef(scope: Scope, order: { id: string; metadata?: Record<string, unknown> | null }): Promise<string | null> {
  const ref = metadataRef(order.metadata)
  if (!ref) return null
  const cart = await orderCartId(scope, order.id)
  return typeof cart === "string" ? null : ref
}

export async function exportFactsOf(scope: Scope, order: { id: string; metadata?: Record<string, unknown> | null }): Promise<ExportFacts> {
  const svc = baselinkerService(scope)
  const [imported, marketplaceRef] = await Promise.all([importedOrderIds(svc, [order.id]), trustedMarketplaceRef(scope, order)])
  return { imported: imported.has(order.id), marketplaceRef }
}

/** The loop guard for one order: never back to BaseLinker when imported, not a marketplace order unless asked. */
export async function exportVerdictOf(scope: Scope, order: { id: string; metadata?: Record<string, unknown> | null }): Promise<ExportVerdict> {
  const svc = baselinkerService(scope)
  return exportVerdict(await exportFactsOf(scope, order), svc.getOptions().exportMarketplaceOrders)
}
