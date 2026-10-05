import { model } from "@medusajs/framework/utils"

/**
 * One place where OLX and the store disagree (see `lib/alerts.ts` for the
 * four kinds). Recomputed by every plan from the advert snapshot and the
 * Medusa catalog; an alert that stays keeps its `first_seen_at`, one that
 * disappears is removed. `key` is stable per kind, variant and advert.
 */
const OlxAlert = model
  .define("olx_alert", {
    id: model.id({ prefix: "olxal" }).primaryKey(),
    key: model.text(),
    kind: model.text(),
    variant_id: model.text(),
    product_id: model.text(),
    sku: model.text().nullable(),
    product_title: model.text().nullable(),
    olx_id: model.text().nullable(),
    advert_title: model.text().nullable(),
    advert_url: model.text().nullable(),
    advert_status: model.text().nullable(),
    stock: model.number().nullable(),
    product_status: model.text().nullable(),
    first_seen_at: model.dateTime(),
    demo: model.boolean().default(false),
  })
  .indexes([
    { on: ["key", "demo"], unique: true, where: "deleted_at IS NULL" },
    { on: ["kind"], where: "deleted_at IS NULL" },
    { on: ["product_id"], where: "deleted_at IS NULL" },
  ])

export default OlxAlert
