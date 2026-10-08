import type { MedusaContainer } from "@medusajs/framework/types"
import { packagingSvc, type Row } from "../../modules/packaging/lib/store"
import { readVariants } from "./catalog"

export interface UnitInput {
  name: string
  pieces: number
  ean?: string | null
  sscc_prefix?: string | null
}

/** Creates or updates the packaging of a product: the MOQ, the step and the ladder. */
export async function savePackaging(
  container: MedusaContainer,
  productId: string,
  input: { moq: number; step: number; units: UnitInput[] },
): Promise<Row> {
  const svc = packagingSvc(container)
  const existing = await svc.listPackagingProducts({ product_id: productId }, { take: 1 })

  let sku: string | null = null
  let title: string | null = null
  if (existing.length === 0) {
    const variants = await readVariants(container)
    const v = variants.find((x) => x.product_id === productId)
    sku = v?.sku ?? null
    title = v?.title ?? null
  }

  let product: Row
  if (existing.length > 0) {
    const updated = await svc.updatePackagingProducts([{ id: existing[0].id, moq: input.moq, step: input.step }])
    product = updated[0]
  } else {
    const created = await svc.createPackagingProducts([{ product_id: productId, sku, title, moq: input.moq, step: input.step, demo: svc.isDemo() }])
    product = created[0]
  }

  /* The ladder is replaced as a whole: the editor sends the whole set. */
  const current = await svc.listPackagingUnits({ product_id: productId }, { take: 10 })
  if (current.length > 0) await svc.deletePackagingUnits(current.map((u) => u.id))
  const units = input.units
    .filter((u) => typeof u.pieces === "number" && u.pieces >= 1)
    .map((u) => ({
      product_id: productId,
      name: u.name,
      pieces: Math.floor(u.pieces),
      ean: u.ean || null,
      sscc_prefix: u.sscc_prefix || null,
      demo: svc.isDemo(),
    }))
  if (units.length > 0) await svc.createPackagingUnits(units)

  return product
}

export type { Row }
