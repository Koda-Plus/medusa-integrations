import { model } from "@medusajs/framework/utils"

/**
 * ONE PRICE SNAPSHOT of a variant (Omnibus). Captured by a scheduled job and
 * the seed, so the "lowest price of the last 30 days" can be shown next to a
 * discount without reading old price history that Medusa does not keep.
 */
const CompliancePriceSnapshot = model
  .define("compliance_price_snapshot", {
    id: model.id({ prefix: "cps" }).primaryKey(),
    variant_id: model.text(),
    sku: model.text().nullable(),
    currency_code: model.text().nullable(),
    amount: model.number().nullable(),
    captured_at: model.dateTime(),
  })
  .indexes([
    { on: ["sku", "captured_at"], where: "deleted_at IS NULL" },
    { on: ["variant_id", "captured_at"], where: "deleted_at IS NULL" },
  ])

export default CompliancePriceSnapshot
