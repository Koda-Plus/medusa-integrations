import { model } from "@medusajs/framework/utils"

/**
 * THE LATEST CATALOG PLAN from Subiekt, one row per change: a variant price
 * (`price`, from and to) or a product to create (`create`). Replaced after
 * every COMPLETE read of `/v1/products`; an incomplete read keeps the previous
 * plan and plans nothing.
 *
 * Amounts are integer minor units (grosze): exact to compare, no float drift.
 * Statuses: `planned`, then `applied` (or `simulated` in demo mode), `over_cap`
 * (beyond this run's limit, next run), `stale` (Medusa changed in between, the
 * next plan sees it), `failed`, `quarantined` (failed too often, waits for a
 * person), `skipped`.
 */
const SubiektCatalogChange = model.define("subiekt_catalog_change", {
  id: model.id({ prefix: "sbcat" }).primaryKey(),
  run_id: model.text().nullable(),
  kind: model.text(),
  status: model.text().default("planned"),
  symbol: model.text(),
  sku: model.text().nullable(),
  ean: model.text().nullable(),
  title: model.text().nullable(),
  variant_id: model.text().nullable(),
  product_id: model.text().nullable(),
  price_id: model.text().nullable(),
  currency: model.text(),
  from_minor: model.number().nullable(),
  to_minor: model.number().nullable(),
  level: model.text().nullable(),
  matched_by: model.text().nullable(),
  data: model.json().nullable(),
  attempts: model.number().default(0),
  last_error: model.text().nullable(),
  applied_at: model.dateTime().nullable(),
  demo: model.boolean().default(false),
})

export default SubiektCatalogChange
