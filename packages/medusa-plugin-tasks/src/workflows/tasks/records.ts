/**
 * Medusa records behind links: whether they exist, and how they are named
 * right now (read through Query, one request per type). And the records the
 * sample tasks of the sandbox board link to.
 */

import { LINK_TYPES } from "../../modules/tasks/lib/constants"
import { LINK_QUERY, linkLabel, type LinkRecord } from "../../modules/tasks/lib/links"
import type { SeedEntities } from "../../modules/tasks/lib/sandbox"
import { graph, type Scope } from "./runtime"

export type LinkLabels = Map<string, { label: string | null; found: boolean }>

const keyOf = (type: string, id: string) => `${type}:${id}`

/** Labels of the given records by `type:id`; records Medusa does not have come back as not found. */
export async function linkLabels(scope: Scope, links: ReadonlyArray<{ entity_type: string; entity_id: string }>): Promise<LinkLabels> {
  const out: LinkLabels = new Map()
  for (const type of LINK_TYPES) {
    const ids = [...new Set(links.filter((l) => l.entity_type === type).map((l) => l.entity_id))]
    if (ids.length === 0) continue
    const q = LINK_QUERY[type]
    const rows = await graph<LinkRecord>(scope, { entity: q.entity, fields: q.fields, filters: { id: ids }, pagination: { take: ids.length } })
    const byId = new Map(rows.filter((r) => typeof r?.id === "string").map((r) => [r.id, r]))
    for (const id of ids) {
      const record = byId.get(id)
      out.set(keyOf(type, id), { label: record ? linkLabel(type, record) : null, found: Boolean(record) })
    }
  }
  return out
}

export function labelFor(labels: LinkLabels, type: string, id: string): { label: string | null; found: boolean } | undefined {
  return labels.get(keyOf(type, id))
}

/** The newest published product, the newest order and its customer (or any customer): what sample tasks link to. */
export async function seedEntities(scope: Scope): Promise<SeedEntities> {
  const products = await graph<{ id: string; status?: string | null }>(scope, {
    entity: "product",
    fields: ["id", "status"],
    pagination: { take: 20, order: { created_at: "DESC" } },
  })
  const product = products.find((p) => p.status === "published") ?? products[0]
  const [order] = await graph<{ id: string; customer_id?: string | null }>(scope, {
    entity: "order",
    fields: ["id", "customer_id"],
    pagination: { take: 1, order: { created_at: "DESC" } },
  })
  let customerId = order?.customer_id ?? null
  if (!customerId) {
    const [customer] = await graph<{ id: string }>(scope, { entity: "customer", fields: ["id"], pagination: { take: 1, order: { created_at: "DESC" } } })
    customerId = customer?.id ?? null
  }
  return { productId: product?.id ?? null, orderId: order?.id ?? null, customerId }
}
