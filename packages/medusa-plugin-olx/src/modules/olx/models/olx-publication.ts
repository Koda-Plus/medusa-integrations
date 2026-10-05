import { model } from "@medusajs/framework/utils"

/**
 * One variant published (or to be published) as an OLX advert. EXACTLY ONCE:
 * a unique row per variant exists before anything goes to the network, one
 * process claims it at a time (`claim_token`, `lease_until`), the SKU is
 * looked up in `external_id` on OLX before every create, and an unclear
 * answer leaves the row `unknown` until a lookup settles it.
 *
 * States: planned (ready), blocked (something missing, see `missing`),
 * publishing (claimed), published, failed, quarantined, unknown.
 * `payload` is the exact body of POST /adverts the plan would send.
 */
const OlxPublication = model
  .define("olx_publication", {
    id: model.id({ prefix: "olxpub" }).primaryKey(),
    variant_id: model.text(),
    product_id: model.text(),
    sku: model.text(),
    title: model.text(),
    olx_category_id: model.number().nullable(),
    state: model.text(),
    payload: model.json().nullable(),
    missing: model.json().nullable(),
    warnings: model.json().nullable(),
    attempts: model.number().default(0),
    last_error: model.text().nullable(),
    note: model.text().nullable(),
    planned_at: model.dateTime().nullable(),
    last_attempt_at: model.dateTime().nullable(),
    unknown_since: model.dateTime().nullable(),
    claim_token: model.text().nullable(),
    lease_until: model.dateTime().nullable(),
    olx_id: model.text().nullable(),
    olx_url: model.text().nullable(),
    olx_status: model.text().nullable(),
    adopted: model.boolean().default(false),
    published_at: model.dateTime().nullable(),
    demo: model.boolean().default(false),
  })
  .indexes([
    { on: ["variant_id", "demo"], unique: true, where: "deleted_at IS NULL" },
    { on: ["state"], where: "deleted_at IS NULL" },
    { on: ["product_id"], where: "deleted_at IS NULL" },
  ])

export default OlxPublication
