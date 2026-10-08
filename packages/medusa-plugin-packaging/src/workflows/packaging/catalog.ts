import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/** The catalog products with their SKU and title, read once for the panel. */
export async function readVariants(container: MedusaContainer): Promise<Array<{ product_id: string; sku: string; title: string | null }>> {
  try {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({ entity: "product_variant", fields: ["id", "sku", "product_id", "product.title"] })
    const rows = (data as Array<{ product_id?: string | null; sku?: string | null; product?: { title?: string | null } | null }>) ?? []
    const seen = new Set<string>()
    const out: Array<{ product_id: string; sku: string; title: string | null }> = []
    for (const r of rows) {
      const id = r.product_id
      if (!id || seen.has(id)) continue
      seen.add(id)
      out.push({ product_id: id, sku: r.sku ?? "", title: r.product?.title ?? null })
    }
    return out
  } catch {
    return []
  }
}
