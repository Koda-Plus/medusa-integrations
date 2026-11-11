import { model } from "@medusajs/framework/utils"

/**
 * ONE VARIANT AS A CENEO OFFER, after the build that last changed it: the
 * id Ceneo knows it by, what went into the file (price, availability,
 * category) and the problems found.
 *
 * `offer_id` is unique and never reused: Ceneo forbids giving an id to
 * another product. A row is never deleted. A variant that leaves the feed
 * keeps its row (`excluded`); a variant whose id changes (the `offerId`
 * option, a new SKU) retires the old row (`retired_at`) and gets a new one.
 * One active row per variant. `offer_id` is null while the variant has no
 * valid id (no SKU in "sku" mode, a duplicate).
 */
const CeneoOffer = model
  .define("ceneo_offer", {
    id: model.id({ prefix: "cof" }).primaryKey(),
    offer_id: model.text().nullable(),
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
    retired_at: model.dateTime().nullable(),
    demo: model.boolean().default(false),
  })
  .indexes([
    { on: ["offer_id"], unique: true, where: "deleted_at IS NULL" },
    { on: ["variant_id"], unique: true, where: "retired_at IS NULL AND deleted_at IS NULL" },
    { on: ["product_id"], where: "deleted_at IS NULL" },
    { on: ["state"], where: "deleted_at IS NULL" },
  ])

export default CeneoOffer
