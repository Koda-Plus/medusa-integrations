import { model } from "@medusajs/framework/utils"

/**
 * ONE OFFER: a Medusa variant as the marketplace sees it. Where it stands
 * (draft, listed, blocked, closed) and why it cannot be listed (`reasons`),
 * the matching keys found on the variant (EAN, brand, manufacturer part
 * number), the GPSR manufacturer and where it came from, the channel price
 * (with an optional per-offer override) and the quantity offered. The
 * plugin's own record: decisions never come from product metadata alone.
 *
 * Amounts are gross minor units (grosze): `model.number` is an integer column.
 */
const VonHalskyOffer = model
  .define("vonhalsky_offer", {
    id: model.id({ prefix: "vhoff" }).primaryKey(),
    variant_id: model.text(),
    product_id: model.text(),
    sku: model.text().nullable(),
    title: model.text().nullable(),
    /** draft, listed, blocked, closed */
    status: model.text().default("draft"),
    /** The marketplace's own status (PENDING, PUBLISHED, SOLDOUT...), when known. */
    remote_status: model.text().nullable(),
    /** The marketplace's offer id (demo: a local "demo-..." id). */
    remote_id: model.text().nullable(),
    ean: model.text().nullable(),
    brand: model.text().nullable(),
    mpn: model.text().nullable(),
    /** The GPSR manufacturer name, and where it came from: "compliance" or "metadata". */
    manufacturer: model.text().nullable(),
    gpsr_source: model.text().nullable(),
    /** Codes that block listing (no_ean, no_gpsr...). */
    reasons: model.json().nullable(),
    /** Codes that do not block listing (no_mpn, no_stock...). */
    warnings: model.json().nullable(),
    /** The Medusa price the channel price is computed from (minor units, as Medusa keeps it). */
    base_price_minor: model.number().nullable(),
    /** A fixed gross price for this offer, set by a person (minor units). Wins over the markup. */
    price_override_minor: model.number().nullable(),
    /** The channel price (gross, minor units) as last computed. */
    price_minor: model.number().nullable(),
    currency_code: model.text().default("pln"),
    /** The quantity offered, from Medusa inventory. */
    stock: model.number().default(0),
    /** A row of demo mode. */
    demo: model.boolean().default(false),
    listed_at: model.dateTime().nullable(),
    synced_at: model.dateTime().nullable(),
    /** A masked error of the last failed step. */
    error: model.text().nullable(),
  })
  .indexes([
    { on: ["variant_id"], unique: true, where: "deleted_at IS NULL" },
    { on: ["product_id"], where: "deleted_at IS NULL" },
    { on: ["status"], where: "deleted_at IS NULL" },
    { on: ["remote_id"], where: "deleted_at IS NULL" },
  ])

export default VonHalskyOffer
