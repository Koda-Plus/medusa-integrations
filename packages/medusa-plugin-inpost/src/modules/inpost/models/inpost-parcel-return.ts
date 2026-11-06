import { model } from "@medusajs/framework/utils"

/**
 * ONE INPOST RETURN (InPost Returns API, "Szybkie Zwroty") OF AN ORDER: what
 * the plugin did about it and what InPost answered.
 *
 * A row is recorded when a Medusa return goes out on the InPost return option
 * (`state` pending), or when a person creates a return for the order in the
 * admin. Creating it in InPost is the outbox step, like a shipment: the row
 * is claimed by one process (`creating`, a claim token and a lease), the
 * request goes out once, and the row ends `created`, `failed` or `unknown`.
 * `unknown` (no clear answer) is never sent again by itself: the Returns API
 * has no search and no idempotency key, so a person checks InPost and then
 * tries again or marks it handled (`skipped`).
 *
 * THE DATABASE REFUSES A SECOND ROW FOR ONE RETURN: a unique index on
 * (order_id, return_key, demo), where `return_key` is the Medusa return id,
 * or "-" for the return a person created for the order.
 *
 * NO CUSTOMER DATA AT REST: no name, phone or e-mail. The plan reads them
 * from the order when it is built. The drop-off code is InPost's code of the
 * parcel, not a personal detail.
 *
 * The table is this plugin's own (`inpost_parcel_return`); another InPost
 * plugin for Medusa keeps a table of another shape under a shorter name.
 */
const InpostParcelReturn = model
  .define("inpost_parcel_return", {
    id: model.id({ prefix: "inret" }).primaryKey(),
    order_id: model.text(),
    display_id: model.number().nullable(),
    return_id: model.text().nullable(),
    return_key: model.text(),
    demo: model.boolean().default(false),
    state: model.text().default("pending"),
    method: model.text().nullable(),
    reference: model.text().nullable(),
    plan_hash: model.text().nullable(),
    shipment_id: model.text().nullable(),
    inpost_parcel_id: model.text().nullable(),
    tracking_number: model.text().nullable(),
    short_number: model.text().nullable(),
    drop_off_code: model.text().nullable(),
    has_label: model.boolean().default(false),
    expires_at: model.dateTime().nullable(),
    skip_reason: model.text().nullable(),
    error: model.text().nullable(),
    error_code: model.text().nullable(),
    attempts: model.number().default(0),
    claim_token: model.text().nullable(),
    claimed_at: model.dateTime().nullable(),
    lease_until: model.dateTime().nullable(),
    created_by: model.text().nullable(),
    shipment_created_at: model.dateTime().nullable(),
    last_checked_at: model.dateTime().nullable(),
  })
  .indexes([
    { on: ["order_id", "return_key", "demo"], unique: true, where: "deleted_at IS NULL" },
    { on: ["state", "demo"], where: "deleted_at IS NULL" },
    { on: ["return_id"], where: "return_id IS NOT NULL AND deleted_at IS NULL" },
  ])

export default InpostParcelReturn
