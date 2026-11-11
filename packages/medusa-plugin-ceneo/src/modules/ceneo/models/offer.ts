import { model } from "@medusajs/framework/utils"

/**
 * ONE VARIANT AS A CENEO OFFER, after the latest feed build: the id Ceneo
 * knows it by, what went into the file (price, availability, category) and
 * the problems found. `offer_id` is unique: Ceneo forbids reusing an id for
 * another product, so a row is never deleted when its variant leaves the
 * feed, it turns `excluded` and keeps the id.
 */
const CeneoOffer = model
  .define("ceneo_offer", {
    id: model.id({ prefix: "cof" }).primaryKey(),
    offer_id: model.text(),
    variant_id: model.text(),
    product_id: model.text(),
    sku: model.text().nullable(),
    title: model.text(),
    state: model.text().default("ok"),
    problems: model.json().nullable(),
    in_feed: model.boolean().default(false),
    /* `{ amount, currency_code }` as written in the feed: a json value, because `model.number` is an integer. */
    price: model.json().nullable(),
    avail: model.number().nullable(),
    stock: model.number().nullable(),
    ceneo_category_id: model.text().nullable(),
    built_at: model.dateTime(),
    demo: model.boolean().default(false),
  })
  .indexes([
    { on: ["offer_id"], unique: true, where: "deleted_at IS NULL" },
    { on: ["variant_id"], where: "deleted_at IS NULL" },
    { on: ["product_id"], where: "deleted_at IS NULL" },
    { on: ["state"], where: "deleted_at IS NULL" },
  ])

export default CeneoOffer
