import { model } from "@medusajs/framework/utils"

/**
 * ONE INPOST SHIPMENT OF A MEDUSA FULFILLMENT: what the customer chose, what
 * the plugin did about it and where the parcel is.
 *
 * A row is recorded when a fulfillment of the InPost provider is created
 * (`state` pending), whether or not anything is sent to InPost. Creating the
 * ShipX shipment is the outbox step: the row is claimed by one process
 * (`creating`, a claim token and a lease), the request goes out once, and the
 * row ends `created`, `failed` or `unknown` (no answer: looked up in ShipX
 * before anything is sent again). `skipped` means shipped outside Medusa (a
 * metadata key of `skipMetadataKeys`), `canceled` that the fulfillment or the
 * shipment was canceled.
 *
 * `status` is the ShipX status, read from the webhook and the status pass.
 *
 * THE DATABASE REFUSES A SECOND ROW FOR ONE FULFILLMENT: a unique index on
 * (fulfillment_id, demo). `demo` keeps simulated rows apart: a store that
 * evaluated the demo and then connects a real account starts clean.
 *
 * NO RECEIVER DATA AT REST: no name, phone, e-mail or street of the customer
 * is stored. The plan reads them from the order when it is built. Lockers are
 * public points, so their code and address are kept.
 */
const InpostParcel = model
  .define("inpost_parcel", {
    id: model.id({ prefix: "inpar" }).primaryKey(),
    order_id: model.text(),
    display_id: model.number().nullable(),
    fulfillment_id: model.text().nullable(),
    demo: model.boolean().default(false),
    option_id: model.text(),
    kind: model.text(),
    cod: model.boolean().default(false),
    service: model.text(),
    locker_code: model.text().nullable(),
    locker_name: model.text().nullable(),
    locker_address: model.json().nullable(),
    parcel_size: model.text().nullable(),
    parcel_no: model.number().default(1),
    cod_minor: model.number().nullable(),
    currency: model.text().nullable(),
    reference: model.text().nullable(),
    state: model.text().default("pending"),
    status: model.text().nullable(),
    status_at: model.dateTime().nullable(),
    shipment_id: model.text().nullable(),
    tracking_number: model.text().nullable(),
    sending_method: model.text().nullable(),
    plan_hash: model.text().nullable(),
    problems: model.json().nullable(),
    skip_reason: model.text().nullable(),
    external: model.boolean().default(false),
    error: model.text().nullable(),
    error_code: model.text().nullable(),
    attempts: model.number().default(0),
    claim_token: model.text().nullable(),
    claimed_at: model.dateTime().nullable(),
    lease_until: model.dateTime().nullable(),
    created_by: model.text().nullable(),
    shipment_created_at: model.dateTime().nullable(),
    offer: model.json().nullable(),
    buy_requested_at: model.dateTime().nullable(),
    dispatch_state: model.text().nullable(),
    dispatch_order_id: model.text().nullable(),
    dispatch_error: model.text().nullable(),
    dispatch_at: model.dateTime().nullable(),
    fulfillment_canceled_at: model.dateTime().nullable(),
    shipped_marked_at: model.dateTime().nullable(),
    delivered_marked_at: model.dateTime().nullable(),
    status_writer_error: model.text().nullable(),
    last_checked_at: model.dateTime().nullable(),
  })
  .indexes([
    { on: ["fulfillment_id", "demo"], unique: true, where: "fulfillment_id IS NOT NULL AND deleted_at IS NULL" },
    { on: ["order_id", "demo"], where: "deleted_at IS NULL" },
    { on: ["state", "demo"], where: "deleted_at IS NULL" },
    { on: ["shipment_id"], where: "deleted_at IS NULL" },
    { on: ["demo", "last_checked_at"], where: "deleted_at IS NULL" },
  ])

export default InpostParcel
