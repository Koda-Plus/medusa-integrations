import { model } from "@medusajs/framework/utils"

/**
 * FAILURES THAT OUTLIVE A PLAN. The catalog plan is replaced every run, so the
 * count of failed attempts per item lives here, keyed by kind and item (the
 * variant for a price, the Subiekt symbol for a new product). After
 * `QUARANTINE_AFTER_FAILURES` failed runs the item is quarantined: the writer
 * skips it until a person releases it in the admin. A success clears the row.
 */
const SubiektCatalogQuarantine = model.define("subiekt_catalog_quarantine", {
  id: model.id({ prefix: "sbqrn" }).primaryKey(),
  kind: model.text(),
  item_key: model.text(),
  failures: model.number().default(0),
  quarantined: model.boolean().default(false),
  last_error: model.text().nullable(),
  demo: model.boolean().default(false),
})

export default SubiektCatalogQuarantine
