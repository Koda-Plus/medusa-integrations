import { model } from "@medusajs/framework/utils"

/**
 * A KUP TERAZ ORDER AS CENEO REPORTS IT. One row per Ceneo order id (a
 * GUID), written by the sync. No personal data: shipping, invoice and
 * pickup data stay at Ceneo and are read when an order is opened, and
 * go into the Medusa order only, when it is imported.
 *
 * The import columns: `import_status` (null, importing, imported, held,
 * failed) with an atomic claim (`import_claim`, `import_lease_until`, one
 * SQL statement), `medusa_order_id` written right after the draft exists,
 * and `ceneo_writes`, what Ceneo was told and what waits (order-input.ts).
 */
const CeneoOrder = model
  .define("ceneo_order", {
    id: model.id({ prefix: "cor" }).primaryKey(),
    ceneo_order_id: model.text(),
    displayed_order_id: model.text().nullable(),
    shop_order_id: model.text().nullable(),
    state_id: model.number().nullable(),
    ordered_at: model.dateTime().nullable(),
    /* `{ order, products, delivery }` in PLN, as Ceneo sends them: json, because `model.float` is a 4-byte real. */
    amounts: model.json().nullable(),
    delivery_form: model.text().nullable(),
    payment_type_id: model.number().nullable(),
    payment_method_id: model.number().nullable(),
    items: model.json().nullable(),
    matched: model.boolean().default(false),
    problems: model.json().nullable(),
    medusa_order_id: model.text().nullable(),
    import_status: model.text().nullable(),
    import_claim: model.text().nullable(),
    import_lease_until: model.dateTime().nullable(),
    import_attempts: model.number().default(0),
    import_next_at: model.dateTime().nullable(),
    import_error: model.text().nullable(),
    imported_at: model.dateTime().nullable(),
    ceneo_writes: model.json().nullable(),
    /* The status writer selects on these two: never a scan of every imported order. */
    writes_due: model.boolean().default(false),
    cancel_handled_at: model.dateTime().nullable(),
    demo: model.boolean().default(false),
    synced_at: model.dateTime(),
  })
  .indexes([
    { on: ["ceneo_order_id"], unique: true, where: "deleted_at IS NULL" },
    { on: ["ordered_at"], where: "deleted_at IS NULL" },
    { on: ["medusa_order_id"], where: "deleted_at IS NULL AND medusa_order_id IS NOT NULL" },
    { on: ["writes_due"], where: "deleted_at IS NULL AND writes_due = true" },
  ])

export default CeneoOrder
