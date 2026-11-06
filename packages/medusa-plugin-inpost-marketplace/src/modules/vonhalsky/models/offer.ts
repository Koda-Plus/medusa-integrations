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
    /** draft, listed, blocked, closed, detached (see `OFFER_STATUSES`) */
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
    /** The marketplace leaf category, and where it came from: "map" (a Medusa category), "hint" (the catalog) or "manual". */
    category_id: model.text().nullable(),
    category_source: model.text().nullable(),
    /** The category attributes sent: [{ id, values }]. */
    attributes: model.json().nullable(),
    /** What the catalog matched by EAN or part number: { productId, categoryId, name, brand } or null. */
    hint: model.json().nullable(),
    /* WHAT THE MARKETPLACE SAYS, beside what the plugin sent. */
    remote_price_minor: model.number().nullable(),
    /** What a buyer pays now, after a promotion or the price program. */
    remote_final_price_minor: model.number().nullable(),
    remote_stock: model.number().nullable(),
    /** The promotion: { start, end, status, mode, value } or null. */
    promotion: model.json().nullable(),
    /** The price program declaration: IN, OUT or null. */
    program: model.text().nullable(),
    /** Why the marketplace keeps it PENDING or REJECTED: [{ code, message }]. */
    validation: model.json().nullable(),
    /** The last asynchronous write: its id, what it was (create, patch, edit_close, edit_patch, price, stock, close, reopen, promotion, program) and its status. */
    command_id: model.text().nullable(),
    command_kind: model.text().nullable(),
    command_status: model.text().nullable(),
    command_at: model.dateTime().nullable(),
    /** The price and stock last sent, so only a difference is sent again. */
    pushed_price_minor: model.number().nullable(),
    pushed_stock: model.number().nullable(),
    image_count: model.number().nullable(),
    published_at: model.dateTime().nullable(),
    /**
     * What a person changed on this offer beside Medusa ("Edit offer"):
     * { title?, description?, images?: string[], dimension?: { length, width,
     * height, weight } (mm, g), daysToShip? }. Wins over Medusa's values in the
     * checks, the proposal and the list; a missing field follows Medusa.
     */
    overrides: model.json().nullable(),
  })
  .indexes([
    { on: ["variant_id"], unique: true, where: "deleted_at IS NULL" },
    { on: ["product_id"], where: "deleted_at IS NULL" },
    { on: ["status"], where: "deleted_at IS NULL" },
    { on: ["remote_id"], where: "deleted_at IS NULL" },
    { on: ["command_status"], where: "deleted_at IS NULL" },
  ])

export default VonHalskyOffer
